'use client';

/**
 * Kartu ringkasan angka (Total / Pending / Selesai / dst) untuk semua modul.
 *
 * Permukaan putih dengan angka gelap; warna hanya dipakai sebagai penanda
 * kategori lewat pita tipis di tepi kiri, bukan untuk mengecat seluruh kartu.
 * Hanya kartu yang sedang dipakai sebagai filter yang ditonjolkan, supaya
 * deretannya punya hierarki dan angkanya mudah dibandingkan.
 */

import React from 'react';

/**
 * Campur warna dengan putih dan kembalikan warna SOLID. Latar kartu aktif
 * tidak boleh rgba semi-transparan: halaman modul memakai foto sebagai latar,
 * dan foto yang menembus kartu membuat angkanya sulit dibaca.
 */
function campurPutih(hex: string, kadar: number): string {
  const h = hex.replace('#', '');
  const utuh = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(utuh.slice(0, 2), 16);
  const g = parseInt(utuh.slice(2, 4), 16);
  const b = parseInt(utuh.slice(4, 6), 16);
  const c = (v: number) => Math.round(v * kadar + 255 * (1 - kadar));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

export interface StatCardItem {
  label: string;
  value: React.ReactNode;
  /** Baris keterangan kecil di bawah label. */
  sub?: string;
  /** Warna penanda kategori - dipakai untuk pita tepi & penonjolan saat aktif. */
  accent: string;
  /** Diisi bila kartu berfungsi sebagai tombol filter. */
  onClick?: () => void;
  /** Kartu ini sedang dipakai sebagai filter. */
  active?: boolean;
  /**
   * Kartu pertama/paling penting tampil gelap pekat (referensi: kartu "Total
   * Revenue" gelap di antara kartu putih lain) - penekanan visual, BUKAN
   * status/filter. Maksimal satu per StatCardGrid, biasanya kartu paling kiri.
   */
  hero?: boolean;
  /** Selisih vs periode sebelumnya, kalau ada - dirender pakai TrendBadge. */
  delta?: number;
  lowerIsBetter?: boolean;
}

export function StatCard({ label, value, sub, accent, onClick, active = false, hero = false, delta }: StatCardItem) {
  const bisaDiklik = typeof onClick === 'function';

  const isi = (
    <>
      {/* Pita aksen: penanda kategori yang tetap terbaca tanpa mendominasi kartu.
          Kartu hero sudah gelap pekat sendiri - pita jadi berlebihan di sana. */}
      {!hero && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent, opacity: active ? 1 : 0.55 }} />}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-black leading-none tabular-nums"
          style={{ color: hero ? '#ffffff' : active ? accent : '#0f172a' }}>
          {value}
        </span>
        {active && !hero && (
          <span className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: accent }}>
            Aktif
          </span>
        )}
        {typeof delta === 'number' && <TrendBadgeInline delta={delta} hero={hero} />}
      </div>
      <div>
        <p className="text-[13px] font-bold leading-tight" style={{ color: hero ? 'rgba(255,255,255,0.85)' : active ? accent : '#1e293b' }}>{label}</p>
        {sub && <p className="text-[10px] font-medium leading-tight" style={{ color: hero ? 'rgba(255,255,255,0.55)' : '#64748b' }}>{sub}</p>}
      </div>
    </>
  );

  const gaya: React.CSSProperties = hero
    ? { background: 'linear-gradient(135deg,#1e293b,#0f172a)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 24px rgba(15,23,42,0.25)' }
    : {
      // Selalu warna PEKAT - lihat catatan di campurPutih().
      background: active ? campurPutih(accent, 0.10) : '#ffffff',
      border: `1px solid ${active ? accent : 'rgba(15,23,42,0.08)'}`,
      boxShadow: active ? `0 0 0 1px ${accent}` : '0 2px 10px rgba(15,23,42,0.05)',
    };

  const kelasDasar = 'relative overflow-hidden rounded-2xl px-4 py-4 flex flex-col gap-1.5';

  // Kartu yang bisa diklik HARUS berupa <button>: ini kontrol filter, jadi wajib
  // bisa dicapai lewat keyboard dan punya cincin fokus. Kartu yang hanya
  // menampilkan angka tetap <div> supaya tidak masuk urutan Tab tanpa guna.
  if (!bisaDiklik) {
    return <div className={kelasDasar} style={gaya}>{isi}</div>;
  }

  return (
    <button type="button" onClick={onClick} aria-pressed={active} title={`Filter: ${label}`}
      className={`${kelasDasar} text-left cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2`}
      style={gaya}>
      {isi}
    </button>
  );
}

/** TrendBadge dari Charts.tsx dipakai warna merah/hijau tetap kontras di atas
 *  kartu gelap (hero) - versi biasa terlalu pudar di atas latar #0f172a. */
function TrendBadgeInline({ delta, lowerIsBetter = false, hero }: { delta: number; lowerIsBetter?: boolean; hero?: boolean }) {
  const abs = Math.abs(delta);
  const bagus = lowerIsBetter ? delta < 0 : delta > 0;
  const panah = delta > 0 ? '▲' : '▼';
  if (abs < 0.05) {
    return <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: hero ? 'rgba(255,255,255,0.45)' : '#94a3b8' }}>— 0%</span>;
  }
  return (
    <span className="text-[10px] font-bold whitespace-nowrap px-1.5 py-0.5 rounded-full"
      style={{
        color: bagus ? '#10b981' : '#ef4444',
        background: hero ? (bagus ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)') : (bagus ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'),
      }}
      title={`${bagus ? 'Membaik' : 'Memburuk'} ${abs.toFixed(1)}% dibanding periode sebelumnya`}>
      {panah} {abs.toFixed(1)}%
    </span>
  );
}

/** Pembungkus grid agar jarak & jumlah kolom seragam antar modul. */
export function StatCardGrid({ items, cols = 4, className = '' }: {
  items: StatCardItem[];
  /** Jumlah kolom di layar sedang ke atas. Di ponsel selalu 2 kolom. */
  cols?: 3 | 4 | 5 | 6;
  className?: string;
}) {
  const kolom = { 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6' }[cols];
  return (
    <div className={`grid grid-cols-2 ${kolom} gap-3 ${className}`}>
      {items.map((it, i) => <StatCard key={`${it.label}-${i}`} {...it} />)}
    </div>
  );
}
