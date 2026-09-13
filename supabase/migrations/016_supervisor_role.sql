-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 016
-- Role "User" (app/dashboard/_components/modal-akun.tsx) selama ini diam-diam
-- memetakan ke fs_role=PROVIDER_SUPERVISOR - kekuatan operasional nyata
-- (fs_is_provider() TRUE, boleh Assign PIC & kelola Content) padahal
-- deskripsinya di UI menjanjikan "akses dashboard standar, bukan admin".
--
-- Ditambahkan role SUPERVISOR yang jujur membawa fs_role=PROVIDER_SUPERVISOR
-- itu; "User" sekarang murni fs_role=NULL (sudah nullable sejak 001, lihat
-- idx_users_fs_role ... WHERE fs_role IS NOT NULL). Migrasi ini HANYA
-- menyesuaikan fs_role_menu_defaults (yang punya CHECK role_key) supaya
-- role_key='SUPERVISOR' sah disimpan - tidak menyentuh baris users yang
-- sudah ada (lihat catatan di bawah).
-- ============================================================================

ALTER TABLE public.fs_role_menu_defaults DROP CONSTRAINT fs_role_menu_defaults_role_check;
ALTER TABLE public.fs_role_menu_defaults ADD CONSTRAINT fs_role_menu_defaults_role_check
  CHECK (role_key = ANY (ARRAY['ADMIN', 'SUPERVISOR', 'USER', 'TECHNICIAN', 'VIEW']));

-- Seed menu bawaan SUPERVISOR sama dengan ADMIN/USER (field-service tidak
-- pernah ikut allowed_menus - link Assign PIC digerbangi access_level='full'
-- di app/dashboard/page.tsx, bukan menu key).
INSERT INTO public.fs_role_menu_defaults (role_key, menu_key) VALUES
  ('SUPERVISOR', 'dashboard')
ON CONFLICT DO NOTHING;

-- CATATAN (tidak dieksekusi otomatis - keputusan data akun bukan keputusan
-- migrasi skema): akun yang SUDAH punya fs_role=PROVIDER_SUPERVISOR hari ini
-- tetap PROVIDER_SUPERVISOR setelah migrasi ini (perilakunya tidak berubah
-- sama sekali) - yang berubah hanya bagaimana UI Account Settings MENYEBUT
-- kombinasi itu (sekarang muncul sebagai badge "Supervisor", bukan "User")
-- dan role apa yang dipilih untuk akun BARU. Kalau ada akun yang memang
-- dimaksudkan sebagai "User" biasa (tanpa akses Field Service) tapi saat ini
-- fs_role-nya terlanjur PROVIDER_SUPERVISOR, admin perlu meng-edit akun itu
-- satu per satu lewat Account Settings dan memilih ulang role "User" supaya
-- fs_role-nya benar-benar diset NULL - lihat handleSaveEdit() di
-- modal-akun.tsx yang membaca ROLE_DEFS.USER.fs_role (sekarang null) setiap
-- kali form Edit disimpan.
