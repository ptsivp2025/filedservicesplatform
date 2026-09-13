-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 015
-- Checklist PER EXECUTION POINT (per-TV), bukan lagi cuma per lokasi -
-- gap terbesar dari task_Prompt.md §15 ("Do NOT make completion only at
-- LOCATION level... the system must know exactly which TV has been
-- executed"). Technician menandai tiap TV + foto buktinya sendiri-sendiri;
-- provider (yang review kerjaan) bisa Approve per TV dan menghapus foto dari
-- storage supaya tidak menumpuk (biaya cloud storage).
-- ============================================================================

-- fs_evidence sekarang bisa menunjuk ke TV tertentu, bukan cuma instance.
-- Nullable - foto check-in/check-out lama (bukan per-TV) tetap sah tanpa ini.
ALTER TABLE public.fs_evidence
  ADD COLUMN IF NOT EXISTS execution_point_id uuid
  REFERENCES public.fs_execution_points(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fs_evidence_execution_point ON public.fs_evidence (execution_point_id);

-- Insert evidence diperketat: kalau execution_point_id diisi, titik itu harus
-- benar-benar berada di lokasi yang sama dengan execution instance-nya -
-- pertahanan tambahan supaya foto TV tidak bisa "dititipkan" ke titik di
-- lokasi lain lewat manipulasi payload klien.
DROP POLICY IF EXISTS fs_evidence_insert ON public.fs_evidence;
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
    AND (
      execution_point_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.fs_execution_points pt
        JOIN public.fs_execution_instances i ON i.id = fs_evidence.execution_instance_id
        WHERE pt.id = fs_evidence.execution_point_id AND pt.location_id = i.location_id
      )
    )
  );

-- Storage: fs_evidence_delete (006) sudah mengizinkan provider menghapus
-- BARIS metadatanya, tapi tidak ada policy DELETE di storage.objects sama
-- sekali sebelum ini - filenya sendiri tidak akan pernah benar-benar
-- terhapus dari Storage, cuma metadatanya. Ini yang membuat "Hapus Foto"
-- (supaya tidak memenuhi storage cloud) baru benar-benar berarti.
CREATE POLICY fs_evidence_storage_delete ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'fs-evidence' AND fs_is_provider());

-- ── fs_execution_point_status (checklist per TV) ────────────────────────
CREATE TABLE public.fs_execution_point_status (
  execution_instance_id uuid NOT NULL,
  execution_point_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'NOT_STARTED',
  notes text,
  marked_by uuid,
  marked_at timestamptz,
  -- Keputusan provider (yang review kerjaan) per TV - terpisah dari status
  -- teknisi di atas, supaya "sudah ditandai selesai teknisi" dan "sudah
  -- disetujui provider" tidak pernah tertukar jadi satu kolom.
  review_status text NOT NULL DEFAULT 'PENDING',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_instance_id, execution_point_id),
  FOREIGN KEY (execution_instance_id) REFERENCES public.fs_execution_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (execution_point_id) REFERENCES public.fs_execution_points(id) ON DELETE CASCADE,
  FOREIGN KEY (marked_by) REFERENCES public.users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT fs_execution_point_status_check CHECK (status = ANY (ARRAY['NOT_STARTED', 'COMPLETED', 'FAILED', 'SKIPPED', 'EXCEPTION'])),
  CONSTRAINT fs_execution_point_review_check CHECK (review_status = ANY (ARRAY['PENDING', 'APPROVED']))
);

CREATE INDEX idx_fs_execution_point_status_point ON public.fs_execution_point_status (execution_point_id);

ALTER TABLE public.fs_execution_point_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY fs_execution_point_status_select ON public.fs_execution_point_status
  FOR SELECT TO anon, authenticated
  USING (
    fs_is_provider() OR fs_is_client_viewer()
    OR EXISTS (
      SELECT 1 FROM public.fs_execution_instances i
      WHERE i.id = fs_execution_point_status.execution_instance_id
        AND fs_is_assigned(jwt_user_id(), i.location_id, i.execution_point_id, i.instance_date)
    )
  );

-- Insert/update: teknisi yang ditugaskan ke instance ini (lewat lokasi -
-- fs_is_assigned tidak butuh execution_point_id yang sama persis, assignment
-- level lokasi tetap berlaku untuk semua TV di lokasi itu), ATAU provider.
--
-- review_status/reviewed_by/reviewed_at HARUS tetap default (PENDING/null)
-- kalau yang insert BUKAN provider - guard trigger di bawah cuma menjaga
-- UPDATE, baris baru lewat INSERT tidak pernah melewatinya, jadi tanpa baris
-- WITH CHECK ini seorang teknisi bisa insert baris yang langsung mengaku
-- APPROVED sendiri sejak lahir.
CREATE POLICY fs_execution_point_status_insert ON public.fs_execution_point_status
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    fs_is_provider()
    OR (
      review_status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.fs_execution_instances i
        WHERE i.id = fs_execution_point_status.execution_instance_id
          AND i.status = 'IN_PROGRESS'
          AND fs_is_assigned(jwt_user_id(), i.location_id, i.execution_point_id, i.instance_date)
      )
    )
  );

CREATE POLICY fs_execution_point_status_update ON public.fs_execution_point_status
  FOR UPDATE TO anon, authenticated
  USING (
    fs_is_provider()
    OR EXISTS (
      SELECT 1 FROM public.fs_execution_instances i
      WHERE i.id = fs_execution_point_status.execution_instance_id
        AND fs_is_assigned(jwt_user_id(), i.location_id, i.execution_point_id, i.instance_date)
    )
  )
  WITH CHECK (
    fs_is_provider()
    OR EXISTS (
      SELECT 1 FROM public.fs_execution_instances i
      WHERE i.id = fs_execution_point_status.execution_instance_id
        AND fs_is_assigned(jwt_user_id(), i.location_id, i.execution_point_id, i.instance_date)
    )
  );

-- Guard: kolom review_status/reviewed_by/reviewed_at HANYA provider; kolom
-- status/notes/marked_by/marked_at HANYA teknisi (bukan provider) - persis
-- pola fs_guard_daily_report_columns (011): dua sisi yang menulis baris yang
-- sama, masing-masing dikunci ke kolom miliknya sendiri.
CREATE OR REPLACE FUNCTION public.fs_guard_execution_point_status_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  NEW.execution_instance_id := OLD.execution_instance_id;
  NEW.execution_point_id    := OLD.execution_point_id;
  NEW.created_at            := OLD.created_at;

  IF fs_is_provider() THEN
    NEW.status     := OLD.status;
    NEW.notes      := OLD.notes;
    NEW.marked_by  := OLD.marked_by;
    NEW.marked_at  := OLD.marked_at;
  ELSE
    NEW.review_status := OLD.review_status;
    NEW.reviewed_by   := OLD.reviewed_by;
    NEW.reviewed_at   := OLD.reviewed_at;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fs_guard_execution_point_status_columns
  BEFORE UPDATE ON public.fs_execution_point_status
  FOR EACH ROW EXECUTE FUNCTION public.fs_guard_execution_point_status_columns();
