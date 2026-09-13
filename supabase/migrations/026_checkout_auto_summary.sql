-- ============================================================================
-- Operational Control Platform — Migration 026
-- Check-out dengan RINGKASAN OTOMATIS + persetujuan admin bila tidak tuntas.
--
-- MASALAH YANG DIPERBAIKI: form check-out meminta teknisi MENGETIK SENDIRI
-- "Total Display" dan "Display Selesai". Angka yang membuktikan pekerjaan
-- seseorang tidak boleh berasal dari orang yang sama - siapa pun bisa
-- mengetik 10/10 tanpa menyentuh satu TV pun, dan seluruh laporan ke client
-- kehilangan nilainya. Angka itu sekarang DIHITUNG SERVER dari checklist
-- per-TV yang benar-benar tercatat (fs_execution_point_status), dan tidak
-- ada satu pun parameter di fungsi ini yang bisa dipakai klien memaksanya.
--
-- YANG BOLEH DIISI MANUAL hanyalah ALASAN, dan hanya ketika memang ada TV
-- yang tidak selesai: "10 TV, 9 selesai, 1 TV mati menunggu perbaikan".
-- Alasan itulah yang direview admin - disetujui atau ditolak. Pembagiannya
-- disengaja: angka bisa dihitung mesin, PENYEBAB tidak bisa.
--
-- Jalankan SETELAH 025.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fs_submit_checkout(
  p_instance_id uuid,
  p_catatan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := jwt_user_id();
  v_inst record;
  v_total integer;
  v_selesai integer;
  v_gagal integer;
  v_belum integer;
  v_status_laporan text;
BEGIN
  SELECT * INTO v_inst FROM public.fs_execution_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pekerjaan tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_user_id IS NULL
     OR NOT fs_is_assigned(v_user_id, v_inst.location_id, v_inst.execution_point_id, v_inst.instance_date) THEN
    RAISE EXCEPTION 'Anda tidak ditugaskan pada pekerjaan ini.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Dihitung dari kenyataan, bukan dari input. Cakupannya persis sama dengan
  -- definisi "tugas TV" di view fs_cycle_tv_tasks (022).
  SELECT
    count(*),
    count(*) FILTER (WHERE COALESCE(ps.status, 'NOT_STARTED') = 'COMPLETED'),
    count(*) FILTER (WHERE COALESCE(ps.status, 'NOT_STARTED') IN ('FAILED', 'EXCEPTION')),
    count(*) FILTER (WHERE COALESCE(ps.status, 'NOT_STARTED') IN ('NOT_STARTED', 'IN_PROGRESS'))
  INTO v_total, v_selesai, v_gagal, v_belum
  FROM public.fs_execution_points pt
  LEFT JOIN public.fs_execution_point_status ps
    ON ps.execution_instance_id = p_instance_id AND ps.execution_point_id = pt.id
  WHERE pt.location_id = v_inst.location_id
    AND pt.status = 'active'
    AND (v_inst.execution_point_id IS NULL OR pt.id = v_inst.execution_point_id);

  IF v_selesai < v_total AND COALESCE(btrim(p_catatan), '') = '' THEN
    RAISE EXCEPTION 'Ada % dari % TV yang tidak selesai. Tulis alasannya dulu - laporan ini akan direview admin.', (v_total - v_selesai), v_total
      USING ERRCODE = 'check_violation';
  END IF;

  -- Tuntas -> beres. Tidak tuntas -> menunggu keputusan admin, dan TIDAK
  -- boleh mengaku selesai sebelum keputusan itu ada.
  v_status_laporan := CASE WHEN v_selesai < v_total THEN 'SUBMITTED' ELSE 'REVIEWED' END;

  INSERT INTO public.fs_daily_reports (
    execution_instance_id, technician_id, project_id, location_id, content_id,
    content_name_snapshot, content_version_snapshot,
    content_valid_from_snapshot, content_valid_until_snapshot,
    deployment_date, displays_total, displays_completed, notes,
    status, submitted_at, rejection_reason
  )
  SELECT
    p_instance_id, v_user_id, v_inst.project_id, v_inst.location_id, v_inst.content_id,
    c.name, c.version, c.valid_from, c.valid_until,
    v_inst.instance_date, v_total, v_selesai, NULLIF(btrim(p_catatan), ''),
    v_status_laporan, now(), NULL
  FROM (SELECT 1) x
  LEFT JOIN public.fs_content c ON c.id = v_inst.content_id
  ON CONFLICT (execution_instance_id) DO UPDATE SET
    displays_total     = EXCLUDED.displays_total,
    displays_completed = EXCLUDED.displays_completed,
    notes              = EXCLUDED.notes,
    status             = EXCLUDED.status,
    submitted_at       = EXCLUDED.submitted_at,
    rejection_reason   = NULL,
    reviewed_at        = NULL,
    reviewed_by        = NULL,
    updated_at         = now();

  RETURN jsonb_build_object(
    'total_tv', v_total, 'selesai_tv', v_selesai,
    'gagal_tv', v_gagal, 'belum_tv', v_belum,
    'perlu_persetujuan', v_selesai < v_total
  );
END;
$$;

-- Ringkasan yang DIBACA layar check-out sebelum teknisi menekan Submit -
-- supaya ia melihat angka yang sama persis dengan yang akan tersimpan, dan
-- tahu lebih dulu bahwa alasannya wajib diisi.
CREATE OR REPLACE FUNCTION public.fs_checkout_summary(p_instance_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'total_tv',   count(*),
    'selesai_tv', count(*) FILTER (WHERE COALESCE(ps.status, 'NOT_STARTED') = 'COMPLETED'),
    'gagal_tv',   count(*) FILTER (WHERE COALESCE(ps.status, 'NOT_STARTED') IN ('FAILED', 'EXCEPTION')),
    'belum_tv',   count(*) FILTER (WHERE COALESCE(ps.status, 'NOT_STARTED') IN ('NOT_STARTED', 'IN_PROGRESS')),
    'dilewati_tv', count(*) FILTER (WHERE COALESCE(ps.status, 'NOT_STARTED') = 'SKIPPED')
  )
  FROM public.fs_execution_points pt
  JOIN public.fs_execution_instances i ON i.id = p_instance_id
  LEFT JOIN public.fs_execution_point_status ps
    ON ps.execution_instance_id = p_instance_id AND ps.execution_point_id = pt.id
  WHERE pt.location_id = i.location_id
    AND pt.status = 'active'
    AND (i.execution_point_id IS NULL OR pt.id = i.execution_point_id);
$$;

-- Antrean admin: check-out tidak tuntas yang menunggu keputusan.
CREATE OR REPLACE FUNCTION public.fs_pending_checkouts(p_cycle_id uuid DEFAULT NULL)
RETURNS TABLE (
  report_id uuid, instance_id uuid,
  location_name text, area_name text, pic_name text,
  deployment_date date, displays_total integer, displays_completed integer,
  notes text, submitted_at timestamptz
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    r.id, r.execution_instance_id,
    l.name, a.name, u.full_name,
    r.deployment_date, r.displays_total, r.displays_completed,
    r.notes, r.submitted_at
  FROM public.fs_daily_reports r
  JOIN public.fs_execution_instances i ON i.id = r.execution_instance_id
  JOIN public.fs_locations l ON l.id = r.location_id
  JOIN public.fs_areas a     ON a.id = l.area_id
  LEFT JOIN public.users u   ON u.id = r.technician_id
  WHERE r.status = 'SUBMITTED'
    AND r.displays_completed < r.displays_total
    AND (p_cycle_id IS NULL OR i.cycle_id = p_cycle_id)
  ORDER BY r.submitted_at NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.fs_review_checkout(
  p_report_id uuid,
  p_decision text,
  p_alasan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := jwt_user_id();
BEGIN
  IF NOT fs_is_provider() THEN
    RAISE EXCEPTION 'Hanya provider admin/supervisor yang boleh menyetujui laporan check-out.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Keputusan harus APPROVED atau REJECTED.' USING ERRCODE = 'check_violation';
  END IF;

  -- Menolak tanpa memberi tahu apa yang kurang membuat teknisi menebak-nebak
  -- pekerjaan apa yang harus diulang.
  IF p_decision = 'REJECTED' AND COALESCE(btrim(p_alasan), '') = '' THEN
    RAISE EXCEPTION 'Penolakan wajib menyertakan alasan.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.fs_daily_reports
    SET status = CASE WHEN p_decision = 'APPROVED' THEN 'APPROVED' ELSE 'REJECTED' END,
        rejection_reason = CASE WHEN p_decision = 'REJECTED' THEN btrim(p_alasan) ELSE NULL END,
        reviewed_by = v_user_id, reviewed_at = now(), updated_at = now()
    WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Laporan tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object('id', p_report_id, 'status', p_decision);
END;
$$;
