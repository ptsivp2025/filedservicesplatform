'use client';

/**
 * app/field-service/page.tsx - Location Master + Assign PIC.
 *
 * Dimuat lewat iframe internal di dalam frame dashboard (lihat allMenuItems
 * "Field Service" -> item internal di app/dashboard/page.tsx), sama seperti
 * modul lama (Ticketing dkk) dulu dimuat. `?tab=` di URL menentukan tab mana
 * yang aktif saat sidebar membuka salah satu dari empat sub-item (Project/
 * Lokasi/Execution Point/Assign PIC) - tab bar di dalam halaman ini tetap ada
 * supaya pindah tab TIDAK memuat ulang iframe (state seperti project/lokasi
 * yang sedang dipilih tidak ikut hilang, beda dari pindah lewat sidebar yang
 * memuat ulang iframe ke ?tab= baru).
 *
 * middleware.ts sudah melindungi route ini lewat cookie ivp_session, jadi di
 * sini cukup memulihkan token PostgREST (lib/supabase.ts) supaya query
 * membawa identitas dan tunduk pada RLS fs_* (supabase/migrations/006).
 *
 * Otorisasi SESUNGGUHNYA ada di RLS (fs_is_provider_admin/fs_is_provider),
 * bukan di sini - halaman ini hanya menyembunyikan tombol yang pasti akan
 * ditolak server, supaya tidak membingungkan.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, setDbToken } from '@/lib/supabase';
import { hasFullAccess } from '@/lib/constants';
import {
  PageHeader, FormField, EmptyState, SectionHeaderSmall, ConfirmDialog, MiniPieChart,
  SearchableSelect, Modal, TombolModal, DonutLegenda, TabelRingkas, type ConfirmState,
  KartuOperasional as Kartu, JudulPanel, UbinKpi, DialogBesar, KosongOperasional as Kosong, HeaderDrill,
} from '@/components/shared';
import {
  ambilOverview, ambilBuildingProgress, CYCLE_STATUS_LABEL, persen, warnaProgress, rentangTanggal,
  type Cycle, type CycleOverview, type BuildingProgress,
} from '@/lib/fs-cycle';
import {
  Activity, AlertTriangle, Building2, CalendarDays, CheckCircle2, Clock,
  Image as ImageIcon, Map as MapIconLucide, Tv, Users,
} from 'lucide-react';
import { useMerek, gradasiLatarPlatform } from '@/lib/merek';
import { kirimNotifikasi } from '@/lib/notifikasi/router';
import { unduhCsv } from '@/lib/csv';
import { FS_STATUS_LABEL } from '@/lib/fs-status';
import { DetailEksekusi } from './_components/DetailEksekusi';
import { ReviewSiklus } from './_components/ReviewSiklus';
import { KelolaSiklus } from './_components/KelolaSiklus';
import 'leaflet/dist/leaflet.css';

interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  role: string;
  access_level?: string | null;
  fs_role?: string | null;
}

interface FsProject {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
  allow_multi_pic: boolean;
}

interface FsContent {
  id: string;
  project_id: string;
  name: string;
  version: number;
  valid_from: string;
  valid_until: string;
  file_url: string | null;
  status: string;
}

interface FsArea {
  id: string;
  project_id: string;
  name: string;
}

interface FsLocation {
  id: string;
  project_id: string;
  area_id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  gps_radius_m: number;
  status: string;
}

interface FsExecutionPoint {
  id: string;
  location_id: string;
  name: string;
  floor: string | null;
  status: string;
}

interface FsPicAssignment {
  id: string;
  project_id: string;
  location_id: string;
  execution_point_id: string | null;
  user_id: string;
  effective_date: string;
  end_date: string | null;
  active: boolean;
}

interface UserOption {
  id: string;
  full_name: string;
  username: string;
  fs_role: string | null;
}

// 'projects' dihapus - dipindah ke Admin Panel (bukan operasional harian).
// 'points'/'assignments' dihapus - dilebur ke 'locations' (LocationDetailModal).
type Tab = 'locations' | 'content' | 'review' | 'cycles';

function Notice({ pesan }: { pesan: { tipe: 'ok' | 'gagal'; teks: string } | null }) {
  if (!pesan) return null;
  const ok = pesan.tipe === 'ok';
  return (
    <div
      className="rounded-xl px-4 py-2.5 text-sm font-semibold mb-4"
      style={ok
        ? { background: 'rgba(16,185,129,0.1)', color: '#047857', border: '1px solid rgba(16,185,129,0.35)' }
        : { background: 'rgba(239,68,68,0.1)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.35)' }}
    >
      {pesan.teks}
    </div>
  );
}

const inputCls = 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-400 bg-white';
const btnCls = 'text-sm font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 flex-shrink-0';

/** Multi-select generik untuk daftar mana pun di halaman ini - dipakai
 *  bareng tombol Hapus massal (checkbox per baris + "pilih semua" + bar
 *  aksi), supaya perilakunya konsisten di semua tab, bukan diketik ulang
 *  beda-beda tiap tab. */
function useSeleksi() {
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setDipilih(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleSemua = (ids: string[]) => setDipilih(s =>
    (ids.length > 0 && ids.every(id => s.has(id))) ? new Set() : new Set(ids));
  const kosongkan = () => setDipilih(new Set());
  return { dipilih, toggle, toggleSemua, kosongkan };
}

/** Bar aksi hapus massal - muncul begitu ada baris tercentang. */
function BarHapusMassal({ jumlah, onHapus, sedangHapus }: { jumlah: number; onHapus: () => void; sedangHapus: boolean }) {
  if (jumlah === 0) return null;
  return (
    <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 flex items-center justify-between gap-2">
      <span className="text-xs font-bold text-rose-700">{jumlah} dipilih</span>
      <button type="button" onClick={onHapus} disabled={sedangHapus}
        className="text-xs font-bold px-3 py-1.5 rounded-lg text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 flex-shrink-0">
        {sedangHapus ? 'Menghapus…' : `🗑️ Hapus (${jumlah})`}
      </button>
    </div>
  );
}

/**
 * Parser CSV kecil (bukan library baru) - cukup untuk kebutuhan import di
 * sini: menangani field berkutip (`"..."`) yang boleh berisi koma atau baris
 * baru, dan `""` sebagai tanda kutip literal di dalam field berkutip (aturan
 * RFC 4180). Baris kosong di ujung berkas diabaikan.
 */
function uraikanCsv(teks: string): string[][] {
  const baris: string[][] = [];
  let kolom: string[] = [];
  let field = '';
  let dalamKutip = false;
  const teksBersih = teks.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < teksBersih.length; i++) {
    const c = teksBersih[i];
    if (dalamKutip) {
      if (c === '"') {
        if (teksBersih[i + 1] === '"') { field += '"'; i++; } else { dalamKutip = false; }
      } else field += c;
    } else if (c === '"') {
      dalamKutip = true;
    } else if (c === ',') {
      kolom.push(field); field = '';
    } else if (c === '\n') {
      kolom.push(field); field = '';
      baris.push(kolom); kolom = [];
    } else {
      field += c;
    }
  }
  kolom.push(field);
  if (kolom.some(k => k.trim() !== '') || baris.length === 0) baris.push(kolom);
  return baris.filter(b => b.some(k => k.trim() !== ''));
}

/**
 * Import lokasi massal dari CSV - untuk onboarding ratusan/ribuan lokasi
 * sekaligus (satu-satunya cara sebelumnya adalah form satu-per-satu, lihat
 * docs/AUDIT-CONFIGURABILITY-NOTIFICATIONS-2026-09.md temuan HIGH ketiga).
 * Area yang disebut CSV tapi belum ada di project ini otomatis dibuat -
 * onboarding klien baru biasanya juga berarti area barunya belum ada sama
 * sekali, jadi mewajibkan area dibuat dulu satu-satu di UI sebelum import
 * akan menghilangkan sebagian besar manfaat "sekaligus"-nya.
 */
function ImportLokasiCsv({ areas, selectedProjectId, onReloadAreas, onReloadLocations, beritahu }: {
  areas: FsArea[];
  selectedProjectId: string;
  onReloadAreas: () => void;
  onReloadLocations: () => void;
  beritahu: (tipe: 'ok' | 'gagal', teks: string) => void;
}) {
  const [memproses, setMemproses] = useState(false);
  const [hasil, setHasil] = useState<{ berhasil: number; gagal: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const prosesFile = async (file: File) => {
    setMemproses(true); setHasil(null);
    try {
      const teks = await file.text();
      const baris = uraikanCsv(teks);
      if (baris.length < 2) { beritahu('gagal', 'CSV kosong atau cuma berisi header.'); setMemproses(false); return; }
      const header = baris[0].map(h => h.trim().toLowerCase());
      const idx = (nama: string) => header.indexOf(nama);
      const iNama = idx('name'), iArea = idx('area'), iAlamat = idx('address'),
        iLat = idx('latitude'), iLng = idx('longitude'), iRadius = idx('gps_radius_m');
      if (iNama < 0 || iArea < 0 || iLat < 0 || iLng < 0) {
        beritahu('gagal', 'Header CSV wajib punya kolom: name, area, latitude, longitude (address & gps_radius_m opsional).');
        setMemproses(false);
        return;
      }

      const areaMap = new Map(areas.map(a => [a.name.trim().toLowerCase(), a.id]));
      const namaAreaBaru = new Set<string>();
      for (const row of baris.slice(1)) {
        const namaArea = (row[iArea] ?? '').trim();
        if (namaArea && !areaMap.has(namaArea.toLowerCase())) namaAreaBaru.add(namaArea);
      }
      for (const nama of namaAreaBaru) {
        const { data, error } = await supabase.from('fs_areas')
          .insert({ project_id: selectedProjectId, name: nama }).select('id').single();
        if (!error && data) areaMap.set(nama.toLowerCase(), (data as { id: string }).id);
      }

      const payload: Record<string, unknown>[] = [];
      const gagal: string[] = [];
      for (let r = 1; r < baris.length; r++) {
        const row = baris[r];
        const nama = (row[iNama] ?? '').trim();
        const namaArea = (row[iArea] ?? '').trim();
        const lat = Number((row[iLat] ?? '').trim());
        const lng = Number((row[iLng] ?? '').trim());
        const areaId = areaMap.get(namaArea.toLowerCase());
        if (!nama || !areaId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          gagal.push(`Baris ${r + 1}: ${nama || '(nama kosong)'} - data tidak lengkap/area tidak valid`);
          continue;
        }
        const radiusMentah = iRadius >= 0 ? Number((row[iRadius] ?? '').trim()) : NaN;
        payload.push({
          project_id: selectedProjectId, area_id: areaId, name: nama,
          address: iAlamat >= 0 ? ((row[iAlamat] ?? '').trim() || null) : null,
          latitude: lat, longitude: lng,
          gps_radius_m: Number.isFinite(radiusMentah) && radiusMentah > 0 ? Math.round(radiusMentah) : 100,
        });
      }

      let berhasil = 0;
      // Batch per 200 baris - satu query per baris tidak realistis untuk ribuan lokasi.
      for (let i = 0; i < payload.length; i += 200) {
        const potongan = payload.slice(i, i + 200);
        const { error } = await supabase.from('fs_locations').insert(potongan);
        if (error) gagal.push(`Baris ${i + 2}-${i + 1 + potongan.length}: ${error.message}`);
        else berhasil += potongan.length;
      }

      setHasil({ berhasil, gagal });
      if (namaAreaBaru.size > 0) onReloadAreas();
      if (berhasil > 0) onReloadLocations();
      beritahu(gagal.length === 0 ? 'ok' : 'gagal',
        gagal.length === 0 ? `${berhasil} lokasi berhasil diimpor.` : `${berhasil} lokasi berhasil, ${gagal.length} baris bermasalah.`);
    } catch (e) {
      beritahu('gagal', 'Gagal membaca file: ' + (e instanceof Error ? e.message : String(e)));
    }
    setMemproses(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400 leading-relaxed">
        Untuk onboarding banyak lokasi sekaligus (ratusan/ribuan). Kolom wajib: <code className="font-mono">name, area, latitude, longitude</code>.
        Opsional: <code className="font-mono">address, gps_radius_m</code>. Area yang belum ada otomatis dibuat.
      </p>
      <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={memproses || !selectedProjectId}
        onChange={e => { const f = e.target.files?.[0]; if (f) void prosesFile(f); }}
        className="w-full text-xs" />
      {!selectedProjectId && <p className="text-xs text-amber-600">Pilih project dulu.</p>}
      {memproses && <p className="text-xs text-indigo-500">Memproses…</p>}
      {hasil && hasil.gagal.length > 0 && (
        <div className="rounded-lg bg-rose-50 border border-rose-100 p-2 max-h-32 overflow-y-auto space-y-0.5">
          {hasil.gagal.map((g, i) => <p key={i} className="text-[10px] text-rose-600">{g}</p>)}
        </div>
      )}
    </div>
  );
}

/** Checkbox "pilih semua" di header daftar. */
function CentangSemua({ ids, dipilih, toggleSemua }: { ids: string[]; dipilih: Set<string>; toggleSemua: (ids: string[]) => void }) {
  const semuaTercentang = ids.length > 0 && ids.every(id => dipilih.has(id));
  return (
    <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 cursor-pointer select-none flex-shrink-0">
      <input type="checkbox" checked={semuaTercentang} onChange={() => toggleSemua(ids)}
        className="w-3.5 h-3.5 rounded border-slate-300 accent-rose-600" />
      Pilih semua
    </label>
  );
}

const TAB_VALUES: Tab[] = ['locations', 'content', 'review', 'cycles'];

/** Baca ?tab= dari URL sekali di awal - dipakai saat sidebar dashboard
 *  membuka salah satu sub-item Field Service secara langsung. */
function tabDariUrl(): Tab {
  if (typeof window === 'undefined') return 'locations';
  const nilai = new URLSearchParams(window.location.search).get('tab');
  return (TAB_VALUES as string[]).includes(nilai ?? '') ? (nilai as Tab) : 'locations';
}

/**
 * Peta interaktif untuk memilih koordinat lokasi - klik peta atau geser pin,
 * langsung terisi ke Latitude/Longitude. Ini yang sebelumnya hilang: admin
 * harus menebak koordinat lewat link Google Maps di tab baru, padahal
 * platform lain biasanya punya peta langsung di dalam form.
 *
 * Leaflet + tile OpenStreetMap (gratis, tanpa API key) - diimpor dinamis di
 * dalam useEffect, bukan di puncak modul, karena modul Leaflet menyentuh
 * `window` saat dimuat dan akan gagal saat Next.js merender komponen ini di
 * server terlebih dahulu.
 */
function MapPicker({ lat, lng, onPick }: { lat: number | null; lng: number | null; onPick: (lat: number, lng: number) => void }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markerRef = useRef<import('leaflet').Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    let dibatalkan = false;
    import('leaflet').then((L) => {
      if (dibatalkan || !elRef.current || mapRef.current) return;
      // Default: Jakarta - hanya dipakai saat lokasi belum punya koordinat sama sekali.
      const mulai: [number, number] = [lat ?? -6.2, lng ?? 106.816666];
      const map = L.map(elRef.current).setView(mulai, lat != null ? 16 : 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      const icon = L.divIcon({
        html: '<div style="font-size:30px;line-height:30px;transform:translate(-50%,-90%);filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">📍</div>',
        className: '', iconSize: [0, 0],
      });
      const marker = L.marker(mulai, { draggable: true, icon }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onPickRef.current(p.lat, p.lng);
      });
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        onPickRef.current(e.latlng.lat, e.latlng.lng);
      });
      mapRef.current = map;
      markerRef.current = marker;
    });
    return () => {
      dibatalkan = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; }
    };
    // Sengaja hanya sekali - peta dibuat sekali, posisi berikutnya disinkron
    // lewat efek terpisah di bawah supaya klik/geser pengguna sendiri tidak
    // memicu peta membuat ulang dirinya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sinkronkan pin saat lat/lng berubah dari LUAR peta (tempel link Maps,
  // tombol "Lokasi saya sekarang", atau ubah manual di kolom input).
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || lat == null || lng == null) return;
    const posisiSekarang = markerRef.current.getLatLng();
    if (Math.abs(posisiSekarang.lat - lat) > 1e-7 || Math.abs(posisiSekarang.lng - lng) > 1e-7) {
      markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 15));
    }
  }, [lat, lng]);

  return <div ref={elRef} className="rounded-lg border border-slate-200" style={{ height: 260 }} />;
}

/**
 * Cari alamat langsung di dalam form (Nominatim/OpenStreetMap, gratis tanpa
 * API key) - klik salah satu hasil untuk memindahkan pin peta ke sana,
 * lalu masih bisa digeser untuk presisi akhir.
 */
function useCariAlamat() {
  const [q, setQ] = useState('');
  const [hasil, setHasil] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [mencari, setMencari] = useState(false);

  useEffect(() => {
    if (q.trim().length < 3) { setHasil([]); return; }
    setMencari(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`);
        const j = await r.json();
        setHasil(Array.isArray(j) ? j : []);
      } catch { setHasil([]); }
      setMencari(false);
    }, 600);
    return () => clearTimeout(t);
  }, [q]);

  return { q, setQ, hasil, mencari, bersihkan: () => { setHasil([]); setQ(''); } };
}

export default function FieldServicePage() {
  const router = useRouter();
  const merek = useMerek();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>(tabDariUrl);
  /** Dimuat di dalam iframe dashboard? Kalau ya, sembunyikan tombol "Kembali
   *  ke Dashboard" - sidebar dashboard sudah terlihat di sekeliling iframe
   *  ini, jadi tombol itu cuma akan menavigasi iframe-nya sendiri, bukan
   *  keluar ke halaman dashboard yang sesungguhnya. */
  const [embedded, setEmbedded] = useState(false);
  const [pesan, setPesan] = useState<{ tipe: 'ok' | 'gagal'; teks: string } | null>(null);

  // Data
  const [projects, setProjects] = useState<FsProject[]>([]);
  const [areas, setAreas] = useState<FsArea[]>([]);
  const [locations, setLocations] = useState<FsLocation[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [contents, setContents] = useState<FsContent[]>([]);

  /**
   * Dipulihkan dari sessionStorage, bukan mulai kosong - sama dengan yang
   * dibaca/ditulis selector project GLOBAL di sidebar Dashboard (lihat
   * app/dashboard/page.tsx), supaya project yang aktif tetap sama begitu
   * iframe ini dimuat ulang.
   */
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return sessionStorage.getItem('fs_selected_project_id') ?? '';
  });

  const beritahu = (tipe: 'ok' | 'gagal', teks: string) => {
    setPesan({ tipe, teks });
    window.setTimeout(() => setPesan(null), 5000);
  };

  useEffect(() => {
    try { setEmbedded(window.self !== window.top); } catch { setEmbedded(true); }
  }, []);

  // ── Bootstrap sesi (mirip dashboard: pulihkan token PostgREST dulu) ──
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

  const muatProjects = useCallback(async () => {
    const { data, error } = await supabase.from('fs_projects')
      .select('id, name, client_name, status, allow_multi_pic').order('name');
    if (error) { beritahu('gagal', 'Gagal memuat project: ' + error.message); return; }
    setProjects((data ?? []) as FsProject[]);
  }, []);

  const muatContent = useCallback(async (projectId: string) => {
    if (!projectId) { setContents([]); return; }
    const { data, error } = await supabase.from('fs_content')
      .select('id, project_id, name, version, valid_from, valid_until, file_url, status')
      .eq('project_id', projectId).order('name').order('version', { ascending: false });
    if (error) { beritahu('gagal', 'Gagal memuat content: ' + error.message); return; }
    setContents((data ?? []) as FsContent[]);
  }, []);

  const muatAreas = useCallback(async (projectId: string) => {
    if (!projectId) { setAreas([]); return; }
    const { data, error } = await supabase.from('fs_areas')
      .select('id, project_id, name').eq('project_id', projectId).order('name');
    if (error) { beritahu('gagal', 'Gagal memuat area: ' + error.message); return; }
    setAreas((data ?? []) as FsArea[]);
  }, []);

  const muatLocations = useCallback(async (projectId: string) => {
    if (!projectId) { setLocations([]); return; }
    const { data, error } = await supabase.from('fs_locations')
      .select('id, project_id, area_id, name, address, latitude, longitude, gps_radius_m, status')
      .eq('project_id', projectId).order('name');
    if (error) { beritahu('gagal', 'Gagal memuat lokasi: ' + error.message); return; }
    setLocations((data ?? []) as FsLocation[]);
  }, []);

  const muatUserOptions = useCallback(async () => {
    const { data, error } = await supabase.from('users')
      .select('id, full_name, username, fs_role').order('full_name');
    if (error) { beritahu('gagal', 'Gagal memuat daftar user: ' + error.message); return; }
    setUserOptions((data ?? []) as UserOption[]);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void muatProjects();
    void muatUserOptions();
  }, [ready, muatProjects, muatUserOptions]);

  useEffect(() => {
    if (!ready) return;
    void muatAreas(selectedProjectId);
    void muatLocations(selectedProjectId);
    void muatContent(selectedProjectId);
  }, [ready, selectedProjectId, muatAreas, muatLocations, muatContent]);

  useEffect(() => {
    try { sessionStorage.setItem('fs_selected_project_id', selectedProjectId); } catch { /* diam - sekadar kenyamanan lintas tab sidebar */ }
  }, [selectedProjectId]);

  if (!ready || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Memuat…</p>
      </div>
    );
  }

  // Dua tingkat sengaja dipisah, mengikuti RLS (006) persis - bukan disamakan
  // demi kesederhanaan:
  //   - Project/Area/Location/Execution Point: fs_is_provider_admin() saja
  //     (PROVIDER_ADMIN atau Full Access) - Supervisor TIDAK bisa menulis di
  //     sini, jadi tombolnya juga tidak ditampilkan ke Supervisor (menampilkan
  //     tombol yang pasti ditolak server cuma membingungkan).
  //   - PIC Assignment: fs_is_provider() - PROVIDER_ADMIN ATAU
  //     PROVIDER_SUPERVISOR boleh menulis, jadi tombolnya ikut ditampilkan
  //     untuk Supervisor juga.
  const bolehKelolaMasterData = hasFullAccess(user) || user.fs_role === 'PROVIDER_ADMIN';
  const bolehAssignPic = bolehKelolaMasterData || user.fs_role === 'PROVIDER_SUPERVISOR';
  // Persis fs_is_client_reviewer() (005) - CLIENT_ADMIN/CLIENT_MANAGER saja,
  // BUKAN CLIENT_VIEWER. Menentukan siapa boleh menekan Verify/Request
  // Revision di tab Client Review (fs_reviews_insert menolak siapa pun di
  // luar ini walau tombolnya sempat terlihat).
  /**
   * Admin platform BOLEH ikut memutuskan review, bukan hanya akun ber-role
   * client. Sebelumnya hak ini dibatasi ke CLIENT_ADMIN/CLIENT_MANAGER saja,
   * sehingga Provider Admin membuka layar review dalam keadaan hanya-baca -
   * padahal fungsi databasenya (fs_review_tv, migrasi 024) memang sudah
   * mengizinkan fs_is_provider(). Jadi yang salah cuma pagar di layar ini,
   * dan akibatnya admin tidak bisa menolong saat client belum sempat
   * memutuskan.
   */
  const bolehReview = user.fs_role === 'CLIENT_ADMIN'
    || user.fs_role === 'CLIENT_MANAGER'
    || user.fs_role === 'PROVIDER_ADMIN'
    || user.fs_role === 'PROVIDER_SUPERVISOR'
    || hasFullAccess(user);
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;

  return (
    // h-screen overflow-hidden + flex-col SENGAJA, bukan min-h-screen (dulu
    // dipakai) - header ikut jadi bagian dokumen yang ikut ter-scroll, dan
    // position:sticky-nya di dalam iframe dashboard tidak selalu konsisten
    // menahan header di tempat (dilaporkan: "Header masih ke scroll").
    // Persis pola SEMUA modul lain di platform ini (lihat daily-report,
    // form-review, kpi-team, dst): shell dikunci setinggi viewport, header di
    // LUAR area yang scroll - jadi header tidak akan PERNAH ikut ter-scroll,
    // bukan cuma "coba ditahan pakai sticky".
    <div className="h-screen overflow-hidden flex flex-col bg-slate-50 bg-cover bg-center bg-no-repeat"
      style={merek.gambarLatarDasbor ? { backgroundImage: `url(${merek.gambarLatarDasbor})` } : { background: gradasiLatarPlatform(merek) }}>
      <PageHeader icon="📍" title="Field Operations"
        subtitle="Locations, Execution Points, PIC & Content — GPS memvalidasi kehadiran fisik, bukan otorisasi."
        color="#4338ca">
        {!embedded && (
          <button type="button" onClick={() => router.push('/dashboard')}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5">
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Kembali ke Dashboard
          </button>
        )}
      </PageHeader>

      {/* overflow-x-hidden EKSPLISIT - tanpa ini, satu elemen anak yang
          sedikit lebih lebar dari viewport (zoom browser >100%, tabel
          ringkas yang belum sempat menyusut) bisa memicu scrollbar
          horizontal di level HALAMAN yang terasa aneh dan membuat sebagian
          konten seolah "hilang" di sisi kanan (keluhan user via
          screenshot). Setiap tabel yang memang perlu lebar sendiri sudah
          punya overflow-x-auto miliknya sendiri di dalam kartunya. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
      {/* max-w-[1600px] - laptop 1920x1080 (viewport minus scrollbar/sidebar
          dashboard ~1600-1700px efektif) adalah target UTAMA, persis lebar
          yang sudah dipakai Dashboard/PageHeader dan platform lama - bukan
          max-w-7xl (1280px) yang menyisakan latar kosong lebar di kanan-kiri
          pada layar laptop biasa. Turun mengecil sendiri di layar sempit
          (mobile) lewat breakpoint di bawahnya - bukan sebaliknya. */}
      {/* lg:flex lg:flex-col lg:h-full - beri tab yang butuh (locations/
          points/assignments) TINGGI SEBENARNYA hasil hitungan flexbox
          (bukan tebakan calc(100vh-Npx) yang salah begitu halaman ini
          dimuat di dalam iframe Dashboard, dilaporkan: "tinggi iframe
          juga seperti kurang full"). Tab lain tidak terpengaruh - mereka
          tidak diberi flex-1 di bawah, jadi tetap tinggi alami seperti
          sebelumnya, scroll lewat flex-1 overflow-y-auto di atas seperti
          biasa. */}
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 lg:h-full lg:flex lg:flex-col">
        {tab !== 'review' && !bolehAssignPic && (
          <div className="rounded-xl px-4 py-3 mb-5 text-sm font-semibold" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
            Akun Anda bukan Provider Admin/Supervisor. Anda bisa melihat halaman ini, tapi perubahan akan
            ditolak server (RLS).
          </div>
        )}

        <Notice pesan={pesan} />

        {/* key={tab} paksa remount + animate-fade-in tiap ganti tab - "harus
            ada animasi bergerak sedikit ketika ganti page" (permintaan user).
            Pakai kelas animasi yang SUDAH ADA di globals.css, bukan bikin
            baru. lg:flex-1 lg:min-h-0 lg:flex lg:flex-col WAJIB disalin di
            sini juga - tanpanya wrapper ini jadi blok biasa yang memutus
            rantai flexbox ke lg:flex-1 milik Locations/Points/Assignments
            di bawah, dan tab itu kehilangan tinggi penuhnya lagi. */}
        <div key={tab} className="animate-fade-in lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        {tab === 'locations' && (
          <div className="lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
            <LocationsTab
              selectedProjectId={selectedProjectId}
              areas={areas}
              locations={locations}
              userOptions={userOptions}
              contents={contents}
              bolehKelola={bolehKelolaMasterData}
              bolehAssignPic={bolehAssignPic}
              allowMultiPic={selectedProject?.allow_multi_pic ?? false}
              onReloadAreas={() => muatAreas(selectedProjectId)}
              onReloadLocations={() => muatLocations(selectedProjectId)}
              beritahu={beritahu}
            />
          </div>
        )}

        {tab === 'content' && (
          <ContentTab
            selectedProjectId={selectedProjectId}
            contents={contents}
            bolehKelola={bolehKelolaMasterData}
            onReload={() => muatContent(selectedProjectId)}
            beritahu={beritahu}
          />
        )}

        {tab === 'cycles' && (
          <KelolaSiklus
            projectId={selectedProjectId}
            bolehKelola={bolehKelolaMasterData}
            bolehProvider={bolehAssignPic}
            beritahu={beritahu}
          />
        )}

        {/* ReviewTab lama (daftar datar execution instance, keputusan per
            GEDUNG) digantikan ReviewSiklus: review berbasis siklus weekend
            dengan keputusan per TV. Alasannya di kepala ReviewSiklus.tsx. */}
        {tab === 'review' && (
          <ReviewSiklus
            projectId={selectedProjectId}
            bolehReview={bolehReview}
            beritahu={beritahu}
          />
        )}
        </div>
      </div>
      </div>
    </div>
  );
}

// ── Detail Lokasi (Overview / Execution Points / PIC / History) ─────────
// Digabung dari yang tadinya 2 tab terpisah (Execution Points, Assignments) -
// permintaan user eksplisit: "Menu Assignment itu mubazir sekali, coba
// gabungkan assignment dan Execution Points". Sekarang INTERAKTIF (dulu
// cuma tampilan baca-saja, form create/edit/delete-nya ada di 2 tab yang
// sudah dihapus) - lihat proposal IA §3/§7 yang sudah disetujui user.
function LocationDetailModal({
  location, areaName, userOptions, selectedProjectId, contents, bolehKelolaMasterData, bolehAssignPic, onTutup, onReload,
}: {
  location: FsLocation;
  areaName: string;
  userOptions: UserOption[];
  selectedProjectId: string;
  contents: FsContent[];
  bolehKelolaMasterData: boolean;
  bolehAssignPic: boolean;
  onTutup: () => void;
  onReload: () => void;
}) {
  const [sub, setSub] = useState<'overview' | 'points' | 'pic' | 'history'>('overview');
  const [points, setPoints] = useState<FsExecutionPoint[] | null>(null);
  const [assignments, setAssignments] = useState<FsPicAssignment[] | null>(null);
  const [history, setHistory] = useState<{ id: string; instance_date: string; status: string; pointName: string | null }[] | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const muatSemua = useCallback(async () => {
    const [{ data: pts }, { data: asg }, { data: hist }] = await Promise.all([
      supabase.from('fs_execution_points').select('id, location_id, name, floor, status').eq('location_id', location.id).order('name'),
      supabase.from('fs_pic_assignments').select('id, project_id, location_id, execution_point_id, user_id, effective_date, end_date, active')
        .eq('location_id', location.id).order('effective_date', { ascending: false }),
      supabase.from('fs_execution_instances').select('id, instance_date, status, fs_execution_points!execution_point_id(name, floor)')
        .eq('location_id', location.id).order('instance_date', { ascending: false }).limit(20),
    ]);
    setPoints((pts ?? []) as FsExecutionPoint[]);
    setAssignments((asg ?? []) as FsPicAssignment[]);
    type HistBaris = { id: string; instance_date: string; status: string; fs_execution_points: { name: string; floor: string | null } | null };
    setHistory(((hist ?? []) as HistBaris[]).map(h => ({
      id: h.id, instance_date: h.instance_date, status: h.status,
      pointName: h.fs_execution_points ? (h.fs_execution_points.floor ? `${h.fs_execution_points.name} — ${h.fs_execution_points.floor}` : h.fs_execution_points.name) : null,
    })));
  }, [location.id]);

  useEffect(() => { void muatSemua(); }, [muatSemua]);

  const muatUlang = () => { void muatSemua(); onReload(); };

  const TabBtn = ({ id, label }: { id: typeof sub; label: string }) => (
    <button type="button" onClick={() => setSub(id)}
      className={`text-xs font-bold px-3 py-1.5 rounded-md transition-colors ${sub === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
      {label}
    </button>
  );

  return (
    <Modal buka onTutup={onTutup} judul={location.name} keterangan={areaName} ukuran="lg">
      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 mb-4 w-fit">
        <TabBtn id="overview" label="Overview" />
        <TabBtn id="points" label="Execution Points" />
        <TabBtn id="pic" label="PIC" />
        <TabBtn id="history" label="History" />
      </div>

      {sub === 'overview' && (
        <div className="space-y-2 text-sm">
          {[
            ['Area', areaName],
            ['Alamat', location.address || '—'],
            ['Koordinat', `${location.latitude}, ${location.longitude}`],
            ['Radius GPS', `${location.gps_radius_m} meter`],
            ['Status', location.status === 'active' ? 'Aktif' : 'Nonaktif'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
              <span className="text-slate-500">{label}</span>
              <span className="font-bold text-slate-800 text-right">{value}</span>
            </div>
          ))}
        </div>
      )}

      {sub === 'points' && (
        <PointsSubTab locationId={location.id} points={points} bolehKelola={bolehKelolaMasterData}
          onReload={muatUlang} beritahu={() => {}} setConfirmState={setConfirmState} />
      )}

      {sub === 'pic' && (
        <PicSubTab location={location} points={points ?? []} assignments={assignments}
          userOptions={userOptions} contents={contents} selectedProjectId={selectedProjectId}
          bolehKelola={bolehAssignPic} onReload={muatUlang} setConfirmState={setConfirmState} />
      )}

      {sub === 'history' && (
        history === null ? (
          <p className="text-sm text-slate-400 text-center py-8">Memuat…</p>
        ) : history.length === 0 ? (
          <EmptyState icon="🕐" title="Belum ada riwayat eksekusi" description="Riwayat akan muncul setelah PIC mulai bekerja di lokasi ini." />
        ) : (
          <div className="divide-y divide-slate-50 -mx-5 max-h-96 overflow-y-auto">
            {history.map(h => {
              const st = FS_STATUS_LABEL[h.status] ?? { label: h.status, color: '#475569', bg: '#f1f5f9' };
              return (
                <div key={h.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">{h.instance_date}</p>
                    {h.pointName && <p className="text-xs text-slate-400 truncate">{h.pointName}</p>}
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0" style={{ color: st.color, background: st.bg }}>
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        )
      )}

      <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />
    </Modal>
  );
}

/** Sub-tab "Execution Points" di dalam LocationDetailModal - dipindahkan dari
 *  PointsTab (dihapus, dulu menu sidebar sendiri) - form "+ Add Point" jadi
 *  progressive disclosure inline (bukan modal bersarang di dalam modal). */
function PointsSubTab({ locationId, points, bolehKelola, onReload, setConfirmState }: {
  locationId: string;
  points: FsExecutionPoint[] | null;
  bolehKelola: boolean;
  onReload: () => void;
  beritahu: (tipe: 'ok' | 'gagal', teks: string) => void;
  setConfirmState: (s: ConfirmState | null) => void;
}) {
  const [formTerbuka, setFormTerbuka] = useState(false);
  const [nama, setNama] = useState('');
  const [lantai, setLantai] = useState('');
  const [simpan, setSimpan] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  const resetForm = () => { setNama(''); setLantai(''); setEditingId(null); setGalat(null); };
  const bukaTambah = () => { resetForm(); setFormTerbuka(true); };
  const mulaiEdit = (pt: FsExecutionPoint) => {
    setNama(pt.name); setLantai(pt.floor ?? ''); setEditingId(pt.id); setGalat(null); setFormTerbuka(true);
  };

  const simpanPoint = async () => {
    if (!nama.trim()) return;
    setSimpan(true);
    const payload = { name: nama.trim(), floor: lantai.trim() || null };
    const { error } = editingId
      ? await supabase.from('fs_execution_points').update(payload).eq('id', editingId)
      : await supabase.from('fs_execution_points').insert({ ...payload, location_id: locationId });
    setSimpan(false);
    if (error) { setGalat(error.message); return; }
    resetForm();
    setFormTerbuka(false);
    onReload();
  };

  const ubahStatus = async (pt: FsExecutionPoint) => {
    const statusBaru = pt.status === 'active' ? 'inactive' : 'active';
    await supabase.from('fs_execution_points').update({ status: statusBaru }).eq('id', pt.id);
    onReload();
  };

  const mintaNonaktifkan = (pt: FsExecutionPoint) => {
    if (pt.status !== 'active') { void ubahStatus(pt); return; }
    setConfirmState({
      message: `Nonaktifkan execution point "${pt.name}"?`,
      description: 'Titik nonaktif tidak bisa lagi dipakai untuk assignment PIC baru.',
      danger: true, confirmLabel: 'Nonaktifkan',
      onConfirm: () => void ubahStatus(pt),
    });
  };

  const mintaHapus = (pt: FsExecutionPoint) => setConfirmState({
    message: `Hapus execution point "${pt.name}" permanen?`,
    description: 'Ini akan menghapus permanen titik ini beserta assignment PIC dan seluruh riwayat eksekusinya. Tidak bisa dibatalkan.',
    danger: true, confirmLabel: 'Hapus Permanen',
    onConfirm: async () => { await supabase.from('fs_execution_points').delete().eq('id', pt.id); onReload(); },
  });

  return (
    <div>
      {bolehKelola && (
        <div className="mb-3">
          {!formTerbuka ? (
            <button type="button" onClick={bukaTambah}
              className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'linear-gradient(135deg,#4338ca,#3730a3)' }}>
              + Add Execution Point
            </button>
          ) : (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <FormField label="Nama titik">
                  <input value={nama} onChange={e => setNama(e.target.value)} placeholder="mis. TV Lobby 1" className={inputCls} autoFocus />
                </FormField>
                <FormField label={<>Lantai <span className="normal-case font-normal text-slate-300">— opsional</span></>}>
                  <input value={lantai} onChange={e => setLantai(e.target.value)} placeholder="mis. Lantai 3, GF" className={inputCls} />
                </FormField>
              </div>
              {galat && <p className="text-xs text-rose-600">{galat}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={simpanPoint} disabled={simpan || !nama.trim()}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: '#4338ca' }}>
                  {simpan ? 'Menyimpan…' : editingId ? 'Simpan Perubahan' : 'Tambah'}
                </button>
                <button type="button" onClick={() => { resetForm(); setFormTerbuka(false); }}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {points === null ? (
        <p className="text-sm text-slate-400 text-center py-8">Memuat…</p>
      ) : points.length === 0 ? (
        <EmptyState icon="📺" title="Belum ada execution point" description="Boleh dilewati — assignment PIC juga bisa langsung ke level lokasi." />
      ) : (
        <div className="divide-y divide-slate-50 -mx-5 max-h-96 overflow-y-auto stagger-rows">
          {points.map(pt => (
            <div key={pt.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-800 truncate">{pt.name}</p>
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={pt.status === 'active' ? { background: '#dcfce7', color: '#15803d' } : { background: '#f1f5f9', color: '#64748b' }}>
                    {pt.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
                {pt.floor && <p className="text-xs text-slate-400">{pt.floor}</p>}
              </div>
              {bolehKelola && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button type="button" onClick={() => mulaiEdit(pt)} className="text-[11px] font-bold text-slate-400 hover:text-slate-700">Edit</button>
                  <button type="button" onClick={() => mintaNonaktifkan(pt)} className="text-[11px] font-bold text-slate-400 hover:text-rose-600">
                    {pt.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  <button type="button" onClick={() => mintaHapus(pt)} title={`Hapus ${pt.name}`} aria-label={`Hapus ${pt.name}`}
                    className="text-slate-300 hover:text-rose-600 p-1">🗑️</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sub-tab "PIC" di dalam LocationDetailModal - dipindahkan dari
 *  AssignmentsTab (dihapus). Hanya alur assign SATU lokasi (yang memang
 *  konteks modal ini) - assign massal ke BANYAK lokasi sekaligus tetap ada,
 *  dipindah jadi tombol toolbar terpisah di tabel Locations (lihat
 *  BulkAssignModal) karena itu operasi lintas-lokasi, bukan punya satu
 *  lokasi tertentu. */
function PicSubTab({ location, points, assignments, userOptions, contents, selectedProjectId, bolehKelola, onReload, setConfirmState }: {
  location: FsLocation;
  points: FsExecutionPoint[];
  assignments: FsPicAssignment[] | null;
  userOptions: UserOption[];
  contents: FsContent[];
  selectedProjectId: string;
  bolehKelola: boolean;
  onReload: () => void;
  setConfirmState: (s: ConfirmState | null) => void;
}) {
  const [formTerbuka, setFormTerbuka] = useState(false);
  const [pointId, setPointId] = useState('');
  const [contentId, setContentId] = useState('');
  const [userId, setUserId] = useState('');
  const [cariPic, setCariPic] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [simpan, setSimpan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const technicianOptions = userOptions.filter(u => u.fs_role === 'FIELD_PIC');
  const pilihanPic = technicianOptions.length > 0 ? technicianOptions : userOptions;
  const cocokPic = (u: UserOption, q: string) => u.full_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  const pilihanPicTersaring = cariPic.trim() ? pilihanPic.filter(u => cocokPic(u, cariPic.trim().toLowerCase())) : pilihanPic;

  useEffect(() => {
    if (pilihanPic.length > 0 && !userId) setUserId(pilihanPic[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilihanPic]);

  const bukaForm = () => { setPointId(''); setContentId(''); setEffectiveDate(new Date().toISOString().slice(0, 10)); setEndDate(''); setGalat(null); setFormTerbuka(true); };

  const beritahuPicDitugaskan = async (userIdTarget: string) => {
    try {
      const { data: u } = await supabase.from('users').select('full_name, phone_number, telegram_chat_id').eq('id', userIdTarget).maybeSingle();
      if (!u) return;
      const pesan = `📍 Anda ditugaskan sebagai PIC di "${location.name}". Buka Tugas Hari Ini untuk detail & check-in.`;
      await kirimNotifikasi({
        event: 'fs.pic_assigned',
        whatsapp: { penerima: [{ nama: u.full_name, telepon: u.phone_number }], pesan, jenisWA: 'fs_pic_assigned' },
        telegram: u.telegram_chat_id ? { pesan, chatId: u.telegram_chat_id } : undefined,
      });
    } catch { /* diam - notifikasi tidak boleh menggagalkan assignment yang sudah tersimpan */ }
  };

  const materialisasiHariIni = async (assignmentId: string) => {
    try { await supabase.rpc('fs_ensure_today_instance', { p_assignment_id: assignmentId }); } catch { /* diam */ }
  };

  const tambah = async () => {
    if (!userId || !selectedProjectId) return;
    setSimpan(true);
    const { data, error } = await supabase.from('fs_pic_assignments').insert({
      project_id: selectedProjectId, location_id: location.id, execution_point_id: pointId || null,
      content_id: contentId || null, user_id: userId, effective_date: effectiveDate, end_date: endDate || null, active: true,
    }).select('id').single();
    setSimpan(false);
    if (error) { setGalat(error.message); return; }
    void beritahuPicDitugaskan(userId);
    void materialisasiHariIni(data.id);
    setFormTerbuka(false);
    onReload();
  };

  const nonaktifkan = async (a: FsPicAssignment) => {
    await supabase.from('fs_pic_assignments').update({ active: false, end_date: a.end_date ?? new Date().toISOString().slice(0, 10) }).eq('id', a.id);
    onReload();
  };

  const mintaNonaktifkan = (a: FsPicAssignment) => {
    const namaPic = userOptions.find(u => u.id === a.user_id)?.full_name ?? 'PIC ini';
    setConfirmState({
      message: `Nonaktifkan assignment ${namaPic}?`,
      description: `${namaPic} tidak akan bisa check-in/check-out lagi setelah dinonaktifkan.`,
      danger: true, confirmLabel: 'Nonaktifkan',
      onConfirm: () => void nonaktifkan(a),
    });
  };

  const mintaHapus = (a: FsPicAssignment) => {
    const namaPic = userOptions.find(u => u.id === a.user_id)?.full_name ?? 'PIC ini';
    setConfirmState({
      message: `Hapus assignment ${namaPic} permanen?`,
      description: 'Riwayat eksekusi yang sudah pernah dilakukan TIDAK ikut terhapus - ini hanya menghapus baris penugasannya. Tidak bisa dibatalkan.',
      danger: true, confirmLabel: 'Hapus Permanen',
      onConfirm: async () => { await supabase.from('fs_pic_assignments').delete().eq('id', a.id); onReload(); },
    });
  };

  return (
    <div>
      {bolehKelola && (
        <div className="mb-3">
          {!formTerbuka ? (
            <button type="button" onClick={bukaForm}
              className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'linear-gradient(135deg,#4338ca,#3730a3)' }}>
              + Assign PIC
            </button>
          ) : (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="sm:col-span-2">
                  <FormField label={<>Execution point <span className="normal-case font-normal text-slate-300">— kosongkan untuk seluruh lokasi</span></>}>
                    <SearchableSelect value={pointId} onChange={setPointId} placeholder={`— seluruh lokasi (${location.name}) —`}
                      options={points.map(pt => ({ value: pt.id, label: pt.floor ? `${pt.name} — ${pt.floor}` : pt.name }))} />
                  </FormField>
                </div>
                <div className="sm:col-span-2">
                  <FormField label={<>Content <span className="normal-case font-normal text-slate-300">— opsional</span></>}>
                    <select value={contentId} onChange={e => setContentId(e.target.value)} className={inputCls}>
                      <option value="">— tanpa content spesifik —</option>
                      {contents.filter(c => c.status === 'active').map(c => (
                        <option key={c.id} value={c.id}>{c.name} (v{c.version}, {c.valid_from} – {c.valid_until})</option>
                      ))}
                    </select>
                  </FormField>
                </div>
                <div className="sm:col-span-2">
                  <FormField label="PIC (user)">
                    <input value={cariPic} onChange={e => {
                      setCariPic(e.target.value);
                      const u = userOptions.find(x => x.id === userId);
                      if (u && e.target.value.trim() && !cocokPic(u, e.target.value.trim().toLowerCase())) setUserId('');
                    }} placeholder="Cari nama/username PIC..." className={inputCls + ' mb-1.5'} autoComplete="off" />
                    <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls} size={Math.min(5, Math.max(3, pilihanPicTersaring.length))}>
                      {pilihanPicTersaring.length === 0 && <option value="" disabled>— tidak ada yang cocok —</option>}
                      {pilihanPicTersaring.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>)}
                    </select>
                    {technicianOptions.length === 0 && userOptions.length > 0 && (
                      <p className="text-[10.5px] text-amber-600 mt-1 leading-relaxed">
                        Belum ada akun ber-role Technician — menampilkan semua user untuk sementara.
                      </p>
                    )}
                  </FormField>
                </div>
                <FormField label="Mulai berlaku">
                  <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} className={inputCls} />
                </FormField>
                <FormField label={<>Sampai <span className="normal-case font-normal text-slate-300">— opsional</span></>}>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
                </FormField>
              </div>
              {galat && <p className="text-xs text-rose-600">{galat}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={tambah} disabled={simpan || !userId}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: '#4338ca' }}>
                  {simpan ? 'Menyimpan…' : 'Simpan Assignment'}
                </button>
                <button type="button" onClick={() => setFormTerbuka(false)}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {assignments === null ? (
        <p className="text-sm text-slate-400 text-center py-8">Memuat…</p>
      ) : assignments.length === 0 ? (
        <EmptyState icon="🧑‍🔧" title="Belum ada PIC aktif" description="Assign PIC lewat tombol di atas." />
      ) : (
        <div className="divide-y divide-slate-50 -mx-5 max-h-96 overflow-y-auto stagger-rows">
          {assignments.map(a => {
            const pt = points.find(p => p.id === a.execution_point_id);
            return (
              <div key={a.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 truncate">{userOptions.find(u => u.id === a.user_id)?.full_name ?? a.user_id}</p>
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={a.active ? { background: '#dcfce7', color: '#15803d' } : { background: '#f1f5f9', color: '#64748b' }}>
                      {a.active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">
                    {pt ? (pt.floor ? `${pt.name} — ${pt.floor}` : pt.name) : 'Seluruh lokasi'} · {a.effective_date}{a.end_date ? ` – ${a.end_date}` : ' – tanpa batas'}
                  </p>
                </div>
                {bolehKelola && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {a.active && (
                      <button type="button" onClick={() => mintaNonaktifkan(a)} className="text-[11px] font-bold text-slate-400 hover:text-rose-600">
                        Nonaktifkan
                      </button>
                    )}
                    <button type="button" onClick={() => mintaHapus(a)} title="Hapus assignment" aria-label="Hapus assignment"
                      className="text-slate-300 hover:text-rose-600 p-1">🗑️</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Assign satu PIC ke BANYAK lokasi sekaligus - operasi lintas-lokasi, jadi
 *  tombolnya di toolbar tabel Locations (bukan di dalam detail satu lokasi).
 *  Logic dipindahkan verbatim dari AssignmentsTab (dihapus) - satu-satunya
 *  bagian dari tab itu yang TIDAK ikut melebur ke LocationDetailModal. */
function BulkAssignModal({ buka, onTutup, locations, userOptions, selectedProjectId, allowMultiPic, onReload }: {
  buka: boolean;
  onTutup: () => void;
  locations: FsLocation[];
  userOptions: UserOption[];
  selectedProjectId: string;
  allowMultiPic: boolean;
  onReload: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [cariPic, setCariPic] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [lokasiTerpilih, setLokasiTerpilih] = useState<Set<string>>(new Set());
  const [cariLokasi, setCariLokasi] = useState('');
  const [simpan, setSimpan] = useState(false);
  const [step, setStep] = useState<'form' | 'confirm' | 'result'>('form');
  const [hasilBulk, setHasilBulk] = useState<{ berhasil: string[]; gagal: string[] } | null>(null);

  const technicianOptions = userOptions.filter(u => u.fs_role === 'FIELD_PIC');
  const pilihanPic = technicianOptions.length > 0 ? technicianOptions : userOptions;
  const cocokPic = (u: UserOption, q: string) => u.full_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  const pilihanPicTersaring = cariPic.trim() ? pilihanPic.filter(u => cocokPic(u, cariPic.trim().toLowerCase())) : pilihanPic;

  useEffect(() => {
    if (pilihanPic.length > 0 && !userId) setUserId(pilihanPic[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilihanPic]);

  const lokasiTersaring = cariLokasi.trim() ? locations.filter(l => l.name.toLowerCase().includes(cariLokasi.trim().toLowerCase())) : locations;
  const toggleLokasi = (id: string) => setLokasiTerpilih(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const beritahuPicDitugaskan = async (userIdTarget: string, lokasiNama: string) => {
    try {
      const { data: u } = await supabase.from('users').select('full_name, phone_number, telegram_chat_id').eq('id', userIdTarget).maybeSingle();
      if (!u) return;
      const pesan = `📍 Anda ditugaskan sebagai PIC di "${lokasiNama}". Buka Tugas Hari Ini untuk detail & check-in.`;
      await kirimNotifikasi({
        event: 'fs.pic_assigned',
        whatsapp: { penerima: [{ nama: u.full_name, telepon: u.phone_number }], pesan, jenisWA: 'fs_pic_assigned' },
        telegram: u.telegram_chat_id ? { pesan, chatId: u.telegram_chat_id } : undefined,
      });
    } catch { /* diam */ }
  };
  const materialisasiHariIni = async (assignmentId: string) => {
    try { await supabase.rpc('fs_ensure_today_instance', { p_assignment_id: assignmentId }); } catch { /* diam */ }
  };

  const tutup = () => { onTutup(); setStep('form'); setHasilBulk(null); setLokasiTerpilih(new Set()); };

  const submit = async () => {
    if (!userId || lokasiTerpilih.size === 0) return;
    setSimpan(true);
    setHasilBulk(null);
    const gagal: string[] = [];
    const berhasil: string[] = [];
    for (const locId of lokasiTerpilih) {
      const namaLokasi = locations.find(l => l.id === locId)?.name ?? locId;
      const { data, error } = await supabase.from('fs_pic_assignments').insert({
        project_id: selectedProjectId, location_id: locId, execution_point_id: null,
        content_id: null, user_id: userId, effective_date: effectiveDate, end_date: endDate || null, active: true,
      }).select('id').single();
      if (error) gagal.push(namaLokasi);
      else { berhasil.push(namaLokasi); void beritahuPicDitugaskan(userId, namaLokasi); void materialisasiHariIni(data.id); }
    }
    setSimpan(false);
    setHasilBulk({ berhasil, gagal });
    setLokasiTerpilih(new Set());
    setStep('result');
    onReload();
  };

  return (
    <Modal buka={buka} onTutup={tutup}
      judul={step === 'result' ? 'Hasil Assign PIC' : step === 'confirm' ? 'Konfirmasi Assignment' : 'Assign PIC ke Banyak Lokasi'}
      ukuran="lg" tutupDiLuar={false}
      footer={
        step === 'form' ? (
          <>
            <TombolModal jenis="batal" onClick={tutup}>Batal</TombolModal>
            <TombolModal jenis="utama" onClick={() => setStep('confirm')} disabled={!userId || lokasiTerpilih.size === 0}>Lanjutkan</TombolModal>
          </>
        ) : step === 'confirm' ? (
          <>
            <TombolModal jenis="batal" onClick={() => setStep('form')}>Kembali</TombolModal>
            <TombolModal jenis="utama" onClick={submit} disabled={simpan}>{simpan ? 'Menyimpan…' : 'Confirm Assignment'}</TombolModal>
          </>
        ) : (
          <TombolModal jenis="utama" onClick={tutup}>Selesai</TombolModal>
        )
      }>
      {step === 'form' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            {allowMultiPic ? 'Project ini mengizinkan lebih dari satu PIC aktif per titik.' : 'Default: satu lokasi hanya boleh punya satu PIC aktif — assignment kedua akan ditolak server.'}
          </p>
          <FormField label={<>Pilih lokasi <span className="normal-case font-normal text-slate-300">— {lokasiTerpilih.size} dipilih</span></>}>
            <input value={cariLokasi} onChange={e => setCariLokasi(e.target.value)} placeholder="Cari nama lokasi..." className={inputCls} autoComplete="off" />
          </FormField>
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setLokasiTerpilih(new Set(lokasiTersaring.map(l => l.id)))} className="text-xs font-bold text-indigo-600 hover:underline">
              Pilih semua ({lokasiTersaring.length})
            </button>
            {lokasiTerpilih.size > 0 && (
              <button type="button" onClick={() => setLokasiTerpilih(new Set())} className="text-xs font-bold text-slate-400 hover:text-rose-600">Kosongkan pilihan</button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
            {lokasiTersaring.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Tidak ada lokasi yang cocok.</p>
            ) : lokasiTersaring.map(l => (
              <label key={l.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={lokasiTerpilih.has(l.id)} onChange={() => toggleLokasi(l.id)} className="w-4 h-4 rounded border-slate-300 accent-indigo-600 flex-shrink-0" />
                <span className="truncate">{l.name}</span>
              </label>
            ))}
          </div>
          <FormField label="PIC (user)">
            <input value={cariPic} onChange={e => {
              setCariPic(e.target.value);
              const u = userOptions.find(x => x.id === userId);
              if (u && e.target.value.trim() && !cocokPic(u, e.target.value.trim().toLowerCase())) setUserId('');
            }} placeholder="Cari nama/username PIC..." className={inputCls + ' mb-1.5'} autoComplete="off" />
            <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls} size={Math.min(6, Math.max(3, pilihanPicTersaring.length))}>
              {pilihanPicTersaring.length === 0 && <option value="" disabled>— tidak ada yang cocok —</option>}
              {pilihanPicTersaring.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Mulai berlaku">
              <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} className={inputCls} />
            </FormField>
            <FormField label={<>Sampai <span className="normal-case font-normal text-slate-300">— opsional</span></>}>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
            </FormField>
          </div>
        </div>
      )}
      {step === 'confirm' && (
        <div className="space-y-2 text-sm">
          {[
            ['PIC', userOptions.find(u => u.id === userId)?.full_name ?? '—'],
            ['Lokasi', `${lokasiTerpilih.size} lokasi`],
            ['Mulai berlaku', effectiveDate],
            ['Sampai', endDate || 'Tanpa batas'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 py-1 border-b border-slate-50 last:border-0">
              <span className="text-slate-500">{label}</span>
              <span className="font-bold text-slate-800 text-right">{value}</span>
            </div>
          ))}
          <div className="pt-2">
            <p className="text-xs text-slate-400 mb-1">Lokasi terpilih:</p>
            <p className="text-xs text-slate-600 leading-relaxed">
              {Array.from(lokasiTerpilih).map(id => locations.find(l => l.id === id)?.name ?? id).join(', ')}
            </p>
          </div>
        </div>
      )}
      {step === 'result' && hasilBulk && (
        <div className="space-y-2">
          {hasilBulk.berhasil.length > 0 && (
            <div>
              <p className="text-xs font-bold text-emerald-700">✅ Tersimpan ke {hasilBulk.berhasil.length} lokasi:</p>
              <p className="text-xs text-slate-500 leading-relaxed">{hasilBulk.berhasil.join(', ')}</p>
            </div>
          )}
          {hasilBulk.gagal.length > 0 && (
            <div>
              <p className="text-xs font-bold text-rose-700">⚠️ Ditolak server ({hasilBulk.gagal.length}) — kemungkinan sudah ada PIC aktif:</p>
              <p className="text-xs text-slate-500 leading-relaxed">{hasilBulk.gagal.join(', ')}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Tab: Lokasi (Locations + Execution Points + Assign PIC, digabung) ────

function LocationsTab({
  selectedProjectId, areas, locations, userOptions, contents, bolehKelola, bolehAssignPic, allowMultiPic,
  onReloadAreas, onReloadLocations, beritahu,
}: {
  selectedProjectId: string;
  areas: FsArea[];
  locations: FsLocation[];
  userOptions: UserOption[];
  contents: FsContent[];
  bolehKelola: boolean;
  bolehAssignPic: boolean;
  allowMultiPic: boolean;
  onReloadAreas: () => void;
  onReloadLocations: () => void;
  beritahu: (tipe: 'ok' | 'gagal', teks: string) => void;
}) {
  const [areaNama, setAreaNama] = useState('');
  const [simpanArea, setSimpanArea] = useState(false);
  const [tambahAreaTerbuka, setTambahAreaTerbuka] = useState(false);
  /** Sebelumnya wilayah HANYA bisa dibuat, tidak pernah bisa diganti nama
   *  atau dihapus dari UI manapun (dikeluhkan user via screenshot) - baris
   *  "+ Area" yang sama sekarang juga jadi tempat mengubah/menghapus
   *  wilayah yang sedang dipilih di dropdown Area. */
  const [editAreaMode, setEditAreaMode] = useState(false);

  const [locNama, setLocNama] = useState('');
  const [locAlamat, setLocAlamat] = useState('');
  const [locAreaId, setLocAreaId] = useState('');
  const [locLat, setLocLat] = useState('');
  const [locLng, setLocLng] = useState('');
  const [locRadius, setLocRadius] = useState('100');
  const [simpanLoc, setSimpanLoc] = useState(false);
  const [editingLocId, setEditingLocId] = useState<string | null>(null);
  const [modalLokasiTerbuka, setModalLokasiTerbuka] = useState(false);
  const [detailLokasiId, setDetailLokasiId] = useState<string | null>(null);
  const [modalImportTerbuka, setModalImportTerbuka] = useState(false);
  const [modalBulkAssignTerbuka, setModalBulkAssignTerbuka] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [cariLokasi, setCariLokasi] = useState('');
  const [filterAreaNama, setFilterAreaNama] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'' | 'active' | 'inactive'>('');
  /** Klik slice pie "Cakupan PIC" - filter tambahan di atas pencarian teks. */
  const [filterCakupan, setFilterCakupan] = useState<string | null>(null);

  const [jumlahTitik, setJumlahTitik] = useState<Record<string, number>>({});
  const [picIdsLokasi, setPicIdsLokasi] = useState<Record<string, string[]>>({});

  const muatRingkasan = useCallback(async () => {
    if (locations.length === 0) { setJumlahTitik({}); setPicIdsLokasi({}); return; }
    const ids = locations.map(l => l.id);
    const [{ data: pts }, { data: asg }] = await Promise.all([
      supabase.from('fs_execution_points').select('location_id').in('location_id', ids).eq('status', 'active'),
      supabase.from('fs_pic_assignments').select('location_id, user_id').in('location_id', ids).eq('active', true).is('execution_point_id', null),
    ]);
    const jt: Record<string, number> = {};
    for (const p of (pts ?? []) as { location_id: string }[]) jt[p.location_id] = (jt[p.location_id] ?? 0) + 1;
    setJumlahTitik(jt);
    const pi: Record<string, string[]> = {};
    for (const a of (asg ?? []) as { location_id: string; user_id: string }[]) (pi[a.location_id] ??= []).push(a.user_id);
    setPicIdsLokasi(pi);
  }, [locations]);

  useEffect(() => { void muatRingkasan(); }, [muatRingkasan]);

  useEffect(() => {
    if (areas.length > 0 && !locAreaId) setLocAreaId(areas[0].id);
    if (areas.length === 0) setLocAreaId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas]);

  const tambahArea = async () => {
    if (!areaNama.trim() || !selectedProjectId) return;
    setSimpanArea(true);
    const { data, error } = await supabase.from('fs_areas').insert({ project_id: selectedProjectId, name: areaNama.trim() }).select('id').single();
    setSimpanArea(false);
    if (error) { beritahu('gagal', 'Gagal membuat area: ' + error.message); return; }
    beritahu('ok', `Area "${areaNama.trim()}" dibuat.`);
    setAreaNama(''); setTambahAreaTerbuka(false);
    onReloadAreas();
    if (data) setLocAreaId((data as { id: string }).id);
  };

  const bukaEditArea = () => {
    const a = areas.find(x => x.id === locAreaId);
    if (!a) return;
    setAreaNama(a.name);
    setEditAreaMode(true);
    setTambahAreaTerbuka(true);
  };

  const simpanNamaArea = async () => {
    if (!areaNama.trim() || !locAreaId) return;
    setSimpanArea(true);
    const { error } = await supabase.from('fs_areas').update({ name: areaNama.trim() }).eq('id', locAreaId);
    setSimpanArea(false);
    if (error) { beritahu('gagal', 'Gagal mengubah nama wilayah: ' + error.message); return; }
    beritahu('ok', `Wilayah diganti nama jadi "${areaNama.trim()}".`);
    setAreaNama(''); setTambahAreaTerbuka(false); setEditAreaMode(false);
    onReloadAreas();
  };

  const hapusArea = async (id: string, nama: string) => {
    const { error } = await supabase.from('fs_areas').delete().eq('id', id);
    if (error) {
      // ON DELETE RESTRICT (004): pesan Postgres mentah tidak ramah -
      // terjemahkan kasus paling umum (masih ada gedung di wilayah ini).
      const masihAdaGedung = error.message.toLowerCase().includes('foreign key') || error.message.toLowerCase().includes('violates');
      beritahu('gagal', masihAdaGedung
        ? `Wilayah "${nama}" masih punya gedung — pindahkan atau hapus gedungnya dulu sebelum wilayah ini bisa dihapus.`
        : 'Gagal menghapus wilayah: ' + error.message);
      return;
    }
    beritahu('ok', `Wilayah "${nama}" dihapus.`);
    if (locAreaId === id) setLocAreaId('');
    if (filterAreaNama === nama) setFilterAreaNama(null);
    onReloadAreas();
  };

  const mintaHapusArea = () => {
    const a = areas.find(x => x.id === locAreaId);
    if (!a) return;
    const jumlahGedung = locations.filter(l => l.area_id === a.id).length;
    setConfirmState({
      message: `Hapus wilayah "${a.name}"?`,
      description: jumlahGedung > 0
        ? `Wilayah ini masih punya ${jumlahGedung} gedung. Pindahkan atau hapus gedungnya dulu — penghapusan akan ditolak selama masih ada gedung di dalamnya.`
        : 'Wilayah tanpa gedung ini akan dihapus permanen. Tidak bisa dibatalkan.',
      danger: true, confirmLabel: 'Hapus Wilayah',
      onConfirm: () => hapusArea(a.id, a.name),
    });
  };

  const resetFormLokasi = () => { setLocNama(''); setLocAlamat(''); setLocLat(''); setLocLng(''); setLocRadius('100'); setEditingLocId(null); };
  const bukaTambahLokasi = () => { resetFormLokasi(); setModalLokasiTerbuka(true); };
  const mulaiEditLokasi = (l: FsLocation) => {
    setLocNama(l.name); setLocAlamat(l.address ?? ''); setLocAreaId(l.area_id);
    setLocLat(String(l.latitude)); setLocLng(String(l.longitude)); setLocRadius(String(l.gps_radius_m));
    setEditingLocId(l.id); setModalLokasiTerbuka(true);
  };

  const simpanLokasi = async () => {
    if (!locNama.trim() || !locAreaId || !selectedProjectId) return;
    const lat = Number(locLat);
    const lng = Number(locLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { beritahu('gagal', 'Latitude tidak valid (-90 s/d 90).'); return; }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) { beritahu('gagal', 'Longitude tidak valid (-180 s/d 180).'); return; }
    const radius = Number(locRadius);
    if (!Number.isFinite(radius) || radius <= 0) { beritahu('gagal', 'Radius GPS harus angka positif (meter).'); return; }
    setSimpanLoc(true);
    const payload = { area_id: locAreaId, name: locNama.trim(), address: locAlamat.trim() || null, latitude: lat, longitude: lng, gps_radius_m: Math.round(radius) };
    const { error } = editingLocId
      ? await supabase.from('fs_locations').update(payload).eq('id', editingLocId)
      : await supabase.from('fs_locations').insert({ ...payload, project_id: selectedProjectId });
    setSimpanLoc(false);
    if (error) { beritahu('gagal', `Gagal ${editingLocId ? 'menyimpan perubahan' : 'membuat'} lokasi: ` + error.message); return; }
    beritahu('ok', editingLocId ? `Lokasi "${locNama.trim()}" diperbarui.` : `Lokasi "${locNama.trim()}" dibuat.`);
    resetFormLokasi(); setModalLokasiTerbuka(false); onReloadLocations();
  };

  const ubahStatusLokasi = async (l: FsLocation) => {
    const statusBaru = l.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('fs_locations').update({ status: statusBaru }).eq('id', l.id);
    if (error) { beritahu('gagal', 'Gagal mengubah status: ' + error.message); return; }
    beritahu('ok', statusBaru === 'active' ? `"${l.name}" diaktifkan kembali.` : `"${l.name}" dinonaktifkan.`);
    onReloadLocations();
  };

  const mintaNonaktifkanLokasi = (l: FsLocation) => {
    if (l.status !== 'active') { void ubahStatusLokasi(l); return; }
    setConfirmState({
      message: `Nonaktifkan lokasi "${l.name}"?`,
      description: 'Lokasi nonaktif tidak bisa lagi dipakai untuk assignment PIC baru. Riwayat eksekusi yang sudah ada tidak ikut terhapus.',
      danger: true, confirmLabel: 'Nonaktifkan',
      onConfirm: () => ubahStatusLokasi(l),
    });
  };

  const seleksiLokasi = useSeleksi();
  const [menghapusLokasi, setMenghapusLokasi] = useState(false);

  const hapusLokasi = async (ids: string[]) => {
    setMenghapusLokasi(true);
    const { error } = await supabase.from('fs_locations').delete().in('id', ids);
    setMenghapusLokasi(false);
    if (error) { beritahu('gagal', 'Gagal menghapus: ' + error.message); return; }
    beritahu('ok', ids.length > 1 ? `${ids.length} lokasi dihapus.` : 'Lokasi dihapus.');
    seleksiLokasi.kosongkan();
    onReloadLocations();
  };

  const mintaHapusLokasiSatu = (l: FsLocation) => setConfirmState({
    message: `Hapus lokasi "${l.name}" permanen?`,
    description: 'Ini akan menghapus permanen lokasi ini beserta execution point, assignment PIC, dan SELURUH riwayat eksekusinya. Tidak bisa dibatalkan — kalau cuma ingin menghentikan pemakaian, pakai Nonaktifkan.',
    danger: true, confirmLabel: 'Hapus Permanen',
    onConfirm: () => hapusLokasi([l.id]),
  });

  const mintaHapusLokasiMassal = () => {
    const ids = Array.from(seleksiLokasi.dipilih);
    if (ids.length === 0) return;
    setConfirmState({
      message: `Hapus ${ids.length} lokasi terpilih permanen?`,
      description: 'Ini akan menghapus permanen tiap lokasi beserta execution point, assignment PIC, dan seluruh riwayat eksekusinya. Tidak bisa dibatalkan.',
      danger: true, confirmLabel: `Hapus ${ids.length} Lokasi`,
      onConfirm: () => hapusLokasi(ids),
    });
  };

  const pakaiLokasiSaya = () => {
    if (!navigator.geolocation) { beritahu('gagal', 'Browser tidak mendukung geolocation.'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { setLocLat(String(pos.coords.latitude.toFixed(6))); setLocLng(String(pos.coords.longitude.toFixed(6))); },
      () => beritahu('gagal', 'Gagal membaca lokasi — izinkan akses GPS di browser.'),
    );
  };

  const cariAlamat = useCariAlamat();
  const lokLatNum = Number.isFinite(Number(locLat)) && locLat.trim() !== '' ? Number(locLat) : null;
  const lokLngNum = Number.isFinite(Number(locLng)) && locLng.trim() !== '' ? Number(locLng) : null;
  const bisaBukaMaps = Number.isFinite(Number(locLat)) && Number.isFinite(Number(locLng)) && locLat.trim() !== '' && locLng.trim() !== '';

  const namaPicLokasi = (locationId: string): string => {
    const ids = picIdsLokasi[locationId] ?? [];
    if (ids.length === 0) return '—';
    if (ids.length === 1) return userOptions.find(u => u.id === ids[0])?.full_name ?? '—';
    return `${ids.length} PIC`;
  };

  /** Edit PIC LANGSUNG di baris table (bukan cuma lewat Detail modal) -
   *  "tidak ada langsung edit PIC di setiap list" (permintaan user). Hanya
   *  utk assignment level LOKASI (execution_point_id null, sama dengan yang
   *  ditampilkan kolom PIC) - PIC per-titik TV tetap lewat sub-tab PIC di
   *  LocationDetailModal karena butuh pilih titik mana dulu. */
  const [editingPicLokasiId, setEditingPicLokasiId] = useState<string | null>(null);
  const [simpanPicLokasi, setSimpanPicLokasi] = useState(false);

  const ubahPicLokasi = async (locationId: string, userId: string) => {
    setSimpanPicLokasi(true);
    const hariIni = new Date().toISOString().slice(0, 10);
    // Nonaktifkan dulu assignment level-lokasi yang masih aktif, baru pasang
    // yang baru - persis alur manual (Nonaktifkan lalu Assign PIC), supaya
    // tidak bentrok dengan trigger fs_check_assignment_conflict.
    await supabase.from('fs_pic_assignments')
      .update({ active: false, end_date: hariIni })
      .eq('location_id', locationId).is('execution_point_id', null).eq('active', true);
    if (userId) {
      const { error } = await supabase.from('fs_pic_assignments').insert({
        project_id: selectedProjectId, location_id: locationId, execution_point_id: null,
        content_id: null, user_id: userId, effective_date: hariIni, end_date: null, active: true,
      });
      if (error) { beritahu('gagal', 'Gagal ganti PIC: ' + error.message); setSimpanPicLokasi(false); return; }
    }
    setSimpanPicLokasi(false);
    setEditingPicLokasiId(null);
    beritahu('ok', userId ? 'PIC diperbarui.' : 'PIC dilepas dari lokasi ini.');
    void muatRingkasan();
  };

  /** "Tercakup" (aktif + ada PIC level-lokasi) / "Perlu PIC" (aktif, belum
   *  ada) / "Nonaktif" - dasar StatCardGrid + MiniPieChart di atas tabel. */
  const cakupan = (l: FsLocation): 'Tercakup' | 'Perlu PIC' | 'Nonaktif' => {
    if (l.status !== 'active') return 'Nonaktif';
    return (picIdsLokasi[l.id]?.length ?? 0) > 0 ? 'Tercakup' : 'Perlu PIC';
  };

  const eksporLokasiCsv = () => {
    unduhCsv(
      `locations-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Nama Lokasi', 'Area', 'Alamat', 'Latitude', 'Longitude', 'Radius (m)', 'Execution Points', 'PIC', 'Status'],
      locations.map(l => [l.name, areas.find(a => a.id === l.area_id)?.name ?? '', l.address ?? '', l.latitude, l.longitude, l.gps_radius_m, jumlahTitik[l.id] ?? 0, namaPicLokasi(l.id), l.status]),
    );
  };

  const lokasiModalBody = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <FormField label="Nama lokasi">
        <input value={locNama} onChange={e => setLocNama(e.target.value)} placeholder="mis. Cabang Kelapa Gading" className={inputCls} autoFocus />
      </FormField>
      <FormField label="Area">
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <SearchableSelect value={locAreaId} onChange={setLocAreaId} options={areas.map(a => ({ value: a.id, label: a.name }))} />
          </div>
          <button type="button"
            onClick={() => { setEditAreaMode(false); setAreaNama(''); setTambahAreaTerbuka(b => !(b && !editAreaMode)); }}
            title="Buat wilayah baru"
            className="text-xs font-bold px-3 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex-shrink-0">
            + Area
          </button>
          {/* Sebelumnya tidak ada jalan sama sekali untuk ganti nama/hapus
              wilayah dari UI - keluhan eksplisit user. Aktif hanya kalau
              sebuah wilayah sudah dipilih di dropdown. */}
          <button type="button" onClick={bukaEditArea} disabled={!locAreaId} title="Ubah nama wilayah ini"
            className="text-xs font-bold px-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex-shrink-0">
            ✎
          </button>
          <button type="button" onClick={mintaHapusArea} disabled={!locAreaId} title="Hapus wilayah ini"
            className="text-xs font-bold px-2.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40 flex-shrink-0">
            🗑
          </button>
        </div>
        {tambahAreaTerbuka && (
          <div className="mt-2 flex gap-2">
            <input value={areaNama} onChange={e => setAreaNama(e.target.value)}
              placeholder={editAreaMode ? 'Nama baru untuk wilayah ini' : 'Nama area baru (mis. Jakarta Utara)'}
              className={inputCls} autoFocus />
            <button type="button" onClick={editAreaMode ? simpanNamaArea : tambahArea}
              disabled={simpanArea || !areaNama.trim()} className={btnCls} style={{ background: '#334155' }}>
              {simpanArea ? '…' : editAreaMode ? 'Ganti Nama' : 'Simpan'}
            </button>
            <button type="button" onClick={() => { setTambahAreaTerbuka(false); setEditAreaMode(false); setAreaNama(''); }}
              className="text-xs font-bold px-3 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex-shrink-0">
              Batal
            </button>
          </div>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField label={<>Alamat <span className="normal-case font-normal text-slate-300">— opsional</span></>}>
          <input value={locAlamat} onChange={e => setLocAlamat(e.target.value)} placeholder="Alamat lengkap" className={inputCls} />
        </FormField>
      </div>
      <div className="sm:col-span-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
        <SectionHeaderSmall icon="🗺️" title="Peta — cari alamat, atau klik/geser pin langsung di peta" />
        <div className="relative">
          <input value={cariAlamat.q} onChange={e => cariAlamat.setQ(e.target.value)} placeholder="Cari nama tempat atau alamat..." className={inputCls} autoComplete="off" />
          {cariAlamat.mencari && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Mencari…</span>}
          {cariAlamat.hasil.length > 0 && (
            <div className="absolute z-[1100] mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden max-h-48 overflow-y-auto">
              {cariAlamat.hasil.map((h, i) => (
                <button key={i} type="button" onClick={() => { setLocLat(String(Number(h.lat).toFixed(6))); setLocLng(String(Number(h.lon).toFixed(6))); cariAlamat.bersihkan(); }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-indigo-50 border-b border-slate-50 last:border-0">
                  {h.display_name}
                </button>
              ))}
            </div>
          )}
        </div>
        <MapPicker lat={lokLatNum} lng={lokLngNum} onPick={(lat, lng) => { setLocLat(String(lat.toFixed(6))); setLocLng(String(lng.toFixed(6))); }} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={pakaiLokasiSaya} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
            📍 Lokasi saya sekarang
          </button>
          {bisaBukaMaps && (
            <a href={`https://www.google.com/maps?q=${locLat},${locLng}`} target="_blank" rel="noopener noreferrer"
              className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 inline-flex items-center">
              🗺️ Buka di Google Maps
            </a>
          )}
        </div>
      </div>
      <FormField label="Latitude">
        <input value={locLat} onChange={e => setLocLat(e.target.value)} placeholder="-6.123456" className={inputCls} inputMode="decimal" />
      </FormField>
      <FormField label="Longitude">
        <input value={locLng} onChange={e => setLocLng(e.target.value)} placeholder="106.123456" className={inputCls} inputMode="decimal" />
      </FormField>
      <div className="sm:col-span-2">
        <FormField label="Radius GPS (meter)">
          <input value={locRadius} onChange={e => setLocRadius(e.target.value)} className={inputCls} inputMode="numeric" />
        </FormField>
      </div>
    </div>
  );

  const daftarLokasiBody = (() => {
    if (locations.length === 0) {
      return <EmptyState icon="📍" title="Belum ada lokasi" description="Belum ada lokasi di project ini." />;
    }
    const q = cariLokasi.trim().toLowerCase();
    let tersaring = q ? locations.filter(l => l.name.toLowerCase().includes(q) || (l.address ?? '').toLowerCase().includes(q)) : locations;
    if (filterAreaNama) tersaring = tersaring.filter(l => (areas.find(a => a.id === l.area_id)?.name ?? '—') === filterAreaNama);
    if (filterStatus) tersaring = tersaring.filter(l => (filterStatus === 'active') === (l.status === 'active'));
    if (filterCakupan) tersaring = tersaring.filter(l => cakupan(l) === filterCakupan);
    if (tersaring.length === 0) {
      return <EmptyState icon="🔎" title="Tidak ditemukan" description="Tidak ada lokasi yang cocok dengan filter saat ini." />;
    }
    return (
      // Table sungguhan (thead+tbody), bukan <select> - permintaan eksplisit
      // user: "Lokasi aktif masuk di table bukan select seperti itu lalu ada
      // PIC | List TV points | status | edit dan hapus".
      <div className="overflow-x-auto lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase text-slate-400 z-10">
            <tr>
              <th className="text-left px-4 py-2.5">Lokasi</th>
              <th className="text-left px-4 py-2.5">PIC</th>
              <th className="text-left px-4 py-2.5">Titik TV</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-right px-4 py-2.5">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 stagger-rows">
            {tersaring.map(l => {
              const area = areas.find(a => a.id === l.area_id);
              const nonaktif = l.status !== 'active';
              const jmlTitik = jumlahTitik[l.id] ?? 0;
              const c = cakupan(l);
              return (
                <tr key={l.id} className="hover:bg-slate-50 transition-colors" style={{ background: 'transparent' }}>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setDetailLokasiId(l.id)} className="text-left">
                      <p className="text-sm font-bold text-slate-800 truncate hover:text-indigo-600">{l.name}</p>
                      <p className="text-xs text-slate-400 truncate">{area?.name ?? '—'}</p>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {editingPicLokasiId === l.id ? (
                      <div className="flex items-center gap-1.5">
                        <select autoFocus disabled={simpanPicLokasi} defaultValue={picIdsLokasi[l.id]?.[0] ?? ''}
                          onChange={e => void ubahPicLokasi(l.id, e.target.value)}
                          className="text-xs border border-indigo-200 rounded-lg px-1.5 py-1 max-w-[140px]">
                          <option value="">— tidak ada —</option>
                          {userOptions.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                        </select>
                        <button type="button" onClick={() => setEditingPicLokasiId(null)} disabled={simpanPicLokasi}
                          title="Batal" className="text-slate-300 hover:text-slate-600">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 group">
                        <span className="truncate">{namaPicLokasi(l.id)}</span>
                        {bolehAssignPic && (picIdsLokasi[l.id]?.length ?? 0) <= 1 && (
                          <button type="button" onClick={() => setEditingPicLokasiId(l.id)}
                            title={`Ganti PIC ${l.name}`} aria-label={`Ganti PIC ${l.name}`}
                            className="text-slate-300 hover:text-indigo-600 flex-shrink-0">✏️</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{jmlTitik} titik</td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={c === 'Tercakup' ? { background: '#dcfce7', color: '#15803d' } : c === 'Perlu PIC' ? { background: '#fef3c7', color: '#92400e' } : { background: '#f1f5f9', color: '#64748b' }}>
                      {c}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 flex-shrink-0">
                      <button type="button" onClick={() => setDetailLokasiId(l.id)} title={`Detail ${l.name}`}
                        className="text-xs font-bold px-2 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 whitespace-nowrap">
                        Detail
                      </button>
                      <a href={`https://www.google.com/maps?q=${l.latitude},${l.longitude}`} target="_blank" rel="noopener noreferrer"
                        title="Buka di Google Maps" aria-label={`Buka ${l.name} di Google Maps`} className="p-1.5 text-base hover:opacity-70 transition-opacity">🗺️</a>
                      {bolehKelola && (
                        <>
                          <button type="button" onClick={() => mulaiEditLokasi(l)} title={`Edit ${l.name}`}
                            className="text-xs font-bold px-2 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 whitespace-nowrap">Edit</button>
                          <button type="button" onClick={() => mintaNonaktifkanLokasi(l)} title={nonaktif ? `Aktifkan ${l.name}` : `Nonaktifkan ${l.name}`}
                            className="text-xs font-bold px-2 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 whitespace-nowrap">
                            {nonaktif ? 'Aktifkan' : 'Nonaktifkan'}
                          </button>
                          <button type="button" onClick={() => mintaHapusLokasiSatu(l)} title={`Hapus ${l.name}`} aria-label={`Hapus ${l.name}`}
                            className="text-slate-300 hover:text-rose-600 p-1.5">🗑️</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  })();

  const totalTitik = Object.values(jumlahTitik).reduce((s, n) => s + n, 0);
  const belumAdaPic = locations.filter(l => l.status === 'active' && (picIdsLokasi[l.id]?.length ?? 0) === 0).length;
  const jmlTercakup = locations.filter(l => cakupan(l) === 'Tercakup').length;
  const jmlNonaktif = locations.filter(l => cakupan(l) === 'Nonaktif').length;

  return (
    <div className="space-y-4 lg:h-full lg:flex lg:flex-col">
      {!selectedProjectId ? (
        <EmptyState icon="👆" title="Pilih project dulu" description="Pilih project aktif di selector sidebar untuk mengelola lokasinya." />
      ) : (
        <>
        {locations.length > 0 && (
          <>
            {/* Ringkasan berbasis TV, bukan cuma jumlah lokasi - satu bentuk
                dengan Dashboard (ubin KPI berikon lucide), bukan StatCardGrid
                gelap yang tampil beda sendiri. Yang dikelola platform ini
                adalah TITIK TV; "2 lokasi" tidak memberi tahu apa pun
                tentang beban kerja, sedangkan "3 titik TV, rata-rata 1,5
                per gedung" langsung terbaca. */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 lg:flex-shrink-0">
              <UbinKpi ikon={Tv} label="Titik TV" nilai={totalTitik} warna="#2a78d6" sub="Total yang dikelola" />
              <UbinKpi ikon={Building2} label="Lokasi" nilai={locations.length} warna="#4338ca"
                sub={`${locations.filter(l => l.status === 'active').length} aktif`} />
              <UbinKpi ikon={MapIconLucide} label="Wilayah" nilai={areas.length} warna="#7c3aed" sub="Area terdaftar" />
              <UbinKpi ikon={Activity} label="Rata-rata TV" nilai={locations.length ? (totalTitik / locations.length).toFixed(1).replace('.', ',') : '0'} warna="#0d9488" sub="Per gedung" />
              <UbinKpi ikon={AlertTriangle} label="Belum Ada PIC" nilai={belumAdaPic} warna="#d97706" sub="Lokasi aktif" />
              <UbinKpi ikon={Users} label="PIC Bertugas" nilai={new Set(Object.values(picIdsLokasi).flat()).size} warna="#059669" sub="Orang" />
            </div>
            {/* Tiga sudut pandang berdampingan: seberapa TERTANGANI (cakupan
                PIC), seberapa TERSEBAR beban TV-nya (per wilayah), dan
                rinciannya per wilayah dalam angka. Dua donat saja membuat
                pengguna harus menebak jumlah pastinya.
                Dua donat SEMPIT + rincian wilayah LEBAR - donat cuma perlu
                ruang seukuran dirinya sendiri, sementara rincian per wilayah
                (4 kolom angka) justru butuh lebar. */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,260px)_minmax(0,300px)_minmax(0,1fr)] gap-3 lg:flex-shrink-0 items-stretch">
              <Kartu>
                <JudulPanel ikon={Users} judul="Cakupan PIC" />
                <DonutLegenda ukuran={76} labelPusat="Lokasi"
                  data={[
                    { label: 'Tercakup', value: jmlTercakup, color: '#059669',
                      onClick: () => setFilterCakupan(filterCakupan === 'Tercakup' ? null : 'Tercakup'),
                      aktif: filterCakupan === 'Tercakup' },
                    { label: 'Perlu PIC', value: belumAdaPic, color: '#eda100',
                      onClick: () => setFilterCakupan(filterCakupan === 'Perlu PIC' ? null : 'Perlu PIC'),
                      aktif: filterCakupan === 'Perlu PIC' },
                    { label: 'Nonaktif', value: jmlNonaktif, color: '#94a3b8',
                      onClick: () => setFilterCakupan(filterCakupan === 'Nonaktif' ? null : 'Nonaktif'),
                      aktif: filterCakupan === 'Nonaktif' },
                  ]} />
              </Kartu>

              <Kartu>
                <JudulPanel ikon={MapIconLucide} judul="Titik TV per Wilayah" />
                {(() => {
                  // Menghitung TITIK TV per wilayah, bukan jumlah lokasi: satu
                  // wilayah dengan 2 gedung × 90 TV jauh lebih berat daripada
                  // wilayah dengan 8 gedung × 3 TV, dan versi lama menampilkan
                  // keduanya terbalik.
                  const PALET = ['#2a78d6', '#eb6834', '#1baf7a', '#7c3aed', '#eda100', '#0891b2'];
                  const hitung = new Map<string, number>();
                  for (const l of locations) {
                    const nama = areas.find(a => a.id === l.area_id)?.name ?? '—';
                    hitung.set(nama, (hitung.get(nama) ?? 0) + (jumlahTitik[l.id] ?? 0));
                  }
                  return (
                    <DonutLegenda ukuran={76} labelPusat="Titik TV"
                      data={Array.from(hitung.entries()).map(([nama, n], i) => ({
                        label: nama, value: n, color: PALET[i % PALET.length],
                        onClick: () => setFilterAreaNama(filterAreaNama === nama ? null : nama),
                        aktif: filterAreaNama === nama,
                      }))} />
                  );
                })()}
              </Kartu>

              <Kartu>
                <JudulPanel ikon={Building2} judul="Ringkasan per Wilayah"
                  aksi={<span className="text-[10px] text-slate-400">klik baris untuk menyaring</span>} />
                {(() => {
                  // Rincian angka pasti per wilayah - donat menjawab
                  // "proporsinya", tabel ini menjawab "persisnya berapa, dan
                  // wilayah mana yang butuh tindakan".
                  const baris = areas.map(a => {
                    const lokasiArea = locations.filter(l => l.area_id === a.id);
                    return {
                      nama: a.name,
                      lokasi: lokasiArea.length,
                      tv: lokasiArea.reduce((s, l) => s + (jumlahTitik[l.id] ?? 0), 0),
                      tanpaPic: lokasiArea.filter(l => l.status === 'active' && (picIdsLokasi[l.id]?.length ?? 0) === 0).length,
                    };
                  }).sort((x, y) => y.tv - x.tv);
                  const tvMaks = Math.max(1, ...baris.map(b => b.tv));
                  return (
                    <TabelRingkas
                      kolom={[
                        { judul: 'Wilayah' },
                        { judul: 'Sebaran TV', lebar: '34%' },
                        { judul: 'Gedung', kanan: true, lebar: '13%' },
                        { judul: 'TV', kanan: true, lebar: '11%' },
                        { judul: 'Perlu PIC', kanan: true, lebar: '15%' },
                      ]}
                      baris={baris}
                      onKlikBaris={b => setFilterAreaNama(filterAreaNama === b.nama ? null : b.nama)}
                      kunci={b => ({
                        id: b.nama,
                        sel: [
                          <span key="n" className="font-semibold text-slate-700 truncate block max-w-[150px]"
                            style={filterAreaNama === b.nama ? { color: '#4338ca' } : undefined}>{b.nama}</span>,
                          // Batang pembanding antar wilayah - sekali lihat
                          // ketahuan wilayah mana yang bebannya paling berat,
                          // tanpa membandingkan angka satu per satu.
                          <span key="b" className="block h-2 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                            <span className="block h-full rounded-full"
                              style={{ width: `${(b.tv / tvMaks) * 100}%`, background: '#2a78d6' }} />
                          </span>,
                          <span key="g" className="tabular-nums text-slate-600">{b.lokasi}</span>,
                          <span key="t" className="tabular-nums font-bold text-slate-800">{b.tv}</span>,
                          <span key="p" className="tabular-nums font-bold"
                            style={{ color: b.tanpaPic > 0 ? '#b45309' : '#cbd5e1' }}>{b.tanpaPic}</span>,
                        ],
                      })} />
                  );
                })()}
              </Kartu>
            </div>
          </>
        )}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 justify-between lg:flex-shrink-0">
            <h3 className="text-sm font-bold text-slate-700">Locations ({locations.length})</h3>
            {bolehKelola && (
              <div className="flex items-center gap-2 flex-wrap">
                {bolehAssignPic && (
                  <button type="button" onClick={() => setModalBulkAssignTerbuka(true)}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                    🧑‍🔧 Assign PIC ke Banyak Lokasi
                  </button>
                )}
                <button type="button" onClick={() => setModalImportTerbuka(true)}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                  Import
                </button>
                <button type="button" onClick={eksporLokasiCsv} disabled={locations.length === 0}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  Export
                </button>
                <button type="button" onClick={bukaTambahLokasi}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'linear-gradient(135deg,#4338ca,#3730a3)' }}>
                  + Add Location
                </button>
              </div>
            )}
          </div>

          {locations.length > 0 && (
            <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2 lg:flex-shrink-0">
              <input value={cariLokasi} onChange={e => setCariLokasi(e.target.value)}
                placeholder="🔎 Cari nama/alamat lokasi…" autoComplete="off"
                className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-full sm:w-56" />
              {/* Combobox, bukan <select> polos: daftar wilayah bisa puluhan
                  sampai ratusan, dan menggulir dropdown native untuk mencari
                  "Jakarta Barat" di antaranya bukan pencarian. */}
              <div className="w-full sm:w-52">
                <SearchableSelect
                  value={filterAreaNama ?? ''}
                  onChange={v => setFilterAreaNama(v || null)}
                  placeholder="Semua wilayah"
                  options={[{ value: '', label: 'Semua wilayah' },
                    ...areas.map(a => ({ value: a.name, label: a.name }))]} />
              </div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as '' | 'active' | 'inactive')}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5">
                <option value="">Semua status</option>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
              {filterCakupan && (
                <button type="button" onClick={() => setFilterCakupan(null)}
                  className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap">
                  {filterCakupan} ✕
                </button>
              )}
              {bolehKelola && <CentangSemua ids={locations.map(l => l.id)} dipilih={seleksiLokasi.dipilih} toggleSemua={seleksiLokasi.toggleSemua} />}
            </div>
          )}
          {bolehKelola && (
            <div className="lg:flex-shrink-0">
              <BarHapusMassal jumlah={seleksiLokasi.dipilih.size} onHapus={mintaHapusLokasiMassal} sedangHapus={menghapusLokasi} />
            </div>
          )}

          {daftarLokasiBody}
        </div>
        </>
      )}

      <Modal buka={modalLokasiTerbuka} onTutup={() => setModalLokasiTerbuka(false)}
        judul={editingLocId ? 'Edit Lokasi' : 'Tambah Lokasi'}
        keterangan="Radius GPS menentukan seberapa jauh PIC boleh check-in dari titik pin ini."
        ukuran="lg" tutupDiLuar={false}
        footer={<>
          <TombolModal jenis="batal" onClick={() => setModalLokasiTerbuka(false)}>Batal</TombolModal>
          <TombolModal jenis="utama" onClick={simpanLokasi} disabled={simpanLoc || !locNama.trim() || !locAreaId}>
            {simpanLoc ? 'Menyimpan…' : editingLocId ? 'Simpan Perubahan' : 'Tambah Lokasi'}
          </TombolModal>
        </>}>
        {lokasiModalBody}
      </Modal>

      <Modal buka={modalImportTerbuka} onTutup={() => setModalImportTerbuka(false)} judul="Import Lokasi dari CSV" ukuran="md">
        <ImportLokasiCsv areas={areas} selectedProjectId={selectedProjectId} onReloadAreas={onReloadAreas} onReloadLocations={onReloadLocations} beritahu={beritahu} />
      </Modal>

      <BulkAssignModal buka={modalBulkAssignTerbuka} onTutup={() => setModalBulkAssignTerbuka(false)}
        locations={locations.filter(l => l.status === 'active')} userOptions={userOptions} selectedProjectId={selectedProjectId}
        allowMultiPic={allowMultiPic} onReload={() => void muatRingkasan()} />

      {detailLokasiId && (() => {
        const l = locations.find(x => x.id === detailLokasiId);
        if (!l) return null;
        return (
          <LocationDetailModal location={l} areaName={areas.find(a => a.id === l.area_id)?.name ?? '—'}
            userOptions={userOptions} selectedProjectId={selectedProjectId} contents={contents}
            bolehKelolaMasterData={bolehKelola} bolehAssignPic={bolehAssignPic}
            onTutup={() => setDetailLokasiId(null)} onReload={() => void muatRingkasan()} />
        );
      })()}

      <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />
    </div>
  );
}


// ── Tab: Content Master ──────────────────────────────────────────────────
// Content Period (when it airs, e.g. 11-15 Sep) is a DIFFERENT date range
// from Deployment Date (when a technician installs it - can be days before
// the period even starts, as ordinary prep work, per the patch's §1/§13).
// This tab manages the "when it airs" side; deployment date is whatever day
// an assignment/execution instance actually happens on.

function ContentTab({ selectedProjectId, contents, bolehKelola, onReload, beritahu }: {
  selectedProjectId: string;
  contents: FsContent[];
  bolehKelola: boolean;
  onReload: () => void;
  beritahu: (tipe: 'ok' | 'gagal', teks: string) => void;
}) {
  const [nama, setNama] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [simpan, setSimpan] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [modalTerbuka, setModalTerbuka] = useState(false);
  const [cariContent, setCariContent] = useState('');
  const [filterStatusContent, setFilterStatusContent] = useState<'' | 'active' | 'inactive'>('');
  /** "Apakah tidak ada summary berapa TV sukses, berapa belum, gedung mana
   *  saja - untuk report marcom" (keluhan eksplisit user). Klik nama content
   *  membuka laporan deployment-nya: siklus mana yang memakainya, dan hasil
   *  per gedung pada siklus itu. */
  const [detailContentId, setDetailContentId] = useState<string | null>(null);

  /** Kolom "Usage" (brief transformasi UX: "Content Library" butuh kolom
   *  Usage) - jumlah assignment AKTIF yang memakai versi content ini,
   *  dimuat sendiri di sini seperti pola query ringan yang sama dipakai
   *  LocationsTab/PointsTab. */
  const [usageContent, setUsageContent] = useState<Record<string, number>>({});

  useEffect(() => {
    if (contents.length === 0) { setUsageContent({}); return; }
    let batal = false;
    (async () => {
      const ids = contents.map(c => c.id);
      const { data } = await supabase.from('fs_pic_assignments')
        .select('content_id').in('content_id', ids).eq('active', true);
      if (batal) return;
      const u: Record<string, number> = {};
      for (const a of (data ?? []) as { content_id: string | null }[]) {
        if (!a.content_id) continue;
        u[a.content_id] = (u[a.content_id] ?? 0) + 1;
      }
      setUsageContent(u);
    })();
    return () => { batal = true; };
  }, [contents]);

  const bukaTambahContent = () => {
    setNama(''); setValidFrom(''); setValidUntil(''); setFileUrl('');
    setModalTerbuka(true);
  };

  const simpanContent = async () => {
    if (!nama.trim() || !validFrom || !validUntil || !selectedProjectId) return;
    if (validUntil < validFrom) { beritahu('gagal', 'Valid Until harus sama atau setelah Valid From.'); return; }
    setSimpan(true);
    // Versi berikutnya untuk nama yang sama di project ini - INSERT baris
    // baru, bukan UPDATE yang lama, supaya laporan lama tetap menunjuk ke
    // versi yang benar-benar dipakai saat itu (§15 dari patch).
    const versiSebelumnya = contents
      .filter(c => c.name.trim().toLowerCase() === nama.trim().toLowerCase())
      .reduce((max, c) => Math.max(max, c.version), 0);
    const { error } = await supabase.from('fs_content').insert({
      project_id: selectedProjectId, name: nama.trim(), version: versiSebelumnya + 1,
      valid_from: validFrom, valid_until: validUntil, file_url: fileUrl.trim() || null,
    });
    setSimpan(false);
    if (error) { beritahu('gagal', 'Gagal membuat content: ' + error.message); return; }
    beritahu('ok', `Content "${nama.trim()}" v${versiSebelumnya + 1} dibuat.`);
    setNama(''); setValidFrom(''); setValidUntil(''); setFileUrl('');
    setModalTerbuka(false);
    onReload();
  };

  const eksporContentCsv = () => {
    unduhCsv(
      `content-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Nama Content', 'Versi', 'Valid From', 'Valid Until', 'Status', 'Usage', 'Link File'],
      contents.map(c => [c.name, c.version, c.valid_from, c.valid_until, c.status, usageContent[c.id] ?? 0, c.file_url ?? '']),
    );
  };

  const ubahStatusContent = async (c: FsContent) => {
    const statusBaru = c.status === 'active' ? 'archived' : 'active';
    const { error } = await supabase.from('fs_content').update({ status: statusBaru }).eq('id', c.id);
    if (error) { beritahu('gagal', 'Gagal mengubah status: ' + error.message); return; }
    beritahu('ok', statusBaru === 'active' ? `"${c.name}" v${c.version} diaktifkan kembali.` : `"${c.name}" v${c.version} diarsipkan.`);
    onReload();
  };

  const mintaArsipkan = (c: FsContent) => {
    if (c.status !== 'active') { void ubahStatusContent(c); return; }
    setConfirmState({
      message: `Arsipkan "${c.name}" v${c.version}?`,
      description: 'Content yang diarsipkan tidak lagi bisa dipilih untuk assignment baru. Assignment/laporan lama yang sudah memakainya tidak berubah.',
      danger: true, confirmLabel: 'Arsipkan',
      onConfirm: () => ubahStatusContent(c),
    });
  };

  const seleksiContent = useSeleksi();
  const [menghapusContent, setMenghapusContent] = useState(false);

  // content_id di fs_pic_assignments/fs_execution_instances/fs_daily_reports
  // semuanya ON DELETE SET NULL (011) - menghapus content TIDAK menghapus
  // assignment atau laporan mana pun, cuma melepas rujukannya (laporan lama
  // tetap punya nama/versi/periode lewat kolom snapshot-nya sendiri).
  const hapusContents = async (ids: string[]) => {
    setMenghapusContent(true);
    const { error } = await supabase.from('fs_content').delete().in('id', ids);
    setMenghapusContent(false);
    if (error) { beritahu('gagal', 'Gagal menghapus: ' + error.message); return; }
    beritahu('ok', ids.length > 1 ? `${ids.length} content dihapus.` : 'Content dihapus.');
    seleksiContent.kosongkan();
    onReload();
  };

  const mintaHapusContentSatu = (c: FsContent) => setConfirmState({
    message: `Hapus content "${c.name}" v${c.version} permanen?`,
    description: 'Assignment/laporan yang sudah memakai versi ini tetap menunjukkan nama & periodenya lewat catatan riwayat sendiri, tapi rujukan langsungnya akan lepas. Tidak bisa dibatalkan.',
    danger: true, confirmLabel: 'Hapus Permanen',
    onConfirm: () => hapusContents([c.id]),
  });

  const mintaHapusContentMassal = () => {
    const ids = Array.from(seleksiContent.dipilih);
    if (ids.length === 0) return;
    setConfirmState({
      message: `Hapus ${ids.length} content terpilih permanen?`,
      description: 'Assignment/laporan yang sudah memakainya tetap menunjukkan nama & periodenya lewat catatan riwayat sendiri. Tidak bisa dibatalkan.',
      danger: true, confirmLabel: `Hapus ${ids.length} Content`,
      onConfirm: () => hapusContents(ids),
    });
  };

  const daftarContentBody = (() => {
    if (contents.length === 0) {
      return <EmptyState icon="🖼️" title="Belum ada content" description="Buat content pertama lewat tombol + Add Content." />;
    }
    const q = cariContent.trim().toLowerCase();
    let tersaring = q ? contents.filter(c => c.name.toLowerCase().includes(q)) : contents;
    if (filterStatusContent) tersaring = tersaring.filter(c => (filterStatusContent === 'active') === (c.status === 'active'));
    if (tersaring.length === 0) {
      return <EmptyState icon="🔎" title="Tidak ditemukan" description="Tidak ada content yang cocok dengan filter saat ini." />;
    }
    return (
      // Table sungguhan dengan kolom tetap - sebelumnya baris nama+versi+status
      // ditulis jadi satu paragraf panjang tanpa kolom, sehingga tidak bisa
      // dipindai sekilas seperti tabel Locations di tab sebelah.
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase text-slate-400 z-10">
            <tr>
              {bolehKelola && <th className="px-4 py-2.5 w-8" aria-hidden="true" />}
              <th className="text-left px-4 py-2.5">Content</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Content Period</th>
              <th className="text-right px-4 py-2.5">Usage</th>
              <th className="text-right px-4 py-2.5">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 stagger-rows">
            {tersaring.map(c => {
              const nonaktif = c.status !== 'active';
              const usage = usageContent[c.id] ?? 0;
              return (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  {bolehKelola && (
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={seleksiContent.dipilih.has(c.id)} onChange={() => seleksiContent.toggle(c.id)}
                        aria-label={`Pilih ${c.name} v${c.version}`} className="w-4 h-4 rounded border-slate-300 accent-rose-600" />
                    </td>
                  )}
                  <td className="px-4 py-3 min-w-0">
                    <button type="button" onClick={() => setDetailContentId(c.id)} className="flex items-center gap-2 text-left cursor-pointer group">
                      <p className="text-sm font-bold text-slate-800 truncate max-w-[280px] group-hover:text-indigo-600">{c.name}</p>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: '#eef2ff', color: '#4338ca' }}>
                        v{c.version}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full whitespace-nowrap"
                      style={nonaktif ? { background: '#f1f5f9', color: '#64748b' } : { background: '#dcfce7', color: '#15803d' }}>
                      {nonaktif ? 'Arsip' : 'Aktif'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap tabular-nums text-[13px]">
                    {c.valid_from} – {c.valid_until}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-700">
                    {usage}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button type="button" onClick={() => mintaArsipkan(c)}
                        className="text-[11px] font-bold text-slate-400 hover:text-rose-600 cursor-pointer whitespace-nowrap">
                        {nonaktif ? 'Aktifkan' : 'Arsipkan'}
                      </button>
                      <button type="button" onClick={() => mintaHapusContentSatu(c)}
                        title={`Hapus ${c.name} v${c.version}`} aria-label={`Hapus ${c.name} v${c.version}`}
                        className="text-slate-300 hover:text-rose-600 p-1 cursor-pointer">
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  })();

  return (
    <div className="space-y-4">
      {!selectedProjectId ? (
        <EmptyState icon="👆" title="Pilih project dulu" description="Pilih project aktif di selector sidebar untuk mengelola content-nya." />
      ) : (
        <>
        {contents.length > 0 && (() => {
          const today = new Date().toISOString().slice(0, 10);
          const aktif = contents.filter(c => c.status === 'active').length;
          const arsip = contents.length - aktif;
          const berlaku = contents.filter(c => c.valid_from <= today && c.valid_until >= today).length;
          const akanDatang = contents.filter(c => c.valid_from > today).length;
          const kedaluwarsa = contents.filter(c => c.valid_until < today).length;
          const teratas = [...contents].sort((a, b) => (usageContent[b.id] ?? 0) - (usageContent[a.id] ?? 0)).slice(0, 6);
          const usageMaks = Math.max(1, ...teratas.map(c => usageContent[c.id] ?? 0));
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
                <UbinKpi ikon={ImageIcon} label="Total Content" nilai={contents.length} warna="#4338ca" />
                <UbinKpi ikon={CheckCircle2} label="Aktif" nilai={aktif} warna="#059669" />
                <UbinKpi ikon={CalendarDays} label="Berlaku Hari Ini" nilai={berlaku} warna="#2a78d6" sub="Dalam Content Period" />
                <UbinKpi ikon={Clock} label="Kedaluwarsa" nilai={kedaluwarsa} warna="#94a3b8" sub="Valid Until terlewat" />
              </div>
              {/* Tiga sudut pandang berdampingan, konsisten dengan tab Lokasi:
                  status arsip/aktif, posisi masa berlaku, dan yang paling
                  sering dipakai - bukan cuma 4 angka tanpa rincian.
                  HANYA ditampilkan kalau library-nya cukup besar untuk
                  pecahan itu berarti - donat untuk 1-2 content isinya
                  cuma satu warna penuh, terasa aneh/mengada-ada (keluhan
                  user via screenshot), jadi library kecil langsung ke tabel
                  di bawah tanpa basa-basi tiga panel ini. */}
              {contents.length >= 4 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,240px)_minmax(0,240px)_minmax(0,1fr)] gap-3 mb-4 items-stretch">
                <Kartu>
                  <JudulPanel ikon={CheckCircle2} judul="Status Content" />
                  <DonutLegenda ukuran={76} labelPusat="Content" data={[
                    { label: 'Aktif', value: aktif, color: '#059669' },
                    { label: 'Arsip', value: arsip, color: '#94a3b8' },
                  ]} />
                </Kartu>
                <Kartu>
                  <JudulPanel ikon={CalendarDays} judul="Masa Berlaku" />
                  <DonutLegenda ukuran={76} labelPusat="Content" data={[
                    { label: 'Berlaku', value: berlaku, color: '#2a78d6' },
                    { label: 'Akan Datang', value: akanDatang, color: '#7c3aed' },
                    { label: 'Kedaluwarsa', value: kedaluwarsa, color: '#cbd5e1' },
                  ]} />
                </Kartu>
                <Kartu>
                  <JudulPanel ikon={ImageIcon} judul="Paling Banyak Dipakai"
                    aksi={<span className="text-[10px] text-slate-400">berdasar jumlah assignment aktif</span>} />
                  {teratas.every(c => (usageContent[c.id] ?? 0) === 0) ? (
                    <p className="text-xs text-slate-400 text-center py-6">Belum ada content yang dipakai assignment manapun.</p>
                  ) : (
                    // Nama content DIBATASI, bukan kolom Pemakaian - sama
                    // seperti perbaikan tabel Wilayah di ReviewSiklus.tsx:
                    // kolom tanpa `lebar` yang mendapat sisa ruang kartu 1fr.
                    <TabelRingkas
                      kolom={[{ judul: 'Content', lebar: '160px' }, { judul: 'Pemakaian' }, { judul: 'Usage', kanan: true, lebar: '56px' }]}
                      baris={teratas}
                      kunci={c => ({
                        id: c.id,
                        sel: [
                          <span key="n" className="font-semibold text-slate-700 truncate block max-w-[170px]">{c.name} <span className="text-slate-400 font-normal">v{c.version}</span></span>,
                          <span key="b" className="block h-2 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                            <span className="block h-full rounded-full" style={{ width: `${((usageContent[c.id] ?? 0) / usageMaks) * 100}%`, background: '#4338ca' }} />
                          </span>,
                          <span key="u" className="tabular-nums font-bold text-slate-800">{usageContent[c.id] ?? 0}</span>,
                        ],
                      })} />
                  )}
                </Kartu>
              </div>
              )}
            </>
          );
        })()}
        {/* Content Library - BROWSE dulu, bukan CREATE, konsisten dengan
            Projects/Locations/Points/Assignments. */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 justify-between">
            <h3 className="text-sm font-bold text-slate-700">Content Library ({contents.length})</h3>
            {bolehKelola && (
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={eksporContentCsv} disabled={contents.length === 0}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  Export
                </button>
                <button type="button" onClick={bukaTambahContent}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'linear-gradient(135deg,#4338ca,#3730a3)' }}>
                  + Add Content
                </button>
              </div>
            )}
          </div>
          {contents.length > 0 && (
            <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2">
              <input value={cariContent} onChange={e => setCariContent(e.target.value)}
                placeholder="🔎 Cari nama content…" autoComplete="off"
                className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-full sm:w-56" />
              <select value={filterStatusContent} onChange={e => setFilterStatusContent(e.target.value as '' | 'active' | 'inactive')}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5">
                <option value="">Semua status</option>
                <option value="active">Aktif</option>
                <option value="inactive">Arsip</option>
              </select>
              {bolehKelola && (
                <CentangSemua ids={contents.map(c => c.id)} dipilih={seleksiContent.dipilih} toggleSemua={seleksiContent.toggleSemua} />
              )}
            </div>
          )}
          {bolehKelola && <BarHapusMassal jumlah={seleksiContent.dipilih.size} onHapus={mintaHapusContentMassal} sedangHapus={menghapusContent} />}
          {daftarContentBody}
        </div>
        </>
      )}

      <Modal buka={modalTerbuka} onTutup={() => setModalTerbuka(false)}
        judul="Tambah Content" keterangan="Nama yang sama dengan content yang sudah ada otomatis jadi versi berikutnya (v1, v2, ...) - bukan menimpa yang lama."
        ukuran="md" tutupDiLuar={false}
        footer={<>
          <TombolModal jenis="batal" onClick={() => setModalTerbuka(false)}>Batal</TombolModal>
          <TombolModal jenis="utama" onClick={simpanContent} disabled={simpan || !nama.trim() || !validFrom || !validUntil}>
            {simpan ? 'Menyimpan…' : 'Tambah Content'}
          </TombolModal>
        </>}>
        <div className="grid grid-cols-1 gap-3">
          <FormField label="Nama content">
            <input value={nama} onChange={e => setNama(e.target.value)} placeholder="mis. Content 11 - 15 September 2025"
              className={inputCls} autoFocus />
          </FormField>
          <FormField label="Content Period — Valid From">
            <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Content Period — Valid Until">
            <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className={inputCls} />
          </FormField>
          <FormField label={<>Link file <span className="normal-case font-normal text-slate-300">— opsional</span></>}>
            <input value={fileUrl} onChange={e => setFileUrl(e.target.value)} placeholder="https://..."
              className={inputCls} />
          </FormField>
          <p className="text-xs text-slate-400 leading-relaxed">
            Content Period ≠ tanggal deployment — ini murni kapan content-nya <em>berlaku tayang</em>.
          </p>
        </div>
      </Modal>

      <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />

      <DialogBesar buka={!!detailContentId} onTutup={() => setDetailContentId(null)}
        judul={contents.find(c => c.id === detailContentId)?.name ?? 'Laporan Deployment'} ikon={ImageIcon}
        ket="Siklus mana yang memakai content ini, dan hasilnya per gedung — untuk report ke klien/marcom.">
        {detailContentId && (
          <LaporanDeploymentContent contentId={detailContentId} beritahu={beritahu} />
        )}
      </DialogBesar>
    </div>
  );
}

/**
 * LaporanDeploymentContent - menjawab keluhan eksplisit: "apakah tidak ada
 * summary yang berhasil diminggu itu sampai berapa TV sukses berapa TV
 * belum update dan gedung mana saja, ini untuk report marcom."
 *
 * Satu content bisa dipasang di lebih dari satu siklus weekend (dipasang
 * ulang minggu berikutnya, atau dipakai beberapa project) - jadi laporannya
 * per SIKLUS, bukan angka tunggal yang mencampur semua pemakaian jadi satu.
 * Untuk siklus yang sudah CLOSED/CLEARED dipakai ringkasan BEKU
 * (fs_cycle_summaries) supaya angkanya tidak berubah walau foto buktinya
 * sudah dibersihkan; siklus yang masih berjalan dihitung langsung.
 */
function LaporanDeploymentContent({ contentId, beritahu }: {
  contentId: string;
  beritahu: (tipe: 'ok' | 'gagal', teks: string) => void;
}) {
  const [memuat, setMemuat] = useState(true);
  const [baris, setBaris] = useState<{
    cycle: Cycle; overview: CycleOverview | null; buildings: BuildingProgress[];
  }[]>([]);
  const [expandId, setExpandId] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    (async () => {
      setMemuat(true);
      try {
        const { data: cyc, error } = await supabase.from('fs_cycles')
          .select('id, project_id, name, content_id, execution_start, execution_end, review_start, review_end, status, closed_at, clear_requested_at, cleared_at, clear_objects_deleted, clear_objects_failed')
          .eq('content_id', contentId).order('execution_start', { ascending: false });
        if (error) throw new Error(error.message);
        const cycles = (cyc ?? []) as Cycle[];
        if (cycles.length === 0) { if (!batal) { setBaris([]); setMemuat(false); } return; }

        const { data: sum } = await supabase.from('fs_cycle_summaries')
          .select('cycle_id, total_tv, completed_tv, failed_tv, revision_tv, verified_tv')
          .in('cycle_id', cycles.map(c => c.id));
        const bekuMap = new Map((sum ?? []).map((r: { cycle_id: string }) => [r.cycle_id, r]));

        const hasil = await Promise.all(cycles.map(async c => {
          const beku = bekuMap.get(c.id) as { total_tv: number; completed_tv: number; failed_tv: number; revision_tv: number; verified_tv: number } | undefined;
          const overview: CycleOverview | null = beku
            ? { total_tv: beku.total_tv, completed_tv: beku.completed_tv, failed_tv: beku.failed_tv, revision_tv: beku.revision_tv,
                skipped_tv: 0, pending_tv: Math.max(0, beku.total_tv - beku.completed_tv - beku.failed_tv - beku.revision_tv),
                verified_tv: beku.verified_tv, building_total: 0, building_complete: 0, region_total: 0, pic_total: 0, last_activity: null }
            : await ambilOverview(c.id).catch(() => null);
          const buildings = await ambilBuildingProgress(c.id).catch(() => []);
          return { cycle: c, overview, buildings };
        }));
        if (!batal) setBaris(hasil);
      } catch (e) {
        beritahu('gagal', e instanceof Error ? e.message : 'Gagal memuat laporan deployment.');
      } finally { if (!batal) setMemuat(false); }
    })();
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId]);

  if (memuat) return <p className="text-sm text-slate-400 text-center py-10">Memuat laporan…</p>;
  if (baris.length === 0) {
    return <Kosong judul="Belum pernah dipasang" teks="Content ini belum pernah dipakai pada siklus weekend manapun." />;
  }

  return (
    <div className="space-y-3">
      {baris.map(({ cycle, overview, buildings }) => {
        const st = CYCLE_STATUS_LABEL[cycle.status];
        const pct = overview ? persen(overview.completed_tv, overview.total_tv) : 0;
        const terbuka = expandId === cycle.id;
        const bermasalah = buildings.filter(b => b.failed_tv > 0 || b.revision_tv > 0 || b.pending_tv > 0);
        return (
          <div key={cycle.id} className="rounded-xl border border-slate-200 overflow-hidden">
            <button type="button" onClick={() => setExpandId(terbuka ? null : cycle.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 cursor-pointer">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-800 text-sm">{cycle.name}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{rentangTanggal(cycle.execution_start, cycle.execution_end)} · {buildings.length} gedung</p>
              </div>
              {overview && (
                <div className="text-right flex-shrink-0">
                  <p className="text-[15px] font-bold tabular-nums" style={{ color: warnaProgress(pct) }}>{pct}%</p>
                  <p className="text-[11px] text-slate-500 tabular-nums">{overview.completed_tv}/{overview.total_tv} TV sukses</p>
                </div>
              )}
            </button>
            {terbuka && (
              <div className="border-t border-slate-100 px-4 py-3">
                {overview && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <RingkasKotak label="TV Sukses" nilai={overview.completed_tv} warna="#059669" />
                    <RingkasKotak label="Belum Update" nilai={overview.pending_tv} warna="#94a3b8" />
                    <RingkasKotak label="Gagal/Revisi" nilai={overview.failed_tv + overview.revision_tv} warna="#dc2626" />
                  </div>
                )}
                {buildings.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">Belum ada daftar pekerjaan pada siklus ini.</p>
                ) : (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      {bermasalah.length > 0 ? `${bermasalah.length} gedung perlu perhatian` : 'Seluruh gedung sudah lengkap'}
                    </p>
                    <div className="overflow-x-auto -mx-1">
                      <table className="w-full text-[12.5px]">
                        <thead>
                          <tr className="text-slate-400 font-bold uppercase text-[10px]">
                            <th className="text-left px-3 py-1.5">Gedung</th>
                            <th className="text-left px-3 py-1.5">Wilayah</th>
                            <th className="text-right px-3 py-1.5">TV Sukses</th>
                            <th className="text-right px-3 py-1.5">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {[...buildings].sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).map(b => (
                            <tr key={b.location_id}>
                              <td className="px-3 py-1.5 font-semibold text-slate-700">{b.location_name}</td>
                              <td className="px-3 py-1.5 text-slate-500">{b.area_name}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-bold" style={{ color: warnaProgress(b.pct ?? 0) }}>
                                {b.completed_tv}/{b.total_tv}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {b.failed_tv + b.revision_tv > 0 ? (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: '#b91c1c', background: '#fee2e2' }}>bermasalah</span>
                                ) : b.pending_tv > 0 ? (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: '#92400e', background: '#fef3c7' }}>belum lengkap</span>
                                ) : (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: '#047857', background: '#d1fae5' }}>lengkap</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RingkasKotak({ label, nilai, warna }: { label: string; nilai: number; warna: string }) {
  return (
    <div className="rounded-lg px-3 py-2 text-center" style={{ background: `${warna}0d` }}>
      <p className="text-[18px] font-bold tabular-nums" style={{ color: warna }}>{nilai}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}

