'use client';

/**
 * modal-audit.tsx - "Jejak Audit" di Admin Panel.
 *
 * Siapa mengubah apa, kapan, dan menjadi apa. Datanya ditulis DARI DATABASE
 * (fungsi fs_catat di dalam tiap fungsi lifecycle + trigger fs_audit_trigger
 * untuk perubahan baris data induk), sehingga tidak ada jalan memutarnya:
 * memanggil RPC langsung tanpa lewat UI tetap tercatat.
 *
 * Dibaca lewat fs_audit_feed() yang MEMERIKSA PERANNYA SENDIRI - hanya
 * Provider Admin. Menyembunyikan menu ini dari peran lain hanyalah kerapian;
 * penjaganya ada di database, dan sudah diuji: akun client yang memanggil
 * fungsi ini langsung tetap ditolak.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollText, Search, RefreshCw, ShieldAlert, Activity, CalendarClock, UserCog, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface BarisAudit {
  id: string;
  waktu: string;
  aksi: string;
  tabel: string;
  row_id: string | null;
  pelaku: string;
  peran: string;
  ringkasan: string | null;
  konteks: Record<string, unknown> | null;
}

interface Ringkasan {
  total: number; hari_ini: number; minggu_ini: number;
  pelaku_aktif: number; destruktif: number;
  per_aksi: { aksi: string; jumlah: number }[];
}

/** Warna per jenis aksi - merah untuk yang menghapus/menutup permanen,
 *  supaya baris paling berisiko langsung terlihat saat menelusuri. */
function warnaAksi(aksi: string): { c: string; bg: string } {
  if (aksi.startsWith('CLEAR') || aksi === 'DELETE') return { c: '#B91C1C', bg: '#FEE2E2' };
  if (aksi.includes('REJECT') || aksi === 'REVIEW_TV') return { c: '#C2410C', bg: '#FFEDD5' };
  if (aksi.includes('APPROVE') || aksi.includes('CLOSED')) return { c: '#047857', bg: '#D1FAE5' };
  if (aksi === 'INSERT' || aksi.includes('GENERATE')) return { c: '#1E40AF', bg: '#DBEAFE' };
  return { c: '#475569', bg: '#F1F5F9' };
}

function waktuPanjang(ts: string): string {
  return new Date(ts).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function AuditLogInline() {
  const [baris, setBaris] = useState<BarisAudit[]>([]);
  const [ringkasan, setRingkasan] = useState<Ringkasan | null>(null);
  const [cari, setCari] = useState('');
  const [aksiFilter, setAksiFilter] = useState('');
  const [halaman, setHalaman] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const UKURAN = 60;

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    const [{ data: feed, error: e1 }, { data: rk }] = await Promise.all([
      supabase.rpc('fs_audit_feed', {
        p_limit: UKURAN, p_offset: halaman * UKURAN,
        p_cari: cari.trim() || null, p_aksi: aksiFilter || null,
      }),
      supabase.rpc('fs_audit_ringkasan'),
    ]);
    setMemuat(false);
    if (e1) { setGalat(e1.message); return; }
    setBaris((feed ?? []) as BarisAudit[]);
    if (rk) setRingkasan(rk as Ringkasan);
  }, [halaman, cari, aksiFilter]);

  useEffect(() => { void muat(); }, [muat]);

  // Ketikan pencarian tidak langsung memanggil server tiap huruf.
  const [ketikan, setKetikan] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => { setCari(ketikan); setHalaman(0); }, 400);
    return () => window.clearTimeout(t);
  }, [ketikan]);

  if (galat) {
    return (
      <div className="h-full grid place-items-center p-6">
        <div className="text-center max-w-md">
          <ShieldAlert size={28} className="mx-auto text-red-400 mb-2" />
          <p className="text-[14px] font-bold text-slate-800">Tidak bisa membaca jejak audit</p>
          <p className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">{galat}</p>
          <p className="text-[11px] text-slate-400 mt-3">
            Jejak audit hanya bisa dibuka oleh Provider Admin — pembatasannya ada di database,
            bukan di tampilan ini.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Ringkasan */}
      {ringkasan && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          {[
            { i: ScrollText, l: 'Total catatan', v: ringkasan.total, c: '#1E40AF' },
            { i: CalendarClock, l: 'Hari ini', v: ringkasan.hari_ini, c: '#0D9488' },
            { i: Activity, l: '7 hari terakhir', v: ringkasan.minggu_ini, c: '#3B82F6' },
            { i: UserCog, l: 'Pelaku aktif (7 hari)', v: ringkasan.pelaku_aktif, c: '#7C3AED' },
            { i: ShieldAlert, l: 'Aksi destruktif', v: ringkasan.destruktif, c: '#DC2626' },
          ].map(k => (
            <div key={k.l} className="bg-white rounded-xl border border-slate-200 p-3">
              <span className="w-7 h-7 rounded-lg grid place-items-center mb-2"
                style={{ background: `${k.c}14`, color: k.c }} aria-hidden="true">
                <k.i size={14} />
              </span>
              <p className="text-[20px] font-bold tabular-nums leading-none text-slate-900">
                {k.v.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] font-semibold text-slate-500 mt-1.5 leading-tight">{k.l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sebaran jenis aksi 30 hari - membantu menemukan pola, mis. lonjakan
          penghapusan yang tidak wajar. */}
      {ringkasan && ringkasan.per_aksi.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3.5">
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-600 mb-2.5">
            Jenis aksi — 30 hari terakhir
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {ringkasan.per_aksi.map(a => {
              const w = warnaAksi(a.aksi);
              const aktif = aksiFilter === a.aksi;
              return (
                <button key={a.aksi} type="button"
                  onClick={() => { setAksiFilter(aktif ? '' : a.aksi); setHalaman(0); }}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors duration-150 cursor-pointer tabular-nums"
                  style={aktif
                    ? { color: '#fff', background: w.c, borderColor: w.c }
                    : { color: w.c, background: w.bg, borderColor: 'transparent' }}>
                  {a.aksi} <span className="opacity-70">· {a.jumlah}</span>
                </button>
              );
            })}
            {aksiFilter && (
              <button type="button" onClick={() => { setAksiFilter(''); setHalaman(0); }}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 cursor-pointer">
                Hapus filter
              </button>
            )}
          </div>
        </div>
      )}

      {/* Daftar */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-600">Catatan Perubahan</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={ketikan} onChange={e => setKetikan(e.target.value)}
                placeholder="Cari pelaku / aksi / keterangan…" autoComplete="off"
                className="text-[12px] border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 w-60 focus:outline-none focus:border-blue-400" />
            </div>
            <button type="button" onClick={() => void muat()} disabled={memuat}
              className="w-8 h-8 rounded-lg border border-slate-200 grid place-items-center text-slate-500 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              aria-label="Muat ulang">
              <RefreshCw size={13} className={memuat ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {memuat && baris.length === 0 ? (
          <p className="text-[12px] text-slate-400 text-center py-10 flex items-center justify-center gap-2">
            <Loader2 size={13} className="animate-spin" /> Memuat jejak audit…
          </p>
        ) : baris.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-[13px] font-bold text-slate-700">Belum ada catatan</p>
            <p className="text-[11px] text-slate-500 mt-1">
              {cari || aksiFilter ? 'Tidak ada yang cocok dengan pencarian ini.' : 'Aksi pengguna akan tercatat di sini secara otomatis.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-3.5 py-2 whitespace-nowrap">Waktu</th>
                  <th className="text-left px-3 py-2">Pelaku</th>
                  <th className="text-left px-3 py-2">Aksi</th>
                  <th className="text-left px-3 py-2">Keterangan</th>
                  <th className="text-left px-3.5 py-2">Objek</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {baris.map(b => {
                  const w = warnaAksi(b.aksi);
                  return (
                    <tr key={b.id} className="hover:bg-slate-50 transition-colors duration-150 align-top">
                      <td className="px-3.5 py-2 text-slate-500 whitespace-nowrap tabular-nums">{waktuPanjang(b.waktu)}</td>
                      <td className="px-3 py-2">
                        <span className="block font-semibold text-slate-800">{b.pelaku}</span>
                        <span className="block text-[10px] text-slate-400">{b.peran}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                          style={{ color: w.c, background: w.bg }}>{b.aksi}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 max-w-md">
                        {b.ringkasan ?? <span className="text-slate-300">—</span>}
                        {b.konteks && Object.keys(b.konteks).length > 0 && (
                          <details className="mt-1">
                            <summary className="text-[10px] text-blue-700 cursor-pointer hover:underline">rincian</summary>
                            <pre className="text-[10px] text-slate-500 bg-slate-50 rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(b.konteks, null, 2)}
                            </pre>
                          </details>
                        )}
                      </td>
                      <td className="px-3.5 py-2">
                        <span className="block text-[10px] font-mono text-slate-500">{b.tabel}</span>
                        {b.row_id && <span className="block text-[9px] font-mono text-slate-300">{b.row_id.slice(0, 8)}…</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-3.5 py-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400 tabular-nums">
            Halaman {halaman + 1}
            {baris.length > 0 && ` · ${baris.length} catatan`}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={halaman === 0 || memuat}
              onClick={() => setHalaman(h => Math.max(0, h - 1))}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer">
              Sebelumnya
            </button>
            <button type="button" disabled={baris.length < UKURAN || memuat}
              onClick={() => setHalaman(h => h + 1)}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer">
              Berikutnya
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
