/**
 * scripts/seed-foto-demo.mjs — mengisi berkas foto bukti DEMO ke Storage.
 *
 * Kenapa perlu: baris metadata bukti (fs_evidence) sudah ada di database
 * demo, tapi berkasnya sendiri belum pernah diunggah. Akibatnya dua hal
 * terlihat aneh saat demo:
 *   - layar review client menampilkan tombol "Lihat foto" yang kosong;
 *   - alur "Setujui & Bersihkan" melaporkan file sebagai "sudah tidak ada di
 *     storage", bukan "terhapus" — jujur, tapi membingungkan untuk ditonton.
 *
 * Berkas yang diunggah SENGAJA berupa kartu SVG bertuliskan "FOTO DEMO"
 * beserta nama TV dan gedungnya, bukan foto sungguhan yang menyamar jadi
 * bukti asli. Siapa pun yang melihatnya langsung tahu ini data contoh.
 *
 * Jalankan setelah SUPABASE_SERVICE_ROLE_KEY terisi di .env.local:
 *
 *     node scripts/seed-foto-demo.mjs
 *
 * Aman diulang: unggahan memakai upsert, jadi menjalankannya dua kali tidak
 * menggandakan apa pun.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// .env.local dibaca manual — skrip ini berjalan di luar Next.js, jadi tidak
// ada yang memuatkannya untuk kita.
function bacaEnv() {
  const env = {};
  try {
    for (const baris of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
      const cocok = baris.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (cocok) env[cocok[1]] = cocok[2];
    }
  } catch {
    console.error('Tidak menemukan .env.local di akar proyek.');
    process.exit(1);
  }
  return env;
}

const env = bacaEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY belum diisi di .env.local.\n' +
    'Ambil di: Dashboard Supabase → Settings → API → service_role.',
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Kartu SVG sederhana — jelas terlihat sebagai contoh, bukan foto asli. */
function kartuDemo({ tv, gedung, wilayah, tanggal }) {
  const aman = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#0f172a"/>
  <rect x="40" y="60" width="560" height="330" rx="14" fill="#1e293b" stroke="#334155" stroke-width="2"/>
  <rect x="70" y="92" width="500" height="250" rx="8" fill="#0b1220" stroke="#475569"/>
  <text x="320" y="205" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="#38bdf8">${aman(tv)}</text>
  <text x="320" y="240" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#94a3b8">${aman(gedung)}</text>
  <text x="320" y="266" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="#64748b">${aman(wilayah)}</text>
  <text x="320" y="300" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#475569">Konten terpasang · ${aman(tanggal)}</text>
  <text x="320" y="428" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#f59e0b">FOTO DEMO — bukan bukti sungguhan</text>
</svg>`;
}

const { data: berkas, error } = await supabase
  .from('fs_evidence')
  .select('id, bucket, path, execution_point_id, fs_execution_points(name, fs_locations(name, fs_areas(name)))');

if (error) {
  console.error('Gagal membaca daftar bukti:', error.message);
  process.exit(1);
}

console.log(`Mengunggah ${berkas.length} berkas demo ke Storage…`);

let sukses = 0;
let gagal = 0;

for (const [i, b] of berkas.entries()) {
  const titik = b.fs_execution_points;
  const svg = kartuDemo({
    tv: titik?.name ?? 'TV',
    gedung: titik?.fs_locations?.name ?? '-',
    wilayah: titik?.fs_locations?.fs_areas?.name ?? '-',
    tanggal: new Date().toLocaleDateString('id-ID'),
  });

  const { error: errUnggah } = await supabase.storage
    .from(b.bucket)
    .upload(b.path, new Blob([svg], { type: 'image/svg+xml' }), {
      contentType: 'image/svg+xml',
      upsert: true,
    });

  if (errUnggah) {
    gagal++;
    if (gagal <= 3) console.error(`  gagal: ${b.path} — ${errUnggah.message}`);
  } else {
    sukses++;
  }

  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${berkas.length}…`);
}

console.log(`Selesai. ${sukses} berkas terunggah, ${gagal} gagal.`);
