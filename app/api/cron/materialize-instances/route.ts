import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { jalankanSemuaJadwal } from '@/lib/fs-jadwal-server';

export const dynamic = 'force-dynamic';

/**
 * /api/cron/materialize-instances - dipanggil Vercel Cron (lihat vercel.json,
 * jadwal "0 0 * * *") sekali sehari untuk membuat fs_execution_instances
 * PROAKTIF untuk seluruh fs_pic_assignments aktif hari ini - bukan lagi
 * hanya lazy/on-demand saat technician-nya sendiri membuka /teknisi.
 *
 * Kenapa ini penting: sebelum route ini ada, technician yang TIDAK PERNAH
 * membuka aplikasi pada suatu hari tidak meninggalkan jejak SAMA SEKALI -
 * bukan status NOT_STARTED, benar-benar tidak ada baris. Admin (tab
 * Execution) dan ringkasan Deployment Completion jadi tidak bisa
 * membedakan "memang tidak dijadwalkan" dari "dijadwalkan tapi bolos".
 * Baris migrasi 013 (fs_materialize_daily_instances) melakukan pekerjaan
 * yang sama seperti fs_ensure_today_instance (007/011), tapi untuk SEMUA
 * assignment aktif sekaligus, bukan cuma milik satu PIC yang sedang login -
 * makanya harus lewat service_role (route ini), bukan RPC biasa dari klien.
 *
 * Sekaligus membuat SIKLUS MINGGUAN OTOMATIS untuk project yang jadwal
 * harinya sudah dipilih Admin (lib/fs-jadwal-server.ts).
 *
 * Diamankan dengan CRON_SECRET (header Authorization: Bearer <secret>,
 * persis konvensi Vercel Cron) - lihat docs/field-service-deployment-guide.md
 * untuk cara memasangnya di Vercel.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET belum diset di environment.' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Tidak diotorisasi.' }, { status: 401 });
  }

  const supabase = getAdminClient();

  // Siklus mingguan otomatis DULUAN: instance yang dibuat di bawah lalu
  // langsung tersambung ke siklus minggu ini, bukan menggantung tanpa siklus.
  // Gagal di satu project tidak boleh menghentikan materialisasi harian.
  const siklus = await jalankanSemuaJadwal(supabase).catch((e: unknown) =>
    [{ projectId: '-', status: 'gagal' as const, pesan: e instanceof Error ? e.message : String(e) }]);

  const { data, error } = await supabase.rpc('fs_materialize_daily_instances');
  if (error) {
    return NextResponse.json({ ok: false, error: error.message, siklus }, { status: 500 });
  }
  return NextResponse.json({ ok: true, instances_created: data, siklus });
}
