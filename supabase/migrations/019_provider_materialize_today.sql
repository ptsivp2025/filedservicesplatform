-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 019
-- fs_ensure_today_instance (007/011) HANYA bisa dipanggil oleh teknisi untuk
-- assignment MILIKNYA SENDIRI - admin/provider yang baru saja membuat
-- assignment (Assign PIC baru) tidak bisa memicu materialisasi instance
-- hari ini secara langsung, jadi Execution/Dashboard tetap kosong sampai
-- (a) cron tengah malam berikutnya (013), atau (b) teknisinya sendiri
-- membuka /teknisi - padahal lokasi & PIC sudah di-mapping hari itu juga.
-- Dilaporkan sebagai bug: "gambar 1 kosong padahal sudah ada mapping
-- lokasi dan lain-lain walau PIC belum mulai".
--
-- Fix: perlonggar pengecekan pemilik supaya provider (fs_is_provider() -
-- Admin/Supervisor, 006) BOLEH memicunya untuk assignment siapa pun,
-- persis setelah membuatnya - sisa logika (idempotent, snapshot content_id,
-- window efektif) tidak berubah sama sekali dari 011.
-- ============================================================================

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

  IF v_assignment.user_id <> v_user_id AND NOT fs_is_provider() THEN
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
