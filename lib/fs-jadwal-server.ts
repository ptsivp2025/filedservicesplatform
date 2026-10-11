/**
 * lib/fs-jadwal-server.ts - pembuat siklus mingguan otomatis (SERVER ONLY,
 * memakai service role). Dipanggil cron harian dan saat Admin menyimpan
 * jadwal, supaya minggu berjalan langsung punya siklus tanpa menunggu besok.
 *
 * Daftar pekerjaan disusun di sini, bukan lewat RPC fs_generate_cycle_scope:
 * fungsi itu menuntut fs_is_provider() (pemanggil manusia) dan mengisi SETIAP
 * tanggal dari mulai s/d selesai - padahal hari yang dipilih Admin boleh
 * tidak berurutan (mis. Selasa & Kamis). Aturannya tetap sama: penugasan
 * permanen yang berlaku di rentang itu ikut terpakai, instance yang sudah ada
 * disambungkan (tidak dibuat dobel), dan konten TIDAK lagi dipakai.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AWALAN_KUNCI_JADWAL, bacaJadwal, hariIniWIB, namaSiklusOtomatis, tambahHariTeks,
  tanggalPengerjaanMinggu, type JadwalSiklus,
} from '@/lib/fs-jadwal';

export interface HasilOtomatis {
  projectId: string;
  status: 'dibuat' | 'sudah_ada' | 'lewat' | 'tanpa_hari' | 'gagal';
  cycleId?: string;
  nama?: string;
  instanceBaru?: number;
  instanceDisambung?: number;
  pesan?: string;
}

export async function buatSiklusMingguIni(
  db: SupabaseClient, projectId: string, jadwal: JadwalSiklus, hariIni = hariIniWIB(),
): Promise<HasilOtomatis> {
  if (jadwal.hari.length === 0) return { projectId, status: 'tanpa_hari' };

  const tanggal = tanggalPengerjaanMinggu(jadwal.hari, hariIni);
  const mulai = tanggal[0];
  const selesai = tanggal[tanggal.length - 1];
  // Hari pengerjaan minggu ini sudah lewat semua - siklusnya menunggu minggu depan.
  if (hariIni > selesai) return { projectId, status: 'lewat' };

  // Satu siklus per minggu: siklus apa pun (otomatis atau manual) yang
  // rentangnya menyentuh minggu ini dianggap sudah mewakilinya.
  const { data: ada, error: galatCek } = await db.from('fs_cycles')
    .select('id, name, status')
    .eq('project_id', projectId)
    .lte('execution_start', selesai)
    .gte('execution_end', mulai)
    .limit(1);
  if (galatCek) return { projectId, status: 'gagal', pesan: galatCek.message };
  if (ada && ada.length > 0) return { projectId, status: 'sudah_ada', cycleId: ada[0].id, nama: ada[0].name };

  const nama = namaSiklusOtomatis(tanggal);
  const { data: baru, error: galatBuat } = await db.from('fs_cycles').insert({
    project_id: projectId,
    name: nama,
    content_id: null,
    execution_start: mulai,
    execution_end: selesai,
    review_start: tambahHariTeks(selesai, 1),
    review_end: tambahHariTeks(selesai, jadwal.reviewHari),
    status: jadwal.aktifkanOtomatis ? 'ACTIVE' : 'PLANNED',
  }).select('id').single();
  if (galatBuat || !baru) return { projectId, status: 'gagal', pesan: galatBuat?.message ?? 'Siklus tidak tersimpan.' };

  try {
    const { baru: instanceBaru, disambung } = await susunDaftarPekerjaan(db, projectId, baru.id, tanggal);
    return { projectId, status: 'dibuat', cycleId: baru.id, nama, instanceBaru, instanceDisambung: disambung };
  } catch (e) {
    return { projectId, status: 'gagal', cycleId: baru.id, nama, pesan: e instanceof Error ? e.message : 'Gagal menyusun daftar pekerjaan.' };
  }
}

async function susunDaftarPekerjaan(db: SupabaseClient, projectId: string, cycleId: string, tanggal: string[]) {
  const mulai = tanggal[0];
  const selesai = tanggal[tanggal.length - 1];

  const { data: penugasan, error } = await db.from('fs_pic_assignments')
    .select('location_id, execution_point_id, user_id, schedule_id, cycle_id, effective_date, end_date')
    .eq('project_id', projectId)
    .eq('active', true);
  if (error) throw new Error(error.message);

  type Penugasan = {
    location_id: string; execution_point_id: string | null; user_id: string; schedule_id: string | null;
    cycle_id: string | null; effective_date: string; end_date: string | null;
  };
  const berlaku = ((penugasan ?? []) as Penugasan[]).filter(a =>
    a.cycle_id === cycleId ||
    (a.cycle_id == null && a.effective_date <= selesai && (a.end_date == null || a.end_date >= mulai)));
  if (berlaku.length === 0) return { baru: 0, disambung: 0 };

  const { data: lama, error: galatLama } = await db.from('fs_execution_instances')
    .select('id, location_id, execution_point_id, instance_date, cycle_id')
    .eq('project_id', projectId)
    .in('instance_date', tanggal);
  if (galatLama) throw new Error(galatLama.message);

  const kunci = (lok: string, titik: string | null, tgl: string) => `${lok}|${titik ?? '-'}|${tgl}`;
  const peta = new Map<string, { id: string; cycle_id: string | null }>();
  for (const i of lama ?? []) peta.set(kunci(i.location_id, i.execution_point_id, i.instance_date), i);

  const sisip: Record<string, unknown>[] = [];
  const sambung: string[] = [];
  const sudah = new Set<string>();
  for (const a of berlaku) {
    for (const tgl of tanggal) {
      const k = kunci(a.location_id, a.execution_point_id, tgl);
      if (sudah.has(k)) continue;
      sudah.add(k);
      const ada = peta.get(k);
      if (ada) {
        if (ada.cycle_id !== cycleId) sambung.push(ada.id);
        continue;
      }
      sisip.push({
        project_id: projectId, location_id: a.location_id, execution_point_id: a.execution_point_id,
        schedule_id: a.schedule_id, assigned_pic_user_id: a.user_id, content_id: null,
        cycle_id: cycleId, instance_date: tgl, status: 'NOT_STARTED',
      });
    }
  }

  for (let i = 0; i < sisip.length; i += 500) {
    const { error: e } = await db.from('fs_execution_instances').insert(sisip.slice(i, i + 500));
    if (e) throw new Error(e.message);
  }
  for (let i = 0; i < sambung.length; i += 200) {
    const { error: e } = await db.from('fs_execution_instances')
      .update({ cycle_id: cycleId, updated_at: new Date().toISOString() })
      .in('id', sambung.slice(i, i + 200));
    if (e) throw new Error(e.message);
  }
  return { baru: sisip.length, disambung: sambung.length };
}

/** Jalankan untuk SEMUA project yang sudah punya jadwal (dipakai cron). */
export async function jalankanSemuaJadwal(db: SupabaseClient): Promise<HasilOtomatis[]> {
  const { data, error } = await db.from('app_settings').select('key, value').like('key', `${AWALAN_KUNCI_JADWAL}%`);
  if (error) return [{ projectId: '-', status: 'gagal', pesan: error.message }];

  const hasil: HasilOtomatis[] = [];
  for (const baris of data ?? []) {
    const projectId = String(baris.key).slice(AWALAN_KUNCI_JADWAL.length);
    let nilai: unknown = baris.value;
    if (typeof nilai === 'string') { try { nilai = JSON.parse(nilai); } catch { nilai = null; } }
    hasil.push(await buatSiklusMingguIni(db, projectId, bacaJadwal(nilai)));
  }
  return hasil;
}
