'use client';

/**
 * modal-peran-akses.tsx - "Peran & Akses" di Admin Panel.
 *
 * Menjawab dua pertanyaan yang selama ini tidak punya tempat:
 *
 *  1. MENU APA yang boleh dibuka tiap peran — bisa diubah di sini, tersimpan
 *     ke fs_role_menu_defaults (012). Sebelumnya daftar menunya tidak lengkap:
 *     'field-service' (Operations) tidak pernah masuk ALL_MENU_KEYS, jadi
 *     satu-satunya cara membukanya adalah memberi akun itu "Full Access" —
 *     yang artinya memberi SELURUH menu sekaligus. Sekarang bisa per menu.
 *
 *  2. SAMPAI SEJAUH MANA tiap peran boleh bertindak. Bagian ini SENGAJA
 *     hanya-baca, dan itu keputusan sadar, bukan fitur setengah jadi:
 *     kemampuannya dijaga oleh RLS dan fungsi database (fs_is_provider_admin,
 *     fs_is_client_reviewer, dst). Membuatnya seolah-olah bisa dicentang di
 *     sini akan berbohong — centangnya tidak akan mengubah apa pun di server.
 *     Yang ditampilkan adalah peta jujur tentang aturan yang BENAR-BENAR
 *     berlaku, supaya admin tahu konsekuensi sebuah peran sebelum memberikan.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Minus, ShieldCheck, Save, Users2, Loader2, LayoutGrid, Lock, PencilLine } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ALL_MENU_KEYS, ALL_MENU_LABELS } from './shared';

type Peran = 'ADMIN' | 'SUPERVISOR' | 'USER' | 'TECHNICIAN' | 'VIEW';

const URUTAN: Peran[] = ['ADMIN', 'SUPERVISOR', 'USER', 'TECHNICIAN', 'VIEW'];

const INFO: Record<Peran, { label: string; fsRole: string; warna: string; ringkas: string }> = {
  ADMIN:      { label: 'Admin', fsRole: 'PROVIDER_ADMIN', warna: '#1E40AF', ringkas: 'Kontrol penuh platform' },
  SUPERVISOR: { label: 'Supervisor', fsRole: 'PROVIDER_SUPERVISOR', warna: '#0D9488', ringkas: 'Menjalankan operasi harian' },
  USER:       { label: 'User', fsRole: '—', warna: '#64748B', ringkas: 'Staf internal, akses terbatas' },
  TECHNICIAN: { label: 'Technician', fsRole: 'FIELD_PIC', warna: '#D97706', ringkas: 'PIC lapangan' },
  VIEW:       { label: 'View / Client', fsRole: 'CLIENT_MANAGER', warna: '#7C3AED', ringkas: 'Client yang memeriksa hasil' },
};

/**
 * Peta kemampuan NYATA. Tiap baris mencantumkan penjaganya di database,
 * supaya kalau kelak aturannya berubah, tabel ini bisa dicocokkan ulang ke
 * sumbernya alih-alih jadi dokumentasi yang diam-diam basi.
 */
const KEMAMPUAN: { grup: string; nama: string; penjaga: string; punya: Partial<Record<Peran, boolean | 'sebagian'>> }[] = [
  { grup: 'Pemantauan', nama: 'Dashboard operasional penuh', penjaga: 'widget registry (provider)',
    punya: { ADMIN: true, SUPERVISOR: true, USER: false, TECHNICIAN: 'sebagian', VIEW: 'sebagian' } },
  { grup: 'Pemantauan', nama: 'Peta sebaran & drill-down TV', penjaga: 'RLS fs_* per peran',
    punya: { ADMIN: true, SUPERVISOR: true, TECHNICIAN: 'sebagian', VIEW: true } },

  { grup: 'Data Induk', nama: 'Kelola project & member', penjaga: 'fs_is_provider_admin()',
    punya: { ADMIN: true } },
  { grup: 'Data Induk', nama: 'Kelola wilayah, gedung & titik TV', penjaga: 'fs_is_provider_admin()',
    punya: { ADMIN: true } },
  { grup: 'Data Induk', nama: 'Kelola konten mingguan', penjaga: 'fs_content_insert/update',
    punya: { ADMIN: true } },

  { grup: 'Operasi', nama: 'Buat & aktifkan siklus weekend', penjaga: 'fs_cycle_transition()',
    punya: { ADMIN: true, SUPERVISOR: true } },
  { grup: 'Operasi', nama: 'Tugaskan PIC ke gedung', penjaga: 'fs_pic_assignments (fs_is_provider)',
    punya: { ADMIN: true, SUPERVISOR: true } },
  { grup: 'Operasi', nama: 'Buat daftar pekerjaan (scope)', penjaga: 'fs_generate_cycle_scope()',
    punya: { ADMIN: true, SUPERVISOR: true } },
  { grup: 'Operasi', nama: 'Kirim siklus ke review client', penjaga: 'fs_cycle_transition()',
    punya: { ADMIN: true, SUPERVISOR: true } },

  { grup: 'Lapangan', nama: 'Check-in / check-out GPS', penjaga: 'fs_check_in/out + fs_is_assigned',
    punya: { TECHNICIAN: true } },
  { grup: 'Lapangan', nama: 'Isi checklist & foto per TV', penjaga: 'fs_execution_point_status (PIC)',
    punya: { TECHNICIAN: true } },

  { grup: 'Review', nama: 'Setujui / minta ulang per TV', penjaga: 'fs_review_tv()',
    punya: { ADMIN: true, SUPERVISOR: true, VIEW: true } },
  { grup: 'Review', nama: 'Setujui check-out tidak tuntas', penjaga: 'fs_review_checkout()',
    punya: { ADMIN: true, SUPERVISOR: true } },
  { grup: 'Review', nama: 'Tandai siklus siap ditutup', penjaga: 'fs_cycle_transition()',
    punya: { ADMIN: true, VIEW: true } },

  { grup: 'Penutupan', nama: 'Tutup siklus', penjaga: 'fs_is_provider_admin()',
    punya: { ADMIN: true } },
  { grup: 'Penutupan', nama: 'Minta pembersihan data', penjaga: 'fs_request_clear()',
    punya: { ADMIN: true } },
  { grup: 'Penutupan', nama: 'Setujui & hapus bukti permanen', penjaga: 'fs_finalize_clear()',
    punya: { ADMIN: true } },

  { grup: 'Administrasi', nama: 'Kelola akun & peran', penjaga: '/api/admin/users (isAdminRole)',
    punya: { ADMIN: true } },
  { grup: 'Administrasi', nama: 'Lihat jejak audit', penjaga: 'fs_audit_feed()',
    punya: { ADMIN: true } },
];

export function PeranAksesInline() {
  const [tab, setTab] = useState<'menu' | 'kemampuan'>('menu');
  const [peranAktif, setPeranAktif] = useState<Peran>('ADMIN');
  const [menu, setMenu] = useState<Record<Peran, Set<string>>>({
    ADMIN: new Set(), SUPERVISOR: new Set(), USER: new Set(), TECHNICIAN: new Set(), VIEW: new Set(),
  });
  const [memuat, setMemuat] = useState(true);
  const [menyimpan, setMenyimpan] = useState(false);
  const [menerapkan, setMenerapkan] = useState(false);
  const [pesan, setPesan] = useState<{ tipe: 'ok' | 'gagal'; teks: string } | null>(null);

  const beritahu = (tipe: 'ok' | 'gagal', teks: string) => {
    setPesan({ tipe, teks });
    window.setTimeout(() => setPesan(null), 5000);
  };

  const muat = useCallback(async () => {
    setMemuat(true);
    const { data, error } = await supabase.from('fs_role_menu_defaults').select('role_key, menu_key');
    if (error) { beritahu('gagal', 'Gagal memuat setelan menu: ' + error.message); setMemuat(false); return; }
    const hasil: Record<Peran, Set<string>> = {
      ADMIN: new Set(), SUPERVISOR: new Set(), USER: new Set(), TECHNICIAN: new Set(), VIEW: new Set(),
    };
    for (const r of (data ?? []) as { role_key: string; menu_key: string }[]) {
      if (r.role_key in hasil) hasil[r.role_key as Peran].add(r.menu_key);
    }
    setMenu(hasil);
    setMemuat(false);
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  const toggle = (key: string) => setMenu(m => {
    const salinan = new Set(m[peranAktif]);
    if (salinan.has(key)) salinan.delete(key); else salinan.add(key);
    return { ...m, [peranAktif]: salinan };
  });

  const simpan = async () => {
    setMenyimpan(true);
    // Ganti-seluruhnya: barisnya sedikit (5 peran x segelintir menu), jadi
    // hapus-lalu-tulis-ulang jauh lebih sederhana daripada menghitung selisih.
    const { error: errHapus } = await supabase.from('fs_role_menu_defaults').delete().eq('role_key', peranAktif);
    if (errHapus) { beritahu('gagal', 'Gagal menyimpan: ' + errHapus.message); setMenyimpan(false); return; }
    const keys = Array.from(menu[peranAktif]);
    if (keys.length > 0) {
      const { error } = await supabase.from('fs_role_menu_defaults')
        .insert(keys.map(menu_key => ({ role_key: peranAktif, menu_key })));
      if (error) { beritahu('gagal', 'Gagal menyimpan: ' + error.message); setMenyimpan(false); return; }
    }
    setMenyimpan(false);
    beritahu('ok', `Setelan menu ${INFO[peranAktif].label} tersimpan — berlaku untuk akun baru.`);
  };

  /** Setelan di atas hanya menentukan bawaan akun BARU. Tombol ini yang
   *  membuatnya berlaku juga untuk akun yang sudah ada - dipisah dengan
   *  sengaja supaya tidak ada akun yang berubah haknya tanpa disadari. */
  const terapkanKeAkun = async () => {
    setMenerapkan(true);
    const fsRole = INFO[peranAktif].fsRole;
    const keys = Array.from(menu[peranAktif]);
    let q = supabase.from('users').update({ allowed_menus: keys });
    q = peranAktif === 'USER'
      ? q.is('fs_role', null).eq('role', 'team')
      : q.eq('fs_role', fsRole);
    const { error, count } = await q.select('id', { count: 'exact' });
    setMenerapkan(false);
    if (error) { beritahu('gagal', 'Gagal menerapkan: ' + error.message); return; }
    beritahu('ok', `${count ?? 0} akun ${INFO[peranAktif].label} diperbarui menunya.`);
  };

  const grupKemampuan = Array.from(new Set(KEMAMPUAN.map(k => k.grup)));

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {pesan && (
        <div className={`rounded-lg px-3.5 py-2.5 text-[13px] font-semibold border ${
          pesan.tipe === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {pesan.teks}
        </div>
      )}

      {/* Tab: dua mode yang sengaja dibuat terlihat BEDA — satu bisa diubah,
          satu murni peta bacaan. Sebelumnya dua ini berdampingan sebagai dua
          kartu putih yang identik gayanya, sehingga tidak terasa bedanya. */}
      <div className="flex gap-2 border-b-2 border-slate-100">
        <button type="button" onClick={() => setTab('menu')}
          className={`flex items-center gap-2 px-4 py-2.5 -mb-0.5 rounded-t-lg text-[13px] font-bold cursor-pointer transition-colors duration-150 border-b-2 ${
            tab === 'menu'
              ? 'border-blue-700 text-blue-800 bg-blue-50/70'
              : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}>
          <LayoutGrid size={15} /> Menu Per Role
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-700 text-white tracking-wide">BISA DIUBAH</span>
        </button>
        <button type="button" onClick={() => setTab('kemampuan')}
          className={`flex items-center gap-2 px-4 py-2.5 -mb-0.5 rounded-t-lg text-[13px] font-bold cursor-pointer transition-colors duration-150 border-b-2 ${
            tab === 'kemampuan'
              ? 'border-slate-600 text-slate-700 bg-slate-100/70'
              : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}>
          <Lock size={13} /> Peran &amp; Akses
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-600 text-white tracking-wide">HANYA-BACA</span>
        </button>
      </div>

      {/* Pemilih peran — konteks bersama kedua tab */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {URUTAN.map(p => {
          const aktif = peranAktif === p;
          const i = INFO[p];
          return (
            <button key={p} type="button" onClick={() => setPeranAktif(p)}
              className="text-left px-3 py-2.5 rounded-xl border-2 transition-colors duration-200 cursor-pointer"
              style={aktif
                ? { borderColor: i.warna, background: `${i.warna}0d` }
                : { borderColor: '#E2E8F0', background: '#fff' }}>
              <span className="block text-[13px] font-bold" style={{ color: aktif ? i.warna : '#334155' }}>{i.label}</span>
              <span className="block text-[10px] text-slate-500 mt-0.5 leading-snug">{i.ringkas}</span>
              <span className="block text-[9px] font-mono text-slate-400 mt-1">{i.fsRole}</span>
            </button>
          );
        })}
      </div>

      {tab === 'menu' ? (
        /* Menu yang bisa dibuka — BISA DIUBAH: kartu bernuansa biru, garis putus-putus,
           supaya "editable" terasa berbeda dari tabel abu-abu hanya-baca di tab sebelah. */
        <section className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/40 p-4">
          <header className="mb-3 flex items-start gap-2.5">
            <PencilLine size={16} className="text-blue-700 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-[13px] font-bold text-blue-900">
                Menu yang bisa dibuka untuk peran {INFO[peranAktif].label}
              </h3>
              <p className="text-[11px] text-blue-700/70 mt-0.5 leading-snug">
                Centang untuk mengubah. Menentukan bawaan akun <strong>baru</strong> — klik &quot;Terapkan&quot;
                untuk memperbarui akun yang sudah ada juga.
              </p>
            </div>
          </header>

          {memuat ? (
            <p className="text-[12px] text-slate-400 py-6 text-center flex items-center justify-center gap-2">
              <Loader2 size={13} className="animate-spin" /> Memuat…
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5 bg-white rounded-lg border border-blue-100 p-2">
              {ALL_MENU_KEYS.map(key => {
                const info = ALL_MENU_LABELS[key];
                const dicentang = menu[peranAktif].has(key);
                return (
                  <label key={key}
                    className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors duration-150 border ${
                      dicentang ? 'bg-blue-50 border-blue-200' : 'bg-white border-transparent hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={dicentang} onChange={() => toggle(key)}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-blue-700 flex-shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-slate-700">{info?.label ?? key}</span>
                      <span className="block text-[10px] text-slate-400 font-mono">{key}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-blue-200/60">
            <button type="button" onClick={simpan} disabled={menyimpan || memuat}
              className="text-[12px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              style={{ background: '#1E40AF' }}>
              <Save size={13} /> {menyimpan ? 'Menyimpan…' : 'Simpan'}
            </button>
            <button type="button" onClick={terapkanKeAkun} disabled={menerapkan || memuat}
              className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-blue-300 bg-white text-blue-800 hover:bg-blue-50 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer">
              <Users2 size={13} /> {menerapkan ? 'Menerapkan…' : 'Terapkan ke akun yang ada'}
            </button>
          </div>
          <p className="text-[10px] text-blue-700/60 mt-2 leading-relaxed">
            &quot;Terapkan&quot; menimpa menu akun yang sudah ada dengan daftar di atas. Dipisah dari
            Simpan supaya tidak ada akun yang berubah haknya tanpa disadari.
          </p>
        </section>
      ) : (
        /* Kemampuan — HANYA BACA: kartu abu-abu solid, ikon gembok, tabel non-interaktif —
           sengaja terasa "terkunci" supaya tidak disangka bisa dicentang seperti tab sebelah. */
        <section className="rounded-xl border border-slate-300 bg-slate-100/80 p-4 relative overflow-hidden">
          <Lock size={120} className="absolute -right-4 -bottom-6 text-slate-200/60 pointer-events-none" strokeWidth={1} />
          <header className="mb-3 flex items-start gap-2.5 relative">
            <ShieldCheck size={16} className="text-slate-500 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-[13px] font-bold text-slate-700">
                Sejauh mana peran {INFO[peranAktif].label} boleh bertindak
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                Dijaga langsung oleh database (RLS &amp; fungsi) — bukan oleh tampilan ini, karena itu
                <strong> tidak ada yang bisa dicentang di sini.</strong> Ini peta bacaan, bukan formulir.
              </p>
            </div>
          </header>

          <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 relative">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="text-slate-400 font-bold uppercase text-[10px] bg-slate-50">
                  <th className="text-left px-3 py-2">Kemampuan</th>
                  {URUTAN.map(p => (
                    <th key={p} className="px-1 py-2 text-center whitespace-nowrap" style={{ color: INFO[p].warna }}>
                      {INFO[p].label.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupKemampuan.map(g => (
                  <React.Fragment key={g}>
                    <tr>
                      <td colSpan={6} className="px-3 pt-3 pb-1 bg-slate-50/60">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{g}</span>
                      </td>
                    </tr>
                    {KEMAMPUAN.filter(k => k.grup === g).map(k => (
                      <tr key={k.nama} className="border-t border-slate-50">
                        <td className="px-3 py-1.5">
                          <span className="block text-slate-700 font-medium">{k.nama}</span>
                          <span className="block text-[9.5px] text-slate-400 font-mono">{k.penjaga}</span>
                        </td>
                        {URUTAN.map(p => {
                          const v = k.punya[p];
                          return (
                            <td key={p} className="px-1 py-1.5 text-center">
                              {v === true ? (
                                <Check size={14} className="inline" style={{ color: '#059669' }} aria-label="boleh" />
                              ) : v === 'sebagian' ? (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                  style={{ color: '#B45309', background: '#FEF3C7' }} title="Hanya sebatas datanya sendiri">
                                  sendiri
                                </span>
                              ) : (
                                <Minus size={13} className="inline text-slate-200" aria-label="tidak" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-slate-500 mt-3 pt-3 border-t border-slate-300/60 leading-relaxed relative">
            <strong className="text-amber-700">sendiri</strong> = hanya data miliknya: PIC melihat gedung
            yang ditugaskan padanya, client melihat hasil yang dikirim untuk direview.
          </p>
        </section>
      )}
    </div>
  );
}
