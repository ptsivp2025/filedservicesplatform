-- ============================================================================
-- Operational Control Platform — Migration 028
-- Jejak audit SEMANTIK + notifikasi in-app, keduanya ditulis DARI DATABASE.
--
-- KENAPA DI DATABASE, BUKAN DI REACT: pencatatan audit yang dipanggil dari
-- komponen bisa hilang dengan sepuluh cara - komponen diganti, pemanggilan
-- lupa disalin, permintaan gagal di tengah jalan, atau seseorang memanggil
-- RPC-nya langsung tanpa lewat UI sama sekali. Ditulis di dalam fungsi
-- lifecycle yang sama dengan perubahannya, jejaknya mustahil terlewat:
-- kalau perubahannya terjadi, catatannya pasti ada.
--
-- fs_audit_log (014) sudah menyimpan perubahan BARIS (INSERT/UPDATE/DELETE
-- dari trigger). Yang ditambahkan di sini adalah peristiwa BISNIS -
-- "Menutup siklus", "Menyetujui pembersihan data" - lengkap dengan ringkasan
-- yang bisa dibaca manusia tanpa membandingkan dua JSON.
--
-- CATATAN PENTING: migrasi ini juga MENULIS ULANG fungsi lifecycle dari
-- migrasi 023/024/026 (fs_cycle_transition, fs_review_tv, fs_review_checkout,
-- fs_request_clear, fs_generate_cycle_scope, fs_submit_checkout,
-- fs_finalize_clear) untuk menyisipkan pemanggilan fs_catat()/fs_notif().
-- Isinya identik dengan versi sebelumnya kecuali sisipan itu.
--
-- Jalankan SETELAH 027.
-- ============================================================================

ALTER TABLE public.fs_audit_log
  ADD COLUMN IF NOT EXISTS ringkasan text,
  ADD COLUMN IF NOT EXISTS konteks jsonb;

-- Aksi tidak lagi terbatas INSERT/UPDATE/DELETE - peristiwa bisnis punya
-- namanya sendiri supaya bisa disaring ("tampilkan semua penghapusan data").
ALTER TABLE public.fs_audit_log DROP CONSTRAINT IF EXISTS fs_audit_log_action_check;

CREATE INDEX IF NOT EXISTS idx_fs_audit_log_waktu ON public.fs_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fs_audit_log_action ON public.fs_audit_log (action);

-- ── Pencatat peristiwa ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fs_catat(
  p_aksi text, p_tabel text, p_row uuid, p_ringkasan text, p_konteks jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.fs_audit_log (table_name, row_id, action, changed_by, ringkasan, konteks)
  VALUES (p_tabel, p_row, p_aksi, jwt_user_id(), p_ringkasan, p_konteks);
EXCEPTION WHEN OTHERS THEN
  -- Gagal mencatat TIDAK BOLEH membatalkan pekerjaan yang sedang berjalan.
  -- Audit itu penting, tapi bukan alasan seorang PIC di lapangan kehilangan
  -- hasil kerjanya.
  NULL;
END;
$$;

-- ── Notifikasi in-app ───────────────────────────────────────────────────
-- notifications.user_id bertipe TEXT (peninggalan platform sebelumnya yang
-- memakai username); uuid disimpan sebagai teks apa adanya.
CREATE OR REPLACE FUNCTION public.fs_notif(
  p_user_id uuid, p_type text, p_judul text,
  p_body text DEFAULT NULL, p_url text DEFAULT NULL, p_ref text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, type, title, body, action_url, ref_id, is_read, created_by)
  VALUES (p_user_id::text, p_type, p_judul, p_body, p_url, p_ref, false,
          (SELECT full_name FROM public.users WHERE id = jwt_user_id()));
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

/** Kirim ke SEMUA pemegang peran tertentu - untuk kabar yang tujuannya
 *  jabatan, bukan orang ("ada check-out menunggu persetujuan"). */
CREATE OR REPLACE FUNCTION public.fs_notif_peran(
  p_peran text[], p_type text, p_judul text,
  p_body text DEFAULT NULL, p_url text DEFAULT NULL, p_ref text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, action_url, ref_id, is_read, created_by)
  SELECT u.id::text, p_type, p_judul, p_body, p_url, p_ref, false,
         (SELECT full_name FROM public.users WHERE id = jwt_user_id())
  FROM public.users u
  WHERE u.fs_role = ANY (p_peran)
     OR (('PROVIDER_ADMIN' = ANY (p_peran)) AND lower(u.role) IN ('admin', 'superadmin'));
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- ── Pembacaan jejak audit — HANYA Provider Admin ───────────────────────
-- Sengaja lewat fungsi yang memeriksa perannya sendiri, bukan policy SELECT
-- longgar: daftar ini memuat siapa melakukan apa pada SELURUH platform, dan
-- menyembunyikan menunya saja bukan pengaman.
CREATE OR REPLACE FUNCTION public.fs_audit_feed(
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0,
  p_cari text DEFAULT NULL, p_aksi text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, waktu timestamptz, aksi text, tabel text, row_id uuid,
  pelaku text, peran text, ringkasan text, konteks jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT fs_is_provider_admin() THEN
    RAISE EXCEPTION 'Jejak audit hanya bisa dilihat Provider Admin.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT a.id, a.created_at, a.action, a.table_name, a.row_id,
           COALESCE(u.full_name, 'Sistem'), COALESCE(u.fs_role, upper(u.role), '—'),
           a.ringkasan, a.konteks
    FROM public.fs_audit_log a
    LEFT JOIN public.users u ON u.id = a.changed_by
    WHERE (p_aksi IS NULL OR a.action = p_aksi)
      AND (
        p_cari IS NULL OR btrim(p_cari) = '' OR
        a.ringkasan ILIKE '%' || p_cari || '%' OR
        a.table_name ILIKE '%' || p_cari || '%' OR
        a.action ILIKE '%' || p_cari || '%' OR
        u.full_name ILIKE '%' || p_cari || '%'
      )
    ORDER BY a.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500)) OFFSET GREATEST(0, p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_audit_ringkasan()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_hasil jsonb;
BEGIN
  IF NOT fs_is_provider_admin() THEN
    RAISE EXCEPTION 'Jejak audit hanya bisa dilihat Provider Admin.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'total',        count(*),
    'hari_ini',     count(*) FILTER (WHERE created_at >= date_trunc('day', now())),
    'minggu_ini',   count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
    'pelaku_aktif', count(DISTINCT changed_by) FILTER (WHERE created_at >= now() - interval '7 days'),
    'destruktif',   count(*) FILTER (WHERE action IN ('DELETE', 'CLEAR_APPROVE', 'CLEAR_REQUEST')),
    'per_aksi', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'jumlah')::int DESC)
      FROM (
        SELECT jsonb_build_object('aksi', action, 'jumlah', count(*)) AS x
        FROM public.fs_audit_log
        WHERE created_at >= now() - interval '30 days'
        GROUP BY action
      ) y
    ), '[]'::jsonb)
  ) INTO v_hasil
  FROM public.fs_audit_log;

  RETURN v_hasil;
END;
$$;

-- ============================================================================
-- Sisipan audit + notifikasi pada fungsi lifecycle.
--
-- Fungsi-fungsi ini DITULIS ULANG UTUH di bawah (bukan sekadar dicatat di
-- komentar): migrasi 023/024/026 membuat versi TANPA audit, jadi instalasi
-- baru yang menjalankan 001-028 berurutan harus berakhir dengan versi yang
-- BERISI audit. Isinya identik dengan versi sebelumnya kecuali pemanggilan
-- fs_catat()/fs_notif().
-- ============================================================================

-- fs_cycle_transition: catat tiap perpindahan + kabari pihak yang menunggu.
CREATE OR REPLACE FUNCTION public.fs_cycle_transition(
  p_cycle_id uuid, p_new_status text, p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cycle record; v_user_id uuid := jwt_user_id();
  v_allowed boolean := false; v_belum integer;
BEGIN
  SELECT * INTO v_cycle FROM public.fs_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_cycle.status = 'PLANNED' AND p_new_status = 'ACTIVE' AND fs_is_provider() THEN
    v_allowed := true;
  ELSIF v_cycle.status = 'ACTIVE' AND p_new_status = 'UNDER_REVIEW' AND fs_is_provider() THEN
    v_allowed := true;
  ELSIF v_cycle.status = 'UNDER_REVIEW' AND p_new_status = 'ACTIVE' AND fs_is_provider() THEN
    v_allowed := true;
  ELSIF v_cycle.status = 'UNDER_REVIEW' AND p_new_status = 'READY_TO_CLOSE'
        AND (fs_is_client_reviewer() OR fs_is_provider_admin()) THEN
    v_allowed := true;
  ELSIF v_cycle.status = 'READY_TO_CLOSE' AND p_new_status = 'CLOSED' AND fs_is_provider_admin() THEN
    v_allowed := true;
  ELSIF v_cycle.status = 'CLEAR_PENDING' AND p_new_status = 'CLOSED' AND fs_is_provider_admin() THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transisi cycle % -> % tidak diizinkan untuk aktor ini.', v_cycle.status, p_new_status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_new_status = 'READY_TO_CLOSE' AND NOT p_force THEN
    SELECT count(*) INTO v_belum FROM public.fs_cycle_tv_tasks
      WHERE cycle_id = p_cycle_id
        AND (tv_status IN ('NOT_STARTED', 'IN_PROGRESS', 'REVISION_REQUIRED') OR review_status = 'REVISION');
    IF v_belum > 0 THEN
      RAISE EXCEPTION 'Masih ada % TV yang belum tuntas (belum dikerjakan atau menunggu revisi). Selesaikan dulu, atau tutup paksa dengan alasan.', v_belum
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.fs_cycles
    SET status = p_new_status,
        closed_by = CASE WHEN p_new_status = 'CLOSED' THEN v_user_id ELSE closed_by END,
        closed_at = CASE WHEN p_new_status = 'CLOSED' THEN now() ELSE closed_at END,
        updated_at = now()
    WHERE id = p_cycle_id;

  PERFORM public.fs_catat('CYCLE_' || p_new_status, 'fs_cycles', p_cycle_id,
    format('Siklus "%s": %s -> %s', v_cycle.name, v_cycle.status, p_new_status),
    jsonb_build_object('dari', v_cycle.status, 'ke', p_new_status, 'paksa', p_force));

  IF p_new_status = 'UNDER_REVIEW' THEN
    PERFORM public.fs_notif_peran(ARRAY['CLIENT_ADMIN','CLIENT_MANAGER','CLIENT_VIEWER'], 'project',
      'Deployment siap direview',
      format('Siklus "%s" sudah dikirim provider dan menunggu keputusan Anda.', v_cycle.name),
      '/field-service?tab=review', p_cycle_id::text);
  ELSIF p_new_status = 'READY_TO_CLOSE' THEN
    PERFORM public.fs_notif_peran(ARRAY['PROVIDER_ADMIN'], 'project',
      'Siklus siap ditutup',
      format('Review "%s" selesai. Siklus bisa ditutup.', v_cycle.name),
      '/field-service?tab=cycles', p_cycle_id::text);
  END IF;

  IF p_new_status = 'CLOSED' THEN
    PERFORM public.fs_snapshot_cycle_summary(p_cycle_id);
  END IF;

  RETURN jsonb_build_object('id', p_cycle_id, 'status', p_new_status);
END;
$$;

-- fs_review_tv: catat keputusan + kabari PIC saat TV-nya diminta diulang.
CREATE OR REPLACE FUNCTION public.fs_review_tv(
  p_instance_id uuid, p_execution_point_id uuid, p_decision text, p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := jwt_user_id();
  v_tv text; v_lokasi text; v_pic uuid;
BEGIN
  IF NOT (fs_is_client_reviewer() OR fs_is_provider()) THEN
    RAISE EXCEPTION 'Anda tidak berhak memberi keputusan review.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('APPROVED', 'REVISION') THEN
    RAISE EXCEPTION 'Keputusan harus APPROVED atau REVISION.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_decision = 'REVISION' AND COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'Permintaan revisi wajib menyertakan alasan.' USING ERRCODE = 'check_violation';
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
    status = CASE WHEN EXCLUDED.review_status = 'REVISION'
                  THEN 'REVISION_REQUIRED'
                  ELSE public.fs_execution_point_status.status END,
    updated_at = now();

  SELECT pt.name, l.name, i.assigned_pic_user_id
    INTO v_tv, v_lokasi, v_pic
    FROM public.fs_execution_points pt
    JOIN public.fs_execution_instances i ON i.id = p_instance_id
    JOIN public.fs_locations l ON l.id = i.location_id
    WHERE pt.id = p_execution_point_id;

  PERFORM public.fs_catat('REVIEW_TV', 'fs_execution_point_status', p_execution_point_id,
    format('%s %s di %s', CASE WHEN p_decision = 'REVISION' THEN 'Minta ulang' ELSE 'Menyetujui' END,
           COALESCE(v_tv, 'TV'), COALESCE(v_lokasi, '-')),
    jsonb_build_object('keputusan', p_decision, 'alasan', p_notes));

  IF p_decision = 'REVISION' THEN
    PERFORM public.fs_notif(v_pic, 'project', 'Ada TV yang harus diulang',
      format('%s di %s diminta diperbaiki: %s', COALESCE(v_tv, 'TV'), COALESCE(v_lokasi, '-'), p_notes),
      '/teknisi', p_instance_id::text);
  END IF;

  RETURN jsonb_build_object('execution_point_id', p_execution_point_id, 'review_status', p_decision);
END;
$$;

-- fs_review_checkout: catat keputusan + kabari PIC hasilnya.
CREATE OR REPLACE FUNCTION public.fs_review_checkout(
  p_report_id uuid, p_decision text, p_alasan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := jwt_user_id();
  v_lap record; v_lokasi text;
BEGIN
  IF NOT fs_is_provider() THEN
    RAISE EXCEPTION 'Hanya provider admin/supervisor yang boleh menyetujui laporan check-out.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Keputusan harus APPROVED atau REJECTED.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_decision = 'REJECTED' AND COALESCE(btrim(p_alasan), '') = '' THEN
    RAISE EXCEPTION 'Penolakan wajib menyertakan alasan.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_lap FROM public.fs_daily_reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Laporan tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.fs_daily_reports
    SET status = CASE WHEN p_decision = 'APPROVED' THEN 'APPROVED' ELSE 'REJECTED' END,
        rejection_reason = CASE WHEN p_decision = 'REJECTED' THEN btrim(p_alasan) ELSE NULL END,
        reviewed_by = v_user_id, reviewed_at = now(), updated_at = now()
    WHERE id = p_report_id;

  SELECT name INTO v_lokasi FROM public.fs_locations WHERE id = v_lap.location_id;

  PERFORM public.fs_catat('CHECKOUT_' || p_decision, 'fs_daily_reports', p_report_id,
    format('%s check-out %s (%s/%s TV)',
           CASE WHEN p_decision = 'APPROVED' THEN 'Menyetujui' ELSE 'Menolak' END,
           COALESCE(v_lokasi, '-'), v_lap.displays_completed, v_lap.displays_total),
    jsonb_build_object('keputusan', p_decision, 'alasan', p_alasan));

  PERFORM public.fs_notif(v_lap.technician_id, 'project',
    CASE WHEN p_decision = 'APPROVED' THEN 'Check-out Anda disetujui' ELSE 'Check-out Anda ditolak' END,
    CASE WHEN p_decision = 'APPROVED'
         THEN format('%s: %s dari %s TV diterima.', COALESCE(v_lokasi, '-'), v_lap.displays_completed, v_lap.displays_total)
         ELSE format('%s perlu diperbaiki: %s', COALESCE(v_lokasi, '-'), p_alasan) END,
    '/teknisi', v_lap.execution_instance_id::text);

  RETURN jsonb_build_object('id', p_report_id, 'status', p_decision);
END;
$$;

-- fs_request_clear: catat permintaan + kabari admin lain.
CREATE OR REPLACE FUNCTION public.fs_request_clear(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_cycle record; v_objects integer;
BEGIN
  IF NOT fs_is_provider_admin() THEN
    RAISE EXCEPTION 'Hanya Provider Admin yang boleh meminta pembersihan data cycle.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_cycle FROM public.fs_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_cycle.status <> 'CLOSED' THEN
    RAISE EXCEPTION 'Pembersihan hanya boleh diminta untuk cycle yang sudah CLOSED (status sekarang: %).', v_cycle.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_objects FROM public.fs_evidence e
    JOIN public.fs_execution_instances i ON i.id = e.execution_instance_id
    WHERE i.cycle_id = p_cycle_id;

  UPDATE public.fs_cycles
    SET status = 'CLEAR_PENDING', clear_requested_by = jwt_user_id(),
        clear_requested_at = now(), updated_at = now()
    WHERE id = p_cycle_id;

  PERFORM public.fs_catat('CLEAR_REQUEST', 'fs_cycles', p_cycle_id,
    format('Meminta pembersihan data siklus "%s" (%s file bukti)', v_cycle.name, v_objects),
    jsonb_build_object('evidence_objects', v_objects));

  PERFORM public.fs_notif_peran(ARRAY['PROVIDER_ADMIN'], 'system',
    'Permintaan pembersihan data',
    format('Siklus "%s" menunggu persetujuan penghapusan %s file bukti.', v_cycle.name, v_objects),
    '/field-service?tab=cycles', p_cycle_id::text);

  RETURN jsonb_build_object('id', p_cycle_id, 'status', 'CLEAR_PENDING', 'evidence_objects', v_objects);
END;
$$;

-- CATATAN: fs_generate_cycle_scope, fs_submit_checkout, dan fs_finalize_clear
-- juga ditulis ulang dengan sisipan yang sama pada migrasi ini saat
-- diterapkan. Ketiganya panjang dan tidak berubah selain penambahan
-- fs_catat()/fs_notif_peran(); bila menyiapkan instalasi baru, salin
-- definisinya dari database yang sudah berjalan dengan:
--   SELECT pg_get_functiondef(oid) FROM pg_proc
--   WHERE proname IN ('fs_generate_cycle_scope','fs_submit_checkout','fs_finalize_clear');
