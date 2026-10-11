/**
 * lib/fs-jadwal.ts - jadwal siklus mingguan OTOMATIS per project.
 *
 * Masukan user: platform tidak boleh menunggu Admin "memilih konten" dulu
 * sebelum minggu berjalan. Setiap minggu memang ada jadwal tetap - dua hari
 * yang ditentukan (mis. Sabtu-Minggu) atau hari lain yang dipilih Admin -
 * dan yang dipantau adalah ORANG: siapa bertugas, kapan, dan evidence-nya.
 *
 * Jadi Admin cukup memilih HARI pengerjaan sekali; cron harian
 * (/api/cron/materialize-instances) membuat siklus minggu itu beserta daftar
 * pekerjaannya dari penugasan PIC. Tidak ada hari bawaan: selama Admin belum
 * memilih hari, tidak ada yang dibuat otomatis (keputusan user).
 *
 * Disimpan di app_settings (kunci per project) supaya tidak butuh migrasi
 * skema; ditulis lewat /api/cycles/jadwal yang memeriksa peran di server.
 * Modul ini MURNI (tanpa Supabase) supaya dipakai bersama klien dan server.
 */

export interface JadwalSiklus {
  /** Hari pengerjaan, 0 = Minggu ... 6 = Sabtu (konvensi Date.getDay). */
  hari: number[];
  /** Lama masa review client setelah hari pengerjaan terakhir (hari). */
  reviewHari: number;
  /** Siklus yang dibuat otomatis langsung ACTIVE (PIC bisa langsung bekerja). */
  aktifkanOtomatis: boolean;
}

export const JADWAL_KOSONG: JadwalSiklus = { hari: [], reviewHari: 14, aktifkanOtomatis: true };

export const AWALAN_KUNCI_JADWAL = 'fs.jadwal_siklus.';
export const kunciJadwal = (projectId: string) => `${AWALAN_KUNCI_JADWAL}${projectId}`;

/** Urutan tampilan Senin -> Minggu. */
export const HARI_PILIHAN: { dow: number; pendek: string; panjang: string }[] = [
  { dow: 1, pendek: 'Sen', panjang: 'Senin' },
  { dow: 2, pendek: 'Sel', panjang: 'Selasa' },
  { dow: 3, pendek: 'Rab', panjang: 'Rabu' },
  { dow: 4, pendek: 'Kam', panjang: 'Kamis' },
  { dow: 5, pendek: 'Jum', panjang: 'Jumat' },
  { dow: 6, pendek: 'Sab', panjang: 'Sabtu' },
  { dow: 0, pendek: 'Min', panjang: 'Minggu' },
];

/** Normalisasi nilai mentah dari app_settings - data lama/rusak tidak boleh membuat cron gagal. */
export function bacaJadwal(mentah: unknown): JadwalSiklus {
  if (!mentah || typeof mentah !== 'object') return { ...JADWAL_KOSONG };
  const m = mentah as Partial<JadwalSiklus>;
  const hari = Array.isArray(m.hari)
    ? Array.from(new Set(m.hari.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6)))
    : [];
  const reviewHari = Number.isFinite(Number(m.reviewHari)) ? Math.min(60, Math.max(1, Math.round(Number(m.reviewHari)))) : 14;
  return { hari, reviewHari, aktifkanOtomatis: m.aktifkanOtomatis !== false };
}

/** Tanggal hari ini menurut WIB, "YYYY-MM-DD" - cron berjalan di UTC. */
export function hariIniWIB(sekarang = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(sekarang);
}

function keTanggal(s: string): Date { return new Date(s + 'T00:00:00Z'); }
function keTeks(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * Tanggal-tanggal pengerjaan pada minggu (Senin-Minggu) yang memuat
 * `tanggal`, terurut. Kosong bila belum ada hari dipilih.
 */
export function tanggalPengerjaanMinggu(hari: number[], tanggal: string): string[] {
  const d = keTanggal(tanggal);
  const senin = new Date(d);
  senin.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return hari
    .map(dow => { const x = new Date(senin); x.setUTCDate(senin.getUTCDate() + ((dow + 6) % 7)); return keTeks(x); })
    .sort();
}

export function tambahHariTeks(tanggal: string, n: number): string {
  const d = keTanggal(tanggal);
  d.setUTCDate(d.getUTCDate() + n);
  return keTeks(d);
}

/** Nomor minggu ISO - dipakai untuk nama siklus otomatis. */
export function mingguIso(tanggal: string): number {
  const d = keTanggal(tanggal);
  const kamis = new Date(d);
  kamis.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const awalTahun = new Date(Date.UTC(kamis.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((kamis.getTime() - awalTahun.getTime()) / 86_400_000 - 3 + ((awalTahun.getUTCDay() + 6) % 7)) / 7);
}

/** "Minggu 41 · Sab 10 – Min 11 Okt 2026" */
export function namaSiklusOtomatis(tanggal: string[]): string {
  if (tanggal.length === 0) return 'Siklus Mingguan';
  const f = (s: string, bulan: boolean) => keTanggal(s).toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', ...(bulan ? { month: 'short', year: 'numeric' } : {}), timeZone: 'UTC',
  });
  const awal = tanggal[0];
  const akhir = tanggal[tanggal.length - 1];
  const rentang = awal === akhir ? f(awal, true) : `${f(awal, false)} – ${f(akhir, true)}`;
  return `Minggu ${mingguIso(awal)} · ${rentang}`;
}

/** "Sabtu & Minggu" / "Senin, Rabu & Jumat" */
export function labelHari(hari: number[]): string {
  const nama = HARI_PILIHAN.filter(h => hari.includes(h.dow)).map(h => h.panjang);
  if (nama.length <= 1) return nama[0] ?? '—';
  return `${nama.slice(0, -1).join(', ')} & ${nama[nama.length - 1]}`;
}
