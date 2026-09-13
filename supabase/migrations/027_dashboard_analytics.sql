-- ============================================================================
-- Operational Control Platform — Migration 027
-- Agregasi untuk GRAFIK dashboard.
--
-- Semua dihitung dari view fs_cycle_tv_tasks (022) - sumber yang sama persis
-- dengan angka ringkasan di kartu KPI. Grafik tidak boleh bercerita berbeda
-- dari angka di atasnya, dan itu hanya dijamin kalau sumbernya memang satu.
--
-- Empat fungsi, empat pertanyaan yang TIDAK terjawab oleh angka total:
--   1. failure_breakdown  -> "15 TV gagal" karena apa? (tindakannya berbeda:
--      kirim teknisi, telepon pengelola gedung, atau ganti file konten)
--   2. daily_progress     -> apakah Minggu dipakai mengejar sisa Sabtu?
--   3. building_distribution -> berapa gedung yang tinggal sedikit lagi vs
--      yang belum tersentuh sama sekali - dua masalah yang sangat berbeda
--      dan keduanya tenggelam di dalam satu angka persen.
--   4. cycle_trend        -> membaik atau memburuk dibanding pekan lalu.
--
-- Jalankan SETELAH 026.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fs_cycle_failure_breakdown(p_cycle_id uuid)
RETURNS TABLE (alasan text, jumlah bigint)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(t.failure_reason, 'TIDAK_DISEBUT') AS alasan, count(*) AS jumlah
  FROM public.fs_cycle_tv_tasks t
  WHERE t.cycle_id = p_cycle_id
    AND t.tv_status IN ('FAILED', 'EXCEPTION')
  GROUP BY COALESCE(t.failure_reason, 'TIDAK_DISEBUT')
  ORDER BY count(*) DESC;
$$;

CREATE OR REPLACE FUNCTION public.fs_cycle_daily_progress(p_cycle_id uuid)
RETURNS TABLE (tanggal date, selesai bigint, gagal bigint)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    (t.marked_at AT TIME ZONE 'Asia/Jakarta')::date AS tanggal,
    count(*) FILTER (WHERE t.tv_status = 'COMPLETED')              AS selesai,
    count(*) FILTER (WHERE t.tv_status IN ('FAILED', 'EXCEPTION')) AS gagal
  FROM public.fs_cycle_tv_tasks t
  WHERE t.cycle_id = p_cycle_id AND t.marked_at IS NOT NULL
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.fs_cycle_building_distribution(p_cycle_id uuid)
RETURNS TABLE (kelompok text, jumlah bigint)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH per_gedung AS (
    SELECT t.location_id,
           count(*) AS total,
           count(*) FILTER (WHERE t.tv_status = 'COMPLETED') AS selesai
    FROM public.fs_cycle_tv_tasks t
    WHERE t.cycle_id = p_cycle_id
    GROUP BY t.location_id
  ), berlabel AS (
    SELECT CASE
             WHEN selesai = total THEN 'Tuntas'
             WHEN selesai::numeric / NULLIF(total, 0) >= 0.75 THEN 'Hampir (75-99%)'
             WHEN selesai::numeric / NULLIF(total, 0) >= 0.40 THEN 'Separuh (40-74%)'
             WHEN selesai > 0 THEN 'Baru mulai (<40%)'
             ELSE 'Belum tersentuh'
           END AS kelompok
    FROM per_gedung
  )
  SELECT kelompok, count(*) FROM berlabel GROUP BY kelompok;
$$;

-- Siklus yang sudah ditutup memakai ringkasan beku (fs_cycle_summaries);
-- yang masih berjalan dihitung langsung - supaya titik terakhir grafik selalu
-- keadaan hari ini, bukan kosong sampai siklusnya ditutup.
CREATE OR REPLACE FUNCTION public.fs_cycle_trend(p_project_id uuid, p_limit integer DEFAULT 8)
RETURNS TABLE (
  cycle_id uuid, nama text, mulai date, total_tv bigint, selesai_tv bigint,
  gagal_tv bigint, pct numeric, status text
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT x.cycle_id, x.nama, x.mulai, x.total_tv, x.selesai_tv, x.gagal_tv, x.pct, x.status
  FROM (
    SELECT
      c.id AS cycle_id, c.name AS nama, c.execution_start AS mulai,
      COALESCE(s.total_tv, (SELECT count(*) FROM public.fs_cycle_tv_tasks t WHERE t.cycle_id = c.id))::bigint AS total_tv,
      COALESCE(s.completed_tv, (SELECT count(*) FROM public.fs_cycle_tv_tasks t WHERE t.cycle_id = c.id AND t.tv_status = 'COMPLETED'))::bigint AS selesai_tv,
      COALESCE(s.failed_tv, (SELECT count(*) FROM public.fs_cycle_tv_tasks t WHERE t.cycle_id = c.id AND t.tv_status IN ('FAILED','EXCEPTION')))::bigint AS gagal_tv,
      round(100.0 * COALESCE(s.completed_tv, (SELECT count(*) FROM public.fs_cycle_tv_tasks t WHERE t.cycle_id = c.id AND t.tv_status = 'COMPLETED'))
            / NULLIF(COALESCE(s.total_tv, (SELECT count(*) FROM public.fs_cycle_tv_tasks t WHERE t.cycle_id = c.id)), 0), 1) AS pct,
      c.status
    FROM public.fs_cycles c
    LEFT JOIN public.fs_cycle_summaries s ON s.cycle_id = c.id
    WHERE c.project_id = p_project_id
    ORDER BY c.execution_start DESC
    LIMIT p_limit
  ) x
  ORDER BY x.mulai;
$$;
