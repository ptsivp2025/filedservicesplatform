# FIELD SERVICE — MASTER PRODUCTION HARDENING & UX REPAIR
## Claude Code Execution Plan — Phase 0 sampai Phase 6

**Product:** Field Service / Proof of Execution  
**Target:** Production-ready platform yang layak dijual sekitar Rp15 juta, di luar biaya Supabase/Vercel  
**Mode:** Existing repository — repair, hardening, refactor terkontrol  
**Critical focus:** GPS security, evidence integrity, UX, CRUD, mobile, performance, Supabase egress/storage

---

# 0. MISI UTAMA

Repository ini sudah memiliki banyak fitur Field Service.

Masalahnya bukan sekadar kekurangan fitur.

Masalah utama yang harus Anda selesaikan adalah:

1. Beberapa fungsi ditempatkan tidak proper.
2. UX antar-menu belum konsisten.
3. Ada kemungkinan GPS spoof/fake GPS.
4. Evidence/foto belum cukup terikat dengan lokasi dan execution session.
5. Technician yang sudah check-in berpotensi pulang lalu tetap upload evidence.
6. Authentication session tidak boleh disamakan dengan execution session.
7. Refresh/filter/chart/export belum konsisten.
8. Beberapa component/page terlalu besar.
9. Query harus dijaga agar tidak membebani Supabase/Vercel Free/Pro secara tidak perlu.
10. Mobile technician harus benar-benar usable.
11. Security harus enforced server-side, bukan hanya frontend.

## PRINCIPLE

> Jangan mengejar jumlah fitur.  
> Pastikan setiap fungsi berada di tempat yang benar, bekerja dengan state yang benar, aman, konsisten, dan efisien.

---

# 1. ATURAN WAJIB UNTUK CLAUDE CODE

## JANGAN

- Jangan melakukan full repository rewrite.
- Jangan langsung mengedit puluhan file tanpa audit.
- Jangan membuat duplicate component.
- Jangan membuat duplicate RPC/function.
- Jangan membuat duplicate database logic.
- Jangan membuat schema baru jika existing schema cukup.
- Jangan melemahkan RLS.
- Jangan mengganti security server-side menjadi client-side.
- Jangan menghapus historical execution/evidence/review.
- Jangan membuat GPS polling setiap beberapa detik.
- Jangan membuat auto-refresh agresif.
- Jangan menggunakan `select *` untuk query baru.
- Jangan menggunakan `limit(10000)` hanya untuk dashboard/chart.
- Jangan melakukan N+1 query.
- Jangan mengambil semua evidence/file bytes untuk list.
- Jangan membuat "anti fake GPS 100%" karena browser/PWA tidak dapat menjamin itu.
- Jangan mengubah behavior PIC multi-location menjadi one-location-only.
- Jangan mengubah workflow yang sudah benar hanya demi style.
- Jangan menambah chart hanya agar dashboard terlihat ramai.

## WAJIB

Sebelum mengubah sesuatu:

1. Cari existing implementation.
2. Tentukan apakah masalahnya:
   - missing feature;
   - broken feature;
   - wrong UX placement;
   - duplicated feature;
   - inefficient query;
   - security weakness;
   - architectural problem.
3. Reuse existing components/functions/RPC/RLS.
4. Prefer simplify/delete unnecessary code daripada menambah code.
5. Setelah perubahan, architecture harus sama atau lebih sederhana.
6. Build/typecheck/lint setiap phase.
7. Audit perubahan terhadap egress/storage.
8. Jangan melanjutkan phase berikutnya tanpa STOP dan report.

---

# 2. DEVELOPMENT EFFICIENCY

Jangan membaca seluruh repository berulang kali.

Untuk setiap phase:

```text
Identify relevant files
↓
Read relevant files
↓
Build dependency map
↓
Plan
↓
Modify minimum required files
↓
Validate
↓
Report
↓
STOP
```

Jangan melakukan broad rewrite kecuali ada blocker security/architecture yang benar-benar membutuhkan.

---

# 3. PRODUCT INFORMATION ARCHITECTURE TARGET

Field Service harus terasa sebagai satu produk:

```text
FIELD SERVICE
│
├── Overview
│
├── Projects
│
├── Locations
│   ├── Area
│   ├── Location
│   └── Execution Point
│
├── PIC Assignment
│
├── Content
│
├── Schedule
│
├── Execution / Monitoring
│
└── Client Review
```

Jangan membuat menu baru jika fungsi sebenarnya sudah tersedia di menu lain.

Jangan membuat user menebak:

- Project dikelola di mana?
- Location di mana?
- Execution Point di mana?
- PIC Assignment di mana?
- Content di mana?
- Execution di mana?
- Review di mana?

Sidebar dan internal navigation harus memberikan context yang jelas.

---

# PHASE 0 — FULL AUDIT ONLY

## TUJUAN

Sebelum coding, lakukan audit menyeluruh.

JANGAN memperbaiki code pada phase ini kecuali diperlukan untuk membaca/build.

## Audit:

### A. Architecture

Cari:

- page terlalu besar;
- component terlalu besar;
- duplicate logic;
- duplicate query;
- duplicate modal;
- duplicate filter;
- duplicate refresh;
- domain logic bercampur dengan presentation;
- server/client boundary yang tidak tepat.

### B. Database

Audit:

- seluruh tabel `fs_*`;
- FK;
- indexes;
- RPC/function;
- RLS;
- storage policy;
- status transitions;
- audit trail;
- execution/session/evidence relationship.

### C. Security

Cari:

- evidence insert;
- evidence storage upload;
- check-in;
- check-out;
- GPS;
- assignment;
- execution status;
- client-side authorization;
- session reuse;
- direct Supabase access;
- tampering terhadap IDs.

### D. UX

Audit:

- navigation;
- header;
- nested scroll;
- refresh;
- filters;
- search;
- summary;
- charts;
- tables;
- modals;
- confirmation;
- empty state;
- error state;
- loading state.

### E. Performance

Cari:

- `select *`;
- large limits;
- N+1;
- repeated fetch;
- unnecessary users query;
- unnecessary locations query;
- chart queries;
- polling;
- realtime;
- full evidence download;
- export behavior.

### F. Mobile

Audit:

- 360x800;
- 390x844;
- 768x1024;
- technician workflow;
- browser refresh;
- browser close/reopen;
- phone call;
- screen lock;
- bad network.

## REPORT FORMAT

```text
PHASE 0 AUDIT

P0 Critical:
P1 High:
P2 Medium:

Architecture:
Security:
Database:
UX:
Mobile:
Performance:
Egress:
Storage:

Top 10 fixes:
1.
2.
...
10.

Files requiring changes:
...

Database/RPC requiring changes:
...

Risk of current implementation:
...
```

### STOP

Jangan lanjut Phase 1.

---

# PHASE 1 — GPS / EXECUTION / EVIDENCE SECURITY

## OBJECTIVE

Membuat execution menjadi:

# LOCATION-BOUND EXECUTION SESSION

Evidence hanya boleh diterima jika:

```text
Authenticated User
+
Active Assignment
+
Correct Execution
+
Active Session
+
Fresh GPS
+
Valid Accuracy
+
Within Allowed Radius
+
Valid Server Time
+
Valid Execution State
+
Authorized Storage Path
=
ACCEPT
```

## CHECK-IN

Server harus menentukan:

- authenticated user;
- active assignment;
- execution instance;
- execution point;
- authoritative location;
- latitude;
- longitude;
- allowed radius;
- server timestamp;
- session ID;
- session expiry;
- initial GPS event.

Client timestamp tidak boleh menjadi source of truth.

## FRESH GPS

Fresh GPS validation minimal pada:

1. Check-in
2. Start execution
3. Capture evidence
4. Submit execution
5. Check-out

Jangan polling terus-menerus.

## GPS EVENT

Gunakan existing `fs_gps_events` bila cukup.

Event minimal:

- session_id;
- execution_id;
- user_id;
- event_type;
- latitude;
- longitude;
- accuracy;
- server timestamp;
- target location/point;
- distance;
- validation result;
- rejection/anomaly reason.

## SESSION

Lifecycle:

```text
CREATED
→ CHECKED_IN
→ ACTIVE
→ CHECKED_OUT
```

atau:

```text
ACTIVE
→ EXPIRED
```

atau:

```text
ACTIVE
→ INVALIDATED
```

Session tidak boleh hidup selamanya.

Jika repository sudah mempunyai konfigurasi session/schedule, gunakan existing configuration.

Jangan membuat hardcoded value jika existing business configuration tersedia.

## CHECK-OUT

Setelah checkout:

```text
SESSION = CLOSED
```

Evidence baru dengan session tersebut:

```text
REJECT
```

## BROWSER REOPEN

Authentication session ≠ execution session.

Reopen browser tidak boleh otomatis membuat execution aktif lagi.

Server harus memeriksa:

- session;
- expiry;
- current GPS;
- assignment;
- execution status.

## EVIDENCE

Evidence harus terikat:

```text
evidence
→ work_session
→ execution_instance
→ execution_point
→ assigned PIC
```

Server harus memvalidasi semua relationship.

## GALLERY

Jangan percaya EXIF GPS sebagai security proof.

Jika bisnis requirement adalah evidence harus diambil saat execution:

prioritaskan camera capture.

Jika gallery tetap diizinkan:

simpan source:

```text
CAMERA
GALLERY
```

dan jangan menganggap EXIF sebagai authoritative GPS.

## ANTI FAKE GPS

Gunakan defense-in-depth:

- assignment validation;
- fresh GPS;
- accuracy validation;
- distance validation;
- server timestamp;
- session expiry;
- sequential GPS events;
- impossible movement detection;
- execution timing;
- evidence binding.

Jangan mengklaim 100% anti fake GPS pada browser/PWA.

## ATTACK TESTS

Wajib test:

1. Check-in A → photo A → ALLOW.
2. Check-in A → pindah jauh → photo → REJECT.
3. Check-in A → pulang → photo → REJECT.
4. Check-in A → checkout → upload old session → REJECT.
5. Session expired → upload → REJECT.
6. Change execution_id → REJECT.
7. Change session_id → REJECT.
8. Change location_id → REJECT.
9. PIC A mencoba execution PIC B → REJECT.
10. Direct unauthorized storage path → REJECT.

## EGRESS

GPS hanya event-based.

Jangan:

- 1-second polling;
- 5-second polling;
- realtime GPS;
- upload GPS setiap detik.

### STOP setelah Phase 1.

---

# PHASE 2 — UX / INFORMATION ARCHITECTURE

## OBJECTIVE

Hilangkan kesan "AI menaruh fungsi asal-asalan".

Hierarchy target:

```text
Page Header
↓
Context
↓
Filters
↓
Summary
↓
Charts/Insight
↓
Main Worklist
↓
Detail
```

## HEADER

Audit Dashboard → iframe → Field Service.

Target:

```text
ONE PRIMARY SCROLL CONTAINER
```

Header harus sticky tanpa menghasilkan nested scroll yang buruk.

Jangan menggunakan fixed header yang menutupi content.

## NAVIGATION

Pastikan fungsi:

Project
Location
Execution Point
Assignment
Content
Execution
Review

berada pada tempat yang logis.

Tidak boleh duplicate workflow.

## MOBILE

Test:

- 360x800;
- 390x844;
- 768x1024.

Perbaiki:

- horizontal overflow;
- nested scrolling;
- table;
- modal;
- dropdown;
- charts;
- buttons;
- technician actions.

Jika table terlalu lebar:

desktop = table

mobile = card/list.

## VISUAL

Kurangi:

- card berlebihan;
- border berlebihan;
- button tersebar;
- chart dekoratif;
- hierarchy lemah.

### STOP.

---

# PHASE 3 — CRUD / REFRESH / FILTER / CHART

## OBJECTIVE

Setiap menu terasa proper dan konsisten.

Audit:

- Project
- Area
- Location
- Execution Point
- PIC Assignment
- Content
- Schedule
- Execution
- Review

## MASTER DATA PATTERN

Jika relevan:

```text
Search
Filter
Refresh
Create
Edit
Deactivate
Delete
Confirmation
Loading
Error
Empty
Mobile
```

Jangan memaksakan Delete pada historical data.

Gunakan Deactivate/Archive jika data sudah menjadi bagian history.

## REFRESH

Buat shared pattern:

```text
↻ Refresh
Updated 13:25
```

Refresh hanya me-refetch dataset menu tersebut.

Jangan reload:

- dashboard;
- iframe;
- entire application;
- unrelated tables.

## SUMMARY CARD

Jika card merepresentasikan subset data:

```text
Total
Pending
Completed
Verified
Revision
```

maka click harus menjadi filter.

Jika tidak represent subset data, jangan dibuat clickable.

## MINI PIE

`MiniPieChart` sudah memiliki konsep:

```text
activeFilter
onSliceClick
```

Wire chart yang memang cocok sebagai filter.

Click chart:

```text
chart slice
→ filter state
→ list
→ summary
→ charts
→ export
```

## SINGLE FILTER SOURCE

Gunakan satu model:

```ts
interface ExecutionFilters {
  status: string | null;
  locationId: string | null;
  picId: string | null;
  search: string;
  fromDate: string;
  toDate: string;
}
```

Alur:

```text
raw/bounded data
↓
filter state
↓
filtered rows
↓
summary
↓
charts
↓
table
↓
export
```

Jangan membuat summary memakai raw data sementara table memakai filtered data.

## EXPORT

Export harus mengikuti data yang sedang ditampilkan.

Jika layar:

```text
Status = VERIFIED
PIC = Budi
Location = Mall A
```

export harus sesuai filter tersebut.

### STOP.

---

# PHASE 4 — PERFORMANCE / EGRESS / STORAGE

## OBJECTIVE

Membuat platform aman untuk deployment dengan penggunaan Supabase/Vercel yang efisien.

## DILARANG

- `select *`;
- unnecessary `limit(10000)`;
- N+1;
- query per row;
- fetch all users;
- fetch all locations;
- fetch all evidence;
- download image full-size untuk list;
- polling;
- unnecessary realtime;
- duplicate query untuk summary/chart/list.

## TARGET

```text
Bounded query
↓
Shared state
↓
Derived summary
↓
Derived chart
↓
Filtered list
↓
Export only when requested
```

## DASHBOARD

Dashboard initial load jangan menjadi database browser.

Gunakan bounded data.

Contoh:

```text
Recent 20
```

bukan seluruh history.

## CHART

Jangan mengambil ribuan row hanya untuk:

```text
WAITING_REVIEW = 12
VERIFIED = 88
REVISION = 4
```

Gunakan existing aggregate/RPC bila tersedia.

Buat RPC baru hanya jika memang diperlukan.

## USERS

Jangan fetch seluruh `users` jika hanya membutuhkan:

```text
FIELD_PIC
```

Gunakan filtering/bounded search bila memungkinkan.

## EVIDENCE

List:

```text
metadata + thumbnail
```

Detail:

```text
full evidence
```

Jangan download file bytes pada list.

## EXPORT

Export boleh lebih besar daripada list, tetapi hanya:

- filter aktif;
- date range aktif;
- project aktif;
- kolom yang diperlukan.

### EGRESS REPORT

Claude harus melaporkan:

```text
Before:
Initial queries:
Approx data scope:

After:
Initial queries:
Approx data scope:

New storage reads:
New storage writes:
New database writes:

Egress risk:
LOW / MEDIUM / HIGH
```

### STOP.

---

# PHASE 5 — MOBILE TECHNICIAN / SESSION RESILIENCE

## OBJECTIVE

Technician interface harus terasa seperti field application.

Target:

```text
Today's Tasks

Location
Point
Schedule

GPS:
● Verified
Accuracy: 8m

[CHECK IN]

Checklist

[TAKE PHOTO]

Evidence

[SUBMIT]

[CHECK OUT]
```

## MULTI-LOCATION PIC

PIC dapat memiliki:

```text
PIC A
→ Location 1
→ Location 2
→ Location 3
→ ...
→ Location 10
```

Jangan mengubah menjadi one-location-only.

Untuk banyak lokasi:

```text
Project
→ Area
→ Search
→ Select filtered
→ Bulk Assign
```

Jangan menampilkan ribuan checkbox sekaligus tanpa search/filter.

## PHONE CALL / APP SWITCH

Test:

```text
Login
→ Check-in
→ Work
→ Phone call
→ Return
```

State execution tidak boleh rusak.

Test:

- minimize;
- screen lock;
- browser reopen;
- refresh;
- back button;
- network disconnect;
- network reconnect.

## OFFLINE

Offline tidak boleh menjadi security bypass.

Jika local draft digunakan:

```text
Local draft
→ sync
→ server validation
→ ACCEPT / REJECT
```

Bukan:

```text
offline = trusted
```

### STOP.

---

# PHASE 6 — FINAL PRODUCTION SECURITY REGRESSION

## OBJECTIVE

Audit ulang seluruh system setelah semua perubahan.

Berperan sebagai attacker.

## ATTACK MATRIX

### AUTH

- unauthenticated request;
- expired authentication;
- wrong role;
- user ID tampering.

### ASSIGNMENT

- wrong PIC;
- inactive assignment;
- expired assignment;
- wrong location;
- wrong execution point.

### SESSION

- expired session;
- checked-out session;
- reused session;
- changed session ID;
- browser reopen.

### GPS

- outside radius;
- bad accuracy;
- stale GPS;
- impossible movement;
- fake/mock GPS indicators if exposed.

### EVIDENCE

- wrong execution ID;
- wrong session ID;
- wrong location ID;
- gallery upload;
- direct storage upload;
- duplicate upload;
- upload after checkout.

### REVIEW

- unauthorized verify;
- unauthorized revision;
- changing historical review;
- bypass status transition.

### DATABASE

Audit:

- RLS;
- RPC authorization;
- SECURITY DEFINER functions;
- storage policies;
- direct table writes;
- ownership boundaries.

---

# 6. SECURITY PRINCIPLE

Jangan pernah menganggap:

```text
button hidden
=
security
```

Security harus:

```text
UI authorization
+
server authorization
+
RLS
+
RPC validation
+
storage policy
```

---

# 7. GPS SECURITY LIMITATION

Dokumentasikan dengan jujur:

Browser/PWA tidak dapat memberikan jaminan 100% bahwa coordinate berasal dari physical GPS asli.

Maka platform menggunakan:

```text
Assignment
+
Fresh GPS
+
Accuracy
+
Distance
+
Server timestamp
+
Session
+
Movement consistency
+
Evidence binding
+
Audit trail
```

Jangan marketing claim:

> "100% Anti Fake GPS"

Gunakan:

> "Location-validated execution with assignment-based access control."

---

# 8. FINAL PRODUCTION CHECKLIST

Platform dianggap production-ready hanya jika:

## SECURITY

- [ ] Evidence tidak dapat dibuat tanpa valid session.
- [ ] Evidence tidak dapat dibuat setelah checkout.
- [ ] Evidence tidak dapat dibuat setelah session expiry.
- [ ] Evidence membutuhkan fresh GPS.
- [ ] GPS divalidasi server-side.
- [ ] Assignment divalidasi server-side.
- [ ] Execution divalidasi server-side.
- [ ] Storage path protected.
- [ ] RLS tidak dilemahkan.
- [ ] ID tampering ditolak.
- [ ] Historical data protected.
- [ ] Audit trail tersedia.

## UX

- [ ] Header tidak bermasalah dengan nested scroll.
- [ ] Navigation jelas.
- [ ] Semua menu memiliki pattern konsisten.
- [ ] Refresh tersedia.
- [ ] Filter berfungsi.
- [ ] Summary card berfungsi sebagai filter jika relevan.
- [ ] Chart click berfungsi jika relevan.
- [ ] Export mengikuti filter.
- [ ] Empty state jelas.
- [ ] Error state jelas.
- [ ] Loading state jelas.

## MOBILE

- [ ] 360x800
- [ ] 390x844
- [ ] 768x1024
- [ ] no horizontal overflow
- [ ] phone interruption tested
- [ ] browser reopen tested
- [ ] bad network tested
- [ ] multi-location PIC tested

## PERFORMANCE

- [ ] No `select *` baru.
- [ ] No unnecessary huge limits.
- [ ] No N+1.
- [ ] No aggressive polling.
- [ ] No unnecessary realtime.
- [ ] No full evidence download in list.
- [ ] Queries bounded.
- [ ] Export only on demand.
- [ ] Egress risk documented.

---

# 9. DEFINITION OF DONE

`npm run build` PASS SAJA TIDAK CUKUP.

Phase dianggap PASS jika:

```text
Build
+
Typecheck
+
Lint
+
Functional verification
+
Security verification
+
Mobile verification
+
Egress review
```

semuanya pass.

---

# 10. REQUIRED REPORT FORMAT SETIAP PHASE

```text
==================================================
FIELD SERVICE HARDENING REPORT
PHASE X
==================================================

Objective:
...

Files inspected:
...

Files changed:
...

Database changes:
...

RPC changes:
...

RLS changes:
...

Storage changes:
...

Security:
PASS / FAIL

UX:
PASS / FAIL

Mobile:
PASS / FAIL

Performance:
PASS / FAIL

Egress:
LOW / MEDIUM / HIGH

Build:
PASS / FAIL

Typecheck:
PASS / FAIL

Lint:
PASS / FAIL

Tests:
...

Remaining issues:
...

Risk:
LOW / MEDIUM / HIGH

NEXT RECOMMENDED PHASE:
...

STOP.
```

---

# 11. FINAL RULE

Setelah setiap phase:

**STOP.**

Jangan lanjut otomatis ke phase berikutnya.

Jangan melakukan unrelated refactoring.

Jangan menambah fitur hanya karena menemukan ide baru.

Jika menemukan issue di luar phase aktif:

```text
REPORT ONLY
```

dan masukkan:

```text
Remaining Issues
```

Kecuali issue tersebut adalah security blocker yang menyebabkan phase aktif tidak aman.

---

# 12. START COMMAND

Untuk memulai pekerjaan:

```text
Execute PHASE 0 ONLY.

Do not modify production behavior yet.

Audit the repository, database, RPC, RLS, storage, UX, mobile, and egress.

Return the required PHASE 0 report.

STOP after the report.
```

Setelah Phase 0 selesai dan sudah direview:

```text
Execute PHASE 1 ONLY.

Follow the MASTER PRODUCTION HARDENING rules.

STOP after Phase 1 verification and report.
```

Kemudian lanjutkan satu per satu:

```text
Execute PHASE 2 ONLY.
```

```text
Execute PHASE 3 ONLY.
```

```text
Execute PHASE 4 ONLY.
```

```text
Execute PHASE 5 ONLY.
```

```text
Execute PHASE 6 ONLY.
```

---

# FINAL PRODUCT TARGET

Target akhir bukan:

> "Banyak fitur."

Target akhir adalah:

```text
CLIENT
  ↓
PROJECT
  ↓
AREA
  ↓
LOCATION
  ↓
EXECUTION POINT
  ↓
PIC ASSIGNMENT
  ↓
SCHEDULE
  ↓
LOCATION-BOUND SESSION
  ↓
FRESH GPS
  ↓
EXECUTION
  ↓
EVIDENCE
  ↓
CLIENT REVIEW
  ↓
VERIFIED / REVISION
```

Setiap tahap harus mempunyai:

**correct user + correct location + correct time + correct session + server validation + audit trail.**

Platform harus terasa sederhana bagi user meskipun security dan workflow di belakangnya kuat.

**Sederhana di UI. Ketat di backend. Hemat di database.**
