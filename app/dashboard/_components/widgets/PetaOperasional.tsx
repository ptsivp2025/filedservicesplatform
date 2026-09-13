'use client';

/**
 * PetaOperasional.tsx - peta sebagai LAPISAN PEMANTAUAN, bukan hiasan.
 *
 * Peta yang sudah ada di platform ini (MapPicker di field-service/page.tsx)
 * gunanya memilih koordinat saat mendaftarkan gedung. Peta ini menjawab
 * pertanyaan yang berbeda dan jauh lebih sering ditanyakan pada hari Senin:
 * "di sebelah mana pekerjaan yang bermasalah?"
 *
 * Warna penanda = keadaan pekerjaan di gedung itu pada siklus berjalan:
 *   hijau  = seluruh TV terpasang
 *   kuning = sebagian, belum ada kegagalan
 *   merah  = ada TV gagal / diminta diulang / belum tersentuh
 * Ukuran penanda mengikuti jumlah TV, supaya gedung 96 TV tidak terlihat
 * sama pentingnya dengan gedung 14 TV.
 *
 * Leaflet diimpor dinamis di dalam useEffect - modulnya menyentuh `window`
 * saat dimuat dan akan gagal ketika Next.js merender komponen ini di server
 * lebih dulu (pola yang sama dipakai MapPicker).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { warnaProgress, type BuildingProgress } from '@/lib/fs-cycle';
import { SearchableSelect } from '@/components/shared';

/** Merah bila ada masalah nyata, selain itu ikut skala persentase. */
function warnaGedung(b: BuildingProgress): string {
  if (b.failed_tv > 0 || b.revision_tv > 0) return '#b91c1c';
  return warnaProgress(b.pct ?? 0);
}

export function PetaOperasional({ buildings, onPilihGedung, penuh = false }: {
  buildings: BuildingProgress[];
  onPilihGedung: (b: BuildingProgress) => void;
  /** True saat dipakai di dalam DialogBesar: peta harus mengisi seluruh
   *  tinggi yang tersedia (bukan 360px tetap), supaya tidak ada area kosong
   *  di bawahnya seperti yang dilaporkan pada versi sebelumnya. */
  penuh?: boolean;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  /** location_id -> marker, supaya kotak cari bisa langsung membuka popup
   *  gedung yang dipilih tanpa pengguna perlu menemukannya sendiri di peta. */
  const markerRef = useRef<Map<string, import('leaflet').Marker>>(new Map());
  // Handler terbaru disimpan di ref: penanda dibuat ulang tiap data berubah,
  // dan kita tidak ingin membuat ulang seluruh peta hanya karena identitas
  // fungsi callback-nya berubah antar render.
  const pilihRef = useRef(onPilihGedung);
  pilihRef.current = onPilihGedung;

  /** Nama gedung + PIC menempel di peta, tidak perlu diklik satu per satu.
   *  Bisa dimatikan karena pada wilayah yang gedungnya berdempetan label
   *  bisa saling menimpa - di situ peta lebih terbaca tanpa nama. */
  const [tampilNama, setTampilNama] = useState(true);
  /** Fokus ke satu wilayah. Pada proyek nasional, melihat seluruh Indonesia
   *  sekaligus membuat tiap kota jadi satu titik yang tidak berguna. */
  const [wilayahAktif, setWilayahAktif] = useState<string | null>(null);

  const daftarWilayah = useMemo(() => {
    const peta = new Map<string, number>();
    for (const b of buildings) peta.set(b.area_name, (peta.get(b.area_name) ?? 0) + b.total_tv);
    return Array.from(peta.entries()).sort((a, b) => b[1] - a[1]);
  }, [buildings]);

  const tersaring = useMemo(
    () => (wilayahAktif ? buildings.filter(b => b.area_name === wilayahAktif) : buildings),
    [buildings, wilayahAktif]);

  useEffect(() => {
    let dibatalkan = false;
    let lepasWheel: (() => void) | null = null;
    import('leaflet').then(L => {
      if (dibatalkan || !elRef.current || mapRef.current) return;
      // scrollWheelZoom dimatikan dengan sengaja - kalau menyala, scroll biasa
      // di atas peta (mis. saat menggulir halaman) malah nyangkut jadi zoom
      // peta. zoomSnap 0.25 dipakai supaya zoom lewat pinch di bawah terasa
      // halus (bukan meloncat satu level penuh tiap gestur kecil).
      const map = L.map(elRef.current, { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.75 })
        .setView([-6.2, 106.816666], 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);

      // Pinch-zoom trackpad laptop TIDAK terkirim sebagai touch event seperti
      // di layar sentuh - Chrome/Firefox/Edge mengirimnya sebagai event
      // `wheel` biasa dengan ctrlKey=true (begitu juga Ctrl+scroll pakai
      // mouse). Karena scrollWheelZoom di atas mati total, gestur ini
      // sebelumnya tidak berbuat apa-apa sama sekali - keluhan user langsung.
      // Wheel TANPA ctrlKey (scroll dua jari biasa) sengaja dibiarkan lewat
      // supaya halaman tetap bisa digulir wajar saat kursor di atas peta.
      const container = elRef.current;
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const titik = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const langkah = e.deltaY > 0 ? -0.5 : 0.5;
        map.setZoomAround(titik, map.getZoom() + langkah);
      };
      container.addEventListener('wheel', onWheel, { passive: false });
      lepasWheel = () => container.removeEventListener('wheel', onWheel);
    });
    return () => {
      dibatalkan = true;
      lepasWheel?.();
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; }
    };
  }, []);

  /** Dipakai kotak "Cari gedung" - terbang ke gedungnya lalu buka popupnya,
   *  supaya menemukan satu gedung di antara ratusan tidak perlu menggeser
   *  dan memperbesar peta manual sama sekali. */
  const terbangKeGedung = (b: BuildingProgress) => {
    const map = mapRef.current;
    if (!map || b.latitude == null || b.longitude == null) return;
    map.flyTo([Number(b.latitude), Number(b.longitude)], Math.max(map.getZoom(), 15), { duration: 0.6 });
    const penanda = markerRef.current.get(b.location_id);
    if (penanda) window.setTimeout(() => penanda.openPopup(), 650);
  };

  // Saat peta berada di dalam dialog, tingginya ikut ukuran layar (flex-1)
  // alih-alih angka piksel tetap - Leaflet perlu diberi tahu setiap kali
  // ukuran kontainernya benar-benar berubah, kalau tidak ubin peta akan
  // terpotong/kosong sebagian sampai window di-resize manual.
  useEffect(() => {
    if (!elRef.current) return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(elRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let dibatalkan = false;
    import('leaflet').then(L => {
      const map = mapRef.current;
      const layer = layerRef.current;
      if (dibatalkan || !map || !layer) return;

      layer.clearLayers();
      markerRef.current.clear();
      const berkoordinat = tersaring.filter(b => b.latitude != null && b.longitude != null);
      if (berkoordinat.length === 0) return;

      for (const b of berkoordinat) {
        const warna = warnaGedung(b);
        const bermasalah = b.failed_tv + b.revision_tv + b.pending_tv;
        // Pin bentuk tetes-air dengan ikon gedung di dalamnya - jauh lebih
        // mudah dikenali dari sekilas pandang dibanding lingkaran polos, dan
        // ukurannya tetap mengikuti jumlah TV supaya gedung besar menonjol.
        const ukuran = 34 + Math.min(22, Math.round(b.total_tv / 6));
        const ikonGedung = `
          <div style="position:relative;width:${ukuran}px;height:${ukuran}px;filter:drop-shadow(0 2px 4px rgba(15,23,42,.35))">
            <div style="width:100%;height:100%;border-radius:50% 50% 50% 0;background:${warna};
              transform:rotate(-45deg);border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;">
              <div style="transform:rotate(45deg);color:#fff;line-height:0;">
                <svg width="${Math.round(ukuran * 0.4)}" height="${Math.round(ukuran * 0.4)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="7" width="18" height="14" rx="1"/><path d="M9 21v-6h6v6"/><path d="M8 3h8l1 4H7z"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M16 15h.01"/>
                </svg>
              </div>
            </div>
            ${bermasalah > 0 ? `<div style="position:absolute;top:-3px;right:-4px;background:#fff;color:#b91c1c;font-size:9px;font-weight:800;min-width:16px;height:16px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 3px;border:1.5px solid #b91c1c;">${bermasalah}</div>` : ''}
          </div>`;
        const penanda = L.marker([Number(b.latitude), Number(b.longitude)], {
          icon: L.divIcon({ html: ikonGedung, className: 'pin-gedung', iconSize: [ukuran, ukuran], iconAnchor: [ukuran / 2, ukuran], popupAnchor: [0, -ukuran] }),
        });

        const masalah = [
          b.failed_tv > 0 ? `${b.failed_tv} gagal` : null,
          b.revision_tv > 0 ? `${b.revision_tv} perlu diulang` : null,
          b.pending_tv > 0 ? `${b.pending_tv} belum dikerjakan` : null,
        ].filter(Boolean).join(' · ');

        // Teks popup disusun dari data yang sudah tersaring RLS; escape
        // sederhana tetap dipasang karena nama gedung/PIC berasal dari input
        // manusia dan di sini ia masuk sebagai HTML.
        const aman = (s: string) => s.replace(/[&<>"]/g, c =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

        penanda.bindPopup(`
          <div style="min-width:190px;font-family:inherit">
            <div style="font-weight:800;font-size:13px;color:#0f172a">${aman(b.location_name)}</div>
            <div style="font-size:11px;color:#64748b;margin-bottom:6px">${aman(b.area_name)}</div>
            <div style="font-size:13px;font-weight:800;color:${warna}">
              ${b.completed_tv}/${b.total_tv} TV terpasang (${b.pct ?? 0}%)
            </div>
            ${masalah ? `<div style="font-size:11px;color:#b91c1c;margin-top:4px">${aman(masalah)}</div>` : ''}
            <div style="font-size:11px;color:#64748b;margin-top:6px">
              PIC: ${aman(b.pic_names?.join(', ') || '—')}
            </div>
          </div>
        `);
        // Nama gedung + PIC menempel di peta: pertanyaan "gedung apa ini dan
        // siapa yang pegang" tidak perlu satu klik tambahan untuk dijawab.
        if (tampilNama) {
          penanda.bindTooltip(
            `<span style="font-weight:700">${aman(b.location_name)}</span>` +
            `<span style="display:block;font-size:9px;opacity:.75">${aman(b.pic_names?.[0] ?? 'Belum ada PIC')} · ${b.completed_tv}/${b.total_tv}</span>`,
            { permanent: true, direction: 'top', offset: [0, -ukuran], className: 'label-gedung' },
          );
        }

        penanda.on('click', () => pilihRef.current(b));
        penanda.addTo(layer);
        markerRef.current.set(b.location_id, penanda);
      }

      // Bingkai peta mengikuti sebaran gedung yang benar-benar ada, bukan
      // titik tengah Jakarta yang dipatok - proyek bisa saja tidak di Jakarta.
      const bounds = L.latLngBounds(berkoordinat.map(b => [Number(b.latitude), Number(b.longitude)] as [number, number]));
      map.fitBounds(bounds, { padding: [34, 34], maxZoom: 15 });
    });
    return () => { dibatalkan = true; };
  }, [tersaring, tampilNama]);

  const opsiCari = useMemo(() => buildings
    .filter(b => b.latitude != null && b.longitude != null)
    .map(b => ({ value: b.location_id, label: `${b.location_name} — ${b.area_name}` })),
    [buildings]);

  return (
    <div className={penuh ? 'h-full flex flex-col' : ''}>
      {/* Cari gedung: melompat langsung ke satu titik tanpa geser/perbesar
          peta manual - keluhan user langsung saat gedungnya banyak dan
          trackpad laptop sulit dipakai untuk navigasi peta. */}
      {opsiCari.length > 0 && (
        <div className="mb-2 flex-shrink-0 max-w-xs">
          <SearchableSelect value="" onChange={id => {
            const b = buildings.find(x => x.location_id === id);
            if (b) terbangKeGedung(b);
          }} placeholder="Cari gedung untuk lompat ke lokasinya…" options={opsiCari} />
        </div>
      )}

      {/* Kelompok wilayah - memfokuskan peta ke satu area sekaligus berfungsi
          sebagai ringkasan "wilayah mana punya berapa TV". */}
      {daftarWilayah.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-2 flex-shrink-0">
          <button type="button" onClick={() => setWilayahAktif(null)}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer"
            style={!wilayahAktif
              ? { borderColor: '#1d4ed8', background: '#eff6ff', color: '#1d4ed8' }
              : { borderColor: '#e2e8f0', background: '#fff', color: '#64748b' }}>
            Semua wilayah
          </button>
          {daftarWilayah.map(([nama, tv]) => (
            <button key={nama} type="button"
              onClick={() => setWilayahAktif(wilayahAktif === nama ? null : nama)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap cursor-pointer"
              style={wilayahAktif === nama
                ? { borderColor: '#1d4ed8', background: '#eff6ff', color: '#1d4ed8' }
                : { borderColor: '#e2e8f0', background: '#fff', color: '#64748b' }}>
              {nama} <span className="font-normal text-slate-400">· {tv} TV</span>
            </button>
          ))}
        </div>
      )}

      <div ref={elRef} className={`rounded-xl border border-slate-200 ${penuh ? 'flex-1 min-h-0' : ''}`}
        style={penuh ? undefined : { height: 360 }} />

      <div className="flex items-center gap-3 flex-wrap mt-2.5 px-1 flex-shrink-0">
        <Legenda warna="#047857" teks="Seluruh TV terpasang" />
        <Legenda warna="#b45309" teks="Sebagian selesai" />
        <Legenda warna="#b91c1c" teks="Ada gagal / perlu diulang / belum" />
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer">
          <input type="checkbox" checked={tampilNama} onChange={e => setTampilNama(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-300 accent-blue-600" />
          Tampilkan nama gedung &amp; PIC
        </label>
      </div>

      {/* Gaya label ditulis di sini, bukan di globals.css: ia hanya berarti
          untuk peta ini, dan menaruhnya di berkas global membuat orang
          berikutnya menebak-nebak siapa pemakainya. */}
      <style jsx global>{`
        .leaflet-tooltip.label-gedung {
          background: rgba(255,255,255,0.94);
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 1px 4px rgba(15,23,42,0.12);
          color: #0f172a;
          font-size: 11px;
          line-height: 1.25;
          padding: 3px 7px;
          white-space: nowrap;
        }
        .leaflet-tooltip.label-gedung::before { display: none; }
        .pin-gedung { background: transparent; border: none; cursor: pointer; transition: transform .12s ease; }
        .pin-gedung:hover { transform: scale(1.12); }
      `}</style>
    </div>
  );
}

function Legenda({ warna, teks }: { warna: string; teks: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: warna }} />
      <span className="text-[11px] font-semibold text-slate-600">{teks}</span>
    </span>
  );
}
