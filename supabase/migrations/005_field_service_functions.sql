-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 005
-- SECURITY DEFINER functions: assignment resolution, GPS validation,
-- check-in/out, status transitions, conflict prevention.
--
-- Run AFTER 004_field_service_schema.sql. Depends on jwt_claim()/jwt_user_id()
-- from 002_core_functions.sql.
--
-- IMPORTANT — application-side dependency: these functions read the JWT
-- claim `fs_role`. lib/db-token.ts must issue that claim (added alongside
-- this migration — see issueDbToken in that file) or fs_is_provider()/
-- fs_is_client_reviewer() will never recognize a Field Service role and
-- everything here degrades to "provider admin / full-access only".
-- ============================================================================

-- ── Role resolution ──────────────────────────────────────────────────────

-- Provider-admin-equivalent: a global admin/superadmin/Full-Access user, OR
-- someone explicitly given the PROVIDER_ADMIN fs_role. Mirrors how
-- access_level already elevates users platform-wide (docs/field-service-
-- architecture.md §3) — does not duplicate admin logic, composes with it.
CREATE OR REPLACE FUNCTION public.fs_is_provider_admin()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT admin_atau_full_access() OR jwt_claim('fs_role') = 'PROVIDER_ADMIN';
$$;

-- Any provider-side actor (admin or supervisor) — used for the transitions
-- and views a supervisor may also perform, not just a full admin.
CREATE OR REPLACE FUNCTION public.fs_is_provider()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT fs_is_provider_admin() OR jwt_claim('fs_role') = 'PROVIDER_SUPERVISOR';
$$;

-- Client-side reviewer. V1 simplification (documented, not silent): any user
-- with a CLIENT_ADMIN/CLIENT_MANAGER fs_role may review ANY fs_project in
-- this deployment — there is no fs_project membership table yet. This
-- matches the platform's existing single-tenant-per-deployment convention
-- (docs/field-service-audit.md §8: "designed to be white-labeled per
-- customer" — one deployment = one client company in practice). Add a
-- project-membership table before this platform serves multiple client
-- companies from one deployment.
CREATE OR REPLACE FUNCTION public.fs_is_client_reviewer()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jwt_claim('fs_role') = ANY (ARRAY['CLIENT_ADMIN', 'CLIENT_MANAGER']);
$$;

CREATE OR REPLACE FUNCTION public.fs_is_client_viewer()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT fs_is_client_reviewer() OR jwt_claim('fs_role') = 'CLIENT_VIEWER';
$$;

-- ── Assignment resolution — THE authorization boundary ──────────────────
-- True only for an ACTIVE assignment matching this exact user + location
-- (+ execution point, if the assignment is point-specific) with p_date
-- inside its effective range. GPS proximity plays no part in this function
-- at all — see docs/field-service-architecture.md §5.
CREATE OR REPLACE FUNCTION public.fs_is_assigned(
  p_user_id uuid,
  p_location_id uuid,
  p_execution_point_id uuid,
  p_date date
)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.fs_pic_assignments a
    WHERE a.user_id = p_user_id
      AND a.location_id = p_location_id
      AND (a.execution_point_id IS NULL OR a.execution_point_id = p_execution_point_id)
      AND a.active
      AND a.effective_date <= p_date
      AND (a.end_date IS NULL OR a.end_date >= p_date)
  );
$$;

-- ── Effective configuration (system → project → location) ───────────────
-- Concrete resolvers for the two values check-in actually needs, rather
-- than a fully generic key resolver — per instruction §64 ("do not make
-- every field configurable"/avoid a settings jungle). Precedence: location
-- override (fs_locations.overrides) > project override
-- (fs_project_settings) > system default (app_settings) > hardcoded
-- fallback.
CREATE OR REPLACE FUNCTION public.fs_effective_gps_radius(p_location_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_override jsonb;
  v_project_value integer;
  v_system_value integer;
BEGIN
  SELECT project_id, overrides -> 'gps_radius_m'
    INTO v_project_id, v_override
    FROM public.fs_locations WHERE id = p_location_id;

  IF v_override IS NOT NULL THEN
    RETURN (v_override)::text::integer;
  END IF;

  SELECT gps_radius_m INTO v_project_value
    FROM public.fs_project_settings WHERE project_id = v_project_id;
  IF v_project_value IS NOT NULL THEN
    RETURN v_project_value;
  END IF;

  SELECT (value ->> 'gps_radius_m')::integer INTO v_system_value
    FROM public.app_settings WHERE key = 'field_service.defaults';

  RETURN COALESCE(v_system_value, 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_effective_evidence_min_count(p_location_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_override jsonb;
  v_project_value integer;
  v_system_value integer;
BEGIN
  SELECT project_id, overrides -> 'evidence_min_count'
    INTO v_project_id, v_override
    FROM public.fs_locations WHERE id = p_location_id;

  IF v_override IS NOT NULL THEN
    RETURN (v_override)::text::integer;
  END IF;

  SELECT evidence_min_count INTO v_project_value
    FROM public.fs_project_settings WHERE project_id = v_project_id;
  IF v_project_value IS NOT NULL THEN
    RETURN v_project_value;
  END IF;

  SELECT (value ->> 'evidence_min_count')::integer INTO v_system_value
    FROM public.app_settings WHERE key = 'field_service.defaults';

  RETURN COALESCE(v_system_value, 1);
END;
$$;

-- ── Haversine distance (meters) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fs_distance_meters(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT 6371000 * acos(
    LEAST(1.0, GREATEST(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  );
$$;

-- ── PIC assignment conflict guard ────────────────────────────────────────
-- Default: one active PIC per (location, execution point, schedule).
-- Multi-PIC is only permitted when the owning fs_projects row has
-- allow_multi_pic = true (instruction §15) — a plain unique index can't
-- express "unless a flag on another table says otherwise", so this is a
-- trigger, not a constraint.
CREATE OR REPLACE FUNCTION public.fs_check_assignment_conflict()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_allow_multi boolean;
  v_conflict_count integer;
BEGIN
  IF NOT NEW.active THEN
    RETURN NEW;
  END IF;

  SELECT allow_multi_pic INTO v_allow_multi FROM public.fs_projects WHERE id = NEW.project_id;

  IF v_allow_multi THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_conflict_count
  FROM public.fs_pic_assignments a
  WHERE a.id <> NEW.id
    AND a.location_id = NEW.location_id
    AND COALESCE(a.execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(NEW.execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND a.active
    AND a.effective_date <= COALESCE(NEW.end_date, 'infinity'::date)
    AND COALESCE(a.end_date, 'infinity'::date) >= NEW.effective_date;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION
      'Lokasi/execution point ini sudah punya PIC aktif lain pada rentang tanggal yang sama. Aktifkan allow_multi_pic pada fs_projects kalau proyek ini memang mengizinkan lebih dari satu PIC.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fs_check_assignment_conflict
  BEFORE INSERT OR UPDATE ON public.fs_pic_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fs_check_assignment_conflict();

-- ── Privileged-column freeze on fs_pic_assignments ──────────────────────
-- Only provider-admin/supervisor may write the assignment-defining columns
-- — a PIC can never self-assign or extend their own access (mirrors
-- guard_users_privileged_columns() — docs/field-service-architecture.md §5.3).
CREATE OR REPLACE FUNCTION public.fs_guard_pic_assignment_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NOT fs_is_provider() THEN
    RAISE EXCEPTION 'Hanya provider admin/supervisor yang boleh mengubah PIC assignment.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fs_guard_pic_assignment
  BEFORE INSERT OR UPDATE ON public.fs_pic_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fs_guard_pic_assignment_columns();

-- ── Check-in ─────────────────────────────────────────────────────────────
-- The single place ASSIGNMENT_MISMATCH/OUTSIDE_RADIUS/etc. are decided —
-- the client never computes or asserts validity (instruction §23-24).
-- Always logs an fs_gps_events row, even on denial, so every attempt is
-- auditable. Idempotent: a second check-in call against an instance that
-- already has an ACTIVE session for this PIC returns that same session
-- rather than creating a duplicate (instruction §57/§88).
CREATE OR REPLACE FUNCTION public.fs_check_in(
  p_instance_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := jwt_user_id();
  v_instance record;
  v_radius integer;
  v_distance numeric;
  v_status text;
  v_session_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Tidak ada identitas pada token.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_instance FROM public.fs_execution_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execution instance tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Schedule check: check-in only valid on the instance's own date. GPS
  -- proximity plays no part in this decision.
  IF v_instance.instance_date <> current_date THEN
    v_status := 'SCHEDULE_MISMATCH';
  -- Assignment check: re-derived server-side from fs_pic_assignments, never
  -- trusted from the client — this is the mandatory cross-PIC test
  -- (instruction §81): GPS validity below is irrelevant if this fails.
  ELSIF NOT fs_is_assigned(v_user_id, v_instance.location_id, v_instance.execution_point_id, v_instance.instance_date) THEN
    v_status := 'ASSIGNMENT_MISMATCH';
  ELSIF p_accuracy IS NOT NULL AND p_accuracy > 100 THEN
    v_status := 'LOW_ACCURACY';
  ELSE
    SELECT fs_distance_meters(p_lat, p_lng, l.latitude, l.longitude), fs_effective_gps_radius(l.id)
      INTO v_distance, v_radius
      FROM public.fs_locations l WHERE l.id = v_instance.location_id;
    IF v_distance > v_radius THEN
      v_status := 'OUTSIDE_RADIUS';
    ELSE
      v_status := 'VALID';
    END IF;
  END IF;

  INSERT INTO public.fs_gps_events (
    execution_instance_id, user_id, event_type, latitude, longitude,
    accuracy_m, distance_m, validation_status
  ) VALUES (
    p_instance_id, v_user_id, 'CHECK_IN', p_lat, p_lng, p_accuracy, v_distance, v_status
  );

  IF v_status <> 'VALID' THEN
    RETURN jsonb_build_object('validation_status', v_status, 'distance_m', v_distance, 'work_session_id', NULL);
  END IF;

  -- Idempotent: reuse an existing ACTIVE session for this instance instead
  -- of creating a second one on a retried/duplicate check-in call.
  SELECT id INTO v_session_id FROM public.fs_work_sessions
    WHERE execution_instance_id = p_instance_id AND status = 'ACTIVE';

  IF v_session_id IS NULL THEN
    INSERT INTO public.fs_work_sessions (execution_instance_id, pic_user_id, check_in_at)
      VALUES (p_instance_id, v_user_id, now())
      RETURNING id INTO v_session_id;
  END IF;

  IF v_instance.status = 'NOT_STARTED' THEN
    PERFORM fs_status_transition(p_instance_id, 'IN_PROGRESS');
  END IF;

  RETURN jsonb_build_object('validation_status', v_status, 'distance_m', v_distance, 'work_session_id', v_session_id);
END;
$$;

-- ── Check-out ────────────────────────────────────────────────────────────
-- Idempotent: checking out an already-CLOSED session is a safe no-op that
-- returns the existing record rather than erroring or duplicating.
CREATE OR REPLACE FUNCTION public.fs_check_out(
  p_work_session_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := jwt_user_id();
  v_session record;
  v_instance record;
  v_radius integer;
  v_distance numeric;
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Tidak ada identitas pada token.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_session FROM public.fs_work_sessions WHERE id = p_work_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work session tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_session.pic_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Work session ini bukan milik Anda.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_session.status = 'CLOSED' THEN
    RETURN jsonb_build_object('validation_status', 'ALREADY_CLOSED', 'work_session_id', v_session.id);
  END IF;

  SELECT * INTO v_instance FROM public.fs_execution_instances WHERE id = v_session.execution_instance_id;

  SELECT fs_distance_meters(p_lat, p_lng, l.latitude, l.longitude), fs_effective_gps_radius(l.id)
    INTO v_distance, v_radius
    FROM public.fs_locations l WHERE l.id = v_instance.location_id;

  IF p_accuracy IS NOT NULL AND p_accuracy > 100 THEN
    v_status := 'LOW_ACCURACY';
  ELSIF v_distance > v_radius THEN
    v_status := 'OUTSIDE_RADIUS';
  ELSE
    v_status := 'VALID';
  END IF;

  INSERT INTO public.fs_gps_events (
    work_session_id, execution_instance_id, user_id, event_type, latitude, longitude,
    accuracy_m, distance_m, validation_status
  ) VALUES (
    v_session.id, v_session.execution_instance_id, v_user_id, 'CHECK_OUT', p_lat, p_lng, p_accuracy, v_distance, v_status
  );

  IF v_status <> 'VALID' THEN
    RETURN jsonb_build_object('validation_status', v_status, 'distance_m', v_distance, 'work_session_id', v_session.id);
  END IF;

  UPDATE public.fs_work_sessions SET check_out_at = now(), status = 'CLOSED' WHERE id = v_session.id;

  RETURN jsonb_build_object('validation_status', v_status, 'distance_m', v_distance, 'work_session_id', v_session.id);
END;
$$;

-- ── Status transitions ───────────────────────────────────────────────────
-- Explicit (from, to, actor) allow-list — the concrete fix for "COMPLETED ≠
-- VERIFIED" and "provider cannot self-verify" (instruction §33/§87). Every
-- status change must go through this function; nothing else may
-- UPDATE fs_execution_instances.status directly (enforced by RLS in 006,
-- which grants no client UPDATE on that column at all).
CREATE OR REPLACE FUNCTION public.fs_status_transition(
  p_instance_id uuid,
  p_new_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_instance record;
  v_user_id uuid := jwt_user_id();
  v_is_pic boolean;
  v_allowed boolean := false;
BEGIN
  SELECT * INTO v_instance FROM public.fs_execution_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execution instance tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  v_is_pic := v_user_id IS NOT NULL
    AND fs_is_assigned(v_user_id, v_instance.location_id, v_instance.execution_point_id, v_instance.instance_date);

  IF v_instance.status = 'NOT_STARTED' AND p_new_status = 'IN_PROGRESS' AND v_is_pic THEN
    v_allowed := true;
  ELSIF v_instance.status = 'IN_PROGRESS' AND p_new_status = 'SUBMITTED' AND v_is_pic THEN
    v_allowed := true;
  ELSIF v_instance.status = 'SUBMITTED' AND p_new_status = 'COMPLETED' AND fs_is_provider() THEN
    v_allowed := true;
  ELSIF v_instance.status = 'COMPLETED' AND p_new_status = 'WAITING_REVIEW' AND fs_is_provider() THEN
    v_allowed := true;
  ELSIF v_instance.status = 'WAITING_REVIEW' AND p_new_status = 'VERIFIED' AND fs_is_client_reviewer() THEN
    v_allowed := true;
  ELSIF v_instance.status = 'WAITING_REVIEW' AND p_new_status = 'REVISION_REQUIRED' AND fs_is_client_reviewer() THEN
    v_allowed := true;
  ELSIF v_instance.status = 'REVISION_REQUIRED' AND p_new_status = 'IN_PROGRESS' AND v_is_pic THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transisi status % -> % tidak diizinkan untuk aktor ini.', v_instance.status, p_new_status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.fs_execution_instances SET status = p_new_status, updated_at = now() WHERE id = p_instance_id;

  RETURN jsonb_build_object('id', p_instance_id, 'status', p_new_status);
END;
$$;
