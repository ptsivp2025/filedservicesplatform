-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 004
-- fs_* core data model (Phase 2 of docs/field-service-architecture.md §17).
--
-- Run AFTER 001-003 (core schema/functions/RLS) — fs_pic_assignments and
-- fs_evidence reference public.users.
--
-- Table shape follows docs/field-service-architecture.md §4 exactly. RLS
-- (006) and SECURITY DEFINER functions (005) come in later migrations;
-- this file only creates tables/constraints/indexes.
-- ============================================================================

-- ── fs_projects ──────────────────────────────────────────────────────────
-- The client engagement/contract. Named fs_projects (not bare "projects")
-- to avoid collision with the platform's other overloaded "project" tables
-- — see docs/field-service-audit.md §15.
CREATE TABLE public.fs_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_name text,
  -- Default: one execution point has exactly one active PIC assignment.
  -- Only when a project explicitly needs more than one PIC per point
  -- (instruction §15) is this flipped — the conflict-check trigger on
  -- fs_pic_assignments reads this flag before allowing a second active row.
  allow_multi_pic boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT fs_projects_status_check CHECK (status = ANY (ARRAY['active', 'inactive', 'archived']))
);

-- ── fs_areas ─────────────────────────────────────────────────────────────
-- Logical grouping only (e.g. "Jakarta Utara") — never a substitute for
-- Location Master identity (instruction §11).
CREATE TABLE public.fs_areas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  UNIQUE (project_id, name)
);

-- ── fs_locations (Location Master) ──────────────────────────────────────
-- The physical site — authoritative coordinates. PIC UI never writes here
-- (instruction §7). project_id is denormalized from fs_areas for simpler
-- RLS/index access; area_id remains the source of truth for grouping.
CREATE TABLE public.fs_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  area_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  latitude numeric(9,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  gps_radius_m integer NOT NULL DEFAULT 100,
  -- Location-level overrides (gps_radius_m, evidence_min_count, etc.) as a
  -- JSONB bag rather than a wide table of nullable columns — per
  -- docs/field-service-architecture.md §7 ("do not expose unnecessary
  -- complexity"). Resolved via fs_effective_gps_radius() (005).
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id) REFERENCES public.fs_areas(id) ON DELETE RESTRICT,
  CONSTRAINT fs_locations_status_check CHECK (status = ANY (ARRAY['active', 'inactive'])),
  CONSTRAINT fs_locations_radius_check CHECK (gps_radius_m > 0),
  CONSTRAINT fs_locations_lat_check CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT fs_locations_lng_check CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX idx_fs_locations_project ON public.fs_locations USING btree (project_id);
CREATE INDEX idx_fs_locations_area ON public.fs_locations USING btree (area_id);
CREATE INDEX idx_fs_locations_status ON public.fs_locations USING btree (status);

-- ── fs_execution_points ──────────────────────────────────────────────────
-- A TV/display/point within a Location. One physical location can have many
-- (instruction §10) — never modeled as separate locations.
CREATE TABLE public.fs_execution_points (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (location_id) REFERENCES public.fs_locations(id) ON DELETE CASCADE,
  UNIQUE (location_id, name),
  CONSTRAINT fs_execution_points_status_check CHECK (status = ANY (ARRAY['active', 'inactive']))
);

CREATE INDEX idx_fs_execution_points_location ON public.fs_execution_points USING btree (location_id);

-- ── fs_recurring_schedules ───────────────────────────────────────────────
-- Weekday pattern per location/execution point — PIC comes from
-- fs_pic_assignments, kept independently editable (§8).
CREATE TABLE public.fs_recurring_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  location_id uuid NOT NULL,
  execution_point_id uuid,
  -- 0=Sunday .. 6=Saturday.
  weekdays smallint[] NOT NULL,
  effective_date date NOT NULL DEFAULT current_date,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES public.fs_locations(id) ON DELETE CASCADE,
  FOREIGN KEY (execution_point_id) REFERENCES public.fs_execution_points(id) ON DELETE CASCADE,
  CONSTRAINT fs_recurring_schedules_weekdays_check CHECK (
    array_length(weekdays, 1) > 0 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  ),
  CONSTRAINT fs_recurring_schedules_date_range_check CHECK (end_date IS NULL OR end_date >= effective_date)
);

CREATE INDEX idx_fs_recurring_schedules_location ON public.fs_recurring_schedules USING btree (location_id, active);
CREATE INDEX idx_fs_recurring_schedules_project ON public.fs_recurring_schedules USING btree (project_id);
CREATE INDEX idx_fs_recurring_schedules_execution_point ON public.fs_recurring_schedules USING btree (execution_point_id);

-- ── fs_pic_assignments — THE authorization boundary ─────────────────────
-- user_id is a mandatory FK to public.users, never a name column — see
-- docs/field-service-deviation-log.md D-004. Conflict prevention (default
-- one-PIC-per-point, unless fs_projects.allow_multi_pic) is enforced by a
-- trigger in 005, not a plain unique index (multi-PIC is a per-project
-- runtime flag, which a unique index's static predicate can't read).
CREATE TABLE public.fs_pic_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  location_id uuid NOT NULL,
  execution_point_id uuid,
  user_id uuid NOT NULL,
  schedule_id uuid,
  effective_date date NOT NULL DEFAULT current_date,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES public.fs_locations(id) ON DELETE CASCADE,
  FOREIGN KEY (execution_point_id) REFERENCES public.fs_execution_points(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  FOREIGN KEY (schedule_id) REFERENCES public.fs_recurring_schedules(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT fs_pic_assignments_date_range_check CHECK (end_date IS NULL OR end_date >= effective_date)
);

CREATE INDEX idx_fs_pic_assignments_user ON public.fs_pic_assignments USING btree (user_id, active);
CREATE INDEX idx_fs_pic_assignments_location ON public.fs_pic_assignments USING btree (location_id, execution_point_id, active);
CREATE INDEX idx_fs_pic_assignments_project ON public.fs_pic_assignments USING btree (project_id);
CREATE INDEX idx_fs_pic_assignments_execution_point ON public.fs_pic_assignments USING btree (execution_point_id);
CREATE INDEX idx_fs_pic_assignments_schedule ON public.fs_pic_assignments USING btree (schedule_id);
CREATE INDEX idx_fs_pic_assignments_created_by ON public.fs_pic_assignments USING btree (created_by);

-- ── fs_execution_instances ───────────────────────────────────────────────
-- A materialized single occurrence. config_snapshot freezes the rules that
-- applied at generation time so later fs_project_settings/fs_locations
-- changes never rewrite history (instruction §19/§86).
CREATE TABLE public.fs_execution_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  location_id uuid NOT NULL,
  execution_point_id uuid,
  schedule_id uuid,
  -- Snapshotted PIC at generation time (from fs_pic_assignments) — kept even
  -- if the assignment later changes, so historical "who was assigned" never
  -- silently rewrites. Authorization at check-in time is re-derived live
  -- from fs_pic_assignments (005 fs_is_assigned), NOT from this column.
  assigned_pic_user_id uuid,
  instance_date date NOT NULL,
  status text NOT NULL DEFAULT 'NOT_STARTED',
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES public.fs_locations(id) ON DELETE CASCADE,
  FOREIGN KEY (execution_point_id) REFERENCES public.fs_execution_points(id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_id) REFERENCES public.fs_recurring_schedules(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_pic_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT fs_execution_instances_status_check CHECK (status = ANY (ARRAY[
    'NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'WAITING_REVIEW',
    'VERIFIED', 'REVISION_REQUIRED'
  ]))
);

-- Idempotent generation (instruction §8): a re-run of the instance generator
-- never duplicates a (location, execution point, date) row. COALESCE handles
-- execution_point_id IS NULL (location-wide instances), since two NULLs are
-- never equal under a plain unique constraint.
CREATE UNIQUE INDEX idx_fs_execution_instances_unique
  ON public.fs_execution_instances (location_id, COALESCE(execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid), instance_date);
CREATE INDEX idx_fs_execution_instances_pic_date ON public.fs_execution_instances USING btree (assigned_pic_user_id, instance_date);
CREATE INDEX idx_fs_execution_instances_status ON public.fs_execution_instances USING btree (status);
CREATE INDEX idx_fs_execution_instances_project_date ON public.fs_execution_instances USING btree (project_id, instance_date);
CREATE INDEX idx_fs_execution_instances_execution_point ON public.fs_execution_instances USING btree (execution_point_id);
CREATE INDEX idx_fs_execution_instances_schedule ON public.fs_execution_instances USING btree (schedule_id);

-- ── fs_work_sessions ─────────────────────────────────────────────────────
-- Check-in → check-out span. Uniqueness on (execution_instance_id) WHERE
-- status='ACTIVE' stops a duplicate check-in from ever creating two live
-- sessions for the same instance (instruction §57/§88).
CREATE TABLE public.fs_work_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  execution_instance_id uuid NOT NULL,
  pic_user_id uuid NOT NULL,
  check_in_at timestamptz,
  check_out_at timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (execution_instance_id) REFERENCES public.fs_execution_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (pic_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT fs_work_sessions_status_check CHECK (status = ANY (ARRAY['ACTIVE', 'CLOSED']))
);

CREATE UNIQUE INDEX idx_fs_work_sessions_one_active
  ON public.fs_work_sessions (execution_instance_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_fs_work_sessions_pic ON public.fs_work_sessions USING btree (pic_user_id);

-- ── fs_gps_events ────────────────────────────────────────────────────────
-- Every GPS capture attempt (check-in and check-out), successful or not —
-- an audit trail, never client-writable directly (only via the fs_check_in/
-- fs_check_out SECURITY DEFINER functions in 005).
CREATE TABLE public.fs_gps_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  work_session_id uuid,
  execution_instance_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  latitude numeric(9,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  accuracy_m numeric,
  distance_m numeric,
  validation_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (work_session_id) REFERENCES public.fs_work_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (execution_instance_id) REFERENCES public.fs_execution_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT fs_gps_events_event_type_check CHECK (event_type = ANY (ARRAY['CHECK_IN', 'CHECK_OUT'])),
  -- Exact GPS trust-state enum from docs/field-service-architecture.md §6 /
  -- instruction §25.
  CONSTRAINT fs_gps_events_validation_status_check CHECK (validation_status = ANY (ARRAY[
    'VALID', 'LOW_ACCURACY', 'OUTSIDE_RADIUS', 'LOCATION_PERMISSION_DENIED',
    'LOCATION_UNAVAILABLE', 'SUSPICIOUS', 'MOCK_LOCATION_DETECTED',
    'ASSIGNMENT_MISMATCH', 'SCHEDULE_MISMATCH'
  ]))
);

CREATE INDEX idx_fs_gps_events_instance ON public.fs_gps_events USING btree (execution_instance_id);
CREATE INDEX idx_fs_gps_events_user ON public.fs_gps_events USING btree (user_id, created_at DESC);
CREATE INDEX idx_fs_gps_events_validation_status ON public.fs_gps_events USING btree (validation_status);
CREATE INDEX idx_fs_gps_events_work_session ON public.fs_gps_events USING btree (work_session_id);

-- ── fs_evidence ──────────────────────────────────────────────────────────
-- File metadata only — bytes live in the private `fs-evidence` Storage
-- bucket (docs/field-service-architecture.md §10, deviation D-002).
CREATE TABLE public.fs_evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  execution_instance_id uuid NOT NULL,
  work_session_id uuid,
  task_id text,
  bucket text NOT NULL DEFAULT 'fs-evidence',
  path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid NOT NULL,
  validation_status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (execution_instance_id) REFERENCES public.fs_execution_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (work_session_id) REFERENCES public.fs_work_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT fs_evidence_validation_status_check CHECK (validation_status = ANY (ARRAY['PENDING', 'VALID', 'INVALID']))
);

CREATE INDEX idx_fs_evidence_instance ON public.fs_evidence USING btree (execution_instance_id);
CREATE INDEX idx_fs_evidence_uploaded_by ON public.fs_evidence USING btree (uploaded_by);
CREATE INDEX idx_fs_evidence_work_session ON public.fs_evidence USING btree (work_session_id);

-- ── fs_reviews ───────────────────────────────────────────────────────────
-- One row per client decision, append-only (a re-review adds a new row
-- rather than updating) — gives a free audit trail (§11).
CREATE TABLE public.fs_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  execution_instance_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  decision text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (execution_instance_id) REFERENCES public.fs_execution_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT fs_reviews_decision_check CHECK (decision = ANY (ARRAY['VERIFIED', 'REVISION_REQUIRED']))
);

CREATE INDEX idx_fs_reviews_instance ON public.fs_reviews USING btree (execution_instance_id);
CREATE INDEX idx_fs_reviews_reviewer ON public.fs_reviews USING btree (reviewer_id);

-- ── fs_project_settings ──────────────────────────────────────────────────
-- Per-project override of system defaults (§7). One row per project;
-- any NULL column falls back to the system default in app_settings.
CREATE TABLE public.fs_project_settings (
  project_id uuid NOT NULL,
  gps_radius_m integer,
  gps_accuracy_threshold_m integer,
  checkin_required boolean NOT NULL DEFAULT true,
  checkout_required boolean NOT NULL DEFAULT true,
  evidence_required boolean NOT NULL DEFAULT true,
  evidence_min_count integer NOT NULL DEFAULT 1,
  review_required boolean NOT NULL DEFAULT true,
  schedule_exception boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id),
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  CONSTRAINT fs_project_settings_evidence_min_check CHECK (evidence_min_count >= 0)
);
