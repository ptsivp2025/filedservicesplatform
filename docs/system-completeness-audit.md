# System Completeness Audit — Field Service Platform

**Phase 0 deliverable.** No application code was changed to produce this — every claim below is
either verified by reading the actual current source/schema in this repo, or explicitly marked
"unverified" where it needs a live test against your deployed Supabase project (out of reach from
this sandbox). Nothing here should be read as "already fixed" — this is the map, not the fix.

---

## 1. Answers to the two things you flagged in screenshots

**"Gambar 1 kenapa tidak full frame"** — Admin Panel renders as a centered modal dialog
(`w-full max-w-7xl h-[90vh]`, dark backdrop) via `ModalPortal`, not a full-page view. That's by
design, same pattern as every other modal in the app (`components/shared/Modal.tsx`,
`ConfirmDialog`) — not a bug from this session's changes. If you want it to instead take over the
whole frame (no backdrop, no rounded corners, fills the iframe), that's a deliberate layout change
I haven't made — say the word and it's a small, contained edit.

**"Dashboard Setting tidak ada yang bekerja merubah page"** — I read the full save path
(`lib/merek.ts` `simpanMerek()` → `app_settings` table → `beriTahuPendengar()` → every `useMerek()`
consumer re-renders immediately, no reload needed) and it is structurally correct: the table exists
(`001_core_schema.sql`), RLS allows write for any `role IN ('admin','superadmin','team')`
(`003_core_rls.sql` `boleh_tulis_pengaturan()`), and the header/login page already read from
`useMerek()` rather than hardcoded strings. I could not reproduce the failure without your live
Supabase project. Before I touch this code, I need one detail: when you click **Simpan**, does it
show a red "Gagal menyimpan: ..." banner (an actual error — tell me its exact text), or does it show
the green "Tersimpan" success message and then nothing on screen actually changes (silent
mismatch)? Those point to two completely different bugs.

---

## 2. Business rule check — PIC ↔ many locations

**Verified already supported, no schema change needed.** `fs_pic_assignments`
(`004_field_service_schema.sql`) has no unique constraint on `user_id` alone — a user can have any
number of rows across different `location_id`/`execution_point_id` values. The only conflict rule
is the *opposite* axis (`fs_projects.allow_multi_pic`, default false: one **location/point** wants
at most one **active PIC** at a time, enforced by a trigger in `005_field_service_functions.sql`,
not by this table's structure). Assigning PIC A to 10 locations and PIC B to 10 different ones
already works today via repeated "Assign PIC" submissions in `AssignmentsTab`.

**Technician side also already handles it**: `app/teknisi/page.tsx` queries
`fs_pic_assignments WHERE user_id = <me> AND active = true` with no `LIMIT 1` — every active
assignment becomes its own task card with its own check-in/out flow keyed by its own
`execution_instance_id`. A technician with 10 assigned locations sees 10 cards today, not one.

**Authorization**: GPS is genuinely not the gate. `fs_check_in()`/`fs_check_out()`
(`005_field_service_functions.sql`, `SECURITY DEFINER`) check `fs_is_assigned()` — an active
`fs_pic_assignments` row for that exact user/location/point/date — *before* distance is even
computed, in the precedence order SCHEDULE_MISMATCH → ASSIGNMENT_MISMATCH → LOW_ACCURACY →
OUTSIDE_RADIUS → VALID. Standing at L011 with perfect GPS while only assigned to L001–L010 returns
`ASSIGNMENT_MISMATCH`, not success — this is enforced in the Postgres function, not the frontend,
so it survives a manipulated URL or request. **I have not run the exact PIC-A/PIC-B/L011 test case
from your prompt live** (needs real accounts + a live check-in call) — flagging as unverified, not
assumed.

**Gap**: no Area-level bulk assignment exists — admin assigns one location (or one execution
point) at a time, one submission per row. At ~3,000 locations this is real friction; see §5.

---

## 3. Execution Point naming (floors) — confirmed gap

`fs_execution_points` (`004_field_service_schema.sql`) has exactly one identity column: free-text
`name`. No `floor`/`level` field. Today "Lantai 3, TV Lobby" and "TV Lobby, Lantai 3" are both just
strings an admin types by hand — nothing enforces consistency, nothing lets you filter/sort by
floor. Given locations with multiple floors × multiple TVs, this needs a structured `floor` (or
`level`) column, not just a naming convention typed into `name`. Flagging as a Phase 2 schema change
— not done in this audit.

---

## 4. CRUD completeness matrix

Verified by reading each page's actual handlers, not by whether a button exists.

| Module | List | Create | View detail | Edit | Delete/Deactivate | Refresh after mutation | Search | Filter | Pagination | Confirm dialog | Permission gate | RLS (DB-enforced) | Loading | Error | Empty | Mobile responsive |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Project** | ✅ | ✅ | — (list row = select) | ❌ | ❌ | ✅ (on create) | ❌ | ❌ | ❌ | n/a | ✅ UI-hidden (`bolehKelola`) | ✅ (`fs_is_provider*`) | ✅ | ✅ | ✅ | responsive classes, not live-tested |
| **Area** | ✅ | ✅ | n/a | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | n/a | ✅ | ✅ | ✅ | ✅ | n/a (no dedicated empty msg) | " |
| **Location Master** | ✅ | ✅ (with map picker) | — (list row = select) | ❌ | ❌ (schema has `status` active/inactive, UI never sets it) | ✅ | ❌ | ❌ | ❌ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | " |
| **Execution Point** | ✅ | ✅ | n/a | ❌ | ❌ (schema has `status`, UI never sets it) | ✅ | ❌ | ❌ | ❌ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | " |
| **PIC Assignment** | ✅ | ✅ | n/a | ❌ (no "replace PIC") | ✅ soft (`active=false` "Nonaktifkan") | ✅ | ❌ | ❌ | ❌ | ❌ **missing** — fires immediately, no confirm | ✅ | ✅ (`fs_is_assigned`, conflict trigger) | ✅ | ✅ | ✅ | " |
| **Recurring Schedule** | ❌ no UI at all | ❌ | ❌ | ❌ | ❌ | n/a | n/a | n/a | n/a | n/a | n/a | table+trigger exist, unused by any UI | n/a | n/a | n/a | n/a |
| **Execution / Check-in-out (Teknisi)** | ✅ (today's tasks) | n/a (system-generated via `fs_ensure_today_instance`) | ✅ (task card) | n/a | n/a | ✅ (re-fetch after each action) | n/a | n/a | n/a | ❌ no confirm before Submit | ✅ (own tasks only) | ✅ (`fs_is_assigned`, ownership checks) | ✅ | ✅ (validation-status messages) | ✅ | ✅ mobile-first by design |
| **Evidence** | — (embedded in check-in/out) | ✅ (upload on submit) | ❌ no gallery/history view anywhere | ❌ | ❌ | n/a | n/a | n/a | n/a | n/a | ✅ RLS (`fs_evidence` policies) | ✅ | ✅ (upload failure is caught, non-blocking) | n/a | n/a | ✅ |
| **Client Review/Verification** | ❌ no UI at all | ❌ | ❌ | ❌ | ❌ | n/a | n/a | n/a | n/a | n/a | n/a | `fs_reviews` table + `fs_status_transition` exist, unused by any UI | n/a | n/a | n/a | n/a |
| **Account Settings (Users)** | ✅ | ✅ | ✅ | ✅ | ✅ (with confirm) | ✅ | ❌ | ❌ (role tabs act as filter) | ❌ | ✅ (reject/delete) | ✅ (admin-only route guard + RLS) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Dashboard Setting** | n/a | n/a | ✅ (live preview) | ✅ (per-field) | ✅ ("kembalikan ke bawaan") | ✅ (immediate, no reload) | n/a | n/a | n/a | n/a | ✅ (`boleh_tulis_pengaturan`) | ✅ | ✅ | ✅ (see §1 — needs your live confirmation) | n/a | not live-tested |
| **Integrations** | ✅ | ✅ (set token) | ✅ (masked) | ✅ | ✅ (revoke) | ✅ | n/a | n/a | n/a | not applicable (tokens, not records) | ✅ (admin-only, server-side session check) | ✅ (deny-all RLS, service_role-only route) | ✅ | ✅ | n/a | not live-tested |
| **App Rilis** | ✅ | ✅ (upload) | n/a | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | n/a | ✅ (admin session or CI secret) | ✅ (SELECT-only policy for clients) | ✅ | ✅ | ✅ | not live-tested |

**Legend**: ✅ verified present and wired to a real backend call · ❌ verified absent · n/a not
applicable to that module's shape.

---

## 5. Search / filter / pagination — real risk at your stated scale

You mentioned ~3,000 locations. Every list in Field Service (`ProjectsTab`, `LocationsTab`,
`PointsTab`, `AssignmentsTab`) does `select('*')`-style queries with **no `.limit()`, no
`.range()`, no search filter** — the full table for the active project loads into the browser
every time. At a handful of locations this is invisible; at 3,000 it will be slow to load, heavy on
Supabase egress (your own §11/§20 concern), and the flat `<select>` dropdown used to pick a location
becomes unusable. This is a real, unaddressed gap — not implemented in this audit, flagged for
Phase 2/8.

---

## 6. Security/RLS spot-check summary

- Every `fs_*` table has RLS enabled with real policies (`006_field_service_rls.sql`), not just
  hidden UI — confirmed by reading policy definitions, not by their existence being commented.
- `fs_check_in`/`fs_check_out`/`fs_status_transition`/`fs_ensure_today_instance` are
  `SECURITY DEFINER` and callable by `anon`/`authenticated` — flagged by Supabase's own advisor as a
  pattern to double-check, but it's intentional here: each function re-derives and checks ownership
  internally (`fs_is_assigned`, assignment ownership, status-transition allow-list) rather than
  relying on the DEFINER privilege to skip authorization. Verified this session via
  `mcp__Supabase__get_advisors` against a disposable validation project — no new/unexplained
  findings.
- `app_settings`, `rahasia_integrasi` correctly separate public-readable config from
  server-only secrets (deny-all RLS + service-role-only route for the latter).
- **Not verified live**: actual JWT claim propagation on your deployed project (i.e., that
  `jwt_claim('user_role')` really reflects the logged-in user's current `role` on your specific
  Supabase instance, not just in the disposable one used for migration validation). This is the
  most likely root cause if Dashboard Setting's save silently fails — see §1.

---

## 7. Other confirmed gaps (not yet prioritized)

- No destructive action anywhere in Field Service/Teknisi has a confirmation dialog
  (`ConfirmDialog` exists and is used correctly in Account Settings — Field Service doesn't import
  it at all). "Nonaktifkan" on a PIC assignment fires on a single click.
- No audit trail for Field Service actions (`logAudit` is used in Account Settings; Field Service's
  create/deactivate calls don't log who/what/when).
- No way to edit a location's coordinates/radius/name after creation, or to view its execution
  history from the Location Master screen.
- Client Review/Verification (`WAITING_REVIEW → VERIFIED/REVISION_REQUIRED`) has a DB function
  (`fs_status_transition`) and RLS but genuinely no UI — a client reviewer today has nothing to
  click.
- Recurring Schedule generation has no UI; `fs_ensure_today_instance()` (migration 007) is a
  documented stand-in, not the real mechanism.

---

## 8. What's already solid (worth keeping, not rebuilding)

- Account Settings is the most complete module end-to-end (full CRUD, confirm dialogs, audit log,
  RLS-backed role enforcement) — good reference pattern for Location Master's missing Edit/Delete.
- The Technician check-in/check-out flow's server-side validation precedence
  (schedule → assignment → GPS accuracy → radius) already matches your §13 "AUTHORIZED" logic
  exactly, including the "GPS valid but wrong assignment = DENY" rule.
- Multi-location PIC assignment needs no schema change — see §2.

---

## Recommended next step

Per your own instruction, I'm stopping here without changing any application code. Suggested order
once you approve a phase: (1) confirm the Dashboard Setting failure mode from §1 so I can fix the
actual bug instead of guessing, (2) Location Master Edit/Delete + confirm dialogs (§4, §7) since
Account Settings already has the exact pattern to copy, (3) Execution Point `floor` column (§3),
(4) search/pagination before location count grows further (§5).
