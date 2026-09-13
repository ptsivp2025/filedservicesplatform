import { supabase } from './supabase';

/**
 * lib/evidence-url.ts - signed URL untuk bucket privat `fs-evidence`, DI-CACHE
 * per (bucket, path) di memori tab ini.
 *
 * KENAPA INI PENTING UNTUK EGRESS: createSignedUrl() menempelkan token acak
 * baru setiap dipanggil, jadi URL-nya SELALU beda walau file yang dituju
 * sama persis. Browser meng-cache response HTTP berdasarkan URL PENUH -
 * signed URL baru berarti cache lama tidak pernah kepakai, dan foto yang
 * TIDAK BERUBAH ikut ke-download ulang (egress penuh) setiap kali galeri
 * dibuka lagi (reviewer buka-tutup TV yang sama, admin bolak-balik gedung).
 * Dengan cache di sini, membuka galeri yang sama dua kali dalam ~55 menit
 * memakai URL yang PERSIS SAMA -> browser cache yang menjawab, bukan Supabase.
 *
 * Sengaja Map biasa (bukan localStorage/sessionStorage): token di URL adalah
 * kredensial akses sementara, tidak perlu (dan tidak boleh) bertahan lewat
 * reload halaman - hilang begitu tab ini ditutup sudah benar.
 */

const TTL_DETIK = 3600;
// Buffer 5 menit sebelum kedaluwarsa asli - supaya URL yang sedang dipakai
// tidak basi di tengah render karena selisih waktu jaringan/klien.
const BUFFER_MS = 5 * 60 * 1000;

interface Entri { url: string; kedaluwarsaMs: number; }

const cache = new Map<string, Entri>();

function kunci(bucket: string, path: string) {
  return `${bucket}/${path}`;
}

/** Satu signed URL, dari cache kalau masih segar. */
export async function ambilSignedUrl(bucket: string, path: string): Promise<string | null> {
  const k = kunci(bucket, path);
  const ada = cache.get(k);
  if (ada && ada.kedaluwarsaMs > Date.now()) return ada.url;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, TTL_DETIK);
  if (error || !data?.signedUrl) { cache.delete(k); return null; }

  cache.set(k, { url: data.signedUrl, kedaluwarsaMs: Date.now() + TTL_DETIK * 1000 - BUFFER_MS });
  return data.signedUrl;
}

/** Banyak sekaligus - dipakai galeri evidence per-TV/per-instance. */
export async function ambilSignedUrls<T extends { bucket: string; path: string }>(
  items: T[],
): Promise<(T & { signedUrl: string | null })[]> {
  return Promise.all(items.map(async item => ({
    ...item,
    signedUrl: await ambilSignedUrl(item.bucket, item.path),
  })));
}

/** Dipanggil setelah foto dihapus - URL lama tidak boleh terus ditawarkan
 *  dari cache walau belum kedaluwarsa menurut jamnya sendiri. */
export function lupakanSignedUrl(bucket: string, path: string): void {
  cache.delete(kunci(bucket, path));
}
