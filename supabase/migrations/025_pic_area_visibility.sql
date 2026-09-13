-- ============================================================================
-- Operational Control Platform — Migration 025
-- PIC boleh membaca WILAYAH dari gedung yang ditugaskan padanya.
--
-- DITEMUKAN SAAT MENGUJI PERAN, bukan dari membaca kode: memanggil
-- fs_cycle_overview() sebagai PIC mengembalikan 44 TV, tapi
-- fs_cycle_building_progress() mengembalikan NOL gedung untuk PIC yang sama.
-- Penyebabnya policy fs_areas (006) yang hanya mengizinkan provider dan
-- client membaca; ketiga fungsi agregasi drill-down JOIN fs_areas untuk
-- menampilkan nama wilayah, sehingga bagi PIC join itu membuang seluruh
-- barisnya. Hasilnya layar yang membantah dirinya sendiri: ringkasan bilang
-- ada 44 TV, daftarnya kosong.
--
-- Cakupan sengaja sempit dan simetris dengan policy fs_locations yang sudah
-- ada (PIC hanya melihat lokasi yang ditugaskan padanya): hanya wilayah yang
-- MEMUAT lokasi tugasnya - bukan seluruh peta wilayah perusahaan.
--
-- Jalankan SETELAH 024.
-- ============================================================================

DROP POLICY IF EXISTS fs_areas_select ON public.fs_areas;
CREATE POLICY fs_areas_select ON public.fs_areas
  FOR SELECT TO anon, authenticated
  USING (
    fs_is_provider()
    OR fs_is_client_viewer()
    OR EXISTS (
      SELECT 1
      FROM public.fs_locations l
      JOIN public.fs_pic_assignments a ON a.location_id = l.id
      WHERE l.area_id = fs_areas.id
        AND a.user_id = jwt_user_id()
        AND a.active
    )
  );
