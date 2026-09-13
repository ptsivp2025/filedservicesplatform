import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { getAdminClient } from '@/lib/supabase-admin';

/**
 * POST /api/cycles/clear — langkah terakhir alur pembersihan data siklus.
 *
 * Ada di server, bukan di browser, karena dua alasan yang keduanya wajib:
 *  1. Menghapus objek Storage butuh service role — klien tidak boleh
 *     memegangnya.
 *  2. Angka "berapa file benar-benar terhapus" harus datang dari hasil
 *     penghapusan yang SESUNGGUHNYA, bukan dari klaim klien. Kalau sebagian
 *     gagal, siklus ditandai CLEAR_PARTIAL — bukan CLEARED. Jangan pernah
 *     melaporkan pembersihan selesai kalau kenyataannya tidak.
 *
 * Otorisasi diverifikasi DI SINI (sesi + peran), lalu dipertegas lagi oleh
 * fs_finalize_clear di database. Menyembunyikan tombol di UI bukan penjaga.
 */

/** Storage menolak permintaan hapus yang terlalu panjang; potong per batch. */
const UKURAN_BATCH = 100;

export async function POST(request: NextRequest) {
  const sesi = await getSessionUser(request);
  if (!sesi) {
    return NextResponse.json({ error: 'Sesi tidak valid. Silakan login ulang.' }, { status: 401 });
  }

  const supabase = getAdminClient();

  // Peran diambil ulang dari database, bukan dari apa pun yang dikirim klien.
  const { data: pengguna } = await supabase
    .from('users').select('role, access_level, fs_role').eq('id', sesi.id).single();

  const peran = (pengguna?.role ?? '').toLowerCase();
  const adminPenuh =
    peran === 'admin' || peran === 'superadmin' ||
    pengguna?.fs_role === 'PROVIDER_ADMIN' ||
    ((peran === 'team' || peran === 'team_pts') && pengguna?.access_level === 'full');

  if (!adminPenuh) {
    return NextResponse.json(
      { error: 'Hanya Provider Admin yang boleh menyetujui pembersihan data.' }, { status: 403 });
  }

  let cycleId: string | undefined;
  try {
    const body = await request.json();
    cycleId = typeof body?.cycleId === 'string' ? body.cycleId : undefined;
  } catch {
    return NextResponse.json({ error: 'Body permintaan tidak terbaca.' }, { status: 400 });
  }
  if (!cycleId) {
    return NextResponse.json({ error: 'cycleId wajib diisi.' }, { status: 400 });
  }

  // Daftar file diambil dari database, bukan dari klien — klien tidak boleh
  // menentukan file mana yang dihapus.
  const { data: berkas, error: galatDaftar } = await supabase
    .rpc('fs_cycle_evidence_paths', { p_cycle_id: cycleId });

  if (galatDaftar) {
    return NextResponse.json({ error: 'Gagal membaca daftar file: ' + galatDaftar.message }, { status: 500 });
  }

  type Berkas = { id: string; bucket: string; path: string };
  const daftar = (berkas ?? []) as Berkas[];

  let terhapus = 0;
  let gagal = 0;
  /**
   * File yang metadatanya ada tapi objeknya sudah tidak ada di Storage.
   * SENGAJA dihitung terpisah, bukan sebagai kegagalan: tujuan pembersihan
   * adalah "file itu tidak ada lagi", dan kondisi itu sudah terpenuhi.
   * Menyebutnya gagal akan membuat siklus berakhir CLEAR_PARTIAL selamanya
   * padahal tidak ada yang perlu diperbaiki — dan sebaliknya, menyembunyikan
   * angkanya akan menutupi metadata yatim yang perlu diketahui operator.
   */
  let tidakDitemukan = 0;
  const catatanGagal: string[] = [];

  // Dikelompokkan per bucket — nyaris selalu 'fs-evidence', tapi jangan
  // berasumsi begitu untuk data lama.
  const perBucket = new Map<string, string[]>();
  for (const b of daftar) {
    const kumpulan = perBucket.get(b.bucket) ?? [];
    kumpulan.push(b.path);
    perBucket.set(b.bucket, kumpulan);
  }

  for (const [bucket, paths] of perBucket) {
    for (let i = 0; i < paths.length; i += UKURAN_BATCH) {
      const batch = paths.slice(i, i + UKURAN_BATCH);
      try {
        const { data, error } = await supabase.storage.from(bucket).remove(batch);
        if (error) {
          gagal += batch.length;
          if (catatanGagal.length < 5) catatanGagal.push(error.message);
          continue;
        }
        // Storage mengembalikan objek yang BENAR-BENAR terhapus. Selisihnya
        // adalah file yang memang sudah tidak ada di sana — bukan kegagalan
        // (lihat catatan pada `tidakDitemukan`), tapi tetap dilaporkan.
        const jumlah = Array.isArray(data) ? data.length : 0;
        terhapus += jumlah;
        if (jumlah < batch.length) tidakDitemukan += batch.length - jumlah;
      } catch (e) {
        gagal += batch.length;
        if (catatanGagal.length < 5) catatanGagal.push(e instanceof Error ? e.message : 'Kesalahan tidak dikenal');
      }
    }
  }

  const { data: hasil, error: galatFinal } = await supabase.rpc('fs_finalize_clear', {
    p_cycle_id: cycleId,
    p_objects_deleted: terhapus,
    p_objects_failed: gagal,
    p_actor_id: sesi.id,
  });

  if (galatFinal) {
    return NextResponse.json(
      { error: 'File sudah diproses tapi status siklus gagal diperbarui: ' + galatFinal.message },
      { status: 500 });
  }

  return NextResponse.json({
    ...(hasil as Record<string, unknown>),
    objects_total: daftar.length,
    objects_missing: tidakDitemukan,
    catatan_gagal: catatanGagal,
  });
}
