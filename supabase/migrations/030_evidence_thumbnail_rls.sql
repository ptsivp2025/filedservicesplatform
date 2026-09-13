-- ============================================================================
-- 030_evidence_thumbnail_rls.sql
-- ============================================================================
-- Perbaikan RLS storage.objects untuk thumb_path (029).
--
-- BUG NYATA (ditemukan lewat pengujian langsung, bukan teori): PIC yang baru
-- saja mengunggah foto TIDAK BISA membuka thumbnail-nya SENDIRI - signed URL
-- selalu gagal dengan "Object not found", padahal:
--   1. Upload thumbnail-nya sendiri sukses (dikonfirmasi lewat log upload -
--      Supabase mengembalikan id objek yang valid, tidak ada error).
--   2. Foto PENUH di path yang sama persis berhasil di-sign tanpa masalah.
--   3. Admin/provider yang membuka foto yang SAMA tidak mengalami ini sama
--      sekali.
--
-- PENYEBAB: fs_evidence_storage_select (007) - kebijakan yang menentukan
-- objek storage.objects mana yang boleh dibaca PIC atas hasil unggahannya
-- sendiri - HANYA memeriksa `e.path = storage.objects.name`. Kolom
-- thumb_path (029) tidak ada saat kebijakan ini ditulis, jadi objek
-- thumbnail (namanya berakhiran -thumb.jpg, TIDAK PERNAH sama dengan
-- fs_evidence.path) tidak pernah cocok dengan baris manapun untuk PIC biasa.
-- fs_is_provider()/fs_is_client_viewer() melewati pengecekan path ini sama
-- sekali, itulah kenapa admin/client tidak pernah melihat masalah ini -
-- hanya PIC yang login sebagai dirinya sendiri yang kena.
--
-- fs_evidence_storage_delete_own_pending (018) punya lubang yang SAMA persis
-- untuk penghapusan (PIC hapus foto sendiri sebelum di-review) - ikut
-- diperbaiki di sini supaya hapusFotoLama() (teknisi/page.tsx) benar-benar
-- membersihkan berkas thumbnail-nya, bukan cuma foto penuh.
-- ============================================================================

DROP POLICY IF EXISTS fs_evidence_storage_select ON storage.objects;
CREATE POLICY fs_evidence_storage_select ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'fs-evidence'
    AND (
      fs_is_provider() OR fs_is_client_viewer()
      OR EXISTS (
        SELECT 1 FROM public.fs_evidence e
        WHERE (e.path = storage.objects.name OR e.thumb_path = storage.objects.name)
          AND e.uploaded_by = jwt_user_id()
      )
    )
  );

DROP POLICY IF EXISTS fs_evidence_storage_delete_own_pending ON storage.objects;
CREATE POLICY fs_evidence_storage_delete_own_pending ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (
    bucket_id = 'fs-evidence'
    AND EXISTS (
      SELECT 1 FROM public.fs_evidence e
      JOIN public.fs_execution_point_status ps
        ON ps.execution_instance_id = e.execution_instance_id AND ps.execution_point_id = e.execution_point_id
      WHERE (e.path = storage.objects.name OR e.thumb_path = storage.objects.name)
        AND e.uploaded_by = jwt_user_id()
        AND e.execution_point_id IS NOT NULL
        AND ps.review_status = 'PENDING'
    )
  );
