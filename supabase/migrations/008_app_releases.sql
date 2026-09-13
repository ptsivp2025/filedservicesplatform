-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 008
-- App Releases: riwayat versi APK Android (Capacitor) yang tampil di Admin
-- Panel -> App Rilis. Baris di sini ditulis lewat /api/app-releases
-- (service_role, dari GitHub Actions setelah build APK berhasil ATAU dari
-- upload manual admin) - anon TIDAK PERNAH insert langsung ke tabel ini.
--
-- Run AFTER 001-007.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_name text NOT NULL,
  version_code integer NOT NULL UNIQUE,
  changelog text,
  apk_path text NOT NULL,
  apk_size_bytes bigint,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

-- Baca: metadata rilis (nomor versi, changelog, path file) tidak rahasia -
-- siapa pun yang sudah login (Admin Panel) boleh melihat daftarnya untuk
-- mengunduh/membagikan link APK ke technician.
CREATE POLICY app_releases_select ON public.app_releases
  FOR SELECT TO anon, authenticated
  USING (true);

-- Tidak ada policy INSERT/UPDATE/DELETE untuk anon/authenticated dengan
-- sengaja - satu-satunya jalan masuk adalah /api/app-releases yang memakai
-- service_role (melewati RLS), supaya penomoran version_code tidak bisa
-- dipalsukan langsung dari browser.

-- Bucket publik: file APK memang dibagikan lewat link langsung (WhatsApp/
-- Admin Panel) ke technician untuk diinstall, bukan data sensitif seperti
-- fs-evidence (foto lokasi klien).
INSERT INTO storage.buckets (id, name, public)
VALUES ('app-releases', 'app-releases', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY app_releases_storage_select ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'app-releases');
