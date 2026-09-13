'use client';

/**
 * ControlRoomWidget.tsx - ruang kendali operasional Admin/Supervisor.
 *
 * Menjawab, berurutan dari atas ke bawah:
 *   siklus apa yang berjalan -> berapa TV selesai -> membaik atau memburuk ->
 *   wilayah/PIC mana yang tertinggal -> apa penyebab kegagalannya ->
 *   di sebelah mana gedungnya -> apa tindakan berikutnya.
 *
 * SISTEM DESAIN: "Data-Dense Dashboard" (padding rapat, grid, banyak panel
 * kecil, angka tabular) - hasil kueri skill ui-ux-pro-max untuk product type
 * dashboard operasional, bukan gaya karangan sendiri. Palet, tipografi
 * angka, dan daftar periksa pra-rilisnya ikut dari sana:
 *   - ikon SVG (lucide), BUKAN emoji;
 *   - kontras teks >= 4.5:1, cincin fokus tetap ada;
 *   - transisi 150-300ms, dan dimatikan bila pengguna meminta reduced-motion;
 *   - tabular-nums untuk SEMUA angka supaya kolom angka tidak goyang.
 *
 * Aturan yang tetap dipegang dari sebelumnya:
 *  1. Grafik hanya bila ia menjawab pertanyaan yang tidak terjawab angka.
 *     Enam grafik di sini masing-masing menjawab pertanyaan BERBEDA; tidak
 *     ada yang menggambar ulang angka yang sudah ada di atasnya.
 *  2. Tabel bukan dashboard - daftar TV hanya muncul di ujung drill-down.
 *  3. Exception-first: yang bermasalah selalu di atas yang baik-baik saja.
 *
 * Seluruh angka DAN seluruh grafik datang dari RPC agregasi database yang
 * sama (lib/fs-cycle.ts). Grafik tidak boleh bercerita berbeda dari kartu di
 * atasnya, dan itu hanya dijamin kalau sumbernya memang satu.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import {
  Activity, AlertTriangle, Building2, CalendarDays, CheckCircle2,
  Clock, Map as MapIcon, MapPin, RotateCcw, Search,
  ShieldCheck, TrendingUp, Tv, Users, XCircle,
} from 'lucide-react';
import {
  ConfirmDialog, DonutLegenda, SearchableSelect, type ConfirmState,
  KartuOperasional as Kartu, JudulPanel, UbinKpi, Bar2, BarisDrill, LencanaMasalah,
  KosongOperasional as Kosong, HeaderDrill, TipGrafik, DialogBesar, Masonry,
} from '@/components/shared';
import {
  ambilCycles, cycleBerjalan, ambilOverview, ambilRegionProgress, ambilAttention,
  ambilBuildingProgress, ambilTvList, ambilPicProgress, projectAktif,
  ambilPendingCheckouts, putuskanCheckout,
  ambilPenyebabGagal, ambilProgresHarian, ambilSebaranGedung, ambilTren,
  pindahStatusCycle, buatScopePekerjaan, mintaPembersihan, setujuiPembersihan, hitungEvidence,
  CYCLE_STATUS_LABEL, TV_STATUS_LABEL, FAILURE_REASON_LABEL,
  persen, warnaProgress, rentangTanggal,
  type Cycle, type CycleOverview, type RegionProgress, type AttentionItem,
  type BuildingProgress, type TvTask, type PicProgress, type PendingCheckout,
  type PenyebabGagal, type ProgresHarian, type SebaranGedung, type TitikTren,
} from '@/lib/fs-cycle';
import { hasFullAccess } from '@/lib/constants';
import { PetaOperasional } from './PetaOperasional';
import type { WidgetProps } from './primitives';

// ── Token desain ────────────────────────────────────────────────────────
// Warna MAKNA (selesai/gagal/revisi) sengaja tidak ikut warna merek: hijau
// harus tetap berarti berhasil dan merah tetap berarti bahaya di instalasi
// mana pun platform ini dipasang.
const C = {
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

type Level =
  | { level: 'root' }
  | { level: 'region'; areaId: string; areaName: string }
  | { level: 'building'; areaId: string | null; areaName: string | null; locationId: string; locationName: string }
  | { level: 'filter'; status: string; judul: string };

/** Hormati prefers-reduced-motion: animasi grafik dimatikan, bukan
 *  diperlambat - bagi yang memintanya, gerakan itu sendiri masalahnya. */
function usePakaiAnimasi(): boolean {
  const [pakai, setPakai] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const terapkan = () => setPakai(!mq.matches);
    terapkan();
    mq.addEventListener?.('change', terapkan);
    return () => mq.removeEventListener?.('change', terapkan);
  }, []);
  return pakai;
}

// ── Widget utama ────────────────────────────────────────────────────────

export function ControlRoomWidget({ user }: WidgetProps) {
  const bolehKelola = hasFullAccess(user) || user.fs_role === 'PROVIDER_ADMIN' || user.fs_role === 'PROVIDER_SUPERVISOR';
  const adminPenuh = hasFullAccess(user) || user.fs_role === 'PROVIDER_ADMIN';
  const animasi = usePakaiAnimasi();

  const [projectId, setProjectId] = useState<string>(() =>
    typeof window === 'undefined' ? '' : sessionStorage.getItem('fs_selected_project_id') ?? '');
  const [projectSiap, setProjectSiap] = useState(false);

  useEffect(() => {
    let batal = false;
    (async () => {
      const id = projectId || await projectAktif();
      if (batal) return;
      setProjectId(id);
      setProjectSiap(true);
    })();
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState<string>('');
  const [overview, setOverview] = useState<CycleOverview | null>(null);
  const [regions, setRegions] = useState<RegionProgress[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [pics, setPics] = useState<PicProgress[]>([]);
  const [semuaPic, setSemuaPic] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout[]>([]);
  const [tolakCheckout, setTolakCheckout] = useState<{ id: string; nama: string } | null>(null);
  const [alasanTolak, setAlasanTolak] = useState('');

  // Data grafik - dimuat bersama ringkasan, dari RPC yang sama.
  const [penyebab, setPenyebab] = useState<PenyebabGagal[]>([]);
  const [harian, setHarian] = useState<ProgresHarian[]>([]);
  const [sebaran, setSebaran] = useState<SebaranGedung[]>([]);
  const [tren, setTren] = useState<TitikTren[]>([]);

  const [drill, setDrill] = useState<Level>({ level: 'root' });
  const [buildings, setBuildings] = useState<BuildingProgress[]>([]);
  const [semuaGedung, setSemuaGedung] = useState<BuildingProgress[] | null>(null);
  /** Peta sebagai dialog, bukan panel yang harus digulir - lihat catatan di
   *  DialogBesar pada JSX di bawah. */
  const [petaTerbuka, setPetaTerbuka] = useState(false);
  const [cariGedung, setCariGedung] = useState('');
  const [cariDrill, setCariDrill] = useState('');
  const [tvs, setTvs] = useState<TvTask[]>([]);
  const [memuatDrill, setMemuatDrill] = useState(false);

  const [memuat, setMemuat] = useState(true);
  const [pesan, setPesan] = useState<{ tipe: 'ok' | 'gagal'; teks: string } | null>(null);
  const [aksiJalan, setAksiJalan] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState<ConfirmState | null>(null);

  const beritahu = (tipe: 'ok' | 'gagal', teks: string) => {
    setPesan({ tipe, teks });
    window.setTimeout(() => setPesan(null), 6000);
  };

  const cycle = cycles.find(c => c.id === cycleId) ?? null;

  useEffect(() => {
    if (!projectId) { setMemuat(false); return; }
    let batal = false;
    (async () => {
      try {
        const data = await ambilCycles(projectId);
        if (batal) return;
        setCycles(data);
        setCycleId(prev => prev || cycleBerjalan(data)?.id || '');
        try {
          const t = await ambilTren(projectId, 8);
          if (!batal) setTren(t);
        } catch { /* diam - tren hilang tidak boleh menggagalkan dashboard */ }
      } catch (e) {
        if (!batal) beritahu('gagal', e instanceof Error ? e.message : 'Gagal memuat daftar siklus.');
      } finally {
        if (!batal) setMemuat(false);
      }
    })();
    return () => { batal = true; };
  }, [projectId]);

  const muatRingkasan = useCallback(async () => {
    if (!cycleId) return;
    setMemuat(true);
    try {
      const [ov, rg, at, pc, pk, pg, ph, sg] = await Promise.all([
        ambilOverview(cycleId), ambilRegionProgress(cycleId),
        ambilAttention(cycleId), ambilPicProgress(cycleId),
        ambilPendingCheckouts(cycleId).catch(() => [] as PendingCheckout[]),
        ambilPenyebabGagal(cycleId).catch(() => [] as PenyebabGagal[]),
        ambilProgresHarian(cycleId).catch(() => [] as ProgresHarian[]),
        ambilSebaranGedung(cycleId).catch(() => [] as SebaranGedung[]),
      ]);
      setOverview(ov); setRegions(rg); setAttention(at); setPics(pc); setPendingCheckout(pk);
      setPenyebab(pg); setHarian(ph); setSebaran(sg);
    } catch (e) {
      beritahu('gagal', e instanceof Error ? e.message : 'Gagal memuat ringkasan siklus.');
    } finally {
      setMemuat(false);
    }
  }, [cycleId]);

  useEffect(() => { void muatRingkasan(); }, [muatRingkasan]);
  useEffect(() => { setDrill({ level: 'root' }); setSemuaGedung(null); }, [cycleId]);
  useEffect(() => { setCariDrill(''); }, [drill]);

  // Daftar seluruh gedung dipakai bersama peta DAN pencarian lintas wilayah.
  useEffect(() => {
    if (!cycleId || semuaGedung) return;
    let batal = false;
    (async () => {
      try {
        const data = await ambilBuildingProgress(cycleId, null);
        if (!batal) setSemuaGedung(data);
      } catch { /* diam - peta & pencarian punya keadaan kosongnya sendiri */ }
    })();
    return () => { batal = true; };
  }, [cycleId, semuaGedung]);

  useEffect(() => {
    if (!cycleId || drill.level === 'root') return;
    let batal = false;
    setMemuatDrill(true);
    (async () => {
      try {
        if (drill.level === 'region') {
          const data = await ambilBuildingProgress(cycleId, drill.areaId);
          if (!batal) setBuildings(data);
        } else if (drill.level === 'building') {
          const data = await ambilTvList(cycleId, { locationId: drill.locationId });
          if (!batal) setTvs(data);
        } else if (drill.level === 'filter') {
          const data = await ambilTvList(cycleId, { status: drill.status });
          if (!batal) setTvs(data);
        }
      } catch (e) {
        if (!batal) beritahu('gagal', e instanceof Error ? e.message : 'Gagal memuat rincian.');
      } finally {
        if (!batal) setMemuatDrill(false);
      }
    })();
    return () => { batal = true; };
  }, [cycleId, drill]);

  // ── Aksi lifecycle ────────────────────────────────────────────────────

  const jalankan = async (fn: () => Promise<void>) => {
    setAksiJalan(true);
    try { await fn(); await muatRingkasan(); }
    catch (e) { beritahu('gagal', e instanceof Error ? e.message : 'Aksi gagal dijalankan.'); }
    finally { setAksiJalan(false); }
  };

  const aksiUtama = (): { label: string; jalan: () => void; gaya?: 'bahaya' } | null => {
    if (!cycle || !bolehKelola) return null;
    switch (cycle.status) {
      case 'PLANNED':
        return { label: 'Aktifkan Siklus', jalan: () => void jalankan(async () => {
          await pindahStatusCycle(cycle.id, 'ACTIVE');
          beritahu('ok', 'Siklus diaktifkan. PIC sudah bisa mulai bekerja.');
        }) };
      case 'ACTIVE':
        return { label: 'Kirim ke Review Client', jalan: () => setKonfirmasi({
          message: 'Kirim siklus ini ke client untuk direview?',
          description: `${overview?.pending_tv ?? 0} TV masih belum dikerjakan dan ${overview?.failed_tv ?? 0} TV gagal. Client akan melihat kondisi apa adanya.`,
          confirmLabel: 'Kirim ke Review',
          onConfirm: () => void jalankan(async () => {
            await pindahStatusCycle(cycle.id, 'UNDER_REVIEW');
            beritahu('ok', 'Siklus dikirim ke client untuk direview.');
          }),
        }) };
      case 'UNDER_REVIEW':
        if (!adminPenuh) return null;
        return { label: 'Tandai Siap Ditutup', jalan: () => void jalankan(async () => {
          await pindahStatusCycle(cycle.id, 'READY_TO_CLOSE');
          beritahu('ok', 'Siklus ditandai siap ditutup.');
        }) };
      case 'READY_TO_CLOSE':
        if (!adminPenuh) return null;
        return { label: 'Tutup Siklus', jalan: () => setKonfirmasi({
          message: 'Tutup siklus ini?',
          description: 'Ringkasan hasil akan dibekukan sebagai riwayat permanen. Setelah ditutup, pekerjaan tidak bisa diubah lagi.',
          confirmLabel: 'Tutup Siklus',
          onConfirm: () => void jalankan(async () => {
            await pindahStatusCycle(cycle.id, 'CLOSED');
            beritahu('ok', 'Siklus ditutup. Ringkasannya tersimpan permanen di Riwayat.');
          }),
        }) };
      case 'CLOSED':
        if (!adminPenuh) return null;
        return { label: 'Minta Pembersihan Data', jalan: () => void jalankan(async () => {
          const hasil = await mintaPembersihan(cycle.id);
          beritahu('ok', `Permintaan pembersihan dibuat — ${hasil.evidence_objects} file foto menunggu persetujuan.`);
        }) };
      case 'CLEAR_PENDING':
      case 'CLEAR_PARTIAL':
        if (!adminPenuh) return null;
        return { label: cycle.status === 'CLEAR_PARTIAL' ? 'Coba Bersihkan Lagi' : 'Setujui & Bersihkan', gaya: 'bahaya',
          jalan: () => void (async () => {
            const jumlah = await hitungEvidence(cycle.id);
            setKonfirmasi({
              message: `Hapus ${jumlah} file foto dari storage?`,
              description: 'Foto bukti dan jejak GPS siklus ini akan dihapus permanen dan tidak bisa dikembalikan. Ringkasan hasil, keputusan review, dan catatan audit TETAP tersimpan.',
              confirmLabel: 'Hapus Permanen',
              danger: true,
              onConfirm: () => void jalankan(async () => {
                const hasil = await setujuiPembersihan(cycle.id);
                const catatanHilang = hasil.objects_missing > 0
                  ? ` (${hasil.objects_missing} file memang sudah tidak ada di storage)` : '';
                if (hasil.objects_failed > 0) {
                  beritahu('gagal', `Sebagian gagal: ${hasil.objects_deleted} file terhapus, ${hasil.objects_failed} gagal${catatanHilang}. Status jadi "Pembersihan Sebagian" — coba lagi setelah penyebabnya diperbaiki.`);
                } else {
                  beritahu('ok', `Selesai — ${hasil.objects_deleted} file dihapus, ${hasil.evidence_rows_deleted} catatan dibersihkan${catatanHilang}. Ringkasan & riwayat tetap tersimpan.`);
                }
              }),
            });
          })() };
      default:
        return null;
    }
  };

  const utama = aksiUtama();
  const belumAdaScope = !!overview && overview.total_tv === 0;

  // ── Turunan untuk grafik ──────────────────────────────────────────────

  const dataTren = useMemo(() => tren.map(t => ({
    nama: t.nama.replace(/^Weekend\s*/i, '').slice(0, 14),
    pct: Number(t.pct ?? 0),
    selesai: t.selesai_tv,
    total: t.total_tv,
  })), [tren]);

  const dataWilayah = useMemo(() => regions.slice(0, 8).map(r => ({
    id: r.area_id,
    nama: r.area_name.length > 16 ? r.area_name.slice(0, 15) + '…' : r.area_name,
    namaPenuh: r.area_name,
    Selesai: r.completed_tv,
    Belum: r.pending_tv,
    Gagal: r.failed_tv,
    Ulang: r.revision_tv,
  })), [regions]);

  const dataPenyebab = useMemo(() => penyebab.map(p => ({
    nama: FAILURE_REASON_LABEL[p.alasan] ?? (p.alasan === 'TIDAK_DISEBUT' ? 'Tanpa alasan' : p.alasan),
    jumlah: Number(p.jumlah),
  })), [penyebab]);

  const dataHarian = useMemo(() => harian.map(h => {
    const d = new Date(h.tanggal + 'T00:00:00');
    const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    return {
      nama: `${HARI[d.getDay()]} ${d.getDate()}`,
      Selesai: Number(h.selesai),
      Gagal: Number(h.gagal),
    };
  }), [harian]);

  const WARNA_SEBARAN: Record<string, string> = {
    'Tuntas': C.selesai,
    'Hampir (75-99%)': '#0D9488',
    'Separuh (40-74%)': '#D97706',
    'Baru mulai (<40%)': '#EA580C',
    'Belum tersentuh': C.gagal,
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (!projectSiap) {
    return <Kartu><p className="text-sm text-slate-400 text-center py-10">Menyiapkan ruang kendali…</p></Kartu>;
  }
  if (!projectId) {
    return (
      <Kartu>
        <Kosong judul="Belum ada project"
          teks="Belum ada project deployment yang bisa Anda pantau. Buat project-nya dulu lewat Admin Panel, lalu tentukan wilayah, gedung, dan TV-nya." />
      </Kartu>
    );
  }
  if (memuat && !overview) {
    return <Kartu><p className="text-sm text-slate-400 text-center py-10">Memuat ruang kendali…</p></Kartu>;
  }
  if (cycles.length === 0) {
    return (
      <Kartu>
        <Kosong judul="Belum ada siklus weekend"
          teks="Belum ada siklus deployment yang dibuat untuk project ini. Buat siklus untuk weekend terdekat, tentukan kontennya, lalu assign PIC." />
      </Kartu>
    );
  }

  const pct = overview ? persen(overview.completed_tv, overview.total_tv) : 0;
  const st = cycle ? CYCLE_STATUS_LABEL[cycle.status] : null;
  const trenSebelum = dataTren.length > 1 ? dataTren[dataTren.length - 2].pct : null;
  const selisihTren = trenSebelum !== null ? Math.round((pct - trenSebelum) * 10) / 10 : null;

  return (
    <div className="space-y-3">
      <ConfirmDialog state={konfirmasi} onCancel={() => setKonfirmasi(null)} />

      {pesan && (
        <div role="status"
          className={`rounded-lg px-3.5 py-2.5 text-[13px] font-semibold border ${pesan.tipe === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {pesan.teks}
        </div>
      )}

      {/* ── Kepala: siklus apa, tindakan apa ── */}
      <Kartu>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <CalendarDays size={12} aria-hidden="true" /> Siklus Berjalan
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[17px] font-bold text-slate-900 leading-tight tracking-tight">{cycle?.name}</h2>
              {st && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ color: st.color, background: st.bg }}>{st.label}</span>
              )}
            </div>
            {cycle && (
              <p className="text-[11px] text-slate-500 mt-1">
                Pengerjaan {rentangTanggal(cycle.execution_start, cycle.execution_end)}
                {cycle.review_start && cycle.review_end && ` · Review ${rentangTanggal(cycle.review_start, cycle.review_end)}`}
              </p>
            )}
            {st && <p className="text-[11px] text-slate-400 mt-0.5">{st.arti}</p>}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input value={cariGedung} onChange={e => setCariGedung(e.target.value)}
                placeholder="Cari gedung…" autoComplete="off" aria-label="Cari gedung"
                className="text-[12px] border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 w-40 bg-white focus:outline-none focus:border-blue-400 transition-colors duration-200" />
            </div>
            {cycles.length > 1 && (
              <div className="w-56">
                <SearchableSelect value={cycleId} onChange={setCycleId} placeholder="Cari siklus…"
                  options={cycles.map(c => ({ value: c.id, label: `${c.name} — ${CYCLE_STATUS_LABEL[c.status].label}` }))} />
              </div>
            )}
            {/* Peta sebagai tombol di kepala halaman - terlihat sejak layar
                pertama dibuka, bukan panel yang baru terlihat setelah
                menggulir jauh ke bawah. */}
            <button type="button" onClick={() => setPetaTerbuka(true)}
              className="flex items-center gap-1.5 text-[13px] font-bold px-3.5 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 whitespace-nowrap transition-colors duration-200 cursor-pointer">
              <MapIcon size={14} aria-hidden="true" /> Lihat Peta
            </button>
            {utama && (
              <button type="button" onClick={utama.jalan} disabled={aksiJalan}
                className="text-[13px] font-bold px-3.5 py-2 rounded-lg text-white disabled:opacity-50 whitespace-nowrap transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ background: utama.gaya === 'bahaya' ? C.gagal : C.primer }}>
                {aksiJalan ? 'Memproses…' : utama.label}
              </button>
            )}
          </div>
        </div>
      </Kartu>

      {belumAdaScope ? (
        <Kartu>
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center">
            <p className="text-[13px] font-bold text-slate-700">Belum ada pekerjaan pada siklus ini</p>
            <p className="text-[11px] text-slate-500 mt-1 mb-4 max-w-md mx-auto leading-relaxed">
              PIC sudah di-assign ke gedung, tapi daftar TV untuk siklus ini belum dibuat.
              Sistem akan menurunkannya otomatis dari assignment yang ada.
            </p>
            {bolehKelola && (
              <button type="button" disabled={aksiJalan}
                onClick={() => void jalankan(async () => {
                  const h = await buatScopePekerjaan(cycleId);
                  beritahu('ok', `Scope dibuat: ${h.created} penugasan gedung untuk siklus ini.`);
                })}
                className="text-[13px] font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 cursor-pointer"
                style={{ background: C.primer }}>
                {aksiJalan ? 'Membuat…' : 'Buat Daftar Pekerjaan'}
              </button>
            )}
          </div>
        </Kartu>
      ) : overview && (
        <>
          {/* ── Baris KPI ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
            <UbinKpi ikon={Tv} label="Total TV" nilai={overview.total_tv} warna={C.primer}
              sub={`${overview.building_total} gedung · ${overview.region_total} wilayah`} />
            <UbinKpi ikon={CheckCircle2} label="Selesai" nilai={overview.completed_tv} warna={C.selesai}
              sub={`${pct}% dari total`}
              onClick={() => setDrill({ level: 'filter', status: 'COMPLETED', judul: 'TV yang sudah selesai' })}
              aktif={drill.level === 'filter' && drill.status === 'COMPLETED'} />
            <UbinKpi ikon={Clock} label="Belum dikerjakan" nilai={overview.pending_tv} warna={C.belum}
              onClick={() => setDrill({ level: 'filter', status: 'PENDING', judul: 'TV yang belum dikerjakan' })}
              aktif={drill.level === 'filter' && drill.status === 'PENDING'} />
            <UbinKpi ikon={XCircle} label="Gagal" nilai={overview.failed_tv} warna={C.gagal}
              sub={dataPenyebab[0] ? `terbanyak: ${dataPenyebab[0].nama}` : undefined}
              onClick={() => setDrill({ level: 'filter', status: 'FAILED', judul: 'TV yang gagal' })}
              aktif={drill.level === 'filter' && drill.status === 'FAILED'} />
            <UbinKpi ikon={RotateCcw} label="Perlu diulang" nilai={overview.revision_tv} warna={C.revisi}
              sub="diminta client"
              onClick={() => setDrill({ level: 'filter', status: 'REVISION', judul: 'TV yang diminta revisi client' })}
              aktif={drill.level === 'filter' && drill.status === 'REVISION'} />
            <UbinKpi ikon={ShieldCheck} label="Disetujui client" nilai={overview.verified_tv} warna={C.verified}
              sub={`${overview.building_complete}/${overview.building_total} gedung tuntas`}
              onClick={() => setDrill({ level: 'filter', status: 'VERIFIED', judul: 'TV yang sudah disetujui client' })}
              aktif={drill.level === 'filter' && drill.status === 'VERIFIED'} />
          </div>

          {/* ── Mode pencarian / drill-down menggantikan panel ringkasan ── */}
          {cariGedung.trim() ? (
            <Kartu padat>
              <HeaderDrill jejak={[{ label: 'Kembali ke Ringkasan', onClick: () => setCariGedung('') }, { label: 'Hasil pencarian gedung' }]} />
              {!semuaGedung ? (
                <p className="text-sm text-slate-400 text-center py-10">Mencari…</p>
              ) : (() => {
                const q = cariGedung.trim().toLowerCase();
                const cocok = semuaGedung.filter(b =>
                  b.location_name.toLowerCase().includes(q) || b.area_name.toLowerCase().includes(q));
                if (cocok.length === 0) {
                  return <Kosong judul="Tidak ada gedung yang cocok"
                    teks={`Tidak ada gedung atau wilayah yang namanya mengandung "${cariGedung.trim()}" pada siklus ini.`} />;
                }
                return (
                  <div className="divide-y divide-slate-50 max-h-[460px] overflow-y-auto">
                    {cocok.map(b => (
                      <BarisDrill key={b.location_id}
                        judul={b.location_name}
                        sub={`${b.area_name} · ${b.pic_names?.join(', ') || 'Belum ada PIC'} · ${b.completed_tv}/${b.total_tv} TV`}
                        pct={b.pct ?? 0}
                        kanan={<LencanaMasalah gagal={b.failed_tv} revisi={b.revision_tv} belum={b.pending_tv} />}
                        onClick={() => { setCariGedung(''); setDrill({ level: 'building', areaId: b.area_id, areaName: b.area_name, locationId: b.location_id, locationName: b.location_name }); }}
                      />
                    ))}
                  </div>
                );
              })()}
            </Kartu>
          ) : drill.level !== 'root' ? (
            <Kartu padat>
              <HeaderDrill
                jejak={[
                  { label: 'Kembali ke Ringkasan', onClick: () => setDrill({ level: 'root' }) },
                  ...(drill.level === 'building' && drill.areaId
                    ? [{ label: drill.areaName ?? '', onClick: () => setDrill({ level: 'region', areaId: drill.areaId!, areaName: drill.areaName ?? '' }) }]
                    : []),
                  { label: drill.level === 'region' ? drill.areaName : drill.level === 'building' ? drill.locationName : drill.judul },
                ]}
                aksi={
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input value={cariDrill} onChange={e => setCariDrill(e.target.value)}
                      placeholder={drill.level === 'region' ? 'Cari gedung…' : 'Cari TV / gedung…'}
                      autoComplete="off" aria-label="Cari di daftar ini"
                      className="text-[12px] border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 w-44 bg-white focus:outline-none focus:border-blue-400" />
                  </div>
                } />

              {memuatDrill ? (
                <p className="text-sm text-slate-400 text-center py-10">Memuat…</p>
              ) : drill.level === 'region' ? (
                (() => {
                  const q = cariDrill.trim().toLowerCase();
                  const tampil = q ? buildings.filter(b => b.location_name.toLowerCase().includes(q)) : buildings;
                  return tampil.length === 0 ? (
                    <Kosong judul={buildings.length === 0 ? 'Belum ada gedung' : 'Tidak ada yang cocok'}
                      teks={buildings.length === 0
                        ? 'Wilayah ini belum punya pekerjaan pada siklus ini.'
                        : 'Tidak ada gedung yang namanya cocok dengan pencarian Anda.'} />
                  ) : (
                    <div className="divide-y divide-slate-50 max-h-[520px] overflow-y-auto">
                      {tampil.map(b => (
                        <BarisDrill key={b.location_id}
                          judul={b.location_name}
                          sub={`${b.pic_names?.join(', ') || 'Belum ada PIC'} · ${b.completed_tv}/${b.total_tv} TV selesai`}
                          pct={b.pct ?? 0}
                          kanan={<LencanaMasalah gagal={b.failed_tv} revisi={b.revision_tv} belum={b.pending_tv} />}
                          onClick={() => setDrill({ level: 'building', areaId: b.area_id, areaName: b.area_name, locationId: b.location_id, locationName: b.location_name })}
                        />
                      ))}
                    </div>
                  );
                })()
              ) : (
                <DaftarTv tvs={tvs} cari={cariDrill} />
              )}
            </Kartu>
          ) : (
            <>
              {/* ── Masonry sungguhan, berbasis pengukuran tinggi asli tiap
                  kartu (komponen <Masonry>, lihat components/shared/Masonry.tsx)
                  ────────────────────────────────────────────────────────
                  Riwayat perbaikan bagian ini (tiga percobaan):
                  1) Grid 3-kolom dengan pembagian kartu TETAP di kode
                     (round-robin manual) - gagal karena kode tidak pernah
                     tahu tinggi asli tiap kartu (chart Recharts baru pasti
                     tingginya setelah data ter-render), jadi satu kolom bisa
                     jauh lebih pendek dan menyisakan area kosong di
                     bawahnya sebelum section berikutnya mulai.
                  2) `columns-3` + `column-fill:balance` (fitur bawaan CSS) -
                     lebih baik (browser yang membagi, bukan kode), tapi
                     tetap cuma tebakan cepat, bukan optimasi sungguhan -
                     selisih tinggi antar kolom masih terlihat (ditunjuk user
                     lewat screenshot panah merah: "masih ada space kosong",
                     "kenapa tidak rata semua kotak").
                  3) <Masonry> di sini: ResizeObserver mengukur tinggi PIKSEL
                     asli tiap kartu setelah dirender, lalu algoritma "kolom
                     paling pendek duluan" menata ulang lewat
                     position:absolute - hasil serata mungkin yang bisa
                     dicapai untuk kombinasi tinggi manapun, dan otomatis
                     menata ulang lagi kalau ada kartu yang berubah tinggi
                     (data baru, chart selesai animasi) atau lebar kontainer
                     berubah (sidebar dibuka/tutup). Kartu TIDAK lagi
                     dibungkus div kolom manual - cukup jadi children
                     langsung, masing-masing dengan `key` eksplisit supaya
                     identitasnya stabil walau "Perlu Perhatian"/"Progres
                     per PIC" kadang tidak dirender (render kondisional). */}
              <Masonry columns={3} minColumnWidth={280} gap={12}>
                <Kartu key="progres-siklus">
                  <JudulPanel ikon={Activity} judul="Progres Siklus"
                    ket="Persentase TV yang benar-benar terpasang" />
                  <div className="flex items-end justify-between gap-3 mb-2.5">
                    <div>
                      <p className="text-[30px] font-bold tabular-nums leading-none tracking-tight"
                        style={{ color: warnaProgress(pct) }}>{pct}%</p>
                      <p className="text-[12px] text-slate-500 mt-1.5 tabular-nums">
                        {overview.completed_tv.toLocaleString('id-ID')} dari {overview.total_tv.toLocaleString('id-ID')} TV
                      </p>
                    </div>
                    {selisihTren !== null && (
                      <span className="text-[11px] font-bold px-2 py-1 rounded-md tabular-nums flex items-center gap-1"
                        style={selisihTren >= 0
                          ? { color: '#047857', background: '#D1FAE5' }
                          : { color: '#B91C1C', background: '#FEE2E2' }}>
                        <TrendingUp size={12} aria-hidden="true"
                          style={{ transform: selisihTren >= 0 ? 'none' : 'scaleY(-1)' }} />
                        {selisihTren >= 0 ? '+' : ''}{selisihTren} pt
                      </span>
                    )}
                  </div>
                  <Bar2 pct={pct} tinggi={10} />
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100">
                    {[
                      { i: Building2, l: 'Gedung tuntas', v: `${overview.building_complete}/${overview.building_total}` },
                      { i: Users, l: 'PIC bertugas', v: String(overview.pic_total) },
                      { i: MapPin, l: 'Wilayah', v: String(overview.region_total) },
                    ].map(m => (
                      <div key={m.l}>
                        <p className="text-[10px] text-slate-400 flex items-center gap-1 mb-0.5">
                          <m.i size={11} aria-hidden="true" />{m.l}
                        </p>
                        <p className="text-[14px] font-bold text-slate-800 tabular-nums">{m.v}</p>
                      </div>
                    ))}
                  </div>
                </Kartu>

                <Kartu key="progres-wilayah">
                  <JudulPanel ikon={MapPin} judul="Progres per Wilayah"
                    ket="Diurutkan dari yang paling tertinggal · klik batang untuk membuka gedungnya" />
                  {dataWilayah.length === 0 ? (
                    <Kosong judul="Belum ada wilayah" teks="Siklus ini belum punya pekerjaan di wilayah mana pun." />
                  ) : (
                    <div style={{ width: '100%', height: Math.max(150, dataWilayah.length * 34 + 26) }}>
                      <ResponsiveContainer>
                        <BarChart data={dataWilayah} layout="vertical" barSize={15}
                          margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.garis} horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10, fill: C.redup }} tickLine={false} axisLine={false} />
                          <YAxis type="category" dataKey="nama" width={96} tick={{ fontSize: 11, fill: '#334155' }}
                            tickLine={false} axisLine={false} />
                          <Tooltip content={<TipGrafik satuan=" TV" />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                          <Bar dataKey="Selesai" stackId="a" fill={C.selesai} isAnimationActive={animasi}
                            cursor="pointer" radius={[0, 0, 0, 0]}
                            onClick={(d: { payload?: { id: string; namaPenuh: string } }) =>
                              d?.payload && setDrill({ level: 'region', areaId: d.payload.id, areaName: d.payload.namaPenuh })} />
                          <Bar dataKey="Belum" stackId="a" fill={C.belum} isAnimationActive={animasi} />
                          <Bar dataKey="Gagal" stackId="a" fill={C.gagal} isAnimationActive={animasi} />
                          <Bar dataKey="Ulang" stackId="a" fill={C.revisi} isAnimationActive={animasi} radius={[0, 3, 3, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="flex items-center gap-3 flex-wrap mt-2 pt-2 border-t border-slate-100">
                    {[['Selesai', C.selesai], ['Belum', C.belum], ['Gagal', C.gagal], ['Perlu diulang', C.revisi]].map(([l, w]) => (
                      <span key={l} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: w }} aria-hidden="true" />
                        <span className="text-[10px] font-semibold text-slate-500">{l}</span>
                      </span>
                    ))}
                  </div>
                </Kartu>

                <Kartu key="penyelesaian-per-hari">
                  <JudulPanel ikon={CalendarDays} judul="Penyelesaian per Hari"
                    ket="Apakah Minggu dipakai mengejar sisa Sabtu, atau justru berhenti" />
                  {dataHarian.length === 0 ? (
                    <Kosong judul="Belum ada pekerjaan tercatat"
                      teks="Grafik ini terisi begitu PIC mulai menandai TV di lapangan." />
                  ) : (
                    <div style={{ width: '100%', height: 150 }}>
                      <ResponsiveContainer>
                        <BarChart data={dataHarian} barSize={26} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.garis} vertical={false} />
                          <XAxis dataKey="nama" tick={{ fontSize: 10, fill: C.redup }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: C.redup }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
                          <Tooltip content={<TipGrafik satuan=" TV" />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                          <Bar dataKey="Selesai" stackId="h" fill={C.selesai} isAnimationActive={animasi} />
                          <Bar dataKey="Gagal" stackId="h" fill={C.gagal} isAnimationActive={animasi} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Kartu>

                <Kartu key="komposisi-status-tv">
                  <JudulPanel ikon={Tv} judul="Komposisi Status TV"
                    ket="Klik salah satu untuk melihat daftar TV-nya" />
                  <DonutLegenda ukuran={86} labelPusat="Total TV"
                    data={[
                      { label: 'Selesai', value: overview.completed_tv, color: C.selesai,
                        onClick: () => setDrill({ level: 'filter', status: 'COMPLETED', judul: 'TV yang sudah selesai' }) },
                      { label: 'Belum dikerjakan', value: overview.pending_tv, color: C.belum,
                        onClick: () => setDrill({ level: 'filter', status: 'PENDING', judul: 'TV yang belum dikerjakan' }) },
                      { label: 'Gagal', value: overview.failed_tv, color: C.gagal,
                        onClick: () => setDrill({ level: 'filter', status: 'FAILED', judul: 'TV yang gagal' }) },
                      { label: 'Perlu diulang', value: overview.revision_tv, color: C.revisi,
                        onClick: () => setDrill({ level: 'filter', status: 'REVISION', judul: 'TV yang diminta revisi client' }) },
                      { label: 'Dilewati', value: overview.skipped_tv, color: '#CBD5E1' },
                    ]} />
                </Kartu>

                <Kartu key="penyebab-kegagalan">
                  <JudulPanel ikon={AlertTriangle} judul="Penyebab Kegagalan"
                    ket="Inilah yang mengubah angka gagal jadi tindakan: kirim teknisi, telepon gedung, atau ganti file" />
                  {dataPenyebab.length === 0 ? (
                    <Kosong judul="Tidak ada kegagalan"
                      teks="Belum ada TV yang dilaporkan gagal pada siklus ini." />
                  ) : (
                    <div style={{ width: '100%', height: Math.max(150, dataPenyebab.length * 34 + 26) }}>
                      <ResponsiveContainer>
                        <BarChart data={dataPenyebab} layout="vertical" barSize={15}
                          margin={{ top: 0, right: 26, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.garis} horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10, fill: C.redup }} tickLine={false} axisLine={false} allowDecimals={false} />
                          <YAxis type="category" dataKey="nama" width={130} tick={{ fontSize: 11, fill: '#334155' }}
                            tickLine={false} axisLine={false} />
                          <Tooltip content={<TipGrafik satuan=" TV" />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                          <Bar dataKey="jumlah" name="TV gagal" isAnimationActive={animasi} radius={[0, 3, 3, 0]}>
                            {dataPenyebab.map((_, i) => (
                              <Cell key={i} fill={i === 0 ? C.gagal : '#F87171'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Kartu>

                {attention.length > 0 && (
                  <Kartu key="perlu-perhatian" padat>
                    <div className="px-3.5 pt-3">
                      <JudulPanel ikon={AlertTriangle} judul="Perlu Perhatian"
                        ket="Gedung bermasalah, paling parah di atas"
                        aksi={<span className="text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums"
                          style={{ color: '#B91C1C', background: '#FEE2E2' }}>{attention.length} gedung</span>} />
                    </div>
                    <div className="divide-y divide-slate-50 max-h-[340px] overflow-y-auto border-t border-slate-100">
                      {attention.map(a => (
                        <BarisDrill key={a.location_id}
                          judul={a.location_name}
                          sub={`${a.area_name} · PIC ${a.pic_names?.join(', ') || '—'}`}
                          kanan={<LencanaMasalah gagal={a.failed_tv} revisi={a.revision_tv} belum={a.pending_tv} />}
                          onClick={() => setDrill({ level: 'building', areaId: a.area_id, areaName: a.area_name, locationId: a.location_id, locationName: a.location_name })}
                        />
                      ))}
                    </div>
                  </Kartu>
                )}

                <Kartu key="tren-antar-siklus">
                  <JudulPanel ikon={TrendingUp} judul="Tren Antar Siklus"
                    ket="Membaik atau memburuk dibanding akhir pekan sebelumnya" />
                  {dataTren.length < 2 ? (
                    <Kosong judul="Belum cukup data"
                      teks="Tren muncul setelah ada minimal dua siklus. Satu titik bukan tren." />
                  ) : (
                    <div style={{ width: '100%', height: 168 }}>
                      <ResponsiveContainer>
                        <AreaChart data={dataTren} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                          <defs>
                            <linearGradient id="gradTren" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={C.sekunder} stopOpacity={0.28} />
                              <stop offset="100%" stopColor={C.sekunder} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.garis} vertical={false} />
                          <XAxis dataKey="nama" tick={{ fontSize: 10, fill: C.redup }} tickLine={false} axisLine={false} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: C.redup }} tickLine={false} axisLine={false} width={34} />
                          <Tooltip content={<TipGrafik satuan="%" />} />
                          <Area type="monotone" dataKey="pct" name="Selesai" stroke={C.primer} strokeWidth={2}
                            fill="url(#gradTren)" isAnimationActive={animasi} dot={{ r: 3, fill: C.primer }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Kartu>

                <Kartu key="kesiapan-gedung">
                  <JudulPanel ikon={Building2} judul="Kesiapan Gedung"
                    ket="&quot;Tinggal sedikit lagi&quot; dan &quot;belum tersentuh&quot; adalah dua masalah yang sangat berbeda" />
                  {sebaran.length === 0 ? (
                    <Kosong judul="Belum ada data" teks="Grafik ini terisi begitu ada TV yang dikerjakan." />
                  ) : (() => {
                    const totalGedung = sebaran.reduce((s, x) => s + Number(x.jumlah), 0);
                    const tuntas = Number(sebaran.find(s => s.kelompok === 'Tuntas')?.jumlah ?? 0);
                    const belumTersentuh = Number(sebaran.find(s => s.kelompok === 'Belum tersentuh')?.jumlah ?? 0);
                    return (
                      <>
                        <DonutLegenda ukuran={86} labelPusat="Gedung"
                          data={sebaran.map(s => ({
                            label: s.kelompok,
                            value: Number(s.jumlah),
                            color: WARNA_SEBARAN[s.kelompok] ?? C.belum,
                          }))} />
                        {/* Kalimat biasa, bukan cuma donat+legenda - user
                            melaporkan "kesiapan gedung itu apa, tidak jelas".
                            Angkanya sama, tapi dieja jadi kalimat supaya tidak
                            perlu menerka-nerka arti warna/istilah kelompok. */}
                        <p className="text-[11px] text-slate-600 leading-relaxed mt-2.5 pt-2.5 border-t border-slate-100">
                          <span className="font-bold" style={{ color: C.selesai }}>{tuntas} dari {totalGedung} gedung</span> sudah tuntas seluruh TV-nya.
                          {belumTersentuh > 0 && (
                            <> <span className="font-bold" style={{ color: '#b91c1c' }}>{belumTersentuh} gedung</span> belum disentuh PIC sama sekali.</>
                          )}
                        </p>
                      </>
                    );
                  })()}
                </Kartu>

                {pics.length > 0 && (
                  <Kartu key="progres-per-pic" padat>
                    <div className="px-3.5 pt-3">
                      <JudulPanel ikon={Users} judul="Progres per PIC"
                        ket="Diurutkan dari yang paling tertinggal"
                        aksi={pics.length > 6 ? (
                          <button type="button" onClick={() => setSemuaPic(v => !v)}
                            className="text-[11px] font-bold text-blue-700 hover:underline cursor-pointer whitespace-nowrap">
                            {semuaPic ? 'Tampilkan 6' : `Semua (${pics.length})`}
                          </button>
                        ) : undefined} />
                    </div>
                    <div className="divide-y divide-slate-50 max-h-[340px] overflow-y-auto border-t border-slate-100">
                      {(semuaPic ? pics : pics.slice(0, 6)).map(p => (
                        <BarisDrill key={p.pic_user_id ?? p.pic_name}
                          judul={p.pic_name}
                          sub={`${p.building_total} gedung · ${p.completed_tv}/${p.total_tv} TV selesai`}
                          pct={p.pct ?? 0}
                          kanan={<LencanaMasalah gagal={p.failed_tv} revisi={p.revision_tv} belum={p.pending_tv} />}
                        />
                      ))}
                    </div>
                  </Kartu>
                )}
              </Masonry>

              {/* ── Antrean persetujuan check-out tidak tuntas ── */}
              {bolehKelola && pendingCheckout.length > 0 && (
                <Kartu padat>
                  <div className="px-3.5 pt-3">
                    <JudulPanel ikon={ShieldCheck} judul="Check-out Perlu Persetujuan"
                      ket="PIC selesai bekerja tapi ada TV yang tidak beres. Angkanya dihitung sistem, alasannya ditulis PIC."
                      aksi={<span className="text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums"
                        style={{ color: '#C2410C', background: '#FFEDD5' }}>{pendingCheckout.length} menunggu</span>} />
                  </div>
                  <div className="divide-y divide-slate-50 max-h-[380px] overflow-y-auto border-t border-slate-100">
                    {pendingCheckout.map(p => (
                      <div key={p.report_id} className="px-3.5 py-3">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-bold text-slate-800 truncate">{p.location_name}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {p.area_name} · PIC {p.pic_name ?? '—'} · {p.deployment_date}
                            </p>
                            <p className="text-[11px] mt-1 tabular-nums">
                              <span className="font-bold" style={{ color: '#B45309' }}>
                                {p.displays_completed}/{p.displays_total} TV selesai
                              </span>
                              <span className="text-slate-400"> · {p.displays_total - p.displays_completed} tidak beres</span>
                            </p>
                            <p className="text-[11px] mt-1.5 px-2.5 py-1.5 rounded-lg leading-relaxed"
                              style={{ background: '#FFF7ED', color: '#7C2D12' }}>
                              Alasan PIC: {p.notes || '(tidak diisi)'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button type="button" disabled={aksiJalan}
                              onClick={() => void jalankan(async () => {
                                await putuskanCheckout(p.report_id, 'APPROVED');
                                beritahu('ok', `Check-out ${p.location_name} disetujui.`);
                              })}
                              className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 cursor-pointer"
                              style={{ background: C.selesai }}>Setujui</button>
                            <button type="button"
                              onClick={() => setTolakCheckout({ id: p.report_id, nama: p.location_name })}
                              className="text-[11px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer"
                              style={{ borderColor: '#FCA5A5', color: '#B91C1C', background: '#FFF1F2' }}>Tolak</button>
                          </div>
                        </div>

                        {tolakCheckout?.id === p.report_id && (
                          <div className="mt-2.5 rounded-lg p-3" style={{ background: '#FFF1F2', border: '1px solid #FCA5A5' }}>
                            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#B91C1C' }}>
                              Kenapa ditolak? PIC perlu tahu apa yang harus diperbaiki
                            </label>
                            <textarea value={alasanTolak} onChange={e => setAlasanTolak(e.target.value)} rows={2}
                              placeholder="Contoh: TV mati harus dicoba ulang Minggu pagi, bukan dilewati."
                              className="w-full border border-red-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-red-400 bg-white" />
                            <div className="flex gap-2 justify-end mt-2">
                              <button type="button" onClick={() => { setTolakCheckout(null); setAlasanTolak(''); }}
                                className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 cursor-pointer">
                                Batal
                              </button>
                              <button type="button" disabled={!alasanTolak.trim() || aksiJalan}
                                onClick={() => void jalankan(async () => {
                                  await putuskanCheckout(p.report_id, 'REJECTED', alasanTolak.trim());
                                  beritahu('ok', `Check-out ${p.location_name} ditolak — PIC akan melihat alasannya.`);
                                  setTolakCheckout(null); setAlasanTolak('');
                                })}
                                className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 cursor-pointer"
                                style={{ background: '#B91C1C' }}>
                                Kirim Penolakan
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Kartu>
              )}

            </>
          )}
        </>
      )}

      {/* Peta sebagai DIALOG, bukan panel di dasar halaman - dulu di sinilah
          user harus menggulir jauh untuk sekadar melihatnya. Tombol
          pembukanya ada di kepala halaman (dekat kotak pencarian gedung),
          jadi terlihat sejak layar pertama kali dibuka, bukan hilang di
          bawah lipatan. */}
      <DialogBesar buka={petaTerbuka} onTutup={() => setPetaTerbuka(false)} penuh
        judul="Peta Sebaran Gedung" ikon={MapIcon}
        ket={overview ? `${overview.building_total} gedung · warna menandakan keadaan pekerjaan` : undefined}>
        {!semuaGedung ? (
          <p className="flex-1 flex items-center justify-center text-sm text-slate-400">Memuat peta…</p>
        ) : semuaGedung.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <Kosong judul="Belum ada gedung" teks="Buat daftar pekerjaan dulu agar gedungnya muncul di peta." />
          </div>
        ) : (
          <PetaOperasional buildings={semuaGedung} penuh
            onPilihGedung={b => {
              setPetaTerbuka(false);
              setDrill({ level: 'building', areaId: b.area_id, areaName: b.area_name, locationId: b.location_id, locationName: b.location_name });
            }} />
        )}
      </DialogBesar>
    </div>
  );
}

// ── Daftar TV (ujung drill-down) ───────────────────────────────────────

function DaftarTv({ tvs, cari = '' }: { tvs: TvTask[]; cari?: string }) {
  const q = cari.trim().toLowerCase();
  const tampil = q
    ? tvs.filter(t => t.tv_name.toLowerCase().includes(q)
      || t.location_name.toLowerCase().includes(q)
      || (t.tv_floor ?? '').toLowerCase().includes(q))
    : tvs;

  if (tampil.length === 0) {
    return <Kosong judul="Tidak ada TV di sini"
      teks={q ? `Tidak ada TV yang cocok dengan "${cari.trim()}".` : 'Tidak ada TV yang cocok dengan pilihan ini.'} />;
  }
  return (
    <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
      <table className="w-full text-[13px]">
        <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 sticky top-0 z-10">
          <tr>
            <th className="text-left px-3.5 py-2">TV</th>
            <th className="text-left px-3 py-2">Gedung</th>
            <th className="text-left px-3 py-2">PIC</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Keterangan</th>
            <th className="text-right px-3.5 py-2">Bukti</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {tampil.map(t => {
            const efektif = t.review_status === 'REVISION' ? 'REVISION_REQUIRED' : t.tv_status;
            const s = TV_STATUS_LABEL[efektif] ?? { label: efektif, color: '#475569', bg: '#F1F5F9' };
            const keterangan = t.review_status === 'REVISION'
              ? (t.review_notes ?? 'Client meminta revisi.')
              : t.failure_reason
                ? `${FAILURE_REASON_LABEL[t.failure_reason] ?? t.failure_reason}${t.failure_detail ? ` — ${t.failure_detail}` : ''}`
                : (t.pic_notes ?? '—');
            return (
              <tr key={`${t.instance_id}-${t.execution_point_id}`} className="hover:bg-slate-50 transition-colors duration-150">
                <td className="px-3.5 py-2">
                  <span className="font-bold text-slate-800">{t.tv_name}</span>
                  {t.tv_floor && <span className="block text-[10px] text-slate-400">{t.tv_floor}</span>}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {t.location_name}
                  <span className="block text-[10px] text-slate-400">{t.area_name}</span>
                </td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{t.pic_name ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ color: s.color, background: s.bg }}>{s.label}</span>
                </td>
                <td className="px-3 py-2 text-slate-500 text-[11px] max-w-xs">{keterangan}</td>
                <td className="px-3.5 py-2 text-right text-slate-500 text-[11px] whitespace-nowrap tabular-nums">
                  {t.evidence_count > 0 ? `${t.evidence_count} foto` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
