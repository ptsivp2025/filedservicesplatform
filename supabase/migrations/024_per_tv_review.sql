-- ============================================================================
-- Operational Control Platform — Migration 024
-- Review PER TV + izin reviewer atas kolom review.
--
-- KENAPA ADA: sebelum ini keputusan client hanya ada di level instance (satu
-- gedung, satu hari). Akibatnya "TV-021 kontennya salah" memaksa SELURUH
-- gedung berisi 20+ TV dikerjakan ulang - mahal di lapangan, dan membuat
-- angka "selesai" tidak jujur karena 19 TV yang benar ikut dibatalkan.
--
-- Sekaligus memperbaiki ketimpangan izin: guard kolom di 015 hanya mengakui
-- provider sebagai pihak yang boleh menulis kolom review, sementara pihak
-- yang SEHARUSNYA memutuskan - client reviewer - justru terkunci.
--
-- Jalankan SETELAH 023.
-- ============================================================================

-- Pembagian kolom: sisi PENINJAU (provider/client reviewer) memegang kolom
-- review; sisi PELAKSANA (PIC) memegang kolom pengerjaan. Masing-masing
-- dibekukan dari kolom milik pihak lain - pola yang sama dengan
-- fs_guard_daily_report_columns (011).
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

  IF fs_is_provider() OR fs_is_client_reviewer() THEN
    NEW.status         := OLD.status;
    NEW.notes          := OLD.notes;
    NEW.marked_by      := OLD.marked_by;
    NEW.marked_at      := OLD.marked_at;
    NEW.failure_reason := OLD.failure_reason;
    NEW.failure_detail := OLD.failure_detail;
  ELSE
    NEW.review_status := OLD.review_status;
    NEW.reviewed_by   := OLD.reviewed_by;
    NEW.reviewed_at   := OLD.reviewed_at;
    NEW.review_notes  := OLD.review_notes;
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS fs_execution_point_status_update ON public.fs_execution_point_status;
CREATE POLICY fs_execution_point_status_update ON public.fs_execution_point_status
  FOR UPDATE TO anon, authenticated
  USING (
    fs_is_provider()
    OR fs_is_client_reviewer()
    OR EXISTS (
      SELECT 1 FROM public.fs_execution_instances i
      WHERE i.id = fs_execution_point_status.execution_instance_id
        AND fs_is_assigned(jwt_user_id(), i.location_id, i.execution_point_id, i.instance_date)
    )
  )
  WITH CHECK (
    fs_is_provider()
    OR fs_is_client_reviewer()
    OR EXISTS (
      SELECT 1 FROM public.fs_execution_instances i
      WHERE i.id = fs_execution_point_status.execution_instance_id
        AND fs_is_assigned(jwt_user_id(), i.location_id, i.execution_point_id, i.instance_date)
    )
  );

-- Satu keputusan review = satu panggilan yang menulis verdict + jejak siapa/
-- kapan + (kalau ditolak) status TV kembali jadi pekerjaan. Lewat fungsi,
-- bukan UPDATE langsung, supaya tidak mungkin tersimpan setengah jalan.
CREATE OR REPLACE FUNCTION public.fs_review_tv(
  p_instance_id uuid,
  p_execution_point_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := jwt_user_id();
BEGIN
  IF NOT (fs_is_client_reviewer() OR fs_is_provider()) THEN
    RAISE EXCEPTION 'Anda tidak berhak memberi keputusan review.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_decision NOT IN ('APPROVED', 'REVISION') THEN
    RAISE EXCEPTION 'Keputusan harus APPROVED atau REVISION.' USING ERRCODE = 'check_violation';
  END IF;

  -- Revisi tanpa alasan tidak memberi tahu PIC apa yang harus diperbaiki.
  IF p_decision = 'REVISION' AND COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'Permintaan revisi wajib menyertakan alasan.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.fs_execution_point_status
    (execution_instance_id, execution_point_id, status, review_status, reviewed_by, reviewed_at, review_notes)
  VALUES
    (p_instance_id, p_execution_point_id,
     CASE WHEN p_decision = 'REVISION' THEN 'REVISION_REQUIRED' ELSE 'COMPLETED' END,
     p_decision, v_user_id, now(), p_notes)
  ON CONFLICT (execution_instance_id, execution_point_id) DO UPDATE SET
    review_status = EXCLUDED.review_status,
    reviewed_by   = EXCLUDED.reviewed_by,
    reviewed_at   = EXCLUDED.reviewed_at,
    review_notes  = EXCLUDED.review_notes,
    -- Disetujui TIDAK menimpa status pengerjaan: 'FAILED' yang disetujui
    -- sebagai kondisi yang diterima tetap FAILED, bukan berubah jadi selesai.
    status = CASE WHEN EXCLUDED.review_status = 'REVISION'
                  THEN 'REVISION_REQUIRED'
                  ELSE public.fs_execution_point_status.status END,
    updated_at = now();

  RETURN jsonb_build_object('execution_point_id', p_execution_point_id, 'review_status', p_decision);
END;
$$;

-- Persetujuan massal satu gedung. Yang gagal/belum dikerjakan SENGAJA tidak
-- ikut - itu justru yang harus dilihat reviewer satu per satu.
CREATE OR REPLACE FUNCTION public.fs_review_building(
  p_cycle_id uuid,
  p_location_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := jwt_user_id();
  v_jumlah integer := 0;
BEGIN
  IF NOT (fs_is_client_reviewer() OR fs_is_provider()) THEN
    RAISE EXCEPTION 'Anda tidak berhak memberi keputusan review.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH sasaran AS (
    SELECT t.instance_id, t.execution_point_id
    FROM public.fs_cycle_tv_tasks t
    WHERE t.cycle_id = p_cycle_id
      AND t.location_id = p_location_id
      AND t.tv_status = 'COMPLETED'
      AND t.review_status <> 'APPROVED'
  ), tulis AS (
    INSERT INTO public.fs_execution_point_status
      (execution_instance_id, execution_point_id, status, review_status, reviewed_by, reviewed_at)
    SELECT s.instance_id, s.execution_point_id, 'COMPLETED', 'APPROVED', v_user_id, now()
    FROM sasaran s
    ON CONFLICT (execution_instance_id, execution_point_id) DO UPDATE SET
      review_status = 'APPROVED', reviewed_by = v_user_id, reviewed_at = now(),
      review_notes = NULL, updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_jumlah FROM tulis;

  RETURN jsonb_build_object('approved', v_jumlah);
END;
$$;
