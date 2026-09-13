'use client';

/**
 * ReviewSiklus.tsx - layar review untuk Client/Reviewer.
 *
 * Memakai kit visual yang SAMA dengan Dashboard (components/shared/
 * PanelOperasional.tsx) - ubin KPI berikon, donat dalam kartu sendiri, dan
 * navigasi drill-down dengan tombol kembali besar. Sebelumnya halaman ini
 * menyusun tampilannya sendiri (donat mengambang di sebelah angka tanpa
 * bingkai, tombol kembali kecil "← Semua gedung"), dan hasilnya persis
 * keluhan user: tidak konsisten dengan Dashboard yang sudah disukai.
 *
 * Dua hal yang berubah secara mendasar dari versi sebelum ReviewSiklus ada:
 *  1. Yang direview adalah SIKLUS WEEKEND, bukan baris pekerjaan lepas.
 *  2. Keputusan turun ke level TV, bukan per gedung.
 *
 * Client sengaja TIDAK diberi UI administrasi apa pun di sini (§4 master
 * prompt): tidak ada assign PIC, tidak ada master data, tidak ada tombol
 * lifecycle selain keputusan review miliknya sendiri.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays, CheckCircle2, Clock, ImageIcon, RotateCcw, Search, ShieldCheck, XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ambilSignedUrl } from '@/lib/evidence-url';
import { kirimNotifikasi } from '@/lib/notifikasi/router';
import {
  ConfirmDialog, SearchableSelect, DonutLegenda, TabelRingkas, type ConfirmState,
  KartuOperasional as Kartu, JudulPanel, UbinKpi, Bar2, BarisDrill, LencanaMasalah,
  KosongOperasional as Kosong, HeaderDrill,
} from '@/components/shared';
import {
  ambilCycles, cycleBerjalan, ambilOverview, ambilBuildingProgress, ambilTvList, projectAktif,
  CYCLE_STATUS_LABEL, TV_STATUS_LABEL, FAILURE_REASON_LABEL,
  persen, warnaProgress, rentangTanggal,
  type Cycle, type CycleOverview, type BuildingProgress, type TvTask,
} from '@/lib/fs-cycle';

const C = { selesai: '#059669', belum: '#94A3B8', gagal: '#DC2626', revisi: '#EA580C', verified: '#0D9488' };

/** bucket/path disimpan (bukan cuma URL foto penuh) supaya foto ukuran
 *  penuh baru diminta lewat ambilSignedUrl saat pengguna sungguh mengklik
 *  thumbnail-nya (029) - galeri sendiri cuma memuat thumbUrl yang kecil. */
interface FotoBukti { bucket: string; path: string; thumbUrl: string | null; }

export function ReviewSiklus({ projectId, bolehReview, beritahu }: {
  projectId: string;
  bolehReview: boolean;
  beritahu: (tipe: 'ok' | 'gagal', teks: string) => void;
}) {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [overview, setOverview] = useState<CycleOverview | null>(null);
  const [buildings, setBuildings] = useState<BuildingProgress[]>([]);
  const [memuat, setMemuat] = useState(true);

  const [gedungAktif, setGedungAktif] = useState<BuildingProgress | null>(null);
  const [cariGedung, setCariGedung] = useState('');
  const [tvs, setTvs] = useState<TvTask[]>([]);
  const [memuatTv, setMemuatTv] = useState(false);
  const [saring, setSaring] = useState<string>('');

  const [aksiJalan, setAksiJalan] = useState<string | null>(null);
  const [mintaRevisi, setMintaRevisi] = useState<TvTask | null>(null);
  const [alasanRevisi, setAlasanRevisi] = useState('');
  const [konfirmasi, setKonfirmasi] = useState<ConfirmState | null>(null);
  const [foto, setFoto] = useState<Record<string, FotoBukti[]>>({});

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        // Client tidak punya selector project di sidebar (itu khusus menu
        // Operations), jadi prop-nya bisa kosong - turunkan sendiri.
        const id = projectId || await projectAktif();
        if (batal || !id) return;
        const data = await ambilCycles(id);
        if (batal) return;
        setCycles(data);
        setCycleId(prev => prev || cycleBerjalan(data)?.id || '');
      } catch (e) {
        beritahu('gagal', e instanceof Error ? e.message : 'Gagal memuat siklus.');
      } finally {
        if (!batal) setMemuat(false);
      }
    })();
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const muatRingkasan = useCallback(async () => {
    if (!cycleId) return;
    setMemuat(true);
    try {
      const [ov, bg] = await Promise.all([ambilOverview(cycleId), ambilBuildingProgress(cycleId)]);
      setOverview(ov); setBuildings(bg);
    } catch (e) {
      beritahu('gagal', e instanceof Error ? e.message : 'Gagal memuat ringkasan.');
    } finally { setMemuat(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId]);

  useEffect(() => { void muatRingkasan(); }, [muatRingkasan]);
  useEffect(() => { setGedungAktif(null); }, [cycleId]);

  const muatTv = useCallback(async () => {
    if (!cycleId || !gedungAktif) return;
    setMemuatTv(true);
    try {
      const data = await ambilTvList(cycleId, { locationId: gedungAktif.location_id, status: saring || null });
      setTvs(data);
    } catch (e) {
      beritahu('gagal', e instanceof Error ? e.message : 'Gagal memuat daftar TV.');
    } finally { setMemuatTv(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId, gedungAktif, saring]);

  useEffect(() => { void muatTv(); }, [muatTv]);

  /** Foto bukti dimuat HANYA saat barisnya dibuka - 456 TV × foto tidak
   *  pernah ditarik sekaligus hanya karena halamannya dibuka. */
  const bukaFoto = async (t: TvTask) => {
    const kunci = `${t.instance_id}-${t.execution_point_id}`;
    if (foto[kunci]) { setFoto(f => { const n = { ...f }; delete n[kunci]; return n; }); return; }
    const { data } = await supabase.from('fs_evidence').select('bucket, path, thumb_path')
      .eq('execution_instance_id', t.instance_id).eq('execution_point_id', t.execution_point_id);
    // Cuma THUMBNAIL (029) yang dimuat di sini - foto ukuran penuh baru
    // diminta saat pengguna mengklik thumbnail-nya (lihat bukaFotoPenuh).
    // ambilSignedUrl() sendiri di-cache per (bucket,path), jadi tutup-buka
    // baris TV yang sama tidak menerbitkan token baru tiap kali.
    const daftar: FotoBukti[] = [];
    for (const r of (data ?? []) as { bucket: string; path: string; thumb_path: string | null }[]) {
      const thumbUrl = await ambilSignedUrl(r.bucket, r.thumb_path ?? r.path).catch(() => null);
      daftar.push({ bucket: r.bucket, path: r.path, thumbUrl });
    }
    setFoto(f => ({ ...f, [kunci]: daftar }));
  };

  const bukaFotoPenuh = async (f: FotoBukti) => {
    const url = await ambilSignedUrl(f.bucket, f.path);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  /**
   * Kabari PIC saat TV-nya diminta diulang. Tanpa ini PIC baru tahu kalau
   * kebetulan membuka aplikasi - padahal masa kerjanya cuma akhir pekan.
   * Event 'fs.revision_requested' sudah ada di katalog notifikasi; in-app
   * sengaja tidak dipakai (lihat katalog.ts), kanalnya WA/Telegram.
   */
  const kabariPicRevisi = async (t: TvTask, alasan: string) => {
    if (!t.pic_user_id) return;
    try {
      const { data: u } = await supabase.from('users')
        .select('full_name, phone_number, telegram_chat_id').eq('id', t.pic_user_id).maybeSingle();
      if (!u) return;
      const pesan = `Client meminta perbaikan untuk ${t.tv_name} di ${t.location_name}.\nAlasan: ${alasan}\nBuka "Tugas Weekend Saya" untuk mengerjakan ulang.`;
      await kirimNotifikasi({
        event: 'fs.revision_requested',
        whatsapp: { penerima: [{ nama: u.full_name, telepon: u.phone_number }], pesan, jenisWA: 'fs_revision_requested' },
        telegram: u.telegram_chat_id ? { pesan, chatId: u.telegram_chat_id } : undefined,
      });
    } catch {
      /* diam - keputusan review-nya sudah tersimpan; notifikasi gagal tidak
         boleh membuat reviewer mengira keputusannya batal. */
    }
  };

  const putuskan = async (t: TvTask, keputusan: 'APPROVED' | 'REVISION', catatan?: string) => {
    const kunci = `${t.instance_id}-${t.execution_point_id}`;
    setAksiJalan(kunci);
    const { error } = await supabase.rpc('fs_review_tv', {
      p_instance_id: t.instance_id,
      p_execution_point_id: t.execution_point_id,
      p_decision: keputusan,
      p_notes: catatan ?? null,
    });
    setAksiJalan(null);
    if (error) { beritahu('gagal', error.message); return; }
    if (keputusan === 'REVISION' && catatan) void kabariPicRevisi(t, catatan);
    beritahu('ok', keputusan === 'APPROVED'
      ? `${t.tv_name} disetujui.`
      : `${t.tv_name} dikembalikan untuk diulang — PIC ${t.pic_name ?? ''} dikabari.`);
    setMintaRevisi(null); setAlasanRevisi('');
    void muatTv(); void muatRingkasan();
  };

  const setujuiSeGedung = (b: BuildingProgress) => {
    const belum = b.completed_tv - b.verified_tv;
    setKonfirmasi({
      message: `Setujui ${belum} TV di ${b.location_name}?`,
      description: 'Hanya TV yang sudah selesai dikerjakan yang disetujui. TV yang gagal atau belum dikerjakan tidak ikut — itu tetap perlu Anda periksa satu per satu.',
      confirmLabel: 'Setujui Semua',
      onConfirm: async () => {
        setAksiJalan(b.location_id);
        const { data, error } = await supabase.rpc('fs_review_building', {
          p_cycle_id: cycleId, p_location_id: b.location_id,
        });
        setAksiJalan(null);
        if (error) { beritahu('gagal', error.message); return; }
        const jml = (data as { approved: number } | null)?.approved ?? 0;
        beritahu('ok', `${jml} TV di ${b.location_name} disetujui.`);
        void muatRingkasan(); void muatTv();
      },
    });
  };

  // Reviewer yang punya ratusan/ribuan TV tidak realistis diminta klik satu
  // per satu (keluhan user langsung). Tombol ini memanggil fs_review_building
  // per gedung SECARA BERURUTAN - RPC yang sama persis dengan "Setujui N" per
  // baris, jadi jaminan keamanannya juga sama: TV gagal/revisi/belum
  // dikerjakan TIDAK PERNAH ikut ter-approve, di kondisi apa pun. Manual
  // satu-satu (tombol per baris & per TV) tetap ada berdampingan - ini murni
  // pintasan, bukan pengganti.
  const setujuiSemuaGedung = () => {
    const target = buildings.filter(b => b.completed_tv - b.verified_tv > 0);
    const totalBelum = target.reduce((sum, b) => sum + (b.completed_tv - b.verified_tv), 0);
    if (target.length === 0) return;
    setKonfirmasi({
      message: `Setujui ${totalBelum} TV di ${target.length} gedung sekaligus?`,
      description: 'Hanya TV yang sudah selesai dikerjakan yang ikut disetujui, di semua gedung sekaligus. TV yang gagal, perlu revisi, atau belum dikerjakan TIDAK ikut — itu tetap perlu diperiksa satu per satu.',
      confirmLabel: `Setujui Semua (${totalBelum})`,
      onConfirm: async () => {
        setAksiJalan('__SEMUA__');
        let totalDisetujui = 0;
        const gagalDi: string[] = [];
        for (const b of target) {
          const { data, error } = await supabase.rpc('fs_review_building', {
            p_cycle_id: cycleId, p_location_id: b.location_id,
          });
          if (error) { gagalDi.push(b.location_name); continue; }
          totalDisetujui += (data as { approved: number } | null)?.approved ?? 0;
        }
        setAksiJalan(null);
        if (gagalDi.length > 0) {
          beritahu('gagal', `${totalDisetujui} TV disetujui, tapi gagal di: ${gagalDi.join(', ')}.`);
        } else {
          beritahu('ok', `${totalDisetujui} TV di ${target.length} gedung disetujui.`);
        }
        void muatRingkasan(); void muatTv();
      },
    });
  };

  const cycle = cycles.find(c => c.id === cycleId) ?? null;

  if (memuat && !overview) {
    return <p className="text-sm text-slate-400 text-center py-10">Memuat…</p>;
  }

  if (!cycle) {
    return (
      <Kartu>
        <Kosong judul="Belum ada yang perlu direview"
          teks="Belum ada siklus deployment yang dikirim untuk periode ini." />
      </Kartu>
    );
  }

  const st = CYCLE_STATUS_LABEL[cycle.status];
  const pct = overview ? persen(overview.completed_tv, overview.total_tv) : 0;
  const menunggu = overview ? Math.max(0, overview.completed_tv - overview.verified_tv) : 0;
  const qGedung = cariGedung.trim().toLowerCase();
  const gedungTampil = qGedung
    ? buildings.filter(b => b.location_name.toLowerCase().includes(qGedung) || b.area_name.toLowerCase().includes(qGedung))
    : buildings;

  return (
    <div className="space-y-3">
      <ConfirmDialog state={konfirmasi} onCancel={() => setKonfirmasi(null)} />

      {!bolehReview && (
        <div className="rounded-lg px-3.5 py-2.5 text-[13px] font-semibold border"
          style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          Akun Anda bisa melihat hasil deployment, tapi tidak berhak memberi keputusan Setujui/Minta Revisi.
        </div>
      )}

      {/* Kepala: siklus mana, seberapa jauh */}
      <Kartu>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <CalendarDays size={12} aria-hidden="true" /> Siklus yang Direview
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[17px] font-bold text-slate-900 tracking-tight">{cycle.name}</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ color: st.color, background: st.bg }}>{st.label}</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Dikerjakan {rentangTanggal(cycle.execution_start, cycle.execution_end)}
              {cycle.review_start && cycle.review_end && ` · Masa review ${rentangTanggal(cycle.review_start, cycle.review_end)}`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {bolehReview && menunggu > 0 && (
              <button type="button" disabled={aksiJalan === '__SEMUA__'} onClick={setujuiSemuaGedung}
                className="text-[12px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 whitespace-nowrap cursor-pointer"
                style={{ background: C.verified }}>
                {aksiJalan === '__SEMUA__' ? 'Menyetujui…' : `Setujui Semua (${menunggu})`}
              </button>
            )}
            {cycles.length > 1 && (
              <div className="w-60">
                <SearchableSelect value={cycleId} onChange={setCycleId} placeholder="Cari siklus…"
                  options={cycles.map(c => ({ value: c.id, label: `${c.name} — ${CYCLE_STATUS_LABEL[c.status].label}` }))} />
              </div>
            )}
          </div>
        </div>
      </Kartu>

      {overview && (
        <>
          {/* Ubin KPI - satu bentuk dengan Dashboard, bukan angka polos. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <UbinKpi ikon={ShieldCheck} label="Sudah disetujui" nilai={overview.verified_tv} warna={C.verified} />
            <UbinKpi ikon={Clock} label="Menunggu keputusan Anda" nilai={menunggu} warna="#B45309" />
            <UbinKpi ikon={XCircle} label="Gagal di lapangan" nilai={overview.failed_tv} warna={C.gagal} />
            <UbinKpi ikon={RotateCcw} label="Diminta diulang" nilai={overview.revision_tv} warna={C.revisi} />
          </div>

          {/* Tiga sudut pandang berdampingan, bukan dibatasi dua kolom
              kiri-kanan: seberapa JAUH progresnya, APA komposisi hasilnya,
              dan wilayah MANA yang paling butuh perhatian reviewer duluan. */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,280px)_minmax(0,280px)_minmax(0,1fr)] gap-3 items-stretch">
            <Kartu>
              <JudulPanel ikon={ShieldCheck} judul="Progres Keseluruhan" ket="Persentase TV yang benar-benar terpasang" />
              <p className="text-[28px] font-bold tabular-nums leading-none" style={{ color: warnaProgress(pct) }}>
                {pct}%
              </p>
              <p className="text-[12px] text-slate-500 mt-1.5 tabular-nums mb-2.5">
                {overview.completed_tv.toLocaleString('id-ID')} dari {overview.total_tv.toLocaleString('id-ID')} TV terpasang
              </p>
              <Bar2 pct={pct} tinggi={10} />
            </Kartu>
            <Kartu>
              <JudulPanel ikon={CheckCircle2} judul="Komposisi Hasil" />
              <DonutLegenda ukuran={80} labelPusat="Total TV"
                data={[
                  { label: 'Disetujui', value: overview.verified_tv, color: C.verified },
                  { label: 'Menunggu keputusan', value: menunggu, color: '#B45309' },
                  { label: 'Gagal di lapangan', value: overview.failed_tv, color: C.gagal },
                  { label: 'Diminta diulang', value: overview.revision_tv, color: C.revisi },
                  { label: 'Belum dikerjakan', value: overview.pending_tv, color: C.belum },
                ]} />
            </Kartu>
            <Kartu>
              <JudulPanel ikon={CalendarDays} judul="Wilayah Perlu Perhatian"
                ket="Diurutkan dari progres paling rendah — klik untuk langsung memeriksa gedungnya." />
              {(() => {
                const peta = new Map<string, { tv: number; selesai: number; masalah: number }>();
                for (const b of buildings) {
                  const cur = peta.get(b.area_name) ?? { tv: 0, selesai: 0, masalah: 0 };
                  cur.tv += b.total_tv; cur.selesai += b.completed_tv; cur.masalah += b.failed_tv + b.revision_tv;
                  peta.set(b.area_name, cur);
                }
                const baris = Array.from(peta.entries())
                  .map(([nama, v]) => ({ nama, ...v, pct: v.tv > 0 ? Math.round((v.selesai / v.tv) * 100) : 0 }))
                  .sort((a, b) => a.pct - b.pct);
                if (baris.length === 0) return <p className="text-xs text-slate-400 text-center py-6">Belum ada data wilayah.</p>;
                // Nama wilayah DIBATASI (bukan Progres) - kolom tanpa `lebar`
                // yang mendapat sisa ruang. Sebelumnya "Wilayah" yang tak
                // dibatasi jadi ~44% dari kartu selebar 1fr, padahal nama
                // gedung pendek - sisanya jadi celah kosong lebar sebelum
                // batang progres mulai (keluhan user via screenshot).
                // Sekarang batang progres yang melar mengisi ruang itu -
                // sekalian jadi gauge yang lebih presisi.
                return (
                  <TabelRingkas
                    kolom={[{ judul: 'Wilayah', lebar: '140px' }, { judul: 'Progres' }, { judul: 'Masalah', kanan: true, lebar: '64px' }]}
                    baris={baris}
                    onKlikBaris={b => setCariGedung(b.nama)}
                    kunci={b => ({
                      id: b.nama,
                      sel: [
                        <span key="n" className="font-semibold text-slate-700 truncate block max-w-[150px]">{b.nama}</span>,
                        <span key="b" className="flex items-center gap-1.5">
                          <span className="flex-1 block h-2 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                            <span className="block h-full rounded-full" style={{ width: `${b.pct}%`, background: warnaProgress(b.pct) }} />
                          </span>
                          <span className="text-[10px] font-bold tabular-nums" style={{ color: warnaProgress(b.pct) }}>{b.pct}%</span>
                        </span>,
                        <span key="m" className="tabular-nums font-bold" style={{ color: b.masalah > 0 ? '#DC2626' : '#cbd5e1' }}>{b.masalah}</span>,
                      ],
                    })} />
                );
              })()}
            </Kartu>
          </div>
        </>
      )}

      {/* Daftar gedung -> TV */}
      {!gedungAktif ? (
        <Kartu padat>
          <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-start justify-between gap-3 flex-wrap">
            <JudulPanel ikon={CheckCircle2} judul="Hasil per Gedung"
              ket="Gedung yang paling bermasalah ditampilkan lebih dulu. Klik untuk memeriksa TV-nya." />
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input value={cariGedung} onChange={e => setCariGedung(e.target.value)}
                placeholder="Cari gedung / wilayah…" autoComplete="off" aria-label="Cari gedung"
                className="text-[12px] border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 w-48 focus:outline-none focus:border-blue-400" />
            </div>
          </div>
          <div className="divide-y divide-slate-50 max-h-[520px] overflow-y-auto">
            {gedungTampil.length === 0 && (
              <Kosong judul="Tidak ada gedung yang cocok" teks="Coba kata kunci lain." />
            )}
            {gedungTampil.map(b => {
              const belumSetuju = b.completed_tv - b.verified_tv;
              return (
                <BarisDrill key={b.location_id}
                  judul={b.location_name}
                  sub={`${b.area_name} · ${b.completed_tv}/${b.total_tv} TV terpasang`}
                  pct={b.pct ?? 0}
                  onClick={() => setGedungAktif(b)}
                  kanan={
                    <div className="flex items-center gap-2">
                      {/* belum={0} tetap SALAH sebelumnya - gedung yang TV-nya belum
                          disentuh sama sekali (bukan gagal/revisi) ikut tertulis
                          "Tuntas" hijau, padahal 0 TV terpasang. Ditemukan lewat
                          pemeriksaan visual: Bandung Center 0/3 TV tapi berlabel
                          Tuntas. */}
                      <LencanaMasalah gagal={b.failed_tv} revisi={b.revision_tv} belum={b.pending_tv} />
                      {bolehReview && belumSetuju > 0 && (
                        <button type="button" disabled={aksiJalan === b.location_id}
                          onClick={e => { e.stopPropagation(); setujuiSeGedung(b); }}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg text-white disabled:opacity-50 whitespace-nowrap cursor-pointer"
                          style={{ background: C.verified }}>
                          {aksiJalan === b.location_id ? '…' : `Setujui ${belumSetuju}`}
                        </button>
                      )}
                    </div>
                  }
                />
              );
            })}
          </div>
        </Kartu>
      ) : (
        <Kartu padat>
          <HeaderDrill
            jejak={[
              { label: 'Kembali ke Semua Gedung', onClick: () => setGedungAktif(null) },
              { label: gedungAktif.location_name },
            ]}
            aksi={
              <select value={saring} onChange={e => setSaring(e.target.value)}
                aria-label="Saring TV"
                className="text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white">
                <option value="">Semua TV</option>
                <option value="PROBLEM">Hanya yang bermasalah</option>
                <option value="COMPLETED">Sudah terpasang</option>
                <option value="VERIFIED">Sudah saya setujui</option>
                <option value="FAILED">Gagal</option>
                <option value="PENDING">Belum dikerjakan</option>
              </select>
            } />

          {memuatTv ? (
            <p className="text-sm text-slate-400 text-center py-10">Memuat…</p>
          ) : tvs.length === 0 ? (
            <Kosong judul="Tidak ada TV di sini" teks="Tidak ada TV yang cocok dengan pilihan ini." />
          ) : (
            <div className="divide-y divide-slate-50">
              {tvs.map(t => {
                const kunci = `${t.instance_id}-${t.execution_point_id}`;
                const efektif = t.review_status === 'REVISION' ? 'REVISION_REQUIRED' : t.tv_status;
                const s = TV_STATUS_LABEL[efektif] ?? { label: efektif, color: '#475569', bg: '#f1f5f9' };
                const disetujui = t.review_status === 'APPROVED';
                return (
                  <div key={kunci} className="px-3.5 py-3">
                    <div className="flex items-start gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-800 text-[13px]">{t.tv_name}</span>
                          {t.tv_floor && <span className="text-[11px] text-slate-400">{t.tv_floor}</span>}
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ color: s.color, background: s.bg }}>{s.label}</span>
                          {disetujui && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1"
                              style={{ color: '#047857', background: '#D1FAE5' }}>
                              <CheckCircle2 size={10} aria-hidden="true" /> Disetujui
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          PIC {t.pic_name ?? '—'}
                          {t.marked_at && ` · ${new Date(t.marked_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                        </p>
                        {t.failure_reason && (
                          <p className="text-[11px] mt-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: '#FEE2E2', color: '#991B1B' }}>
                            {FAILURE_REASON_LABEL[t.failure_reason] ?? t.failure_reason}
                            {t.failure_detail ? ` — ${t.failure_detail}` : ''}
                          </p>
                        )}
                        {t.review_notes && (
                          <p className="text-[11px] mt-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: '#FFEDD5', color: '#7C2D12' }}>
                            Permintaan revisi Anda: {t.review_notes}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {t.evidence_count > 0 && (
                          <button type="button" onClick={() => void bukaFoto(t)}
                            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap cursor-pointer flex items-center gap-1.5">
                            <ImageIcon size={12} aria-hidden="true" />
                            {foto[kunci] ? 'Tutup foto' : `${t.evidence_count} foto`}
                          </button>
                        )}
                        {bolehReview && t.tv_status === 'COMPLETED' && !disetujui && (
                          <button type="button" disabled={aksiJalan === kunci}
                            onClick={() => void putuskan(t, 'APPROVED')}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 cursor-pointer"
                            style={{ background: C.verified }}>
                            {aksiJalan === kunci ? '…' : 'Setujui'}
                          </button>
                        )}
                        {bolehReview && t.review_status !== 'REVISION' && (
                          <button type="button"
                            onClick={() => { setMintaRevisi(t); setAlasanRevisi(''); }}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer"
                            style={{ borderColor: '#FDBA74', color: '#C2410C', background: '#FFF7ED' }}>
                            Minta Diulang
                          </button>
                        )}
                      </div>
                    </div>

                    {foto[kunci] && (
                      <div className="flex gap-2 flex-wrap mt-3">
                        {foto[kunci].length === 0 && <p className="text-xs text-slate-400">Foto tidak bisa dimuat.</p>}
                        {foto[kunci].map((f, i) => f.thumbUrl && (
                          <button key={i} type="button" onClick={() => void bukaFotoPenuh(f)}
                            aria-label="Lihat foto ukuran penuh" className="cursor-zoom-in">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={f.thumbUrl} alt={`Bukti ${t.tv_name}`}
                              className="w-28 h-28 object-cover rounded-lg border border-slate-200" />
                          </button>
                        ))}
                      </div>
                    )}

                    {mintaRevisi && `${mintaRevisi.instance_id}-${mintaRevisi.execution_point_id}` === kunci && (
                      <div className="mt-3 rounded-xl p-3" style={{ background: '#FFF7ED', border: '1px solid #FDBA74' }}>
                        <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#C2410C' }}>
                          Apa yang perlu diperbaiki?
                        </label>
                        <textarea value={alasanRevisi} onChange={e => setAlasanRevisi(e.target.value)} rows={2}
                          placeholder="Contoh: konten yang terpasang masih versi minggu lalu."
                          className="w-full border border-orange-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white" />
                        <div className="flex gap-2 justify-end mt-2">
                          <button type="button" onClick={() => { setMintaRevisi(null); setAlasanRevisi(''); }}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 cursor-pointer">
                            Batal
                          </button>
                          <button type="button" disabled={!alasanRevisi.trim() || aksiJalan === kunci}
                            onClick={() => void putuskan(t, 'REVISION', alasanRevisi.trim())}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 cursor-pointer"
                            style={{ background: '#C2410C' }}>
                            {aksiJalan === kunci ? 'Mengirim…' : 'Kirim Permintaan Revisi'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Kartu>
      )}
    </div>
  );
}
