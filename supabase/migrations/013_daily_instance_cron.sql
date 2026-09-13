-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 013
-- Materialisasi execution instance harian secara PROAKTIF (bukan lagi hanya
-- lazy/on-demand saat technician membuka /teknisi), supaya "tidak pernah
-- check-in" bisa dibedakan dari "memang tidak dijadwalkan" - lihat
-- docs/AUDIT-CONFIGURABILITY-NOTIFICATIONS-2026-09.md (temuan HIGH kedua).
--
-- fs_ensure_today_instance (007/011) SENGAJA mensyaratkan jwt_user_id() =
-- assignment.user_id ("assignment ini bukan milik Anda") - tepat untuk
-- dipanggil PIC sendiri dari klien, tapi tidak bisa dipakai job batch yang
-- berjalan sebagai service_role tanpa identitas PIC mana pun. Fungsi ini
-- adalah versi BATCH-nya: idempotent (index unik fs_execution_instances di
-- 004/011 tetap satu-satunya penjaga sesungguhnya), tanpa pengecekan
-- kepemilikan, dan EXECUTE-nya dicabut dari anon/authenticated - hanya bisa
-- dipanggil lewat service_role key (dipakai app/api/cron/materialize-
-- instances/route.ts), tidak bisa dipanggil sembarangan dari klien.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fs_materialize_daily_instances()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_assignment record;
  v_instance_id uuid;
  v_created integer := 0;
BEGIN
  FOR v_assignment IN
    SELECT * FROM public.fs_pic_assignments
    WHERE active
      AND effective_date <= current_date
      AND (end_date IS NULL OR end_date >= current_date)
  LOOP
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
         v_assignment.schedule_id, v_assignment.user_id, v_assignment.content_id, current_date, 'NOT_STARTED');
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.fs_materialize_daily_instances() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fs_materialize_daily_instances() FROM anon, authenticated;
