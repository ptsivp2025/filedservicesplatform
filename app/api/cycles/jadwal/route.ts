import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { getAdminClient } from '@/lib/supabase-admin';
import { bacaJadwal, kunciJadwal } from '@/lib/fs-jadwal';
import { buatSiklusMingguIni } from '@/lib/fs-jadwal-server';

export const dynamic = 'force-dynamic';

/**
 * /api/cycles/jadwal - baca & simpan jadwal siklus mingguan otomatis.
 *
 * Ditulis lewat server (service role) karena kebijakan app_settings hanya
 * mengizinkan lingkup "semua" (admin sistem), padahal yang mengatur jadwal
 * operasional adalah Provider Admin. Peran diperiksa ulang DI SINI dari
 * tabel users - menyembunyikan tombol di UI bukan penjaga.
 *
 * Setelah tersimpan, siklus minggu berjalan langsung dibuat bila hari
 * pengerjaannya belum lewat, supaya Admin melihat hasilnya seketika dan
 * tidak menunggu cron besok pagi.
 */

async function pemanggilBoleh(request: NextRequest): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const sesi = await getSessionUser(request);
  if (!sesi) return { ok: false, res: NextResponse.json({ error: 'Sesi tidak valid. Silakan login ulang.' }, { status: 401 }) };
  const db = getAdminClient();
  const { data: u } = await db.from('users').select('role, access_level, fs_role').eq('id', sesi.id).single();
  const peran = (u?.role ?? '').toLowerCase();
  const boleh = peran === 'admin' || peran === 'superadmin' || u?.fs_role === 'PROVIDER_ADMIN'
    || ((peran === 'team' || peran === 'team_pts') && u?.access_level === 'full');
  if (!boleh) return { ok: false, res: NextResponse.json({ error: 'Hanya Provider Admin yang boleh mengatur jadwal siklus.' }, { status: 403 }) };
  return { ok: true };
}

export async function GET(request: NextRequest) {
  const sesi = await getSessionUser(request);
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 });
  const projectId = request.nextUrl.searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId wajib diisi.' }, { status: 400 });
  const { data } = await getAdminClient().from('app_settings').select('value').eq('key', kunciJadwal(projectId)).maybeSingle();
  let nilai: unknown = data?.value ?? null;
  if (typeof nilai === 'string') { try { nilai = JSON.parse(nilai); } catch { nilai = null; } }
  return NextResponse.json({ jadwal: bacaJadwal(nilai) });
}

export async function POST(request: NextRequest) {
  const cek = await pemanggilBoleh(request);
  if (!cek.ok) return cek.res;

  let body: { projectId?: unknown; jadwal?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Body permintaan tidak terbaca.' }, { status: 400 });
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  if (!projectId) return NextResponse.json({ error: 'projectId wajib diisi.' }, { status: 400 });

  const db = getAdminClient();
  const { data: proyek } = await db.from('fs_projects').select('id').eq('id', projectId).maybeSingle();
  if (!proyek) return NextResponse.json({ error: 'Project tidak ditemukan.' }, { status: 404 });

  const jadwal = bacaJadwal(body.jadwal);
  const { error } = await db.from('app_settings')
    .upsert({ key: kunciJadwal(projectId), value: jadwal, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: 'Gagal menyimpan jadwal: ' + error.message }, { status: 500 });

  const hasil = await buatSiklusMingguIni(db, projectId, jadwal);
  return NextResponse.json({ jadwal, hasil });
}
