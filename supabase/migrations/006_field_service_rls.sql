-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 006
-- RLS for the fs_* tables.
--
-- Run AFTER 005_field_service_functions.sql (policies below call
-- fs_is_provider()/fs_is_assigned()/etc.).
--
-- Ground rules (docs/field-service-architecture.md §5, §9):
--   - PIC visibility is ALWAYS scoped through fs_is_assigned() — never
--     lingkup_semua() (see docs/field-service-deviation-log.md D-006).
--   - fs_execution_instances.status is never client-UPDATE-able directly;
--     it only changes via fs_status_transition() (SECURITY DEFINER, runs as
--     table owner, bypasses RLS by design — see the note in 005).
--   - fs_work_sessions / fs_gps_events rows are only ever created via
--     fs_check_in()/fs_check_out() (also SECURITY DEFINER) — no direct
--     client INSERT policy exists for either.
--   - Client (CLIENT_ADMIN/CLIENT_MANAGER/CLIENT_VIEWER) read access is the
--     V1 single-tenant simplification documented in fs_is_client_reviewer()
--     (005): any client-role user may read any fs_project in this
--     deployment. Add a project-membership table before serving multiple
--     client companies from one deployment.
--
-- Known/accepted advisor finding: Supabase's linter flags fs_check_in,
-- fs_check_out, fs_status_transition, fs_is_assigned,
-- fs_effective_gps_radius, and fs_effective_evidence_min_count as
-- SECURITY DEFINER functions callable by both `anon` and `authenticated`
-- via PostgREST RPC. This is unavoidable given the platform's existing auth
-- design (every logged-in request runs as Postgres role `anon` with
-- identity carried in JWT claims — see lib/db-token.ts and
-- docs/field-service-audit.md §4), not an oversight: RLS policies here
-- invoke these functions from a USING/WITH CHECK clause evaluated as the
-- calling role, so revoking EXECUTE from `anon` would break every fs_*
-- policy, not just close an RPC. The three check-in/out/transition
-- functions are meant to be called directly (that's their interface); the
-- three helpers are incidentally exposed as a side effect of PostgREST
-- auto-exposing every `public`-schema function, but leak nothing beyond
-- what an authorized SELECT already reveals (a boolean assignment check, a
-- numeric radius/count) — moving them to a non-exposed schema is a valid
-- future hardening step, not a currently-exploitable gap.
-- ============================================================================

ALTER TABLE public.fs_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_execution_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_pic_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_recurring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_execution_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_gps_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_project_settings ENABLE ROW LEVEL SECURITY;

-- ── fs_projects ──────────────────────────────────────────────────────────
-- Split into per-command policies (INSERT/UPDATE/DELETE) rather than a
-- single FOR ALL — a FOR ALL policy also applies to SELECT, which then
-- overlaps with the dedicated _select policy below and forces Postgres to
-- evaluate two permissive policies per row on every read (flagged by the
-- Supabase performance advisor as multiple_permissive_policies).
CREATE POLICY fs_projects_select ON public.fs_projects
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer());

CREATE POLICY fs_projects_insert ON public.fs_projects
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_projects_update ON public.fs_projects
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider_admin())
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_projects_delete ON public.fs_projects
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider_admin());

-- ── fs_areas ─────────────────────────────────────────────────────────────
CREATE POLICY fs_areas_select ON public.fs_areas
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer());

CREATE POLICY fs_areas_insert ON public.fs_areas
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_areas_update ON public.fs_areas
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider_admin())
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_areas_delete ON public.fs_areas
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider_admin());

-- ── fs_locations (Location Master) ──────────────────────────────────────
-- PIC read access is scoped to locations they're actually assigned to
-- (any date) — not the whole Location Master, per instruction §41 ("do not
-- show all 3,000 locations as executable choices").
CREATE POLICY fs_locations_select ON public.fs_locations
  FOR SELECT TO anon, authenticated
  USING (
    fs_is_provider() OR fs_is_client_viewer()
    OR EXISTS (
      SELECT 1 FROM public.fs_pic_assignments a
      WHERE a.location_id = fs_locations.id AND a.user_id = jwt_user_id() AND a.active
    )
  );

-- Write access is provider-admin only — PIC must never create/redefine
-- locations or edit official coordinates (instruction §7).
CREATE POLICY fs_locations_insert ON public.fs_locations
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_locations_update ON public.fs_locations
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider_admin())
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_locations_delete ON public.fs_locations
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider_admin());

-- ── fs_execution_points ──────────────────────────────────────────────────
CREATE POLICY fs_execution_points_select ON public.fs_execution_points
  FOR SELECT TO anon, authenticated
  USING (
    fs_is_provider() OR fs_is_client_viewer()
    OR EXISTS (
      SELECT 1 FROM public.fs_pic_assignments a
      WHERE a.location_id = fs_execution_points.location_id AND a.user_id = jwt_user_id() AND a.active
    )
  );

CREATE POLICY fs_execution_points_insert ON public.fs_execution_points
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_execution_points_update ON public.fs_execution_points
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider_admin())
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_execution_points_delete ON public.fs_execution_points
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider_admin());

-- ── fs_pic_assignments — THE authorization boundary ─────────────────────
-- A PIC may see their OWN assignment rows (so their "Today's Work" list can
-- be built), never anyone else's. Write access is gated by the
-- fs_guard_pic_assignment_columns trigger (005) in addition to this policy
-- — belt and suspenders, matching guard_users_privileged_columns().
CREATE POLICY fs_pic_assignments_select ON public.fs_pic_assignments
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer() OR user_id = jwt_user_id());

CREATE POLICY fs_pic_assignments_insert ON public.fs_pic_assignments
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider());

CREATE POLICY fs_pic_assignments_update ON public.fs_pic_assignments
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider())
  WITH CHECK (fs_is_provider());

CREATE POLICY fs_pic_assignments_delete ON public.fs_pic_assignments
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider());

-- ── fs_recurring_schedules ───────────────────────────────────────────────
CREATE POLICY fs_recurring_schedules_select ON public.fs_recurring_schedules
  FOR SELECT TO anon, authenticated
  USING (
    fs_is_provider() OR fs_is_client_viewer()
    OR EXISTS (
      SELECT 1 FROM public.fs_pic_assignments a
      WHERE a.location_id = fs_recurring_schedules.location_id AND a.user_id = jwt_user_id() AND a.active
    )
  );

CREATE POLICY fs_recurring_schedules_insert ON public.fs_recurring_schedules
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider());

CREATE POLICY fs_recurring_schedules_update ON public.fs_recurring_schedules
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider())
  WITH CHECK (fs_is_provider());

CREATE POLICY fs_recurring_schedules_delete ON public.fs_recurring_schedules
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider());

-- ── fs_execution_instances ───────────────────────────────────────────────
-- SELECT is scoped through fs_is_assigned() for a PIC — the same function
-- fs_check_in() uses — so "what a PIC can see" and "what a PIC can check
-- into" can never drift apart. No general client UPDATE policy exists:
-- status changes only happen via fs_status_transition() (005), which
-- bypasses RLS as a SECURITY DEFINER function owned by the table owner.
CREATE POLICY fs_execution_instances_select ON public.fs_execution_instances
  FOR SELECT TO anon, authenticated
  USING (
    fs_is_provider() OR fs_is_client_viewer()
    OR fs_is_assigned(jwt_user_id(), location_id, execution_point_id, instance_date)
  );

CREATE POLICY fs_execution_instances_insert ON public.fs_execution_instances
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider());

CREATE POLICY fs_execution_instances_update ON public.fs_execution_instances
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider())
  WITH CHECK (fs_is_provider());

CREATE POLICY fs_execution_instances_delete ON public.fs_execution_instances
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider());

-- ── fs_work_sessions ─────────────────────────────────────────────────────
-- No direct INSERT/UPDATE policy for anon/authenticated — rows are only
-- ever created/closed via fs_check_in()/fs_check_out() (005, SECURITY
-- DEFINER, bypasses RLS). SELECT lets a PIC see their own sessions and lets
-- provider/client see all, for the proof-of-execution views.
CREATE POLICY fs_work_sessions_select ON public.fs_work_sessions
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer() OR pic_user_id = jwt_user_id());

-- ── fs_gps_events ────────────────────────────────────────────────────────
-- Audit trail. No INSERT/UPDATE/DELETE policy for anon/authenticated at
-- all — only fs_check_in()/fs_check_out() write here.
CREATE POLICY fs_gps_events_select ON public.fs_gps_events
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer() OR user_id = jwt_user_id());

-- ── fs_evidence ──────────────────────────────────────────────────────────
-- INSERT ownership is resolved server-side from the caller's own ACTIVE
-- work session, not from client-supplied execution_instance_id/task_id —
-- this is the concrete fix for the mandatory evidence-ownership test
-- (instruction §85): a PIC cannot submit evidence against another PIC's
-- execution by editing IDs, because the WHERE clause below re-derives
-- ownership from fs_work_sessions itself.
CREATE POLICY fs_evidence_select ON public.fs_evidence
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer() OR uploaded_by = jwt_user_id());

CREATE POLICY fs_evidence_insert ON public.fs_evidence
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    uploaded_by = jwt_user_id()
    AND EXISTS (
      SELECT 1 FROM public.fs_work_sessions ws
      WHERE ws.id = fs_evidence.work_session_id
        AND ws.pic_user_id = jwt_user_id()
        AND ws.execution_instance_id = fs_evidence.execution_instance_id
        AND ws.status = 'ACTIVE'
    )
  );

CREATE POLICY fs_evidence_provider_manage ON public.fs_evidence
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider())
  WITH CHECK (fs_is_provider());

CREATE POLICY fs_evidence_delete ON public.fs_evidence
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider());

-- ── fs_reviews ───────────────────────────────────────────────────────────
-- Append-only: only INSERT is granted (no UPDATE/DELETE policy at all) —
-- a re-review adds a new row, matching the "provider cannot self-verify,
-- client decisions are an audit trail" design (§11, §87).
CREATE POLICY fs_reviews_select ON public.fs_reviews
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer());

CREATE POLICY fs_reviews_insert ON public.fs_reviews
  FOR INSERT TO anon, authenticated
  WITH CHECK (reviewer_id = jwt_user_id() AND fs_is_client_reviewer());

-- ── fs_project_settings ──────────────────────────────────────────────────
CREATE POLICY fs_project_settings_select ON public.fs_project_settings
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer());

CREATE POLICY fs_project_settings_insert ON public.fs_project_settings
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_project_settings_update ON public.fs_project_settings
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider_admin())
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_project_settings_delete ON public.fs_project_settings
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider_admin());
