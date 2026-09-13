/**
 * /api/app-releases - satu-satunya pintu masuk tabel app_releases + bucket
 * storage app-releases.
 *
 * DUA PEMANGGIL YANG SAH, dua cara membuktikan dirinya:
 *   1. GitHub Actions (.github/workflows/build-apk.yml), sesudah APK selesai
 *      di-build - tidak punya cookie sesi peramban, jadi memakai header
 *      x-release-secret yang dicocokkan ke APK_RELEASE_SECRET (env server).
 *   2. Admin lewat Admin Panel -> App Rilis (upload manual, mis. build lokal
 *      tanpa CI) - memakai cookie sesi seperti route admin lain, lihat
 *      lib/penjaga-admin.ts.
 * Keduanya menulis lewat service_role (getAdminClient), karena app_releases
 * memang tidak punya policy INSERT untuk anon/authenticated sama sekali -
 * lihat catatan di migrations/008_app_releases.sql.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { pastikanAdmin } from '@/lib/penjaga-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function pemanggilSah(req: NextRequest): Promise<{ ok: true; oleh: string } | { ok: false; status: number; alasan: string }> {
  const secretHeader = req.headers.get('x-release-secret');
  const secretEnv = process.env.APK_RELEASE_SECRET;
  if (secretEnv && secretHeader && secretHeader === secretEnv) {
    return { ok: true, oleh: 'GitHub Actions' };
  }
  const jaga = await pastikanAdmin(req);
  if (!jaga.ok) return { ok: false, status: jaga.status, alasan: jaga.alasan };
  return { ok: true, oleh: jaga.user.full_name || jaga.user.username };
}

export async function GET(req: NextRequest) {
  const jaga = await pastikanAdmin(req);
  if (!jaga.ok) return NextResponse.json({ ok: false, alasan: jaga.alasan }, { status: jaga.status });

  const db = getAdminClient();
  const { data, error } = await db
    .from('app_releases')
    .select('id, version_name, version_code, changelog, apk_path, apk_size_bytes, created_by, created_at')
    .order('version_code', { ascending: false });

  if (error) return NextResponse.json({ ok: false, alasan: error.message }, { status: 500 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const rilis = (data ?? []).map((r: { apk_path: string }) => ({
    ...r,
    download_url: `${url}/storage/v1/object/public/app-releases/${r.apk_path}`,
  }));
  return NextResponse.json({ ok: true, rilis });
}

export async function POST(req: NextRequest) {
  const pemanggil = await pemanggilSah(req);
  if (!pemanggil.ok) return NextResponse.json({ ok: false, alasan: pemanggil.alasan }, { status: pemanggil.status });

  const form = await req.formData();
  const file = form.get('apk');
  const versionName = String(form.get('version_name') ?? '').trim();
  const versionCodeRaw = String(form.get('version_code') ?? '').trim();
  const changelog = String(form.get('changelog') ?? '').trim() || null;
  const versionCode = Number(versionCodeRaw);

  if (!(file instanceof File)) return NextResponse.json({ ok: false, alasan: 'File APK wajib diisi.' }, { status: 400 });
  if (!versionName) return NextResponse.json({ ok: false, alasan: 'version_name wajib diisi.' }, { status: 400 });
  if (!Number.isInteger(versionCode) || versionCode <= 0) return NextResponse.json({ ok: false, alasan: 'version_code harus bilangan bulat positif.' }, { status: 400 });
  if (!file.name.toLowerCase().endsWith('.apk')) return NextResponse.json({ ok: false, alasan: 'File harus berformat .apk.' }, { status: 400 });

  const db = getAdminClient();
  const path = `${versionCode}-${versionName.replace(/[^a-zA-Z0-9._-]/g, '_')}.apk`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage
    .from('app-releases')
    .upload(path, buffer, { contentType: 'application/vnd.android.package-archive', upsert: true });
  if (uploadError) return NextResponse.json({ ok: false, alasan: uploadError.message }, { status: 500 });

  const { error: insertError } = await db.from('app_releases').upsert({
    version_name: versionName,
    version_code: versionCode,
    changelog,
    apk_path: path,
    apk_size_bytes: buffer.byteLength,
    created_by: pemanggil.oleh,
  }, { onConflict: 'version_code' });
  if (insertError) return NextResponse.json({ ok: false, alasan: insertError.message }, { status: 500 });

  return NextResponse.json({ ok: true, path });
}
