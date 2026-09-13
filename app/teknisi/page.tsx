'use client';

/**
 * app/teknisi/page.tsx - Ruang kerja Technician: daftar tugas hari ini,
 * check-in (2 langkah, meniru alur Talenta yang jadi acuan), check-out.
 *
 * Instance hari ini dibuat on-demand lewat fs_ensure_today_instance() (007) -
 * Recurring Schedule generator belum dibangun (Phase 4 lanjutan), jadi ini
 * jalan pintas yang disengaja, bukan cara permanen. Baca komentar di migrasi
 * 007 untuk kenapa ini aman (idempotent terhadap index unik yang sama).
 *
 * GPS & kamera murni browser API (navigator.geolocation, <input capture>) -
 * tidak ada dependency baru. Peta pratinjau lokasi memakai iframe embed
 * OpenStreetMap (tidak perlu API key), bukan Google Maps interaktif.
 *
 * Sama seperti app/field-service/page.tsx: bisa dimuat langsung, atau lewat
 * iframe internal dashboard (?embed tidak diperlukan - halaman ini selalu
 * mobile-first/layar penuh, jadi tampil wajar di kedua cara).
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Activity, CheckCircle2, Clock, MapPin, RotateCcw, Search as SearchIcon } from 'lucide-react';
import {
  PageHeader, EmptyState, ConfirmDialog, type ConfirmState, MiniPieChart,
  KartuOperasional as Kartu, UbinKpi, KosongOperasional as Kosong,
  PopupNotifikasiProaktif, type ButirNotifProaktif, Masonry,
} from '@/components/shared';
import { useRouter } from 'next/navigation';
import { supabase, setDbToken } from '@/lib/supabase';
import { useMerek, gradasiLatarPlatform } from '@/lib/merek';
import { FS_STATUS_LABEL, FS_TV_STATUS_LABEL } from '@/lib/fs-status';
import { ambilSignedUrl, lupakanSignedUrl } from '@/lib/evidence-url';

interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  role: string;
  fs_role?: string | null;
}

interface Task {
  assignmentId: string;
  instanceId: string | null;
  projectId: string | null;
  locationId: string | null;
  locationName: string;
  pointName: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusM: number;
  status: string | null;
  workSessionId: string | null;
  effectiveDate: string;
  endDate: string | null;
  /** Content yang di-deploy di sini - lihat §1/§16 patch: konsep ini SENGAJA
   *  dipisah dari deploymentDate (= hari ini) supaya Technician tidak salah
   *  paham "content yang saya pasang hari ini" dengan "tanggal tayang content
   *  ini di klien", yang bisa saja berbeda jauh (deploy lebih awal = wajar). */
  contentId: string | null;
  contentName: string | null;
  contentVersion: number | null;
  contentValidFrom: string | null;
  contentValidUntil: string | null;
  hasDailyReport: boolean;
}

// Satu sumber kebenaran di lib/fs-status.ts (dipakai juga di
// field-service/page.tsx dan widget dashboard) - status harus terlihat
// sama di layar Technician maupun Provider/Client.
const LABEL_STATUS = FS_STATUS_LABEL;

/** Kelompok status kasar untuk filter kartu ringkasan/pie chart tab "Hari
 *  Ini" - harus sinkron persis dengan pengelompokan yang dipakai untuk
 *  menghitung angka StatCardGrid-nya (lihat blok StatCardGrid di render). */
function grupStatus(status: string | null): string {
  if (!status) return 'Belum Mulai';
  if (['SUBMITTED', 'COMPLETED', 'WAITING_REVIEW', 'VERIFIED'].includes(status)) return 'Selesai';
  if (status === 'IN_PROGRESS') return 'Sedang Dikerjakan';
  if (status === 'REVISION_REQUIRED') return 'Perlu Revisi';
  return 'Belum Mulai';
}

const LABEL_VALIDASI: Record<string, string> = {
  SCHEDULE_MISMATCH: 'Ini bukan jadwal hari ini.',
  ASSIGNMENT_MISMATCH: 'Anda tidak ditugaskan ke lokasi ini.',
  LOW_ACCURACY: 'Akurasi GPS terlalu rendah — coba lagi di tempat terbuka (jauh dari gedung/atap).',
  OUTSIDE_RADIUS: 'Anda berada di luar radius lokasi yang diizinkan.',
};

/**
 * Upload satu foto evidence + thumbnail-nya sekaligus (029). Dipakai kedua
 * titik upload (check-in/out dan per-TV) supaya alurnya tidak disalin dua
 * kali. `basePath` TANPA ekstensi - fungsi ini yang menambah `.jpg` untuk
 * foto penuh dan `-thumb.jpg` untuk thumbnail.
 *
 * Thumbnail gagal diunggah TIDAK menggagalkan keseluruhan upload - baris
 * fs_evidence tetap dibuat dengan thumb_path null, dan pembaca galeri
 * fallback ke foto penuh (lihat migrasi 029).
 */
async function unggahFotoDenganThumbnail(basePath: string, foto: File): Promise<{
  path: string; thumbPath: string | null; mimeType: string; sizeBytes: number;
} | null> {
  const { compressImage, makeThumbnail } = await import('@/lib/image-compress');
  const siap = await compressImage(foto);
  const path = `${basePath}.jpg`;
  const { error: upErr } = await supabase.storage.from('fs-evidence')
    .upload(path, siap, { contentType: siap.type || 'image/jpeg', cacheControl: '31536000' });
  if (upErr) return null;

  let thumbPath: string | null = null;
  const thumb = await makeThumbnail(siap).catch(() => null);
  if (thumb) {
    const tPath = `${basePath}-thumb.jpg`;
    const { error: thumbErr } = await supabase.storage.from('fs-evidence')
      .upload(tPath, thumb, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (!thumbErr) thumbPath = tPath;
  }
  return { path, thumbPath, mimeType: siap.type || 'image/jpeg', sizeBytes: siap.size };
}

function ambilGeolokasi(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Browser ini tidak mendukung GPS.')); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

function petaKecil(lat: number, lng: number) {
  const d = 0.006;
  const bbox = `${lng - d},${lat - d * 0.7},${lng + d},${lat + d * 0.7}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export default function TeknisiPage() {
  const router = useRouter();
  const merek = useMerek();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  /** IA "My Work": Tugas Hari Ini (default) / Akan Datang / Riwayat - brief
   *  transformasi UX minta ketiganya, sebelumnya cuma ada "hari ini". */
  const [viewTab, setViewTab] = useState<'today' | 'upcoming' | 'history'>('today');
  const [upcoming, setUpcoming] = useState<{ assignmentId: string; locationName: string; pointName: string | null; effectiveDate: string }[] | null>(null);
  const [history, setHistory] = useState<{ id: string; instanceDate: string; locationName: string; pointName: string | null; status: string }[] | null>(null);
  const [aktifTask, setAktifTask] = useState<{ task: Task; mode: 'checkin' | 'checkout' } | null>(null);
  const [aktifChecklist, setAktifChecklist] = useState<Task | null>(null);
  const [pesan, setPesan] = useState<{ tipe: 'ok' | 'gagal'; teks: string } | null>(null);
  const [membukaRevisi, setMembukaRevisi] = useState<string | null>(null);
  const todayId = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  /** Filter tab "Hari Ini" - diisi dari klik kartu ringkasan ATAU slice pie
   *  chart (keduanya sumber yang sama, lihat GRUP_STATUS di bawah), plus
   *  pencarian teks bebas lokasi/titik TV. */
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [cariTugas, setCariTugas] = useState('');
  const [cariRiwayat, setCariRiwayat] = useState('');

  const beritahu = (tipe: 'ok' | 'gagal', teks: string) => {
    setPesan({ tipe, teks });
    window.setTimeout(() => setPesan(null), 6000);
  };

  /**
   * Client minta revisi (REVISION_REQUIRED) - PIC harus mengeksekusi ulang,
   * bukan cuma menambah bukti ke sesi lama yang sudah ditutup. fs_check_in()
   * hanya auto-transisi status saat NOT_STARTED (005), jadi di sini instance
   * ditransisikan ke IN_PROGRESS dulu lewat fs_status_transition (diizinkan
   * untuk PIC yang bersangkutan pada REVISION_REQUIRED->IN_PROGRESS), baru
   * wizard check-in dibuka - fs_check_in akan membuat sesi kerja BARU karena
   * sesi sebelumnya sudah CLOSED, tanpa menghapus riwayat evidence/sesi lama.
   */
  const mulaiRevisi = async (t: Task) => {
    if (!t.instanceId) return;
    setMembukaRevisi(t.assignmentId);
    const { error } = await supabase.rpc('fs_status_transition', { p_instance_id: t.instanceId, p_new_status: 'IN_PROGRESS' });
    if (error) { setMembukaRevisi(null); beritahu('gagal', 'Gagal membuka revisi: ' + error.message); return; }
    // Checklist per-TV (termasuk yang sudah sempat di-Approve provider di
    // siklus sebelumnya) dikembalikan ke NOT_STARTED/PENDING - siklus revisi
    // baru harus benar-benar dikerjakan ulang, bukan diam-diam masih
    // menampilkan centang/approval lama (migrasi 017).
    const { error: errReset } = await supabase.rpc('fs_reset_checklist_for_revision', { p_instance_id: t.instanceId });
    setMembukaRevisi(null);
    if (errReset) { beritahu('gagal', 'Gagal mereset checklist: ' + errReset.message); return; }
    setAktifTask({ task: t, mode: 'checkin' });
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        if (!res.ok) { router.replace('/dashboard'); return; }
        const data = await res.json() as { user: SessionUser | null; db_token?: string | null };
        if (!data.user) { router.replace('/dashboard'); return; }
        setDbToken(data.db_token ?? null);
        setUser(data.user);
      } catch {
        router.replace('/dashboard');
        return;
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const muatTugas = useCallback(async (userId: string) => {
    setLoadingTasks(true);
    const today = new Date().toISOString().slice(0, 10);
    const { data: assignments, error } = await supabase.from('fs_pic_assignments')
      .select('id, location_id, execution_point_id, effective_date, end_date, fs_locations(name, address, latitude, longitude, gps_radius_m), fs_execution_points!execution_point_id(name, floor)')
      .eq('user_id', userId).eq('active', true)
      .lte('effective_date', today);
    if (error) { beritahu('gagal', 'Gagal memuat tugas: ' + error.message); setLoadingTasks(false); return; }

    const valid = (assignments ?? []).filter((a: any) => !a.end_date || a.end_date >= today);
    const daftar: Task[] = [];
    for (const a of valid as any[]) {
      const lokasi = a.fs_locations;
      const titik = a.fs_execution_points;
      if (!lokasi) continue;
      let instanceId: string | null = null;
      try {
        const { data: idInstance, error: rpcErr } = await supabase.rpc('fs_ensure_today_instance', { p_assignment_id: a.id });
        if (!rpcErr) instanceId = idInstance as string;
      } catch { /* dibiarkan null - kartu tetap tampil, tombol aksi disembunyikan */ }

      let status: string | null = null;
      let workSessionId: string | null = null;
      let projectId: string | null = null;
      let locationId: string | null = null;
      let contentId: string | null = null;
      let contentName: string | null = null;
      let contentVersion: number | null = null;
      let contentValidFrom: string | null = null;
      let contentValidUntil: string | null = null;
      let hasDailyReport = false;
      if (instanceId) {
        const { data: inst } = await supabase.from('fs_execution_instances')
          .select('status, project_id, location_id, content_id, fs_content(name, version, valid_from, valid_until)')
          .eq('id', instanceId).maybeSingle();
        status = inst?.status ?? 'NOT_STARTED';
        projectId = inst?.project_id ?? null;
        locationId = inst?.location_id ?? null;
        contentId = inst?.content_id ?? null;
        const konten: any = inst?.fs_content ?? null;
        if (konten) {
          contentName = konten.name; contentVersion = konten.version;
          contentValidFrom = konten.valid_from; contentValidUntil = konten.valid_until;
        }
        if (status === 'IN_PROGRESS') {
          const { data: sesi } = await supabase.from('fs_work_sessions')
            .select('id').eq('execution_instance_id', instanceId).eq('status', 'ACTIVE').maybeSingle();
          workSessionId = sesi?.id ?? null;
        }
        const { data: laporan } = await supabase.from('fs_daily_reports')
          .select('id').eq('execution_instance_id', instanceId).maybeSingle();
        hasDailyReport = !!laporan;
      }

      daftar.push({
        assignmentId: a.id, instanceId, projectId, locationId,
        locationName: lokasi.name,
        pointName: titik ? (titik.floor ? `${titik.name} — ${titik.floor}` : titik.name) : null,
        address: lokasi.address,
        latitude: Number(lokasi.latitude), longitude: Number(lokasi.longitude), radiusM: lokasi.gps_radius_m,
        status, workSessionId, effectiveDate: a.effective_date, endDate: a.end_date,
        contentId, contentName, contentVersion, contentValidFrom, contentValidUntil, hasDailyReport,
      });
    }
    setTasks(daftar);
    setLoadingTasks(false);
  }, []);

  const muatUpcoming = useCallback(async (userId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from('fs_pic_assignments')
      .select('id, effective_date, fs_locations(name), fs_execution_points!execution_point_id(name, floor)')
      .eq('user_id', userId).eq('active', true).gt('effective_date', today)
      .order('effective_date', { ascending: true }).limit(50);
    if (error) { beritahu('gagal', 'Gagal memuat tugas akan datang: ' + error.message); return; }
    type Baris = { id: string; effective_date: string; fs_locations: { name: string } | null; fs_execution_points: { name: string; floor: string | null } | null };
    setUpcoming((data ?? []).map((a: Baris) => ({
      assignmentId: a.id, effectiveDate: a.effective_date,
      locationName: a.fs_locations?.name ?? '—',
      pointName: a.fs_execution_points ? (a.fs_execution_points.floor ? `${a.fs_execution_points.name} — ${a.fs_execution_points.floor}` : a.fs_execution_points.name) : null,
    })));
  }, []);

  const muatHistory = useCallback(async (userId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from('fs_execution_instances')
      .select('id, instance_date, status, fs_locations(name), fs_execution_points!execution_point_id(name, floor)')
      .eq('assigned_pic_user_id', userId).lt('instance_date', today)
      .order('instance_date', { ascending: false }).limit(50);
    if (error) { beritahu('gagal', 'Gagal memuat riwayat: ' + error.message); return; }
    type Baris = { id: string; instance_date: string; status: string; fs_locations: { name: string } | null; fs_execution_points: { name: string; floor: string | null } | null };
    setHistory((data ?? []).map((r: Baris) => ({
      id: r.id, instanceDate: r.instance_date, status: r.status,
      locationName: r.fs_locations?.name ?? '—',
      pointName: r.fs_execution_points ? (r.fs_execution_points.floor ? `${r.fs_execution_points.name} — ${r.fs_execution_points.floor}` : r.fs_execution_points.name) : null,
    })));
  }, []);

  // Lazy load - Upcoming/Riwayat baru diambil saat tabnya pertama dibuka,
  // bukan sekaligus dengan "Hari Ini" yang sudah lumayan berat (per-task
  // sampai 4 query RPC/tabel).
  useEffect(() => {
    if (!ready || !user) return;
    if (viewTab === 'upcoming' && upcoming === null) void muatUpcoming(user.id);
    if (viewTab === 'history' && history === null) void muatHistory(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user, viewTab]);

  useEffect(() => {
    if (ready && user) void muatTugas(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

  /**
   * Popup proaktif: "belum dikerjakan"/"perlu revisi" bukan sebuah EVENT
   * yang tercatat di tabel notifications (tidak ada yang mengirimnya - itu
   * cuma daftar tugas hari ini yang belum disentuh), jadi harus dihitung di
   * sini, bukan dibaca dari lonceng. Ini persis permintaan eksplisit: setiap
   * peran wajib punya pop up notif sesuai jobdesk-nya masing-masing - untuk
   * Technician jobdesk-nya adalah menyelesaikan checklist per-TV hari ini.
   */
  const perluRevisiList = useMemo(() => tasks.filter(t => t.status === 'REVISION_REQUIRED'), [tasks]);
  const belumMulaiList = useMemo(() => tasks.filter(t => t.status === 'NOT_STARTED'), [tasks]);
  const butirPopupTeknisi: ButirNotifProaktif[] = useMemo(() => [
    ...perluRevisiList.map(t => ({ teks: `${t.locationName}${t.pointName ? ' · ' + t.pointName : ''} — diminta diulang`, warna: '#B91C1C' })),
    ...belumMulaiList.map(t => ({ teks: `${t.locationName}${t.pointName ? ' · ' + t.pointName : ''} — belum check-in`, warna: '#D97706' })),
  ], [perluRevisiList, belumMulaiList]);

  if (!ready || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Memuat…</p>
      </div>
    );
  }

  return (
    // h-screen overflow-hidden + flex-col SENGAJA, bukan min-h-screen (dulu
    // dipakai) - persis pola semua modul lain (lihat catatan sama di
    // field-service/page.tsx): header di LUAR area yang scroll, jadi tidak
    // akan pernah ikut ter-scroll walau di dalam iframe dashboard.
    <div className="h-screen overflow-hidden flex flex-col bg-slate-50 bg-cover bg-center bg-no-repeat"
      style={merek.gambarLatarDasbor ? { backgroundImage: `url(${merek.gambarLatarDasbor})` } : { background: gradasiLatarPlatform(merek) }}>
      {!loadingTasks && (
        <PopupNotifikasiProaktif
          kunciSesi={`fs-popup-teknisi-${user.id}-${new Date().toISOString().slice(0, 10)}-${perluRevisiList.length}-${belumMulaiList.length}`}
          judul={perluRevisiList.length > 0 ? 'Ada revisi yang perlu dikerjakan ulang' : 'Masih ada tugas yang belum dikerjakan'}
          warna={perluRevisiList.length > 0 ? '#B91C1C' : '#D97706'}
          butir={butirPopupTeknisi}
          lihatLabel="Lihat tugas"
          onLihat={() => { setViewTab('today'); setStatusFilter(perluRevisiList.length > 0 ? 'Perlu Revisi' : 'Belum Mulai'); }}
        />
      )}
      <PageHeader icon="✅" title="Tugas Hari Ini"
        subtitle={new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        color="#059669" />

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-10">
      {/* max-w-[1600px] - laptop 1920x1080 target utama (persis field-service
          & Dashboard), turun mengecil sendiri di layar sempit lewat
          breakpoint grid di bawah - bukan dipatok sempit (max-w-lg) untuk
          semua ukuran layar seolah ini selalu dibuka dari HP. */}
      <div className="max-w-[1600px] mx-auto px-4 pt-6">
        {/* Sapaan + ringkasan hari ini DIBUNGKUS SATU KARTU PUTIH - sebelumnya
            teks sapaan ditulis langsung di atas gradasi gelap latar halaman
            (text-slate-800 pada latar merah tua nyaris tidak terbaca sama
            sekali). Kartu ini juga menyamakan gayanya dengan Dashboard: ubin
            KPI berikon, bukan StatCardGrid gelap yang berbeda sendiri. */}
        <Kartu className="mb-4">
          <p className="text-[15px] font-bold text-slate-800 mb-3">
            {(() => {
              const jam = new Date().getHours();
              const sapaan = jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 18 ? 'Selamat sore' : 'Selamat malam';
              return `${sapaan}, ${user.full_name.split(' ')[0]}`;
            })()}
          </p>
          {!loadingTasks && tasks.length > 0 && (() => {
            // Satu sumber angka untuk ubin KPI + MiniPieChart + filter tab
            // "Hari Ini" - bukan 3 chart terpisah yang menghitung ulang, supaya
            // klik kartu/slice dan hasil filternya SELALU konsisten satu sama
            // lain (§ user: "jangan asal ada chart").
            const selesai = tasks.filter(t => t.status && ['SUBMITTED', 'COMPLETED', 'WAITING_REVIEW', 'VERIFIED'].includes(t.status)).length;
            const berjalan = tasks.filter(t => t.status === 'IN_PROGRESS').length;
            const belumMulai = tasks.filter(t => t.status === 'NOT_STARTED').length;
            const perluRevisi = tasks.filter(t => t.status === 'REVISION_REQUIRED').length;
            const toggle = (key: string) => setStatusFilter(f => f === key ? null : key);
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <UbinKpi ikon={MapPin} label="Total Tugas" nilai={tasks.length} warna="#334155" />
                  <UbinKpi ikon={Clock} label="Belum Mulai" nilai={belumMulai} warna="#F59E0B"
                    aktif={statusFilter === 'Belum Mulai'}
                    onClick={belumMulai > 0 ? () => toggle('Belum Mulai') : undefined} />
                  <UbinKpi ikon={Activity} label="Sedang Dikerjakan" nilai={berjalan} warna="#0369A1"
                    aktif={statusFilter === 'Sedang Dikerjakan'}
                    onClick={berjalan > 0 ? () => toggle('Sedang Dikerjakan') : undefined} />
                  <UbinKpi ikon={perluRevisi > 0 ? RotateCcw : CheckCircle2}
                    label={perluRevisi > 0 ? 'Perlu Revisi' : 'Selesai'}
                    nilai={perluRevisi > 0 ? perluRevisi : selesai}
                    warna={perluRevisi > 0 ? '#B91C1C' : '#059669'}
                    aktif={statusFilter === (perluRevisi > 0 ? 'Perlu Revisi' : 'Selesai')}
                    onClick={(perluRevisi > 0 ? perluRevisi : selesai) > 0 ? () => toggle(perluRevisi > 0 ? 'Perlu Revisi' : 'Selesai') : undefined} />
                </div>
                {/* Pie ditampilkan hanya kalau komposisinya benar-benar informatif
                    (≥2 status berbeda muncul) - satu warna tunggal cuma menegaskan
                    hal yang sudah dibaca dari kartu di atas, bukan info baru. */}
                {[belumMulai, berjalan, selesai, perluRevisi].filter(v => v > 0).length >= 2 && (
                  <MiniPieChart title="Komposisi Status Hari Ini" icon="📊" activeFilter={statusFilter}
                    onSliceClick={toggle}
                    data={[
                      { label: 'Belum Mulai', value: belumMulai, color: '#f59e0b' },
                      { label: 'Sedang Dikerjakan', value: berjalan, color: '#0369a1' },
                      { label: 'Selesai', value: selesai, color: '#059669' },
                      { label: 'Perlu Revisi', value: perluRevisi, color: '#b91c1c' },
                    ].filter(d => d.value > 0)} />
                )}
              </div>
            );
          })()}

          {!loadingTasks && tasks.length > 0 && (
            <div className="relative mt-3">
              <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" aria-hidden="true" />
              <input type="text" value={cariTugas} onChange={e => setCariTugas(e.target.value)}
                placeholder="Cari lokasi atau titik TV…"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-rose-400" />
            </div>
          )}
        </Kartu>

        {pesan && (
          <div className="rounded-xl px-4 py-2.5 text-sm font-semibold mb-4"
            style={pesan.tipe === 'ok'
              ? { background: 'rgba(16,185,129,0.1)', color: '#047857', border: '1px solid rgba(16,185,129,0.35)' }
              : { background: 'rgba(239,68,68,0.1)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.35)' }}>
            {pesan.teks}
          </div>
        )}

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 mb-4 w-fit">
          {(['today', 'upcoming', 'history'] as const).map(id => (
            <button key={id} type="button" onClick={() => setViewTab(id)}
              className={`text-xs font-bold px-3 py-1.5 rounded-md transition-colors ${viewTab === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
              {id === 'today' ? 'Hari Ini' : id === 'upcoming' ? 'Akan Datang' : 'Riwayat'}
            </button>
          ))}
        </div>

        {/* key={viewTab} + animate-fade-in - animasi masuk sedikit tiap ganti
            tab Hari Ini/Akan Datang/Riwayat (kelas sudah ada di globals.css). */}
        <div key={viewTab} className="animate-fade-in">
        {viewTab === 'today' && (loadingTasks ? (
          <div className="flex items-center justify-center py-16"><div className="w-6 h-6 rounded-full border-2 border-t-rose-600 border-rose-200 animate-spin" /></div>
        ) : tasks.length === 0 ? (
          <Kartu>
            <div className="flex flex-col items-center text-center py-4">
              <span className="w-11 h-11 rounded-xl grid place-items-center mb-3" style={{ background: '#F1F5F9', color: '#94A3B8' }}>
                <MapPin size={20} aria-hidden="true" />
              </span>
              <Kosong judul="Belum ada lokasi yang ditugaskan"
                teks="Hubungi admin untuk di-assign ke sebuah lokasi." />
            </div>
          </Kartu>
        ) : (() => {
          const q = cariTugas.trim().toLowerCase();
          const tampil = tasks.filter(t => {
            if (statusFilter && grupStatus(t.status) !== statusFilter) return false;
            if (q && !`${t.locationName} ${t.pointName ?? ''}`.toLowerCase().includes(q)) return false;
            return true;
          });
          if (tampil.length === 0) return (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <EmptyState icon="🔍" title="Tidak ada tugas yang cocok"
                description="Coba ubah kata kunci pencarian atau hapus filter status di atas." />
            </div>
          );
          return (
          // Masonry (bukan grid biasa - grid men-stretch semua kartu ke
          // tinggi yang paling tinggi dalam SATU baris, dan kartu tugas di
          // sini tingginya beda-beda: ada tidaknya blok content period, satu
          // tombol Check-in vs dua tombol Checklist+Check-out, dst).
          <Masonry columns={3} minColumnWidth={280} gap={12} className="stagger-rows">
            {tampil.map(t => {
              const st = t.status ? LABEL_STATUS[t.status] ?? { label: t.status, color: '#475569', bg: '#f1f5f9' } : null;
              return (
                <div key={t.assignmentId} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 text-sm truncate">{t.locationName}</p>
                      {t.pointName && <p className="text-xs text-slate-400">{t.pointName}</p>}
                      {t.address && <p className="text-xs text-slate-400 mt-0.5 truncate">{t.address}</p>}
                      {t.contentName && (
                        <div className="mt-1.5 rounded-lg bg-indigo-50 border border-indigo-100 px-2 py-1.5 space-y-0.5">
                          <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide">🖼️ {t.contentName} (v{t.contentVersion})</p>
                          <p className="text-[10px] text-indigo-500">Content Period (tayang di klien): {t.contentValidFrom} s/d {t.contentValidUntil}</p>
                          <p className="text-[10px] text-slate-400">Deployment Date (pemasangan hari ini): {todayId}</p>
                        </div>
                      )}
                    </div>
                    {st && (
                      <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap"
                        style={{ color: st.color, background: st.bg }}>
                        {st.label}
                      </span>
                    )}
                  </div>
                  <div className="mt-3">
                    {!t.instanceId ? (
                      <p className="text-xs text-amber-600">Gagal menyiapkan tugas hari ini. Coba muat ulang halaman.</p>
                    ) : t.status === 'NOT_STARTED' ? (
                      <button type="button" onClick={() => setAktifTask({ task: t, mode: 'checkin' })}
                        className="w-full py-2.5 rounded-xl text-white text-sm font-bold" style={{ background: '#be123c' }}>
                        Check-in
                      </button>
                    ) : t.status === 'IN_PROGRESS' && t.workSessionId ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setAktifChecklist(t)}
                          className="py-2.5 rounded-xl text-white text-sm font-bold" style={{ background: '#4338ca' }}>
                          📋 Checklist TV
                        </button>
                        <button type="button" onClick={() => setAktifTask({ task: t, mode: 'checkout' })}
                          className="py-2.5 rounded-xl text-white text-sm font-bold" style={{ background: '#0369a1' }}>
                          Check-out
                        </button>
                      </div>
                    ) : t.status === 'REVISION_REQUIRED' ? (
                      <button type="button" onClick={() => mulaiRevisi(t)} disabled={membukaRevisi === t.assignmentId}
                        className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60" style={{ background: '#b91c1c' }}>
                        {membukaRevisi === t.assignmentId ? 'Membuka…' : '🔁 Mulai Revisi'}
                      </button>
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-1">Tidak ada tindakan yang perlu dilakukan.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </Masonry>
          );
        })())}

        {viewTab === 'upcoming' && (
          upcoming === null ? (
            <div className="flex items-center justify-center py-16"><div className="w-6 h-6 rounded-full border-2 border-t-rose-600 border-rose-200 animate-spin" /></div>
          ) : upcoming.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <EmptyState icon="🗓️" title="Belum ada tugas terjadwal ke depan" description="Assignment dengan tanggal mulai setelah hari ini akan muncul di sini." />
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-50">
              {upcoming.map(u => (
                <div key={u.assignmentId} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{u.locationName}</p>
                    {u.pointName && <p className="text-xs text-slate-400">{u.pointName}</p>}
                  </div>
                  <span className="text-xs font-bold text-slate-500 flex-shrink-0">Mulai {u.effectiveDate}</span>
                </div>
              ))}
            </div>
          )
        )}

        {viewTab === 'history' && (
          history === null ? (
            <div className="flex items-center justify-center py-16"><div className="w-6 h-6 rounded-full border-2 border-t-rose-600 border-rose-200 animate-spin" /></div>
          ) : history.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <EmptyState icon="🕐" title="Belum ada riwayat" description="Riwayat pekerjaan sebelumnya akan muncul di sini." />
            </div>
          ) : (() => {
            const q = cariRiwayat.trim().toLowerCase();
            const tampil = q ? history.filter(h => `${h.locationName} ${h.pointName ?? ''}`.toLowerCase().includes(q)) : history;
            return (
            <>
              <div className="relative mb-3">
                <svg aria-hidden="true" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
                </svg>
                <input type="text" value={cariRiwayat} onChange={e => setCariRiwayat(e.target.value)}
                  placeholder="Cari lokasi atau titik TV di riwayat…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-rose-400" />
              </div>
              {tampil.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white">
                  <EmptyState icon="🔍" title="Tidak ada riwayat yang cocok" description="Coba kata kunci lain." />
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-50">
                  {tampil.map(h => {
                    const st = LABEL_STATUS[h.status] ?? { label: h.status, color: '#475569', bg: '#f1f5f9' };
                    return (
                      <div key={h.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{h.locationName}{h.pointName ? ` · ${h.pointName}` : ''}</p>
                          <p className="text-xs text-slate-400">{h.instanceDate}</p>
                        </div>
                        <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap" style={{ color: st.color, background: st.bg }}>
                          {st.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
            );
          })()
        )}
        </div>
      </div>
      </div>

      {aktifTask && (
        <CheckWizard
          task={aktifTask.task} mode={aktifTask.mode} userId={user.id}
          onClose={() => setAktifTask(null)}
          onDone={() => { setAktifTask(null); void muatTugas(user.id); }}
        />
      )}
      {aktifChecklist && (
        <TvChecklistModal task={aktifChecklist} userId={user.id} onClose={() => setAktifChecklist(null)} />
      )}
    </div>
  );
}

// ── Wizard Check-in (2 langkah) / Check-out (1 langkah) ────────────────────

/**
 * Cek klien SEBELUM check-out dipanggil - supaya technician tahu SEGERA
 * (bukan lewat error round-trip fs_status_transition) kalau masih ada TV
 * aktif di lokasi ini yang checklist-nya belum diisi sama sekali. Ini murni
 * kenyamanan UX; penjaga yang sungguhan (tidak bisa dilewati lewat
 * manipulasi payload) ada di fs_status_transition sendiri (migrasi 017).
 */
async function hitungTvBelumSelesai(locationId: string, instanceId: string): Promise<number> {
  const [{ data: pts }, { data: sts }] = await Promise.all([
    supabase.from('fs_execution_points').select('id').eq('location_id', locationId).eq('status', 'active'),
    supabase.from('fs_execution_point_status').select('execution_point_id, status').eq('execution_instance_id', instanceId),
  ]);
  const selesai = new Set(
    ((sts ?? []) as { execution_point_id: string; status: string }[])
      .filter(s => s.status !== 'NOT_STARTED')
      .map(s => s.execution_point_id),
  );
  return ((pts ?? []) as { id: string }[]).filter(p => !selesai.has(p.id)).length;
}

function CheckWizard({ task, mode, userId, onClose, onDone }: {
  task: Task; mode: 'checkin' | 'checkout'; userId: string;
  onClose: () => void; onDone: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [gpsError, setGpsError] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState('');
  const [catatan, setCatatan] = useState('');
  /**
   * Ringkasan hasil kerja - DIHITUNG SERVER dari checklist per-TV, bukan
   * diketik teknisi. Dulu layar ini punya dua kolom isian angka ("Total
   * Display" & "Display Selesai"); angka yang membuktikan pekerjaan
   * seseorang tidak boleh berasal dari orang yang sama, karena siapa pun
   * bisa menulis 10/10 tanpa menyentuh satu TV pun.
   */
  const [ringkasan, setRingkasan] = useState<{
    total_tv: number; selesai_tv: number; gagal_tv: number; belum_tv: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasil, setHasil] = useState<{ tipe: 'ok' | 'gagal'; teks: string } | null>(null);

  const bacaGps = useCallback(async () => {
    setGpsLoading(true); setGpsError('');
    try {
      const pos = await ambilGeolokasi();
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    } catch {
      setGpsError('Gagal membaca lokasi — izinkan akses GPS di browser, lalu coba lagi.');
    }
    setGpsLoading(false);
  }, []);

  useEffect(() => { void bacaGps(); }, [bacaGps]);

  // Ringkasan hasil kerja dibaca dari server saat layar check-out dibuka,
  // supaya teknisi melihat angka yang PERSIS SAMA dengan yang akan tersimpan
  // - dan tahu lebih dulu kalau alasannya wajib diisi.
  useEffect(() => {
    if (mode !== 'checkout' || !task.instanceId) return;
    let batal = false;
    (async () => {
      const { data } = await supabase.rpc('fs_checkout_summary', { p_instance_id: task.instanceId });
      if (!batal && data) setRingkasan(data as { total_tv: number; selesai_tv: number; gagal_tv: number; belum_tv: number });
    })();
    return () => { batal = true; };
  }, [mode, task.instanceId]);

  const pilihFoto = (f: File | null) => {
    setFoto(f);
    if (fotoPreview) URL.revokeObjectURL(fotoPreview);
    setFotoPreview(f ? URL.createObjectURL(f) : '');
  };

  const unggahEvidence = async (executionInstanceId: string, workSessionId: string, tag: string) => {
    if (!foto) return;
    try {
      // Wajib dikompres dulu (+ thumbnail terpisah, 029) - foto dari kamera
      // HP biasanya 3-8MB, padahal ini cuma bukti kehadiran/kondisi, bukan
      // foto yang perlu resolusi tinggi. Tanpa ini setiap check-in/check-out
      // bisa menyeret ukuran storage & bandwidth Supabase membengkak sia-sia.
      const basePath = `${executionInstanceId}/${workSessionId}-${tag}-${Date.now()}`;
      const hasil = await unggahFotoDenganThumbnail(basePath, foto);
      if (!hasil) return;
      await supabase.from('fs_evidence').insert({
        execution_instance_id: executionInstanceId, work_session_id: workSessionId,
        bucket: 'fs-evidence', path: hasil.path, thumb_path: hasil.thumbPath,
        mime_type: hasil.mimeType, size_bytes: hasil.sizeBytes,
        uploaded_by: userId,
      });
    } catch { /* evidence gagal diunggah tidak boleh menggagalkan check-in/out yang sudah tercatat */ }
  };

  const submitCheckIn = async () => {
    if (!coords || !task.instanceId) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc('fs_check_in', {
      p_instance_id: task.instanceId, p_lat: coords.lat, p_lng: coords.lng, p_accuracy: coords.accuracy,
    });
    if (error) { setHasil({ tipe: 'gagal', teks: error.message }); setSubmitting(false); return; }
    const res = data as { validation_status: string; work_session_id: string | null; distance_m?: number };
    if (res.validation_status !== 'VALID') {
      setHasil({ tipe: 'gagal', teks: LABEL_VALIDASI[res.validation_status] ?? res.validation_status });
      setSubmitting(false);
      return;
    }
    if (res.work_session_id) await unggahEvidence(task.instanceId, res.work_session_id, 'checkin');
    setHasil({ tipe: 'ok', teks: 'Check-in berhasil! Selamat bekerja.' });
    setSubmitting(false);
    window.setTimeout(onDone, 1400);
  };

  /** Alasan wajib bila ada TV yang tidak selesai - aturan yang sama juga
   *  dijaga server (fs_submit_checkout), ini sekadar memberi tahu teknisi
   *  lebih awal supaya tidak menekan Submit lalu ditolak. */
  const perluAlasan = !!ringkasan && ringkasan.selesai_tv < ringkasan.total_tv;

  const submitCheckOut = async () => {
    if (!coords || !task.workSessionId || !task.instanceId) return;
    if (task.locationId) {
      const belum = await hitungTvBelumSelesai(task.locationId, task.instanceId);
      if (belum > 0) {
        setHasil({ tipe: 'gagal', teks: `Masih ada ${belum} TV yang belum diisi checklist-nya. Isi lewat tombol "Checklist TV" dulu sebelum check-out.` });
        return;
      }
    }
    if (perluAlasan && !catatan.trim()) {
      setHasil({ tipe: 'gagal', teks: 'Ada TV yang tidak selesai — tulis alasannya dulu. Laporan ini akan direview admin.' });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc('fs_check_out', {
      p_work_session_id: task.workSessionId, p_lat: coords.lat, p_lng: coords.lng, p_accuracy: coords.accuracy,
    });
    if (error) { setHasil({ tipe: 'gagal', teks: error.message }); setSubmitting(false); return; }
    const res = data as { validation_status: string; work_session_id: string };
    if (res.validation_status !== 'VALID' && res.validation_status !== 'ALREADY_CLOSED') {
      setHasil({ tipe: 'gagal', teks: LABEL_VALIDASI[res.validation_status] ?? res.validation_status });
      setSubmitting(false);
      return;
    }
    await unggahEvidence(task.instanceId, task.workSessionId, 'checkout');
    if (catatan.trim()) {
      await supabase.from('fs_work_sessions').update({ notes: catatan.trim() }).eq('id', task.workSessionId);
    }
    // Serahkan ke antrean verifikasi provider - lihat fs_status_transition (005).
    await supabase.rpc('fs_status_transition', { p_instance_id: task.instanceId, p_new_status: 'SUBMITTED' });

    // Laporan harian ditulis SERVER (fs_submit_checkout, migrasi 026):
    // jumlah TV dan jumlah yang selesai dihitung dari checklist per-TV yang
    // benar-benar tercatat, bukan dikirim dari layar ini. Satu-satunya yang
    // dikirim klien adalah CATATAN - dan itu memang penilaian manusia yang
    // tidak bisa disimpulkan mesin.
    const { data: hasilKirim, error: errKirim } = await supabase.rpc('fs_submit_checkout', {
      p_instance_id: task.instanceId,
      p_catatan: catatan.trim() || null,
    });
    if (errKirim) { setHasil({ tipe: 'gagal', teks: errKirim.message }); setSubmitting(false); return; }

    const r = hasilKirim as { total_tv: number; selesai_tv: number; perlu_persetujuan: boolean };
    setHasil({
      tipe: 'ok',
      teks: r.perlu_persetujuan
        ? `Check-out terkirim: ${r.selesai_tv} dari ${r.total_tv} TV selesai. Alasan Anda menunggu persetujuan admin.`
        : `Check-out berhasil — ${r.selesai_tv}/${r.total_tv} TV selesai. Pekerjaan dikirim untuk diverifikasi.`,
    });
    setSubmitting(false);
    window.setTimeout(onDone, 1800);
  };

  const judul = mode === 'checkin' ? 'Check In' : 'Check Out';

  return (
    // Full-bleed di HP (persis sebelumnya), tapi dialog terpusat & dibatasi
    // lebarnya di layar laptop - wizard 1 langkah tidak perlu melebar sampai
    // 1920px, dan "menutup seluruh layar" di desktop terasa seperti tampilan
    // HP yang dipaksakan, bukan dialog aplikasi yang proper.
    <div className="fixed inset-0 z-[1000] bg-black/50 sm:flex sm:items-center sm:justify-center">
      <div className="bg-white flex flex-col w-full h-full sm:max-w-md sm:h-[85vh] sm:rounded-2xl sm:shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-4" style={{ background: '#be123c' }}>
        <div className="flex items-center justify-between text-white">
          <button type="button" onClick={onClose} aria-label="Kembali" className="p-1">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div className="text-center">
            <p className="font-bold text-lg leading-none">{judul}</p>
            <p className="text-xs text-white/80 mt-1">{mode === 'checkin' ? `Step ${step} of 2` : 'Step 1 of 1'}</p>
          </div>
          <button type="button" onClick={() => void bacaGps()} aria-label="Muat ulang GPS" className="p-1">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        <div className="mt-3 bg-white rounded-xl px-4 py-3">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{task.locationName}{task.pointName ? ` · ${task.pointName}` : ''}</p>
          <p className="text-sm font-bold text-slate-800 mt-0.5">Radius {task.radiusM}m</p>
          {task.contentName && (
            <p className="text-[11px] text-indigo-600 mt-1">
              🖼️ {task.contentName} (v{task.contentVersion}) — Content Period {task.contentValidFrom} s/d {task.contentValidUntil}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── STEP 1: peta + GPS (checkin) atau langsung (checkout) ── */}
        {(mode === 'checkout' || step === 1) && (
          <div className="flex flex-col h-full">
            <div className="flex-1 min-h-[260px] relative bg-slate-100">
              {coords ? (
                <iframe title="Peta lokasi Anda saat ini" src={petaKecil(coords.lat, coords.lng)}
                  className="w-full h-full border-0" style={{ minHeight: 260 }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ minHeight: 260 }}>
                  {gpsLoading
                    ? <p className="text-sm text-slate-400">Membaca lokasi GPS…</p>
                    : <p className="text-sm text-red-500 px-6 text-center">{gpsError}</p>}
                </div>
              )}
            </div>
            <div className="p-4 space-y-2 flex-shrink-0">
              {coords && (
                <p className="text-xs text-slate-400 text-center">
                  Akurasi ±{Math.round(coords.accuracy)}m
                  {coords.accuracy > 100 && <span className="text-amber-600 font-semibold"> — coba di tempat terbuka untuk akurasi lebih baik</span>}
                </p>
              )}
              {mode === 'checkin' ? (
                <button type="button" disabled={!coords} onClick={() => setStep(2)}
                  className="w-full py-3.5 rounded-xl text-white font-bold text-sm disabled:opacity-40" style={{ background: '#1d4ed8' }}>
                  Next
                </button>
              ) : (
                <>
                  {/* RINGKASAN OTOMATIS - dulu dua kolom isian angka yang
                      diketik teknisi sendiri. Angka yang membuktikan pekerjaan
                      seseorang tidak boleh datang dari orang yang sama: siapa
                      pun bisa mengetik 10/10 tanpa menyentuh satu TV pun.
                      Sekarang dihitung server dari checklist per-TV yang
                      benar-benar tercatat (fs_checkout_summary, migrasi 026). */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                        Hasil pekerjaan Anda
                      </p>
                    </div>
                    {!ringkasan ? (
                      <p className="text-xs text-slate-400 text-center py-4">Menghitung…</p>
                    ) : (
                      <div className="grid grid-cols-4 divide-x divide-slate-100">
                        <AngkaRingkas n={ringkasan.total_tv} l="Total TV" c="#0f172a" />
                        <AngkaRingkas n={ringkasan.selesai_tv} l="Selesai" c="#047857" />
                        <AngkaRingkas n={ringkasan.gagal_tv} l="Gagal" c="#b91c1c" />
                        <AngkaRingkas n={ringkasan.belum_tv} l="Belum" c="#64748b" />
                      </div>
                    )}
                  </div>

                  {perluAlasan ? (
                    <div className="rounded-xl px-3 py-2.5" style={{ background: '#fff7ed', border: '1px solid #fdba74' }}>
                      <label className="block text-xs font-bold mb-1 uppercase tracking-widest" style={{ color: '#c2410c' }}>
                        Alasan tidak semua TV selesai <span className="text-red-600">*</span>
                      </label>
                      <p className="text-[11px] mb-2 leading-relaxed" style={{ color: '#7c2d12' }}>
                        {ringkasan!.total_tv - ringkasan!.selesai_tv} dari {ringkasan!.total_tv} TV belum selesai.
                        Jelaskan kendalanya — laporan ini akan direview admin, bukan otomatis dianggap selesai.
                      </p>
                      <textarea value={catatan} onChange={e => setCatatan(e.target.value)} rows={3}
                        placeholder="Contoh: TV lantai 3 mati total, sudah dilaporkan ke teknisi gedung untuk perbaikan."
                        className="w-full border border-orange-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white" />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">
                        Catatan <span className="normal-case font-normal text-slate-300">(opsional)</span>
                      </label>
                      <textarea value={catatan} onChange={e => setCatatan(e.target.value)} rows={2}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-400" />
                    </div>
                  )}
                  {hasil && (
                    <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${hasil.tipe === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                      {hasil.tipe === 'ok' ? '✅' : '⚠️'} {hasil.teks}
                    </div>
                  )}
                  <button type="button" disabled={!coords || submitting} onClick={submitCheckOut}
                    className="w-full py-3.5 rounded-xl text-white font-bold text-sm disabled:opacity-40" style={{ background: '#1d4ed8' }}>
                    {submitting ? 'Mengirim…' : 'Submit'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 2 (checkin saja): foto + catatan + submit ── */}
        {mode === 'checkin' && step === 2 && (
          <div className="flex flex-col h-full">
            <div className="flex-1 min-h-[260px] bg-slate-900 relative flex items-center justify-center">
              {fotoPreview ? (
                <img src={fotoPreview} alt="Pratinjau foto" className="w-full h-full object-cover" />
              ) : (
                // Sebelumnya ikon+teks polos melayang di kanvas gelap - tidak
                // terlihat seperti tombol sama sekali (dilaporkan PIC lapangan:
                // "tidak paham kalau harus klik"). Sekarang dibuat SEPERTI
                // tombol rana kamera sungguhan: lingkaran putih besar +
                // bingkai putus-putus di sekelilingnya + instruksi "Ketuk...".
                <label className="flex flex-col items-center gap-3 cursor-pointer px-6 text-center w-full h-full justify-center border-2 border-dashed border-white/30 m-3 rounded-2xl active:bg-white/5 transition-colors">
                  <span className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-lg" aria-hidden="true">
                    <svg className="w-9 h-9" fill="none" stroke="#1d4ed8" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </span>
                  <span className="text-white font-bold text-base">Ketuk di sini untuk ambil foto</span>
                  <span className="text-white/60 text-xs">Kamera akan terbuka otomatis</span>
                  <input type="file" accept="image/*" capture="user" className="hidden"
                    onChange={e => pilihFoto(e.target.files?.[0] ?? null)} />
                </label>
              )}
              {fotoPreview && (
                <button type="button" onClick={() => pilihFoto(null)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center">✕</button>
              )}
            </div>
            <div className="p-4 space-y-3 flex-shrink-0">
              <div>
                <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">Catatan <span className="normal-case font-normal text-slate-300">(opsional)</span></label>
                <textarea value={catatan} onChange={e => setCatatan(e.target.value)} rows={2}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-400" />
              </div>
              {hasil && (
                <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${hasil.tipe === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  {hasil.tipe === 'ok' ? '✅' : '⚠️'} {hasil.teks}
                </div>
              )}
              <button type="button" disabled={submitting} onClick={submitCheckIn}
                className="w-full py-3.5 rounded-xl text-white font-bold text-sm disabled:opacity-40" style={{ background: '#1d4ed8' }}>
                {submitting ? 'Mengirim…' : 'Submit'}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// ── Checklist per TV (execution point) ──────────────────────────────────
// task_Prompt.md §15: selesai/belum HARUS diketahui per TV, bukan cuma per
// lokasi. fs_execution_point_status (015) menyimpannya; modal ini daftar
// TV di lokasi tugas ini + status masing-masing, tap satu untuk mengisinya.

interface FsPoint { id: string; name: string; floor: string | null; }
interface PointStatusRow {
  execution_point_id: string; status: string; notes: string | null; review_status: string;
  /** Alasan kegagalan - wajib saat status Gagal/Kendala (migrasi 022). Status
   *  merah tanpa alasan tidak bisa ditindaklanjuti siapa pun: admin tidak tahu
   *  apakah harus kirim teknisi, menghubungi gedung, atau mengganti file. */
  failure_reason: string | null; failure_detail: string | null;
  /** Catatan revisi dari client, per TV - inilah yang harus dibaca PIC
   *  sebelum mengulang pekerjaan. */
  review_notes: string | null;
}
interface TvEvidenceRow {
  id: string; bucket: string; path: string; thumbPath: string | null; created_at: string;
  /** URL thumbnail (029) - untuk baris lama tanpa thumb_path, ini adalah
   *  signed URL foto penuh juga (fallback di muatFotoLama). Foto ukuran
   *  penuh yang SEBENARNYA baru diminta saat pengguna membuka lewat
   *  bukaFotoPenuh - tidak dimuat otomatis untuk semua foto di galeri. */
  thumbUrl: string | null;
}

function TvChecklistModal({ task, userId, onClose }: { task: Task; userId: string; onClose: () => void }) {
  const [points, setPoints] = useState<FsPoint[]>([]);
  const [statuses, setStatuses] = useState<Record<string, PointStatusRow>>({});
  const [loading, setLoading] = useState(true);
  const [aktifPoint, setAktifPoint] = useState<FsPoint | null>(null);

  const muat = useCallback(async () => {
    if (!task.locationId || !task.instanceId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: pts }, { data: sts }] = await Promise.all([
      supabase.from('fs_execution_points').select('id, name, floor').eq('location_id', task.locationId).eq('status', 'active').order('name'),
      supabase.from('fs_execution_point_status').select('execution_point_id, status, notes, review_status, failure_reason, failure_detail, review_notes').eq('execution_instance_id', task.instanceId),
    ]);
    setPoints((pts ?? []) as FsPoint[]);
    const peta: Record<string, PointStatusRow> = {};
    for (const s of (sts ?? []) as PointStatusRow[]) peta[s.execution_point_id] = s;
    setStatuses(peta);
    setLoading(false);
  }, [task.locationId, task.instanceId]);

  useEffect(() => { void muat(); }, [muat]);

  const selesai = points.filter(p => statuses[p.id]?.status === 'COMPLETED').length;

  return (
    // Pola sama seperti CheckWizard - full-bleed di HP, dialog terpusat &
    // dibatasi lebarnya di laptop.
    <div className="fixed inset-0 z-[1000] bg-black/50 sm:flex sm:items-center sm:justify-center">
      <div className="bg-white flex flex-col w-full h-full sm:max-w-md sm:h-[85vh] sm:rounded-2xl sm:shadow-2xl overflow-hidden">
      <div className="flex-shrink-0 px-4 py-4" style={{ background: '#4338ca' }}>
        <div className="flex items-center justify-between text-white">
          <button type="button" onClick={onClose} aria-label="Kembali" className="p-1">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div className="text-center">
            <p className="font-bold text-lg leading-none">Checklist TV</p>
            <p className="text-xs text-white/80 mt-1">{selesai}/{points.length} selesai</p>
          </div>
          <div className="w-5" />
        </div>
        <div className="mt-3 bg-white rounded-xl px-4 py-3">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{task.locationName}</p>
          {task.contentName && <p className="text-xs text-indigo-600 mt-0.5">🖼️ {task.contentName} (v{task.contentVersion})</p>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Memuat…</p>
        ) : points.length === 0 ? (
          <EmptyState icon="📺" title="Belum ada TV terdaftar" description="Admin belum mendaftarkan execution point untuk lokasi ini." />
        ) : (
          <div className="space-y-2">
            {points.map(pt => {
              const st = statuses[pt.id];
              // Fallback ke NOT_STARTED kalau status-nya tidak dikenal map ini -
              // sebelumnya diakses langsung tanpa fallback dan crash total pada
              // TV berstatus REVISION_REQUIRED (lihat lib/fs-status.ts).
              const label = FS_TV_STATUS_LABEL[st?.status ?? 'NOT_STARTED'] ?? FS_TV_STATUS_LABEL.NOT_STARTED;
              return (
                <button key={pt.id} type="button" onClick={() => setAktifPoint(pt)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 flex items-center justify-between gap-2 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{pt.name}</p>
                    {pt.floor && <p className="text-xs text-slate-400">{pt.floor}</p>}
                    {st?.review_status === 'APPROVED' && <p className="text-[10px] text-emerald-600 font-bold mt-0.5">✅ Disetujui provider</p>}
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap"
                    style={{ color: label.color, background: label.bg }}>
                    {label.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {aktifPoint && (
        <TvPointPanel point={aktifPoint} task={task} userId={userId} existing={statuses[aktifPoint.id] ?? null}
          onClose={() => setAktifPoint(null)} onSaved={() => { setAktifPoint(null); void muat(); }} />
      )}
      </div>
    </div>
  );
}

/** Satu angka pada ringkasan hasil kerja di layar check-out. */
function AngkaRingkas({ n, l, c }: { n: number; l: string; c: string }) {
  return (
    <div className="py-2 text-center">
      <p className="text-lg font-black leading-none tabular-nums" style={{ color: c }}>{n}</p>
      <p className="text-[10px] font-semibold text-slate-500 mt-1">{l}</p>
    </div>
  );
}

function TvPointPanel({ point, task, userId, existing, onClose, onSaved }: {
  point: FsPoint; task: Task; userId: string; existing: PointStatusRow | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState(existing?.status ?? 'COMPLETED');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [alasanGagal, setAlasanGagal] = useState(existing?.failure_reason ?? '');
  const [rincianGagal, setRincianGagal] = useState(existing?.failure_detail ?? '');
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState('');
  const [menyimpan, setMenyimpan] = useState(false);
  const [hasil, setHasil] = useState<{ tipe: 'ok' | 'gagal'; teks: string } | null>(null);
  const [fotoLama, setFotoLama] = useState<TvEvidenceRow[]>([]);
  const [menghapusFoto, setMenghapusFoto] = useState<string | null>(null);
  const [confirmHapus, setConfirmHapus] = useState<ConfirmState | null>(null);

  // review_status='APPROVED' (provider sudah setuju) - RLS
  // fs_execution_point_status_update (018) sudah menolak UPDATE dari PIC
  // begitu ini APPROVED; panel dikunci di sisi UI juga supaya PIC tidak
  // mengisi form lalu baru tahu simpannya gagal.
  const terkunci = existing?.review_status === 'APPROVED';

  const muatFotoLama = useCallback(async () => {
    if (!task.instanceId) return;
    const { data } = await supabase.from('fs_evidence').select('id, bucket, path, thumb_path, created_at')
      .eq('execution_instance_id', task.instanceId).eq('execution_point_id', point.id).order('created_at');
    type Raw = { id: string; bucket: string; path: string; thumb_path: string | null; created_at: string };
    // Galeri cuma memuat THUMBNAIL (029) - kecil, murah walau semuanya
    // dimuat sekaligus. Foto ukuran penuh baru diminta lewat bukaFotoPenuh
    // saat pengguna sungguh membukanya. Baris lama tanpa thumb_path fallback
    // ke foto penuh (satu-satunya yang ada) - tetap tampil, cuma tidak hemat.
    const withUrl = await Promise.all(((data ?? []) as Raw[]).map(async r => ({
      id: r.id, bucket: r.bucket, path: r.path, thumbPath: r.thumb_path, created_at: r.created_at,
      thumbUrl: await ambilSignedUrl(r.bucket, r.thumb_path ?? r.path).catch(() => null),
    })));
    setFotoLama(withUrl);
  }, [task.instanceId, point.id]);

  const bukaFotoPenuh = async (f: TvEvidenceRow) => {
    const url = await ambilSignedUrl(f.bucket, f.path);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => { void muatFotoLama(); }, [muatFotoLama]);

  const pilihFoto = (f: File | null) => {
    setFoto(f);
    if (fotoPreview) URL.revokeObjectURL(fotoPreview);
    setFotoPreview(f ? URL.createObjectURL(f) : '');
  };

  const hapusFotoLama = async (foto: TvEvidenceRow) => {
    setMenghapusFoto(foto.id);
    // Hapus berkasnya di storage (bukan cuma baris metadata) - persis pola
    // "Hapus Foto" provider di field-service/page.tsx, sekarang untuk PIC
    // sendiri lewat fs_evidence_storage_delete_own_pending (018). Thumbnail
    // (029) ikut dihapus - kalau tidak, jadi berkas yatim yang tetap makan
    // storage walau baris metadatanya sudah hilang.
    const berkas = foto.thumbPath ? [foto.path, foto.thumbPath] : [foto.path];
    const { error: errStorage } = await supabase.storage.from('fs-evidence').remove(berkas);
    if (errStorage) { setMenghapusFoto(null); setHasil({ tipe: 'gagal', teks: 'Gagal menghapus foto: ' + errStorage.message }); return; }
    lupakanSignedUrl('fs-evidence', foto.path);
    if (foto.thumbPath) lupakanSignedUrl('fs-evidence', foto.thumbPath);
    const { error: errRow } = await supabase.from('fs_evidence').delete().eq('id', foto.id);
    setMenghapusFoto(null);
    if (errRow) { setHasil({ tipe: 'gagal', teks: 'Foto terhapus dari storage tapi baris metadata gagal dihapus: ' + errRow.message }); return; }
    void muatFotoLama();
  };

  const mintaHapusFotoLama = (foto: TvEvidenceRow) => setConfirmHapus({
    message: 'Hapus foto ini permanen?',
    description: 'Berkasnya dihapus dari storage cloud (bukan cuma disembunyikan). Tidak bisa dibatalkan.',
    danger: true, confirmLabel: 'Hapus Foto',
    onConfirm: () => hapusFotoLama(foto),
  });

  /** Gagal/Kendala HARUS punya alasan. Tanpa ini status merah cuma bilang
   *  "ada yang salah" tanpa memberi tahu siapa pun apa langkah berikutnya -
   *  admin tidak tahu apakah perlu kirim teknisi lagi, menghubungi pengelola
   *  gedung, atau mengganti file kontennya. */
  const butuhAlasan = status === 'FAILED' || status === 'EXCEPTION';

  const simpan = async () => {
    if (terkunci) return;
    if (!task.instanceId || !task.workSessionId) { setHasil({ tipe: 'gagal', teks: 'Sesi kerja tidak aktif.' }); return; }
    if (butuhAlasan && !alasanGagal) {
      setHasil({ tipe: 'gagal', teks: 'Pilih alasan kenapa TV ini tidak berhasil diupdate.' });
      return;
    }
    if (butuhAlasan && alasanGagal === 'OTHER' && !rincianGagal.trim()) {
      setHasil({ tipe: 'gagal', teks: 'Alasan "Lainnya" harus dijelaskan singkat.' });
      return;
    }
    // Foto WAJIB - bukti fisik per TV, bukan checklist yang cuma diketik.
    // Cukup salah satu: foto baru dipilih SEKARANG, atau TV ini sudah punya
    // foto tersimpan dari sebelumnya (tidak perlu foto ulang kalau cuma ganti
    // status/catatan pada foto yang sama).
    if (!foto && fotoLama.length === 0) {
      setHasil({ tipe: 'gagal', teks: 'Foto wajib diisi sebagai bukti — ambil/pilih foto TV dulu.' });
      return;
    }
    setMenyimpan(true);
    try {
      if (foto) {
        // Wajib dikompres + thumbnail (029) - lihat catatan yang sama di
        // unggahEvidence check-in/out.
        const basePath = `${task.instanceId}/tv-${point.id}-${Date.now()}`;
        const hasil = await unggahFotoDenganThumbnail(basePath, foto);
        if (hasil) {
          await supabase.from('fs_evidence').insert({
            execution_instance_id: task.instanceId, work_session_id: task.workSessionId,
            execution_point_id: point.id, bucket: 'fs-evidence',
            path: hasil.path, thumb_path: hasil.thumbPath,
            mime_type: hasil.mimeType, size_bytes: hasil.sizeBytes, uploaded_by: userId,
          });
        }
      }
      const { error } = await supabase.from('fs_execution_point_status').upsert({
        execution_instance_id: task.instanceId, execution_point_id: point.id,
        status, notes: notes.trim() || null, marked_by: userId, marked_at: new Date().toISOString(),
        // Dikosongkan lagi kalau statusnya berubah jadi berhasil - alasan
        // kegagalan lama tidak boleh tertinggal menempel pada TV yang
        // akhirnya beres.
        failure_reason: butuhAlasan ? alasanGagal : null,
        failure_detail: butuhAlasan ? (rincianGagal.trim() || null) : null,
      }, { onConflict: 'execution_instance_id,execution_point_id' });
      if (error) { setHasil({ tipe: 'gagal', teks: error.message }); setMenyimpan(false); return; }
      setHasil({ tipe: 'ok', teks: 'Tersimpan.' });
      setMenyimpan(false);
      window.setTimeout(onSaved, 700);
    } catch (e) {
      setHasil({ tipe: 'gagal', teks: e instanceof Error ? e.message : 'Gagal menyimpan.' });
      setMenyimpan(false);
    }
  };

  // Bahasa lapangan, bukan istilah database: "Exception" diganti "Ada Kendala".
  const opsiStatus: { value: string; label: string; warna: string }[] = [
    { value: 'COMPLETED', label: 'Berhasil Diupdate', warna: '#047857' },
    { value: 'FAILED', label: 'Gagal', warna: '#b91c1c' },
    { value: 'EXCEPTION', label: 'Ada Kendala', warna: '#b45309' },
    { value: 'SKIPPED', label: 'Dilewati', warna: '#64748b' },
  ];

  const ALASAN: { value: string; label: string }[] = [
    { value: 'TV_OFFLINE', label: 'TV mati / offline' },
    { value: 'NETWORK', label: 'Jaringan bermasalah' },
    { value: 'DEVICE', label: 'Perangkat rusak' },
    { value: 'CONTENT', label: 'File konten bermasalah' },
    { value: 'ACCESS', label: 'Tidak bisa akses ruangan' },
    { value: 'OTHER', label: 'Lainnya' },
  ];

  return (
    <div className="fixed inset-0 z-[1100] bg-black/50 flex items-end sm:items-center sm:justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto p-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold text-slate-800">{point.name}</p>
            {point.floor && <p className="text-xs text-slate-400">{point.floor}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
        </div>

        {terkunci && (
          <div className="rounded-lg px-3 py-2 text-xs font-semibold mb-3 bg-emerald-50 text-emerald-700">
            ✅ Sudah disetujui provider — tidak bisa diedit atau dihapus lagi.
          </div>
        )}

        <label className="block text-xs font-bold mb-1.5 text-slate-600 uppercase tracking-widest">Status</label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {opsiStatus.map(o => (
            <button key={o.value} type="button" disabled={terkunci} onClick={() => setStatus(o.value)}
              className="text-sm font-bold py-2 rounded-lg border-2 transition-colors disabled:opacity-50"
              style={status === o.value
                ? { borderColor: o.warna, background: `${o.warna}1a`, color: o.warna }
                : { borderColor: '#e2e8f0', background: '#fff', color: '#64748b' }}>
              {o.label}
            </button>
          ))}
        </div>

        {/* Permintaan revisi dari client untuk TV INI - hal pertama yang perlu
            dibaca PIC sebelum mengulang, bukan disembunyikan di layar lain. */}
        {existing?.review_notes && (
          <div className="rounded-xl px-3 py-2.5 mb-3" style={{ background: '#ffedd5', border: '1px solid #fdba74' }}>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: '#c2410c' }}>
              Diminta diulang oleh client
            </p>
            <p className="text-xs leading-relaxed" style={{ color: '#7c2d12' }}>{existing.review_notes}</p>
          </div>
        )}

        {butuhAlasan && (
          <div className="mb-3">
            <label className="block text-xs font-bold mb-1.5 text-slate-600 uppercase tracking-widest">
              Kenapa tidak berhasil? <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {ALASAN.map(a => (
                <button key={a.value} type="button" disabled={terkunci}
                  onClick={() => setAlasanGagal(a.value)}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                  style={alasanGagal === a.value
                    ? { borderColor: '#b91c1c', background: '#fee2e2', color: '#b91c1c' }
                    : { borderColor: '#e2e8f0', background: '#fff', color: '#64748b' }}>
                  {a.label}
                </button>
              ))}
            </div>
            <input value={rincianGagal} onChange={e => setRincianGagal(e.target.value)} disabled={terkunci}
              placeholder={alasanGagal === 'OTHER' ? 'Jelaskan singkat (wajib)' : 'Keterangan tambahan — opsional'}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-400 disabled:opacity-50 disabled:bg-slate-50" />
          </div>
        )}

        <label className="block text-xs font-bold mb-1.5 text-slate-600 uppercase tracking-widest">
          Catatan <span className="normal-case font-normal text-slate-300">— opsional</span>
        </label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} disabled={terkunci}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-400 mb-3 disabled:opacity-50 disabled:bg-slate-50" />

        {fotoLama.length > 0 && (
          <div className="mb-3">
            <label className="block text-xs font-bold mb-1.5 text-slate-600 uppercase tracking-widest">Foto Tersimpan</label>
            <div className="grid grid-cols-3 gap-2">
              {fotoLama.map(f => (
                <div key={f.id} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100">
                  {f.thumbUrl && (
                    <button type="button" onClick={() => void bukaFotoPenuh(f)}
                      aria-label="Lihat foto ukuran penuh" className="block w-full h-full cursor-zoom-in">
                      <img src={f.thumbUrl} alt="Foto TV tersimpan" className="w-full h-full object-cover" />
                    </button>
                  )}
                  {!terkunci && (
                    <button type="button" disabled={menghapusFoto === f.id} onClick={() => mintaHapusFotoLama(f)}
                      aria-label="Hapus foto ini"
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center text-xs disabled:opacity-50">
                      {menghapusFoto === f.id ? '…' : '✕'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <label className="block text-xs font-bold mb-1.5 text-slate-600 uppercase tracking-widest">
          {fotoLama.length > 0 ? 'Tambah Foto' : 'Foto'}{' '}
          {fotoLama.length === 0 && <span className="normal-case font-normal text-rose-500">— wajib, bukti fisik TV ini</span>}
        </label>
        <div className="mb-3">
          {terkunci ? null : fotoPreview ? (
            <div className="relative w-full h-40 rounded-xl overflow-hidden bg-slate-900">
              <img src={fotoPreview} alt="Pratinjau foto" className="w-full h-full object-cover" />
              <button type="button" onClick={() => pilihFoto(null)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center">✕</button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-1.5 h-32 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/40 text-blue-700 cursor-pointer active:bg-blue-50">
              <span className="w-11 h-11 rounded-full bg-white shadow flex items-center justify-center text-2xl" aria-hidden="true">📷</span>
              <span className="text-[13px] font-bold">Ketuk untuk ambil foto TV ini</span>
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => pilihFoto(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        {hasil && (
          <div className={`rounded-lg px-3 py-2 text-sm font-semibold mb-3 ${hasil.tipe === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            {hasil.tipe === 'ok' ? '✅' : '⚠️'} {hasil.teks}
          </div>
        )}

        {!terkunci && (
          <button type="button" disabled={menyimpan || (!foto && fotoLama.length === 0)} onClick={simpan}
            className="w-full py-3 rounded-xl text-white font-bold text-sm disabled:opacity-40" style={{ background: '#4338ca' }}>
            {menyimpan ? 'Menyimpan…' : 'Simpan'}
          </button>
        )}
      </div>
      <ConfirmDialog state={confirmHapus} onCancel={() => setConfirmHapus(null)} />
    </div>
  );
}
