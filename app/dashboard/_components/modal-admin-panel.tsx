'use client';
import React, { useState } from 'react';

import { AdminPanelModalProps } from './shared';
import { ModalPortal } from '@/components/shared';

import { AccountSettingsInline } from './modal-akun';
import { MerekSettingInline } from './modal-merek';
import { IntegrasiInline } from './modal-integrasi';
import { AppReleasesInline } from './modal-app-releases';
import { ProjectsAdminInline } from './modal-projects';
import { PeranAksesInline } from './modal-peran-akses';
import { AuditLogInline } from './modal-audit';

/** Bagian Admin Panel. Dua yang baru: 'peran' (menu & kemampuan per peran)
 *  dan 'audit' (siapa mengubah apa) - keduanya dulu tidak punya tempat sama
 *  sekali, padahal datanya sudah lama tercatat di database. */
export type SeksiAdmin = 'settings' | 'peran' | 'audit' | 'merek' | 'integrasi' | 'rilis' | 'projects';

// AdminPanelModal (Account Settings + Dashboard Setting + Integrations)
//
// Sebelumnya enam tab (Account Settings, User Management, PIC Brand, KPI
// Roster, Dashboard Setting, Kelompok & Notifikasi). Empat di antaranya
// (User Management, PIC Brand, KPI Roster, Kelompok & Notifikasi) adalah
// peninggalan Work Management (mapping atasan/IVP/brand Sales-Marketing,
// daftar kelompok PTS) yang tidak berlaku lagi untuk Field Service Platform -
// role-nya sekarang cuma empat (Admin/User/Technician/View), diatur langsung
// di Account Settings. Dashboard Setting (branding: logo, warna, halaman
// login) DIPERTAHANKAN - berbeda dari yang lain, ini tetap relevan apa pun
// bentuk platformnya.

export function AdminPanelModal({ initialTab, onClose }: AdminPanelModalProps) {
  const [activeSection, setActiveSection] = useState<SeksiAdmin>(initialTab);

  const navItems: { key: SeksiAdmin; label: string; desc: string; icon: React.ReactElement; color: string; activeBg: string; activeBorder: string; activeText: string }[] = [
    {
      key: 'settings',
      label: 'Account Settings',
      desc: 'Kelola akun & role (Admin/User/Technician/View)',
      icon: <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
      color: '#4338ca', activeBg: 'rgba(99,102,241,0.1)', activeBorder: 'rgba(99,102,241,0.4)', activeText: '#4338ca',
    },
    {
      key: 'peran',
      label: 'Peran & Akses',
      desc: 'Menu per peran, dan sejauh mana tiap peran boleh bertindak',
      icon: <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>,
      color: '#0d9488', activeBg: 'rgba(13,148,136,0.1)', activeBorder: 'rgba(13,148,136,0.4)', activeText: '#0d9488',
    },
    {
      key: 'audit',
      label: 'Jejak Audit',
      desc: 'Siapa mengubah apa dan kapan — hanya Provider Admin yang bisa membuka',
      icon: <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
      color: '#b45309', activeBg: 'rgba(180,83,9,0.1)', activeBorder: 'rgba(180,83,9,0.4)', activeText: '#b45309',
    },
    {
      key: 'projects',
      label: 'Projects & Members',
      desc: 'Tenant/client engagement dan siapa jadi member project mana',
      icon: <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
      color: '#be123c', activeBg: 'rgba(225,29,72,0.1)', activeBorder: 'rgba(225,29,72,0.4)', activeText: '#be123c',
    },
    {
      key: 'merek',
      label: 'Dashboard Setting',
      desc: 'Logo, nama, warna header & tampilan halaman login',
      icon: <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>,
      color: '#7e22ce', activeBg: 'rgba(147,51,234,0.1)', activeBorder: 'rgba(147,51,234,0.4)', activeText: '#7e22ce',
    },
    {
      key: 'integrasi',
      label: 'Integrations',
      desc: 'Kanal notifikasi (In-App, WhatsApp, Telegram) & event mana lewat kanal mana',
      icon: <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
      color: '#0e7490', activeBg: 'rgba(8,145,178,0.1)', activeBorder: 'rgba(8,145,178,0.4)', activeText: '#0e7490',
    },
    {
      key: 'rilis',
      label: 'App Rilis',
      desc: 'Riwayat & unduhan APK Android technician, versi per versi',
      icon: <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>,
      color: '#059669', activeBg: 'rgba(5,150,105,0.1)', activeBorder: 'rgba(5,150,105,0.4)', activeText: '#059669',
    },
  ];

  const activeNav = navItems.find(n => n.key === activeSection)!;

  return (
  <ModalPortal>
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm pt-16 px-4 pb-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col sm:flex-row overflow-hidden border border-slate-200">

        {/* ── LEFT SIDEBAR (ponsel: bilah tab atas) ── */}
        <div className="w-full sm:w-56 flex-shrink-0 flex flex-col border-b sm:border-b-0 sm:border-r border-slate-100" style={{ background: 'linear-gradient(160deg, #1e293b 0%, #0f172a 100%)' }}>
          <div className="px-4 sm:px-5 py-3 sm:py-5 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                <svg aria-hidden="true" focusable="false" className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-bold text-sm leading-tight">Admin Panel</p>
                <p className="text-white/40 text-[10px] hidden sm:block">Superadmin Settings</p>
              </div>
            </div>
          </div>

          <div role="tablist" aria-label="Bagian Admin Panel"
            className="flex-1 p-2 sm:p-3 flex flex-row overflow-x-auto sm:flex-col gap-1 sm:gap-0.5 sm:overflow-y-auto">
            {navItems.map(item => {
              const isActive = activeSection === item.key;
              return (
                <button key={item.key} type="button" role="tab" aria-selected={isActive} onClick={() => setActiveSection(item.key)}
                  className="flex-shrink-0 sm:w-full flex items-center gap-2 sm:gap-3 px-3 py-2 sm:py-2.5 rounded-xl text-left transition-all text-xs sm:text-sm font-semibold whitespace-nowrap"
                  style={isActive
                    ? { background: item.activeBg, border: `1px solid ${item.activeBorder}`, color: item.activeText }
                    : { background: 'transparent', border: '1px solid transparent', color: 'rgba(255,255,255,0.55)' }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                  <span className={isActive ? '' : 'opacity-60'}>{item.icon}</span>
                  <span className="sm:truncate">{item.label}</span>
                  {isActive && <div className="hidden sm:block ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.color }} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT CONTENT ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex items-center gap-2 sm:gap-3 flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)' }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: activeNav.activeBg, border: `1px solid ${activeNav.activeBorder}`, color: activeNav.activeText }}>
              {activeNav.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-slate-800 text-sm sm:text-base leading-tight">{activeNav.label}</h2>
              <p className="text-slate-500 text-[10px] sm:text-xs hidden sm:block">{activeNav.desc}</p>
            </div>
            <button aria-label="Tutup" onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all text-slate-400 hover:text-slate-700"
              style={{ background: 'rgba(0,0,0,0.05)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)'; (e.currentTarget as HTMLButtonElement).style.color = '#dc2626'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLButtonElement).style.color = ''; }}
              title="Tutup">
              <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            {activeSection === 'settings' && <AccountSettingsInline />}
            {activeSection === 'peran' && <PeranAksesInline />}
            {activeSection === 'audit' && <AuditLogInline />}
            {activeSection === 'projects' && <ProjectsAdminInline />}
            {activeSection === 'merek' && <MerekSettingInline />}
            {activeSection === 'integrasi' && (
              <div className="h-full overflow-y-auto p-4"><IntegrasiInline /></div>
            )}
            {activeSection === 'rilis' && <AppReleasesInline />}
          </div>
        </div>
      </div>
    </div>
  </ModalPortal>
  );
}

