'use client';

/**
 * ExecutionWidget.tsx - daftar pekerjaan per gedung/hari + export + detail
 * bukti (GPS/foto). BUKAN lagi ringkasan utama: sejak ControlRoomWidget ada,
 * SELURUH angka ringkasan (completion, per wilayah, per PIC, "perlu
 * perhatian") dijawab di sana, dari agregasi database yang satu sumber.
 *
 * Yang DIBUANG dari versi sebelumnya dan alasannya:
 *  - Kartu "Deployment Completion" + "Progress TV per PIC" + kolom Progress:
 *    dihitung oleh muatDeploymentStat() yang MEMAKAI JUMLAH SELURUH TV DI
 *    GEDUNG sebagai penyebut untuk SETIAP instance. Satu gedung 20 TV yang
 *    punya instance Sabtu dan Minggu terhitung 40 TV; kalau instance-nya
 *    per-TV, satu TV terhitung sebanyak seluruh TV di gedungnya. Angkanya
 *    tidak mungkin benar, dan berdampingan dengan Control Room ia akan
 *    menampilkan dua "persen selesai" yang berbeda untuk hal yang sama.
 *    Penggantinya: fs_cycle_tv_tasks (migrasi 022) + RPC agregasi (023).
 *  - Tiga pie chart (Status/Lokasi/PIC): menghitung JUMLAH INSTANCE, bukan
 *    jumlah TV - menjawab pertanyaan yang tidak pernah ditanyakan siapa pun
 *    ("berapa banyak baris pekerjaan"), sementara pertanyaan sebenarnya
 *    ("berapa TV selesai, di mana yang bermasalah") dijawab lebih cepat oleh
 *    daftar terurut di Control Room.
 *  - Grafik tren 6 bulan: tidak menghasilkan tindakan apa pun di layar
 *    operasional harian; perbandingan antar siklus tempatnya di Riwayat.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { hasFullAccess } from '@/lib/constants';
import { unduhCsv } from '@/lib/csv';
import { FS_STATUS_LABEL } from '@/lib/fs-status';
import { EmptyState } from '@/components/shared';
import { DetailEksekusi } from '@/app/field-service/_components/DetailEksekusi';
import type { WidgetProps } from './primitives';

interface UserOptionLite { id: string; full_name: string; }

interface FsExecInstance {
  id: string;
  location_id: string;
  execution_point_id: string | null;
  instance_date: string;
  status: string;
  assigned_pic_user_id: string | null;
  locationName: string;
  pointName: string | null;
  contentName: string | null;
  contentVersion: number | null;
}

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Semua status' },
  { value: 'NOT_STARTED', label: 'Belum Mulai' },
  { value: 'IN_PROGRESS', label: 'Sedang Berjalan' },
  { value: 'SUBMITTED', label: 'Menunggu Ditandai Selesai' },
  { value: 'COMPLETED', label: 'Selesai (belum dikirim client)' },
  { value: 'WAITING_REVIEW', label: 'Menunggu Review Client' },
  { value: 'VERIFIED', label: 'Terverifikasi' },
  { value: 'REVISION_REQUIRED', label: 'Perlu Revisi' },
];

export function ExecutionWidget({ user }: WidgetProps) {
  const bolehKelola = hasFullAccess(user) || user.fs_role === 'PROVIDER_ADMIN' || user.fs_role === 'PROVIDER_SUPERVISOR';

  const [userOptions, setUserOptions] = useState<UserOptionLite[]>([]);
  const [selectedProjectId] = useState<string>(() =>
    typeof window === 'undefined' ? '' : sessionStorage.getItem('fs_selected_project_id') ?? '');
  const [pesan, setPesan] = useState<{ tipe: 'ok' | 'gagal'; teks: string } | null>(null);
  const beritahu = (tipe: 'ok' | 'gagal', teks: string) => {
    setPesan({ tipe, teks });
    window.setTimeout(() => setPesan(null), 5000);
  };

  const [instances, setInstances] = useState<FsExecInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [hariMundur, setHariMundur] = useState(14);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [aksiJalan, setAksiJalan] = useState<string | null>(null);
  const [cariLokasi, setCariLokasi] = useState('');
  const [filterPic, setFilterPic] = useState<string | null>(null);
  const [terbuka, setTerbuka] = useState(false);
  const [mengeksporLaporan, setMengeksporLaporan] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('users').select('id, full_name').order('full_name');
      setUserOptions((data ?? []) as UserOptionLite[]);
    })();
  }, []);

  const muat = useCallback(async () => {
    if (!selectedProjectId || !terbuka) return;
    setLoading(true);
    const dariTanggal = new Date(Date.now() - hariMundur * 86400000).toISOString().slice(0, 10);
    let q = supabase.from('fs_execution_instances')
      .select('id, location_id, execution_point_id, instance_date, status, assigned_pic_user_id, fs_locations(name), fs_execution_points!execution_point_id(name, floor), fs_content(name, version)')
      .eq('project_id', selectedProjectId)
      .gte('instance_date', dariTanggal)
      .order('instance_date', { ascending: false })
      .limit(200);
    if (statusFilter) q = q.eq('status', statusFilter);
    const { data, error } = await q;
    setLoading(false);
    if (error) { beritahu('gagal', 'Gagal memuat daftar pekerjaan: ' + error.message); return; }
    type Baris = { id: string; location_id: string; execution_point_id: string | null; instance_date: string; status: string; assigned_pic_user_id: string | null; fs_locations: { name: string } | null; fs_execution_points: { name: string; floor: string | null } | null; fs_content: { name: string; version: number } | null };
    setInstances((data ?? []).map((r: Baris) => ({
      id: r.id, location_id: r.location_id, execution_point_id: r.execution_point_id,
      instance_date: r.instance_date, status: r.status, assigned_pic_user_id: r.assigned_pic_user_id,
      locationName: r.fs_locations?.name ?? '—',
      pointName: r.fs_execution_points ? (r.fs_execution_points.floor ? `${r.fs_execution_points.name} — ${r.fs_execution_points.floor}` : r.fs_execution_points.name) : null,
      contentName: r.fs_content?.name ?? null, contentVersion: r.fs_content?.version ?? null,
    })));
  }, [selectedProjectId, statusFilter, hariMundur, terbuka]);

  useEffect(() => { void muat(); }, [muat]);

  const ubahStatus = async (instanceId: string, statusBaru: string) => {
    setAksiJalan(instanceId);
    const { error } = await supabase.rpc('fs_status_transition', { p_instance_id: instanceId, p_new_status: statusBaru });
    setAksiJalan(null);
    if (error) { beritahu('gagal', error.message); return; }
    beritahu('ok', 'Status diperbarui.');
    void muat();
  };

  const eksporLaporanHarian = async () => {
    if (!selectedProjectId) return;
    setMengeksporLaporan(true);
    const dariTanggal = new Date(Date.now() - hariMundur * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase.from('fs_daily_reports')
      .select('deployment_date, displays_total, displays_completed, notes, status, content_name_snapshot, content_version_snapshot, content_valid_from_snapshot, content_valid_until_snapshot, fs_locations(name), users!fs_daily_reports_technician_id_fkey(full_name)')
      .eq('project_id', selectedProjectId).gte('deployment_date', dariTanggal)
      .order('deployment_date', { ascending: false }).limit(2000);
    setMengeksporLaporan(false);
    if (error) { beritahu('gagal', 'Gagal mengambil laporan harian: ' + error.message); return; }
    type Baris = {
      deployment_date: string; displays_total: number; displays_completed: number; notes: string | null; status: string;
      content_name_snapshot: string | null; content_version_snapshot: number | null;
      content_valid_from_snapshot: string | null; content_valid_until_snapshot: string | null;
      fs_locations: { name: string } | null; users: { full_name: string } | null;
    };
    const baris = (data ?? []) as unknown as Baris[];
    if (baris.length === 0) { beritahu('gagal', 'Tidak ada laporan harian pada rentang tanggal ini.'); return; }
    unduhCsv(
      `laporan-harian-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Tanggal Pengerjaan', 'Gedung', 'PIC', 'Status', 'TV Selesai', 'TV Total', 'Konten', 'Versi', 'Tayang Mulai', 'Tayang Selesai', 'Catatan'],
      baris.map(r => [
        r.deployment_date, r.fs_locations?.name ?? '', r.users?.full_name ?? '', r.status,
        r.displays_completed, r.displays_total, r.content_name_snapshot ?? '', r.content_version_snapshot ?? '',
        r.content_valid_from_snapshot ?? '', r.content_valid_until_snapshot ?? '', r.notes ?? '',
      ]),
    );
  };

  if (!selectedProjectId) return null;

  const q = cariLokasi.trim().toLowerCase();
  let tersaring = q
    ? instances.filter(i => i.locationName.toLowerCase().includes(q) || (i.pointName ?? '').toLowerCase().includes(q))
    : instances;
  if (filterPic) {
    tersaring = tersaring.filter(i => (userOptions.find(u => u.id === i.assigned_pic_user_id)?.full_name ?? 'Belum ada PIC') === filterPic);
  }

  return (
    <div id="execution-widget" className="rounded-2xl bg-white border border-slate-200 overflow-hidden"
      style={{ boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
      {/* Tertutup secara default: ini alat bantu (audit bukti, export), bukan
          hal pertama yang perlu dilihat tiap pagi. */}
      <button type="button" onClick={() => setTerbuka(v => !v)}
        className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors text-left">
        <div>
          <h3 className="text-sm font-black text-slate-900">Daftar Pekerjaan &amp; Bukti</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Rincian per gedung/hari, riwayat GPS &amp; foto bukti, dan export laporan.
          </p>
        </div>
        <span className="text-xs font-bold text-blue-700 whitespace-nowrap">{terbuka ? 'Tutup ▲' : 'Buka ▼'}</span>
      </button>

      {terbuka && (
        <>
          {pesan && (
            <div className={`px-4 py-2.5 text-sm font-semibold ${pesan.tipe === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
              {pesan.teks}
            </div>
          )}

          <div className="px-4 py-3 border-y border-slate-100 bg-slate-50 flex flex-wrap items-center gap-2">
            <input value={cariLokasi} onChange={e => setCariLokasi(e.target.value)}
              placeholder="Cari gedung / TV…" autoComplete="off"
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 w-44 bg-white" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              aria-label="Saring status"
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white">
              {STATUS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={filterPic ?? ''} onChange={e => setFilterPic(e.target.value || null)}
              aria-label="Saring PIC"
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white">
              <option value="">Semua PIC</option>
              {Array.from(new Set(instances.map(i => userOptions.find(u => u.id === i.assigned_pic_user_id)?.full_name ?? 'Belum ada PIC'))).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button type="button" onClick={() => setHariMundur(n => n + 14)}
              className="text-xs font-bold text-blue-700 hover:underline whitespace-nowrap">
              Muat {hariMundur} hari lagi
            </button>
            <span className="flex-1" />
            {instances.length > 0 && (
              <button type="button"
                onClick={() => unduhCsv(
                  `pekerjaan-${new Date().toISOString().slice(0, 10)}.csv`,
                  ['Tanggal', 'Gedung', 'TV', 'Status', 'PIC', 'Konten', 'Versi'],
                  instances.map(i => [
                    i.instance_date, i.locationName, i.pointName ?? '', i.status,
                    userOptions.find(u => u.id === i.assigned_pic_user_id)?.full_name ?? '',
                    i.contentName ?? '', i.contentVersion ?? '',
                  ]),
                )}
                className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                Export daftar
              </button>
            )}
            <button type="button" onClick={eksporLaporanHarian} disabled={mengeksporLaporan}
              className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
              {mengeksporLaporan ? 'Menyiapkan…' : 'Export laporan harian'}
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Memuat…</p>
          ) : tersaring.length === 0 ? (
            <EmptyState icon="📋" title="Belum ada pekerjaan"
              description="Tidak ada pekerjaan pada rentang tanggal & filter ini." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-2.5">Gedung / TV</th>
                    <th className="text-left px-4 py-2.5">PIC</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5">Tanggal</th>
                    <th className="text-right px-4 py-2.5">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {tersaring.map(inst => {
                    const st = FS_STATUS_LABEL[inst.status] ?? { label: inst.status, color: '#475569', bg: '#f1f5f9' };
                    const pic = userOptions.find(u => u.id === inst.assigned_pic_user_id);
                    const isExpanded = expanded === inst.id;
                    return (
                      <React.Fragment key={inst.id}>
                        <tr className="hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <p className="font-bold text-slate-800 truncate">{inst.locationName}{inst.pointName ? ` · ${inst.pointName}` : ''}</p>
                            {inst.contentName && <p className="text-[10px] text-slate-400 truncate">{inst.contentName} (v{inst.contentVersion})</p>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{pic?.full_name ?? '—'}</td>
                          <td className="px-4 py-2.5">
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap"
                              style={{ color: st.color, background: st.bg }}>{st.label}</span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{inst.instance_date}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-1.5">
                              {bolehKelola && (inst.status === 'SUBMITTED' || inst.status === 'COMPLETED') && (
                                <button type="button" disabled={aksiJalan === inst.id}
                                  onClick={() => void ubahStatus(inst.id, inst.status === 'SUBMITTED' ? 'COMPLETED' : 'WAITING_REVIEW')}
                                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg text-white disabled:opacity-50 whitespace-nowrap"
                                  style={{ background: '#1d4ed8' }}>
                                  {aksiJalan === inst.id ? '…' : inst.status === 'SUBMITTED' ? 'Tandai Selesai' : 'Kirim ke Client'}
                                </button>
                              )}
                              <button type="button" onClick={() => setExpanded(isExpanded ? null : inst.id)}
                                title="Lihat bukti (GPS & foto)" aria-label="Lihat bukti"
                                className="text-xs font-bold px-2 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 whitespace-nowrap">
                                {isExpanded ? '▲' : 'Bukti'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="p-0 border-b border-slate-100">
                              <DetailEksekusi instanceId={inst.id} bolehReview={bolehKelola} beritahu={beritahu} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
