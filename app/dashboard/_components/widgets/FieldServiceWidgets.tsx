'use client';

/**
 * FieldServiceWidgets.tsx - layar pertama untuk PIC dan Client.
 *
 * Keduanya memakai RPC agregasi yang SAMA dengan Control Room admin
 * (lib/fs-cycle.ts), bukan hitungan sendiri-sendiri. Yang membedakan bukan
 * rumusnya, melainkan APA YANG BOLEH DILIHAT: RLS (migrasi 006/015) sudah
 * membatasi PIC hanya pada gedung yang ditugaskan padanya, sehingga fungsi
 * yang sama otomatis menjawab "127 TV milik saya" untuk PIC dan "456 TV
 * seluruh proyek" untuk admin. Satu definisi "selesai", satu sumber angka.
 *
 * Widget "Requires Attention" yang lama DIHAPUS - isinya sudah menjadi
 * bagian "Perlu Perhatian" di dalam Control Room, dan menampilkannya dua
 * kali di satu layar hanya menambah keramaian tanpa menambah informasi.
 */

import { useEffect, useState } from 'react';
import {
  ambilCycles, cycleBerjalan, ambilOverview, ambilBuildingProgress, projectAktif,
  CYCLE_STATUS_LABEL, persen, warnaProgress, rentangTanggal,
  type Cycle, type CycleOverview, type BuildingProgress,
} from '@/lib/fs-cycle';
import { Loading, type WidgetProps } from './primitives';

function useSiklusBerjalan() {
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [overview, setOverview] = useState<CycleOverview | null>(null);
  const [buildings, setBuildings] = useState<BuildingProgress[]>([]);
  const [siap, setSiap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        // PIC & Client tidak punya selector project di sidebar - projectAktif()
        // yang menurunkannya dari data yang boleh mereka baca.
        const projectId = await projectAktif();
        if (batal || !projectId) return;
        const cycles = await ambilCycles(projectId);
        const c = cycleBerjalan(cycles);
        if (batal || !c) return;
        setCycle(c);
        const [ov, bg] = await Promise.all([ambilOverview(c.id), ambilBuildingProgress(c.id)]);
        if (batal) return;
        setOverview(ov);
        setBuildings(bg);
      } catch (e) {
        // Sebelumnya kesalahan di sini didiamkan total, sehingga error RPC/RLS
        // apa pun terlihat sama seperti "memang tidak ada tugas" - PIC dan
        // developer sama-sama tidak tahu ada yang gagal. Sekarang errornya
        // dicatat supaya bisa dibedakan dari keadaan kosong yang genuine
        // (lihat console browser), dan widget tetap tidak melempar ke boundary
        // React - halaman tujuannya (/teknisi) tetap bisa dibuka manual.
        if (!batal) {
          const pesan = e instanceof Error ? e.message : String(e);
          console.error('[TugasWeekendSaya] gagal memuat siklus berjalan:', pesan);
          setError(pesan);
        }
      } finally {
        if (!batal) setSiap(true);
      }
    })();
    return () => { batal = true; };
  }, []);

  return { cycle, overview, buildings, siap, error };
}

function Bingkai({ judul, anak }: { judul: string; anak: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 md:p-5"
      style={{ boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">{judul}</p>
      {anak}
    </div>
  );
}

function BarProgress({ pct }: { pct: number }) {
  return (
    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(pct, pct > 0 ? 2 : 0))}%`, background: warnaProgress(pct) }} />
    </div>
  );
}

// ── PIC: "Tugas Weekend Saya" ──────────────────────────────────────────
// PIC tidak butuh statistik global. Yang dibutuhkan: siklus apa, gedung
// saya mana saja, berapa TV, mana yang belum, lalu satu tombol untuk mulai.

export function TugasWeekendSaya({ openUrl }: WidgetProps) {
  const { cycle, overview, buildings, siap, error } = useSiklusBerjalan();

  if (!siap) return <Bingkai judul="Tugas Weekend Saya" anak={<Loading />} />;

  // Dibedakan dari "memang tidak ada tugas" (di bawah) - kalau ini gagal
  // memuat (RLS/RPC/jaringan), PIC tidak boleh diberi tahu "belum ada tugas"
  // padahal sebenarnya datanya gagal diambil. Buka /teknisi tetap jadi jalan
  // keluar karena halaman itu punya query sendiri, independen dari widget ini.
  if (error) {
    return (
      <Bingkai judul="Tugas Weekend Saya" anak={
        <div className="py-4">
          <p className="text-sm font-bold text-red-700">Gagal memuat tugas Anda</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{error}</p>
          <button type="button" onClick={() => openUrl('/teknisi', 'Tugas Weekend Saya')}
            className="mt-3 text-xs font-bold text-blue-700 underline">
            Buka Tugas Hari Ini langsung
          </button>
        </div>
      } />
    );
  }

  if (!cycle || !overview || overview.total_tv === 0) {
    return (
      <Bingkai judul="Tugas Weekend Saya" anak={
        <div className="py-4">
          <p className="text-sm font-bold text-slate-700">Belum ada tugas untuk Anda</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Anda belum punya gedung yang ditugaskan pada siklus weekend ini. Hubungi admin bila
            menurut Anda seharusnya ada.
          </p>
        </div>
      } />
    );
  }

  const pct = persen(overview.completed_tv, overview.total_tv);
  const belum = overview.pending_tv + overview.failed_tv + overview.revision_tv;

  return (
    <Bingkai judul="Tugas Weekend Saya" anak={
      <>
        <p className="text-sm font-black text-slate-900">{cycle.name}</p>
        <p className="text-[11px] text-slate-500 mt-0.5 mb-4">
          {rentangTanggal(cycle.execution_start, cycle.execution_end)} · {overview.building_total} gedung
        </p>

        <p className="text-3xl font-black text-slate-900 tabular-nums leading-none">
          {overview.completed_tv}
          <span className="text-lg text-slate-400 font-bold"> / {overview.total_tv} TV</span>
        </p>
        <p className="text-xs font-bold mt-1.5 mb-2.5" style={{ color: warnaProgress(pct) }}>{pct}% selesai</p>
        <BarProgress pct={pct} />

        <div className="grid grid-cols-3 gap-2 mt-4 mb-4 text-center">
          <div className="rounded-lg bg-slate-50 py-2">
            <p className="text-lg font-black text-slate-700 tabular-nums">{overview.pending_tv}</p>
            <p className="text-[10px] font-semibold text-slate-500">Belum</p>
          </div>
          <div className="rounded-lg bg-red-50 py-2">
            <p className="text-lg font-black text-red-700 tabular-nums">{overview.failed_tv}</p>
            <p className="text-[10px] font-semibold text-red-600">Gagal</p>
          </div>
          <div className="rounded-lg bg-orange-50 py-2">
            <p className="text-lg font-black text-orange-700 tabular-nums">{overview.revision_tv}</p>
            <p className="text-[10px] font-semibold text-orange-600">Diulang</p>
          </div>
        </div>

        {buildings.length > 0 && (
          <div className="space-y-2 mb-4">
            {buildings.slice(0, 4).map(b => (
              <div key={b.location_id}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-slate-700 truncate">{b.location_name}</span>
                  <span className="text-[11px] font-bold tabular-nums whitespace-nowrap"
                    style={{ color: warnaProgress(b.pct ?? 0) }}>{b.completed_tv}/{b.total_tv}</span>
                </div>
                <BarProgress pct={b.pct ?? 0} />
              </div>
            ))}
            {buildings.length > 4 && (
              <p className="text-[11px] text-slate-400 pt-1">+{buildings.length - 4} gedung lainnya</p>
            )}
          </div>
        )}

        <button type="button" onClick={() => openUrl('/teknisi', 'Tugas Weekend Saya')}
          className="w-full text-sm font-bold px-4 py-2.5 rounded-xl text-white"
          style={{ background: '#1d4ed8' }}>
          {belum > 0 ? `Lanjutkan Pekerjaan (${belum} TV)` : 'Buka Daftar Tugas'}
        </button>
      </>
    } />
  );
}

// ── Client: apa yang menunggu keputusan mereka ─────────────────────────
// Client tidak diberi seluruh UI administrasi (§4 master prompt): cukup
// siklus apa yang direview, berapa totalnya, berapa yang sudah diverifikasi,
// dan mana yang perlu dilihat.

export function RingkasanReviewClient({ openUrl }: WidgetProps) {
  const { cycle, overview, buildings, siap, error } = useSiklusBerjalan();

  if (!siap) return <Bingkai judul="Review Deployment" anak={<Loading />} />;

  if (error) {
    return (
      <Bingkai judul="Review Deployment" anak={
        <div className="py-4">
          <p className="text-sm font-bold text-red-700">Gagal memuat ringkasan review</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{error}</p>
        </div>
      } />
    );
  }

  if (!cycle || !overview || overview.total_tv === 0) {
    return (
      <Bingkai judul="Review Deployment" anak={
        <div className="py-4">
          <p className="text-sm font-bold text-slate-700">Belum ada yang perlu direview</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Belum ada pekerjaan deployment yang dikirim untuk periode ini.
          </p>
        </div>
      } />
    );
  }

  const st = CYCLE_STATUS_LABEL[cycle.status];
  const pct = persen(overview.completed_tv, overview.total_tv);
  const bermasalah = buildings.filter(b => b.failed_tv + b.revision_tv + b.pending_tv > 0);

  return (
    <Bingkai judul="Review Deployment" anak={
      <>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className="text-sm font-black text-slate-900">{cycle.name}</p>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ color: st.color, background: st.bg }}>{st.label}</span>
        </div>
        <p className="text-[11px] text-slate-500 mb-4">
          Dikerjakan {rentangTanggal(cycle.execution_start, cycle.execution_end)}
        </p>

        <p className="text-3xl font-black text-slate-900 tabular-nums leading-none">
          {overview.completed_tv}
          <span className="text-lg text-slate-400 font-bold"> / {overview.total_tv} TV</span>
        </p>
        <p className="text-xs font-bold mt-1.5 mb-2.5" style={{ color: warnaProgress(pct) }}>{pct}% terpasang</p>
        <BarProgress pct={pct} />

        <div className="grid grid-cols-2 gap-2 mt-4 mb-4">
          <div className="rounded-lg bg-emerald-50 py-2.5 px-3">
            <p className="text-xl font-black text-emerald-700 tabular-nums">{overview.verified_tv}</p>
            <p className="text-[10px] font-semibold text-emerald-600">Sudah Anda setujui</p>
          </div>
          <div className="rounded-lg bg-amber-50 py-2.5 px-3">
            <p className="text-xl font-black text-amber-700 tabular-nums">
              {Math.max(0, overview.completed_tv - overview.verified_tv)}
            </p>
            <p className="text-[10px] font-semibold text-amber-700">Menunggu persetujuan</p>
          </div>
        </div>

        {bermasalah.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-bold text-slate-600 mb-2">Gedung yang perlu dilihat</p>
            <div className="space-y-1.5">
              {bermasalah.slice(0, 3).map(b => (
                <div key={b.location_id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-700 truncate">{b.location_name}</span>
                  <span className="text-slate-500 whitespace-nowrap">
                    {b.failed_tv > 0 && <span className="text-red-600 font-bold">{b.failed_tv} gagal </span>}
                    {b.pending_tv > 0 && <span>{b.pending_tv} belum</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button type="button" onClick={() => openUrl('/field-service?tab=review', 'Review Deployment')}
          className="w-full text-sm font-bold px-4 py-2.5 rounded-xl text-white"
          style={{ background: '#1d4ed8' }}>
          Buka Halaman Review
        </button>
      </>
    } />
  );
}
