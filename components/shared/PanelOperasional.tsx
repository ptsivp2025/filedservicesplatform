'use client';

/**
 * PanelOperasional.tsx - kit visual satu-satunya untuk SELURUH layar
 * operasional (Dashboard, Review Client, Locations, Siklus & Riwayat).
 *
 * KENAPA INI ADA: Dashboard (ControlRoomWidget) dirapikan lebih dulu dan
 * disukai user - tapi gayanya (kepala panel berikon, ubin KPI, drill-down
 * dengan tombol kembali yang jelas) awalnya ditulis LOKAL di dalam file itu.
 * Halaman lain (Review Client, Locations, Siklus & Riwayat) masing-masing
 * menyusun tampilannya sendiri, dan hasilnya persis keluhan user: tidak
 * konsisten, ruang kosong ganjil, kartu KPI gelap ala StatCardGrid lama
 * berdampingan dengan kartu putih ala dashboard baru.
 *
 * Dipindah ke sini supaya SEMUA layar memakai kosakata visual yang sama.
 */

import React from 'react';
import { ArrowLeft, type LucideProps } from 'lucide-react';

export const WARNA = {
  primer: '#1E40AF',
  sekunder: '#3B82F6',
  selesai: '#059669',
  belum: '#94A3B8',
  gagal: '#DC2626',
  revisi: '#EA580C',
  verified: '#0D9488',
  garis: '#E2E8F0',
  redup: '#64748B',
};

/** Bentuk ikon lucide - diturunkan dari LucideProps aslinya. Menuliskan
 *  ulang propsnya secara manual (size/className/strokeWidth) membuat
 *  TypeScript menolak setiap ikon lucide sungguhan karena selisih kecil pada
 *  propTypes yang dihasilkan forwardRef. */
export type IkonOperasional = React.ComponentType<LucideProps>;

export function Kartu({ children, className = '', padat }: {
  children: React.ReactNode; className?: string; padat?: boolean;
}) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200 ${padat ? '' : 'p-3.5'} ${className}`}
      style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
      {children}
    </section>
  );
}

export function JudulPanel({ ikon: Ikon, judul, ket, aksi }: {
  ikon: IkonOperasional; judul: string; ket?: string; aksi?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-2 mb-3">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 flex-shrink-0 text-slate-400" aria-hidden="true"><Ikon size={15} /></span>
        <div className="min-w-0">
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-600 leading-none">{judul}</h3>
          {ket && <p className="text-[11px] text-slate-400 mt-1 leading-snug">{ket}</p>}
        </div>
      </div>
      {aksi}
    </header>
  );
}

/** Ubin KPI - angka besar + ikon bertinta, bisa diklik untuk menyaring. */
export function UbinKpi({ ikon: Ikon, label, nilai, sub, warna, onClick, aktif }: {
  ikon: IkonOperasional; label: string; nilai: number | string; sub?: string; warna: string;
  onClick?: () => void; aktif?: boolean;
}) {
  const isi = (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="w-7 h-7 rounded-lg grid place-items-center flex-shrink-0"
          style={{ background: `${warna}14`, color: warna }} aria-hidden="true">
          <Ikon size={15} />
        </span>
        {aktif && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ color: warna, background: `${warna}14` }}>disaring</span>
        )}
      </div>
      <p className="text-[21px] font-bold tabular-nums leading-none text-slate-900">
        {typeof nilai === 'number' ? nilai.toLocaleString('id-ID') : nilai}
      </p>
      <p className="text-[11px] font-semibold text-slate-500 mt-1.5 leading-tight">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5 leading-tight truncate">{sub}</p>}
    </>
  );
  const dasar = 'bg-white rounded-xl border p-3 text-left transition-colors duration-200 w-full';
  if (!onClick) {
    return <div className={`${dasar} border-slate-200`} style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>{isi}</div>;
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={aktif}
      className={`${dasar} cursor-pointer hover:border-slate-300 hover:bg-slate-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1`}
      style={{
        borderColor: aktif ? warna : WARNA.garis,
        boxShadow: aktif ? `0 0 0 1px ${warna}` : '0 1px 2px rgba(15,23,42,0.04)',
      }}>
      {isi}
    </button>
  );
}

export function Bar2({ pct, warna, tinggi = 6 }: { pct: number; warna?: string; tinggi?: number }) {
  return (
    <div className="rounded-full bg-slate-100 overflow-hidden w-full" style={{ height: tinggi }}>
      <div className="h-full rounded-full transition-all duration-300 motion-reduce:transition-none"
        style={{ width: `${Math.min(100, Math.max(pct, pct > 0 ? 2 : 0))}%`, background: warna ?? warnaProgres(pct) }} />
    </div>
  );
}

export function warnaProgres(pct: number): string {
  if (pct >= 100) return WARNA.selesai;
  if (pct >= 90) return WARNA.verified;
  if (pct >= 70) return '#D97706';
  return WARNA.gagal;
}

export function BarisDrill({ judul, sub, kanan, pct, onClick }: {
  judul: string; sub?: string; kanan?: React.ReactNode; pct?: number; onClick?: () => void;
}) {
  // Bukan <button> - `kanan` kadang berisi tombol aksi sungguhan (mis. "Setujui
  // N" di ReviewSiklus), dan <button> di dalam <button> adalah HTML tidak
  // valid: React membatalkan hydration lalu me-render ulang seluruh baris
  // dari nol di client, yang terlihat sebagai kedipan/tata-letak kacau
  // sesaat sebelum baris ini stabil kembali.
  return (
    <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }) : undefined}
      className={`w-full text-left px-3.5 py-2.5 transition-colors duration-200 flex items-center gap-3 focus:outline-none focus-visible:bg-slate-50 ${onClick ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'}`}>
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-slate-800 text-[13px] truncate block">{judul}</span>
        {sub && <span className="text-[11px] text-slate-500 mt-0.5 truncate block">{sub}</span>}
        {typeof pct === 'number' && <div className="mt-1.5 max-w-xs"><Bar2 pct={pct} /></div>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {kanan}
        {onClick && <span className="text-slate-300" aria-hidden="true">›</span>}
      </div>
    </div>
  );
}

export function LencanaMasalah({ gagal, revisi, belum }: { gagal: number; revisi: number; belum: number }) {
  const item = [
    gagal > 0 ? { n: gagal, t: 'gagal', c: '#B91C1C', bg: '#FEE2E2' } : null,
    revisi > 0 ? { n: revisi, t: 'ulang', c: '#C2410C', bg: '#FFEDD5' } : null,
    belum > 0 ? { n: belum, t: 'belum', c: '#475569', bg: '#F1F5F9' } : null,
  ].filter(Boolean) as { n: number; t: string; c: string; bg: string }[];
  if (item.length === 0) {
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: '#047857', background: '#D1FAE5' }}>Tuntas</span>;
  }
  return (
    <span className="flex items-center gap-1 flex-wrap justify-end">
      {item.map(i => (
        <span key={i.t} className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap tabular-nums"
          style={{ color: i.c, background: i.bg }}>{i.n} {i.t}</span>
      ))}
    </span>
  );
}

export function Kosong({ judul, teks }: { judul: string; teks: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-[13px] font-bold text-slate-700">{judul}</p>
      <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">{teks}</p>
    </div>
  );
}

/**
 * Kepala navigasi drill-down - BESAR DAN JELAS, bukan breadcrumb kecil di
 * tengah. Keluhan user persis ini: "kenapa setiap klik filter langsung
 * membuka filter nya tetapi tanpa ada tombol back yang jelas, malah kecil
 * dan di tengah-tengah". Sekarang satu baris penuh, tombol kembali besar di
 * kiri dengan ikon panah, jejak lokasi (breadcrumb) di sampingnya sebagai
 * info sekunder - bukan satu-satunya cara untuk kembali.
 */
export function HeaderDrill({ jejak, aksi }: {
  /** Rantai lokasi saat ini, dari akar ke posisi sekarang. Item terakhir
   *  adalah posisi aktif (tidak bisa diklik). */
  jejak: { label: string; onClick?: () => void }[];
  /** Kontrol tambahan di kanan (pencarian, dsb). */
  aksi?: React.ReactNode;
}) {
  const akar = jejak[0];
  const sisanya = jejak.slice(1);
  return (
    <div className="border-b border-slate-100 bg-slate-50/60">
      <div className="px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <button type="button" onClick={akar?.onClick}
          className="flex items-center gap-2 pl-2 pr-3.5 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors duration-150 cursor-pointer flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
          <ArrowLeft size={16} className="text-slate-500" aria-hidden="true" />
          <span className="text-[13px] font-bold text-slate-700">{akar?.label ?? 'Kembali'}</span>
        </button>
        {aksi}
      </div>
      {sisanya.length > 0 && (
        <div className="px-3.5 pb-2 flex items-center gap-1.5 flex-wrap text-[11px]">
          {sisanya.map((s, i) => (
            <React.Fragment key={i}>
              <span className="text-slate-300">/</span>
              {s.onClick ? (
                <button type="button" onClick={s.onClick} className="font-bold text-blue-700 hover:underline cursor-pointer">
                  {s.label}
                </button>
              ) : (
                <span className="font-bold text-slate-700">{s.label}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** Kotak keterangan grafik (recharts Tooltip content) - satu gaya untuk
 *  semua chart di seluruh platform. */
export function TipGrafik({ active, payload, label, satuan = '' }: {
  active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string | number; satuan?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-lg">
      {label !== undefined && <p className="text-[11px] font-bold text-slate-700 mb-0.5">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-[11px] text-slate-600 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} aria-hidden="true" />
          {p.name}: <span className="font-bold tabular-nums text-slate-800">{p.value}{satuan}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Dialog penuh untuk konten yang butuh ruang jauh lebih besar daripada
 * beberapa baris ringkasan (peta, tabel besar). DIPAKAI supaya peta operasi
 * tidak lagi memaksa halaman digulir jauh ke bawah untuk sekadar melihatnya
 * - satu tombol, peta muncul di atas semuanya, tutup untuk kembali.
 */
export function DialogBesar({ buka, onTutup, judul, ikon: Ikon, ket, children, penuh = false }: {
  buka: boolean; onTutup: () => void; judul: string; ikon: IkonOperasional; ket?: string;
  children: React.ReactNode;
  /** True untuk konten yang harus mengisi persis area yang tersedia (mis.
   *  peta) - tanpa ini area di bawah konten pendek akan tersisa kosong
   *  karena body dialog defaultnya scrollable dengan padding tetap. */
  penuh?: boolean;
}) {
  if (!buka) return null;
  return (
    <div role="dialog" aria-modal="true"
      className="fixed inset-0 z-[1000] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4"
      onClick={onTutup}>
      <div className="bg-white w-full sm:max-w-5xl sm:rounded-2xl shadow-2xl h-full sm:h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg grid place-items-center flex-shrink-0" style={{ background: '#EFF6FF', color: '#1E40AF' }}>
              <Ikon size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-bold text-slate-800 truncate">{judul}</h2>
              {ket && <p className="text-[11px] text-slate-500 truncate">{ket}</p>}
            </div>
          </div>
          <button type="button" onClick={onTutup} aria-label="Tutup"
            className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors duration-150 cursor-pointer flex-shrink-0">
            ✕
          </button>
        </div>
        <div className={penuh ? 'flex-1 min-h-0 flex flex-col p-4' : 'flex-1 overflow-y-auto p-4'}>{children}</div>
      </div>
    </div>
  );
}
