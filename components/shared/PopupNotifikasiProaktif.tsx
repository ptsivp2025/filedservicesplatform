'use client';

/**
 * PopupNotifikasiProaktif.tsx - kabar yang MUNCUL SENDIRI, bukan menunggu
 * diklik.
 *
 * Lonceng di header (HeaderKanan.tsx) sudah menyimpan seluruh riwayat
 * notifikasi, tapi sifatnya pasif: kalau orangnya tidak mengklik ikonnya,
 * kabar "check-out perlu persetujuan" atau "TV diminta diulang" bisa
 * terlewat berhari-hari. Komponen ini menaruh ringkasan yang sama di depan
 * mata begitu halaman terbuka, sekali per sesi per isi (lihat kunciSesi) -
 * supaya tidak mengganggu di kunjungan berikutnya kalau memang tidak ada
 * yang baru, tapi muncul lagi begitu isinya berubah.
 */

import React, { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';

export interface ButirNotifProaktif {
  teks: string;
  warna?: string;
}

export function PopupNotifikasiProaktif({
  kunciSesi, judul, butir, warna = '#1E40AF', onLihat, tutupLabel = 'Nanti saja', lihatLabel = 'Lihat',
}: {
  /** Kunci unik sessionStorage - sertakan id user + tanggal + jumlah/isi
   *  supaya popup muncul lagi begitu datanya benar-benar berubah, bukan
   *  berhenti selamanya setelah ditutup sekali. */
  kunciSesi: string;
  judul: string;
  butir: ButirNotifProaktif[];
  warna?: string;
  onLihat?: () => void;
  tutupLabel?: string;
  lihatLabel?: string;
}) {
  const [tampil, setTampil] = useState(false);

  useEffect(() => {
    if (butir.length === 0) { setTampil(false); return; }
    try {
      if (sessionStorage.getItem(kunciSesi) === '1') return;
    } catch { /* mode privat dsb - tampilkan saja, tidak fatal */ }
    const t = window.setTimeout(() => setTampil(true), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunciSesi, butir.length]);

  const tutup = () => {
    setTampil(false);
    try { sessionStorage.setItem(kunciSesi, '1'); } catch { /* abaikan */ }
  };

  if (!tampil || butir.length === 0) return null;

  return (
    <div role="alert" aria-live="polite"
      className="fixed top-4 right-4 z-[1200] w-[min(380px,calc(100vw-2rem))] animate-fade-in">
      <div className="rounded-2xl shadow-2xl border overflow-hidden bg-white" style={{ borderColor: `${warna}40` }}>
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-3" style={{ background: `${warna}0d` }}>
          <span className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0" style={{ background: warna, color: '#fff' }}>
            <BellRing size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-slate-800 leading-snug">{judul}</p>
            <ul className="mt-1.5 space-y-1">
              {butir.slice(0, 4).map((b, i) => (
                <li key={i} className="text-[11.5px] text-slate-600 leading-snug flex items-start gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: b.warna ?? warna }} />
                  <span className="min-w-0">{b.teks}</span>
                </li>
              ))}
              {butir.length > 4 && (
                <li className="text-[10.5px] text-slate-400 pl-3">+{butir.length - 4} lainnya</li>
              )}
            </ul>
          </div>
          <button type="button" onClick={tutup} aria-label="Tutup"
            className="text-slate-300 hover:text-slate-500 cursor-pointer flex-shrink-0 transition-colors duration-150">
            <X size={15} />
          </button>
        </div>
        <div className="flex gap-2 px-4 py-2.5 border-t border-slate-100">
          <button type="button" onClick={tutup}
            className="flex-1 text-[12px] font-semibold py-1.5 rounded-lg text-slate-500 hover:bg-slate-50 cursor-pointer transition-colors duration-150">
            {tutupLabel}
          </button>
          <button type="button" onClick={() => { onLihat?.(); tutup(); }}
            className="flex-1 text-[12px] font-bold py-1.5 rounded-lg text-white cursor-pointer transition-opacity duration-150 hover:opacity-90"
            style={{ background: warna }}>
            {lihatLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
