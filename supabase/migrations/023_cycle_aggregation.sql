-- ============================================================================
-- Operational Control Platform — Migration 023
-- Agregasi SISI DATABASE + lifecycle cycle (generate scope -> transisi ->
-- close -> request clear -> finalize clear).
--
-- KENAPA AGREGASI DI DATABASE: dashboard lama menarik ribuan baris ke browser
-- lalu menghitungnya di React (ExecutionWidget: .limit(200) untuk daftar,
-- tapi muatDeploymentStat menarik SELURUH fs_execution_point_status pada
-- rentang tanggal). Pada 4.000+ TV pola itu tidak akan bertahan: berat di
-- egress Supabase, berat di memori browser, dan angkanya dihitung ulang
-- berbeda-beda di tiap layar. Fungsi di bawah mengembalikan angka yang SUDAH
-- jadi, dihitung dari satu sumber yang sama (view fs_cycle_tv_tasks, 022).
--
-- KENAPA SEBAGIAN BESAR TIDAK SECURITY DEFINER: fungsi agregasi di sini
-- sengaja berjalan sebagai PEMANGGIL supaya RLS yang sudah ada (006/015)
-- tetap berlaku apa adanya. Efeknya rapi: Admin memanggil -> dapat seluruh
-- project; PIC memanggil fungsi yang sama -> otomatis hanya lokasi yang
-- ditugaskan padanya. Tidak ada jalur baca baru yang menembus RLS.
-- Yang SECURITY DEFINER hanyalah fungsi yang MENGUBAH lifecycle, dan
-- masing-masing memeriksa perannya sendiri di baris pertama.
--
-- Jalankan SETELAH 022.
-- ============================================================================

-- ── Helper: cycle yang sedang berjalan untuk sebuah project ─────────────
CREATE OR REPLACE FUNCTION public.fs_active_cycle(p_project_id uuid, p_date date DEFAULT current_date)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT id FROM public.fs_cycles
  WHERE project_id = p_project_id
    AND status NOT IN ('CLOSED', 'CLEAR_PENDING', 'CLEAR_PARTIAL', 'CLEARED')
    AND p_date BETWEEN execution_start AND COALESCE(review_end, execution_end + 30)
  ORDER BY execution_start DESC
  LIMIT 1;
$$;

-- ── Ringkasan satu cycle (angka utama Control Room) ─────────────────────
-- Satu panggilan mengembalikan SELURUH angka header dashboard, supaya
-- halaman tidak perlu 6 query terpisah yang bisa saling tidak konsisten.
--
-- Definisi resmi (§45 master prompt), dipakai di SEMUA level:
--   completed  = tv_status COMPLETED                 (berhasil di-deploy)
--   failed     = tv_status FAILED atau EXCEPTION     (gagal, ada alasannya)
--   revision   = tv_status REVISION_REQUIRED, atau review_status REVISION
--   skipped    = tv_status SKIPPED
--   pending    = sisanya (NOT_STARTED / IN_PROGRESS) = belum tuntas
--   verified   = review_status APPROVED
-- "Checklist tersentuh" TIDAK PERNAH dihitung sebagai completed.
CREATE OR REPLACE FUNCTION public.fs_cycle_overview(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH t AS (
    SELECT * FROM public.fs_cycle_tv_tasks WHERE cycle_id = p_cycle_id
  )
  SELECT jsonb_build_object(
    'total_tv',      (SELECT count(*) FROM t),
    'completed_tv',  (SELECT count(*) FROM t WHERE tv_status = 'COMPLETED'),
    'failed_tv',     (SELECT count(*) FROM t WHERE tv_status IN ('FAILED', 'EXCEPTION')),
    'revision_tv',   (SELECT count(*) FROM t WHERE tv_status = 'REVISION_REQUIRED' OR review_status = 'REVISION'),
    'skipped_tv',    (SELECT count(*) FROM t WHERE tv_status = 'SKIPPED'),
    'pending_tv',    (SELECT count(*) FROM t WHERE tv_status IN ('NOT_STARTED', 'IN_PROGRESS')),
    'verified_tv',   (SELECT count(*) FROM t WHERE review_status = 'APPROVED'),
    'building_total',    (SELECT count(DISTINCT location_id) FROM t),
    'building_complete', (SELECT count(*) FROM (
        SELECT location_id FROM t GROUP BY location_id
        HAVING count(*) FILTER (WHERE tv_status = 'COMPLETED') = count(*)
      ) x),
    'region_total',  (SELECT count(DISTINCT area_id) FROM t),
    'pic_total',     (SELECT count(DISTINCT assigned_pic_user_id) FROM t WHERE assigned_pic_user_id IS NOT NULL),
    'last_activity', (SELECT max(marked_at) FROM t)
  );
$$;

-- ── Progress per WILAYAH ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fs_cycle_region_progress(p_cycle_id uuid)
RETURNS TABLE (
  area_id uuid, area_name text,
  total_tv bigint, completed_tv bigint, failed_tv bigint,
  revision_tv bigint, pending_tv bigint, verified_tv bigint,
  building_total bigint, pct numeric
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    t.area_id,
    a.name AS area_name,
    count(*)                                                                     AS total_tv,
    count(*) FILTER (WHERE t.tv_status = 'COMPLETED')                            AS completed_tv,
    count(*) FILTER (WHERE t.tv_status IN ('FAILED', 'EXCEPTION'))               AS failed_tv,
    count(*) FILTER (WHERE t.tv_status = 'REVISION_REQUIRED' OR t.review_status = 'REVISION') AS revision_tv,
    count(*) FILTER (WHERE t.tv_status IN ('NOT_STARTED', 'IN_PROGRESS'))        AS pending_tv,
    count(*) FILTER (WHERE t.review_status = 'APPROVED')                         AS verified_tv,
    count(DISTINCT t.location_id)                                                AS building_total,
    round(100.0 * count(*) FILTER (WHERE t.tv_status = 'COMPLETED') / NULLIF(count(*), 0), 1) AS pct
  FROM public.fs_cycle_tv_tasks t
  JOIN public.fs_areas a ON a.id = t.area_id
  WHERE t.cycle_id = p_cycle_id
  GROUP BY t.area_id, a.name
  -- Yang paling bermasalah di ATAS (exception-first, §40) - bukan abjad.
  ORDER BY (count(*) FILTER (WHERE t.tv_status = 'COMPLETED')::numeric / NULLIF(count(*), 0)) ASC NULLS FIRST, a.name;
$$;

-- ── Progress per GEDUNG ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fs_cycle_building_progress(p_cycle_id uuid, p_area_id uuid DEFAULT NULL)
RETURNS TABLE (
  location_id uuid, location_name text, area_id uuid, area_name text,
  latitude numeric, longitude numeric,
  total_tv bigint, completed_tv bigint, failed_tv bigint,
  revision_tv bigint, pending_tv bigint, verified_tv bigint,
  pic_names text[], pct numeric
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    t.location_id,
    l.name AS location_name,
    t.area_id,
    a.name AS area_name,
    l.latitude, l.longitude,
    count(*)                                                                     AS total_tv,
    count(*) FILTER (WHERE t.tv_status = 'COMPLETED')                            AS completed_tv,
    count(*) FILTER (WHERE t.tv_status IN ('FAILED', 'EXCEPTION'))               AS failed_tv,
    count(*) FILTER (WHERE t.tv_status = 'REVISION_REQUIRED' OR t.review_status = 'REVISION') AS revision_tv,
    count(*) FILTER (WHERE t.tv_status IN ('NOT_STARTED', 'IN_PROGRESS'))        AS pending_tv,
    count(*) FILTER (WHERE t.review_status = 'APPROVED')                         AS verified_tv,
    array_remove(array_agg(DISTINCT u.full_name), NULL)                          AS pic_names,
    round(100.0 * count(*) FILTER (WHERE t.tv_status = 'COMPLETED') / NULLIF(count(*), 0), 1) AS pct
  FROM public.fs_cycle_tv_tasks t
  JOIN public.fs_locations l ON l.id = t.location_id
  JOIN public.fs_areas a     ON a.id = t.area_id
  LEFT JOIN public.users u   ON u.id = t.assigned_pic_user_id
  WHERE t.cycle_id = p_cycle_id
    AND (p_area_id IS NULL OR t.area_id = p_area_id)
  GROUP BY t.location_id, l.name, t.area_id, a.name, l.latitude, l.longitude
  ORDER BY (count(*) FILTER (WHERE t.tv_status = 'COMPLETED')::numeric / NULLIF(count(*), 0)) ASC NULLS FIRST, l.name;
$$;

-- ── Daftar TV (drill-down paling dalam) ────────────────────────────────
-- p_status menerima kelompok yang dipakai UI ('PENDING'/'FAILED'/'REVISION'/
-- 'COMPLETED'), bukan hanya nilai mentah - supaya klien tidak perlu menghafal
-- kombinasi status mana yang berarti "bermasalah".
CREATE OR REPLACE FUNCTION public.fs_cycle_tv_list(
  p_cycle_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_pic_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  execution_point_id uuid, tv_name text, tv_floor text,
  location_id uuid, location_name text, area_name text,
  instance_id uuid, instance_date date,
  tv_status text, review_status text,
  failure_reason text, failure_detail text, review_notes text, pic_notes text,
  pic_user_id uuid, pic_name text, marked_at timestamptz,
  evidence_count bigint
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    t.execution_point_id, t.tv_name, t.tv_floor,
    t.location_id, l.name AS location_name, a.name AS area_name,
    t.instance_id, t.instance_date,
    t.tv_status, t.review_status,
    t.failure_reason, t.failure_detail, t.review_notes, t.pic_notes,
    t.assigned_pic_user_id AS pic_user_id, u.full_name AS pic_name, t.marked_at,
    (SELECT count(*) FROM public.fs_evidence e
      WHERE e.execution_instance_id = t.instance_id
        AND e.execution_point_id = t.execution_point_id) AS evidence_count
  FROM public.fs_cycle_tv_tasks t
  JOIN public.fs_locations l ON l.id = t.location_id
  JOIN public.fs_areas a     ON a.id = t.area_id
  LEFT JOIN public.users u   ON u.id = t.assigned_pic_user_id
  WHERE t.cycle_id = p_cycle_id
    AND (p_location_id IS NULL OR t.location_id = p_location_id)
    AND (p_pic_user_id IS NULL OR t.assigned_pic_user_id = p_pic_user_id)
    AND (
      p_status IS NULL
      OR (p_status = 'COMPLETED' AND t.tv_status = 'COMPLETED')
      OR (p_status = 'PENDING'   AND t.tv_status IN ('NOT_STARTED', 'IN_PROGRESS'))
      OR (p_status = 'FAILED'    AND t.tv_status IN ('FAILED', 'EXCEPTION'))
      OR (p_status = 'REVISION'  AND (t.tv_status = 'REVISION_REQUIRED' OR t.review_status = 'REVISION'))
      OR (p_status = 'VERIFIED'  AND t.review_status = 'APPROVED')
      OR (p_status = 'PROBLEM'   AND (t.tv_status IN ('FAILED', 'EXCEPTION', 'REVISION_REQUIRED', 'NOT_STARTED', 'IN_PROGRESS') OR t.review_status = 'REVISION'))
    )
  ORDER BY l.name, t.tv_floor NULLS FIRST, t.tv_name
  LIMIT p_limit;
$$;

-- ── Progress per PIC ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fs_cycle_pic_progress(p_cycle_id uuid)
RETURNS TABLE (
  pic_user_id uuid, pic_name text,
  building_total bigint, total_tv bigint, completed_tv bigint,
  failed_tv bigint, revision_tv bigint, pending_tv bigint, pct numeric
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    t.assigned_pic_user_id AS pic_user_id,
    COALESCE(u.full_name, 'Belum ada PIC') AS pic_name,
    count(DISTINCT t.location_id)                                                AS building_total,
    count(*)                                                                     AS total_tv,
    count(*) FILTER (WHERE t.tv_status = 'COMPLETED')                            AS completed_tv,
    count(*) FILTER (WHERE t.tv_status IN ('FAILED', 'EXCEPTION'))               AS failed_tv,
    count(*) FILTER (WHERE t.tv_status = 'REVISION_REQUIRED' OR t.review_status = 'REVISION') AS revision_tv,
    count(*) FILTER (WHERE t.tv_status IN ('NOT_STARTED', 'IN_PROGRESS'))        AS pending_tv,
    round(100.0 * count(*) FILTER (WHERE t.tv_status = 'COMPLETED') / NULLIF(count(*), 0), 1) AS pct
  FROM public.fs_cycle_tv_tasks t
  LEFT JOIN public.users u ON u.id = t.assigned_pic_user_id
  WHERE t.cycle_id = p_cycle_id
  GROUP BY t.assigned_pic_user_id, u.full_name
  ORDER BY (count(*) FILTER (WHERE t.tv_status = 'COMPLETED')::numeric / NULLIF(count(*), 0)) ASC NULLS FIRST;
$$;

-- ── "Needs Attention" — daftar masalah, bukan daftar yang baik-baik saja ─
-- Satu baris = satu gedung yang punya masalah, dengan jenis masalah yang
-- dominan. Admin tidak perlu melihat 3.982 TV yang beres (§40).
CREATE OR REPLACE FUNCTION public.fs_cycle_attention(p_cycle_id uuid, p_limit integer DEFAULT 12)
RETURNS TABLE (
  location_id uuid, location_name text, area_id uuid, area_name text,
  failed_tv bigint, revision_tv bigint, pending_tv bigint, total_tv bigint,
  pic_names text[], severity integer
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM (
    SELECT
      t.location_id,
      l.name AS location_name,
      t.area_id,
      a.name AS area_name,
      count(*) FILTER (WHERE t.tv_status IN ('FAILED', 'EXCEPTION'))               AS failed_tv,
      count(*) FILTER (WHERE t.tv_status = 'REVISION_REQUIRED' OR t.review_status = 'REVISION') AS revision_tv,
      count(*) FILTER (WHERE t.tv_status IN ('NOT_STARTED', 'IN_PROGRESS'))        AS pending_tv,
      count(*)                                                                     AS total_tv,
      array_remove(array_agg(DISTINCT u.full_name), NULL)                          AS pic_names,
      -- Bobot keparahan: gagal paling mendesak, lalu revisi, lalu belum
      -- dikerjakan. Dipakai untuk mengurutkan, bukan untuk ditampilkan.
      (count(*) FILTER (WHERE t.tv_status IN ('FAILED', 'EXCEPTION')) * 3
       + count(*) FILTER (WHERE t.tv_status = 'REVISION_REQUIRED' OR t.review_status = 'REVISION') * 2
       + count(*) FILTER (WHERE t.tv_status IN ('NOT_STARTED', 'IN_PROGRESS')))::integer AS severity
    FROM public.fs_cycle_tv_tasks t
    JOIN public.fs_locations l ON l.id = t.location_id
    JOIN public.fs_areas a     ON a.id = t.area_id
    LEFT JOIN public.users u   ON u.id = t.assigned_pic_user_id
    WHERE t.cycle_id = p_cycle_id
    GROUP BY t.location_id, l.name, t.area_id, a.name
  ) x
  WHERE x.severity > 0
  ORDER BY x.severity DESC
  LIMIT p_limit;
$$;

-- ── Generate scope pekerjaan dari assignment (§11) ──────────────────────
-- Admin cukup menugaskan PIC ke gedung/wilayah; sistem yang menurunkannya
-- jadi instance harian untuk tiap tanggal dalam cycle. Idempotent: dijalankan
-- dua kali tidak menggandakan apa pun (pola SELECT-lalu-INSERT yang sama
-- dengan fs_materialize_daily_instances, 013 - index unik di 011 tetap
-- penjaga terakhirnya).
CREATE OR REPLACE FUNCTION public.fs_generate_cycle_scope(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cycle record;
  v_assignment record;
  v_date date;
  v_content_id uuid;
  v_instance_id uuid;
  v_created integer := 0;
  v_linked integer := 0;
BEGIN
  IF NOT fs_is_provider() THEN
    RAISE EXCEPTION 'Hanya provider admin/supervisor yang boleh membuat scope pekerjaan cycle.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_cycle FROM public.fs_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_cycle.status NOT IN ('PLANNED', 'ACTIVE') THEN
    RAISE EXCEPTION 'Scope hanya bisa dibuat saat cycle masih PLANNED/ACTIVE (status sekarang: %).', v_cycle.status
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_assignment IN
    SELECT * FROM public.fs_pic_assignments a
    WHERE a.active
      AND a.project_id = v_cycle.project_id
      AND (
        a.cycle_id = p_cycle_id
        -- Assignment permanen (tanpa cycle) ikut terpakai bila rentang
        -- berlakunya menyentuh cycle ini - supaya admin tidak perlu
        -- menugaskan ulang orang yang sama tiap minggu.
        OR (a.cycle_id IS NULL
            AND a.effective_date <= v_cycle.execution_end
            AND (a.end_date IS NULL OR a.end_date >= v_cycle.execution_start))
      )
  LOOP
    v_content_id := COALESCE(v_cycle.content_id, v_assignment.content_id);

    v_date := v_cycle.execution_start;
    WHILE v_date <= v_cycle.execution_end LOOP
      SELECT id INTO v_instance_id
        FROM public.fs_execution_instances
        WHERE location_id = v_assignment.location_id
          AND COALESCE(execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = COALESCE(v_assignment.execution_point_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND COALESCE(content_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = COALESCE(v_content_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND instance_date = v_date;

      IF v_instance_id IS NULL THEN
        INSERT INTO public.fs_execution_instances
          (project_id, location_id, execution_point_id, schedule_id, assigned_pic_user_id,
           content_id, cycle_id, instance_date, status)
        VALUES
          (v_assignment.project_id, v_assignment.location_id, v_assignment.execution_point_id,
           v_assignment.schedule_id, v_assignment.user_id, v_content_id, p_cycle_id, v_date, 'NOT_STARTED');
        v_created := v_created + 1;
      ELSE
        -- Instance sudah ada (mis. dibuat lazy oleh PIC sebelum cycle
        -- dibuat) - sambungkan ke cycle ini supaya ikut terhitung, jangan
        -- biarkan menggantung tanpa cycle.
        UPDATE public.fs_execution_instances
          SET cycle_id = p_cycle_id, updated_at = now()
          WHERE id = v_instance_id AND cycle_id IS DISTINCT FROM p_cycle_id;
        IF FOUND THEN v_linked := v_linked + 1; END IF;
      END IF;

      v_date := v_date + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'linked', v_linked);
END;
$$;

-- ── Snapshot ringkasan cycle (riwayat yang tahan pembersihan) ───────────
-- SECURITY DEFINER: harus bisa menghitung SELURUH cycle apa adanya, termasuk
-- saat dipanggil oleh proses yang RLS-nya lebih sempit.
CREATE OR REPLACE FUNCTION public.fs_snapshot_cycle_summary(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cycle record;
  v_total integer; v_completed integer; v_failed integer;
  v_revision integer; v_pending integer; v_verified integer;
  v_regions jsonb; v_pics jsonb;
BEGIN
  SELECT * INTO v_cycle FROM public.fs_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE tv_status = 'COMPLETED'),
    count(*) FILTER (WHERE tv_status IN ('FAILED', 'EXCEPTION')),
    count(*) FILTER (WHERE tv_status = 'REVISION_REQUIRED' OR review_status = 'REVISION'),
    count(*) FILTER (WHERE tv_status IN ('NOT_STARTED', 'IN_PROGRESS')),
    count(*) FILTER (WHERE review_status = 'APPROVED')
  INTO v_total, v_completed, v_failed, v_revision, v_pending, v_verified
  FROM public.fs_cycle_tv_tasks WHERE cycle_id = p_cycle_id;

  SELECT COALESCE(jsonb_agg(r ORDER BY r ->> 'area_name'), '[]'::jsonb) INTO v_regions FROM (
    SELECT jsonb_build_object(
      'area_name', a.name,
      'total_tv', count(*),
      'completed_tv', count(*) FILTER (WHERE t.tv_status = 'COMPLETED'),
      'failed_tv', count(*) FILTER (WHERE t.tv_status IN ('FAILED', 'EXCEPTION')),
      'revision_tv', count(*) FILTER (WHERE t.tv_status = 'REVISION_REQUIRED' OR t.review_status = 'REVISION')
    ) AS r
    FROM public.fs_cycle_tv_tasks t
    JOIN public.fs_areas a ON a.id = t.area_id
    WHERE t.cycle_id = p_cycle_id
    GROUP BY a.name
  ) x;

  SELECT COALESCE(jsonb_agg(p ORDER BY p ->> 'pic_name'), '[]'::jsonb) INTO v_pics FROM (
    SELECT jsonb_build_object(
      'pic_name', COALESCE(u.full_name, 'Belum ada PIC'),
      'total_tv', count(*),
      'completed_tv', count(*) FILTER (WHERE t.tv_status = 'COMPLETED')
    ) AS p
    FROM public.fs_cycle_tv_tasks t
    LEFT JOIN public.users u ON u.id = t.assigned_pic_user_id
    WHERE t.cycle_id = p_cycle_id
    GROUP BY u.full_name
  ) y;

  INSERT INTO public.fs_cycle_summaries (
    cycle_id, project_id, project_name, cycle_name, content_name, content_version,
    execution_start, execution_end, total_tv, completed_tv, failed_tv, revision_tv,
    not_started_tv, verified_tv, region_breakdown, pic_breakdown,
    closed_by_name, closed_at
  )
  SELECT
    v_cycle.id, v_cycle.project_id, p.name, v_cycle.name, c.name, c.version,
    v_cycle.execution_start, v_cycle.execution_end,
    v_total, v_completed, v_failed, v_revision, v_pending, v_verified,
    v_regions, v_pics,
    cu.full_name, v_cycle.closed_at
  FROM public.fs_projects p
  LEFT JOIN public.fs_content c ON c.id = v_cycle.content_id
  LEFT JOIN public.users cu     ON cu.id = v_cycle.closed_by
  WHERE p.id = v_cycle.project_id
  ON CONFLICT (cycle_id) DO UPDATE SET
    total_tv = EXCLUDED.total_tv,
    completed_tv = EXCLUDED.completed_tv,
    failed_tv = EXCLUDED.failed_tv,
    revision_tv = EXCLUDED.revision_tv,
    not_started_tv = EXCLUDED.not_started_tv,
    verified_tv = EXCLUDED.verified_tv,
    region_breakdown = EXCLUDED.region_breakdown,
    pic_breakdown = EXCLUDED.pic_breakdown,
    closed_by_name = EXCLUDED.closed_by_name,
    closed_at = EXCLUDED.closed_at;

  RETURN jsonb_build_object('total_tv', v_total, 'completed_tv', v_completed,
    'failed_tv', v_failed, 'revision_tv', v_revision, 'pending_tv', v_pending);
END;
$$;

-- ── Transisi status cycle ───────────────────────────────────────────────
-- Allow-list eksplisit (dari, ke, aktor) - pola yang sama dengan
-- fs_status_transition (005/017) untuk instance. Tidak ada jalur lain yang
-- boleh mengubah fs_cycles.status (trigger pembeku di 022 menutup jalur
-- PostgREST langsung).
CREATE OR REPLACE FUNCTION public.fs_cycle_transition(
  p_cycle_id uuid,
  p_new_status text,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cycle record;
  v_user_id uuid := jwt_user_id();
  v_allowed boolean := false;
  v_belum integer;
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
    -- Ditarik kembali ke lapangan karena ada revisi - bukan mundur yang
    -- keliru, ini memang bagian dari alur (§23).
    v_allowed := true;
  ELSIF v_cycle.status = 'UNDER_REVIEW' AND p_new_status = 'READY_TO_CLOSE'
        AND (fs_is_client_reviewer() OR fs_is_provider_admin()) THEN
    v_allowed := true;
  ELSIF v_cycle.status = 'READY_TO_CLOSE' AND p_new_status = 'CLOSED' AND fs_is_provider_admin() THEN
    v_allowed := true;
  ELSIF v_cycle.status = 'CLEAR_PENDING' AND p_new_status = 'CLOSED' AND fs_is_provider_admin() THEN
    -- Membatalkan permintaan clear.
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transisi cycle % -> % tidak diizinkan untuk aktor ini.', v_cycle.status, p_new_status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Syarat menuju READY_TO_CLOSE: tidak ada lagi TV yang menggantung.
  -- FAILED/SKIPPED/EXCEPTION dianggap TUNTAS (sudah ada keputusan+alasan);
  -- yang menghalangi hanyalah yang belum diputuskan sama sekali.
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

  -- Begitu ditutup, ringkasannya dibekukan - inilah yang tetap ada setelah
  -- storage dibersihkan nanti.
  IF p_new_status = 'CLOSED' THEN
    PERFORM public.fs_snapshot_cycle_summary(p_cycle_id);
  END IF;

  RETURN jsonb_build_object('id', p_cycle_id, 'status', p_new_status);
END;
$$;

-- ── Minta pembersihan data (§25) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fs_request_clear(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cycle record;
  v_objects integer;
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

  RETURN jsonb_build_object('id', p_cycle_id, 'status', 'CLEAR_PENDING', 'evidence_objects', v_objects);
END;
$$;

-- ── Daftar file yang akan dihapus (dipakai route server sebelum menghapus) ─
CREATE OR REPLACE FUNCTION public.fs_cycle_evidence_paths(p_cycle_id uuid)
RETURNS TABLE (id uuid, bucket text, path text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT e.id, e.bucket, e.path
  FROM public.fs_evidence e
  JOIN public.fs_execution_instances i ON i.id = e.execution_instance_id
  WHERE i.cycle_id = p_cycle_id;
$$;

-- ── Finalisasi pembersihan ──────────────────────────────────────────────
-- DIPANGGIL SETELAH file benar-benar dihapus dari Storage oleh route server
-- (app/api/cycles/clear). Angka p_objects_deleted/p_objects_failed datang
-- dari hasil penghapusan yang SESUNGGUHNYA - kalau ada yang gagal, cycle
-- ditandai CLEAR_PARTIAL, bukan CLEARED (§48: jangan berpura-pura selesai).
--
-- Yang dihapus di sini HANYA data operasional berukuran besar
-- (metadata evidence + jejak GPS). fs_cycle_summaries, fs_reviews,
-- fs_audit_log, dan baris cycle-nya sendiri SENGAJA TIDAK disentuh -
-- itulah riwayat yang harus tetap ada (§26).
--
-- DUA JALUR PEMANGGIL, dibedakan dari ADA/TIDAKNYA identitas JWT:
--   ada klaim 'sub' -> permintaan browser atas nama seseorang -> wajib
--                      lolos fs_is_provider_admin().
--   tidak ada       -> service role (route server, yang memang tidak punya
--                      JWT pengguna) -> wajib menyebut p_actor_id, dan peran
--                      aktor itu DIVERIFIKASI ULANG ke tabel users.
--
-- CATATAN PENTING (bekas bug yang ditemukan saat pengujian peran): jangan
-- pernah memakai current_user untuk membedakan kedua jalur ini. Di dalam
-- fungsi SECURITY DEFINER, current_user adalah PEMILIK fungsi, bukan
-- pemanggilnya - versi pertama fungsi ini karenanya meloloskan akun client
-- ke cabang "server dipercaya" dan membiarkannya menyetujui penghapusan
-- permanen. current_user hanya sah dipakai di dalam trigger biasa
-- (fs_guard_* di 011/015/022), yang memang berjalan sebagai pemanggil.
CREATE OR REPLACE FUNCTION public.fs_jwt_subject_aman()
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_sub text;
BEGIN
  -- Pada jalur service role klaimnya bisa kosong/bukan JSON, dan jwt_claim()
  -- bawaan platform melempar galat saat mem-parsing-nya. Yang dibutuhkan di
  -- sini cuma "ada identitas orang atau tidak".
  BEGIN
    v_sub := NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub';
  EXCEPTION WHEN OTHERS THEN
    v_sub := NULL;
  END;
  RETURN NULLIF(COALESCE(v_sub, ''), '');
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_finalize_clear(
  p_cycle_id uuid,
  p_objects_deleted integer,
  p_objects_failed integer,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cycle record;
  v_actor uuid;
  v_aktor_admin boolean;
  v_evidence_rows integer := 0;
  v_gps_rows integer := 0;
  v_status text;
BEGIN
  IF public.fs_jwt_subject_aman() IS NOT NULL THEN
    IF NOT fs_is_provider_admin() THEN
      RAISE EXCEPTION 'Hanya Provider Admin yang boleh menyetujui pembersihan data.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_actor := jwt_user_id();
  ELSE
    IF p_actor_id IS NULL THEN
      RAISE EXCEPTION 'p_actor_id wajib diisi pada pemanggilan dari server - jejak audit tidak boleh kosong.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT (
      lower(u.role) IN ('admin', 'superadmin')
      OR u.fs_role = 'PROVIDER_ADMIN'
      OR (lower(u.role) IN ('team', 'team_pts') AND u.access_level = 'full')
    ) INTO v_aktor_admin
    FROM public.users u WHERE u.id = p_actor_id;

    IF NOT COALESCE(v_aktor_admin, false) THEN
      RAISE EXCEPTION 'Aktor yang disebutkan bukan Provider Admin.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_actor := p_actor_id;
  END IF;

  SELECT * INTO v_cycle FROM public.fs_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle tidak ditemukan.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_cycle.status NOT IN ('CLEAR_PENDING', 'CLEAR_PARTIAL') THEN
    RAISE EXCEPTION 'Cycle harus berstatus CLEAR_PENDING dulu (status sekarang: %).', v_cycle.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Bekukan ringkasan SEKALI LAGI sebelum datanya hilang - kalau ada
  -- perubahan sejak ditutup, yang tersimpan adalah keadaan terakhir yang
  -- benar, bukan potret basi.
  PERFORM public.fs_snapshot_cycle_summary(p_cycle_id);

  WITH hapus AS (
    DELETE FROM public.fs_evidence e
    USING public.fs_execution_instances i
    WHERE i.id = e.execution_instance_id AND i.cycle_id = p_cycle_id
    RETURNING e.id
  ) SELECT count(*) INTO v_evidence_rows FROM hapus;

  WITH hapus_gps AS (
    DELETE FROM public.fs_gps_events g
    USING public.fs_execution_instances i
    WHERE i.id = g.execution_instance_id AND i.cycle_id = p_cycle_id
    RETURNING g.id
  ) SELECT count(*) INTO v_gps_rows FROM hapus_gps;

  v_status := CASE WHEN COALESCE(p_objects_failed, 0) > 0 THEN 'CLEAR_PARTIAL' ELSE 'CLEARED' END;

  UPDATE public.fs_cycles
    SET status = v_status,
        cleared_by = v_actor,
        cleared_at = now(),
        clear_objects_deleted = COALESCE(p_objects_deleted, 0),
        clear_objects_failed = COALESCE(p_objects_failed, 0),
        updated_at = now()
    WHERE id = p_cycle_id;

  UPDATE public.fs_cycle_summaries s
    SET cleared_by_name = (SELECT full_name FROM public.users WHERE id = v_actor),
        cleared_at = now(),
        objects_deleted = COALESCE(p_objects_deleted, 0),
        objects_failed = COALESCE(p_objects_failed, 0)
    WHERE s.cycle_id = p_cycle_id;

  RETURN jsonb_build_object(
    'id', p_cycle_id, 'status', v_status,
    'evidence_rows_deleted', v_evidence_rows,
    'gps_rows_deleted', v_gps_rows,
    'objects_deleted', COALESCE(p_objects_deleted, 0),
    'objects_failed', COALESCE(p_objects_failed, 0)
  );
END;
$$;

-- ── Sambungkan instance harian ke cycle secara otomatis ─────────────────
-- fs_ensure_today_instance (011) dipanggil PIC saat membuka halaman tugas.
-- Versi ini menambahkan SATU hal: instance yang lahir dari sana langsung
-- memakai cycle yang sedang berjalan, supaya tidak ada pekerjaan yang
-- "tidak terhitung di cycle mana pun" hanya karena PIC bergerak lebih dulu
-- daripada admin.
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
  v_cycle_id uuid;
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

  v_cycle_id := COALESCE(v_assignment.cycle_id, public.fs_active_cycle(v_assignment.project_id, current_date));

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
      (project_id, location_id, execution_point_id, schedule_id, assigned_pic_user_id,
       content_id, cycle_id, instance_date, status)
    VALUES
      (v_assignment.project_id, v_assignment.location_id, v_assignment.execution_point_id,
       v_assignment.schedule_id, v_assignment.user_id, v_assignment.content_id, v_cycle_id,
       current_date, 'NOT_STARTED')
    RETURNING id INTO v_instance_id;
  ELSIF v_cycle_id IS NOT NULL THEN
    UPDATE public.fs_execution_instances
      SET cycle_id = v_cycle_id, updated_at = now()
      WHERE id = v_instance_id AND cycle_id IS NULL;
  END IF;

  RETURN v_instance_id;
END;
$$;

-- Fungsi lifecycle yang MENGUBAH data tidak boleh dipanggil tanpa identitas
-- yang jelas; pemeriksaan perannya ada di dalam masing-masing fungsi (di
-- atas), tapi dicatat di sini supaya jelas ini keputusan sadar, bukan lupa.
COMMENT ON FUNCTION public.fs_finalize_clear(uuid, integer, integer, uuid) IS
  'Dipanggil hanya oleh route server setelah penghapusan Storage yang sesungguhnya. '
  'Memeriksa fs_is_provider_admin() sendiri - jangan andalkan UI menyembunyikan tombol.';
