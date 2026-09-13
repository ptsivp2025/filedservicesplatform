-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 021
-- fs_project_members - perbaikan jadi SATU PROJECT PER USER.
--
-- KENAPA INI ADA: migrasi 020 memakai UNIQUE(project_id, user_id), yang cuma
-- mencegah baris (project,user) yang SAMA dobel - TIDAK mencegah satu user
-- muncul di project LAIN. UI Members (modal per-project, checkbox per user)
-- karenanya secara desain mengizinkan satu user dicentang di project A lalu
-- di project B juga, keduanya sah. User melaporkan ini sebagai kesalahan
-- konsep: "tidak relevan member yang sama di 2 tenant berbeda - SALAH TOTAL".
--
-- Root cause BUKAN query yang salah filter (sudah ditelusuri: baca/tulis di
-- ProjectsTab/modal-projects.tsx sudah benar di-scope .eq('project_id', ...))
-- - murni constraint yang bentuknya salah. Fix: UNIQUE(user_id) saja, jadi
-- satu user_id hanya boleh punya SATU baris fs_project_members di mana pun.
--
-- Data existing dibersihkan dulu (kalau ada) sebelum constraint baru
-- dipasang - kalau tidak, ALTER TABLE akan gagal pada user yang kadung
-- tercatat di lebih dari satu project. Yang dipertahankan: baris ter-BARU
-- (created_at terbesar) per user - asumsi wajar keanggotaan yang paling baru
-- dicentang adalah yang dimaksud admin.
-- ============================================================================

DELETE FROM public.fs_project_members a
USING public.fs_project_members b
WHERE a.user_id = b.user_id
  AND (a.created_at, a.id) < (b.created_at, b.id);

ALTER TABLE public.fs_project_members DROP CONSTRAINT IF EXISTS fs_project_members_project_id_user_id_key;
ALTER TABLE public.fs_project_members ADD CONSTRAINT fs_project_members_user_id_key UNIQUE (user_id);

-- UPDATE belum ada policy-nya di 020 (dulu cuma insert/delete, karena UI-nya
-- toggle checkbox) - modal-projects.tsx sekarang pakai upsert (insert ON
-- CONFLICT DO UPDATE), yang butuh UPDATE selain INSERT untuk baris yang
-- konfliknya kena. Gerbangnya SAMA dengan insert/delete yang sudah ada.
CREATE POLICY fs_project_members_update ON public.fs_project_members
  FOR UPDATE TO anon, authenticated
  USING (fs_is_provider_admin())
  WITH CHECK (fs_is_provider_admin());
