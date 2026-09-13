-- ============================================================================
-- 029_evidence_thumbnails.sql
-- ============================================================================
-- Kolom thumbnail terpisah untuk fs_evidence - mengurangi egress Supabase.
--
-- MASALAH: setiap galeri foto (checklist teknisi, review client, detail
-- eksekusi admin) menampilkan foto di kotak kecil 56-112px, tapi yang
-- dimuat adalah URL foto PENUH (hasil compressImage, ~150-400KB, sisi
-- terpanjang 1600px) - browser cuma men-scale-nya turun lewat CSS. Egress-nya
-- SAMA BESAR dengan membuka foto ukuran penuh, padahal yang terlihat cuma
-- thumbnail. Pada skala ribuan TV, setiap kali galeri dibuka (reviewer,
-- admin, client, teknisi sendiri) angka ini berlipat.
--
-- PERBAIKAN: thumb_path menyimpan lokasi turunan kecil (maks 320px,
-- ~10-30KB) yang dibuat DI BROWSER (lib/image-compress.ts, makeThumbnail())
-- saat upload, diunggah berdampingan dengan foto penuh. Galeri memuat
-- thumb_path; foto penuh baru diunduh kalau pengguna sungguh membuka/
-- memperbesarnya (klik untuk lihat ukuran penuh).
--
-- Nullable dengan sengaja: baris lama (sebelum migrasi ini) tidak punya
-- thumbnail - kode pembaca WAJIB fallback ke `path` (foto penuh) kalau
-- thumb_path NULL, bukan mematahkan galeri foto lama.
-- ============================================================================

ALTER TABLE public.fs_evidence
  ADD COLUMN IF NOT EXISTS thumb_path text;

COMMENT ON COLUMN public.fs_evidence.thumb_path IS
  'Path turunan kecil (maks ~320px) di bucket yang sama (kolom bucket) - '
  'dipakai tampilan galeri/daftar. NULL untuk baris lama sebelum fitur ini '
  'ada; pembaca fallback ke kolom path (foto penuh) saat NULL.';
