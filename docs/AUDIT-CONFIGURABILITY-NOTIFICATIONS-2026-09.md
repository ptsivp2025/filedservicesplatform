# Audit — Configurability, Notifications, Multi-Tenancy & Platform Gaps

Ditulis sebagai jawaban langsung atas pertanyaan: *"apa yang perlu dikembangkan",
kenapa background image tidak konsisten, kenapa isi menu role tidak beda-beda,
kenapa menu tidak bisa diatur tanpa ubah kode, dan Integrations itu untuk apa."*
Semua temuan di bawah dikonfirmasi dengan membaca kode sungguhan, bukan tebakan.

---

## 1. Jawaban langsung ke 4 pertanyaan

### 1.1 "Dashboard image harus ubah semua menu, bukan cuma dashboard"

**Benar, ini bug scope.** `merek.gambarLatarDasbor` (background yang diatur di
Admin Panel → Dashboard Setting) hanya dipakai di `app/dashboard/page.tsx` —
layar login, panel dashboard utama, dan bingkai di sekitar iframe. Begitu masuk
ke modul sungguhan (`app/field-service/page.tsx`, `app/teknisi/page.tsx`),
keduanya adalah HALAMAN TERPISAH yang dimuat lewat `<iframe>`, dan keduanya
memakai `bg-slate-50` yang ditulis literal di kode — sama sekali tidak membaca
`merek`. Jadi begitu sidebar diklik ke Project/Lokasi/Assign PIC/Tugas Hari Ini,
background kembali ke abu-abu polos.

**Perbaikan**: kedua halaman modul perlu memuat pengaturan merek yang sama
(`lib/merek.ts` sudah punya fungsi baca, tinggal dipakai) dan menerapkan
`backgroundImage` yang sama pada root div masing-masing.

### 1.2 "Tugas Hari Ini isinya harus beda per role"

**Benar, ini belum ada.** Saat ini hanya ada SATU halaman "Tugas Hari Ini"
(`app/teknisi/page.tsx`), murni untuk Technician (daftar assignment pribadi +
check-in/check-out). Admin/Supervisor tidak punya versi mereka sendiri dari
konsep "apa yang relevan buat saya hari ini" — yang mereka dapat cuma tab
Execution (`field-service?tab=execution`), yaitu daftar mentah semua instance,
bukan ringkasan actionable ("N laporan menunggu approval", "M lokasi belum
check-in hari ini", "K revisi yang masih menunggu Anda"). Client role bahkan
tidak dapat sidebar item apa pun bernama Tugas Hari Ini — cuma "Client Review".

**Perbaikan yang masuk akal**: satu halaman/menu "Tugas Hari Ini" yang isinya
di-switch berdasarkan `fs_role`:
- `FIELD_PIC` → yang sudah ada sekarang (assignment + check-in/out).
- `PROVIDER_ADMIN/SUPERVISOR` → ringkasan actionable: instance SUBMITTED
  menunggu ditandai selesai, COMPLETED menunggu dikirim ke client, laporan
  harian menunggu approval, lokasi yang belum check-in padahal sudah lewat jam
  tertentu.
- `CLIENT_ADMIN/MANAGER/VIEWER` → instance WAITING_REVIEW yang menunggu
  keputusan mereka (ini sebenarnya sudah ada di tab Client Review, tinggal
  diberi nama/framing "Tugas Hari Ini" yang konsisten).

### 1.3 "Menu tiap Role harus editable, jangan tersimpan di kode"

**Benar, dan ini bagian yang paling besar.** Sekarang menu default per role
ditentukan oleh fungsi `menusForRole()` dan `ROLE_DEFS` di
`app/dashboard/_components/modal-akun.tsx` — hardcoded di kode, admin cuma
bisa mencentang `allowed_menus` PER USER satu-satu lewat Admin Panel, tidak ada
tempat mengubah "menu bawaan untuk role Technician itu apa saja" tanpa saya
mengubah kode dan mengirim ulang build.

Supaya betul-betul configurable dan BUKAN cuma setelan dummy yang keliatan bisa
diklik tapi tidak dibaca aplikasi, ini perlu:
1. Tabel baru `fs_role_menu_defaults` (role, menu_key, enabled) di Supabase —
   satu-satunya sumber kebenaran untuk "menu bawaan role X", dibaca oleh
   `menusForRole()` (ganti dari array hardcoded ke query Supabase).
2. UI di Admin Panel untuk mengedit tabel itu (centang per role, bukan per
   user) — ini yang akan dipakai admin sehari-hari.
3. Existing `users.allowed_menus` TETAP ada, sebagai override per-user di atas
   default role (persis yang sudah jalan sekarang) — tidak diganti, cuma
   sumber DEFAULT-nya yang pindah dari kode ke tabel.
4. **Wajib dites end-to-end sebelum dianggap selesai**: buat 1 baris di tabel,
   buat user baru dengan role itu, pastikan `allowed_menus` yang ter-generate
   memang ikut baris itu, bukan fallback ke array lama — supaya tidak jadi
   "setelan dummy" seperti yang diwanti-wanti.

### 1.4 "Integrations itu untuk apa?"

Wajar bingung — isinya BUKAN untuk Field Service. `lib/notifikasi/katalog.ts`
cuma mendaftar 3 event, semuanya peninggalan sistem akun lama:
`user_registered` (akun baru menunggu approval), `account_created` (WA
selamat datang), `password_reset` (OTP WhatsApp). Tidak ada satu pun event
Field Service (PIC baru di-assign, revisi diminta, laporan harian ditolak,
content period akan mulai) yang terdaftar di sini — jadi menyalakan/mematikan
kanal WhatsApp/Telegram di panel ini TIDAK mempengaruhi apa pun yang terjadi di
modul Field Service. Ini murni pengaturan notifikasi akun (approval, welcome
message, reset password), warisan dari sebelum repo ini jadi Field Service
Platform, dan belum ada yang menyambungkannya ke event Field Service yang
sebenarnya.

---

## 2. Audit menyeluruh — apa yang kurang

Diurutkan dari yang paling berisiko.

### 🔴 CRITICAL — Client role tidak dibatasi per project (kebocoran data antar klien)

`fs_is_client_reviewer()` dan `fs_is_client_viewer()`
(`supabase/migrations/005_field_service_functions.sql`) HANYA memeriksa klaim
JWT `fs_role` (apakah CLIENT_ADMIN/MANAGER/VIEWER) — tidak ada pengecekan
"klien ini terdaftar untuk project mana". Artinya: kalau platform ini dipakai
lebih dari satu klien sekaligus (skema `fs_projects.client_name` jelas dibuat
untuk itu), akun CLIENT_MANAGER milik Klien A bisa melihat DAN me-review data
project Klien B — termasuk foto evidence dan lokasi. Ini bukan soal
"kurang fitur", ini kebocoran data antar klien yang nyata begitu ada >1 klien
aktif. Perlu tabel `fs_client_project_access` (user_id, project_id) dan semua
fungsi/RLS client-facing ditambah `AND EXISTS (... akses ke project ini ...)`.

### 🟠 HIGH — Tidak ada kepastian "siapa yang tidak check-in hari ini"

`fs_ensure_today_instance()` membuat baris `fs_execution_instances` HANYA saat
technician membuka halaman Tugas Hari Ini pada hari itu (lazy, on-demand).
Kalau technician tidak pernah membuka aplikasi hari itu, TIDAK ADA baris sama
sekali untuk hari itu — bukan status NOT_STARTED, benar-benar tidak ada.
Akibatnya "Deployment Completion" dan tab Execution tidak bisa membedakan
"tidak dijadwalkan" dari "dijadwalkan tapi bolos". Tidak ada cron/scheduled
job yang secara proaktif membuat instance untuk semua assignment aktif jam 00:00,
juga tidak ada reminder push kalau jam sudah siang tapi belum check-in.

### 🟠 HIGH — Notifikasi Field Service belum ada satu pun yang tersambung

Lihat §1.4. Tidak ada WA/Telegram/in-app yang otomatis terkirim untuk:
PIC baru di-assign ke lokasi, client meminta revisi, laporan harian ditolak
provider, atau content period akan segera mulai/berakhir. Semua perubahan
status hanya terlihat kalau yang bersangkutan membuka aplikasi sendiri.

### 🟠 HIGH — Tidak ada bulk import

Untuk skala "1000 titik" yang disebut sebelumnya: Project/Area/Lokasi/
Execution Point/Assign PIC semuanya cuma bisa dibuat SATU-SATU lewat form.
Tidak ada import CSV/Excel. Rollout ke ratusan lokasi sekaligus (onboarding
klien baru) akan sangat lambat secara manual.

### 🟡 MEDIUM — Tidak ada export/laporan untuk keperluan klien atau kepatuhan

Daily Report, riwayat execution, dan evidence GPS hanya bisa dilihat di layar
(dengan signed URL yang kedaluwarsa 1 jam). Tidak ada export CSV/PDF untuk
dikirim ke klien sebagai bukti/laporan resmi, atau untuk diarsipkan di luar
platform.

### 🟡 MEDIUM — Tidak ada audit trail umum

`fs_reviews` mencatat keputusan client (VERIFIED/REVISION_REQUIRED) dan itu
bagus, tapi tidak ada log umum "siapa mengubah koordinat lokasi X jam berapa",
"siapa menonaktifkan PIC assignment Y". Untuk platform yang fungsinya
"proof of execution", riwayat perubahan data master sendiri juga sebaiknya
bisa diaudit.

### 🟡 MEDIUM — Tidak ada dukungan offline untuk Technician

Check-in/check-out dan upload evidence semuanya butuh koneksi hidup saat itu
juga (langsung panggil Supabase). Technician yang bertugas di basement/gudang
dengan sinyal buruk berisiko kehilangan pekerjaan (foto gagal upload, GPS
gagal, tidak ada antrian retry/offline queue).

### 🟢 LOW — Tidak ada automated test sama sekali

Tidak ditemukan satu pun file test di repo ini (`*.test.*` di luar
`node_modules`). Validasi sejauh ini murni `tsc --noEmit` + `npm run build` +
pengecekan manual RLS lewat Supabase MCP. Untuk aturan RLS multi-role yang
serumit ini (5 role Field Service + status machine 7 state), regresi diam-diam
lewat perubahan kecil cukup mungkin terjadi tanpa test.

### 🟢 LOW — Recurring Schedule generator belum ada (sudah diketahui sejak awal)

Sudah tercatat di komentar kode sebagai "Phase 4 lanjutan" — assignment PIC
punya `effective_date`/`end_date` sebagai rentang, tapi instance harian tetap
dibuat satu per satu secara on-demand, bukan digenerate di muka untuk seluruh
rentang. Bukan blocker langsung, tapi berkaitan dengan temuan HIGH di atas
soal "siapa yang bolos".

---

## 3. Rekomendasi urutan pengerjaan

Kalau semua mau dikerjakan, urutan yang masuk akal berdasar risiko:

1. **Multi-tenancy client scoping** (CRITICAL — kebocoran data nyata begitu ada >1 klien).
2. **Background image di semua modul** (cepat, dampak terlihat langsung).
3. **Menu per role jadi configurable di database** (permintaan eksplisit, effort sedang-besar: tabel baru + Admin Panel UI + migrasi `menusForRole` dari kode ke query, + END-TO-END test seperti diwanti-wanti, bukan setelan dummy).
4. **"Tugas Hari Ini" per role** (butuh keputusan desain: satu halaman ber-cabang, atau beberapa halaman).
5. Cron proaktif untuk instance harian + notifikasi Field Service ke WA/Telegram.
6. Bulk import, export laporan, audit trail, offline support, automated test — sesuai prioritas bisnis.

Beri tahu saya mana yang mau dikerjakan duluan (bisa lebih dari satu berjalan
paralel kalau memang perlu), supaya saya tidak menebak-nebak scope yang kamu
mau.
