'use client';
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { adminCreateUser, adminUpdateUser } from '@/lib/admin-users';
import { logAudit } from '@/lib/audit';

import { createNotification } from '@/lib/notifications';

import { User, DEFAULT_MENU_KEYS, ALL_MENU_KEYS, ALL_MENU_LABELS } from './shared';
import { ConfirmDialog, type ConfirmState, Username, ModalPortal } from '@/components/shared';

import { propagateUserRename, pesanSebar, sendWelcomeWA } from './modal-bersama';

/**
 * Lima role Field Service Platform - menggantikan model Divisi/PTS-Type/
 * Sales-Division/Marketing peninggalan Work Management (org-chart supervisor/
 * CC/brand-mapping sudah dihapus bersamanya, lihat modal-user.tsx yang
 * dihapus). Setiap role memetakan ke kombinasi role/access_level/fs_role yang
 * sudah dipakai RLS fs_* (docs/field-service-architecture.md §3) - memilih
 * role di sini TIDAK butuh migration baru.
 *
 * SUPERVISOR ditambahkan karena "User" sebelumnya diam-diam memetakan ke
 * fs_role=PROVIDER_SUPERVISOR (bisa Assign PIC & kelola Content - kekuatan
 * operasional nyata) padahal deskripsinya menjanjikan "akses dashboard
 * standar, bukan admin". SUPERVISOR sekarang membawa kekuatan itu dengan
 * label yang jujur; USER murni fs_role=null (lihat ROLE_DEFS.USER).
 */
type FsSimpleRole = 'ADMIN' | 'SUPERVISOR' | 'USER' | 'TECHNICIAN' | 'VIEW';

interface RoleDef {
  label: string;
  icon: string;
  desc: string;
  role: string;
  /** users.access_level: NOT NULL, CHECK IN ('full','guest') — lihat migrations/001_core_schema.sql.
   *  'full' satu-satunya nilai yang membuat hasFullAccess() bernilai true untuk role='team';
   *  role lain memakai 'guest' murni supaya lolos constraint, tanpa memberi akses penuh. */
  access_level: 'full' | 'guest';
  fs_role: string | null;
  team_type: string | null;
}

const ROLE_DEFS: Record<FsSimpleRole, RoleDef> = {
  ADMIN: {
    label: 'Admin', icon: '🛡️',
    desc: 'Kontrol penuh — kelola akun, Location Master, Assign PIC.',
    role: 'admin', access_level: 'full', fs_role: 'PROVIDER_ADMIN', team_type: null,
  },
  SUPERVISOR: {
    label: 'Supervisor', icon: '🧭',
    desc: 'Assign PIC & kelola Content, monitor Execution — bukan kontrol penuh Project/Lokasi/Execution Point (khusus Admin).',
    // access_level 'full' SENGAJA (bukan 'guest' seperti USER/TECHNICIAN) -
    // sidebar hanya menampilkan menu "Field Service" untuk hasFullAccess()
    // (lihat app/dashboard/page.tsx komentar dekat allMenuItems), 'field-
    // service' sendiri tidak pernah masuk ALL_MENU_KEYS/allowed_menus. Tanpa
    // access_level='full' Supervisor tidak akan pernah melihat link Assign
    // PIC sama sekali walau fs_role-nya sudah benar.
    role: 'team', access_level: 'full', fs_role: 'PROVIDER_SUPERVISOR', team_type: 'Internal',
  },
  USER: {
    label: 'User', icon: '👤',
    desc: 'Staf internal — akses dashboard standar, bukan admin & bukan technician lapangan.',
    // fs_role=null SENGAJA (sebelumnya PROVIDER_SUPERVISOR - kekuatan
    // operasional nyata yang tidak dijanjikan deskripsi di atas). Role
    // Supervisor sekarang membawa kekuatan itu dengan label yang jujur.
    role: 'team', access_level: 'guest', fs_role: null, team_type: 'Internal',
  },
  TECHNICIAN: {
    label: 'Technician', icon: '🔧',
    desc: 'Field PIC — check-in/check-out hanya di lokasi yang ditugaskan (Field Service → Assign PIC).',
    role: 'team', access_level: 'guest', fs_role: 'FIELD_PIC', team_type: 'Internal',
  },
  VIEW: {
    label: 'View', icon: '👁️',
    desc: 'Client — lihat progres pekerjaan & verifikasi hasil, tanpa hak ubah data operasional lain.',
    // fs_role CLIENT_MANAGER (bukan CLIENT_VIEWER) SENGAJA - fs_is_client_reviewer()
    // (005) hanya mengenali CLIENT_ADMIN/CLIENT_MANAGER, bukan CLIENT_VIEWER. Baris
    // ini sudah lama menjanjikan "verifikasi hasil" tapi CLIENT_VIEWER tidak pernah
    // lolos RLS fs_reviews_insert/fs_status_transition - deskripsinya benar, hanya
    // fs_role yang salah sejak awal. CLIENT_MANAGER tetap lolos fs_is_client_viewer()
    // juga (viewer = reviewer OR ='CLIENT_VIEWER'), jadi akses baca tidak berkurang.
    role: 'guest', access_level: 'guest', fs_role: 'CLIENT_MANAGER', team_type: 'Client',
  },
};
const ROLE_ORDER: FsSimpleRole[] = ['ADMIN', 'SUPERVISOR', 'USER', 'TECHNICIAN', 'VIEW'];

/** Dipakai hanya kalau fs_role_menu_defaults kosong/gagal dibaca (migrasi 012
 *  belum sempat dijalankan) - PERSIS perilaku hardcoded lama, supaya approve/
 *  tambah akun tidak pernah mati gara-gara tabel setelan belum ada. */
const MENU_FALLBACK: Record<FsSimpleRole, string[]> = {
  ADMIN: DEFAULT_MENU_KEYS,
  SUPERVISOR: DEFAULT_MENU_KEYS,
  USER: DEFAULT_MENU_KEYS,
  TECHNICIAN: [...DEFAULT_MENU_KEYS, 'teknisi'],
  VIEW: [...DEFAULT_MENU_KEYS, 'client-review'],
};

/**
 * allowed_menus default per role - dulu hardcoded persis seperti
 * MENU_FALLBACK di atas, sekarang dibaca dari fs_role_menu_defaults (012)
 * supaya admin bisa mengubahnya lewat Admin Panel -> Account Settings ->
 * Menu per Role tanpa deploy ulang kode (docs/AUDIT-CONFIGURABILITY-
 * NOTIFICATIONS-2026-09.md §1.3). Hanya menentukan bawaan akun BARU - akun
 * yang sudah ada tetap memakai allowed_menus miliknya sendiri.
 */
async function menusForRole(r: FsSimpleRole): Promise<string[]> {
  try {
    const { data, error } = await supabase.from('fs_role_menu_defaults').select('menu_key').eq('role_key', r);
    if (error || !data || data.length === 0) return MENU_FALLBACK[r];
    return data.map((d: { menu_key: string }) => d.menu_key);
  } catch {
    return MENU_FALLBACK[r];
  }
}

/** Tebak role sederhana dari kolom akun yang sudah tersimpan. */
function roleFromUser(u: { role?: string | null; fs_role?: string | null }): FsSimpleRole {
  const fr = u.fs_role ?? '';
  if (fr === 'FIELD_PIC') return 'TECHNICIAN';
  if (fr === 'PROVIDER_ADMIN') return 'ADMIN';
  if (fr === 'PROVIDER_SUPERVISOR') return 'SUPERVISOR';
  if (fr === 'CLIENT_ADMIN' || fr === 'CLIENT_MANAGER' || fr === 'CLIENT_VIEWER') return 'VIEW';
  if (u.role === 'admin' || u.role === 'superadmin') return 'ADMIN';
  return 'USER';
}

function RolePicker({ value, onChange }: { value: FsSimpleRole; onChange: (r: FsSimpleRole) => void }) {
  return (
    <div>
      <label className="block text-xs font-bold mb-1.5 text-slate-600 uppercase tracking-widest">Role *</label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ROLE_ORDER.map(r => {
          const def = ROLE_DEFS[r];
          const active = value === r;
          return (
            <button key={r} type="button" onClick={() => onChange(r)}
              className={`text-left px-3 py-2.5 rounded-lg border-2 transition-all ${
                active ? 'bg-rose-50 border-rose-400 text-rose-800' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              <span className="block text-sm font-bold">{def.icon} {def.label}</span>
              <span className="block text-[10.5px] mt-0.5 leading-snug opacity-80">{def.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Editor fs_role_menu_defaults (012) - checkbox per menu untuk role yang
 * sedang aktif, simpan lewat replace-all (hapus semua baris role ini, insert
 * ulang yang tercentang) karena jumlah barisnya kecil (4 role x segelintir
 * menu), jauh lebih sederhana daripada diff insert/delete satu-satu.
 */
function MenuPerRoleEditor({ notify }: { notify: (type: 'success' | 'error', msg: string) => void }) {
  const [roleAktif, setRoleAktif] = useState<FsSimpleRole>('ADMIN');
  const [dipilih, setDipilih] = useState<Record<FsSimpleRole, Set<string>>>({
    ADMIN: new Set(), SUPERVISOR: new Set(), USER: new Set(), TECHNICIAN: new Set(), VIEW: new Set(),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from('fs_role_menu_defaults').select('role_key, menu_key');
      if (error) { notify('error', 'Gagal memuat menu per role: ' + error.message); setLoading(false); return; }
      const hasil: Record<FsSimpleRole, Set<string>> = {
        ADMIN: new Set(), SUPERVISOR: new Set(), USER: new Set(), TECHNICIAN: new Set(), VIEW: new Set(),
      };
      for (const row of (data ?? []) as { role_key: string; menu_key: string }[]) {
        if (row.role_key in hasil) hasil[row.role_key as FsSimpleRole].add(row.menu_key);
      }
      setDipilih(hasil);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (key: string) => setDipilih(s => {
    const n = new Set(s[roleAktif]);
    if (n.has(key)) n.delete(key); else n.add(key);
    return { ...s, [roleAktif]: n };
  });

  const simpan = async () => {
    setSaving(true);
    const ids = Array.from(dipilih[roleAktif]);
    const { error: delErr } = await supabase.from('fs_role_menu_defaults').delete().eq('role_key', roleAktif);
    if (delErr) { setSaving(false); notify('error', 'Gagal menyimpan: ' + delErr.message); return; }
    if (ids.length > 0) {
      const { error: insErr } = await supabase.from('fs_role_menu_defaults')
        .insert(ids.map(menu_key => ({ role_key: roleAktif, menu_key })));
      if (insErr) { setSaving(false); notify('error', 'Gagal menyimpan: ' + insErr.message); return; }
    }
    setSaving(false);
    notify('success', `Menu bawaan untuk role ${ROLE_DEFS[roleAktif].label} disimpan.`);
  };

  if (loading) return <div className="flex items-center justify-center py-10"><div className="w-6 h-6 rounded-full border-2 border-t-rose-600 border-rose-200 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 leading-relaxed">
        Menu yang tercentang jadi bawaan akun <b>BARU</b> yang dibuat dengan role ini (lewat Tambah Akun atau
        Setujui Pendaftaran). Akun yang sudah ada tidak ikut berubah — allowed_menus mereka sudah tersimpan
        sendiri-sendiri; ubah lewat tombol Edit di daftar akun kalau perlu menu perorangan.
      </p>
      <div className="flex gap-2 flex-wrap">
        {ROLE_ORDER.map(r => (
          <button key={r} type="button" onClick={() => setRoleAktif(r)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${
              roleAktif === r ? 'bg-rose-50 border-rose-400 text-rose-800' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
            {ROLE_DEFS[r].icon} {ROLE_DEFS[r].label}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {ALL_MENU_KEYS.map(key => {
          const label = ALL_MENU_LABELS[key];
          return (
            <label key={key} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
              <input type="checkbox" checked={dipilih[roleAktif].has(key)} onChange={() => toggle(key)}
                className="w-4 h-4 rounded border-slate-300 accent-rose-600" />
              <span className="text-sm">{label?.icon ?? ''} {label?.label ?? key}</span>
            </label>
          );
        })}
      </div>
      <button type="button" onClick={simpan} disabled={saving}
        className="px-4 py-2.5 rounded-lg text-white text-sm font-bold bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 disabled:opacity-60 flex items-center gap-2">
        {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        💾 Simpan Menu untuk {ROLE_DEFS[roleAktif].label}
      </button>
    </div>
  );
}

function RoleBadge({ role }: { role: FsSimpleRole }) {
  const def = ROLE_DEFS[role];
  const colors: Record<FsSimpleRole, string> = {
    ADMIN: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    SUPERVISOR: 'bg-violet-100 text-violet-700 border-violet-200',
    USER: 'bg-blue-100 text-blue-700 border-blue-200',
    TECHNICIAN: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    VIEW: 'bg-amber-100 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase border ${colors[role]}`}>
      {def.icon} {def.label}
    </span>
  );
}

const emptyNewUser = { username: '', password: '', full_name: '', phone_number: '', role: 'USER' as FsSimpleRole };

export function AccountSettingsInline() {
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'add' | 'pending' | 'menu'>('list');
  const [editingUser, setEditingUser] = useState<(User & { password?: string }) | null>(null);
  const [editOrig, setEditOrig] = useState<{ username: string; full_name: string } | null>(null);
  const [editRole, setEditRole] = useState<FsSimpleRole>('USER');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newUser, setNewUser] = useState(emptyNewUser);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [approvingUser, setApprovingUser] = useState<User | null>(null);
  const [approveRole, setApproveRole] = useState<FsSimpleRole>('USER');

  const notify = (type: 'success' | 'error', msg: string) => { setNotification({ type, msg }); setTimeout(() => setNotification(null), 3000); };
  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    const { data, error } = await supabase.from('users')
      .select('id,username,full_name,role,team_type,phone_number,allowed_menus,created_at,access_level,fs_role')
      .order('full_name');
    if (error) { notify('error', `Gagal memuat akun: ${error.message}`); setLoadingUsers(false); return; }
    setPendingUsers((data ?? []).filter((u: User) => u.team_type === 'Pending Approval'));
    setUsers((data ?? []).filter((u: User) => u.team_type !== 'Pending Approval'));
    setLoadingUsers(false);
  };

  const handleApproveUser = async () => {
    if (!approvingUser) return;
    setSaving(true);
    const def = ROLE_DEFS[approveRole];
    const { error } = await adminUpdateUser(approvingUser.id, {
      role: def.role, team_type: def.team_type, access_level: def.access_level, fs_role: def.fs_role,
      allowed_menus: await menusForRole(approveRole),
    });
    setSaving(false);
    if (error) { notify('error', 'Gagal approve: ' + error.message); return; }
    notify('success', `Akun ${approvingUser.full_name} disetujui sebagai ${def.label}.`);
    const admin = getSession<User>();
    logAudit({ user_id: admin?.id ?? '', user_name: admin?.full_name ?? '', action: 'approve', module: 'user', target_id: approvingUser.id, target_name: approvingUser.full_name, new_value: def.role }).catch(() => {});
    void createNotification({ user_id: approvingUser.id, type: 'user', title: '✅ Akun kamu telah disetujui', body: `Selamat! Akun ${approvingUser.full_name} sudah aktif sebagai ${def.label}. Silakan login.`, action_url: '/dashboard', created_by: admin?.full_name ?? '' });
    setApprovingUser(null); setApproveRole('USER'); fetchUsers();
  };

  const handleRejectUser = (userId: string, name: string) => {
    setConfirmState({ message: `Tolak & hapus pendaftaran "${name}"?`, description: 'Tindakan ini tidak bisa dibatalkan.', danger: true, confirmLabel: 'Tolak', onConfirm: async () => {
      const { error } = await supabase.from('users').delete().eq('id', userId);
      if (error) { notify('error', 'Gagal menolak.'); return; }
      notify('success', `Pendaftaran ${name} ditolak.`);
      const admin = getSession<User>();
      logAudit({ user_id: admin?.id ?? '', user_name: admin?.full_name ?? '', action: 'reject', module: 'user', target_id: userId, target_name: name }).catch(() => {});
      fetchUsers();
    }});
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password || !newUser.full_name) { notify('error', 'Nama, username, dan password wajib diisi!'); return; }
    setSaving(true);
    const def = ROLE_DEFS[newUser.role];
    const insertPayload: Record<string, unknown> = {
      username: newUser.username, full_name: newUser.full_name,
      role: def.role, team_type: def.team_type, access_level: def.access_level, fs_role: def.fs_role,
      phone_number: newUser.phone_number || null, allowed_menus: await menusForRole(newUser.role),
    };
    const { id: createdId, error } = await adminCreateUser(insertPayload);
    // Password disimpan ke user_credentials via server route (yang dibaca login).
    if (!error && createdId && newUser.password) {
      await fetch('/api/auth/set-credential', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: createdId, password: newUser.password }),
      });
    }
    setSaving(false);
    if (error) { notify('error', 'Gagal menambah akun: ' + error.message); return; }
    notify('success', 'Akun berhasil ditambahkan!');
    sendWelcomeWA(newUser.phone_number, newUser.full_name, newUser.username, newUser.password);
    const admin = getSession<User>(); void logAudit({ user_id: admin?.id ?? '', user_name: admin?.full_name ?? '', action: 'create', module: 'user', target_name: newUser.full_name, notes: `Tambah akun: ${newUser.username} (${def.label})` });
    setNewUser(emptyNewUser);
    setActiveTab('list'); fetchUsers();
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    setSaving(true);
    const def = ROLE_DEFS[editRole];
    const updatePayload: Record<string, unknown> = {
      username: editingUser.username, full_name: editingUser.full_name,
      role: def.role, team_type: def.team_type, access_level: def.access_level, fs_role: def.fs_role,
      phone_number: editingUser.phone_number ?? null, allowed_menus: await menusForRole(editRole),
    };
    // Password baru harus masuk ke user_credentials - itu satu-satunya tempat
    // yang dibaca login.
    if (editingUser.password) {
      const pwdRes = await fetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ userId: editingUser.id, newPassword: editingUser.password }),
      });
      if (!pwdRes.ok) {
        const j = await pwdRes.json().catch(() => ({}));
        setSaving(false);
        notify('error', 'Gagal mengubah password: ' + (j.error || 'permintaan ditolak'));
        return;
      }
    }
    const { error } = await adminUpdateUser(editingUser.id, updatePayload);
    if (error) { setSaving(false); notify('error', 'Gagal menyimpan: ' + error.message); return; }
    const sebar = await propagateUserRename(editingUser, editOrig);
    setSaving(false);
    notify(sebar.taraf === 'ok' ? 'success' : 'error', pesanSebar(sebar));
    const admin = getSession<User>(); void logAudit({ user_id: admin?.id ?? '', user_name: admin?.full_name ?? '', action: 'update', module: 'user', target_id: editingUser.id, target_name: editingUser.full_name });
    setEditingUser(null); fetchUsers();
  };

  const handleDeleteUser = (userId: string, name: string) => {
    setConfirmState({ message: `Hapus akun "${name}"?`, description: 'Tindakan ini tidak bisa dibatalkan.', danger: true, confirmLabel: 'Hapus', onConfirm: async () => {
      const { error } = await supabase.from('users').delete().eq('id', userId);
      if (error) { notify('error', 'Gagal menghapus akun.'); return; }
      notify('success', 'Akun dihapus.');
      const admin = getSession<User>(); void logAudit({ user_id: admin?.id ?? '', user_name: admin?.full_name ?? '', action: 'delete', module: 'user', target_id: userId });
      fetchUsers();
    }});
  };

  const filteredUsers = users.filter(u => !searchQuery
    || u.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
    || u.username?.toLowerCase().includes(searchQuery.toLowerCase())
    || roleFromUser(u).toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />
      {notification && (
        <div className={`mx-5 mt-3 px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 flex-shrink-0 ${notification.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {notification.type === 'success' ? '✅' : '❌'} {notification.msg}
        </div>
      )}

      <div className="flex-1 min-h-0 p-4">
        <div className="h-full flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-slate-100 px-5 pt-3 flex-shrink-0 bg-slate-50/60">
            <button onClick={() => { setActiveTab('list'); setEditingUser(null); }}
              className={`px-4 py-2 text-sm font-bold border-b-2 transition-all mr-1 ${activeTab === 'list' ? 'border-rose-500 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              👥 Daftar Akun ({users.length})
            </button>
            <button onClick={() => { setActiveTab('add'); setEditingUser(null); }}
              className={`px-4 py-2 text-sm font-bold border-b-2 transition-all mr-1 ${activeTab === 'add' ? 'border-rose-500 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              ➕ Tambah Akun
            </button>
            <button onClick={() => { setActiveTab('pending'); setApprovingUser(null); }}
              className={`px-4 py-2 text-sm font-bold border-b-2 transition-all mr-1 ${activeTab === 'pending' ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              🕐 Pending {pendingUsers.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-[9px] font-black rounded-full">{pendingUsers.length}</span>}
            </button>
            <button onClick={() => setActiveTab('menu')}
              className={`px-4 py-2 text-sm font-bold border-b-2 transition-all mr-1 ${activeTab === 'menu' ? 'border-rose-500 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              🧩 Menu per Role
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === 'list' && (
              <>
                <div className="relative mb-4">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
                  <input aria-label="Cari nama, username, atau role..." type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Cari nama, username, atau role..."
                    className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all" />
                </div>

                {loadingUsers ? (
                  <div className="flex items-center justify-center py-10"><div className="w-6 h-6 rounded-full border-2 border-t-rose-600 border-rose-200 animate-spin" /></div>
                ) : editingUser ? (
                  <div className="space-y-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-slate-800">✏️ Edit: {editingUser.full_name}</h3>
                      <button aria-label="Tutup" onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
                    </div>
                    <div className="grid grid-cols-1 formulir:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">Full Name</label>
                        <input aria-label="Full Name" value={editingUser.full_name} onChange={e => setEditingUser({ ...editingUser, full_name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">Username</label>
                        <input aria-label="Username" value={editingUser.username} onChange={e => setEditingUser({ ...editingUser, username: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">Password Baru</label>
                        <input type="password" value={editingUser.password ?? ''} onChange={e => setEditingUser({ ...editingUser, password: e.target.value })} placeholder="Kosongkan jika tidak diubah" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">📱 No. Telepon / WA</label>
                        <input value={editingUser.phone_number || ''} onChange={e => setEditingUser({ ...editingUser, phone_number: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400" placeholder="Contoh: 08123456789" />
                      </div>
                      <div className="formulir:col-span-2">
                        <RolePicker value={editRole} onChange={setEditRole} />
                      </div>
                    </div>
                    <div className="flex gap-3 pt-1">
                      <button onClick={handleSaveEdit} disabled={saving} className="flex-1 bg-gradient-to-r from-rose-600 to-rose-700 text-white py-2.5 rounded-lg font-semibold hover:from-rose-700 hover:to-rose-800 transition-all text-sm disabled:opacity-60 flex items-center justify-center gap-2">
                        {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        💾 Simpan Perubahan
                      </button>
                      <button onClick={() => setEditingUser(null)} className="px-6 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 text-sm transition-all">Batal</button>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-left">
                          {['Nama', 'Username', 'Role', 'No. Telepon'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-slate-500 whitespace-nowrap">{h}</th>
                          ))}
                          <th className="md:sticky md:right-0 bg-slate-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-slate-500 text-right whitespace-nowrap">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.length === 0 ? (
                          <tr><td colSpan={5} className="text-center py-10 text-slate-400 text-sm">Tidak ada akun ditemukan</td></tr>
                        ) : filteredUsers.map((user, idx) => {
                          const rowBg = idx % 2 === 0 ? 'white' : '#fafafa';
                          return (
                            <tr key={user.id} className="border-b border-slate-100 hover:bg-rose-50/30 transition-colors" style={{ background: rowBg }}>
                              <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{user.full_name}</td>
                              <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap"><Username value={user.username} /></td>
                              <td className="px-4 py-2.5"><RoleBadge role={roleFromUser(user)} /></td>
                              <td className="px-4 py-2.5 whitespace-nowrap">{user.phone_number ? <span className="text-emerald-600">📱 {user.phone_number}</span> : <span className="text-slate-300">—</span>}</td>
                              <td className="md:sticky md:right-0 px-4 py-2.5" style={{ background: rowBg }}>
                                <div className="flex items-center justify-end gap-1.5">
                                  <button onClick={() => { setEditRole(roleFromUser(user)); setEditOrig({ username: user.username, full_name: user.full_name }); setEditingUser(user); }}
                                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all">Edit</button>
                                  <button onClick={() => handleDeleteUser(user.id, user.full_name)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all">Hapus</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {activeTab === 'add' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 formulir:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">Full Name *</label>
                    <input value={newUser.full_name} onChange={e => setNewUser({ ...newUser, full_name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400" placeholder="Nama lengkap" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">Username *</label>
                    <input value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400" placeholder="username" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">Password *</label>
                    <input value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400" placeholder="min 6 karakter" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1 text-slate-600 uppercase tracking-widest">📱 No. Telepon / WA</label>
                    <input value={newUser.phone_number} onChange={e => setNewUser({ ...newUser, phone_number: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400" placeholder="Contoh: 08123456789" />
                  </div>
                  <div className="formulir:col-span-2">
                    <RolePicker value={newUser.role} onChange={r => setNewUser({ ...newUser, role: r })} />
                  </div>
                </div>
                <button onClick={handleAddUser} disabled={saving}
                  className="w-full bg-gradient-to-r from-rose-600 to-rose-700 text-white py-3 rounded-lg font-semibold hover:from-rose-700 hover:to-rose-800 transition-all text-sm disabled:opacity-60 flex items-center justify-center gap-2">
                  {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  ➕ Tambah Akun
                </button>
              </div>
            )}

            {activeTab === 'pending' && (
              <div className="space-y-3">
                {loadingUsers ? (
                  <div className="flex items-center justify-center py-10"><div className="w-6 h-6 rounded-full border-2 border-t-amber-500 border-amber-200 animate-spin" /></div>
                ) : approvingUser ? (
                  <div className="space-y-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-slate-800">✅ Review Pendaftaran: {approvingUser.full_name}</h3>
                      <button aria-label="Tutup" onClick={() => { setApprovingUser(null); setApproveRole('USER'); }} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm bg-white p-3 rounded-lg border border-slate-200">
                      <div><span className="text-xs text-slate-500 uppercase font-bold">Nama</span><p className="font-semibold text-slate-800">{approvingUser.full_name}</p></div>
                      <div><span className="text-xs text-slate-500 uppercase font-bold">Username</span><p className="font-semibold text-slate-800"><Username value={approvingUser.username} /></p></div>
                      {approvingUser.phone_number && <div className="col-span-2"><span className="text-xs text-slate-500 uppercase font-bold">No. Telepon</span><p className="font-semibold text-slate-800">{approvingUser.phone_number}</p></div>}
                    </div>
                    <RolePicker value={approveRole} onChange={setApproveRole} />
                    <div className="flex gap-3 pt-1">
                      <button onClick={handleApproveUser} disabled={saving}
                        className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white py-2.5 rounded-lg font-semibold text-sm disabled:opacity-60 flex items-center justify-center gap-2 hover:from-emerald-700 hover:to-emerald-800 transition-all">
                        {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        ✅ Setujui sebagai {ROLE_DEFS[approveRole].label}
                      </button>
                      <button onClick={() => handleRejectUser(approvingUser.id, approvingUser.full_name)}
                        className="px-5 py-2.5 rounded-lg border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50 transition-all">
                        ❌ Tolak
                      </button>
                    </div>
                  </div>
                ) : pendingUsers.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-sm">
                    <div className="text-3xl mb-2">✅</div>
                    Tidak ada pendaftaran yang menunggu
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingUsers.map(user => {
                      const daysPending = user.created_at
                        ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000)
                        : null;
                      const isStale = daysPending !== null && daysPending > 14;
                      return (
                        <div key={user.id} className={`flex items-center gap-3 p-3 rounded-xl border ${isStale ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${isStale ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`}>
                            {user.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-800 text-sm truncate">{user.full_name}</p>
                              {daysPending !== null && (
                                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black flex-shrink-0 ${isStale ? 'bg-red-200 text-red-800' : 'bg-amber-100 text-amber-700'}`}>
                                  {isStale ? `⚠️ ${daysPending}h` : `${daysPending}h`}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500"><Username value={user.username} /></p>
                            {user.phone_number && <p className="text-[9px] text-slate-500 mt-0.5">📱 {user.phone_number}</p>}
                          </div>
                          <div className="flex flex-col gap-1 flex-shrink-0">
                            <button onClick={() => { setApprovingUser(user); setApproveRole('USER'); }}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all">Review</button>
                            <button onClick={() => handleRejectUser(user.id, user.full_name)}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all">Tolak</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'menu' && <MenuPerRoleEditor notify={notify} />}
          </div>
        </div>
      </div>
    </div>
  );
}
