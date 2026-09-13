'use client';

/**
 * HeaderKanan.tsx - isi sudut kanan atas header.
 *
 * Sebelumnya kosong sama sekali dalam mode sidebar: logo di kiri, lalu ruang
 * kosong selebar layar. Dua hal yang pantas mengisinya, keduanya berlaku di
 * SEMUA halaman (bukan cuma dashboard):
 *
 *  1. KONTEKS - siklus mana yang sedang berjalan dan sudah berapa persen.
 *     Saat seseorang sedang membuka Locations atau Review, ia tetap perlu
 *     tahu keadaan akhir pekan yang sedang dikerjakan tanpa kembali dulu ke
 *     dashboard.
 *  2. LONCENG - kabar yang ditujukan kepada dirinya. Selama ini notifikasi
 *     in-app ditulis ke tabel `notifications` tapi tidak pernah ada tempat
 *     untuk melihatnya, sehingga setiap permintaan revisi dan setiap
 *     check-out yang butuh persetujuan hanya diketahui kalau orangnya
 *     kebetulan membuka halaman yang tepat.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, CircleDot, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ambilCycles, cycleBerjalan, ambilOverview, projectAktif, persen, warnaProgress, CYCLE_STATUS_LABEL } from '@/lib/fs-cycle';

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
}

function waktuRelatif(ts: string): string {
  const d = new Date(ts);
  const menit = Math.floor((Date.now() - d.getTime()) / 60000);
  if (menit < 1) return 'Baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari < 7) return `${hari} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function HeaderKanan({ userId, onBuka }: {
  userId: string;
  /** Membuka halaman tujuan notifikasi (dipakai kerangka dashboard). */
  onBuka?: (url: string, judul: string) => void;
}) {
  // ── Konteks siklus ──
  const [siklus, setSiklus] = useState<{ nama: string; pct: number; status: string } | null>(null);

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const projectId = await projectAktif();
        if (!projectId || batal) return;
        const daftar = await ambilCycles(projectId);
        const c = cycleBerjalan(daftar);
        if (!c || batal) return;
        const ov = await ambilOverview(c.id);
        if (batal) return;
        setSiklus({ nama: c.name, pct: persen(ov.completed_tv, ov.total_tv), status: c.status });
      } catch { /* diam - konteks tambahan, bukan bagian alur kerja */ }
    })();
    return () => { batal = true; };
  }, []);

  // ── Lonceng ──
  const [buka, setBuka] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [memuat, setMemuat] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const muat = useCallback(async () => {
    if (!userId) return;
    setMemuat(true);
    const { data } = await supabase.from('notifications')
      .select('id, type, title, body, action_url, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    setItems((data ?? []) as Notif[]);
    setMemuat(false);
  }, [userId]);

  useEffect(() => {
    void muat();
    // Satu menit sekali sudah cukup: ini kabar operasional, bukan pesan
    // obrolan. Polling lebih rapat hanya menambah beban tanpa mengubah
    // keputusan siapa pun.
    const t = window.setInterval(() => { void muat(); }, 60000);
    return () => window.clearInterval(t);
  }, [muat]);

  useEffect(() => {
    if (!buka) return;
    const tutup = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('mousedown', tutup);
    return () => document.removeEventListener('mousedown', tutup);
  }, [buka]);

  const belumDibaca = items.filter(n => !n.is_read).length;

  const tandaiSemua = async () => {
    if (belumDibaca === 0) return;
    setItems(x => x.map(n => ({ ...n, is_read: true })));
    await supabase.from('notifications').update({ is_read: true })
      .eq('user_id', userId).eq('is_read', false);
  };

  const klikItem = async (n: Notif) => {
    if (!n.is_read) {
      setItems(x => x.map(i => i.id === n.id ? { ...i, is_read: true } : i));
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id);
    }
    if (n.action_url && onBuka) {
      setBuka(false);
      onBuka(n.action_url, n.title);
    }
  };

  const st = siklus ? CYCLE_STATUS_LABEL[siklus.status as keyof typeof CYCLE_STATUS_LABEL] : null;

  return (
    <div className="flex items-center gap-2">
      {/* Konteks siklus - disembunyikan di layar sempit supaya tidak
          bertabrakan dengan tombol menu. */}
      {siklus && (
        <div className="hidden lg:flex items-center gap-2.5 pl-3 pr-3.5 py-1.5 rounded-xl border border-slate-200 bg-white/70">
          <div className="leading-tight">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Siklus berjalan</p>
            <p className="text-[12px] font-bold text-slate-700 truncate max-w-[190px]">{siklus.nama}</p>
          </div>
          <div className="text-right leading-tight">
            <p className="text-[15px] font-bold tabular-nums" style={{ color: warnaProgress(siklus.pct) }}>
              {siklus.pct}%
            </p>
            {st && <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: st.color }}>{st.label}</p>}
          </div>
        </div>
      )}

      {/* Lonceng */}
      <div ref={ref} className="relative">
        <button type="button" onClick={() => { setBuka(b => !b); if (!buka) void muat(); }}
          aria-label={belumDibaca > 0 ? `${belumDibaca} notifikasi belum dibaca` : 'Notifikasi'}
          aria-expanded={buka}
          className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors duration-200 cursor-pointer border focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          style={{
            background: belumDibaca > 0 ? '#EFF6FF' : 'rgba(255,255,255,0.7)',
            borderColor: belumDibaca > 0 ? '#BFDBFE' : '#E2E8F0',
            color: belumDibaca > 0 ? '#1E40AF' : '#64748B',
          }}>
          <Bell size={17} />
          {belumDibaca > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full text-white text-[10px] font-bold grid place-items-center tabular-nums"
              style={{ background: '#DC2626' }}>
              {belumDibaca > 99 ? '99+' : belumDibaca}
            </span>
          )}
        </button>

        {buka && (
          <div className="absolute top-full right-0 mt-2 w-[min(360px,calc(100vw-1.5rem))] rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden z-[60]">
            <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-wider text-slate-600">Notifikasi</p>
                <p className="text-[10px] text-slate-400">
                  {belumDibaca > 0 ? `${belumDibaca} belum dibaca` : 'Semua sudah dibaca'}
                </p>
              </div>
              {belumDibaca > 0 && (
                <button type="button" onClick={() => void tandaiSemua()}
                  className="text-[11px] font-bold text-blue-700 hover:underline flex items-center gap-1 cursor-pointer">
                  <CheckCheck size={12} aria-hidden="true" /> Tandai semua
                </button>
              )}
            </div>

            <div className="max-h-[380px] overflow-y-auto">
              {memuat && items.length === 0 ? (
                <p className="text-[12px] text-slate-400 text-center py-8 flex items-center justify-center gap-2">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Memuat…
                </p>
              ) : items.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-[13px] font-bold text-slate-700">Belum ada notifikasi</p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Kabar akan muncul di sini saat ada permintaan revisi, check-out yang butuh
                    persetujuan, atau siklus yang berpindah tahap.
                  </p>
                </div>
              ) : items.map(n => (
                <button key={n.id} type="button" onClick={() => void klikItem(n)}
                  className="w-full text-left px-3.5 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors duration-150 flex gap-2.5 cursor-pointer">
                  <span className="mt-1 flex-shrink-0" aria-hidden="true">
                    <CircleDot size={11} style={{ color: n.is_read ? '#CBD5E1' : '#2563EB' }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12.5px] leading-snug ${n.is_read ? 'text-slate-600 font-medium' : 'text-slate-900 font-bold'}`}>
                      {n.title}
                    </span>
                    {n.body && <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">{n.body}</span>}
                    <span className="block text-[10px] text-slate-400 mt-1">{waktuRelatif(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
