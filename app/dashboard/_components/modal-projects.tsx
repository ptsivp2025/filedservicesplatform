'use client';
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  EmptyState, StatCardGrid, Modal, TombolModal, ConfirmDialog, type ConfirmState,
} from '@/components/shared';
import { unduhCsv } from '@/lib/csv';

/**
 * Projects & Members - Admin Panel tab (dipindah dari menu sidebar Field
 * Operations "Projects", yang dulu berdiri sendiri sebagai item Operations).
 *
 * KENAPA DI SINI, BUKAN MENU SIDEBAR: Project/Tenant adalah pengaturan
 * struktural (dibuat sekali di awal onboarding client baru, jarang diubah
 * harian) - bukan data operasional yang dibuka berulang seperti Locations.
 * Yang butuh akses ini cuma Provider Admin, persis sama dengan siapa yang
 * boleh buka Admin Panel sama sekali - jadi menu sidebar sendiri untuk ini
 * cuma menambah jumlah item tanpa manfaat operasional (lihat proposal IA
 * yang disetujui user).
 *
 * Member per project sekarang SATU PROJECT PER USER (bukan many-to-many) -
 * migrasi 021 mengganti UNIQUE(project_id,user_id) jadi UNIQUE(user_id).
 * Baris "assign" di bawah karenanya pakai upsert-by-user_id: mencentang user
 * di project lain OTOMATIS memindahkan (bukan menggandakan) keanggotaannya.
 */

interface FsProjectRow {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
}
interface UserRow {
  id: string;
  full_name: string;
  username: string;
  fs_role: string | null;
}

const inputCls = 'w-full text-sm px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-400 bg-white';

export function ProjectsAdminInline() {
  const [projects, setProjects] = useState<FsProjectRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  /** project_id per user_id - satu user cuma bisa punya SATU baris (migrasi 021). */
  const [memberOf, setMemberOf] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [kabar, setKabar] = useState<{ jenis: 'ok' | 'gagal'; teks: string } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const beritahu = (jenis: 'ok' | 'gagal', teks: string) => {
    setKabar({ jenis, teks });
    setTimeout(() => setKabar(null), 5000);
  };

  const muatSemua = async () => {
    setLoading(true);
    const [{ data: p }, { data: u }, { data: m }] = await Promise.all([
      supabase.from('fs_projects').select('id, name, client_name, status').order('name'),
      supabase.from('users').select('id, full_name, username, fs_role').order('full_name'),
      supabase.from('fs_project_members').select('project_id, user_id'),
    ]);
    setProjects((p ?? []) as FsProjectRow[]);
    setUsers((u ?? []) as UserRow[]);
    const mo: Record<string, string> = {};
    for (const row of (m ?? []) as { project_id: string; user_id: string }[]) mo[row.user_id] = row.project_id;
    setMemberOf(mo);
    setLoading(false);
  };

  useEffect(() => { void muatSemua(); }, []);

  // ── Tambah / Hapus Project ──
  const [modalTambahTerbuka, setModalTambahTerbuka] = useState(false);
  const [nama, setNama] = useState('');
  const [client, setClient] = useState('');
  const [simpanProject, setSimpanProject] = useState(false);

  const bukaTambah = () => { setNama(''); setClient(''); setModalTambahTerbuka(true); };
  const tambahProject = async () => {
    if (!nama.trim()) return;
    setSimpanProject(true);
    const { error } = await supabase.from('fs_projects').insert({ name: nama.trim(), client_name: client.trim() || null });
    setSimpanProject(false);
    if (error) { beritahu('gagal', 'Gagal membuat project: ' + error.message); return; }
    setModalTambahTerbuka(false);
    beritahu('ok', `Project "${nama.trim()}" dibuat.`);
    void muatSemua();
  };

  const hapusProject = async (p: FsProjectRow) => {
    const { error } = await supabase.from('fs_projects').delete().eq('id', p.id);
    if (error) { beritahu('gagal', 'Gagal menghapus: ' + error.message); return; }
    beritahu('ok', 'Project dihapus.');
    void muatSemua();
  };

  const mintaHapus = (p: FsProjectRow) => setConfirmState({
    message: `Hapus project "${p.name}" permanen?`,
    description: 'Ini akan menghapus permanen project ini beserta SELURUH data terkait — area, lokasi, execution point, assignment PIC, dan seluruh riwayat eksekusi (evidence, GPS log, laporan harian). Tidak bisa dibatalkan.',
    danger: true, confirmLabel: 'Hapus Permanen',
    onConfirm: () => void hapusProject(p),
  });

  const eksporCsv = () => {
    unduhCsv(`projects-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Nama Project', 'Client', 'Status'],
      projects.map(p => [p.name, p.client_name ?? '', p.status]));
  };

  // ── Members (satu project per user) ──
  const [memberProject, setMemberProject] = useState<FsProjectRow | null>(null);
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);

  const pilihProjectUntukUser = async (userId: string, projectId: string | '') => {
    setMemberBusyId(userId);
    if (!projectId) {
      const { error } = await supabase.from('fs_project_members').delete().eq('user_id', userId);
      setMemberBusyId(null);
      if (error) { beritahu('gagal', 'Gagal melepas keanggotaan: ' + error.message); return; }
      setMemberOf(prev => { const n = { ...prev }; delete n[userId]; return n; });
      return;
    }
    // upsert-by-user_id: migrasi 021 membuat user_id UNIQUE, jadi mencentang
    // project lain untuk user yang sama MEMINDAHKAN baris lama, bukan
    // menambah baris kedua (dulu bug: user bisa kepakai di 2 project sekaligus).
    const { error } = await supabase.from('fs_project_members')
      .upsert({ project_id: projectId, user_id: userId }, { onConflict: 'user_id' });
    setMemberBusyId(null);
    if (error) { beritahu('gagal', 'Gagal mengubah keanggotaan: ' + error.message); return; }
    setMemberOf(prev => ({ ...prev, [userId]: projectId }));
  };

  const daftarProjectBody = (() => {
    if (projects.length === 0) {
      return <EmptyState icon="🏢" title="Belum ada project" description="Buat project pertama lewat tombol + Add Project." />;
    }
    return (
      <div className="divide-y divide-slate-50 stagger-rows">
        {projects.map(p => (
          <div key={p.id} className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 transition-colors">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{p.name}</p>
              <p className="text-xs text-slate-400 truncate">{p.client_name || '—'}</p>
            </div>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0"
              style={p.status === 'active' ? { background: '#dcfce7', color: '#15803d' } : { background: '#f1f5f9', color: '#64748b' }}>
              {p.status === 'active' ? 'Aktif' : 'Nonaktif'}
            </span>
            <button type="button" onClick={() => setMemberProject(p)} title={`Kelola member ${p.name}`}
              className="text-[10px] font-bold px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex-shrink-0">
              👤 Members ({Object.values(memberOf).filter(id => id === p.id).length})
            </button>
            <button type="button" onClick={() => mintaHapus(p)} title={`Hapus ${p.name}`} aria-label={`Hapus ${p.name}`}
              className="text-slate-300 hover:text-rose-600 flex-shrink-0 p-1.5">🗑️</button>
          </div>
        ))}
      </div>
    );
  })();

  if (loading) return <div className="p-6 text-sm text-slate-400">Memuat…</div>;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      {kabar && (
        <div className="rounded-xl px-4 py-3 text-sm font-semibold"
          style={kabar.jenis === 'ok'
            ? { background: 'rgba(16,185,129,0.1)', color: '#047857', border: '1px solid rgba(16,185,129,0.35)' }
            : { background: 'rgba(239,68,68,0.1)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.35)' }}>
          {kabar.teks}
        </div>
      )}

      {projects.length > 0 && (
        <StatCardGrid items={[
          { label: 'Total Project', value: projects.length, accent: '#4338ca' },
          { label: 'Aktif', value: projects.filter(p => p.status === 'active').length, accent: '#008300' },
          { label: 'Punya Member', value: new Set(Object.values(memberOf)).size, sub: 'Dari total project', accent: '#2a78d6' },
          { label: 'User Belum Di-assign', value: users.length - Object.keys(memberOf).length, accent: '#eda100' },
        ]} />
      )}

      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center gap-2 justify-between">
          <div>
            <h3 className="font-bold text-slate-800 text-sm">Projects / Tenant</h3>
            <p className="text-slate-500 text-xs mt-0.5">Client engagement — tiap project punya member (user) sendiri, tidak digabung dengan project lain.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={eksporCsv} disabled={projects.length === 0}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Export
            </button>
            <button type="button" onClick={bukaTambah}
              className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'linear-gradient(135deg,#4338ca,#3730a3)' }}>
              + Add Project
            </button>
          </div>
        </div>
        {daftarProjectBody}
      </div>

      <Modal buka={modalTambahTerbuka} onTutup={() => setModalTambahTerbuka(false)}
        judul="Tambah Project" ukuran="md" tutupDiLuar={false}
        footer={<>
          <TombolModal jenis="batal" onClick={() => setModalTambahTerbuka(false)}>Batal</TombolModal>
          <TombolModal jenis="utama" onClick={tambahProject} disabled={simpanProject || !nama.trim()}>
            {simpanProject ? 'Menyimpan…' : 'Tambah Project'}
          </TombolModal>
        </>}>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-1.5">Nama project</label>
            <input value={nama} onChange={e => setNama(e.target.value)} placeholder="mis. Videowall Bank XYZ" className={inputCls} autoFocus />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-1.5">Nama client — opsional</label>
            <input value={client} onChange={e => setClient(e.target.value)} placeholder="mis. PT Bank XYZ" className={inputCls} />
          </div>
        </div>
      </Modal>

      <Modal buka={!!memberProject} onTutup={() => setMemberProject(null)} judul={`Members — ${memberProject?.name ?? ''}`} ukuran="md">
        <p className="text-xs text-slate-400 mb-3">
          Satu user hanya bisa jadi anggota SATU project. Memilih project di sini untuk seorang user otomatis
          memindahkan (bukan menggandakan) keanggotaannya kalau sebelumnya sudah ada di project lain. User yang
          jadi member hanya melihat project ini di selector Dashboard — Provider Admin/Supervisor tetap melihat semua.
        </p>
        {users.length === 0 ? (
          <EmptyState icon="👤" title="Belum ada user" description="Belum ada akun yang bisa dijadikan member." />
        ) : (
          <div className="divide-y divide-slate-50 max-h-96 overflow-y-auto -mx-1">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-1 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-700 truncate">{u.full_name}</p>
                  <p className="text-[11px] text-slate-400 truncate">@{u.username} · {u.fs_role ?? '—'}</p>
                </div>
                <select value={memberOf[u.id] ?? ''} disabled={memberBusyId === u.id}
                  onChange={e => void pilihProjectUntukUser(u.id, e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 flex-shrink-0 max-w-[45%]">
                  <option value="">— tidak ada project —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />
    </div>
  );
}
