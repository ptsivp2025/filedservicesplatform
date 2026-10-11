'use client';

import { Children, cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Masonry.tsx - masonry SUNGGUHAN berbasis pengukuran DOM, bukan pendekatan
 * CSS (grid/columns) yang cuma menebak.
 *
 * KENAPA CSS SAJA TIDAK CUKUP: percobaan pertama memakai `columns-3` +
 * `column-fill: balance` (fitur bawaan browser) - lebih baik daripada
 * pembagian kolom manual di kode, tapi tetap tidak bisa rata sempurna,
 * cuma tebakan cepat berbasis jumlah/urutan elemen, bukan optimasi
 * sebenarnya.
 *
 * PENDEKATAN DI SINI: ukur tinggi ASLI tiap kartu setelah dirender
 * (ResizeObserver per kartu + per kontainer), jalankan algoritma "kolom
 * paling pendek duluan" (greedy shortest-column-first) untuk menempatkan
 * tiap kartu lewat `position:absolute`, LALU - ini bagian yang beda dari
 * versi sebelumnya - kartu TERAKHIR di tiap kolom di-"regangkan" (tinggi
 * wrapper-nya dipaksa) supaya kolomnya berakhir PERSIS di baris yang sama
 * dengan kolom tertinggi. Ini yang diminta user secara eksplisit: "batas
 * bawah antara kotak kanan dan kiri itu harus sama" - bukan sekadar
 * "seimbang", tapi RATA. Kartu-kartu SELAIN yang terakhir di tiap kolom
 * tetap apa adanya (tinggi asli, tidak dipaksa) - jadi tidak mengulang
 * masalah lama (grid biasa yang men-stretch SEMUA kartu ke tinggi
 * tertinggi dalam satu baris).
 *
 * JEBAKAN #1 (sudah ditangani): kalau kita ukur tinggi lewat elemen yang
 * SAMA dengan yang kita regangkan, hasil regangan siklus sebelumnya akan
 * terbaca sebagai "tinggi asli" pada pengukuran berikutnya, lalu meleset
 * lagi sedikit - bergeser (drift) setiap kali dihitung ulang. Makanya
 * SETIAP hitungUlang() mengembalikan dulu `style.height` semua elemen ke
 * kosong (lewat DOM langsung, bukan lewat React) SEBELUM mengukur - supaya
 * yang terbaca SELALU tinggi konten asli.
 *
 * JEBAKAN #2 (BUG NYATA yang sempat lolos - ditemukan lewat pengukuran
 * langsung di browser, kartu yang seharusnya meregang malah diam di
 * tinggi alaminya): ResizeObserver yang sama mengamati SEMUA kartu,
 * TERMASUK kartu yang baru saja kita regangkan sendiri. Meregangkan sebuah
 * kartu MENGUBAH ukurannya -> ResizeObserver yang mengamatinya ikut
 * terpicu lagi -> hitungUlang() jalan lagi -> reset ke tinggi alami (via
 * JEBAKAN #1) -> regangkan lagi -> terpicu lagi - lingkaran tanpa henti.
 * Browser punya pelindung bawaan untuk loop ResizeObserver seperti ini
 * (kadang diam-diam BERHENTI mengirim notifikasi tanpa error terlihat),
 * dan hasilnya kartu bisa nyangkut di keadaan "baru direset ke alami,
 * belum sempat diregangkan lagi" - persis seperti bug yang ditemukan.
 * Perbaikannya: SEBELUM memanggil setLayout, bandingkan hasil hitungan
 * baru dengan hasil yang SUDAH terpasang (lewat `layoutRef`) - kalau
 * PERSIS SAMA, jangan panggil setLayout sama sekali. Tidak ada perubahan
 * state -> tidak ada re-render -> tidak ada perubahan DOM -> tidak ada
 * pemicu ResizeObserver baru -> lingkaran berhenti dengan sendirinya
 * begitu hasilnya stabil (yang seharusnya terjadi setelah TEPAT satu kali
 * regang).
 */

interface Posisi {
  top: number;
  left: number;
  width: number;
  /** Diisi HANYA untuk kartu terakhir di kolomnya sendiri, dan HANYA kalau
   *  kolom itu lebih pendek dari kolom tertinggi - meregangkan wrapper-nya
   *  supaya kolom ini juga berakhir di baris yang sama dengan kolom
   *  tertinggi. */
  height?: number;
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
  /**
   * Kartu tertentu boleh "melebar" mengambil lebih dari satu kolom dasar -
   * kunci di sini HARUS sama dengan `key` yang dipasang di kartu tersebut.
   * Dipakai untuk kartu yang butuh lebar (tabel, daftar) supaya tidak
   * dijejalkan ke lebar kolom sempit yang sama dengan kartu ikon/donat di
   * sebelahnya - kartu lebar dan beberapa kartu sempit yang bertumpuk di
   * kolom sisanya jadi terlihat SATU baris bento yang disengaja, bukan
   * grid seragam yang kaku. Nilai dibatasi otomatis ke jumlah kolom yang
   * sedang aktif (mis. span:3 di layar yang cuma muat 2 kolom -> jadi 2).
   */
  spans?: Record<string, number>;
}

type Layout = { posisi: Map<string, Posisi>; tinggi: number; siap: boolean };

function posisiSama(a: Posisi, b: Posisi): boolean {
  const dekat = (x: number, y: number) => Math.abs(x - y) < 0.5;
  return dekat(a.top, b.top) && dekat(a.left, b.left) && dekat(a.width, b.width)
    && dekat(a.height ?? -1, b.height ?? -1);
}

function layoutSama(a: Layout, b: Layout): boolean {
  if (!dekatTinggi(a.tinggi, b.tinggi) || a.posisi.size !== b.posisi.size) return false;
  for (const [kunci, pos] of a.posisi) {
    const posLain = b.posisi.get(kunci);
    if (!posLain || !posisiSama(pos, posLain)) return false;
  }
  return true;
}
function dekatTinggi(x: number, y: number): boolean { return Math.abs(x - y) < 0.5; }

export function Masonry({ children, columns = 3, minColumnWidth = 260, gap = 12, className, spans }: MasonryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [layout, setLayout] = useState<Layout>({ posisi: new Map(), tinggi: 0, siap: false });
  // Cermin dari `layout` tapi dibaca lewat ref di dalam hitungUlang (closure
  // useCallback) - supaya perbandingan "apakah hasilnya sama" selalu
  // melihat state PALING BARU tanpa perlu memasukkan `layout` ke deps
  // hitungUlang (yang akan bikin fungsi ini dibuat ulang tiap render dan
  // merusak identitas stabil yang dipakai efek ResizeObserver di bawah).
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);

  const items = Children.toArray(children).filter(isValidElement) as React.ReactElement[];
  // BUG NYATA yang sempat lolos (ditemukan lewat pengukuran DOM langsung -
  // kartu yang diberi `spans` tidak pernah benar-benar melebar, lebarnya
  // identik dengan kartu lain di sebelahnya): React.Children.toArray()
  // MEMBUBUHI AWALAN ke tiap key eksplisit demi keunikan saat me-flatten
  // (mis. key="wilayah-perlu-perhatian" yang ditulis pemanggil berubah
  // jadi ".$wilayah-perlu-perhatian" begitu dibaca lewat `el.key` di sini) -
  // jadi lookup `spans['wilayah-perlu-perhatian']` selalu gagal cocok
  // dengan key yang SUDAH diawali itu, lebarSpan diam-diam selalu jatuh ke
  // default 1. Melucuti awalan `.$` mengembalikan string key ASLI yang
  // ditulis pemanggil, supaya prop `spans` (dan segala pencocokan key
  // lain di berkas ini) bekerja seperti yang terlihat di kode pemanggil.
  const keys = items.map((el, i) => (el.key != null ? String(el.key).replace(/^\.\$/, '') : String(i)));
  const kunciGabung = keys.join('|');
  // String stabil dari `spans` untuk deps useCallback - `spans` sendiri
  // objek baru tiap render kalau pemanggil menulisnya sebagai literal
  // inline (`spans={{...}}`), jadi tidak bisa jadi dependency langsung
  // tanpa membuat hitungUlang dibuat ulang setiap render.
  const spansGabung = spans ? JSON.stringify(spans) : '';

  const hitungUlang = useCallback(() => {
    const kontainer = containerRef.current;
    if (!kontainer) return;
    const lebarKontainer = kontainer.clientWidth;
    if (lebarKontainer === 0) return;

    // Kembalikan dulu ke tinggi alami SEBELUM mengukur - lihat komentar
    // "JEBAKAN" di atas berkas ini.
    itemRefs.current.forEach(el => { el.style.height = ''; });

    const jumlahKolom = Math.max(1, Math.min(columns, Math.floor((lebarKontainer + gap) / (minColumnWidth + gap))));
    const lebarKolom = (lebarKontainer - gap * (jumlahKolom - 1)) / jumlahKolom;
    const tinggiKolom = new Array(jumlahKolom).fill(0);
    const kunciTerakhirPerKolom = new Array<string | null>(jumlahKolom).fill(null);
    const posisiBaru = new Map<string, Posisi>();

    for (const kunci of keys) {
      const el = itemRefs.current.get(kunci);
      const tinggiKartu = el ? el.getBoundingClientRect().height : 0;
      const lebarSpan = Math.max(1, Math.min(jumlahKolom, Math.round(spans?.[kunci] ?? 1)));

      // Jendela kolom-berdampingan yang PALING PENDEK duluan - generalisasi
      // dari "kolom paling pendek duluan" untuk kartu selebar N kolom:
      // dicoba tiap kemungkinan titik awal, dipilih yang tinggi
      // MAKSIMUM di antara kolom-kolom yang dilewatinya paling kecil (itu
      // yang membatasi seberapa tinggi kartu ini boleh mulai, karena kartu
      // lebar harus duduk rata menyentuh SEMUA kolom yang dilewatinya).
      let mulaiTerbaik = 0;
      let tinggiTerbaik = Infinity;
      for (let s = 0; s <= jumlahKolom - lebarSpan; s++) {
        let tinggiMaksDiJendela = 0;
        for (let i = s; i < s + lebarSpan; i++) tinggiMaksDiJendela = Math.max(tinggiMaksDiJendela, tinggiKolom[i]);
        if (tinggiMaksDiJendela < tinggiTerbaik) { tinggiTerbaik = tinggiMaksDiJendela; mulaiTerbaik = s; }
      }

      // BUG NYATA yang sempat lolos (ditemukan lewat screenshot user -
      // "masih banyak area mubazir kosong"): begitu kartu lebar (span > 1)
      // ditaruh di titik SETINGGI kolom yang PALING TINGGI di jendelanya,
      // kolom-kolom LAIN di jendela yang sama (lebih pendek) menyisakan
      // celah kosong di ATAS kartu lebar itu - kartu terakhir di kolom
      // pendek itu tidak pernah diregangkan untuk menutup celahnya sendiri
      // sampai akhir (dan bahkan di akhir pun bukan celah TENGAH yang
      // ditutup, cuma celah di baris paling bawah kolom). Sebelum menaruh
      // kartu ini, tutup dulu celah itu: regangkan kartu TERAKHIR di tiap
      // kolom yang lebih pendek dari titik mulai kartu baru ini supaya
      // rata dulu, baru kartu baru disambung tepat di bawahnya.
      for (let i = mulaiTerbaik; i < mulaiTerbaik + lebarSpan; i++) {
        if (tinggiKolom[i] < tinggiTerbaik - 1 && kunciTerakhirPerKolom[i]) {
          const kunciSebelumnya = kunciTerakhirPerKolom[i]!;
          const posSebelumnya = posisiBaru.get(kunciSebelumnya);
          if (posSebelumnya) {
            const tinggiPenutup = (tinggiTerbaik - gap) - posSebelumnya.top;
            if (tinggiPenutup > 1) posisiBaru.set(kunciSebelumnya, { ...posSebelumnya, height: tinggiPenutup });
          }
        }
        tinggiKolom[i] = tinggiTerbaik;
      }

      posisiBaru.set(kunci, {
        top: tinggiTerbaik,
        left: mulaiTerbaik * (lebarKolom + gap),
        width: lebarKolom * lebarSpan + gap * (lebarSpan - 1),
      });
      const tinggiSetelahKartu = tinggiTerbaik + tinggiKartu + gap;
      for (let i = mulaiTerbaik; i < mulaiTerbaik + lebarSpan; i++) {
        tinggiKolom[i] = tinggiSetelahKartu;
        kunciTerakhirPerKolom[i] = kunci;
      }
    }

    const tinggiMaks = tinggiKolom.length ? Math.max(...tinggiKolom) - gap : 0;

    // Regangkan kartu TERAKHIR di tiap kolom yang lebih pendek dari kolom
    // tertinggi, supaya semua kolom berakhir RATA di baris yang sama -
    // bukan cuma "sebisa mungkin seimbang" seperti versi sebelumnya, tapi
    // benar-benar sama persis (diminta user: "batas bawah antara kotak
    // kanan dan kiri itu harus sama"). Kartu SELAIN yang terakhir di
    // kolomnya tetap apa adanya (tinggi alami, tidak diregangkan).
    kunciTerakhirPerKolom.forEach(kunci => {
      if (!kunci) return;
      const pos = posisiBaru.get(kunci);
      if (!pos) return;
      const regangan = tinggiMaks - pos.top;
      if (regangan > 1) { // toleransi 1px, hindari regang untuk selisih sub-piksel
        posisiBaru.set(kunci, { ...pos, height: regangan });
      }
    });

    const hasilBaru: Layout = { posisi: posisiBaru, tinggi: Math.max(0, tinggiMaks), siap: true };

    // JEBAKAN #3 (ditemukan setelah JEBAKAN #2 "diperbaiki" tapi kartu
    // MASIH terjebak di tinggi alami saat diuji ulang): baris paling atas
    // fungsi ini me-reset `style.height` LEWAT DOM LANGSUNG supaya
    // pengukuran jujur (JEBAKAN #1). Reset itu SUNGGUHAN mengubah DOM saat
    // itu juga. Kalau setelah dihitung ternyata hasilnya SAMA dengan yang
    // sudah tersimpan (JEBAKAN #2 bilang "lewati setLayout, tidak perlu
    // render ulang") - reset yang baru saja terjadi TIDAK PERNAH dikembalikan,
    // karena satu-satunya kode yang mengembalikan tinggi regangan adalah
    // style React lewat re-render, dan render ulang itu justru yang kita
    // lewati! Akibatnya kartu nyangkut di tinggi alami (reset) meski
    // `layout` React "mengira" tingginya sudah benar. Makanya di sini
    // tinggi/posisi HASIL AKHIR selalu dipasang ulang langsung ke DOM
    // (idempoten - kalau nilainya sudah sama seperti sekarang, browser
    // tidak menganggap ini perubahan ukuran, jadi tidak memicu
    // ResizeObserver lagi) - TERLEPAS dari apakah kita juga memanggil
    // setLayout. setLayout sendiri jadi murni optimasi (hindari render
    // React yang tidak perlu), bukan satu-satunya jalan DOM jadi benar.
    keys.forEach(kunci => {
      const el = itemRefs.current.get(kunci);
      const pos = posisiBaru.get(kunci);
      if (!el || !pos) return;
      el.style.top = `${pos.top}px`;
      el.style.left = `${pos.left}px`;
      el.style.width = `${pos.width}px`;
      el.style.height = pos.height != null ? `${pos.height}px` : '';
    });

    // Lihat komentar "JEBAKAN #2" di atas berkas ini - inilah yang memutus
    // lingkaran ResizeObserver-memicu-dirinya-sendiri (untuk state React-nya
    // saja - DOM sudah benar lewat blok di atas terlepas dari ini).
    if (layoutRef.current.siap && layoutSama(layoutRef.current, hasilBaru)) return;
    layoutRef.current = hasilBaru;
    setLayout(hasilBaru);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, minColumnWidth, gap, kunciGabung, spansGabung]);

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
        // h-full aman ditambahkan tanpa syarat - height:100% hanya berlaku
        // kalau wrapper (parent langsung) punya tinggi PASTI (di-set lewat
        // pos.height di bawah); kalau wrapper-nya auto-height (kartu biasa,
        // tidak diregangkan), height:100% otomatis diperlakukan sebagai
        // auto oleh browser - tidak berefek apa-apa.
        const kelasAsli = (child.props as { className?: string }).className;
        const anakDiregang = cloneElement(child, {
          className: [kelasAsli, 'h-full'].filter(Boolean).join(' '),
        } as React.Attributes);
        return (
          <div key={kunci}
            ref={el => {
              if (el) itemRefs.current.set(kunci, el);
              else itemRefs.current.delete(kunci);
            }}
            style={pos
              ? { position: 'absolute', top: pos.top, left: pos.left, width: pos.width, height: pos.height, transition: 'top 200ms ease, left 200ms ease, height 200ms ease' }
              : { position: 'relative', width: '100%', visibility: 'hidden' }}>
            {anakDiregang}
          </div>
        );
      })}
    </div>
  );
}
