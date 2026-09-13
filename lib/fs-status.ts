/**
 * lib/fs-status.ts - satu sumber kebenaran untuk warna & label status
 * fs_execution_instances, dipakai app/field-service/page.tsx,
 * app/teknisi/page.tsx, dan widget dashboard (FieldServiceWidgets.tsx) -
 * sebelumnya disalin tiga kali dengan warna yang sempat berbeda-beda.
 *
 * Warna divalidasi lewat dataviz skill (scripts/validate_palette.js) supaya
 * aman untuk pembaca buta warna - versi sebelumnya (merah #b91c1c vs hijau
 * #15803d) gagal cek CVD (ΔE 4.2, di bawah ambang 8), pasangan yang paling
 * sering tidak terbedakan penderita deuteranopia/protanopia. NOT_STARTED
 * tetap abu-abu netral dengan sengaja - itu maksudnya "belum ada aksi",
 * bukan salah satu warna kategori yang perlu dibedakan dari yang lain.
 */
export const FS_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  NOT_STARTED: { label: 'Belum Mulai', color: '#64748b', bg: '#f1f5f9' },
  IN_PROGRESS: { label: 'Sedang Berjalan', color: '#2a78d6', bg: '#e3edfb' },
  SUBMITTED: { label: 'Menunggu Ditandai Selesai', color: '#eda100', bg: '#fef3d9' },
  COMPLETED: { label: 'Selesai — Belum Dikirim Client', color: '#008300', bg: '#e0f2e0' },
  WAITING_REVIEW: { label: 'Menunggu Review Client', color: '#eda100', bg: '#fef3d9' },
  VERIFIED: { label: 'Terverifikasi', color: '#008300', bg: '#e0f2e0' },
  REVISION_REQUIRED: { label: 'Perlu Revisi', color: '#e34948', bg: '#fce3e3' },
};

/** Status per-TV (fs_execution_point_status, migrasi 015) - dipakai
 *  checklist Technician (/teknisi) dan detail Execution provider. Palet
 *  sama dengan FS_STATUS_LABEL supaya "hijau selalu berarti selesai" di
 *  seluruh platform, bukan cuma di satu layar. */
export const FS_TV_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  NOT_STARTED: { label: '☐ Belum', color: '#64748b', bg: '#f1f5f9' },
  COMPLETED: { label: '☑ Selesai', color: '#008300', bg: '#e0f2e0' },
  FAILED: { label: 'Gagal', color: '#e34948', bg: '#fce3e3' },
  SKIPPED: { label: 'Dilewati', color: '#94a3b8', bg: '#f1f5f9' },
  EXCEPTION: { label: 'Exception', color: '#eda100', bg: '#fef3d9' },
  // Hilang sebelumnya - client bisa meminta revisi per-TV (022/024) sehingga
  // status ini genuinely muncul di fs_execution_point_status.status, tapi
  // key-nya tidak ada di sini. Setiap pembaca yang meng-index map ini tanpa
  // fallback (app/teknisi/page.tsx) crash dengan "Cannot read properties of
  // undefined" begitu ada TV berstatus ini.
  REVISION_REQUIRED: { label: 'Perlu Revisi', color: '#e34948', bg: '#fce3e3' },
};
