'use client';

/**
 * KelolaSiklus.tsx - pusat kendali siklus weekend: buat siklus berikutnya,
 * tugaskan PIC, pantau siklus berjalan, dan telusuri riwayat deployment.
 *
 * TATA LETAK DESKTOP-DULU. Versi pertama menumpuk empat panel penuh-lebar
 * (form buat siklus, form assign PIC, siklus berjalan, riwayat) sehingga di
 * layar laptop pengguna harus menggulir jauh sebelum sampai ke informasi -
 * dilaporkan user: "terkesan masih seperti mobile device". Sekarang:
 *   - dua FORM pindah ke modal (dipanggil dari tombol aksi di kepala
 *     halaman), karena keduanya dipakai sesekali, bukan dibaca terus-menerus;
 *   - yang tinggal di halaman hanyalah yang memang untuk DIBACA: ringkasan
 *     angka, siklus berjalan, dan riwayat - berdampingan dalam dua kolom,
 *     masing-masing menggulir di dalam panelnya sendiri.
 *
 * Riwayat memakai fs_cycle_summaries - ringkasan yang DIBEKUKAN saat siklus
 * ditutup. Itu sebabnya siklus yang fotonya sudah dihapus tetap bisa
 * menunjukkan hasilnya.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays, CheckCircle2, Building2, AlertTriangle, History,
  Map as MapIcon, Users, Search, Repeat,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  Modal, TombolModal, SearchableSelect, ConfirmDialog, type ConfirmState,
  KartuOperasional as Kartu, JudulPanel, UbinKpi, KosongOperasional as Kosong,
} from '@/components/shared';
import { AssignPicWilayah } from './AssignPicWilayah';
import { PetaOperasional } from '@/app/dashboard/_components/widgets/PetaOperasional';
import {
  ambilCycles, ambilOverview, ambilBuildingProgress, buatScopePekerjaan, pindahStatusCycle,
  mintaPembersihan, setujuiPembersihan, hitungEvidence,
  CYCLE_STATUS_LABEL, persen, warnaProgress, rentangTanggal,
  type Cycle, type CycleOverview, type BuildingProgress,
} from '@/lib/fs-cycle';
import { HARI_PILIHAN, JADWAL_KOSONG, labelHari, type JadwalSiklus } from '@/lib/fs-jadwal';

interface RingkasanBeku {
  cycle_id: string; total_tv: number; completed_tv: number; failed_tv: number;
  revision_tv: number; verified_tv: number; closed_by_name: string | null;
  cleared_by_name: string | null; cleared_at: string | null;
  objects_deleted: number | null; objects_failed: number | null;
}

/** Sabtu-Minggu terdekat SETELAH hari ini - nilai awal form, karena itulah
 *  yang hampir selalu ingin dibuat admin pada hari kerja. */
function akhirPekanBerikutnya(): { mulai: string; selesai: string } {
  const d = new Date();
  const majuKeSabtu = (6 - d.getDay() + 7) % 7 || 7;
  const sabtu = new Date(d.getFullYear(), d.getMonth(), d.getDate() + majuKeSabtu);
  const minggu = new Date(sabtu); minggu.setDate(sabtu.getDate() + 1);
  const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { mulai: f(sabtu), selesai: f(minggu) };
}

function tambahHari(tanggal: string, n: number): string {
  const d = new Date(tanggal + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function KelolaSiklus({ projectId, bolehKelola, bolehProvider, beritahu }: {
  projectId: string;
  /** Admin PENUH saja (fs_is_provider_admin) - membuat siklus baru, menutup
   *  siklus, dan meminta/menyetujui pembersihan data. */
  bolehKelola: boolean;
  /** Admin ATAU Supervisor (fs_is_provider) - mengaktifkan siklus, membuat
   *  daftar pekerjaan, mengirim ke review, dan menugaskan PIC. Sebelumnya
   *  semua tombol ini ikut dikunci ke bolehKelola (admin-only), diam-diam
   *  menyembunyikan aksi yang sebenarnya DIIZINKAN Supervisor di database
   *  (fs_generate_cycle_scope/fs_cycle_transition sama-sama memakai
   *  fs_is_provider(), bukan fs_is_provider_admin()). */
  bolehProvider: boolean;
  beritahu: (tipe: 'ok' | 'gagal', teks: string) => void;
}) {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [ringkasan, setRingkasan] = useState<Record<string, RingkasanBeku>>({});
  const [aktifOverview, setAktifOverview] = useState<Record<string, CycleOverview>>({});
  const [jadwal, setJadwal] = useState<JadwalSiklus | null>(null);
  const [modalJadwal, setModalJadwal] = useState(false);
  const [drafJadwal, setDrafJadwal] = useState<JadwalSiklus>(JADWAL_KOSONG);
  const [simpanJadwalJalan, setSimpanJadwalJalan] = useState(false);
  const [memuat, setMemuat] = useState(true);
  const [aksiJalan, setAksiJalan] = useState<string | null>(null);
  const [cariRiwayat, setCariRiwayat] = useState('');
  const [petaGedung, setPetaGedung] = useState<BuildingProgress[] | null>(null);
  const [konfirmasi, setKonfirmasi] = useState<ConfirmState | null>(null);

  const awal = akhirPekanBerikutnya();
  const [form, setForm] = useState({
    mulai: awal.mulai, selesai: awal.selesai,
    reviewMulai: tambahHari(awal.selesai, 1), reviewSelesai: tambahHari(awal.selesai, 14),
    nama: '',
  });
  const [menyimpan, setMenyimpan] = useState(false);
  const [modalSiklus, setModalSiklus] = useState(false);
  const [modalAssign, setModalAssign] = useState(false);

  const muat = useCallback(async () => {
    if (!projectId) { setMemuat(false); return; }
    setMemuat(true);
    try {
      const daftar: Cycle[] = await ambilCycles(projectId);
      const [{ data: sum }, jadwalRes] = await Promise.all([
        supabase.from('fs_cycle_summaries')
          .select('cycle_id, total_tv, completed_tv, failed_tv, revision_tv, verified_tv, closed_by_name, cleared_by_name, cleared_at, objects_deleted, objects_failed'),
        fetch(`/api/cycles/jadwal?projectId=${encodeURIComponent(projectId)}`, { credentials: 'include' })
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      setCycles(daftar);
      const peta: Record<string, RingkasanBeku> = {};
      for (const r of (sum ?? []) as RingkasanBeku[]) peta[r.cycle_id] = r;
      setRingkasan(peta);
      setJadwal((jadwalRes?.jadwal as JadwalSiklus | undefined) ?? { ...JADWAL_KOSONG });

      // Siklus yang masih berjalan belum punya ringkasan beku - angkanya
      // dihitung langsung supaya daftarnya tidak menampilkan "0 TV".
      const berjalan = daftar.filter(c => !peta[c.id]);
      const hasil = await Promise.all(berjalan.map(async c => [c.id, await ambilOverview(c.id)] as const));
      setAktifOverview(Object.fromEntries(hasil));
    } catch (e) {
      beritahu('gagal', e instanceof Error ? e.message : 'Gagal memuat daftar siklus.');
    } finally { setMemuat(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => { void muat(); }, [muat]);

  // Gedung untuk peta - hanya siklus yang sedang berjalan; peta ini alat
  // pantau hari ini, bukan arsip.
  useEffect(() => {
    const aktif = cycles.find(c => !['CLOSED', 'CLEARED', 'CLEAR_PARTIAL', 'CLEAR_PENDING'].includes(c.status));
    if (!aktif) { setPetaGedung(null); return; }
    let batal = false;
    (async () => {
      try {
        const data = await ambilBuildingProgress(aktif.id);
        if (!batal) setPetaGedung(data);
      } catch { /* diam - panel peta menampilkan keadaan kosongnya sendiri */ }
    })();
    return () => { batal = true; };
  }, [cycles]);

  const ubahTanggal = (mulai: string, selesai: string) => {
    setForm(f => ({
      ...f, mulai, selesai,
      reviewMulai: tambahHari(selesai, 1),
      reviewSelesai: tambahHari(selesai, 14),
    }));
  };

  const bukaModalJadwal = () => {
    setDrafJadwal(jadwal ?? { ...JADWAL_KOSONG });
    setModalJadwal(true);
  };

  const simpanJadwal = async () => {
    setSimpanJadwalJalan(true);
    try {
      const res = await fetch('/api/cycles/jadwal', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, jadwal: drafJadwal }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { beritahu('gagal', data?.error ?? 'Gagal menyimpan jadwal.'); return; }
      setJadwal(data.jadwal as JadwalSiklus);
      setModalJadwal(false);
      const h = data.hasil as { status: string; nama?: string; instanceBaru?: number; pesan?: string } | undefined;
      if (drafJadwal.hari.length === 0) beritahu('ok', 'Jadwal otomatis dimatikan. Siklus hanya dibuat manual.');
      else if (h?.status === 'dibuat') beritahu('ok', `Jadwal tersimpan. Siklus "${h.nama}" langsung dibuat dengan ${h.instanceBaru ?? 0} pekerjaan.`);
      else if (h?.status === 'gagal') beritahu('gagal', `Jadwal tersimpan, tapi siklus minggu ini gagal dibuat: ${h.pesan ?? ''}`);
      else beritahu('ok', 'Jadwal tersimpan. Siklus berikutnya dibuat otomatis setiap minggu.');
      void muat();
    } finally { setSimpanJadwalJalan(false); }
  };

  const simpan = async () => {
    if (!form.mulai || !form.selesai) { beritahu('gagal', 'Tanggal pengerjaan wajib diisi.'); return; }
    if (form.selesai < form.mulai) { beritahu('gagal', 'Tanggal selesai tidak boleh sebelum tanggal mulai.'); return; }
    setMenyimpan(true);
    // Tanpa konten: siklus dinamai menurut rentang tanggalnya.
    const nama = form.nama.trim() || `Siklus ${rentangTanggal(form.mulai, form.selesai)}`;
    const { error } = await supabase.from('fs_cycles').insert({
      project_id: projectId, name: nama,
      content_id: null,
      execution_start: form.mulai, execution_end: form.selesai,
      review_start: form.reviewMulai || null, review_end: form.reviewSelesai || null,
      status: 'PLANNED',
    });
    setMenyimpan(false);
    if (error) { beritahu('gagal', 'Gagal membuat siklus: ' + error.message); return; }
    beritahu('ok', `Siklus "${nama}" dibuat. Langkah berikutnya: tugaskan PIC, lalu buat daftar pekerjaannya.`);
    setModalSiklus(false);
    setForm(f => ({ ...f, nama: '' }));
    void muat();
  };

  const jalankan = async (id: string, fn: () => Promise<void>) => {
    setAksiJalan(id);
    try { await fn(); await muat(); }
    catch (e) { beritahu('gagal', e instanceof Error ? e.message : 'Aksi gagal.'); }
    finally { setAksiJalan(null); }
  };

  const berjalan = cycles.filter(c => !['CLOSED', 'CLEARED', 'CLEAR_PARTIAL', 'CLEAR_PENDING'].includes(c.status));
  const riwayat = cycles.filter(c => ['CLOSED', 'CLEARED', 'CLEAR_PARTIAL', 'CLEAR_PENDING'].includes(c.status));
  const qRiwayat = cariRiwayat.trim().toLowerCase();
  const riwayatTampil = qRiwayat ? riwayat.filter(c => c.name.toLowerCase().includes(qRiwayat)) : riwayat;

  // Angka ringkasan diambil dari siklus yang sedang berjalan - itulah yang
  // sedang dikerjakan hari ini; riwayat punya kolomnya sendiri di bawah.
  const utama = berjalan[0] ? aktifOverview[berjalan[0].id] : undefined;

  if (memuat) return <p className="text-sm text-slate-400 text-center py-10">Memuat siklus…</p>;

  return (
    <div className="space-y-4">
      {/* Kepala halaman: aksi utama di kanan atas, bukan form yang selalu
          terbuka memakan setengah layar. */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-black text-slate-900">Siklus Mingguan</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Siklus dibuat otomatis tiap minggu di hari yang dipilih Admin. Pantau siapa bertugas, kapan, dan evidence-nya.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {bolehProvider && (
            <button type="button" onClick={() => setModalAssign(true)}
              className="text-[12px] font-bold px-3 py-2 rounded-kontrol border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap">
              Tugaskan PIC ke Wilayah
            </button>
          )}
          {bolehKelola && (
            <button type="button" onClick={() => setModalSiklus(true)}
              className="text-[12px] font-bold px-3 py-2 rounded-kontrol border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap">
              + Siklus Manual
            </button>
          )}
          {bolehKelola && (
            <button type="button" onClick={bukaModalJadwal}
              className="text-[12px] font-bold px-3 py-2 rounded-kontrol bg-aksen-700 hover:bg-aksen-800 text-white whitespace-nowrap transition-colors">
              Atur Jadwal Otomatis
            </button>
          )}
        </div>
      </div>

      {/* Pita jadwal otomatis - jawaban atas "minggu ini jalan otomatis
          atau belum?" tanpa harus membuka pengaturan. */}
      {jadwal && (jadwal.hari.length === 0 ? (
        <div className="rounded-kartu border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 flex-wrap">
          <Repeat size={16} className="text-amber-700 flex-shrink-0" aria-hidden="true" />
          <p className="flex-1 min-w-[200px] text-[12px] text-amber-900 leading-snug">
            <span className="font-bold">Jadwal otomatis belum diatur.</span>{' '}
            Pilih hari pengerjaan sekali saja — setelah itu siklus dan daftar pekerjaan PIC dibuat otomatis setiap minggu.
          </p>
          {bolehKelola && (
            <button type="button" onClick={bukaModalJadwal}
              className="text-[12px] font-bold px-3 py-1.5 rounded-kontrol bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 whitespace-nowrap">
              Pilih Hari
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-kartu border border-aksen-100 bg-aksen-50 px-4 py-3 flex items-center gap-3 flex-wrap">
          <Repeat size={16} className="text-aksen-700 flex-shrink-0" aria-hidden="true" />
          <p className="flex-1 min-w-[200px] text-[12px] text-aksen-900 leading-snug">
            <span className="font-bold">Otomatis setiap {labelHari(jadwal.hari)}.</span>{' '}
            Review client {jadwal.reviewHari} hari · {jadwal.aktifkanOtomatis ? 'langsung aktif untuk PIC' : 'dibuat sebagai Direncanakan'}.
          </p>
          {bolehKelola && (
            <button type="button" onClick={bukaModalJadwal}
              className="text-[12px] font-bold px-3 py-1.5 rounded-kontrol bg-white border border-aksen-200 text-aksen-800 hover:bg-aksen-100 whitespace-nowrap">
              Ubah
            </button>
          )}
        </div>
      ))}

      {/* Ringkasan - ubin KPI berikon, satu bentuk dengan Dashboard. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <UbinKpi ikon={CalendarDays} label="Siklus Berjalan" nilai={berjalan.length} warna="#1d4ed8" sub={berjalan[0]?.name ?? 'Belum ada'} />
        <UbinKpi ikon={CheckCircle2} label="TV Siklus Ini" nilai={utama?.total_tv ?? 0} warna="#2a78d6" sub={`${utama?.completed_tv ?? 0} selesai`} />
        <UbinKpi ikon={Building2} label="Gedung" nilai={utama?.building_total ?? 0} warna="#0d9488" sub={`${utama?.building_complete ?? 0} tuntas`} />
        <UbinKpi ikon={AlertTriangle} label="Perlu Perhatian" nilai={(utama?.failed_tv ?? 0) + (utama?.revision_tv ?? 0) + (utama?.pending_tv ?? 0)} warna="#b45309" sub="Gagal + ulang + belum" />
        <UbinKpi ikon={History} label="Riwayat" nilai={riwayat.length} warna="#7c3aed" sub="Siklus ditutup" />
      </div>

      {/* Full-lebar, ditumpuk - BUKAN dua kolom berdampingan lagi. Versi
          berdampingan membuat peta terjepit sempit begitu lebar layar efektif
          menyusut sedikit saja (zoom browser 100-125%, laptop 13"), padahal
          peta justru butuh lebar untuk berguna - keluhan eksplisit user lewat
          screenshot perbandingan. */}
      <div className="grid grid-cols-1 gap-4">
        <Kartu padat>
          <div className="p-3.5 border-b border-slate-100">
            <JudulPanel ikon={CalendarDays} judul="Siklus Berjalan"
              ket="Siklus yang belum ditutup. Setiap langkah punya satu tombol lanjutan." />
          </div>
          {berjalan.length === 0 ? (
            <Kosong judul="Tidak ada siklus berjalan"
              teks={jadwal && jadwal.hari.length > 0
                ? `Siklus berikutnya dibuat otomatis untuk ${labelHari(jadwal.hari)} minggu depan.`
                : 'Atur jadwal otomatis, atau buat siklus manual, lalu tugaskan PIC-nya.'} />
          ) : (
            <div className="divide-y divide-slate-50 max-h-[420px] overflow-y-auto">
              {berjalan.map(c => {
                const ov = aktifOverview[c.id];
                const st = CYCLE_STATUS_LABEL[c.status];
                const pct = ov ? persen(ov.completed_tv, ov.total_tv) : 0;
                return (
                  <div key={c.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-800 text-sm">{c.name}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ color: st.color, background: st.bg }}>{st.label}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Pengerjaan {rentangTanggal(c.execution_start, c.execution_end)}
                          {c.review_start && c.review_end && ` · Review ${rentangTanggal(c.review_start, c.review_end)}`}
                        </p>
                        {ov && ov.total_tv > 0 && (
                          <>
                            <p className="text-xs mt-1.5">
                              <span className="font-bold" style={{ color: warnaProgress(pct) }}>{ov.completed_tv}/{ov.total_tv} TV</span>
                              <span className="text-slate-400"> · {pct}% selesai · {ov.building_total} gedung</span>
                            </p>
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-1.5 max-w-xs">
                              <div className="h-full rounded-full"
                                style={{ width: `${pct}%`, background: warnaProgress(pct) }} />
                            </div>
                          </>
                        )}
                        {ov && ov.total_tv === 0 && (
                          <p className="text-xs text-amber-700 mt-1.5 font-semibold">
                            Belum ada daftar pekerjaan — buat dulu agar PIC bisa mulai.
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col items-stretch gap-1.5 flex-shrink-0">
                        {/* Buat/Perbarui Daftar Pekerjaan & Aktifkan: DB (fs_generate_cycle_scope,
                            fs_cycle_transition) sama-sama cukup fs_is_provider() - Admin ATAU
                            Supervisor, bukan admin-only seperti sebelumnya. */}
                        {bolehProvider && (c.status === 'PLANNED' || c.status === 'ACTIVE') && (
                          <button type="button" disabled={aksiJalan === c.id}
                            onClick={() => void jalankan(c.id, async () => {
                              const h = await buatScopePekerjaan(c.id);
                              beritahu('ok', `Daftar pekerjaan disiapkan: ${h.created} penugasan gedung baru${h.linked ? `, ${h.linked} disambungkan` : ''}.`);
                            })}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer">
                            {aksiJalan === c.id ? '…' : 'Buat/Perbarui Daftar Pekerjaan'}
                          </button>
                        )}
                        {bolehProvider && c.status === 'PLANNED' && (
                          <button type="button" disabled={aksiJalan === c.id}
                            onClick={() => void jalankan(c.id, async () => {
                              await pindahStatusCycle(c.id, 'ACTIVE');
                              beritahu('ok', 'Siklus diaktifkan — PIC sudah bisa mulai bekerja.');
                            })}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-kecil bg-aksen-700 hover:bg-aksen-800 text-white disabled:opacity-50 cursor-pointer whitespace-nowrap">
                            {aksiJalan === c.id ? '…' : 'Aktifkan'}
                          </button>
                        )}
                        {/* Sisa alur (Kirim Review -> Siap Ditutup -> Tutup) sebelumnya
                            HANYA ada di widget Dashboard - admin harus pindah menu di
                            tengah alur yang sama. Sekarang ada juga di sini. */}
                        {bolehProvider && c.status === 'ACTIVE' && (
                          <button type="button" disabled={aksiJalan === c.id}
                            onClick={() => setKonfirmasi({
                              message: `Kirim "${c.name}" ke client untuk direview?`,
                              description: `${ov?.pending_tv ?? 0} TV masih belum dikerjakan dan ${ov?.failed_tv ?? 0} TV gagal. Client akan melihat kondisi apa adanya.`,
                              confirmLabel: 'Kirim ke Review',
                              onConfirm: () => void jalankan(c.id, async () => {
                                await pindahStatusCycle(c.id, 'UNDER_REVIEW');
                                beritahu('ok', 'Siklus dikirim ke client untuk direview.');
                              }),
                            })}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 cursor-pointer whitespace-nowrap">
                            {aksiJalan === c.id ? '…' : 'Kirim ke Review Client'}
                          </button>
                        )}
                        {bolehKelola && c.status === 'UNDER_REVIEW' && (
                          <button type="button" disabled={aksiJalan === c.id}
                            onClick={() => void jalankan(c.id, async () => {
                              await pindahStatusCycle(c.id, 'READY_TO_CLOSE');
                              beritahu('ok', 'Siklus ditandai siap ditutup.');
                            })}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer whitespace-nowrap">
                            {aksiJalan === c.id ? '…' : 'Tandai Siap Ditutup'}
                          </button>
                        )}
                        {bolehKelola && c.status === 'READY_TO_CLOSE' && (
                          <button type="button" disabled={aksiJalan === c.id}
                            onClick={() => setKonfirmasi({
                              message: `Tutup siklus "${c.name}"?`,
                              description: 'Ringkasan hasil akan dibekukan sebagai riwayat permanen. Setelah ditutup, pekerjaan tidak bisa diubah lagi.',
                              confirmLabel: 'Tutup Siklus',
                              onConfirm: () => void jalankan(c.id, async () => {
                                await pindahStatusCycle(c.id, 'CLOSED');
                                beritahu('ok', 'Siklus ditutup. Ringkasannya tersimpan permanen di Riwayat.');
                              }),
                            })}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 cursor-pointer whitespace-nowrap"
                            style={{ background: '#047857' }}>
                            {aksiJalan === c.id ? '…' : 'Tutup Siklus'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Kartu>
      </div>

      {/* Peta FULL-LEBAR di bawah siklus berjalan, terbuka apa adanya - bukan
          panel terlipat di dasar halaman, dan bukan dijepit jadi 50% lebar
          seperti sebelumnya. Saat memantau akhir pekan, "gedung mana yang
          bermasalah" dan "di sebelah mana gedung itu" adalah satu pertanyaan
          yang sama, jadi peta perlu cukup besar untuk benar-benar terbaca. */}
      <div className="grid grid-cols-1 gap-4">
        <Kartu>
          <JudulPanel ikon={MapIcon} judul="Peta Sebaran Gedung"
            ket={petaGedung
              ? `${petaGedung.length} gedung pada siklus berjalan · warna menandakan keadaan pekerjaan`
              : 'Posisi gedung dan keadaan pekerjaannya di lapangan'} />
          {!berjalan[0] ? (
            <Kosong judul="Belum ada siklus berjalan"
              teks="Peta menampilkan gedung pada siklus yang sedang berjalan." />
          ) : !petaGedung ? (
            <p className="text-sm text-slate-400 text-center py-16">Memuat peta…</p>
          ) : petaGedung.length === 0 ? (
            <Kosong judul="Belum ada gedung pada siklus ini"
              teks="Buat daftar pekerjaan dulu agar gedungnya muncul di peta." />
          ) : (
            <div style={{ height: 440 }}>
              <PetaOperasional buildings={petaGedung} penuh
                onPilihGedung={() => { /* halaman ini tidak punya drill-down TV */ }} />
            </div>
          )}
        </Kartu>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Kartu padat>
          <div className="p-3.5 pb-0 flex items-start justify-between gap-3 flex-wrap">
            <JudulPanel ikon={History} judul="Riwayat Deployment"
              ket="Ringkasan dibekukan saat siklus ditutup — tetap tersimpan walaupun foto buktinya sudah dibersihkan." />
            {riwayat.length > 3 && (
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input value={cariRiwayat} onChange={e => setCariRiwayat(e.target.value)}
                  placeholder="Cari siklus…" autoComplete="off"
                  className="text-[12px] border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 w-40 focus:outline-none focus:border-blue-400" />
              </div>
            )}
          </div>
          {riwayatTampil.length === 0 ? (
            <Kosong judul={riwayat.length === 0 ? 'Belum ada siklus yang ditutup' : 'Tidak ada yang cocok'}
              teks={riwayat.length === 0
                ? 'Siklus yang sudah selesai direview dan ditutup akan muncul di sini.'
                : 'Coba kata kunci lain.'} />
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5">Siklus</th>
                    <th className="text-right px-3 py-2.5">TV</th>
                    <th className="text-right px-3 py-2.5">Hasil</th>
                    <th className="text-left px-3 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5">Pembersihan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {riwayatTampil.map(c => {
                    const r = ringkasan[c.id];
                    const st = CYCLE_STATUS_LABEL[c.status];
                    const pct = r ? persen(r.completed_tv, r.total_tv) : 0;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <p className="font-bold text-slate-800">{c.name}</p>
                          <p className="text-[11px] text-slate-400">{rentangTanggal(c.execution_start, c.execution_end)}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r?.total_tv ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right">
                          {r ? (
                            <>
                              <span className="font-bold tabular-nums" style={{ color: warnaProgress(pct) }}>{pct}%</span>
                              <span className="block text-[11px] text-slate-400">
                                {r.failed_tv > 0 ? `${r.failed_tv} gagal` : 'tanpa kegagalan'}
                              </span>
                            </>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{ color: st.color, background: st.bg }}>{st.label}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {c.cleared_at ? (
                            <>
                              {c.clear_objects_deleted ?? 0} file dihapus
                              {(c.clear_objects_failed ?? 0) > 0 && (
                                <span className="text-red-600 font-semibold"> · {c.clear_objects_failed} gagal</span>
                              )}
                              <span className="block text-[11px] text-slate-400">
                                oleh {r?.cleared_by_name ?? '—'} · {new Date(c.cleared_at).toLocaleDateString('id-ID')}
                              </span>
                            </>
                          ) : bolehKelola && c.status === 'CLOSED' ? (
                            // Sebelumnya tombol ini HANYA ada di widget Dashboard - di sini
                            // riwayat cuma menampilkan teks, admin harus pindah menu untuk
                            // benar-benar meminta pembersihan.
                            <button type="button" disabled={aksiJalan === c.id}
                              onClick={() => void jalankan(c.id, async () => {
                                const hasil = await mintaPembersihan(c.id);
                                beritahu('ok', `Permintaan pembersihan dibuat — ${hasil.evidence_objects} file foto menunggu persetujuan.`);
                              })}
                              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap">
                              {aksiJalan === c.id ? '…' : 'Minta Pembersihan'}
                            </button>
                          ) : bolehKelola && (c.status === 'CLEAR_PENDING' || c.status === 'CLEAR_PARTIAL') ? (
                            <button type="button" disabled={aksiJalan === c.id}
                              onClick={() => void (async () => {
                                const jumlah = await hitungEvidence(c.id);
                                setKonfirmasi({
                                  message: `Hapus ${jumlah} file foto dari storage?`,
                                  description: 'Foto bukti dan jejak GPS siklus ini akan dihapus permanen dan tidak bisa dikembalikan. Ringkasan hasil, keputusan review, dan catatan audit TETAP tersimpan.',
                                  confirmLabel: 'Hapus Permanen', danger: true,
                                  onConfirm: () => void jalankan(c.id, async () => {
                                    const hasil = await setujuiPembersihan(c.id);
                                    if (hasil.objects_failed > 0) {
                                      beritahu('gagal', `Sebagian gagal: ${hasil.objects_deleted} file terhapus, ${hasil.objects_failed} gagal. Status jadi "Pembersihan Sebagian".`);
                                    } else {
                                      beritahu('ok', `Selesai — ${hasil.objects_deleted} file dihapus, ringkasan tetap tersimpan.`);
                                    }
                                  }),
                                });
                              })()}
                              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg text-white disabled:opacity-50 cursor-pointer whitespace-nowrap"
                              style={{ background: '#b91c1c' }}>
                              {aksiJalan === c.id ? '…' : c.status === 'CLEAR_PARTIAL' ? 'Coba Bersihkan Lagi' : 'Setujui & Bersihkan'}
                            </button>
                          ) : c.status === 'CLEAR_PENDING' ? 'Menunggu persetujuan admin' : 'Foto masih tersimpan'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Kartu>
      </div>

      {/* ── Modal: buat siklus ── */}
      <Modal buka={modalSiklus} onTutup={() => setModalSiklus(false)}
        judul="Buat Siklus Manual" ikon="🗓️"
        keterangan="Untuk minggu di luar jadwal otomatis. Daftar TV diturunkan dari penugasan PIC."
        ukuran="lg" tutupDiLuar={false}
        footer={<>
          <TombolModal jenis="batal" onClick={() => setModalSiklus(false)}>Batal</TombolModal>
          <TombolModal jenis="utama" onClick={simpan} disabled={menyimpan}>
            {menyimpan ? 'Menyimpan…' : 'Buat Siklus'}
          </TombolModal>
        </>}>
        <div className="grid gap-3 md:grid-cols-2">
          <Kolom label="Pengerjaan mulai">
            <input type="date" value={form.mulai}
              onChange={e => ubahTanggal(e.target.value, form.selesai)} className={inputCls} />
          </Kolom>
          <Kolom label="Pengerjaan selesai">
            <input type="date" value={form.selesai}
              onChange={e => ubahTanggal(form.mulai, e.target.value)} className={inputCls} />
          </Kolom>
          <div className="md:col-span-2">
            <Kolom label="Nama siklus">
              <input value={form.nama}
                onChange={e => setForm(f => ({ ...f, nama: e.target.value }))}
                placeholder={`Siklus ${rentangTanggal(form.mulai, form.selesai)}`}
                className={inputCls} />
            </Kolom>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Kosongkan untuk memakai rentang tanggal sebagai nama.
            </p>
          </div>
          <Kolom label="Masa review client mulai">
            <input type="date" value={form.reviewMulai}
              onChange={e => setForm(f => ({ ...f, reviewMulai: e.target.value }))} className={inputCls} />
          </Kolom>
          <Kolom label="Masa review client selesai">
            <input type="date" value={form.reviewSelesai}
              onChange={e => setForm(f => ({ ...f, reviewSelesai: e.target.value }))} className={inputCls} />
          </Kolom>
        </div>
      </Modal>

      {/* ── Modal: jadwal otomatis ── */}
      <Modal buka={modalJadwal} onTutup={() => setModalJadwal(false)}
        judul="Jadwal Siklus Otomatis" ikon="🔁"
        keterangan="Pilih hari pengerjaan setiap minggu. Siklus + daftar pekerjaan PIC dibuat otomatis tanpa perlu memilih konten."
        ukuran="md" tutupDiLuar={false}
        footer={<>
          <TombolModal jenis="batal" onClick={() => setModalJadwal(false)}>Batal</TombolModal>
          <TombolModal jenis="utama" onClick={() => void simpanJadwal()} disabled={simpanJadwalJalan}>
            {simpanJadwalJalan ? 'Menyimpan…' : 'Simpan Jadwal'}
          </TombolModal>
        </>}>
        <div className="space-y-4">
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Hari pengerjaan</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Hari pengerjaan">
              {HARI_PILIHAN.map(h => {
                const pilih = drafJadwal.hari.includes(h.dow);
                return (
                  <button key={h.dow} type="button" aria-pressed={pilih}
                    onClick={() => setDrafJadwal(d => ({ ...d, hari: pilih ? d.hari.filter(x => x !== h.dow) : [...d.hari, h.dow] }))}
                    className={`min-w-[52px] px-3 py-2 rounded-kontrol text-[12px] font-bold border transition-colors
                      ${pilih ? 'bg-aksen-700 border-aksen-700 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {h.pendek}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {drafJadwal.hari.length === 0
                ? 'Belum ada hari dipilih — siklus tidak dibuat otomatis.'
                : `Setiap minggu: ${labelHari(drafJadwal.hari)}. Siklus dibuat di awal minggu (Senin pagi).`}
            </p>
          </div>
          <Kolom label="Lama masa review client (hari)">
            <input type="number" min={1} max={60} value={drafJadwal.reviewHari}
              onChange={e => setDrafJadwal(d => ({ ...d, reviewHari: Number(e.target.value) || 1 }))}
              className={inputCls} />
          </Kolom>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={drafJadwal.aktifkanOtomatis}
              onChange={e => setDrafJadwal(d => ({ ...d, aktifkanOtomatis: e.target.checked }))}
              className="mt-0.5 accent-aksen-700" />
            <span className="text-[12px] text-slate-700 leading-snug">
              <span className="font-bold">Langsung aktif</span> — PIC bisa mulai bekerja tanpa Admin menekan tombol Aktifkan.
            </span>
          </label>
        </div>
      </Modal>

      {/* ── Modal: tugaskan PIC ── */}
      <Modal buka={modalAssign} onTutup={() => setModalAssign(false)}
        judul="Tugaskan PIC ke Wilayah" ikon="🧑‍🔧"
        keterangan="Satu PIC untuk seluruh gedung di sebuah wilayah, dengan pengecualian bila perlu."
        ukuran="lg" tutupDiLuar={false}>
        <AssignPicWilayah projectId={projectId} bolehKelola={bolehProvider}
          beritahu={beritahu} onSelesai={() => void muat()} />
      </Modal>
      <ConfirmDialog state={konfirmasi} onCancel={() => setKonfirmasi(null)} />
    </div>
  );
}

// ── Bagian kecil ───────────────────────────────────────────────────────

const inputCls = 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-blue-400 bg-white';

function Kolom({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
