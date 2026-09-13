-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 011
-- Content Master + Deployment Date vs Content Period + Daily Technician
-- Report.
--
-- Run AFTER 001-010.
--
-- WHY THIS EXISTS: the platform had no concept of "content" at all — a PIC
-- assignment/execution instance only ever said WHERE and WHEN a technician
-- works, never WHAT they deploy. The business process this patches in:
--   CONTENT PERIOD (when content airs, e.g. 11-15 Sep) is a DIFFERENT date
--   range from DEPLOYMENT DATE (when a technician installs it, e.g. 6-7 Sep,
--   in preparation, before the content period even starts). Conflating the
--   two would make the system reject perfectly normal early deployment.
-- ============================================================================

-- ── fs_content (Content Master) ──────────────────────────────────────────
-- Versioned by ROW, not by mutating a column: "Content 11-15 Sep v1" and
-- "...v2" are two separate rows sharing (project_id, name). A daily report
-- foreign-keys to the EXACT row/version deployed that day, so a later v2
-- never rewrites what a historical report says it used (§15 of the patch).
CREATE TABLE public.fs_content (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  file_url text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  CONSTRAINT fs_content_status_check CHECK (status = ANY (ARRAY['active', 'archived'])),
  CONSTRAINT fs_content_period_check CHECK (valid_until >= valid_from),
  CONSTRAINT fs_content_version_check CHECK (version > 0),
  UNIQUE (project_id, name, version)
);

CREATE INDEX idx_fs_content_project ON public.fs_content USING btree (project_id);
CREATE INDEX idx_fs_content_period ON public.fs_content USING btree (valid_from, valid_until);

-- ── Link content to WHERE/WHO (assignment) and WHEN-executed (instance) ──
-- Nullable: not every assignment/instance is content-deployment work (this
-- repo's Field Service use case predates content entirely), so existing
-- rows/behavior are untouched.
ALTER TABLE public.fs_pic_assignments ADD COLUMN IF NOT EXISTS content_id uuid
  REFERENCES public.fs_content(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fs_pic_assignments_content ON public.fs_pic_assignments USING btree (content_id);

-- Snapshotted at instance-creation time from the assignment (same pattern as
-- assigned_pic_user_id, 004) - so a content change later never rewrites what
-- a past instance says it deployed.
ALTER TABLE public.fs_execution_instances ADD COLUMN IF NOT EXISTS content_id uuid
  REFERENCES public.fs_content(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fs_execution_instances_content ON public.fs_execution_instances USING btree (content_id);

-- Replace the 004 unique index to also key on content: §9 of the patch
-- requires a technician to be able to deploy TWO DIFFERENT contents to the
-- SAME location/point on the SAME day as two distinct execution instances,
-- not be blocked as a duplicate.
DROP INDEX IF EXISTS idx_fs_execution_instances_unique;
CREATE UNIQUE INDEX idx_fs_execution_instances_unique
  ON public.fs_execution_instances (
    location_id,
    COALESCE(execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(content_id, '00000000-0000-0000-0000-000000000000'::uuid),
    instance_date
  );

-- fs_ensure_today_instance (007) re-defined to copy content_id from the
-- assignment, and to match it in the idempotent lookup (mirrors the unique
-- index above exactly, otherwise a second call for a content-bearing
-- assignment would find the WRONG existing instance - e.g. a content-less
-- one from before this migration - and silently attach to it).
CREATE OR REPLACE FUNCTION public.fs_ensure_today_instance(p_assignment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := jwt_user_id();
  v_assignment record;
  v_instance_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Tidak ada identitas pada token.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_assignment FROM public.fs_pic_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PIC assignment tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_assignment.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Assignment ini bukan milik Anda.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT v_assignment.active
     OR current_date < v_assignment.effective_date
     OR (v_assignment.end_date IS NOT NULL AND current_date > v_assignment.end_date) THEN
    RAISE EXCEPTION 'Assignment ini tidak aktif untuk hari ini.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_instance_id
    FROM public.fs_execution_instances
    WHERE location_id = v_assignment.location_id
      AND COALESCE(execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(v_assignment.execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(content_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(v_assignment.content_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND instance_date = current_date;

  IF v_instance_id IS NULL THEN
    INSERT INTO public.fs_execution_instances
      (project_id, location_id, execution_point_id, schedule_id, assigned_pic_user_id, content_id, instance_date, status)
    VALUES
      (v_assignment.project_id, v_assignment.location_id, v_assignment.execution_point_id,
       v_assignment.schedule_id, v_assignment.user_id, v_assignment.content_id, current_date, 'NOT_STARTED')
    RETURNING id INTO v_instance_id;
  END IF;

  RETURN v_instance_id;
END;
$$;

-- RLS: fs_content is master data, same shape as fs_projects/fs_locations -
-- admin-only write (fs_is_provider_admin), readable by anyone who can see
-- Field Service data at all.
ALTER TABLE public.fs_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY fs_content_select ON public.fs_content
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer());

CREATE POLICY fs_content_insert ON public.fs_content
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_content_update ON public.fs_content
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider_admin())
  WITH CHECK (fs_is_provider_admin());

-- ── fs_daily_reports (Daily Technician Report) ───────────────────────────
-- One report per execution instance (UNIQUE), not a free-floating note -
-- §6 of the patch: it must prove it came from real work, not be typed from
-- nothing. Content fields are DENORMALIZED SNAPSHOTS (name/version/period),
-- not just a content_id FK, so a report's own historical meaning survives
-- even if the fs_content row it points to is later archived or deleted
-- (ON DELETE SET NULL on the FK, snapshot columns stay put) - §15.
CREATE TABLE public.fs_daily_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  execution_instance_id uuid NOT NULL,
  technician_id uuid NOT NULL,
  project_id uuid NOT NULL,
  location_id uuid NOT NULL,
  content_id uuid,
  content_name_snapshot text,
  content_version_snapshot integer,
  content_valid_from_snapshot date,
  content_valid_until_snapshot date,
  -- Denormalized from fs_execution_instances.instance_date at submit time -
  -- named deployment_date here to match the business vocabulary exactly
  -- (§1: this is NOT the content period).
  deployment_date date NOT NULL,
  displays_total integer NOT NULL DEFAULT 0,
  displays_completed integer NOT NULL DEFAULT 0,
  evidence_count integer NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'DRAFT',
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (execution_instance_id) REFERENCES public.fs_execution_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES public.fs_locations(id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES public.fs_content(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT fs_daily_reports_status_check CHECK (status = ANY (ARRAY['DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'REJECTED'])),
  CONSTRAINT fs_daily_reports_displays_check CHECK (displays_completed >= 0 AND displays_total >= 0),
  UNIQUE (execution_instance_id)
);

CREATE INDEX idx_fs_daily_reports_technician ON public.fs_daily_reports USING btree (technician_id, deployment_date);
CREATE INDEX idx_fs_daily_reports_project ON public.fs_daily_reports USING btree (project_id, deployment_date);
CREATE INDEX idx_fs_daily_reports_status ON public.fs_daily_reports USING btree (status);
CREATE INDEX idx_fs_daily_reports_content ON public.fs_daily_reports USING btree (content_id);

-- Guard: freezes ownership/identity + the OTHER actor's columns depending on
-- who's writing - same belt-and-suspenders pattern as
-- fs_guard_pic_assignment_columns (005) / fs_guard_work_session_notes_only
-- (007). A technician editing their own DRAFT can't quietly set
-- status=APPROVED themselves; a reviewer approving/rejecting can't rewrite
-- the technician's displays/evidence counts.
CREATE OR REPLACE FUNCTION public.fs_guard_daily_report_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- Identity/lineage columns: never client-editable by anyone, regardless
  -- of role - who this report is about and which instance/content it
  -- proves is fixed at INSERT time.
  NEW.execution_instance_id      := OLD.execution_instance_id;
  NEW.technician_id              := OLD.technician_id;
  NEW.project_id                 := OLD.project_id;
  NEW.location_id                := OLD.location_id;
  NEW.content_id                 := OLD.content_id;
  NEW.content_name_snapshot       := OLD.content_name_snapshot;
  NEW.content_version_snapshot    := OLD.content_version_snapshot;
  NEW.content_valid_from_snapshot := OLD.content_valid_from_snapshot;
  NEW.content_valid_until_snapshot := OLD.content_valid_until_snapshot;
  NEW.deployment_date             := OLD.deployment_date;
  NEW.created_at                  := OLD.created_at;

  IF fs_is_provider() THEN
    -- Reviewer path: only the review verdict may change.
    NEW.displays_total     := OLD.displays_total;
    NEW.displays_completed := OLD.displays_completed;
    NEW.evidence_count     := OLD.evidence_count;
    NEW.notes              := OLD.notes;
    NEW.submitted_at       := OLD.submitted_at;
  ELSE
    -- Technician path: only their own draft content may change, never the
    -- review verdict columns.
    NEW.reviewed_at      := OLD.reviewed_at;
    NEW.reviewed_by      := OLD.reviewed_by;
    NEW.rejection_reason := OLD.rejection_reason;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fs_guard_daily_report_columns
  BEFORE UPDATE ON public.fs_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.fs_guard_daily_report_columns();

ALTER TABLE public.fs_daily_reports ENABLE ROW LEVEL SECURITY;

-- Read: provider (all), client viewer (all - same "V1 simplification" as
-- fs_reviews/fs_execution_instances, no per-tenant scoping yet), or the
-- technician who wrote it.
CREATE POLICY fs_daily_reports_select ON public.fs_daily_reports
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer() OR technician_id = jwt_user_id());

-- Insert: only the PIC actually assigned to this instance's location/point
-- on this date may file its report - same ownership test fs_check_in (005)
-- uses, re-derived server-side rather than trusted from the client.
CREATE POLICY fs_daily_reports_insert ON public.fs_daily_reports
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    technician_id = jwt_user_id()
    AND EXISTS (
      SELECT 1 FROM public.fs_execution_instances i
      WHERE i.id = execution_instance_id
        AND fs_is_assigned(jwt_user_id(), i.location_id, i.execution_point_id, i.instance_date)
    )
  );

-- Update: technician (their own, while DRAFT/SUBMITTED/REJECTED - matches §14
-- "technician dapat melakukan correction/re-submission"; SUBMITTED is
-- included so a technician who re-executes after REVISION_REQUIRED on the
-- SAME execution instance can upsert their existing report instead of
-- hitting the UNIQUE(execution_instance_id) constraint) or provider
-- (review verdict) - the guard trigger above enforces which COLUMNS each
-- side may actually change within that.
CREATE POLICY fs_daily_reports_update ON public.fs_daily_reports
  FOR UPDATE TO anon, authenticated
  USING (
    fs_is_provider()
    OR (technician_id = jwt_user_id() AND status IN ('DRAFT', 'SUBMITTED', 'REJECTED'))
  )
  WITH CHECK (
    fs_is_provider()
    OR (technician_id = jwt_user_id())
  );
