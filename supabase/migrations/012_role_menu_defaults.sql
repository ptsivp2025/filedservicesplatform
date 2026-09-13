-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 012
-- Menu bawaan PER ROLE, dipindah dari kode (menusForRole() di
-- app/dashboard/_components/modal-akun.tsx) ke tabel supaya admin bisa
-- mengubahnya lewat Admin Panel -> Account Settings -> Menu per Role, tanpa
-- perlu deploy ulang kode (lihat docs/AUDIT-CONFIGURABILITY-NOTIFICATIONS-
-- 2026-09.md §1.3).
--
-- Baris di sini HANYA menentukan allowed_menus BAWAAN untuk akun BARU (saat
-- dibuat lewat Tambah Akun / Setujui Pendaftaran) - bukan tempat baca menu
-- runtime tiap kali sidebar dirender. Akun yang sudah ada tetap memakai
-- allowed_menus miliknya sendiri di kolom users.allowed_menus, sama seperti
-- sebelumnya.
-- ============================================================================

CREATE TABLE public.fs_role_menu_defaults (
  role_key text NOT NULL,
  menu_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, menu_key),
  CONSTRAINT fs_role_menu_defaults_role_check
    CHECK (role_key = ANY (ARRAY['ADMIN', 'USER', 'TECHNICIAN', 'VIEW']))
);

ALTER TABLE public.fs_role_menu_defaults ENABLE ROW LEVEL SECURITY;

-- Baca: siapa pun yang sudah login - dipakai langsung dari klien saat
-- membuat/approve akun, dan isinya tidak sensitif (cuma daftar kunci menu).
CREATE POLICY fs_role_menu_defaults_select ON public.fs_role_menu_defaults
  FOR SELECT TO anon, authenticated
  USING (true);

-- Tulis: PROVIDER_ADMIN (atau admin/Full Access global) saja - persis siapa
-- yang boleh mengelola Field Service master data lainnya.
CREATE POLICY fs_role_menu_defaults_write ON public.fs_role_menu_defaults
  FOR ALL TO anon, authenticated
  USING (fs_is_provider_admin())
  WITH CHECK (fs_is_provider_admin());

-- Seed PERSIS sama dengan perilaku hardcoded lama (menusForRole() di
-- modal-akun.tsx sebelum migrasi ini) - supaya tidak ada perubahan perilaku
-- diam-diam pada hari migrasi ini dijalankan.
INSERT INTO public.fs_role_menu_defaults (role_key, menu_key) VALUES
  ('ADMIN', 'dashboard'),
  ('USER', 'dashboard'),
  ('TECHNICIAN', 'dashboard'),
  ('TECHNICIAN', 'teknisi'),
  ('VIEW', 'dashboard'),
  ('VIEW', 'client-review')
ON CONFLICT DO NOTHING;
