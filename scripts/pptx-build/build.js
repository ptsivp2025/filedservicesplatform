const pptxgen = require("pptxgenjs");
const path = require("path");

const SHOTS = path.join(__dirname, "..", "shots");
const img = (name) => path.join(SHOTS, name);

// ---- palette ----
const MAROON = "8B112E";
const MAROON_DARK = "6B0C24";
const GOLD = "C8861D";
const INK = "1F2430";
const SLATE = "4B5565";
const MUTED = "70798A";
const LINE = "E2E5EA";
const PAPER = "FFFFFF";
const PANEL = "F6F3EF";
const GREEN = "1E8E5A";
const RED = "C23B34";
const AMBER = "B9770E";
const WHITE = "FFFFFF";

const HEAD_FONT = "Cambria";
const BODY_FONT = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
const SW = 13.333, SH = 7.5;

function newSlide(bg) {
  const s = pres.addSlide();
  s.background = { color: bg || PAPER };
  return s;
}

function title(s, kicker, headline, opts = {}) {
  const color = opts.dark ? WHITE : INK;
  const kickerColor = opts.dark ? GOLD : MAROON;
  s.addText(kicker.toUpperCase(), {
    x: 0.6, y: opts.y || 0.5, w: 10, h: 0.35,
    fontFace: BODY_FONT, fontSize: 12, bold: true, color: kickerColor,
    charSpacing: 2, isTextBox: true,
  });
  s.addText(headline, {
    x: 0.6, y: (opts.y || 0.5) + 0.32, w: opts.w || 11.5, h: opts.h || 0.7,
    fontFace: HEAD_FONT, fontSize: opts.size || 28, bold: true, color,
    isTextBox: true,
  });
}

function pageNum(s, n) {
  s.addText(String(n).padStart(2, "0"), {
    x: SW - 0.9, y: SH - 0.45, w: 0.6, h: 0.3,
    fontFace: BODY_FONT, fontSize: 9, color: MUTED, align: "right", isTextBox: true,
  });
}

function iconCircle(s, x, y, d, color, glyph, glyphColor) {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color }, line: { type: "none" } });
  s.addText(glyph, {
    x, y, w: d, h: d, align: "center", valign: "middle",
    fontFace: BODY_FONT, fontSize: d * 26, bold: true, color: glyphColor || WHITE, isTextBox: true,
  });
}

// framed screenshot with soft shadow — the one repeated motif for real captures
// NOTE: pptxgenjs's addImage `rounding:true` renders as a corrupted ellipse crop
// (verified via isolated test), so framing here uses a square-cornered backdrop
// + border instead of rounding the image itself.
function shot(s, file, x, y, w, h) {
  s.addShape(pres.ShapeType.rect, {
    x, y, w, h,
    fill: { color: WHITE },
    line: { type: "none" },
    shadow: { type: "outer", color: "1B1F27", opacity: 0.28, blur: 10, offset: 3, angle: 90 },
  });
  s.addImage({ path: img(file), x, y, w, h, sizing: { type: "cover", w, h } });
  s.addShape(pres.ShapeType.rect, {
    x, y, w, h, fill: { type: "none" }, line: { color: LINE, width: 1 },
  });
}

function caption(s, x, y, w, text, opts = {}) {
  s.addText(text, {
    x, y, w, h: 0.3,
    fontFace: BODY_FONT, fontSize: 10, italic: true, color: opts.color || MUTED,
    align: opts.align || "left", isTextBox: true,
  });
}

function realBadge(s, x, y) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w: 1.9, h: 0.32, rectRadius: 0.5,
    fill: { color: "E8F5EC" }, line: { type: "none" },
  });
  s.addText("● SCREENSHOT ASLI", {
    x, y, w: 1.9, h: 0.32, align: "center", valign: "middle",
    fontFace: BODY_FONT, fontSize: 9.5, bold: true, color: GREEN, isTextBox: true,
  });
}

function bulletList(s, x, y, w, h, items, opts = {}) {
  // Flat array of runs — pptxgenjs paragraphs are runs ending in breakLine:true;
  // nesting an array as a run's `text` (previous approach) renders "[object Object]".
  const runs = [];
  items.forEach((it, i) => {
    const isLast = i === items.length - 1;
    if (Array.isArray(it)) {
      runs.push({ text: it[0] + "  ", options: { bold: true, color: opts.headColor || MAROON, bullet: { code: "25CF", indent: 18 } } });
      runs.push({ text: it[1], options: { color: opts.color || SLATE, breakLine: !isLast, paraSpaceAfter: 10 } });
    } else {
      runs.push({ text: it, options: { bullet: { code: "25CF", indent: 18 }, color: opts.color || SLATE, breakLine: !isLast, paraSpaceAfter: 10 } });
    }
  });
  s.addText(runs, {
    x, y, w, h, fontFace: BODY_FONT, fontSize: opts.size || 13, valign: "top", isTextBox: true,
  });
}

// =============================================================
// SLIDE 1 — COVER
// =============================================================
{
  const s = newSlide(MAROON);
  s.addText("FIELD SERVICE PLATFORM", {
    x: 0.7, y: 0.6, w: 8, h: 0.4, fontFace: BODY_FONT, fontSize: 13, bold: true, color: GOLD, charSpacing: 3, isTextBox: true,
  });
  s.addText("Proof of Execution untuk Deployment Konten TV", {
    x: 0.7, y: 2.7, w: 11.5, h: 1.6, fontFace: HEAD_FONT, fontSize: 40, bold: true, color: WHITE, isTextBox: true,
  });
  s.addText("Dari rencana sampai bukti terverifikasi di lapangan — semua pihak melihat kondisi yang sama, kapan saja.", {
    x: 0.7, y: 4.35, w: 9.5, h: 0.7, fontFace: BODY_FONT, fontSize: 15, color: "F0D8CB", isTextBox: true,
  });
  const chips = ["RENCANAKAN", "TUGASKAN", "KERJAKAN", "BUKTIKAN", "REVIEW", "TUTUP"];
  let cx = 0.7;
  chips.forEach((c) => {
    const w = 0.115 * c.length + 0.46;
    s.addShape(pres.ShapeType.roundRect, {
      x: cx, y: 5.55, w, h: 0.5, rectRadius: 0.5, fill: { color: MAROON_DARK }, line: { type: "none" },
    });
    s.addText(c, { x: cx, y: 5.55, w, h: 0.5, align: "center", valign: "middle", fontFace: BODY_FONT, fontSize: 10.5, bold: true, color: WHITE, isTextBox: true });
    cx += w + 0.14;
  });
  s.addText("Presentasi Tim & Client · 2026", {
    x: 0.7, y: SH - 0.75, w: 6, h: 0.35, fontFace: BODY_FONT, fontSize: 11, color: "D9A98F", isTextBox: true,
  });
}

// =============================================================
// SLIDE 2 — Apa yang diselesaikan
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Pengantar", "Apa yang Platform Ini Selesaikan?");
  const cards = [
    ["A", "Ribuan Titik TV", "Konten dipasang PIC di banyak gedung dan wilayah, tiap akhir pekan.", MAROON],
    ["B", "Bukti, Bukan Klaim", "GPS check-in/out dan foto per TV membuktikan pekerjaan benar dilakukan.", GOLD],
    ["C", "Client Memutuskan Sendiri", "Client melihat hasil apa adanya dan memutuskan, dengan alasan tercatat.", GREEN],
    ["D", "Semua Tercatat", "Setiap perubahan penting masuk jejak audit yang bisa ditelusuri.", MAROON_DARK],
  ];
  const cw = 2.86, ch = 4.5, gap = 0.22, y0 = 1.85;
  let x = 0.6;
  cards.forEach(([letter, h1, desc, color]) => {
    s.addShape(pres.ShapeType.roundRect, { x, y: y0, w: cw, h: ch, rectRadius: 0.05, fill: { color: PANEL }, line: { type: "none" } });
    iconCircle(s, x + 0.28, y0 + 0.35, 0.7, color, letter);
    s.addText(h1, { x: x + 0.28, y: y0 + 1.3, w: cw - 0.56, h: 0.7, fontFace: HEAD_FONT, fontSize: 15.5, bold: true, color: INK, isTextBox: true });
    s.addText(desc, { x: x + 0.28, y: y0 + 2.0, w: cw - 0.56, h: 2.0, fontFace: BODY_FONT, fontSize: 11.5, color: SLATE, isTextBox: true, valign: "top" });
    x += cw + gap;
  });
  caption(s, 0.6, SH - 0.5, 10, "Sebelumnya: siapa mengerjakan apa dan buktinya seperti apa dicek manual lewat WhatsApp / Excel.");
  pageNum(s, 2);
}

// =============================================================
// SLIDE 3 — Alur kerja 6 langkah
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Cara Kerja", "Satu Alur, Enam Langkah");
  const steps = [
    ["1", "Rencanakan", "Admin membuat Siklus Weekend & memilih konten", MAROON],
    ["2", "Tugaskan", "PIC ditugaskan ke wilayah / gedung", GOLD],
    ["3", "Kerjakan", "PIC check-in GPS, isi checklist per TV", MAROON],
    ["4", "Buktikan", "Foto bukti tiap TV + check-out GPS", GOLD],
    ["5", "Review", "Client memeriksa & memutuskan per TV", GREEN],
    ["6", "Tutup", "Siklus ditutup, hasil tersimpan permanen", SLATE],
  ];
  const n = steps.length, marginX = 0.6, gap = 0.18;
  const bw = (SW - marginX * 2 - gap * (n - 1)) / n, bh = 2.9, y0 = 1.95;
  let x = marginX;
  steps.forEach(([num, h1, desc, color], i) => {
    s.addShape(pres.ShapeType.roundRect, { x, y: y0, w: bw, h: bh, rectRadius: 0.06, fill: { color: PANEL }, line: { type: "none" } });
    s.addShape(pres.ShapeType.roundRect, { x, y: y0, w: bw, h: 0.09, rectRadius: 0, fill: { color }, line: { type: "none" } });
    iconCircle(s, x + 0.16, y0 + 0.3, 0.55, color, num, WHITE);
    s.addText(h1, { x: x + 0.16, y: y0 + 1.0, w: bw - 0.32, h: 0.4, fontFace: HEAD_FONT, fontSize: 14, bold: true, color: INK, isTextBox: true });
    s.addText(desc, { x: x + 0.16, y: y0 + 1.45, w: bw - 0.32, h: 1.35, fontFace: BODY_FONT, fontSize: 10, color: SLATE, isTextBox: true, valign: "top" });
    x += bw + gap;
  });
  s.addShape(pres.ShapeType.roundRect, { x: 2.2, y: 5.35, w: 8.9, h: 1.15, rectRadius: 0.06, fill: { color: MAROON }, line: { type: "none" } });
  s.addText([
    { text: "Contoh siklus berjalan saat ini — Demo Cycle, September 2026\n", options: { fontSize: 10, bold: true, color: "F0D8CB" } },
    { text: "10 TV · 3 gedung · 2 wilayah  →  4 selesai · 1 gagal · 1 perlu diulang · 3 disetujui client (40%)", options: { fontSize: 13.5, bold: true, color: WHITE } },
  ], { x: 2.5, y: 5.5, w: 8.3, h: 0.85, fontFace: BODY_FONT, valign: "middle", isTextBox: true, lineSpacing: 20 });
  pageNum(s, 3);
}

// =============================================================
// SLIDE 4 — Peran pengguna
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Pengguna", "Empat Peran, Empat Sudut Pandang");
  const roles = [
    ["A", "Admin", "Kontrol penuh platform", ["Buat & tutup siklus weekend", "Kelola wilayah, gedung, titik TV & konten", "Setujui pembersihan data", "Lihat jejak audit seluruh sistem"], MAROON],
    ["S", "Supervisor", "Menjalankan operasi harian", ["Tugaskan PIC ke wilayah / gedung", "Aktifkan siklus & buat daftar pekerjaan", "Kirim siklus ke review client", "Pantau dashboard operasional penuh"], GOLD],
    ["T", "Technician (PIC)", "Kerja lapangan", ["Lihat tugas hari ini saja", "Check-in / out GPS di lokasi tugas", "Isi checklist & foto tiap TV", "Terima notifikasi bila ada revisi"], MAROON_DARK],
    ["C", "Client (View)", "Memeriksa hasil", ["Lihat progres siklus yang direview", "Setujui atau minta ulang per TV", "Sertakan alasan tiap keputusan", "Tidak bisa mengubah data operasional"], GREEN],
  ];
  const cw = 2.98, ch = 4.65, gap = 0.16, y0 = 1.9;
  let x = 0.6;
  roles.forEach(([letter, name, sub, items, color]) => {
    s.addShape(pres.ShapeType.roundRect, { x, y: y0, w: cw, h: ch, rectRadius: 0.05, fill: { color: PAPER }, line: { color: LINE, width: 1 } });
    iconCircle(s, x + 0.24, y0 + 0.28, 0.62, color, letter);
    s.addText(name, { x: x + 1.0, y: y0 + 0.28, w: cw - 1.2, h: 0.35, fontFace: HEAD_FONT, fontSize: 14.5, bold: true, color: INK, isTextBox: true });
    s.addText(sub, { x: x + 1.0, y: y0 + 0.6, w: cw - 1.2, h: 0.3, fontFace: BODY_FONT, fontSize: 9.5, italic: true, color: MUTED, isTextBox: true });
    bulletList(s, x + 0.24, y0 + 1.15, cw - 0.48, ch - 1.3, items, { size: 10.3, headColor: color, color: SLATE });
    x += cw + gap;
  });
  pageNum(s, 4);
}

// =============================================================
// SLIDE 5 — DASHBOARD (real screenshot)
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Menu · Dashboard", "Ruang Kontrol Operasional");
  shot(s, "desktop-dashboard.png", 0.6, 1.75, 8.55, 4.05);
  realBadge(s, 0.6, 5.95);
  bulletList(s, 9.45, 1.85, 3.3, 4.6, [
    ["10 Total TV", "3 gedung · 2 wilayah dalam satu siklus berjalan"],
    ["40% Progres", "4 dari 10 TV benar-benar terpasang minggu ini"],
    ["Penyebab Kegagalan", "Ditampilkan langsung — bukan disembunyikan di laporan terpisah"],
    ["Progres per Wilayah", "Bandung vs Jakarta dibandingkan berdampingan"],
  ], { size: 11.5 });
  pageNum(s, 5);
}

// =============================================================
// SLIDE 6 — SIKLUS & PETA (real screenshots)
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Menu · Siklus & Riwayat", "Siklus Weekend dan Peta Sebaran Gedung");
  shot(s, "desktop-siklus.png", 0.6, 1.75, 7.5, 4.75);
  realBadge(s, 0.6, 6.6);
  shot(s, "desktop-peta-popup.png", 8.35, 1.75, 4.4, 2.85);
  s.addText("Peta full-layar saat dibuka — pin menunjukkan jumlah TV per gedung, warna menandakan status pekerjaan.", {
    x: 8.35, y: 4.7, w: 4.4, h: 0.9, fontFace: BODY_FONT, fontSize: 10.5, color: SLATE, isTextBox: true, valign: "top",
  });
  s.addText("Peta ditumpuk penuh-lebar di bawah daftar siklus, tidak lagi dijepit jadi kolom sempit di layar kecil.", {
    x: 8.35, y: 5.9, w: 4.4, h: 0.9, fontFace: BODY_FONT, fontSize: 10.5, italic: true, color: MUTED, isTextBox: true, valign: "top",
  });
  pageNum(s, 6);
}

// =============================================================
// SLIDE 7 — LOCATIONS & CONTENT (real screenshots)
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Menu · Locations & Content", "Data Induk: Gedung, Titik TV, dan Konten");
  shot(s, "desktop-locations.png", 0.6, 1.75, 6.0, 2.85);
  caption(s, 0.6, 4.68, 6.0, "Locations — cakupan PIC, titik TV per wilayah, ringkasan per wilayah.");
  shot(s, "desktop-content.png", 6.9, 1.75, 5.85, 2.85);
  caption(s, 6.9, 4.68, 5.85, "Content — versi tersimpan otomatis (v1, v2, ...), tidak pernah menimpa.");
  bulletList(s, 0.6, 5.25, 12.1, 1.9, [
    ["Cakupan PIC", "0 lokasi tanpa PIC — setiap gedung punya penanggung jawab yang jelas."],
    ["Content Period", "Terpisah dari tanggal pemasangan aktual, untuk laporan ke client / marcom."],
  ], { size: 12 });
  pageNum(s, 7);
}

// =============================================================
// SLIDE 8 — REVIEWS (real screenshot)
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Menu · Reviews", "Client Memutuskan, Bukan Sekadar Melihat");
  shot(s, "desktop-reviews.png", 0.6, 1.75, 8.55, 4.85);
  realBadge(s, 0.6, 6.75);
  bulletList(s, 9.45, 1.85, 3.3, 4.9, [
    ["3 Sudah Disetujui", "Keputusan client tercatat per gedung"],
    ["Wilayah Perlu Perhatian", "Diurutkan dari progres paling rendah"],
    ["Klik untuk detail", "Foto bukti, PIC, dan waktu kerja per TV"],
    ["Setujui / Minta Ulang", "Setiap keputusan wajib alasan bila menolak"],
  ], { size: 11.5 });
  pageNum(s, 8);
}

// =============================================================
// SLIDE 9 — PERAN & AKSES (real screenshot)
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Admin Panel", "Peran & Akses: Peta Bacaan, Bukan Formulir");
  shot(s, "desktop-peran-akses-readonly.png", 0.6, 1.75, 8.55, 4.85);
  realBadge(s, 0.6, 6.75);
  bulletList(s, 9.45, 1.85, 3.3, 4.9, [
    ["Dijaga Database", "Kemampuan tiap peran ditentukan RLS & fungsi, bukan tampilan ini"],
    ["Tidak Bisa Dicentang", "Halaman ini murni referensi — mencegah admin salah kira bisa mengubah izin dari sini"],
    ["5 Peran Terdefinisi", "Admin, Supervisor, User, Technician, View/Client"],
  ], { size: 11.5 });
  pageNum(s, 9);
}

// =============================================================
// SLIDE 10 — Technician workflow (diagram, not screenshot)
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Menu · Tugas Hari Ini (PIC Lapangan)", "Alur Kerja Technician — Dibuat Sesederhana Mungkin");
  caption(s, 0.6, 1.35, 11, "PIC hanya melihat tugas miliknya sendiri hari itu — tiap layar hanya punya satu tombol besar.");
  const steps = [
    ["1", "Buka Aplikasi", "Login sekali, langsung melihat daftar lokasi tugas hari ini."],
    ["2", "Pilih Lokasi", "Ketuk salah satu kartu gedung yang ditugaskan."],
    ["3", "Check-In", "Tekan tombol besar Check-in — GPS terbaca otomatis."],
    ["4", "Isi Checklist TV", "Untuk tiap TV: tandai Selesai atau Gagal."],
    ["5", "Ambil Foto", "Ketuk area kamera besar — kamera HP terbuka sendiri."],
    ["6", "Check-Out", "Tekan Check-out — TV belum selesai wajib diberi alasan."],
  ];
  const cols = 3, gapx = 0.18, gapy = 0.18, x0 = 0.6, y0 = 1.95;
  const cw = (SW - x0 * 2 - gapx * (cols - 1)) / cols, ch = 2.1;
  const colors = [MAROON, GOLD, MAROON_DARK, MAROON, GOLD, MAROON_DARK];
  steps.forEach(([num, h1, desc], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = x0 + col * (cw + gapx), y = y0 + row * (ch + gapy);
    s.addShape(pres.ShapeType.roundRect, { x, y, w: cw, h: ch, rectRadius: 0.06, fill: { color: PANEL }, line: { type: "none" } });
    iconCircle(s, x + 0.18, y + 0.22, 0.5, colors[i], num, WHITE);
    s.addText(h1, { x: x + 0.85, y: y + 0.2, w: cw - 1.0, h: 0.55, fontFace: HEAD_FONT, fontSize: 13, bold: true, color: INK, isTextBox: true, valign: "middle" });
    s.addText(desc, { x: x + 0.18, y: y + 0.85, w: cw - 0.36, h: ch - 1.0, fontFace: BODY_FONT, fontSize: 10.5, color: SLATE, isTextBox: true, valign: "top" });
  });
  s.addText("Setelah Check-out, pekerjaan otomatis terkirim untuk direview — PIC tidak perlu lapor manual ke siapa pun.", {
    x: 0.6, y: 6.55, w: 12.1, h: 0.5, fontFace: BODY_FONT, fontSize: 12.5, bold: true, color: GREEN, align: "center", isTextBox: true,
  });
  pageNum(s, 10);
}

// =============================================================
// SLIDE 11 — MOBILE real screenshots
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Responsif", "Tampilan Mobile — Diambil Langsung dari Aplikasi");
  const files = [
    ["mobile-teknisi-home.jpeg", "Tugas Hari Ini (Technician)", "Kartu tugas + tombol Checklist TV / Check-out"],
    ["mobile-teknisi-checkout.jpeg", "Proses Check-Out", "Alasan wajib diisi bila belum semua TV selesai"],
    ["mobile-installer-dashboard.jpeg", "Dashboard (akun Installer)", "Tampil kosong bila belum ada tugas ditugaskan"],
  ];
  const pw = 2.55, ph = 5.53, gap = 0.55, x0 = 0.9, y0 = 1.55;
  const bezel = 0.16; // >= corner radius below, so the image's square corners stay hidden behind the bezel
  files.forEach(([file, cap1, cap2], i) => {
    const x = x0 + i * (pw + gap);
    s.addShape(pres.ShapeType.roundRect, { x: x - bezel, y: y0 - bezel, w: pw + bezel * 2, h: ph + bezel * 2, rectRadius: 0.14,
      fill: { color: INK }, line: { type: "none" }, shadow: { type: "outer", color: "1B1F27", opacity: 0.3, blur: 12, offset: 4, angle: 90 } });
    s.addImage({ path: img(file), x, y: y0, w: pw, h: ph, sizing: { type: "cover", w: pw, h: ph } });
    s.addText(cap1, { x: x - 0.15, y: y0 + ph + 0.18, w: pw + 0.3, h: 0.3, align: "center", fontFace: BODY_FONT, fontSize: 11.5, bold: true, color: INK, isTextBox: true });
    s.addText(cap2, { x: x - 0.15, y: y0 + ph + 0.48, w: pw + 0.3, h: 0.5, align: "center", fontFace: BODY_FONT, fontSize: 9.5, color: MUTED, isTextBox: true });
  });
  realBadge(s, SW - 2.5, 1.15);
  pageNum(s, 11);
}

// =============================================================
// SLIDE 12 — Security & audit
// =============================================================
{
  const s = newSlide(PAPER);
  title(s, "Keamanan", "Setiap Akses Dijaga, Setiap Perubahan Tercatat");
  const items = [
    ["✓", "Akses per Peran (RLS)", "Aturan siapa-boleh-apa dijaga langsung di database, bukan di tampilan.", MAROON],
    ["✓", "GPS Bukan Sekadar Klaim", "Check-in/out divalidasi jarak dari titik gedung terdaftar (radius 100m).", GOLD],
    ["✓", "Foto Bukti Privat", "Tersimpan di storage privat, dibuka lewat tautan sementara.", MAROON_DARK],
    ["✓", "Jejak Audit Admin-Only", "Siapa mengubah apa dan kapan — hanya Admin yang bisa melihat.", MAROON],
    ["✓", "Notifikasi Otomatis", "Kabar penting muncul sendiri, tidak menunggu dicek manual.", GOLD],
    ["✓", "Pembersihan Data Terkontrol", "Foto lama dihapus hanya setelah disetujui admin.", MAROON_DARK],
  ];
  const cw = 3.9, ch = 2.15, x0 = 0.6, y0 = 1.85, gapx = 0.18, gapy = 0.18;
  items.forEach(([glyph, h1, desc, color], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = x0 + col * (cw + gapx), y = y0 + row * (ch + gapy);
    s.addShape(pres.ShapeType.roundRect, { x, y, w: cw, h: ch, rectRadius: 0.06, fill: { color: PANEL }, line: { type: "none" } });
    iconCircle(s, x + 0.22, y + 0.22, 0.55, color, glyph);
    s.addText(h1, { x: x + 0.22, y: y + 0.88, w: cw - 0.44, h: 0.45, fontFace: HEAD_FONT, fontSize: 12.5, bold: true, color: INK, isTextBox: true });
    s.addText(desc, { x: x + 0.22, y: y + 1.32, w: cw - 0.44, h: 0.75, fontFace: BODY_FONT, fontSize: 10, color: SLATE, isTextBox: true, valign: "top" });
  });
  pageNum(s, 12);
}

// =============================================================
// SLIDE 13 — Closing
// =============================================================
{
  const s = newSlide(MAROON);
  s.addText("Satu Platform,\nOperasional yang Bisa Dipercaya", {
    x: 0.7, y: 1.9, w: 11.5, h: 1.7, fontFace: HEAD_FONT, fontSize: 34, bold: true, color: WHITE, isTextBox: true,
  });
  s.addText("Dari rencana sampai bukti terverifikasi — semua pihak melihat kondisi yang sama, kapan saja.", {
    x: 0.7, y: 3.55, w: 10, h: 0.6, fontFace: BODY_FONT, fontSize: 15, color: "F0D8CB", isTextBox: true,
  });
  const recap = ["Bukti nyata, bukan klaim", "Tiap peran, tampilan yang tepat", "Aman & tercatat", "Mudah dipakai siapa saja"];
  let cx = 0.7;
  recap.forEach((item) => {
    const w = 0.1 * item.length + 0.6;
    s.addShape(pres.ShapeType.roundRect, { x: cx, y: 4.55, w, h: 0.55, rectRadius: 0.5, fill: { color: MAROON_DARK }, line: { type: "none" } });
    s.addText(item, { x: cx, y: 4.55, w, h: 0.55, align: "center", valign: "middle", fontFace: BODY_FONT, fontSize: 12, bold: true, color: WHITE, isTextBox: true });
    cx += w + 0.15;
  });
  s.addText("Terima kasih — siap untuk pertanyaan dan diskusi.", {
    x: 0.7, y: 6.2, w: 8, h: 0.5, fontFace: BODY_FONT, fontSize: 14, italic: true, color: WHITE, isTextBox: true,
  });
  s.addText("Field Service Platform · IndoVisual Professional Tools", {
    x: 0.7, y: 6.75, w: 8, h: 0.4, fontFace: BODY_FONT, fontSize: 10.5, color: "D9A98F", isTextBox: true,
  });
}

const OUT = path.join(__dirname, "..", "..", "Field-Service-Platform-Presentasi.pptx");
pres.writeFile({ fileName: OUT }).then(() => console.log("Saved:", OUT));
