-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 017
-- (a) Kunci check-out (IN_PROGRESS -> SUBMITTED) di SERVER, bukan cuma di
--     klien: PIC tidak boleh mengirim pekerjaan untuk verifikasi selama masih
--     ada TV aktif di lokasi itu yang checklist-nya belum diisi sama sekali
--     (fs_execution_point_status.status masih NOT_STARTED / belum ada
--     barisnya). Klien (app/teknisi/page.tsx submitCheckOut) sudah dipagari
--     duluan supaya technician tidak perlu menunggu round-trip gagal untuk
--     tahu - tapi satu-satunya penjaga yang benar-benar tidak bisa dilewati
--     lewat manipulasi payload adalah di sini, di fungsi yang memegang satu-
--     satunya jalur UPDATE fs_execution_instances.status (006).
-- (b) fs_reset_checklist_for_revision(): dipanggil PIC setelah instance
--     ditransisikan balik ke IN_PROGRESS saat client minta revisi
--     (REVISION_REQUIRED -> IN_PROGRESS) - mengosongkan checklist per-TV
--     (status + review_status) supaya "kerjaan yang perlu diulang" benar-
--     benar kembali ke NOT_STARTED, bukan diam-diam masih menampilkan
--     centang/approval dari siklus SEBELUM revisi diminta. Foto lama
--     (fs_evidence) SENGAJA tidak dihapus di sini - itu riwayat, dan PIC
--     sendiri yang memutuskan foto mana yang perlu dihapus/diganti lewat
--     TvPointPanel (lihat migrasi berikutnya utk hak PIC hapus foto sebelum
--     approve).
-- ============================================================================

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
    -- Checklist per TV harus selesai dulu (task_Prompt.md §15) - lihat
    -- catatan migrasi di atas kenapa penjagaan ini di sini, bukan cuma klien.
    IF EXISTS (
      SELECT 1 FROM public.fs_execution_points pt
      WHERE pt.location_id = v_instance.location_id AND pt.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM public.fs_execution_point_status ps
          WHERE ps.execution_instance_id = p_instance_id AND ps.execution_point_id = pt.id
            AND ps.status <> 'NOT_STARTED'
        )
    ) THEN
      RAISE EXCEPTION 'Masih ada TV yang belum diisi checklist-nya. Selesaikan checklist per TV dulu sebelum check-out.'
        USING ERRCODE = 'check_violation';
    END IF;
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

-- ── Reset checklist per TV saat siklus revisi baru dimulai ─────────────────
-- Dipanggil klien (app/teknisi/page.tsx mulaiRevisi()) TEPAT setelah
-- fs_status_transition(..., 'IN_PROGRESS') berhasil pada instance yang
-- statusnya REVISION_REQUIRED. current_user di dalam SECURITY DEFINER ini
-- BUKAN anon/authenticated (pola yang sama seperti fungsi fs_* lain di
-- migrasi 005/011) - trg_fs_guard_execution_point_status_columns (015)
-- membaca current_user dan langsung RETURN NEW kalau bukan anon/authenticated,
-- jadi UPDATE di bawah ini boleh menulis KEDUA sisi kolom (milik teknisi
-- ATAUPUN milik provider) sekaligus, sesuatu yang tidak mungkin dilakukan
-- lewat UPDATE biasa dari klien (yang selalu berjalan sebagai anon/
-- authenticated dan kena guard itu).
CREATE OR REPLACE FUNCTION public.fs_reset_checklist_for_revision(p_instance_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_instance record;
  v_user_id uuid := jwt_user_id();
BEGIN
  SELECT * INTO v_instance FROM public.fs_execution_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execution instance tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_instance.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Checklist hanya bisa direset saat instance sedang IN_PROGRESS (status saat ini: %).', v_instance.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
    fs_is_provider()
    OR (v_user_id IS NOT NULL AND fs_is_assigned(v_user_id, v_instance.location_id, v_instance.execution_point_id, v_instance.instance_date))
  ) THEN
    RAISE EXCEPTION 'Anda tidak berhak mereset checklist instance ini.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.fs_execution_point_status
  SET status = 'NOT_STARTED', notes = NULL, marked_by = NULL, marked_at = NULL,
      review_status = 'PENDING', reviewed_by = NULL, reviewed_at = NULL,
      updated_at = now()
  WHERE execution_instance_id = p_instance_id;
END;
$$;
