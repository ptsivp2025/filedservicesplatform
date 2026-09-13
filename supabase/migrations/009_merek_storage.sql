-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 009
-- Dashboard Setting (branding) storage bucket.
--
-- Run AFTER 001-008.
--
-- WHY THIS EXISTS: lib/merek.ts's unggahBerkasMerek() has always tried to
-- upload logo/background images to a bucket named 'merek-files', created (in
-- the old Work Management codebase this repo was copied from) by a file
-- called sql/pengaturan-merek.sql. That file was never carried over when this
-- repo was pared down into the Field Service migrations (001-008) - so on a
-- fresh project, NEITHER 'merek-files' nor its 'project-files' fallback
-- exists, and every logo/background upload in Admin Panel -> Dashboard
-- Setting fails with "Tidak ada bucket penyimpanan yang bisa dipakai."
-- ============================================================================

-- Public bucket: the login page background/logo must render for logged-out
-- visitors too (no JWT at all) - same reasoning as 'app-releases' (008), and
-- unlike 'fs-evidence' (007) which is private client data.
INSERT INTO storage.buckets (id, name, public)
VALUES ('merek-files', 'merek-files', true)
ON CONFLICT (id) DO NOTHING;

-- Upload: gated by the SAME check the app_settings row itself uses
-- (boleh_tulis_pengaturan(), 002_core_functions.sql) - any admin/superadmin/
-- team account, matching Dashboard Setting's own access rule exactly.
CREATE POLICY merek_files_storage_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'merek-files' AND boleh_tulis_pengaturan());

-- Read: public bucket already serves files via public URL regardless of RLS,
-- this policy just documents that intent for anything that does go through
-- the storage API (list/download) rather than a bare public URL.
CREATE POLICY merek_files_storage_select ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'merek-files');
