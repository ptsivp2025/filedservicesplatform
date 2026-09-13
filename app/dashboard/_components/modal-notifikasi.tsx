'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

import { User, NotificationItem, NotifBellProps } from './shared';
import { markAllNotifsRead } from '@/lib/notifications';

// Notification Bell Component

export function NotifBell({ icon, label, count, color, bgColor, borderColor, dotColor, items, onItemClick, onMarkAllRead }: NotifBellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const formatTime = (ts: string) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Baru saja';
    if (diffMins < 60) return `${diffMins}m lalu`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}j lalu`;
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  };

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center gap-2 px-3 py-2 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          background: count > 0 ? bgColor : 'rgba(255,255,255,0.55)',
          border: `1.5px solid ${count > 0 ? borderColor : 'rgba(0,0,0,0.1)'}`,
          boxShadow: count > 0 ? `0 2px 12px ${borderColor}55` : 'none',
        }}
      >
        <span className="text-base leading-none">{icon}</span>
        <span className="text-xs font-bold hidden sm:block" style={{ color: count > 0 ? color : '#64748b' }}>{label}</span>
        {count > 0 && (
          <span className="flex items-center justify-center rounded-full text-white font-black text-[10px] min-w-[18px] h-[18px] px-1 animate-pulse"
            style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}88` }}>
            {count > 99 ? '99+' : count}
          </span>
        )}
        {count === 0 && <span className="text-[10px] font-semibold text-slate-400">0</span>}
      </button>

      {open && (
        <div className="absolute top-full mt-2 right-0 z-[40] rounded-2xl shadow-2xl overflow-hidden"
          style={{
            width: 320,
            background: 'rgba(255,255,255,0.97)',
            border: `1.5px solid ${borderColor}`,
            backdropFilter: 'blur(16px)',
            boxShadow: `0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px ${borderColor}33`,
            animation: 'dropIn 0.18s cubic-bezier(0.34,1.56,0.64,1)',
          }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ background: bgColor, borderBottom: `1px solid ${borderColor}44` }}>
            <div className="flex items-center gap-2">
              <span className="text-lg">{icon}</span>
              <span className="text-sm font-bold" style={{ color }}>{label}</span>
            </div>
            {count > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black text-white" style={{ background: dotColor }}>{count} baru</span>
            )}
          </div>
          {onMarkAllRead && count > 0 && (
            <button onClick={() => onMarkAllRead()}
              className="w-full text-center py-2 text-[11px] font-bold hover:bg-slate-50 transition-colors border-b border-slate-100"
              style={{ color }}>
              ✓ Tandai semua dibaca
            </button>
          )}
          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <span className="text-3xl opacity-40">✅</span>
                <p className="text-xs text-slate-400 font-medium">Tidak ada notifikasi</p>
              </div>
            ) : (
              items.map((item) => (
                <button key={item.id} onClick={() => { onItemClick(item); setOpen(false); }}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors border-b border-slate-100/80 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate leading-tight">{item.title}</p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">{item.subtitle}</p>
                  </div>
                  <span className="text-[10px] text-slate-400 flex-shrink-0 mt-0.5">{formatTime(item.time)}</span>
                </button>
              ))
            )}
          </div>
          {items.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100">
              <p className="text-[10px] text-center text-slate-400 font-medium">Klik item untuk membuka</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Notification Bar Component
interface NotificationBarProps {
  currentUser: User;
  onNavigate: (internalUrl: string, title: string, refId?: string) => void;
}

export function NotificationBar({ currentUser, onNavigate }: NotificationBarProps) {
  // Bell lonceng modul lama (Ticket/Require/Reminder/Review) dihapus bersama
  // modulnya saat repo ini dikonversi jadi Field Service & Proof of Execution
  // platform - semuanya query tabel yang sudah tidak ada. Yang tersisa adalah
  // notifikasi personal generik (tabel `notifications`), yang dipakai lagi
  // oleh event Field Service begitu modulnya dibangun (lib/notifikasi/router.ts).
  const [personalNotifs, setPersonalNotifs] = useState<NotificationItem[]>([]);

  const fetchAll = useCallback(async () => {
    try {
      const { data: pn } = await supabase
        .from('notifications')
        .select('id, type, title, body, action_url, ref_id, created_at')
        .eq('user_id', currentUser.id)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(30);
      setPersonalNotifs((pn ?? []).map((n: any) => ({
        id: n.id,
        type: 'ticket' as const,   // generic type for rendering
        title: n.title,
        subtitle: n.body ?? '',
        time: n.created_at,
        url: n.action_url ?? '/dashboard',
        internalUrl: n.action_url ?? '',
        menuTitle: 'Notifikasi',
        refId: n.ref_id ?? undefined,
      })));
    } catch { /* notifications table might not exist yet — fail silently */ }
  }, [currentUser.id]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 120_000); // setiap 2 menit
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    const ch = supabase.channel(`dash-notif-personal-${currentUser.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, () => { setTimeout(fetchAll, 400); }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll]);

  const handleClick = (item: NotificationItem) => {
    supabase.from('notifications').update({ is_read: true }).eq('id', item.id)
      .then(() => setPersonalNotifs(p => p.filter(n => n.id !== item.id)))
      .catch(() => {});
    if (item.internalUrl) onNavigate(item.internalUrl, item.menuTitle, item.refId ?? item.id);
  };

  const handleMarkAllPersonalRead = () => {
    const sebelum = personalNotifs;
    setPersonalNotifs([]);
    markAllNotifsRead(currentUser.id).catch(() => {
      // Gagal di server - kembalikan tanda supaya tidak terlihat "sudah dibaca"
      // padahal masih tersimpan belum-dibaca di database.
      setPersonalNotifs(sebelum);
    });
  };

  const totalCount = personalNotifs.length;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.09)', boxShadow: '0 1px 8px rgba(0,0,0,0.07)' }}>
      {/* Total count badge — di depan (kiri) */}
      {totalCount > 0 ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg flex-shrink-0 mr-1"
          style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 1px 4px rgba(220,38,38,0.35)' }}>
          <svg aria-hidden="true" focusable="false" className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span className="text-white font-bold text-xs leading-none">{totalCount}</span>
        </div>
      ) : (
        <div className="flex items-center justify-center px-2 py-1 rounded-lg flex-shrink-0 mr-1"
          style={{ background: 'rgba(0,0,0,0.05)' }}>
          <svg aria-hidden="true" focusable="false" className="w-4 h-4" style={{ color: '#94a3b8' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
      )}
      {/* Separator — hidden on small mobile */}
      <div className="hidden sm:block w-px h-5 flex-shrink-0" style={{ background: 'rgba(0,0,0,0.09)' }} />
      {/* Individual bells — hidden on small mobile (summary badge is enough) */}
      <div className="hidden sm:flex items-center gap-1">
        {/* Notifikasi personal (tabel `notifications`) - satu-satunya lonceng yang tersisa. */}
        <NotifBell icon="🔔" label="Notifikasi" count={personalNotifs.length} color="#4338ca" bgColor="rgba(224,231,255,0.6)" borderColor="#a5b4fc" dotColor="#4f46e5" items={personalNotifs} onItemClick={handleClick} onMarkAllRead={handleMarkAllPersonalRead} />
      </div>
    </div>
  );
}
