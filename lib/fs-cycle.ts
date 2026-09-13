/**
 * lib/fs-cycle.ts - satu pintu ke seluruh data SIKLUS WEEKEND.
 *
 * Semua angka di layar mana pun (dashboard admin, halaman PIC, layar review
 * client) datang dari fungsi di sini, yang semuanya memanggil RPC agregasi di
 * database (migrasi 023). Tidak ada lagi perhitungan completion yang ditulis
 * ulang per halaman - itulah sebabnya dulu "berapa TV selesai" bisa berbeda
 * antara satu layar dengan layar lain.
 *
 * Kosakata di sini sengaja memakai bahasa OPERASIONAL, bukan bahasa tabel:
 * Siklus -> Wilayah -> Gedung -> TV -> PIC. Nama tabel (execution_instance,
 * execution_point) tidak boleh bocor ke layar pengguna.
 */

import { supabase } from '@/lib/supabase';

export type CycleStatus =
  | 'PLANNED' | 'ACTIVE' | 'UNDER_REVIEW' | 'READY_TO_CLOSE'
  | 'CLOSED' | 'CLEAR_PENDING' | 'CLEAR_PARTIAL' | 'CLEARED';

export interface Cycle {
  id: string;
  project_id: string;
  name: string;
  content_id: string | null;
  execution_start: string;
  execution_end: string;
  review_start: string | null;
  review_end: string | null;
  status: CycleStatus;
  closed_at: string | null;
  clear_requested_at: string | null;
  cleared_at: string | null;
  clear_objects_deleted: number | null;
  clear_objects_failed: number | null;
}

export interface CycleOverview {
  total_tv: number;
  completed_tv: number;
  failed_tv: number;
  revision_tv: number;
  skipped_tv: number;
  pending_tv: number;
  verified_tv: number;
  building_total: number;
  building_complete: number;
  region_total: number;
  pic_total: number;
  last_activity: string | null;
}

export interface RegionProgress {
  area_id: string; area_name: string;
  total_tv: number; completed_tv: number; failed_tv: number;
  revision_tv: number; pending_tv: number; verified_tv: number;
  building_total: number; pct: number | null;
}

export interface BuildingProgress {
  location_id: string; location_name: string; area_id: string; area_name: string;
  latitude: number | null; longitude: number | null;
  total_tv: number; completed_tv: number; failed_tv: number;
  revision_tv: number; pending_tv: number; verified_tv: number;
  pic_names: string[] | null; pct: number | null;
}

export interface TvTask {
  execution_point_id: string; tv_name: string; tv_floor: string | null;
  location_id: string; location_name: string; area_name: string;
  instance_id: string; instance_date: string;
  tv_status: string; review_status: string;
  failure_reason: string | null; failure_detail: string | null;
  review_notes: string | null; pic_notes: string | null;
  pic_user_id: string | null; pic_name: string | null;
  marked_at: string | null; evidence_count: number;
}

export interface PicProgress {
  pic_user_id: string | null; pic_name: string;
  building_total: number; total_tv: number; completed_tv: number;
  failed_tv: number; revision_tv: number; pending_tv: number; pct: number | null;
}

/** Sebaran penyebab kegagalan. Inilah yang mengubah "15 TV gagal" jadi
 *  tindakan: kirim teknisi lagi, telepon pengelola gedung, atau ganti file. */
export interface PenyebabGagal { alasan: string; jumlah: number; }

/** Penyelesaian per hari kerja (Sabtu vs Minggu). */
export interface ProgresHarian { tanggal: string; selesai: number; gagal: number; }

/** Seberapa siap tiap gedung - "tinggal sedikit lagi" vs "belum tersentuh". */
export interface SebaranGedung { kelompok: string; jumlah: number; }

/** Satu titik pada tren antar siklus. */
export interface TitikTren {
  cycle_id: string; nama: string; mulai: string;
  total_tv: number; selesai_tv: number; gagal_tv: number;
  pct: number | null; status: CycleStatus;
}

/** Check-out yang dikirim PIC dengan pekerjaan TIDAK tuntas - angkanya
 *  dihitung server, alasannya ditulis PIC, keputusannya milik admin. */
export interface PendingCheckout {
  report_id: string; instance_id: string;
  location_name: string; area_name: string; pic_name: string | null;
  deployment_date: string;
  displays_total: number; displays_completed: number;
  notes: string | null; submitted_at: string | null;
}

export interface AttentionItem {
  location_id: string; location_name: string; area_id: string; area_name: string;
  failed_tv: number; revision_tv: number; pending_tv: number; total_tv: number;
  pic_names: string[] | null; severity: number;
}

// ── Kosakata status yang dilihat pengguna ───────────────────────────────
// Satu tempat, dipakai admin/PIC/client - supaya "Selesai" tidak pernah
// berarti dua hal berbeda di dua layar.

export const CYCLE_STATUS_LABEL: Record<CycleStatus, { label: string; color: string; bg: string; arti: string }> = {
  PLANNED:        { label: 'Direncanakan', color: '#475569', bg: '#f1f5f9', arti: 'Belum dimulai. Assign PIC dulu, lalu aktifkan.' },
  ACTIVE:         { label: 'Sedang Berjalan', color: '#1d4ed8', bg: '#dbeafe', arti: 'PIC sedang mengerjakan di lapangan.' },
  UNDER_REVIEW:   { label: 'Menunggu Review Client', color: '#b45309', bg: '#fef3c7', arti: 'Pekerjaan dikirim ke client untuk diperiksa.' },
  READY_TO_CLOSE: { label: 'Siap Ditutup', color: '#047857', bg: '#d1fae5', arti: 'Semua TV tuntas & review selesai. Tinggal ditutup admin.' },
  CLOSED:         { label: 'Ditutup', color: '#334155', bg: '#e2e8f0', arti: 'Selesai. Data foto masih tersimpan sampai dibersihkan.' },
  CLEAR_PENDING:  { label: 'Menunggu Persetujuan Hapus', color: '#c2410c', bg: '#ffedd5', arti: 'Permintaan pembersihan storage menunggu persetujuan admin.' },
  CLEAR_PARTIAL:  { label: 'Pembersihan Sebagian', color: '#b91c1c', bg: '#fee2e2', arti: 'Sebagian file gagal dihapus - perlu dicoba ulang.' },
  CLEARED:        { label: 'Sudah Dibersihkan', color: '#475569', bg: '#f1f5f9', arti: 'Foto sudah dihapus. Ringkasan & audit tetap tersimpan.' },
};

/** Status satu TV sebagaimana dibaca manusia. */
export const TV_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  NOT_STARTED:       { label: 'Belum Dikerjakan', color: '#64748b', bg: '#f1f5f9' },
  IN_PROGRESS:       { label: 'Sedang Dikerjakan', color: '#1d4ed8', bg: '#dbeafe' },
  COMPLETED:         { label: 'Selesai', color: '#047857', bg: '#d1fae5' },
  FAILED:            { label: 'Gagal', color: '#b91c1c', bg: '#fee2e2' },
  EXCEPTION:         { label: 'Kendala', color: '#b45309', bg: '#fef3c7' },
  SKIPPED:           { label: 'Dilewati', color: '#64748b', bg: '#f1f5f9' },
  REVISION_REQUIRED: { label: 'Perlu Diulang', color: '#c2410c', bg: '#ffedd5' },
};

/** Alasan kegagalan - daftar tertutup supaya bisa dihitung & ditindaklanjuti,
 *  bukan teks bebas yang tidak bisa dianalisis. */
export const FAILURE_REASONS: { value: string; label: string }[] = [
  { value: 'TV_OFFLINE', label: 'TV mati / offline' },
  { value: 'NETWORK', label: 'Jaringan bermasalah' },
  { value: 'DEVICE', label: 'Perangkat rusak' },
  { value: 'CONTENT', label: 'File konten bermasalah' },
  { value: 'ACCESS', label: 'Tidak bisa akses ruangan' },
  { value: 'OTHER', label: 'Lainnya' },
];

export const FAILURE_REASON_LABEL: Record<string, string> =
  Object.fromEntries(FAILURE_REASONS.map(r => [r.value, r.label]));

/** Satu-satunya tempat persentase dihitung di sisi klien - dan hanya dari
 *  angka yang SUDAH dihitung database, bukan dari baris mentah. */
export function persen(selesai: number, total: number): number {
  if (!total) return 0;
  return Math.round((selesai / total) * 1000) / 10;
}

export function warnaProgress(pct: number): string {
  if (pct >= 100) return '#047857';
  if (pct >= 90) return '#0d9488';
  if (pct >= 70) return '#b45309';
  return '#b91c1c';
}

/** "12–13 September 2026" */
export function rentangTanggal(mulai: string, selesai: string): string {
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const a = new Date(mulai + 'T00:00:00');
  const b = new Date(selesai + 'T00:00:00');
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()}–${b.getDate()} ${BULAN[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${a.getDate()} ${BULAN[a.getMonth()]} – ${b.getDate()} ${BULAN[b.getMonth()]} ${b.getFullYear()}`;
}

// ── Pengambilan data ────────────────────────────────────────────────────

const KUNCI_PROJECT = 'fs_selected_project_id';

/**
 * Project yang sedang dipakai layar ini.
 *
 * Selector project di sidebar hanya dirender untuk akun yang punya menu
 * Operations - artinya PIC dan Client TIDAK PERNAH mengisi sessionStorage
 * itu, dan widget mereka akan mengira tidak ada project sama sekali. Karena
 * itu fungsi ini punya jalur cadangan yang berbeda per peran, mengikuti apa
 * yang boleh mereka baca menurut RLS:
 *   provider/client -> fs_projects (mereka boleh membacanya)
 *   PIC             -> project dari penugasannya sendiri (fs_projects
 *                      tertutup untuk PIC, tapi assignment-nya terbuka)
 * Hasilnya disimpan supaya pemanggilan berikutnya tidak query lagi.
 */
export async function projectAktif(): Promise<string> {
  if (typeof window !== 'undefined') {
    const tersimpan = sessionStorage.getItem(KUNCI_PROJECT);
    if (tersimpan) return tersimpan;
  }

  const simpan = (id: string) => {
    try { sessionStorage.setItem(KUNCI_PROJECT, id); } catch { /* diam - sekadar kenyamanan */ }
    return id;
  };

  const { data: proyek } = await supabase.from('fs_projects').select('id').order('name').limit(1);
  if (proyek && proyek.length > 0) return simpan((proyek[0] as { id: string }).id);

  const { data: tugas } = await supabase.from('fs_pic_assignments')
    .select('project_id').eq('active', true).limit(1);
  if (tugas && tugas.length > 0) return simpan((tugas[0] as { project_id: string }).project_id);

  return '';
}

/** Siklus untuk satu project, terbaru dulu. */
export async function ambilCycles(projectId: string): Promise<Cycle[]> {
  const { data, error } = await supabase.from('fs_cycles')
    .select('id, project_id, name, content_id, execution_start, execution_end, review_start, review_end, status, closed_at, clear_requested_at, cleared_at, clear_objects_deleted, clear_objects_failed')
    .eq('project_id', projectId)
    .order('execution_start', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Cycle[];
}

/** Siklus yang sedang relevan untuk dikerjakan/dipantau hari ini. Dipakai
 *  sebagai pilihan awal dashboard supaya pengguna tidak perlu memilih
 *  apa-apa untuk melihat keadaan sekarang. */
export function cycleBerjalan(cycles: Cycle[]): Cycle | null {
  const aktif = cycles.find(c => ['ACTIVE', 'UNDER_REVIEW', 'READY_TO_CLOSE'].includes(c.status));
  return aktif ?? cycles[0] ?? null;
}

export async function ambilOverview(cycleId: string): Promise<CycleOverview> {
  const { data, error } = await supabase.rpc('fs_cycle_overview', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
  return data as CycleOverview;
}

export async function ambilRegionProgress(cycleId: string): Promise<RegionProgress[]> {
  const { data, error } = await supabase.rpc('fs_cycle_region_progress', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
  return (data ?? []) as RegionProgress[];
}

export async function ambilBuildingProgress(cycleId: string, areaId?: string | null): Promise<BuildingProgress[]> {
  const { data, error } = await supabase.rpc('fs_cycle_building_progress', {
    p_cycle_id: cycleId, p_area_id: areaId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as BuildingProgress[];
}

export async function ambilTvList(cycleId: string, opsi: {
  locationId?: string | null; status?: string | null; picUserId?: string | null; limit?: number;
} = {}): Promise<TvTask[]> {
  const { data, error } = await supabase.rpc('fs_cycle_tv_list', {
    p_cycle_id: cycleId,
    p_location_id: opsi.locationId ?? null,
    p_status: opsi.status ?? null,
    p_pic_user_id: opsi.picUserId ?? null,
    p_limit: opsi.limit ?? 500,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TvTask[];
}

export async function ambilPicProgress(cycleId: string): Promise<PicProgress[]> {
  const { data, error } = await supabase.rpc('fs_cycle_pic_progress', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
  return (data ?? []) as PicProgress[];
}

export async function ambilAttention(cycleId: string, limit = 12): Promise<AttentionItem[]> {
  const { data, error } = await supabase.rpc('fs_cycle_attention', { p_cycle_id: cycleId, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as AttentionItem[];
}

// ── Data untuk grafik dashboard ─────────────────────────────────────────
// Semua dihitung database dari view fs_cycle_tv_tasks yang sama dengan
// angka ringkasan - grafik tidak boleh bercerita berbeda dari kartu di
// atasnya, dan itu hanya dijamin kalau sumbernya memang satu.

export async function ambilPenyebabGagal(cycleId: string): Promise<PenyebabGagal[]> {
  const { data, error } = await supabase.rpc('fs_cycle_failure_breakdown', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
  return (data ?? []) as PenyebabGagal[];
}

export async function ambilProgresHarian(cycleId: string): Promise<ProgresHarian[]> {
  const { data, error } = await supabase.rpc('fs_cycle_daily_progress', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProgresHarian[];
}

export async function ambilSebaranGedung(cycleId: string): Promise<SebaranGedung[]> {
  const { data, error } = await supabase.rpc('fs_cycle_building_distribution', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
  return (data ?? []) as SebaranGedung[];
}

export async function ambilTren(projectId: string, batas = 8): Promise<TitikTren[]> {
  const { data, error } = await supabase.rpc('fs_cycle_trend', { p_project_id: projectId, p_limit: batas });
  if (error) throw new Error(error.message);
  return (data ?? []) as TitikTren[];
}

export async function ambilPendingCheckouts(cycleId?: string | null): Promise<PendingCheckout[]> {
  const { data, error } = await supabase.rpc('fs_pending_checkouts', { p_cycle_id: cycleId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as PendingCheckout[];
}

/**
 * Keputusan admin atas check-out tidak tuntas. Menolak WAJIB beralasan -
 * aturannya dijaga database (fs_review_checkout), bukan hanya form ini.
 */
export async function putuskanCheckout(reportId: string, keputusan: 'APPROVED' | 'REJECTED', alasan?: string) {
  const { error } = await supabase.rpc('fs_review_checkout', {
    p_report_id: reportId, p_decision: keputusan, p_alasan: alasan ?? null,
  });
  if (error) throw new Error(error.message);
}

// ── Perubahan lifecycle ─────────────────────────────────────────────────
// Semua lewat RPC yang memeriksa perannya sendiri di database. UI hanya
// menyembunyikan tombol yang pasti ditolak - bukan itu penjaganya.

export async function pindahStatusCycle(cycleId: string, statusBaru: CycleStatus, paksa = false) {
  const { error } = await supabase.rpc('fs_cycle_transition', {
    p_cycle_id: cycleId, p_new_status: statusBaru, p_force: paksa,
  });
  if (error) throw new Error(error.message);
}

export async function buatScopePekerjaan(cycleId: string): Promise<{ created: number; linked: number }> {
  const { data, error } = await supabase.rpc('fs_generate_cycle_scope', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
  return data as { created: number; linked: number };
}

export async function mintaPembersihan(cycleId: string): Promise<{ evidence_objects: number }> {
  const { data, error } = await supabase.rpc('fs_request_clear', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
  return data as { evidence_objects: number };
}

/** Langkah terakhir: hapus file dari Storage lalu tandai hasilnya. Dijalankan
 *  di route server (butuh service role untuk menghapus objek Storage), bukan
 *  di browser. */
export async function setujuiPembersihan(cycleId: string): Promise<{
  status: string; objects_deleted: number; objects_failed: number;
  objects_missing: number; evidence_rows_deleted: number;
}> {
  const res = await fetch('/api/cycles/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cycleId }),
  });
  const hasil = await res.json();
  if (!res.ok) throw new Error(hasil?.error ?? 'Gagal membersihkan data cycle.');
  return hasil;
}

/** Berapa banyak file evidence yang akan terhapus - ditampilkan di dialog
 *  konfirmasi supaya admin tahu persis apa yang hilang sebelum menyetujui. */
export async function hitungEvidence(cycleId: string): Promise<number> {
  const { count, error } = await supabase.from('fs_evidence')
    .select('id, fs_execution_instances!inner(cycle_id)', { count: 'exact', head: true })
    .eq('fs_execution_instances.cycle_id', cycleId);
  if (error) return 0;
  return count ?? 0;
}
