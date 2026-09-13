'use client';

/**
 * Admin Panel -> App Rilis. Daftar versi APK Android (dibungkus Capacitor,
 * lihat capacitor.config.ts) yang sudah di-build - baik lewat GitHub Actions
 * (.github/workflows/build-apk.yml, otomatis setiap push ke main) maupun
 * upload manual di sini (mis. build lokal dari Android Studio tanpa CI).
 *
 * Halaman ini HANYA membaca/menulis lewat /api/app-releases (service_role) -
 * app_releases tidak punya policy INSERT untuk anon/authenticated sama
 * sekali, lihat migrations/008_app_releases.sql.
 */

import { useEffect, useState } from 'react';

interface Rilis {
  id: string;
  version_name: string;
  version_code: number;
  changelog: string | null;
  apk_path: string;
  apk_size_bytes: number | null;
  created_by: string | null;
  created_at: string;
  download_url: string;
}

function formatUkuran(bytes: number | null): string {
  if (!bytes) return '-';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function AppReleasesInline() {
  const [rilis, setRilis] = useState<Rilis[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pesan, setPesan] = useState<{ tipe: 'ok' | 'gagal'; teks: string } | null>(null);
  const [form, setForm] = useState({ version_name: '', version_code: '', changelog: '' });
  const [apkFile, setApkFile] = useState<File | null>(null);

  const muat = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/app-releases', { credentials: 'include' });
      const j = await r.json() as { ok?: boolean; rilis?: Rilis[] };
      if (j?.ok && j.rilis) setRilis(j.rilis);
    } catch { /* diam - daftar tetap kosong, tabel di bawah menunjukkan itu */ }
    setLoading(false);
  };

  useEffect(() => { muat(); }, []);

  const handleUpload = async () => {
    if (!apkFile) { setPesan({ tipe: 'gagal', teks: 'Pilih file .apk dulu.' }); return; }
    if (!form.version_name.trim() || !form.version_code.trim()) {
      setPesan({ tipe: 'gagal', teks: 'Nama versi & kode versi wajib diisi.' }); return;
    }
    setUploading(true); setPesan(null);
    try {
      const fd = new FormData();
      fd.append('apk', apkFile);
      fd.append('version_name', form.version_name.trim());
      fd.append('version_code', form.version_code.trim());
      fd.append('changelog', form.changelog.trim());
      const r = await fetch('/api/app-releases', { method: 'POST', credentials: 'include', body: fd });
      const j = await r.json() as { ok?: boolean; alasan?: string };
      if (!j?.ok) { setPesan({ tipe: 'gagal', teks: j?.alasan ?? 'Upload gagal.' }); setUploading(false); return; }
      setPesan({ tipe: 'ok', teks: `Rilis v${form.version_name} berhasil diunggah.` });
      setForm({ version_name: '', version_code: '', changelog: '' });
      setApkFile(null);
      await muat();
    } catch {
      setPesan({ tipe: 'gagal', teks: 'Tidak bisa menghubungi server.' });
    }
    setUploading(false);
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
        <h3 className="font-bold text-slate-800 text-sm mb-1">Upload Rilis Baru</h3>
        <p className="text-xs text-slate-500 mb-4">
          Biasanya terisi otomatis lewat GitHub Actions setiap push ke branch main. Pakai form ini hanya untuk
          upload APK yang di-build manual (mis. lokal dari Android Studio).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nama Versi (mis. 1.2.0)</label>
            <input type="text" value={form.version_name} onChange={e => setForm(f => ({ ...f, version_name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" placeholder="1.2.0" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Kode Versi (angka, harus naik)</label>
            <input type="number" value={form.version_code} onChange={e => setForm(f => ({ ...f, version_code: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" placeholder="2" />
          </div>
        </div>
        <div className="mb-3">
          <label className="block text-xs font-semibold text-slate-600 mb-1">Catatan Perubahan (opsional)</label>
          <textarea value={form.changelog} onChange={e => setForm(f => ({ ...f, changelog: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" rows={2} placeholder="Perbaikan bug check-in..." />
        </div>
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-600 mb-1">File APK</label>
          <input type="file" accept=".apk" onChange={e => setApkFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm" />
        </div>
        {pesan && (
          <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium ${pesan.tipe === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {pesan.teks}
          </div>
        )}
        <button type="button" onClick={handleUpload} disabled={uploading}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: '#4338ca' }}>
          {uploading ? 'Mengunggah...' : 'Upload Rilis'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-sm">Riwayat Rilis</h3>
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-400">Memuat...</div>
        ) : rilis.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">Belum ada rilis APK.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rilis.map(r => (
              <div key={r.id} className="px-4 sm:px-5 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-slate-800">v{r.version_name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">code {r.version_code}</span>
                    <span className="text-[10px] text-slate-400">{formatUkuran(r.apk_size_bytes)}</span>
                  </div>
                  {r.changelog && <p className="text-xs text-slate-500 mt-1">{r.changelog}</p>}
                  <p className="text-[10px] text-slate-400 mt-1">
                    {new Date(r.created_at).toLocaleString('id-ID')} • {r.created_by ?? '-'}
                  </p>
                </div>
                <a href={r.download_url} target="_blank" rel="noopener noreferrer"
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                  style={{ background: '#0e7490' }}>
                  Unduh APK
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
