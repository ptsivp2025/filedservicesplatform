'use client';

/**
 * RingkasanPanel.tsx - satu bentuk baku untuk SELURUH ringkasan di platform
 * ini, mengikuti pola yang sudah terbukti dipakai di Work Management
 * (Team Monitoring / Ticket / Reminder Schedule):
 *
 *     ┌ 📊 JUDUL PANEL                              aksi kanan ┐
 *     │ [chip] [chip] [chip] [chip]     ← angka utama, bertinta │
 *     │  ◕ donat   ● label ▇▇▇▇▁▁▁ 34   ← legenda + batang      │
 *     │            ● label ▇▇▁▁▁▁▁ 12      + angka pasti        │
 *     └──────────────────────────────────────────────────────────┘
 *
 * KENAPA DIBAKUKAN: sebelum ini tiap halaman menyusun ringkasannya sendiri -
 * ada yang cuma deretan angka polos, ada yang donat tanpa angka pasti, ada
 * yang tabel. Hasilnya tidak konsisten dan sebagian tidak terbaca: donat
 * menjawab "proporsinya berapa" tapi tidak "persisnya berapa", sedangkan
 * angka polos sebaliknya. Pola di atas memberi keduanya sekaligus dalam
 * ruang yang sama, dan itulah sebabnya ia dipakai ulang di sini alih-alih
 * membuat gaya baru untuk tiap layar.
 */

import React from 'react';
import { DonutChart } from './Charts';

export interface ItemLegenda {
  label: string;
  value: number;
  color: string;
  /** Diisi bila baris ini bisa diklik untuk menyaring daftar di bawahnya. */
  onClick?: () => void;
  /** Baris sedang dipakai sebagai filter. */
  aktif?: boolean;
}

/** Kerangka panel: kepala + isi. Dipakai bahkan oleh ringkasan yang tidak
 *  memakai donat, supaya tinggi & jarak antar panel tetap seragam. */
export function KartuRingkas({ judul, ikon, aksi, children, className = '' }: {
  judul: string; ikon?: string; aksi?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-3 flex flex-col ${className}`}
      style={{ boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 truncate">
          {ikon && <span className="mr-1" aria-hidden="true">{ikon}</span>}{judul}
        </span>
        {aksi}
      </div>
      {children}
    </div>
  );
}

/** Deretan angka utama bertinta. Maksimal 4-5 per baris - lebih dari itu
 *  angkanya mengecil sampai tidak terbaca sekilas, yang menghapus seluruh
 *  gunanya. */
export function ChipAngka({ items, kolom = 4 }: {
  items: { label: string; value: React.ReactNode; color: string }[];
  kolom?: 2 | 3 | 4 | 5;
}) {
  const kelas = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }[kolom];
  return (
    <div className={`grid ${kelas} gap-1.5 mb-2.5`}>
      {items.map(s => (
        <div key={s.label} className="flex flex-col items-center py-1.5 px-1 rounded-lg"
          style={{ background: `${s.color}10` }}>
          <span className="text-sm font-black leading-none tabular-nums" style={{ color: s.color }}>{s.value}</span>
          <span className="text-[10px] text-slate-500 mt-1 text-center leading-tight font-semibold">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Donat + legenda berbatang. Tiap baris menjawab tiga hal sekaligus:
 * warnanya apa (titik), seberapa besar porsinya (batang), dan berapa
 * persisnya (angka di kanan).
 */
export function DonutLegenda({ data, pusat, labelPusat, ukuran = 84, maksBaris = 6 }: {
  data: ItemLegenda[];
  /** Angka di tengah donat. Default: jumlah seluruh nilai. */
  pusat?: string | number;
  labelPusat?: string;
  ukuran?: number;
  maksBaris?: number;
}) {
  const bersih = data.filter(d => d.value > 0);
  const total = bersih.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return <p className="text-xs text-slate-400 text-center py-6">Belum ada data</p>;
  }

  // Sisanya digabung jadi "Lainnya" - legenda 20 baris bukan ringkasan lagi,
  // dan barisnya jadi terlalu tipis untuk dibaca.
  const urut = [...bersih].sort((a, b) => b.value - a.value);
  const tampil = urut.length > maksBaris
    ? [...urut.slice(0, maksBaris - 1), {
        label: 'Lainnya', color: '#94a3b8',
        value: urut.slice(maksBaris - 1).reduce((s, d) => s + d.value, 0),
      } as ItemLegenda]
    : urut;

  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 flex flex-col items-center">
        <DonutChart segments={tampil.map(d => ({ value: d.value, color: d.color }))}
          size={ukuran} strokeWidth={Math.round(ukuran / 8)}
          label={String(pusat ?? total)} />
        {labelPusat && (
          // text-slate-400 di atas putih pada 9px gagal kontras (dilaporkan
          // user via screenshot) - slate-500 masih terasa sekunder tapi lolos
          // AA untuk teks sekecil ini.
          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-1">{labelPusat}</span>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        {tampil.map(d => {
          const baris = (
            <>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
              <span className="text-[10px] text-slate-600 flex-shrink-0 truncate" style={{ width: '6.5rem' }}>{d.label}</span>
              <span className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#f1f5f9', minWidth: 16 }}>
                <span className="block h-full rounded-full"
                  style={{ width: `${total > 0 ? (d.value / total) * 100 : 0}%`, background: d.color }} />
              </span>
              <span className="text-[10px] font-bold text-slate-700 flex-shrink-0 w-7 text-right tabular-nums">{d.value}</span>
            </>
          );
          return d.onClick ? (
            <button key={d.label} type="button" onClick={d.onClick}
              className="w-full flex items-center gap-1.5 rounded px-0.5 hover:bg-slate-50 transition-colors"
              style={d.aktif ? { background: `${d.color}14`, outline: `1px solid ${d.color}` } : undefined}>
              {baris}
            </button>
          ) : (
            <div key={d.label} className="flex items-center gap-1.5 px-0.5">{baris}</div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tabel ringkas di dalam panel - untuk rincian yang butuh lebih dari satu
 * angka per baris (mis. per wilayah: gedung / TV / perlu PIC), yang tidak
 * bisa diwakili satu batang.
 */
export function TabelRingkas<T>({ kolom, baris, kunci, onKlikBaris, tinggiMaks = 148 }: {
  kolom: { judul: string; kanan?: boolean; lebar?: string }[];
  baris: T[];
  /** Mengubah satu data jadi deretan sel. Panjangnya harus sama dengan `kolom`. */
  kunci: (item: T) => { id: string; sel: React.ReactNode[] };
  onKlikBaris?: (item: T) => void;
  tinggiMaks?: number;
}) {
  if (baris.length === 0) {
    return <p className="text-xs text-slate-400 text-center py-6">Belum ada data</p>;
  }
  return (
    // overflow-x-auto EKSPLISIT (bukan mengandalkan efek samping overflow-y:
    // auto) - saat panel ini dijepit sempit (zoom browser >100%, laptop
    // kecil), tabelnya harus scroll SENDIRI di dalam kartunya, bukan
    // memaksa seluruh halaman melebar/muncul scrollbar horizontal aneh di
    // level halaman (keluhan user via screenshot).
    <div className="overflow-auto -mx-1" style={{ maxHeight: tinggiMaks }}>
      <table className="w-full text-[11px]">
        <thead className="text-slate-400 font-bold uppercase sticky top-0 bg-white">
          <tr>
            {kolom.map(k => (
              <th key={k.judul} className={`${k.kanan ? 'text-right' : 'text-left'} px-1 pb-1.5`}
                style={k.lebar ? { width: k.lebar } : undefined}>{k.judul}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {baris.map(item => {
            const { id, sel } = kunci(item);
            return (
              <tr key={id}
                className={onKlikBaris ? 'hover:bg-slate-50 cursor-pointer' : undefined}
                onClick={onKlikBaris ? () => onKlikBaris(item) : undefined}>
                {sel.map((isi, i) => (
                  <td key={i} className={`${kolom[i]?.kanan ? 'text-right' : 'text-left'} px-1 py-1`}>{isi}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
