-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 018
-- PIC (technician) boleh mengedit/redo checklist TV miliknya sendiri SELAMA
-- belum di-approve provider - begitu review_status='APPROVED', baris itu
-- terkunci dari sisi PIC (hanya provider yang masih bisa menyentuhnya, lewat
-- fs_is_provider() di cabang lain policy yang sama).
--
-- Sebelum migrasi ini fs_execution_point_status_update (015) mengizinkan PIC
-- mengedit baris checklist-nya KAPAN SAJA, termasuk SETELAH disetujui
-- provider - gap nyata: teknisi bisa diam-diam mengubah status/notes/foto
-- pada TV yang sudah "selesai diverifikasi", tanpa provider tahu ada
-- perubahan. Migrasi ini menutup itu SEKALIGUS memberi hak yang memang
-- diminta secara eksplisit: sebelum approve, PIC tetap bebas mengedit atau
-- menghapus foto TV yang ia anggap perlu diulang.
-- ============================================================================

DROP POLICY IF EXISTS fs_execution_point_status_update ON public.fs_execution_point_status;
CREATE POLICY fs_execution_point_status_update ON public.fs_execution_point_status
  FOR UPDATE TO anon, authenticated
  USING (
    fs_is_provider()
    OR (
      review_status = 'PENDING'
      AND EXISTS (
        SELECT 1 FROM public.fs_execution_instances i
        WHERE i.id = fs_execution_point_status.execution_instance_id
          AND fs_is_assigned(jwt_user_id(), i.location_id, i.execution_point_id, i.instance_date)
      )
    )
  )
  WITH CHECK (
    fs_is_provider()
    OR (
      review_status = 'PENDING'
      AND EXISTS (
        SELECT 1 FROM public.fs_execution_instances i
        WHERE i.id = fs_execution_point_status.execution_instance_id
          AND fs_is_assigned(jwt_user_id(), i.location_id, i.execution_point_id, i.instance_date)
      )
    )
  );

-- ── fs_evidence: PIC hapus foto TV miliknya sendiri, sebelum di-approve ────
-- fs_evidence_delete (006) sudah mengizinkan PROVIDER menghapus baris evidence
-- APA PUN (dipakai "Hapus Foto" di Execution tab, migrasi 015). Ini kebijakan
-- KEDUA yang permisif (di-OR-kan Postgres dengan yang di atas, bukan
-- menggantikannya) - PIC sendiri boleh menghapus baris evidence PER-TV yang
-- ia unggah sendiri, HANYA selama TV itu belum disetujui provider. Foto
-- check-in/check-out (execution_point_id IS NULL) SENGAJA tidak ikut - itu
-- bukti kehadiran, bukan "checklist item yang perlu diulang".
CREATE POLICY fs_evidence_delete_own_pending ON public.fs_evidence
  FOR DELETE TO anon, authenticated
  USING (
    uploaded_by = jwt_user_id()
    AND execution_point_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.fs_execution_point_status ps
      WHERE ps.execution_instance_id = fs_evidence.execution_instance_id
        AND ps.execution_point_id = fs_evidence.execution_point_id
        AND ps.review_status = 'PENDING'
    )
  );

-- ── storage.objects: berkasnya sendiri, bukan cuma baris metadata ─────────
-- Sama seperti fs_evidence_storage_delete (015) untuk provider - tanpa policy
-- storage-level, DELETE baris fs_evidence di atas cuma menghapus metadata,
-- berkas foto tetap menumpuk di storage cloud (persis alasan yang sama yang
-- membuat 015 menambah fs_evidence_storage_delete untuk provider).
CREATE POLICY fs_evidence_storage_delete_own_pending ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (
    bucket_id = 'fs-evidence'
    AND EXISTS (
      SELECT 1 FROM public.fs_evidence e
      JOIN public.fs_execution_point_status ps
        ON ps.execution_instance_id = e.execution_instance_id AND ps.execution_point_id = e.execution_point_id
      WHERE e.path = storage.objects.name
        AND e.uploaded_by = jwt_user_id()
        AND e.execution_point_id IS NOT NULL
        AND ps.review_status = 'PENDING'
    )
  );
