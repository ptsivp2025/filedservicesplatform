'use client';
import React from 'react';

import { AccountSettingsInline } from './modal-akun';
import { MerekSettingInline } from './modal-merek';
import { IntegrasiInline } from './modal-integrasi';
import { AppReleasesInline } from './modal-app-releases';
import { ProjectsAdminInline } from './modal-projects';
import { PeranAksesInline } from './modal-peran-akses';
import { AuditLogInline } from './modal-audit';
import { BAGIAN_ADMIN, bagianAdmin, type SeksiAdmin } from './admin-bagian';

export type { SeksiAdmin } from './admin-bagian';

/**
 * Admin Panel sebagai HALAMAN (pola Sales Management Platform), bukan lagi
 * modal gelap yang menutupi seluruh layar.
 *
 * Navigasinya tidak ada di halaman ini: di layar lebar daftar bagian tampil
 * sebagai sub-menu di sidebar, menempel pada menu "Admin Panel" (lihat
 * app/dashboard/page.tsx). Panel navigasi yang mengambang di dalam area isi
 * terbaca sebagai bagian dari isi, sehingga halaman tampak punya dua sidebar.
 * Di ponsel sidebar-nya tidak ada, jadi di sana - dan hanya di sana -
 * bagiannya tampil sebagai baris chip di atas isi.
 */
export function AdminPanelHalaman({ bagian, setBagian }: {
  bagian: SeksiAdmin;
  setBagian: (b: SeksiAdmin) => void;
}) {
  const aktif = bagianAdmin(bagian);

  return (
    <div className="h-full flex flex-col gap-3 px-3 sm:px-5 py-4 max-w-[1500px] w-full mx-auto animasi-halaman">
      <nav aria-label="Bagian Admin Panel"
        className="sidebar:hidden flex gap-1.5 overflow-x-auto no-scrollbar bg-white rounded-kartu border border-slate-200 p-1.5 flex-shrink-0">
        {BAGIAN_ADMIN.map(b => {
          const ini = b.kunci === aktif.kunci;
          return (
            <button key={b.kunci} type="button" onClick={() => setBagian(b.kunci)}
              aria-current={ini ? 'true' : undefined}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-kontrol text-[12px] font-semibold whitespace-nowrap transition-colors
                          ${ini ? 'bg-aksen-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              <span aria-hidden="true">{b.ikon}</span>
              {b.label}
            </button>
          );
        })}
      </nav>

      <header className="flex items-center gap-3 flex-shrink-0">
        <span className="w-10 h-10 rounded-kontrol bg-aksen-50 border border-aksen-100 grid place-items-center text-[16px] flex-shrink-0" aria-hidden="true">
          {aktif.ikon}
        </span>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-tight">{aktif.judul}</h1>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">{aktif.keterangan}</p>
        </div>
      </header>

      {/* key = bagian: berganti bagian = isi baru masuk dengan animasi. */}
      <div key={aktif.kunci} className="flex-1 min-h-0 bg-white rounded-kartu border border-slate-200 shadow-bento overflow-hidden animasi-halaman">
        {aktif.kunci === 'settings' && <AccountSettingsInline />}
        {aktif.kunci === 'peran' && <PeranAksesInline />}
        {aktif.kunci === 'audit' && <AuditLogInline />}
        {aktif.kunci === 'projects' && <ProjectsAdminInline />}
        {aktif.kunci === 'merek' && <MerekSettingInline />}
        {aktif.kunci === 'integrasi' && <div className="h-full overflow-y-auto p-4"><IntegrasiInline /></div>}
        {aktif.kunci === 'rilis' && <AppReleasesInline />}
      </div>
    </div>
  );
}
