'use client';

import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Masonry.tsx - masonry SUNGGUHAN berbasis pengukuran DOM, bukan pendekatan
 * CSS (grid/columns) yang cuma menebak.
 *
 * KENAPA CSS SAJA TIDAK CUKUP: percobaan pertama memakai `columns-3` +
 * `column-fill: balance` (fitur bawaan browser). Itu lebih baik daripada
 * pembagian kolom manual di kode, tapi tetap tidak bisa rata sempurna -
 * `column-fill: balance` cuma tebakan cepat berbasis jumlah/urutan elemen,
 * bukan optimasi sebenarnya, dan browser tidak memberi cara untuk memaksanya
 * lebih presisi. Selisih tinggi antar kolom bisa masih puluhan-ratusan piksel
 * (dikeluhkan user via screenshot panah merah - ruang kosong masih ada,
 * "koordinat" bawah tiap kotak tidak rata).
 *
 * SOLUSI DI SINI: ukur tinggi ASLI tiap kartu setelah dirender (ResizeObserver
 * per kartu + per kontainer), lalu jalankan algoritma "kolom paling pendek
 * duluan" (greedy shortest-column-first, standar untuk masonry ala Pinterest)
 * untuk menempatkan tiap kartu secara eksplisit lewat `position:absolute`.
 * Ini SELALU menghasilkan hasil yang sama atau lebih rata dibanding
 * `column-fill:balance`, karena keputusannya berbasis tinggi PIKSEL nyata,
 * bukan tebakan CSS.
 *
 * Konsekuensi yang diterima sadar (diminta user, bukan bug): tiap perubahan
 * tinggi kartu (chart baru selesai render, data berubah, lebar kontainer
 * berubah karena sidebar dibuka/tutup) memicu reflow - kartu berpindah
 * posisi. transition di posisi absolute membuat ini terasa halus, bukan
 * kedutan tiba-tiba.
 *
 * Cara pakai: bungkus kartu-kartu (termasuk yang render kondisional lewat
 * `{kondisi && <Kartu>...}`) langsung sebagai children - jangan bungkus
 * manual dengan div kolom seperti pendekatan grid/columns sebelumnya. Selalu
 * beri `key` eksplisit pada tiap kartu supaya identitasnya stabil walau ada
 * kartu lain yang tampil/hilang di antaranya (kalau tidak, React bisa salah
 * mengira kartu berubah identitas saat kartu kondisional lain muncul/hilang
 * di depannya, akibat React.Children.toArray menomori ulang berbasis
 * posisi).
 */

interface Posisi {
  top: number;
  left: number;
  width: number;
}

interface MasonryProps {
  children: React.ReactNode;
  /** Jumlah kolom maksimum pada layar lebar. Default 3. */
  columns?: number;
  /** Lebar minimum tiap kolom (px) - dipakai untuk menurunkan jumlah kolom otomatis di layar sempit, mirip breakpoint grid tapi berbasis lebar KONTAINER sebenarnya (bukan lebar layar - tetap benar walau sidebar membuat kontainer lebih sempit dari viewport). */
  minColumnWidth?: number;
  /** Jarak antar kartu (px), horizontal maupun vertikal. Default 12. */
  gap?: number;
  className?: string;
}

export function Masonry({ children, columns = 3, minColumnWidth = 260, gap = 12, className }: MasonryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [layout, setLayout] = useState<{ posisi: Map<string, Posisi>; tinggi: number; siap: boolean }>({
    posisi: new Map(), tinggi: 0, siap: false,
  });

  const items = Children.toArray(children).filter(isValidElement) as React.ReactElement[];
  const keys = items.map((el, i) => String(el.key ?? i));
  const kunciGabung = keys.join('|');

  const hitungUlang = useCallback(() => {
    const kontainer = containerRef.current;
    if (!kontainer) return;
    const lebarKontainer = kontainer.clientWidth;
    if (lebarKontainer === 0) return;

    const jumlahKolom = Math.max(1, Math.min(columns, Math.floor((lebarKontainer + gap) / (minColumnWidth + gap))));
    const lebarKolom = (lebarKontainer - gap * (jumlahKolom - 1)) / jumlahKolom;
    const tinggiKolom = new Array(jumlahKolom).fill(0);
    const posisiBaru = new Map<string, Posisi>();

    for (const kunci of keys) {
      const el = itemRefs.current.get(kunci);
      const tinggiKartu = el ? el.getBoundingClientRect().height : 0;

      // Kolom paling pendek duluan - inilah inti algoritma masonry.
      // Bukan round-robin (kartu ke-N selalu ke kolom N%3), tapi keputusan
      // ulang setiap kartu berdasar kondisi TERKINI semua kolom.
      let kolomPendek = 0;
      for (let i = 1; i < jumlahKolom; i++) {
        if (tinggiKolom[i] < tinggiKolom[kolomPendek]) kolomPendek = i;
      }

      posisiBaru.set(kunci, {
        top: tinggiKolom[kolomPendek],
        left: kolomPendek * (lebarKolom + gap),
        width: lebarKolom,
      });
      tinggiKolom[kolomPendek] += tinggiKartu + gap;
    }

    const tinggiMaks = tinggiKolom.length ? Math.max(...tinggiKolom) - gap : 0;
    setLayout({ posisi: posisiBaru, tinggi: Math.max(0, tinggiMaks), siap: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, minColumnWidth, gap, kunciGabung]);

  // Pengukuran pertama SEBELUM browser mengecat layar (useLayoutEffect,
  // bukan useEffect) - supaya frame "belum tertata" (kartu numpuk vertikal,
  // disembunyikan) tidak pernah sempat terlihat sekejap pun oleh user.
  useLayoutEffect(() => {
    hitungUlang();
  }, [hitungUlang]);

  // Reflow lanjutan: kapan pun tinggi salah satu kartu berubah (chart selesai
  // render, data baru masuk, badge kondisional muncul) ATAU lebar kontainer
  // berubah (sidebar dibuka/tutup, resize browser) - bukan cuma sekali di awal.
  useEffect(() => {
    const kontainer = containerRef.current;
    if (!kontainer) return;
    const ro = new ResizeObserver(() => hitungUlang());
    ro.observe(kontainer);
    itemRefs.current.forEach(el => ro.observe(el));
    return () => ro.disconnect();
  }, [hitungUlang, kunciGabung]);

  return (
    <div ref={containerRef} className={className}
      style={{ position: 'relative', height: layout.siap ? layout.tinggi : undefined }}>
      {items.map((child, i) => {
        const kunci = keys[i];
        const pos = layout.posisi.get(kunci);
        return (
          <div key={kunci}
            ref={el => {
              if (el) itemRefs.current.set(kunci, el);
              else itemRefs.current.delete(kunci);
            }}
            style={pos
              ? { position: 'absolute', top: pos.top, left: pos.left, width: pos.width, transition: 'top 200ms ease, left 200ms ease' }
              : { position: 'relative', width: '100%', visibility: 'hidden' }}>
            {child}
          </div>
        );
      })}
    </div>
  );
}
