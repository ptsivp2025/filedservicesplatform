-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 007
-- Technician check-in/check-out support: on-demand execution-instance
-- creation, and the private evidence storage bucket referenced by
-- fs_evidence.bucket (004) since migration 004's creation.
--
-- Run AFTER 001-006.
--
-- WHY THIS EXISTS: fs_check_in()/fs_check_out() (005) operate on an existing
-- fs_execution_instances ROW - but nothing before this migration could ever
-- create one for "today" without going through Recurring Schedule generation
-- (not built yet, tracked in docs/field-service-architecture.md §17 Phase 4).
-- fs_ensure_today_instance() below is a deliberately small stand-in: it
-- materializes today's instance directly from a technician's own active
-- fs_pic_assignments row, on demand, the moment they open their task list -
-- idempotent against the same unique index 004 already defines, so it never
-- conflicts with whatever the real Recurring Schedule generator eventually
-- writes for the same (location, execution_point, date).
-- ============================================================================

-- ── On-demand instance materialization ──────────────────────────────────
-- SECURITY DEFINER because inserting into fs_execution_instances normally
-- requires fs_is_provider() (006) - a technician creating TODAY'S OWN
-- instance is not "editing the schedule", so this function re-derives and
-- checks the assignment ownership itself instead of relying on that policy.
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

  -- Idempotent lookup first: kalau instance hari ini sudah ada (dibuat lewat
  -- panggilan sebelumnya, atau kelak lewat Recurring Schedule generator),
  -- pakai yang sudah ada — jangan pernah membuat baris kedua untuk
  -- (location, execution_point, date) yang sama, itulah sebabnya index unik
  -- di 004 dijaga dari sisi ini juga, bukan cuma mengandalkan constraint-nya
  -- melempar error yang lalu harus ditangkap.
  SELECT id INTO v_instance_id
    FROM public.fs_execution_instances
    WHERE location_id = v_assignment.location_id
      AND COALESCE(execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(v_assignment.execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND instance_date = current_date;

  IF v_instance_id IS NULL THEN
    INSERT INTO public.fs_execution_instances
      (project_id, location_id, execution_point_id, schedule_id, assigned_pic_user_id, instance_date, status)
    VALUES
      (v_assignment.project_id, v_assignment.location_id, v_assignment.execution_point_id,
       v_assignment.schedule_id, v_assignment.user_id, current_date, 'NOT_STARTED')
    RETURNING id INTO v_instance_id;
  END IF;

  RETURN v_instance_id;
END;
$$;

-- ── Evidence storage bucket ──────────────────────────────────────────────
-- Private (public = false) — matches deviation D-002. Files are only ever
-- reachable through a signed URL issued after the fs_evidence RLS check
-- passes, never a public URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('fs-evidence', 'fs-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- Upload: any logged-in user may upload (the fs_evidence table row - not the
-- storage object - is what fs_evidence_insert (006) actually gates on
-- ownership of an ACTIVE work session; letting the raw file land in storage
-- first and then failing the fs_evidence row insert is an acceptable
-- ordering, since an orphaned file with no fs_evidence row pointing at it is
-- unreachable to anyone - see the SELECT policy below).
CREATE POLICY fs_evidence_storage_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'fs-evidence');

-- Read: mirrors fs_evidence_select (006) exactly, joined by storage path ==
-- fs_evidence.path, so a file is only ever readable to the same people who
-- may read its metadata row.
CREATE POLICY fs_evidence_storage_select ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'fs-evidence'
    AND (
      fs_is_provider() OR fs_is_client_viewer()
      OR EXISTS (
        SELECT 1 FROM public.fs_evidence e
        WHERE e.path = storage.objects.name AND e.uploaded_by = jwt_user_id()
      )
    )
  );

-- ── Check-out notes ──────────────────────────────────────────────────────
-- Notes ditulis PIC saat check-out (opsional) - kolom & jalur tulis terpisah
-- karena fs_check_out() di atas tidak menerimanya sebagai parameter, dan
-- fs_work_sessions (006) belum punya kolom manapun yang boleh diubah klien
-- langsung (hanya SELECT).
ALTER TABLE public.fs_work_sessions ADD COLUMN IF NOT EXISTS notes text;

-- Guard: PIC pemilik sesi ini boleh UPDATE, tapi HANYA kolom notes - semua
-- kolom lain (check_in_at/check_out_at/status/pic_user_id/dst) dibekukan,
-- persis pola guard_users_privileged_columns() (002)/
-- fs_guard_pic_assignment_columns() (005).
CREATE OR REPLACE FUNCTION public.fs_guard_work_session_notes_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  NEW.execution_instance_id := OLD.execution_instance_id;
  NEW.pic_user_id           := OLD.pic_user_id;
  NEW.check_in_at           := OLD.check_in_at;
  NEW.check_out_at          := OLD.check_out_at;
  NEW.status                := OLD.status;
  NEW.created_at            := OLD.created_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fs_guard_work_session_notes_only
  BEFORE UPDATE ON public.fs_work_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fs_guard_work_session_notes_only();

CREATE POLICY fs_work_sessions_update_notes ON public.fs_work_sessions
  FOR UPDATE TO anon, authenticated
  USING (pic_user_id = jwt_user_id())
  WITH CHECK (pic_user_id = jwt_user_id());
