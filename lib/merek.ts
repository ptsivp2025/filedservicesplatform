/**
 * lib/merek.ts - identitas tampilan platform (merek), dibaca dari database
 * supaya bisa diubah admin dari Admin Panel -> Dashboard Setting tanpa
 * menyunting kode atau deploy ulang.
 *
 * Nama platform, nama portal, nama perusahaan, logo, dan warna panel -
 * tersebar di halaman login dan header dashboard - semuanya tersimpan di
 * `app_settings` (tabel kunci-nilai yang sudah dipakai untuk manager_user_id
 * dan jadwal reminder).
 *
 * NILAI BAWAAN DI BAWAH SENGAJA PERSIS SAMA dengan yang selama ini tampil.
 * Jadi selama baris pengaturannya belum ada - atau gagal dibaca - platform
 * tampil tepat seperti sebelumnya, bukan kosong atau berubah sendiri.
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Merek

export interface Merek {
  // ── Dashboard: header di dalam platform ──
  /** Judul besar di header, mis. "Field Service Platform". */
  namaPlatform: string;
  /** Versi pendek untuk layar sempit, mis. "Field Service". */
  namaPlatformSingkat: string;
  /** Label di sebelah kanan garis pemisah, mis. "Proof of Execution". */
  namaPortal: string;
  /** Baris kecil di bawah judul, mis. "IndoVisual Professional Tools". */
  namaPerusahaan: string;
  /** Logo, diisi lewat unggahan (unggahBerkasMerek). Kosong = ikon bawaan. */
  logoUrl: string;
  /** Warna utama - kotak logo, tombol, pranala. */
  warnaUtama: string;
  /** Warna kedua untuk gradasi kotak logo & tombol. */
  warnaUtama2: string;
  /** Warna label portal di header, juga dipakai garis aksen sidebar. */
  warnaAksen: string;
  /** Gambar latar layar dashboard (setelah login), diisi lewat unggahan.
   *  Kosong (bawaan) = pakai gradasi warnaLatarAwal/warnaLatarAkhir, bukan foto. */
  gambarLatarDasbor: string;
  /** Warna kotak sidebar/menu bar (kiri, berisi navigasi). */
  warnaSidebar: string;
  /** Gradasi latar seluruh platform (dashboard, Field Service, Teknisi) saat
   *  gambarLatarDasbor kosong - awal gradasi (kiri-atas). */
  warnaLatarAwal: string;
  /** Gradasi latar seluruh platform, akhir (kanan-bawah). */
  warnaLatarAkhir: string;

  // ── Halaman login ──
  //  Punya warna sendiri, sengaja tidak menumpang warna dashboard: panel kiri
  //  login duduk di atas foto, jadi warna yang enak di sana belum tentu enak
  //  dipakai sebagai warna tombol di dalam platform - dan sebaliknya.
  /** Gambar latar halaman login, diisi lewat unggahan. Kosong (bawaan) = panel
   *  kiri tampil gradasi warnaLogin/warnaLogin2 pekat penuh, bukan foto+tint. */
  gambarLatar: string;
  /** Warna panel kiri login, awal gradasi. */
  warnaLogin: string;
  /** Warna panel kiri login, akhir gradasi. */
  warnaLogin2: string;
  /** Kepekatan panel kiri menutupi foto: '0' tembus penuh, '1' menutup rapat. */
  tembusLogin: string;
  /** Kepekatan kabut putih di sisi kanan, tempat kartu login berdiri. */
  tembusKanan: string;
  /** Kalimat sambutan besar di panel kiri login. */
  judulLogin: string;
  /** Kalimat penjelas di bawahnya. */
  subjudulLogin: string;
}

export const MEREK_BAWAAN: Merek = {
  namaPlatform: 'Field Service Platform',
  namaPlatformSingkat: 'Field Service',
  namaPortal: 'Proof of Execution',
  namaPerusahaan: 'IndoVisual Professional Tools',
  logoUrl: '',
  warnaUtama: '#e11d48',
  warnaUtama2: '#be123c',
  warnaAksen: '#c8861d',
  // Kosong sengaja - bawaan sekarang gradasi warnaLatarAwal/warnaLatarAkhir di
  // bawah, bukan foto IndoVisual seperti sebelumnya (lihat gradasiLatarPlatform).
  gambarLatarDasbor: '',
  warnaSidebar: 'rgba(255,255,255,0.96)',
  warnaLatarAwal: '#1e1b2e',
  warnaLatarAkhir: '#881337',

  // Kosong sengaja juga - panel kiri login pakai gradasi warnaLogin/warnaLogin2
  // pekat penuh (lihat gradasiPanelLogin), bukan foto+tint seperti sebelumnya.
  gambarLatar: '',
  warnaLogin: '#be123c',
  warnaLogin2: '#881337',
  tembusLogin: '0.84',
  tembusKanan: '0.55',
  judulLogin: 'Bukti Eksekusi Kerja Lapangan, Real-Time',
  subjudulLogin: 'Pastikan PIC yang tepat bekerja di lokasi yang tepat, sesuai jadwal — divalidasi GPS, dilengkapi bukti foto, terverifikasi client.',
};

/** Field yang dipakai halaman login - dipakai Admin Panel untuk mengelompokkan. */
export const FIELD_LOGIN = [
  'gambarLatar', 'warnaLogin', 'warnaLogin2', 'tembusLogin', 'tembusKanan',
  'judulLogin', 'subjudulLogin',
] as const satisfies readonly (keyof Merek)[];

/** Kunci baris di app_settings. Satu baris, isinya JSON. */
export const KUNCI_MEREK = 'merek';

// Simpanan sementara

/**
 * Disimpan di module scope DAN sessionStorage.
 *
 * Module scope: puluhan berkas mengimpor merek ini - tanpa simpanan, tiap
 * pemakai akan memanggil database sendiri-sendiri.
 *
 * sessionStorage: header dan halaman login dirender sebelum panggilan pertama
 * selesai. Tanpa nilai yang sudah tersimpan, merek yang sudah diganti akan
 * berkedip memperlihatkan nilai bawaan dulu setiap kali halaman dimuat ulang.
 */
const SIMPAN_MEREK = 'ivp_merek';

function bacaSimpanan<T>(kunci: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const mentah = window.sessionStorage.getItem(kunci);
    return mentah ? (JSON.parse(mentah) as T) : null;
  } catch { return null; }
}

function tulisSimpanan(kunci: string, nilai: unknown): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(kunci, JSON.stringify(nilai)); } catch { /* kuota penuh - abaikan */ }
}

let merekSekarang: Merek = { ...MEREK_BAWAAN, ...(bacaSimpanan<Partial<Merek>>(SIMPAN_MEREK) ?? {}) };
// Dipasang sedini mungkin supaya CSS tidak sempat memakai warna bawaan lebih
// dulu lalu berkedip ke warna merek saat pemuatan selesai.
if (typeof document !== 'undefined') {
  queueMicrotask(() => tulisWarnaKeCSS());
}

/** Merek yang sedang berlaku. Selalu lengkap - field yang tidak diatur diisi bawaan. */
export function merek(): Merek { return merekSekarang; }

// Pemuatan

/**
 * Baca satu nilai app_settings.
 *
 * Kolom `value` menerima dua bentuk, tergantung tipe kolomnya di database:
 * teks berisi JSON (kolom text) atau nilai yang sudah terurai (kolom jsonb).
 * Keduanya diterima di sini, karena menebak salah satunya akan membuat
 * pengaturan yang sudah tersimpan tampak tidak pernah ada.
 */
function uraikan(nilai: unknown): unknown {
  if (nilai === null || nilai === undefined || nilai === '') return null;
  if (typeof nilai === 'object') return nilai;
  if (typeof nilai !== 'string') return null;
  try { return JSON.parse(nilai); } catch { return null; }
}

let pemuatan: Promise<void> | null = null;

/**
 * Muat merek dari database. Aman dipanggil berkali-kali: panggilan yang
 * datang saat pemuatan masih berjalan ikut menunggu yang sama.
 *
 * Kegagalan apa pun - jaringan, baris belum ada, JSON rusak - dibiarkan dan
 * nilai yang sedang berlaku dipertahankan. Pengaturan tampilan tidak pantas
 * menghalangi orang bekerja.
 */
export function muatMerek(): Promise<void> {
  if (pemuatan) return pemuatan;
  pemuatan = (async () => {
    try {
      const { data } = await supabase
        .from('app_settings').select('key, value')
        .eq('key', KUNCI_MEREK).maybeSingle();
      if (!data) return;
      const isi = uraikan(data.value);
      if (isi === null) return;
      // Digabung dengan bawaan, bukan menggantikannya: field yang belum
      // pernah diisi tetap punya nilai, tidak berubah jadi string kosong.
      merekSekarang = { ...MEREK_BAWAAN, ...bersihkanMerek(isi as Partial<Merek>) };
      tulisSimpanan(SIMPAN_MEREK, merekSekarang);
      tulisWarnaKeCSS();
      beriTahuPendengar();
    } catch { /* pertahankan nilai yang sedang berlaku */ }
  })();
  return pemuatan;
}

/** Paksa muat ulang - dipakai setelah pengaturan disimpan dari Admin Panel. */
export function muatUlangMerek(): Promise<void> { pemuatan = null; return muatMerek(); }

/**
 * Path foto IndoVisual LAMA - dulu jadi bawaan gambarLatar/gambarLatarDasbor
 * sebelum diganti gradasi warna. Baris `app_settings` yang sudah kadung
 * menyimpan path ini dari SEBELUM perubahan (baik tersimpan eksplisit lewat
 * Admin Panel, atau tertulis oleh kode versi lama yang dulu menyalin bawaan
 * apa adanya) akan TERUS menimpa gradasi baru walau bawaan di kode sudah
 * diganti - "kenapa masih ada gambar IVP_Background" dilaporkan user
 * berulang kali. Path spesifik ini SENGAJA diperlakukan sama dengan kosong
 * di sini (bukan cuma di kode render) - jadi satu perbaikan berlaku untuk
 * SEMUA pemakainya (dashboard/field-service/teknisi) sekaligus, tanpa perlu
 * pengguna membuka Admin Panel dan menekan "Kembalikan ke bawaan" manual.
 */
const LEGACY_BG_PATH = '/field-service-bg.jpg';

/** Buang field yang bukan milik Merek dan nilai non-string. */
function bersihkanMerek(isi: Partial<Merek>): Partial<Merek> {
  const hasil: Partial<Merek> = {};
  for (const kunci of Object.keys(MEREK_BAWAAN) as (keyof Merek)[]) {
    const nilai = isi[kunci];
    if (typeof nilai !== 'string') continue;
    const rapi = nilai.trim();
    if (rapi === '') continue;
    if ((kunci === 'gambarLatar' || kunci === 'gambarLatarDasbor') && rapi === LEGACY_BG_PATH) continue;
    hasil[kunci] = rapi;
  }
  return hasil;
}

/**
 * Ubah warna hex jadi rgba dengan tingkat tembus pandang tertentu.
 *
 * Dipakai panel kiri halaman login: gambar latar harus tetap terlihat menembus
 * warna merek, jadi warnanya tidak bisa dipakai pekat begitu saja. Nilai yang
 * bukan hex 6 digit dikembalikan apa adanya - biar warna bernama seperti
 * "tomato" tetap tampil, bukan berubah jadi hitam.
 */
export function warnaTembus(hex: string, alfa: number): string {
  const cocok = /^#([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!cocok) return hex;
  const n = parseInt(cocok[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

/**
 * Baca angka kepekatan yang disimpan sebagai teks.
 *
 * Nilainya datang dari <input>, jadi bisa berupa apa saja - termasuk kosong
 * atau salah ketik. Yang di luar 0..1 dikembalikan ke nilai bawaan, bukan
 * dipakai apa adanya: kepekatan 5 membuat panel kirinya menutup rapat dan
 * fotonya hilang sama sekali.
 */
export function angkaTembus(nilai: string, bawaan: number): number {
  const n = Number.parseFloat(nilai);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : bawaan;
}

/** Gradasi panel kiri halaman login, sesuai warna & kepekatan yang diatur.
 *  Kepekatan (tembusLogin) hanya relevan kalau ada foto latar di belakangnya -
 *  tanpa foto (bawaan sekarang), panel tampil gradasi pekat penuh (alpha 1),
 *  supaya terlihat solid seperti referensi, bukan pudar menerawang ke putih. */
export function gradasiPanelLogin(m: Merek): string {
  if (!m.gambarLatar) {
    return `linear-gradient(135deg, ${m.warnaLogin}, ${m.warnaLogin2})`;
  }
  const a = angkaTembus(m.tembusLogin, 0.84);
  // Ujung kedua dibuat sedikit lebih pekat, seperti aslinya - gradasi yang
  // rata terasa datar di atas foto.
  return `linear-gradient(135deg, ${warnaTembus(m.warnaLogin, Math.min(1, a - 0.02))}, ${warnaTembus(m.warnaLogin2, Math.min(1, a + 0.02))})`;
}

/** Gradasi latar platform (dashboard, Field Service, Teknisi) saat tidak ada
 *  foto latar (gambarLatarDasbor kosong) - lihat catatan di MEREK_BAWAAN. */
export function gradasiLatarPlatform(m: Merek): string {
  return `linear-gradient(135deg, ${m.warnaLatarAwal}, ${m.warnaLatarAkhir})`;
}

// Penyimpanan (Admin Panel)

/** Simpan merek. Hanya field yang BERBEDA dari bawaan yang ditulis. */
export async function simpanMerek(baru: Merek): Promise<{ error: string | null }> {
  const ringkas: Partial<Merek> = {};
  for (const kunci of Object.keys(MEREK_BAWAAN) as (keyof Merek)[]) {
    const nilai = (baru[kunci] ?? '').trim();
    if (nilai && nilai !== MEREK_BAWAAN[kunci]) ringkas[kunci] = nilai;
  }
  const { error } = await supabase.from('app_settings')
    .upsert({ key: KUNCI_MEREK, value: JSON.stringify(ringkas) }, { onConflict: 'key' });
  if (error) return { error: error.message };
  merekSekarang = { ...MEREK_BAWAAN, ...ringkas };
  tulisSimpanan(SIMPAN_MEREK, merekSekarang);
  tulisWarnaKeCSS();
  beriTahuPendengar();
  return { error: null };
}

// Unggahan berkas

/**
 * Bucket tempat logo & gambar latar disimpan.
 *
 * `merek-files` dibuat oleh supabase/migrations/009_merek_storage.sql - wajib
 * dijalankan (setelah 001-008) sebelum tombol Unggah di Dashboard Setting bisa
 * dipakai. `project-files` dicoba sebagai cadangan HANYA untuk deployment lama
 * yang masih menyimpan bucket peninggalan itu dari sebelum migrasi 009 ada -
 * bucket baru tidak perlu membuatnya.
 */
const BUCKET_MEREK = 'merek-files';
const BUCKET_CADANGAN = 'project-files';

/** Batas ukuran berkas yang diterima. */
const BATAS_LOGO = 2 * 1024 * 1024;
const BATAS_LATAR = 8 * 1024 * 1024;

/**
 * Unggah logo atau gambar latar, kembalikan URL publiknya.
 *
 * Logo TIDAK dikompres. compressImage() menyandi ulang jadi JPEG, dan JPEG
 * tidak punya lapisan tembus pandang - logo dengan latar transparan akan
 * pulang membawa kotak putih di belakangnya. Gambar latar aman dikompres:
 * ia memang foto, dan ukuran aslinya dari kamera bisa berkali lipat dari yang
 * dibutuhkan layar.
 */
export async function unggahBerkasMerek(
  berkas: File,
  jenis: 'logo' | 'latar' | 'latarDasbor',
): Promise<{ url: string | null; error: string | null }> {
  if (!berkas.type.startsWith('image/')) {
    return { url: null, error: 'Berkasnya harus gambar (PNG, JPG, SVG, atau WebP).' };
  }
  const batas = jenis === 'logo' ? BATAS_LOGO : BATAS_LATAR;
  if (berkas.size > batas) {
    return { url: null, error: `Ukurannya ${(berkas.size / 1048576).toFixed(1)}MB, batasnya ${batas / 1048576}MB.` };
  }

  let siap = berkas;
  if (jenis === 'latar' || jenis === 'latarDasbor') {
    try {
      const { compressImage } = await import('./image-compress');
      siap = await compressImage(berkas, { maxDim: 2400, quality: 0.82 });
    } catch { /* kompresi gagal - unggah aslinya, lebih baik besar daripada tidak jadi */ }
  }

  const ext = (siap.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  // Nama diacak, bukan nama asli: mengunggah "logo.png" dua kali tidak boleh
  // saling menimpa, dan berkas lama harus tetap utuh selama masih dirujuk
  // oleh peramban yang sudah menyimpannya di cache.
  const nama = `merek/${jenis}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  for (const bucket of [BUCKET_MEREK, BUCKET_CADANGAN]) {
    const { error } = await supabase.storage.from(bucket)
      .upload(nama, siap, { cacheControl: '31536000', upsert: false, contentType: siap.type });
    if (!error) {
      return { url: supabase.storage.from(bucket).getPublicUrl(nama).data.publicUrl, error: null };
    }
    // Bucket belum ada - coba yang berikutnya. Galat lain (kuota, izin) tidak
    // akan hilang dengan pindah bucket, jadi langsung dilaporkan.
    const pesan = (error.message || '').toLowerCase();
    if (!pesan.includes('not found') && !pesan.includes('bucket')) {
      return { url: null, error: error.message };
    }
  }
  return { url: null, error: 'Tidak ada bucket penyimpanan yang bisa dipakai. Jalankan supabase/migrations/009_merek_storage.sql di Supabase SQL Editor.' };
}

// Jembatan ke CSS

/**
 * Tuliskan warna merek sebagai CSS custom property di <html>.
 *
 * Tanpa ini, warna merek hanya bisa dipakai lewat `style={{}}` di komponen
 * React - dan itu menutup pintu bagi CSS biasa, pseudo-element, dan keadaan
 * seperti :hover / :focus-visible yang tidak punya padanan inline.
 */
export function tulisWarnaKeCSS(m: Merek = merekSekarang): void {
  if (typeof document === 'undefined') return;
  const akar = document.documentElement;
  akar.style.setProperty('--merek-utama', m.warnaUtama);
  akar.style.setProperty('--merek-utama-2', m.warnaUtama2);
  akar.style.setProperty('--merek-aksen', m.warnaAksen);
  akar.style.setProperty('--merek-utama-tembus', warnaTembus(m.warnaUtama, 0.1));
  akar.style.setProperty('--merek-sidebar', m.warnaSidebar);
  akar.style.setProperty('--merek-latar-awal', m.warnaLatarAwal);
  akar.style.setProperty('--merek-latar-akhir', m.warnaLatarAkhir);
}

// Jembatan React

/**
 * Pendengar yang perlu dirender ulang saat pengaturan berubah.
 *
 * Tanpa ini, halaman yang SUDAH terpasang saat pemuatan selesai akan terus
 * menampilkan nilai bawaan sampai halamannya dibuka ulang - dan merek yang
 * baru disimpan seperti tidak tersimpan.
 */
const pendengar = new Set<() => void>();

function beriTahuPendengar(): void { for (const f of pendengar) f(); }

function pakaiPengaturan<T>(ambil: () => T): T {
  const [nilai, setNilai] = useState<T>(ambil);
  useEffect(() => {
    const segarkan = () => setNilai(ambil());
    pendengar.add(segarkan);
    void muatMerek().then(segarkan);
    return () => { pendengar.delete(segarkan); };
    // ambil() selalu membaca variabel modul yang sama, jadi tidak perlu ikut
    // sebagai dependensi - memasukkannya justru memasang ulang tiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return nilai;
}

/** Merek yang sedang berlaku, ikut berubah saat pengaturan disimpan. */
export function useMerek(): Merek { return pakaiPengaturan(merek); }
