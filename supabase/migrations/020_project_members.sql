-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 020
-- fs_project_members - keanggotaan user ke project tertentu.
--
-- KENAPA INI ADA: user diminta "account pastinya di-regist sesuai project
-- yang terselect" (referensi: MicroCMS "Select tenant" - user non-superadmin
-- cuma melihat tenant yang jadi miliknya). Sebelum migrasi ini, project
-- selector global (Dashboard) menampilkan SEMUA project ke SEMUA provider,
-- tidak peduli mereka relevan atau tidak untuk project itu.
--
-- SCOPE SENGAJA DIBATASI: ini TABEL KEANGGOTAAN + FILTER UI (selector global
-- di Dashboard hanya menampilkan project yang jadi member user), BUKAN
-- pengetatan RLS fs_locations/fs_execution_points/dst per project. Provider
-- Admin/Supervisor (fs_is_provider()) tetap punya akses baca/tulis PENUH ke
-- semua project lewat RLS yang sudah ada (006) - migrasi ini tidak mengubah
-- itu. Mengetatkan RLS jadi per-membership adalah perubahan jauh lebih besar
-- (harus dikerjakan ulang di HAMPIR SEMUA policy fs_*, termasuk yang
-- reference project_id secara tidak langsung lewat location_id/
-- execution_point_id) - di luar scope permintaan ini, dicatat sebagai
-- follow-up kalau memang dibutuhkan penuh.
-- ============================================================================

CREATE TABLE public.fs_project_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (project_id) REFERENCES public.fs_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  UNIQUE (project_id, user_id)
);

CREATE INDEX idx_fs_project_members_project ON public.fs_project_members(project_id);
CREATE INDEX idx_fs_project_members_user ON public.fs_project_members(user_id);

ALTER TABLE public.fs_project_members ENABLE ROW LEVEL SECURITY;

-- Baca: siapa pun yang bisa lihat Field Service sama sekali (provider atau
-- client viewer) - selector global perlu tahu SIAPA anggota project mana
-- untuk memfilter dropdown-nya sendiri, jadi baca tidak dibatasi per-baris.
CREATE POLICY fs_project_members_select ON public.fs_project_members
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider() OR fs_is_client_viewer());

-- Tulis: cuma Provider Admin - keanggotaan project adalah keputusan admin,
-- sama seperti kelola Project/Location Master lainnya.
CREATE POLICY fs_project_members_insert ON public.fs_project_members
  FOR INSERT TO anon, authenticated
  WITH CHECK (fs_is_provider_admin());

CREATE POLICY fs_project_members_delete ON public.fs_project_members
  FOR DELETE TO anon, authenticated
  USING (fs_is_provider_admin());
