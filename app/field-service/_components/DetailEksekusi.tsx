'use client';

/**
 * DetailEksekusi.tsx - riwayat GPS + checklist per-TV (approve/hapus foto)
 * untuk satu execution instance. Dipakai DUA tempat: ReviewTab (Client
 * Review, di app/field-service/page.tsx - tanpa hak approve/hapus, client
 * cuma lihat) dan ExecutionWidget (Dashboard home, provider - dengan hak
 * approve/hapus lewat prop bolehReview). Dipisah ke sini supaya kedua tempat
 * memakai SATU salinan, bukan disalin dua kali.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ambilSignedUrl, lupakanSignedUrl } from '@/lib/evidence-url';
import { FS_TV_STATUS_LABEL } from '@/lib/fs-status';
import { ConfirmDialog, type ConfirmState } from '@/components/shared';

interface GpsEventRow { event_type: string; validation_status: string; distance_m: number | null; created_at: string; }
interface EvidenceRow {
  id: string; bucket: string; path: string; thumbPath: string | null; created_at: string;
  /** Thumbnail (029) untuk tampilan grid - murah dimuat sekaligus untuk
   *  semua foto. Foto ukuran penuh baru diambil saat diklik (bukaFotoPenuh). */
  thumbUrl: string | null;
}
interface TvRow {
  pointId: string; pointName: string; floor: string | null;
  status: string; reviewStatus: string; notes: string | null;
  photos: EvidenceRow[];
}

/** Signed URL - fs-evidence (007) itu bucket PRIVATE, URL publik tidak akan
 *  jalan sama sekali. RLS storage tetap berlaku (fs_evidence_storage_select),
 *  jadi ini hanya berhasil untuk aktor yang memang boleh membaca baris ini. */
async function muatDetailEksekusi(instanceId: string): Promise<{ gpsEvents: GpsEventRow[]; evidence: EvidenceRow[]; perTv: TvRow[] }> {
  const [{ data: gps }, { data: ev }, { data: perTvRows }] = await Promise.all([
    supabase.from('fs_gps_events').select('event_type, validation_status, distance_m, created_at')
      .eq('execution_instance_id', instanceId).order('created_at'),
    supabase.from('fs_evidence').select('id, bucket, path, thumb_path, created_at, execution_point_id')
      .eq('execution_instance_id', instanceId).order('created_at'),
    supabase.from('fs_execution_point_status')
      .select('execution_point_id, status, notes, review_status, fs_execution_points!execution_point_id(name, floor)')
      .eq('execution_instance_id', instanceId),
  ]);
  type EvRaw = { id: string; bucket: string; path: string; thumb_path: string | null; created_at: string; execution_point_id: string | null };
  // Cuma THUMBNAIL (029) yang dimuat di sini - kecil, murah walau semua
  // foto satu gedung dimuat sekaligus. Foto ukuran penuh baru diambil saat
  // pengguna mengklik untuk membukanya (lihat bukaFotoPenuh di komponen).
  const evidence: EvidenceRow[] = await Promise.all((ev ?? []).map(async (e: EvRaw) => ({
    id: e.id, bucket: e.bucket, path: e.path, thumbPath: e.thumb_path, created_at: e.created_at,
    thumbUrl: await ambilSignedUrl(e.bucket, e.thumb_path ?? e.path).catch(() => null),
  })));
  const evByPoint = new Map<string, EvidenceRow[]>();
  (ev ?? []).forEach((e: EvRaw, i: number) => {
    if (!e.execution_point_id) return;
    const arr = evByPoint.get(e.execution_point_id) ?? [];
    arr.push(evidence[i]);
    evByPoint.set(e.execution_point_id, arr);
  });
  type TvRaw = { execution_point_id: string; status: string; notes: string | null; review_status: string; fs_execution_points: { name: string; floor: string | null } | null };
  const perTv: TvRow[] = ((perTvRows ?? []) as TvRaw[]).map(r => ({
    pointId: r.execution_point_id, pointName: r.fs_execution_points?.name ?? '—', floor: r.fs_execution_points?.floor ?? null,
    status: r.status, reviewStatus: r.review_status, notes: r.notes, photos: evByPoint.get(r.execution_point_id) ?? [],
  }));
  return { gpsEvents: (gps ?? []) as GpsEventRow[], evidence: evidence.filter((_, i) => !(ev ?? [])[i]?.execution_point_id), perTv };
}

export function DetailEksekusi({ instanceId, bolehReview, beritahu }: {
  instanceId: string; bolehReview?: boolean; beritahu?: (tipe: 'ok' | 'gagal', teks: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [gpsEvents, setGpsEvents] = useState<GpsEventRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [perTv, setPerTv] = useState<TvRow[]>([]);
  const [aksiJalan, setAksiJalan] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const muat = useCallback(() => {
    let batal = false;
    setLoading(true);
    muatDetailEksekusi(instanceId).then(r => {
      if (batal) return;
      setGpsEvents(r.gpsEvents); setEvidence(r.evidence); setPerTv(r.perTv); setLoading(false);
    });
    return () => { batal = true; };
  }, [instanceId]);

  useEffect(() => muat(), [muat]);

  const bukaFotoPenuh = async (foto: EvidenceRow) => {
    const url = await ambilSignedUrl(foto.bucket, foto.path);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const approve = async (pointId: string) => {
    setAksiJalan(pointId);
    const { error } = await supabase.from('fs_execution_point_status')
      .update({ review_status: 'APPROVED', reviewed_at: new Date().toISOString() })
      .eq('execution_instance_id', instanceId).eq('execution_point_id', pointId);
    setAksiJalan(null);
    if (error) { beritahu?.('gagal', 'Gagal approve: ' + error.message); return; }
    beritahu?.('ok', 'TV disetujui.');
    muat();
  };

  const hapusFoto = async (foto: EvidenceRow) => {
    setAksiJalan(foto.id);
    // Hapus BERKASNYA di storage (bukan cuma baris metadata) - itulah maksud
    // "supaya tidak memenuhi storage cloud". fs_evidence_storage_delete (015)
    // baru mengizinkan ini untuk provider. Thumbnail (029) ikut dihapus -
    // kalau tidak, jadi berkas yatim yang tetap makan storage.
    const berkas = foto.thumbPath ? [foto.path, foto.thumbPath] : [foto.path];
    const { error: errStorage } = await supabase.storage.from(foto.bucket).remove(berkas);
    if (errStorage) { setAksiJalan(null); beritahu?.('gagal', 'Gagal menghapus foto: ' + errStorage.message); return; }
    lupakanSignedUrl(foto.bucket, foto.path);
    if (foto.thumbPath) lupakanSignedUrl(foto.bucket, foto.thumbPath);
    const { error: errRow } = await supabase.from('fs_evidence').delete().eq('id', foto.id);
    setAksiJalan(null);
    if (errRow) { beritahu?.('gagal', 'Foto terhapus dari storage tapi baris metadata gagal dihapus: ' + errRow.message); return; }
    beritahu?.('ok', 'Foto dihapus dari storage.');
    muat();
  };

  const mintaHapusFoto = (foto: EvidenceRow) => setConfirmState({
    message: 'Hapus foto ini permanen?',
    description: 'Berkasnya dihapus dari storage cloud (bukan cuma disembunyikan) supaya tidak menumpuk kuota. Tidak bisa dibatalkan.',
    danger: true, confirmLabel: 'Hapus Foto',
    onConfirm: () => hapusFoto(foto),
  });

  if (loading) return <p className="text-xs text-slate-400 px-4 py-3">Memuat detail…</p>;

  return (
    <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 space-y-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Riwayat GPS</p>
        {gpsEvents.length === 0 ? (
          <p className="text-xs text-slate-400">Belum ada percobaan check-in/check-out.</p>
        ) : (
          <div className="space-y-1">
            {gpsEvents.map((g, i) => (
              <div key={i} className="flex items-center justify-between text-xs gap-2">
                <span className="text-slate-500 truncate">{g.event_type === 'CHECK_IN' ? 'Check-in' : 'Check-out'} · {new Date(g.created_at).toLocaleString('id-ID')}</span>
                <span className="font-bold flex-shrink-0" style={{ color: g.validation_status === 'VALID' ? '#15803d' : '#b91c1c' }}>
                  {g.validation_status}{g.distance_m != null ? ` · ${Math.round(g.distance_m)}m` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {perTv.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Checklist TV ({perTv.filter(t => t.status === 'COMPLETED').length}/{perTv.length} selesai)</p>
          <div className="space-y-2">
            {perTv.map(t => {
              const lbl = FS_TV_STATUS_LABEL[t.status] ?? FS_TV_STATUS_LABEL.NOT_STARTED;
              return (
                <div key={t.pointId} className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-700 truncate">{t.pointName}{t.floor ? ` — ${t.floor}` : ''}</p>
                      {t.notes && <p className="text-[10px] text-slate-400 truncate">{t.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ color: lbl.color, background: lbl.bg }}>{lbl.label}</span>
                      {t.reviewStatus === 'APPROVED' ? (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✅ Disetujui</span>
                      ) : bolehReview && (
                        <button type="button" disabled={aksiJalan === t.pointId} onClick={() => approve(t.pointId)}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg text-white disabled:opacity-50" style={{ background: '#008300' }}>
                          {aksiJalan === t.pointId ? '…' : 'Approve'}
                        </button>
                      )}
                    </div>
                  </div>
                  {t.photos.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.photos.map(f => (
                        <div key={f.id} className="relative w-14 h-14 flex-shrink-0">
                          {f.thumbUrl ? (
                            <button type="button" onClick={() => void bukaFotoPenuh(f)} aria-label="Lihat foto ukuran penuh"
                              className="block w-14 h-14 rounded-lg overflow-hidden border border-slate-200 bg-white cursor-zoom-in">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={f.thumbUrl} alt="" className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <div className="w-14 h-14 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-[9px] text-slate-400">gagal</div>
                          )}
                          {bolehReview && (
                            <button type="button" disabled={aksiJalan === f.id} title="Hapus foto dari storage" aria-label="Hapus foto dari storage"
                              onClick={() => mintaHapusFoto(f)}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] flex items-center justify-center disabled:opacity-50">
                              🗑️
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Evidence Check-in/Check-out ({evidence.length})</p>
        {evidence.length === 0 ? (
          <p className="text-xs text-slate-400">Belum ada evidence diunggah.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {evidence.map(e => (
              e.thumbUrl ? (
                <button key={e.id} type="button" onClick={() => void bukaFotoPenuh(e)} aria-label="Lihat foto ukuran penuh"
                  className="block w-20 h-20 rounded-lg overflow-hidden border border-slate-200 bg-white cursor-zoom-in">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.thumbUrl} alt="" className="w-full h-full object-cover" />
                </button>
              ) : (
                <div key={e.id} className="w-20 h-20 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-[10px] text-slate-400">
                  gagal
                </div>
              )
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />
    </div>
  );
}
