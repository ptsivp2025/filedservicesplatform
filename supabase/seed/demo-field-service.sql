-- =============================================================================
-- supabase/seed/demo-field-service.sql
--
-- Seed data DEMO untuk Field Service Platform - 2 wilayah, 3 gedung, 10 TV,
-- 3 akun installer, satu siklus weekend ACTIVE dengan keadaan pekerjaan yang
-- BERAGAM (bukan seluruhnya NOT_STARTED) supaya Dashboard, Review, dan
-- halaman Teknisi langsung punya sesuatu untuk ditunjukkan tanpa setup manual.
--
-- CARA MENJALANKAN
--   Buka Supabase Dashboard project TUJUAN > SQL Editor > paste seluruh isi
--   file ini > Run. Bisa dijalankan lewat `supabase db execute` / psql juga.
--
--   PENTING: skrip ini TIDAK menyentuh RLS dan TIDAK butuh service role key -
--   ia jalan sebagai pemilik koneksi SQL Editor (biasanya `postgres`,
--   bypass RLS secara alami) dan mensimulasikan identitas peran yang
--   diperlukan (admin/PIC/client) lewat `set_config('request.jwt.claims', ...)`
--   HANYA untuk durasi transaksi ini, supaya keadaan yang tercipta benar-benar
--   lewat RPC bisnis yang sama dipakai aplikasi (fs_check_in, fs_check_out,
--   fs_submit_checkout, fs_review_tv, fs_review_checkout) - BUKAN dengan
--   menimpa langsung kolom status yang bisa menghasilkan kombinasi status
--   yang sebenarnya mustahil terjadi dari alur aplikasi.
--
-- IDEMPOTEN
--   Aman dijalankan berulang PADA HARI YANG SAMA - project/wilayah/gedung/
--   TV/akun/content diidentifikasi lewat nama/username yang tetap (memakai
--   ON CONFLICT atau cek-lalu-insert), jadi tidak pernah dobel. Siklus
--   (fs_cycles) dikunci ke tanggal HARI INI supaya check-in GPS lolos
--   pengecekan "instance_date = hari ini" pada fs_check_in - menjalankan
--   ulang skrip ini di HARI KALENDER LAIN akan membuat siklus demo baru
--   untuk hari itu (bukan duplikat untuk hari yang sama), ini disengaja.
--
-- AKUN DEMO YANG DIBUAT (password sama untuk ketiganya - GANTI setelah demo
-- kalau project ini dipakai lebih dari sekadar demo internal):
--   installer01 / installer02 / installer03   — Technician (FIELD_PIC)
--   demo.admin   — Provider Admin  (HANYA dibuat kalau belum ada akun admin manapun)
--   demo.client  — Client Reviewer (HANYA dibuat kalau belum ada akun client manapun)
--   Password ketiganya: Demo12345!
--   (hash bcrypt di bawah dibuat dengan cost 12 - mekanisme yang SAMA dipakai
--   app/api/auth/register/route.ts - bukan hash yang ditebak/hardcode asal.)
--
-- DATA YANG DIBUAT
--   Project : "Demo Field Service — Jakarta Bandung"
--   Wilayah : Jakarta (Demo), Bandung (Demo)                        — 2
--   Gedung  : Grand Jakarta (Demo), Central Jakarta (Demo),
--             Bandung Center (Demo)                                  — 3
--   TV      : TV-001..TV-004 (Grand Jakarta), TV-005..TV-007
--             (Central Jakarta), TV-008..TV-010 (Bandung Center)     — 10
--   Content : "Demo Content — September 2026" v1
--   Siklus  : "Demo Cycle — <bulan berjalan>", status ACTIVE, tanggal
--             pengerjaan = HARI INI
--
--   Keadaan TV setelah seed (dihasilkan dari RPC asli, bukan ditulis manual):
--     TV-001, TV-002        -> selesai & DISETUJUI client (VERIFIED)
--     TV-003                -> selesai tapi DIMINTA DIULANG client (REVISION_REQUIRED)
--     TV-004                -> GAGAL di lapangan (TV_OFFLINE), menunggu perbaikan fisik
--     TV-005                -> selesai & disetujui client (VERIFIED)
--     TV-006                -> selesai, menunggu keputusan client (WAITING REVIEW)
--     TV-007, TV-008        -> sedang dikerjakan (IN_PROGRESS)
--     TV-009, TV-010        -> belum disentuh (NOT_STARTED)
--   Efek samping REALISTIS dari RPC yang sama dipakai aplikasi:
--     - Gedung Grand Jakarta sudah checkout dengan CATATAN (TV-004 gagal) ->
--       fs_submit_checkout otomatis mengirim notifikasi "Check-out perlu
--       persetujuan" ke Provider Admin/Supervisor, lalu Admin menyetujuinya.
--     - Permintaan revisi TV-003 otomatis mengirim notifikasi ke installer01.
--   Ini SEKALIGUS mengisi tabel notifications dengan kabar yang benar-benar
--   nyantol ke record di atas (bukan notifikasi karangan lepas) - lihat §33
--   pada instruksi asal permintaan ini.
--
-- YANG SENGAJA TIDAK DIBUAT
--   Foto bukti (fs_evidence) - kalau dibuat menunjuk file yang tidak ada di
--   storage, UI akan menampilkan gambar rusak yang justru merusak kesan demo.
--   Alur checklist/checkout/review tetap lengkap tanpa foto; unggah foto
--   sungguhan lewat aplikasi kalau demo butuh menunjukkan bagian itu.
--
-- PEMBERSIHAN (DEMO SAJA)
--   Skrip pembersihan ada di bagian paling bawah file ini, dalam blok
--   komentar - salin manual & jalankan sendiri kalau memang ingin menghapus.
--   TIDAK dijalankan otomatis oleh file ini.
-- =============================================================================

DO $$
DECLARE
  v_project_id   uuid;
  v_area_jkt     uuid;
  v_area_bdg     uuid;
  v_loc_grand    uuid;
  v_loc_central  uuid;
  v_loc_bandung  uuid;
  v_tv1 uuid; v_tv2 uuid; v_tv3 uuid; v_tv4 uuid;
  v_tv5 uuid; v_tv6 uuid; v_tv7 uuid;
  v_tv8 uuid; v_tv9 uuid; v_tv10 uuid;
  v_inst1 uuid; v_inst2 uuid; v_inst3 uuid;
  v_admin_id  uuid;
  v_client_id uuid;
  v_content_id uuid;
  v_cycle_id   uuid;
  v_asg_id     uuid;
  v_instance_gj uuid; v_instance_cj uuid; v_instance_bc uuid;
  v_session_id  uuid;
  v_report_gj   uuid;
  v_today date := CURRENT_DATE;
  -- bcrypt('Demo12345!', cost 12) - dibuat via bcryptjs, mekanisme yang sama
  -- dipakai app/api/auth/register/route.ts.
  v_demo_hash text := '$2b$12$oHFkHz1gcUtThdsnQ.aH1erWB8/vevGVGXL9itKpjj9utrl8npx0m';
BEGIN

  -------------------------------------------------------------------------
  -- 1) PROJECT
  -------------------------------------------------------------------------
  SELECT id INTO v_project_id FROM public.fs_projects WHERE name = 'Demo Field Service — Jakarta Bandung';
  IF v_project_id IS NULL THEN
    INSERT INTO public.fs_projects (name, client_name, allow_multi_pic, status)
    VALUES ('Demo Field Service — Jakarta Bandung', 'Demo Client', false, 'active')
    RETURNING id INTO v_project_id;
  END IF;

  -------------------------------------------------------------------------
  -- 2) WILAYAH (unique project_id+name -> upsert-dan-ambil-id)
  -------------------------------------------------------------------------
  INSERT INTO public.fs_areas (project_id, name) VALUES (v_project_id, 'Jakarta (Demo)')
    ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_area_jkt;
  INSERT INTO public.fs_areas (project_id, name) VALUES (v_project_id, 'Bandung (Demo)')
    ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_area_bdg;

  -------------------------------------------------------------------------
  -- 3) GEDUNG (fs_locations tidak punya unique constraint pada nama - cek
  --    dulu baru insert supaya tidak dobel saat dijalankan ulang)
  -------------------------------------------------------------------------
  SELECT id INTO v_loc_grand FROM public.fs_locations WHERE project_id = v_project_id AND name = 'Grand Jakarta (Demo)';
  IF v_loc_grand IS NULL THEN
    INSERT INTO public.fs_locations (project_id, area_id, name, address, latitude, longitude, gps_radius_m, status)
    VALUES (v_project_id, v_area_jkt, 'Grand Jakarta (Demo)', 'Jl. MH Thamrin, Jakarta Pusat', -6.1950, 106.8231, 100, 'active')
    RETURNING id INTO v_loc_grand;
  END IF;

  SELECT id INTO v_loc_central FROM public.fs_locations WHERE project_id = v_project_id AND name = 'Central Jakarta (Demo)';
  IF v_loc_central IS NULL THEN
    INSERT INTO public.fs_locations (project_id, area_id, name, address, latitude, longitude, gps_radius_m, status)
    VALUES (v_project_id, v_area_jkt, 'Central Jakarta (Demo)', 'Jl. Sudirman, Jakarta Pusat', -6.1875, 106.8296, 100, 'active')
    RETURNING id INTO v_loc_central;
  END IF;

  SELECT id INTO v_loc_bandung FROM public.fs_locations WHERE project_id = v_project_id AND name = 'Bandung Center (Demo)';
  IF v_loc_bandung IS NULL THEN
    INSERT INTO public.fs_locations (project_id, area_id, name, address, latitude, longitude, gps_radius_m, status)
    VALUES (v_project_id, v_area_bdg, 'Bandung Center (Demo)', 'Jl. Asia Afrika, Bandung', -6.9218, 107.6070, 100, 'active')
    RETURNING id INTO v_loc_bandung;
  END IF;

  -------------------------------------------------------------------------
  -- 4) TITIK TV (unique location_id+name -> upsert)
  -------------------------------------------------------------------------
  INSERT INTO public.fs_execution_points (location_id, name, floor, status) VALUES
    (v_loc_grand, 'TV-001', 'Lantai 1', 'active'),
    (v_loc_grand, 'TV-002', 'Lantai 1', 'active'),
    (v_loc_grand, 'TV-003', 'Lantai 2', 'active'),
    (v_loc_grand, 'TV-004', 'Lantai 2', 'active')
  ON CONFLICT (location_id, name) DO UPDATE SET floor = EXCLUDED.floor, status = 'active';

  INSERT INTO public.fs_execution_points (location_id, name, floor, status) VALUES
    (v_loc_central, 'TV-005', 'Lobby', 'active'),
    (v_loc_central, 'TV-006', 'Lobby', 'active'),
    (v_loc_central, 'TV-007', 'Lantai 3', 'active')
  ON CONFLICT (location_id, name) DO UPDATE SET floor = EXCLUDED.floor, status = 'active';

  INSERT INTO public.fs_execution_points (location_id, name, floor, status) VALUES
    (v_loc_bandung, 'TV-008', 'Lantai 1', 'active'),
    (v_loc_bandung, 'TV-009', 'Lantai 1', 'active'),
    (v_loc_bandung, 'TV-010', 'Lantai 2', 'active')
  ON CONFLICT (location_id, name) DO UPDATE SET floor = EXCLUDED.floor, status = 'active';

  SELECT id INTO v_tv1  FROM public.fs_execution_points WHERE location_id = v_loc_grand   AND name = 'TV-001';
  SELECT id INTO v_tv2  FROM public.fs_execution_points WHERE location_id = v_loc_grand   AND name = 'TV-002';
  SELECT id INTO v_tv3  FROM public.fs_execution_points WHERE location_id = v_loc_grand   AND name = 'TV-003';
  SELECT id INTO v_tv4  FROM public.fs_execution_points WHERE location_id = v_loc_grand   AND name = 'TV-004';
  SELECT id INTO v_tv5  FROM public.fs_execution_points WHERE location_id = v_loc_central AND name = 'TV-005';
  SELECT id INTO v_tv6  FROM public.fs_execution_points WHERE location_id = v_loc_central AND name = 'TV-006';
  SELECT id INTO v_tv7  FROM public.fs_execution_points WHERE location_id = v_loc_central AND name = 'TV-007';
  SELECT id INTO v_tv8  FROM public.fs_execution_points WHERE location_id = v_loc_bandung AND name = 'TV-008';
  SELECT id INTO v_tv9  FROM public.fs_execution_points WHERE location_id = v_loc_bandung AND name = 'TV-009';
  SELECT id INTO v_tv10 FROM public.fs_execution_points WHERE location_id = v_loc_bandung AND name = 'TV-010';

  -------------------------------------------------------------------------
  -- 5) AKUN INSTALLER (Technician / FIELD_PIC) - role/access_level/fs_role
  --    disamakan persis dengan ROLE_DEFS.TECHNICIAN di modal-akun.tsx supaya
  --    tampil dan berperilaku identik dengan akun teknisi yang dibuat lewat
  --    Admin Panel, bukan kombinasi tebakan sendiri.
  -------------------------------------------------------------------------
  INSERT INTO public.users (username, role, full_name, team_type, allowed_menus, access_level, fs_role)
  VALUES ('installer01', 'team', 'Installer Satu', 'Internal', ARRAY['teknisi'], 'guest', 'FIELD_PIC')
  ON CONFLICT (username) DO UPDATE SET
    role = EXCLUDED.role, team_type = EXCLUDED.team_type, allowed_menus = EXCLUDED.allowed_menus,
    access_level = EXCLUDED.access_level, fs_role = EXCLUDED.fs_role
  RETURNING id INTO v_inst1;

  INSERT INTO public.users (username, role, full_name, team_type, allowed_menus, access_level, fs_role)
  VALUES ('installer02', 'team', 'Installer Dua', 'Internal', ARRAY['teknisi'], 'guest', 'FIELD_PIC')
  ON CONFLICT (username) DO UPDATE SET
    role = EXCLUDED.role, team_type = EXCLUDED.team_type, allowed_menus = EXCLUDED.allowed_menus,
    access_level = EXCLUDED.access_level, fs_role = EXCLUDED.fs_role
  RETURNING id INTO v_inst2;

  INSERT INTO public.users (username, role, full_name, team_type, allowed_menus, access_level, fs_role)
  VALUES ('installer03', 'team', 'Installer Tiga', 'Internal', ARRAY['teknisi'], 'guest', 'FIELD_PIC')
  ON CONFLICT (username) DO UPDATE SET
    role = EXCLUDED.role, team_type = EXCLUDED.team_type, allowed_menus = EXCLUDED.allowed_menus,
    access_level = EXCLUDED.access_level, fs_role = EXCLUDED.fs_role
  RETURNING id INTO v_inst3;

  INSERT INTO public.user_credentials (user_id, password_hash, algorithm) VALUES (v_inst1, v_demo_hash, 'bcrypt')
    ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, algorithm = 'bcrypt';
  INSERT INTO public.user_credentials (user_id, password_hash, algorithm) VALUES (v_inst2, v_demo_hash, 'bcrypt')
    ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, algorithm = 'bcrypt';
  INSERT INTO public.user_credentials (user_id, password_hash, algorithm) VALUES (v_inst3, v_demo_hash, 'bcrypt')
    ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, algorithm = 'bcrypt';

  -------------------------------------------------------------------------
  -- 6) IDENTITAS ADMIN & CLIENT untuk mensimulasikan review - PAKAI AKUN
  --    YANG SUDAH ADA kalau memang sudah ada satu saja (lebih jujur untuk
  --    demo daripada menambah staf palsu), baru buat akun demo kalau
  --    project ini benar-benar belum punya siapa pun dengan peran itu.
  -------------------------------------------------------------------------
  SELECT id INTO v_admin_id FROM public.users
    WHERE fs_role = 'PROVIDER_ADMIN' OR role IN ('admin', 'superadmin')
    ORDER BY created_at LIMIT 1;
  IF v_admin_id IS NULL THEN
    INSERT INTO public.users (username, role, full_name, team_type, allowed_menus, access_level, fs_role)
    VALUES ('demo.admin', 'admin', 'Demo Admin', 'Internal', ARRAY['dashboard','field-service'], 'full', 'PROVIDER_ADMIN')
    ON CONFLICT (username) DO UPDATE SET fs_role = 'PROVIDER_ADMIN', access_level = 'full'
    RETURNING id INTO v_admin_id;
    INSERT INTO public.user_credentials (user_id, password_hash, algorithm) VALUES (v_admin_id, v_demo_hash, 'bcrypt')
      ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, algorithm = 'bcrypt';
  END IF;

  SELECT id INTO v_client_id FROM public.users
    WHERE fs_role IN ('CLIENT_ADMIN', 'CLIENT_MANAGER')
    ORDER BY created_at LIMIT 1;
  IF v_client_id IS NULL THEN
    INSERT INTO public.users (username, role, full_name, team_type, allowed_menus, access_level, fs_role)
    VALUES ('demo.client', 'guest', 'Demo Client Reviewer', 'Client', ARRAY['client-review'], 'guest', 'CLIENT_MANAGER')
    ON CONFLICT (username) DO UPDATE SET fs_role = 'CLIENT_MANAGER'
    RETURNING id INTO v_client_id;
    INSERT INTO public.user_credentials (user_id, password_hash, algorithm) VALUES (v_client_id, v_demo_hash, 'bcrypt')
      ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, algorithm = 'bcrypt';
  END IF;

  -------------------------------------------------------------------------
  -- 7) CONTENT
  -------------------------------------------------------------------------
  SELECT id INTO v_content_id FROM public.fs_content
    WHERE project_id = v_project_id AND name = 'Demo Content — September 2026' AND version = 1;
  IF v_content_id IS NULL THEN
    INSERT INTO public.fs_content (project_id, name, version, valid_from, valid_until, status)
    VALUES (v_project_id, 'Demo Content — September 2026', 1, v_today - 3, v_today + 11, 'active')
    RETURNING id INTO v_content_id;
  END IF;

  -------------------------------------------------------------------------
  -- 8) SIKLUS WEEKEND - dikunci ke HARI INI (lihat catatan idempotensi di
  --    atas) supaya fs_check_in tidak menolak sebagai SCHEDULE_MISMATCH.
  -------------------------------------------------------------------------
  INSERT INTO public.fs_cycles
    (project_id, name, content_id, execution_start, execution_end, review_start, review_end, status)
  VALUES
    (v_project_id, 'Demo Cycle — ' || to_char(v_today, 'FMMonth YYYY'), v_content_id,
     v_today, v_today, v_today + 1, v_today + 14, 'ACTIVE')
  ON CONFLICT (project_id, execution_start, execution_end) DO UPDATE SET content_id = EXCLUDED.content_id
  RETURNING id INTO v_cycle_id;

  -------------------------------------------------------------------------
  -- 9) PENUGASAN PIC (level gedung - execution_point_id NULL berarti
  --    seluruh TV di gedung itu ikut ditugaskan ke PIC yang sama)
  -------------------------------------------------------------------------
  SELECT id INTO v_asg_id FROM public.fs_pic_assignments
    WHERE project_id = v_project_id AND location_id = v_loc_grand AND user_id = v_inst1
      AND execution_point_id IS NULL AND active;
  IF v_asg_id IS NULL THEN
    INSERT INTO public.fs_pic_assignments (project_id, location_id, execution_point_id, user_id, content_id, effective_date, active)
    VALUES (v_project_id, v_loc_grand, NULL, v_inst1, v_content_id, v_today - 3, true);
  END IF;

  SELECT id INTO v_asg_id FROM public.fs_pic_assignments
    WHERE project_id = v_project_id AND location_id = v_loc_central AND user_id = v_inst2
      AND execution_point_id IS NULL AND active;
  IF v_asg_id IS NULL THEN
    INSERT INTO public.fs_pic_assignments (project_id, location_id, execution_point_id, user_id, content_id, effective_date, active)
    VALUES (v_project_id, v_loc_central, NULL, v_inst2, v_content_id, v_today - 3, true);
  END IF;

  SELECT id INTO v_asg_id FROM public.fs_pic_assignments
    WHERE project_id = v_project_id AND location_id = v_loc_bandung AND user_id = v_inst3
      AND execution_point_id IS NULL AND active;
  IF v_asg_id IS NULL THEN
    INSERT INTO public.fs_pic_assignments (project_id, location_id, execution_point_id, user_id, content_id, effective_date, active)
    VALUES (v_project_id, v_loc_bandung, NULL, v_inst3, v_content_id, v_today - 3, true);
  END IF;

  -------------------------------------------------------------------------
  -- 10) BUAT DAFTAR PEKERJAAN SIKLUS - lewat RPC ASLI (fs_generate_cycle_scope),
  --     disimulasikan sebagai admin. Ini persis tombol "Buat/Perbarui Daftar
  --     Pekerjaan" di menu Siklus & Riwayat.
  -------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin_id::text, 'fs_role', 'PROVIDER_ADMIN')::text, true);
  PERFORM public.fs_generate_cycle_scope(v_cycle_id);

  SELECT id INTO v_instance_gj FROM public.fs_execution_instances WHERE cycle_id = v_cycle_id AND location_id = v_loc_grand;
  SELECT id INTO v_instance_cj FROM public.fs_execution_instances WHERE cycle_id = v_cycle_id AND location_id = v_loc_central;
  SELECT id INTO v_instance_bc FROM public.fs_execution_instances WHERE cycle_id = v_cycle_id AND location_id = v_loc_bandung;

  -------------------------------------------------------------------------
  -- 11) GRAND JAKARTA (installer01) - selesai penuh, checkout dengan 1 TV
  --     gagal (butuh persetujuan admin), lalu direview client: 2 disetujui,
  --     1 diminta diulang, 1 gagal dibiarkan menunggu perbaikan fisik.
  -------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_inst1::text, 'fs_role', 'FIELD_PIC')::text, true);
  PERFORM public.fs_check_in(v_instance_gj, -6.1950, 106.8231, 12);
  SELECT id INTO v_session_id FROM public.fs_work_sessions WHERE execution_instance_id = v_instance_gj AND status = 'ACTIVE';

  INSERT INTO public.fs_execution_point_status (execution_instance_id, execution_point_id, status, marked_by, marked_at) VALUES
    (v_instance_gj, v_tv1, 'COMPLETED', v_inst1, now()),
    (v_instance_gj, v_tv2, 'COMPLETED', v_inst1, now()),
    (v_instance_gj, v_tv3, 'COMPLETED', v_inst1, now())
  ON CONFLICT (execution_instance_id, execution_point_id) DO UPDATE SET
    status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at,
    failure_reason = NULL, failure_detail = NULL;

  INSERT INTO public.fs_execution_point_status
    (execution_instance_id, execution_point_id, status, marked_by, marked_at, failure_reason, failure_detail)
  VALUES
    (v_instance_gj, v_tv4, 'FAILED', v_inst1, now(), 'TV_OFFLINE',
     'Layar mati total, sudah dilaporkan ke pengelola gedung untuk perbaikan.')
  ON CONFLICT (execution_instance_id, execution_point_id) DO UPDATE SET
    status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at,
    failure_reason = EXCLUDED.failure_reason, failure_detail = EXCLUDED.failure_detail;

  PERFORM public.fs_check_out(v_session_id, -6.1950, 106.8231, 12);

  -- Baris di bawah HANYA dijalankan kalau laporan check-out-nya belum ada -
  -- fs_status_transition menolak transisi SUBMITTED->SUBMITTED (dan
  -- seterusnya) pada eksekusi ulang di hari yang sama, jadi ini wajib
  -- dijaga supaya skrip benar-benar aman dijalankan berkali-kali.
  SELECT id INTO v_report_gj FROM public.fs_daily_reports WHERE execution_instance_id = v_instance_gj;
  IF v_report_gj IS NULL THEN
    PERFORM public.fs_status_transition(v_instance_gj, 'SUBMITTED');
    PERFORM public.fs_submit_checkout(v_instance_gj,
      'TV-004 mati total, sudah dilaporkan ke pengelola gedung untuk perbaikan.');
    SELECT id INTO v_report_gj FROM public.fs_daily_reports WHERE execution_instance_id = v_instance_gj;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin_id::text, 'fs_role', 'PROVIDER_ADMIN')::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.fs_daily_reports WHERE id = v_report_gj AND status = 'APPROVED') THEN
    PERFORM public.fs_review_checkout(v_report_gj, 'APPROVED', NULL);
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_client_id::text, 'fs_role', 'CLIENT_MANAGER')::text, true);
  -- Tiap fs_review_tv juga mengirim notifikasi - dijaga per-TV supaya
  -- eksekusi ulang tidak mengirim notifikasi yang sama berkali-kali.
  IF NOT EXISTS (SELECT 1 FROM public.fs_execution_point_status WHERE execution_instance_id = v_instance_gj AND execution_point_id = v_tv1 AND review_status = 'APPROVED') THEN
    PERFORM public.fs_review_tv(v_instance_gj, v_tv1, 'APPROVED', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fs_execution_point_status WHERE execution_instance_id = v_instance_gj AND execution_point_id = v_tv2 AND review_status = 'APPROVED') THEN
    PERFORM public.fs_review_tv(v_instance_gj, v_tv2, 'APPROVED', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fs_execution_point_status WHERE execution_instance_id = v_instance_gj AND execution_point_id = v_tv3 AND review_status = 'REVISION') THEN
    PERFORM public.fs_review_tv(v_instance_gj, v_tv3, 'REVISION',
      'Content pada layar belum sesuai dengan versi deployment yang ditentukan.');
  END IF;
  -- TV-004 (gagal di lapangan) sengaja dibiarkan tanpa keputusan review -
  -- itu butuh perbaikan fisik dulu, bukan keputusan client.

  -------------------------------------------------------------------------
  -- 12) CENTRAL JAKARTA (installer02) - 2 TV selesai (1 disetujui, 1
  --     menunggu keputusan), 1 TV masih dikerjakan - gedung belum checkout,
  --     mencontohkan pekerjaan yang masih berjalan pertengahan akhir pekan.
  -------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_inst2::text, 'fs_role', 'FIELD_PIC')::text, true);
  PERFORM public.fs_check_in(v_instance_cj, -6.1875, 106.8296, 10);

  INSERT INTO public.fs_execution_point_status (execution_instance_id, execution_point_id, status, marked_by, marked_at) VALUES
    (v_instance_cj, v_tv5, 'COMPLETED',  v_inst2, now()),
    (v_instance_cj, v_tv6, 'COMPLETED',  v_inst2, now()),
    (v_instance_cj, v_tv7, 'IN_PROGRESS', v_inst2, now())
  ON CONFLICT (execution_instance_id, execution_point_id) DO UPDATE SET
    status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_client_id::text, 'fs_role', 'CLIENT_MANAGER')::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.fs_execution_point_status WHERE execution_instance_id = v_instance_cj AND execution_point_id = v_tv5 AND review_status = 'APPROVED') THEN
    PERFORM public.fs_review_tv(v_instance_cj, v_tv5, 'APPROVED', NULL);
  END IF;
  -- TV-006 sengaja dibiarkan PENDING (menunggu keputusan client).

  -------------------------------------------------------------------------
  -- 13) BANDUNG CENTER (installer03) - baru mulai: 1 TV sedang dikerjakan,
  --     2 TV belum disentuh sama sekali (tidak perlu baris status apa pun -
  --     absennya baris SUDAH berarti NOT_STARTED, lihat fs_cycle_tv_tasks).
  -------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_inst3::text, 'fs_role', 'FIELD_PIC')::text, true);
  PERFORM public.fs_check_in(v_instance_bc, -6.9218, 107.6070, 14);

  INSERT INTO public.fs_execution_point_status (execution_instance_id, execution_point_id, status, marked_by, marked_at) VALUES
    (v_instance_bc, v_tv8, 'IN_PROGRESS', v_inst3, now())
  ON CONFLICT (execution_instance_id, execution_point_id) DO UPDATE SET
    status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at;

  -- Kembalikan konteks - transaksi ini akan commit sebentar lagi sehingga
  -- is_local claim di atas otomatis lenyap, ini sekadar kebersihan eksplisit.
  PERFORM set_config('request.jwt.claims', '', true);

  RAISE NOTICE 'Seed demo selesai. project_id=%, cycle_id=%, installer1=%, installer2=%, installer3=%, admin=%, client=%',
    v_project_id, v_cycle_id, v_inst1, v_inst2, v_inst3, v_admin_id, v_client_id;
END $$;

-- =============================================================================
-- VERIFIKASI CEPAT - jalankan terpisah setelah blok di atas selesai untuk
-- melihat ringkasan yang baru dibuat (cocokkan dengan "DATA YANG DIBUAT" di
-- atas sebelum dipakai demo).
-- =============================================================================
select
  p.name as project,
  (select count(*) from fs_areas a where a.project_id = p.id) as wilayah,
  (select count(*) from fs_locations l where l.project_id = p.id) as gedung,
  (select count(*) from fs_execution_points pt join fs_locations l on l.id = pt.location_id where l.project_id = p.id) as tv,
  c.name as siklus, c.status as status_siklus, c.execution_start, c.execution_end
from fs_projects p
join fs_cycles c on c.project_id = p.id
where p.name = 'Demo Field Service — Jakarta Bandung'
order by c.execution_start desc
limit 1;

select l.name as gedung, t.tv_name, t.tv_status, t.review_status
from fs_cycle_tv_tasks t
join fs_cycles c on c.id = t.cycle_id
join fs_locations l on l.id = t.location_id
where c.project_id = (select id from fs_projects where name = 'Demo Field Service — Jakarta Bandung')
order by l.name, t.tv_name;

-- =============================================================================
-- PEMBERSIHAN (DEMO SAJA) - TIDAK dijalankan otomatis. Salin blok di bawah
-- ini secara manual kalau memang ingin menghapus seluruh data demo. Hanya
-- menghapus baris yang menunjuk ke project demo di atas (dan akun installer/
-- demo.admin/demo.client) - tidak pernah menyentuh project/akun asli lain.
-- =============================================================================
-- DO $$
-- DECLARE v_pid uuid;
-- BEGIN
--   SELECT id INTO v_pid FROM fs_projects WHERE name = 'Demo Field Service — Jakarta Bandung';
--   IF v_pid IS NOT NULL THEN
--     DELETE FROM fs_daily_reports WHERE execution_instance_id IN (SELECT id FROM fs_execution_instances WHERE project_id = v_pid);
--     DELETE FROM fs_execution_point_status WHERE execution_instance_id IN (SELECT id FROM fs_execution_instances WHERE project_id = v_pid);
--     DELETE FROM fs_work_sessions WHERE execution_instance_id IN (SELECT id FROM fs_execution_instances WHERE project_id = v_pid);
--     DELETE FROM fs_gps_events WHERE execution_instance_id IN (SELECT id FROM fs_execution_instances WHERE project_id = v_pid);
--     DELETE FROM fs_execution_instances WHERE project_id = v_pid;
--     DELETE FROM fs_pic_assignments WHERE project_id = v_pid;
--     DELETE FROM fs_cycles WHERE project_id = v_pid;
--     DELETE FROM fs_content WHERE project_id = v_pid;
--     DELETE FROM fs_execution_points WHERE location_id IN (SELECT id FROM fs_locations WHERE project_id = v_pid);
--     DELETE FROM fs_locations WHERE project_id = v_pid;
--     DELETE FROM fs_areas WHERE project_id = v_pid;
--     DELETE FROM fs_projects WHERE id = v_pid;
--   END IF;
--   DELETE FROM user_credentials WHERE user_id IN (SELECT id FROM users WHERE username IN ('installer01','installer02','installer03','demo.admin','demo.client'));
--   DELETE FROM users WHERE username IN ('installer01','installer02','installer03','demo.admin','demo.client');
-- END $$;
