'use client';

/**
 * AssignPicWilayah.tsx - menugaskan satu PIC ke banyak gedung sekaligus.
 *
 * BENTUKNYA: dua panel berdampingan (Tersedia ↔ Dipilih), mengikuti pola
 * "Set Player" pada platform signage yang sudah dipakai user - pola pemilihan
 * banyak-item yang sudah dikenalnya, bukan daftar centang panjang yang harus
 * digulir sambil mengingat mana yang sudah dicentang. Kelebihannya nyata pada
 * skala besar: sisi kanan SELALU menunjukkan persis apa yang akan disimpan,
 * berapa pun panjang daftar di kiri.
 *
 * Cara kerja manusianya tetap sama: "Budi pegang Jakarta Pusat" - pilih
 * wilayah, seluruh gedungnya masuk ke kanan sekaligus, lalu keluarkan yang
 * jadi pengecualian ("kecuali Gedung C, itu Andi").
 *
 * BENTURAN PENUGASAN ditampilkan sebelum disimpan, bukan setelah gagal:
 * trigger fs_check_assignment_conflict (migrasi 005) menolak dua PIC aktif
 * pada gedung yang sama, jadi gedung yang sudah dipegang orang lain diberi
 * tanda, dan admin memilih sendiri mau dilewati atau diambil alih.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { SearchableSelect } from '@/components/shared';
import { kirimNotifikasi } from '@/lib/notifikasi/router';

interface Wilayah { id: string; name: string; }
interface Gedung {
  id: string; name: string; area_id: string; areaName: string;
  jumlahTv: number;
  picSekarangId: string | null;
  picSekarangNama: string | null;
  assignmentId: string | null;
}
interface PicOpsi { id: string; full_name: string; }

export function AssignPicWilayah({ projectId, bolehKelola, beritahu, onSelesai }: {
  projectId: string;
  bolehKelola: boolean;
  beritahu: (tipe: 'ok' | 'gagal', teks: string) => void;
  onSelesai?: () => void;
}) {
  const [wilayah, setWilayah] = useState<Wilayah[]>([]);
  const [gedung, setGedung] = useState<Gedung[]>([]);
  const [pics, setPics] = useState<PicOpsi[]>([]);
  const [memuat, setMemuat] = useState(true);

  const [picId, setPicId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [dipilih, setDipilih] = useState<string[]>([]);
  const [cariTersedia, setCariTersedia] = useState('');
  const [ambilAlih, setAmbilAlih] = useState(false);
  const [menyimpan, setMenyimpan] = useState(false);
  /** Ringkasan hasil simpan TERAKHIR, ditampilkan sebagai kartu yang
   *  MENETAP di dalam modal ini (bukan cuma toast yang hilang 5 detik) -
   *  user melaporkan tidak jelas "masuk kemana" dan "apa yang muncul di
   *  table" setelah menekan Tugaskan. Kartu ini menjawab persis itu: siapa,
   *  ke mana, dan di menu mana hasilnya bisa diperiksa. */
  const [hasilTerakhir, setHasilTerakhir] = useState<{
    picNama: string; wilayahNama: string; gedungNama: string[]; totalTv: number; diambilAlih: number;
  } | null>(null);

  const muat = useCallback(async () => {
    if (!projectId) { setMemuat(false); return; }
    setMemuat(true);
    try {
      const [{ data: ar }, { data: loc }, { data: pt }, { data: asg }, { data: us }] = await Promise.all([
        supabase.from('fs_areas').select('id, name').eq('project_id', projectId).order('name'),
        supabase.from('fs_locations').select('id, name, area_id').eq('project_id', projectId).eq('status', 'active').order('name'),
        supabase.from('fs_execution_points').select('location_id').eq('status', 'active'),
        supabase.from('fs_pic_assignments').select('id, location_id, user_id').eq('project_id', projectId).eq('active', true),
        supabase.from('users').select('id, full_name').eq('fs_role', 'FIELD_PIC').order('full_name'),
      ]);

      const daftarWilayah = (ar ?? []) as Wilayah[];
      const namaWilayah = new Map(daftarWilayah.map(w => [w.id, w.name]));
      const tvPerLokasi = new Map<string, number>();
      for (const p of (pt ?? []) as { location_id: string }[]) {
        tvPerLokasi.set(p.location_id, (tvPerLokasi.get(p.location_id) ?? 0) + 1);
      }
      const daftarPic = (us ?? []) as PicOpsi[];
      const namaPic = new Map(daftarPic.map(u => [u.id, u.full_name]));
      const penugasan = new Map<string, { id: string; user_id: string }>();
      for (const a of (asg ?? []) as { id: string; location_id: string; user_id: string }[]) {
        penugasan.set(a.location_id, { id: a.id, user_id: a.user_id });
      }

      setWilayah(daftarWilayah);
      setPics(daftarPic);
      setGedung(((loc ?? []) as { id: string; name: string; area_id: string }[]).map(l => {
        const a = penugasan.get(l.id);
        return {
          id: l.id, name: l.name, area_id: l.area_id,
          areaName: namaWilayah.get(l.area_id) ?? '—',
          jumlahTv: tvPerLokasi.get(l.id) ?? 0,
          picSekarangId: a?.user_id ?? null,
          picSekarangNama: a ? (namaPic.get(a.user_id) ?? 'PIC lain') : null,
          assignmentId: a?.id ?? null,
        };
      }));
    } catch (e) {
      beritahu('gagal', e instanceof Error ? e.message : 'Gagal memuat data penugasan.');
    } finally { setMemuat(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => { void muat(); }, [muat]);

  /** Ganti wilayah -> seluruh gedungnya langsung pindah ke sisi "Dipilih".
   *  Itu maksud fiturnya: default seluruh wilayah, pengecualian dibuat dengan
   *  MENGELUARKAN gedung, bukan memasukkan satu per satu. */
  const pilihWilayah = (id: string) => {
    setAreaId(id);
    setDipilih(gedung.filter(g => g.area_id === id).map(g => g.id));
    setCariTersedia('');
  };

  const petaGedung = new Map(gedung.map(g => [g.id, g]));
  const gedungWilayah = areaId ? gedung.filter(g => g.area_id === areaId) : gedung;
  const q = cariTersedia.trim().toLowerCase();
  const tersedia = gedungWilayah
    .filter(g => !dipilih.includes(g.id))
    .filter(g => !q || g.name.toLowerCase().includes(q) || g.areaName.toLowerCase().includes(q));
  const terpilih = dipilih.map(id => petaGedung.get(id)).filter((g): g is Gedung => !!g);

  const totalTv = terpilih.reduce((s, g) => s + g.jumlahTv, 0);
  const bentrok = terpilih.filter(g => g.picSekarangId && g.picSekarangId !== picId);
  const akanDikerjakan = ambilAlih ? terpilih : terpilih.filter(g => !g.picSekarangId || g.picSekarangId === picId);

  const tambah = (id: string) => setDipilih(d => d.includes(id) ? d : [...d, id]);
  const buang = (id: string) => setDipilih(d => d.filter(x => x !== id));

  const kabariPic = async (jumlahGedung: number, jumlahTv: number, namaWilayah: string) => {
    if (!picId) return;
    try {
      const { data: u } = await supabase.from('users')
        .select('full_name, phone_number, telegram_chat_id').eq('id', picId).maybeSingle();
      if (!u) return;
      // Satu pesan ringkasan, bukan satu pesan per gedung - PIC tidak perlu
      // menerima 8 notifikasi untuk satu keputusan yang sama.
      const pesan = `Anda ditugaskan di ${namaWilayah}: ${jumlahGedung} gedung, ${jumlahTv} TV.\nBuka "Tugas Weekend Saya" untuk melihat rinciannya.`;
      await kirimNotifikasi({
        event: 'fs.pic_assigned',
        whatsapp: { penerima: [{ nama: u.full_name, telepon: u.phone_number }], pesan, jenisWA: 'fs_pic_assigned' },
        telegram: u.telegram_chat_id ? { pesan, chatId: u.telegram_chat_id } : undefined,
      });
    } catch { /* diam - penugasannya sudah tersimpan */ }
  };

  const simpan = async () => {
    if (!picId) { beritahu('gagal', 'Pilih PIC dulu.'); return; }
    if (akanDikerjakan.length === 0) { beritahu('gagal', 'Belum ada gedung yang dipilih.'); return; }
    setMenyimpan(true);

    let dibuat = 0, diambilAlih = 0, gagal = 0;
    const hariIni = new Date().toISOString().slice(0, 10);

    for (const g of akanDikerjakan) {
      if (g.picSekarangId === picId) continue; // sudah dipegang orang yang sama

      if (g.assignmentId && ambilAlih) {
        const { error } = await supabase.from('fs_pic_assignments')
          .update({ active: false, end_date: hariIni }).eq('id', g.assignmentId);
        if (error) { gagal++; continue; }
        diambilAlih++;
      }

      const { error } = await supabase.from('fs_pic_assignments').insert({
        project_id: projectId, location_id: g.id, execution_point_id: null,
        user_id: picId, effective_date: hariIni, active: true,
      });
      if (error) gagal++; else dibuat++;
    }

    setMenyimpan(false);

    const namaPicTerpilih = pics.find(p => p.id === picId)?.full_name ?? 'PIC';
    const namaWilayah = wilayah.find(w => w.id === areaId)?.name ?? 'beberapa wilayah';

    if (dibuat > 0) {
      const totalTvTersimpan = akanDikerjakan.reduce((s, g) => s + g.jumlahTv, 0);
      void kabariPic(dibuat, totalTvTersimpan, namaWilayah);
      beritahu('ok', `${namaPicTerpilih} ditugaskan ke ${dibuat} gedung.` + (gagal > 0 ? ` · ${gagal} gagal` : ''));
      setHasilTerakhir({
        picNama: namaPicTerpilih, wilayahNama: namaWilayah,
        gedungNama: akanDikerjakan.map(g => g.name), totalTv: totalTvTersimpan, diambilAlih,
      });
      setDipilih([]);
    } else if (gagal > 0) {
      beritahu('gagal', `${gagal} penugasan gagal disimpan.`);
    } else {
      beritahu('ok', 'Tidak ada perubahan — gedung terpilih sudah dipegang PIC ini.');
    }

    await muat();
    onSelesai?.();
  };

  if (!bolehKelola) return null;
  if (memuat) return <p className="text-sm text-slate-400 text-center py-10">Memuat…</p>;

  return (
    <div className="space-y-3">
      {hasilTerakhir && (
        <div className="rounded-xl px-3.5 py-3 flex items-start gap-2.5" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
          <span className="text-emerald-600 flex-shrink-0 mt-0.5" aria-hidden="true">✓</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold text-emerald-800">
              Tersimpan: {hasilTerakhir.picNama} → {hasilTerakhir.gedungNama.length} gedung di {hasilTerakhir.wilayahNama} ({hasilTerakhir.totalTv} TV)
            </p>
            <p className="text-[11px] text-emerald-700 mt-1 leading-relaxed">
              Gedung: {hasilTerakhir.gedungNama.slice(0, 4).join(', ')}{hasilTerakhir.gedungNama.length > 4 ? `, +${hasilTerakhir.gedungNama.length - 4} lagi` : ''}.
              {hasilTerakhir.diambilAlih > 0 && ` ${hasilTerakhir.diambilAlih} di antaranya diambil alih dari PIC sebelumnya.`}
            </p>
            <p className="text-[11px] text-emerald-700 mt-1.5 leading-relaxed">
              <strong>Cek hasilnya:</strong> tab <strong>Locations</strong> kolom PIC akan menunjukkan nama ini, dan daftar gedung
              di kiri modal ini sekarang bertanda <span className="font-semibold">&quot;PIC ini&quot;</span>. Langkah berikutnya:
              tutup modal ini lalu tekan <strong>&quot;Buat/Perbarui Daftar Pekerjaan&quot;</strong> pada siklus berjalan
              supaya PIC-nya langsung melihat tugas ini di &quot;Tugas Hari Ini&quot;.
            </p>
          </div>
          <button type="button" onClick={() => setHasilTerakhir(null)} aria-label="Tutup ringkasan"
            className="text-emerald-400 hover:text-emerald-700 flex-shrink-0 cursor-pointer">✕</button>
        </div>
      )}

      {/* Siapa & di mana */}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
            PIC yang ditugaskan <span className="text-red-500">*</span>
          </span>
          <SearchableSelect value={picId} onChange={setPicId} placeholder="Cari & pilih PIC…"
            options={pics.map(p => ({ value: p.id, label: p.full_name }))} />
        </div>
        <div>
          <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
            Wilayah
          </span>
          <SearchableSelect value={areaId} onChange={pilihWilayah} placeholder="Semua wilayah"
            options={[{ value: '', label: 'Semua wilayah' },
              ...wilayah.map(w => ({
                value: w.id,
                label: `${w.name} — ${gedung.filter(g => g.area_id === w.id).length} gedung`,
              }))]} />
        </div>
      </div>

      {/* Dua panel: tersedia ↔ dipilih */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
        <PanelGedung
          judul="Gedung tersedia"
          jumlah={tersedia.length}
          kepala={
            <input value={cariTersedia} onChange={e => setCariTersedia(e.target.value)}
              placeholder="Cari gedung…" autoComplete="off"
              className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 mb-2" />
          }
          kosong="Semua gedung sudah dipilih."
          daftar={tersedia}
          picIdTerpilih={picId}
          aksi={g => tambah(g.id)}
          ikonAksi="→"
        />

        <div className="flex md:flex-col items-center justify-center gap-2">
          <button type="button" onClick={() => setDipilih(d => Array.from(new Set([...d, ...tersedia.map(g => g.id)])))}
            disabled={tersedia.length === 0}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap">
            Pilih semua →
          </button>
          <button type="button" onClick={() => setDipilih([])} disabled={dipilih.length === 0}
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap">
            ← Kosongkan
          </button>
        </div>

        <PanelGedung
          judul="Akan ditugaskan"
          jumlah={terpilih.length}
          sorotan
          kosong="Belum ada gedung dipilih. Pilih wilayah di atas, atau tambahkan satu per satu dari kiri."
          daftar={terpilih}
          picIdTerpilih={picId}
          aksi={g => buang(g.id)}
          ikonAksi="✕"
        />
      </div>

      {bentrok.length > 0 && (
        <div className="rounded-xl px-3 py-2.5" style={{ background: '#fff7ed', border: '1px solid #fdba74' }}>
          <p className="text-xs font-bold" style={{ color: '#c2410c' }}>
            {bentrok.length} gedung sudah dipegang PIC lain
          </p>
          <p className="text-[11px] mt-0.5 mb-2" style={{ color: '#7c2d12' }}>
            Satu gedung hanya boleh punya satu PIC aktif — pilih apa yang harus dilakukan:
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input type="radio" checked={!ambilAlih} onChange={() => setAmbilAlih(false)} className="accent-blue-600" />
              Lewati gedung itu
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input type="radio" checked={ambilAlih} onChange={() => setAmbilAlih(true)} className="accent-blue-600" />
              Ambil alih (PIC lama dinonaktifkan)
            </label>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-600">
          Akan disimpan: <span className="font-bold text-slate-800">{akanDikerjakan.length} gedung</span>
          {' · '}<span className="font-bold text-slate-800">{totalTv} TV</span>
          {bentrok.length > 0 && !ambilAlih && (
            <span className="text-amber-700"> · {bentrok.length} dilewati</span>
          )}
        </p>
        <button type="button" onClick={simpan} disabled={menyimpan || !picId || akanDikerjakan.length === 0}
          className="text-sm font-bold px-4 py-2 rounded-xl text-white disabled:opacity-50"
          style={{ background: '#1d4ed8' }}>
          {menyimpan ? 'Menyimpan…' : 'Tugaskan'}
        </button>
      </div>
    </div>
  );
}

function PanelGedung({ judul, jumlah, kepala, daftar, kosong, aksi, ikonAksi, picIdTerpilih, sorotan }: {
  judul: string; jumlah: number; kepala?: React.ReactNode;
  daftar: Gedung[]; kosong: string;
  aksi: (g: Gedung) => void; ikonAksi: string;
  picIdTerpilih: string; sorotan?: boolean;
}) {
  return (
    <div className="rounded-xl border p-2.5 flex flex-col min-h-[240px]"
      style={sorotan
        ? { borderColor: '#bfdbfe', background: '#eff6ff' }
        : { borderColor: '#e2e8f0', background: '#fff' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{judul}</span>
        <span className="text-[11px] font-bold text-slate-400 tabular-nums">{jumlah}</span>
      </div>
      {kepala}
      <div className="flex-1 overflow-y-auto max-h-56 -mx-0.5">
        {daftar.length === 0 ? (
          <p className="text-[11px] text-slate-400 text-center py-8 px-2 leading-relaxed">{kosong}</p>
        ) : daftar.map(g => {
          const bentrokIni = g.picSekarangId && g.picSekarangId !== picIdTerpilih;
          return (
            <button key={g.id} type="button" onClick={() => aksi(g)}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/80 flex items-center gap-2 group">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-slate-800 truncate">{g.name}</span>
                <span className="block text-[10px] text-slate-500 truncate">
                  {g.areaName} · {g.jumlahTv} TV
                  {g.picSekarangNama && (
                    <span className={bentrokIni ? 'text-orange-600 font-semibold' : 'text-emerald-700 font-semibold'}>
                      {' · '}{bentrokIni ? g.picSekarangNama : 'PIC ini'}
                    </span>
                  )}
                </span>
              </span>
              <span className="text-slate-300 group-hover:text-blue-600 text-xs font-bold flex-shrink-0">{ikonAksi}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
