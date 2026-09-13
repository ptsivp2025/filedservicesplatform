-- ============================================================================
-- Operational Control Platform — Migration 022
-- WEEKEND CYCLE sebagai objek inti + perbaikan definisi "TV selesai".
--
-- KENAPA ADA:
--  (1) Seluruh operasi platform ini berirama MINGGUAN (Sabtu-Minggu PIC
--      upload konten, Senin-Minggu berikutnya direview, lalu ditutup dan
--      storage-nya dibersihkan). Sebelum migrasi ini TIDAK ADA objek yang
--      mewakili satu putaran kerja itu - semua hanya bergantung pada
--      fs_execution_instances.instance_date yang lepas satu sama lain, jadi
--      pertanyaan paling dasar operasional ("cycle ini sudah beres belum?",
--      "boleh ditutup belum?", "boleh dibersihkan belum?") tidak punya
--      tempat untuk dijawab.
--  (2) BUG AGREGASI: fs_execution_instances.execution_point_id boleh NULL
--      (instance selevel LOKASI = semua TV di gedung itu) ATAU terisi
--      (instance untuk SATU TV). Kode dashboard lama (muatDeploymentStat di
--      ExecutionWidget.tsx) SELALU memakai "jumlah TV di lokasi" sebagai
--      totalTv untuk SETIAP instance - jadi satu gedung 10 TV dengan 3
--      instance per-TV terhitung 30 TV. Angka completion-nya mustahil benar.
--      View fs_cycle_tv_tasks di bawah menjadi SATU-SATUNYA definisi resmi
--      "apa yang dihitung sebagai satu tugas TV".
--  (3) "Checklist terisi" TIDAK SAMA DENGAN "TV berhasil di-deploy". FAILED/
--      SKIPPED/EXCEPTION tidak boleh ikut terhitung selesai, dan kegagalan
--      wajib punya ALASAN yang bisa ditindaklanjuti, bukan cuma label merah.
--
-- Jalankan SETELAH 001-021.
-- ============================================================================

-- ── fs_cycles ────────────────────────────────────────────────────────────
-- Satu baris = satu putaran kerja akhir pekan untuk satu project.
--
-- review_start/review_end DIPISAH dari execution_start/execution_end dengan
-- sengaja: masa kerja (Sabtu-Minggu) dan masa review client (mis. 2 minggu
-- sesudahnya) adalah dua rentang berbeda - menyatukannya membuat "cycle
-- sudah lewat" rancu dengan "cycle sudah boleh ditutup".
CREATE TABLE public.fs_cycles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text NOT NULL,
  content_id uuid,
  execution_start date NOT NULL,
  execution_end date NOT NULL,
  review_start date,
  review_end date,
  status text NOT NULL DEFAULT 'PLANNED',
  -- Jejak keputusan (§46 master prompt) - siapa menutup, siapa meminta
  -- pembersihan, siapa menyetujuinya. Sengaja kolom eksplisit, bukan cuma
  -- mengandalkan fs_audit_log, karena ketiganya ikut ditampilkan di UI
  -- riwayat dan harus tetap ada setelah data operasional dibersihkan.
  closed_by uuid,
  closed_at timestamptz,
  clear_requested_by uuid,
  clear_requested_at timestamptz,
  cleared_by uuid,
  cleared_at timestamptz,
  /** Hasil pembersihan storage: NULL (belum), PARTIAL (sebagian gagal),
   *  DONE. CLEAR_PARTIAL tidak boleh disebut CLEARED (§48). */
  clear_objects_deleted integer,
  clear_objects_failed integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES public.fs_content(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
  FOREIGN KEY (closed_by) REFERENCES public.users(id) ON DELETE SET NULL,
  FOREIGN KEY (clear_requested_by) REFERENCES public.users(id) ON DELETE SET NULL,
  FOREIGN KEY (cleared_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT fs_cycles_status_check CHECK (status = ANY (ARRAY[
    'PLANNED', 'ACTIVE', 'UNDER_REVIEW', 'READY_TO_CLOSE',
    'CLOSED', 'CLEAR_PENDING', 'CLEAR_PARTIAL', 'CLEARED'
  ])),
  CONSTRAINT fs_cycles_range_check CHECK (execution_end >= execution_start),
  CONSTRAINT fs_cycles_review_range_check CHECK (review_end IS NULL OR review_start IS NULL OR review_end >= review_start),
  -- Satu project tidak boleh punya dua cycle dengan rentang eksekusi sama -
  -- itu pasti kekeliruan input, dan membuat "cycle aktif" jadi ambigu.
  UNIQUE (project_id, execution_start, execution_end)
);

CREATE INDEX idx_fs_cycles_project_status ON public.fs_cycles (project_id, status);
CREATE INDEX idx_fs_cycles_execution ON public.fs_cycles (execution_start, execution_end);

-- ── Sambungkan pekerjaan ke cycle ────────────────────────────────────────
-- Nullable: instance lama (sebelum konsep cycle ada) tetap sah tanpa cycle.
ALTER TABLE public.fs_execution_instances
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.fs_cycles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fs_execution_instances_cycle ON public.fs_execution_instances (cycle_id);

-- Assignment juga boleh terikat cycle: "Budi pegang Jakarta Pusat UNTUK
-- weekend ini" berbeda dari "Budi pegang Jakarta Pusat selamanya". Tetap
-- nullable supaya assignment permanen yang sudah ada tidak berubah arti.
ALTER TABLE public.fs_pic_assignments
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.fs_cycles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_fs_pic_assignments_cycle ON public.fs_pic_assignments (cycle_id);

-- ── Status per TV: alasan kegagalan wajib bisa ditindaklanjuti ───────────
-- "FAILED" tanpa alasan tidak memberi tahu siapa pun apa yang harus
-- dikerjakan berikutnya (§20 master prompt).
ALTER TABLE public.fs_execution_point_status
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS failure_detail text;

ALTER TABLE public.fs_execution_point_status
  DROP CONSTRAINT IF EXISTS fs_execution_point_status_failure_reason_check;
ALTER TABLE public.fs_execution_point_status
  ADD CONSTRAINT fs_execution_point_status_failure_reason_check CHECK (
    failure_reason IS NULL OR failure_reason = ANY (ARRAY[
      'TV_OFFLINE', 'NETWORK', 'DEVICE', 'CONTENT', 'ACCESS', 'OTHER'
    ])
  );

-- REVISION_REQUIRED ditambahkan ke status per-TV: sebelumnya revisi hanya
-- ada di level instance (seluruh gedung), jadi client tidak bisa bilang
-- "TV-0021 saja yang perlu diulang" (§23). Reviewer menandai per TV, PIC
-- melihat daftar TV yang perlu diulang - bukan mengulang satu gedung penuh.
ALTER TABLE public.fs_execution_point_status
  DROP CONSTRAINT IF EXISTS fs_execution_point_status_check;
ALTER TABLE public.fs_execution_point_status
  ADD CONSTRAINT fs_execution_point_status_check CHECK (status = ANY (ARRAY[
    'NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED', 'EXCEPTION', 'REVISION_REQUIRED'
  ]));

-- review_status dapat nilai REVISION: reviewer menolak TV tertentu.
ALTER TABLE public.fs_execution_point_status
  DROP CONSTRAINT IF EXISTS fs_execution_point_review_check;
ALTER TABLE public.fs_execution_point_status
  ADD CONSTRAINT fs_execution_point_review_check CHECK (review_status = ANY (ARRAY[
    'PENDING', 'APPROVED', 'REVISION'
  ]));

-- Alasan revisi dari reviewer, per TV.
ALTER TABLE public.fs_execution_point_status
  ADD COLUMN IF NOT EXISTS review_notes text;

-- ── fs_cycle_tv_tasks — SATU-SATUNYA definisi "tugas TV" ────────────────
--
-- Inilah perbaikan bug agregasi. Satu baris = satu TV yang HARUS dikerjakan
-- pada satu execution instance:
--   - instance selevel lokasi (execution_point_id NULL) -> SEMUA TV aktif
--     di gedung itu, masing-masing satu baris;
--   - instance selevel TV (execution_point_id terisi)   -> TEPAT satu baris.
-- TV yang belum pernah disentuh sama sekali tetap muncul (LEFT JOIN) sebagai
-- NOT_STARTED - kalau tidak, "belum dikerjakan" akan hilang dari penyebut
-- dan completion selalu terlihat 100%.
--
-- DEDUPE PER CYCLE (DISTINCT ON): PIC bekerja Sabtu DAN Minggu, jadi satu
-- gedung punya instance untuk KEDUA hari. Tanpa dedupe, setiap TV terhitung
-- dua kali dan "4.000 TV" berubah jadi 8.000 di dashboard. Yang menang
-- adalah AKSI TERAKHIR pada TV itu - TV yang gagal Sabtu lalu berhasil
-- Minggu memang berstatus COMPLETED, bukan dua baris yang saling
-- bertentangan.
--
-- security_invoker = on: view ini WAJIB tunduk pada RLS tabel di bawahnya
-- (default PostgreSQL menjalankan view sebagai PEMILIKNYA, yang berarti
-- menembus RLS - persis lubang yang tidak boleh dibuka di sini).
CREATE OR REPLACE VIEW public.fs_cycle_tv_tasks
WITH (security_invoker = on) AS
SELECT DISTINCT ON (i.cycle_id, pt.id)
  i.cycle_id,
  i.project_id,
  i.id                AS instance_id,
  i.instance_date,
  i.status            AS instance_status,
  l.area_id,
  i.location_id,
  pt.id               AS execution_point_id,
  pt.name             AS tv_name,
  pt.floor            AS tv_floor,
  i.assigned_pic_user_id,
  i.content_id,
  COALESCE(ps.status, 'NOT_STARTED')        AS tv_status,
  COALESCE(ps.review_status, 'PENDING')     AS review_status,
  ps.failure_reason,
  ps.failure_detail,
  ps.review_notes,
  ps.notes            AS pic_notes,
  ps.marked_at,
  ps.marked_by
FROM public.fs_execution_instances i
JOIN public.fs_locations l        ON l.id = i.location_id
JOIN public.fs_execution_points pt
  ON pt.location_id = i.location_id
 AND pt.status = 'active'
 AND (i.execution_point_id IS NULL OR pt.id = i.execution_point_id)
LEFT JOIN public.fs_execution_point_status ps
  ON ps.execution_instance_id = i.id
 AND ps.execution_point_id = pt.id
ORDER BY
  i.cycle_id, pt.id,
  ps.marked_at DESC NULLS LAST,
  ps.updated_at DESC NULLS LAST,
  i.instance_date DESC;

COMMENT ON VIEW public.fs_cycle_tv_tasks IS
  'Definisi resmi satu "tugas TV" dalam sebuah cycle. Semua agregasi '
  '(dashboard, region, building, PIC, review) WAJIB dihitung dari sini supaya '
  'tidak ada dua angka completion yang berbeda di layar yang berbeda.';

-- ── fs_cycle_summaries — riwayat yang SELAMAT dari pembersihan ───────────
-- Setelah storage dibersihkan, inilah yang tersisa. Sengaja denormalisasi
-- penuh (nama project/content/region disimpan sebagai teks, bukan FK saja):
-- ringkasan historis harus tetap terbaca walaupun master data-nya kelak
-- berubah nama atau dihapus (§26).
CREATE TABLE public.fs_cycle_summaries (
  cycle_id uuid NOT NULL,
  project_id uuid,
  project_name text,
  cycle_name text NOT NULL,
  content_name text,
  content_version integer,
  execution_start date NOT NULL,
  execution_end date NOT NULL,
  total_tv integer NOT NULL DEFAULT 0,
  completed_tv integer NOT NULL DEFAULT 0,
  failed_tv integer NOT NULL DEFAULT 0,
  revision_tv integer NOT NULL DEFAULT 0,
  not_started_tv integer NOT NULL DEFAULT 0,
  verified_tv integer NOT NULL DEFAULT 0,
  region_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  pic_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  closed_by_name text,
  closed_at timestamptz,
  cleared_by_name text,
  cleared_at timestamptz,
  objects_deleted integer,
  objects_failed integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id),
  FOREIGN KEY (cycle_id) REFERENCES public.fs_cycles(id) ON DELETE CASCADE
);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fs_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_cycle_summaries ENABLE ROW LEVEL SECURITY;

-- Baca: provider, client viewer, DAN PIC. PIC perlu tahu cycle mana yang
-- aktif untuk halaman "Tugas Weekend Saya" - tanpa ini halaman PIC harus
-- menebak cycle dari tanggal, persis masalah yang migrasi ini perbaiki.
-- Yang dibatasi untuk PIC adalah data TV-nya (lewat RLS fs_* yang sudah
-- ada), bukan keberadaan cycle-nya.
CREATE POLICY fs_cycles_select ON public.fs_cycles
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY fs_cycles_insert ON public.fs_cycles
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider_admin());

-- UPDATE langsung hanya untuk kolom deskriptif (nama/konten/tanggal review)
-- oleh provider admin. Perpindahan STATUS tidak lewat sini - lihat
-- fs_cycle_transition() di migrasi 023, dan trigger pembeku di bawah.
CREATE POLICY fs_cycles_update ON public.fs_cycles
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider_admin())
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_cycles_delete ON public.fs_cycles
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider_admin() AND status IN ('PLANNED'));

CREATE POLICY fs_cycle_summaries_select ON public.fs_cycle_summaries
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer());
-- Tidak ada policy tulis: satu-satunya penulis adalah fungsi SECURITY
-- DEFINER saat cycle ditutup/dibersihkan.

-- Pembeku kolom status & jejak keputusan: klien boleh menyunting nama/
-- tanggal review, TIDAK BOLEH menulis status atau kolom "siapa menutup /
-- siapa membersihkan" langsung dari PostgREST. Pola sama persis dengan
-- fs_guard_daily_report_columns (011) dan fs_guard_execution_point_status
-- _columns (015): baris yang sama ditulis dua pihak, masing-masing dikunci
-- ke kolom miliknya.
CREATE OR REPLACE FUNCTION public.fs_guard_cycle_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  NEW.status              := OLD.status;
  NEW.closed_by           := OLD.closed_by;
  NEW.closed_at           := OLD.closed_at;
  NEW.clear_requested_by  := OLD.clear_requested_by;
  NEW.clear_requested_at  := OLD.clear_requested_at;
  NEW.cleared_by          := OLD.cleared_by;
  NEW.cleared_at          := OLD.cleared_at;
  NEW.clear_objects_deleted := OLD.clear_objects_deleted;
  NEW.clear_objects_failed  := OLD.clear_objects_failed;
  NEW.created_by          := OLD.created_by;
  NEW.created_at          := OLD.created_at;
  NEW.project_id          := OLD.project_id;
  NEW.updated_at          := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fs_guard_cycle_columns
  BEFORE UPDATE ON public.fs_cycles
  FOR EACH ROW EXECUTE FUNCTION public.fs_guard_cycle_columns();

-- Audit trail untuk cycle (§46) - memakai trigger generik dari migrasi 014.
CREATE TRIGGER trg_fs_audit_cycles
  AFTER INSERT OR UPDATE OR DELETE ON public.fs_cycles
  FOR EACH ROW EXECUTE FUNCTION public.fs_audit_trigger();
