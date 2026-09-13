# Field Service & Proof of Execution — Repository Audit (Phase 0)

Date: 2026-09-10
Scope: `dhanywp20-cmyk/WorkManagement-Kim`, branch `claude/field-service-transformation-6qq2js` (rebuilt from `main` @ `72e61df`).

> **Preflight note (read first):** at session start, the designated branch and an earlier
> `main` were empty (README only). The real application (430 files) had just been pushed to
> `main` moments before this session began. The branch was recreated from the updated `main`.
> See `docs/field-service-deviation-log.md` entry D-001 for details. This audit describes the
> application as it exists on that `main`.

---

## 1. Current Architecture

- **Stack:** Next.js 14.2.35 (App Router), React 18.3.1, TypeScript 5.7.2 (`strict: true`), Tailwind 3.4.17. No ORM.
- **Data access:** almost entirely client-side `supabase.from(...)` calls (≈97 `'use client'` files) authorized purely by Postgres RLS, plus 24 `app/api/**/route.ts` handlers for server-only operations (auth, admin, secrets, cron, incentive access). There is **no service/repository layer** — pages call Supabase directly.
- **Module shape:** feature-per-folder under `app/` (`ticketing`, `reminder-schedule`, `project-progress`, `unit-movement`, `daily-report`, `picket-showroom`, `tech-note`, `incentive-pts`, `kpi-team`, `learning-center`, `form-require-project`, `form-review`, `dashboard`, `analytics-dashboard`). Each has one large `page.tsx` (often 3,000–5,000 lines), a `_components/` folder, and a `shared.ts` for types/helpers. This is the established pattern a new Field Service module should follow (`app/field-service/...`).
- **Deployment:** Vercel (per-tenant, white-labeled — `DEPLOYMENT.md` documents a full "new customer" runbook: new Supabase project + new Vercel project + own secrets). Two cron jobs today (`/api/cron/escalate`, `/api/cron/digest`), guarded by `CRON_SECRET`.
- **Docs already present:** `docs/AUDIT-PLATFORM-2026-09.md`, `docs/AUTH-WORKFLOW-AUDIT.md`, `docs/HARDENING-AUDIT.md`, `docs/HARDENING-AUDIT-BASELINE.md`, `docs/UX-WORKFLOW-AUDIT.md`, `docs/AUDIT-INCENTIVE-PTS.md` — these are prior audits of the existing product and were used as primary sources for this document; direct code reads were used to verify/supplement them.

## 2. Reusable Modules (closest existing analogs)

| Field Service concept | Closest existing analog | File(s) |
|---|---|---|
| Execution instance + evidence + status | `project-progress` (`progress_projects → progress_locations → progress_components`) | `app/project-progress/**`, `sql/project-progress*.sql` |
| Recurring schedule + PIC assignment + approval pipeline | `reminder-schedule` (routing_status pipeline, `InstallerPicker`, `ModePenyelesaianPanel`) | `app/reminder-schedule/**` |
| Multi-file evidence upload | `unit-movement` (`MultiFileField`, `UrlListField`, `uploadFiles()`) | `app/unit-movement/**` |
| Client-facing read-only proof view | `project-progress` public share token page | `app/project-progress/share/[token]/page.tsx`, `app/api/project-progress/share/[token]/route.ts` |
| Dashboard widget composition | Widget Registry + permission resolver | `app/dashboard/_components/widgets/**` |
| Cross-module search | `GlobalSearch` (`ResultType` union) | `app/dashboard/_components/GlobalSearch.tsx` |

None of these implement GPS, location-master/coordinate data, geofencing, or a true recurring-instance generator — see §13 (map/GPS) and gaps below.

## 3. Existing Database Entities

59 tables in `public` (dump `sql/full-schema/01_tables.sql`, **stale as of 2026-08-30** — cross-check dated `sql/*.sql` point-migrations for current truth). Relevant groups:

- **Identity/security:** `users`, `user_credentials`, `user_sessions`, `login_attempts`, `password_reset_otps`, `rahasia_integrasi`.
- **Org/scoping:** `division_ivp_mappings`, `division_supervisor_mappings`, `user_supervisor_mappings`, `pts_team_mappings`, `product_team_map`, `team_members`, `app_settings`.
- **Work modules:** `tickets`, `reminders`, `project_requests`, `progress_projects/locations/components/issues/actions`, `tech_notes(+folders,+history)`, `daily_reports(+team_entries)`, `picket_schedules(+holidays,+tamu_detail,+produk_lain)`, `unit-movement` (table name via `movement_logs`), `form_reviews`.
- **Incentive:** `incentive_projects/tranches/splits/settings/disbursements/scheme_settings`.
- **Cross-cutting:** `notifications`, `audit_trail`, `activity_logs`.

`users` (relevant columns): `id uuid`, `username`, `role text DEFAULT 'team'` (CHECK: `admin|team|guest`; `superadmin` used throughout code/RLS but **not** in the current CHECK constraint — flagged inconsistency), `full_name`, `allowed_menus text[]` (menu-level access control, already the platform's mechanism for "can this user see module X"), `access_level text DEFAULT 'guest'` (CHECK `full|guest` — the "Full Access" elevation flag), `sales_division`, `jabatan`, `atasan_id uuid` (hierarchy), `team_type`, `pts_daerah`.

`app_settings (key text PK, value jsonb, updated_at)` — the platform's generic system-config store (used for notification event settings, team/kelompok config, KPI config). This is the reusable pattern for "system default" config layers.

No `organizations` or `projects`(generic)/`areas`/`locations`/`execution_points` tables exist today. `progress_projects`/`progress_locations` is the nearest thing to a project→location hierarchy but has **no coordinates, no PIC as FK, no recurrence, no GPS**.

## 4. Existing Authentication

Custom auth, **not** Supabase Auth:
- bcrypt password hashing, `user_sessions` table, httpOnly cookie `ivp_session` (6h TTL). Login/logout/register/session routes under `app/api/auth/**`.
- Since `auth.uid()` is always null (no Supabase Auth), the app issues its own HS256 JWT (`lib/db-token.ts: issueDbToken`, signed with `SUPABASE_JWT_SECRET`) carrying `sub` (user id), `role: 'anon'` (deliberate — RLS policies grant to `anon`), plus claims `username/user_role/full_name/sales_division/access_level`. `lib/supabase.ts` attaches this as `Authorization: Bearer <token>` on every Supabase call via a custom fetch wrapper, refreshing near expiry.
- `/api/auth/session` re-verifies the cookie and **re-issues a fresh JWT from current DB values** on every refresh — this is the root of a documented self-rename privilege issue (see §12).
- Server-side guards: `lib/server-auth.ts: getSessionUser()`, `lib/penjaga-admin.ts: pastikanMasuk()/pastikanAdmin()` — both re-read role from `users` per call (fast revocation), but the already-issued PostgREST JWT claims stay valid until natural refresh (~≤6h staleness window).
- Password reset via WhatsApp OTP, rate-limited; login has brute-force lockout (5/15min per username, 30/15min per IP).
- `middleware.ts` only checks **cookie presence**, not role — role/menu authorization happens downstream in RLS + server guards, never in middleware.

**Reuse for Field Service:** reuse the session/JWT mechanism as-is — no new auth system needed. Field-service-specific roles should be layered on top of the existing `role`/`access_level`/`allowed_menus` model (see architecture doc), not replace it.

## 5. Existing Authorization

- Global roles: `admin`, `team`, `guest` (+ `superadmin` referenced but not in current DB constraint).
- `access_level` (`full`/`guest`) elevates a `team` member without granting `admin`.
- `allowed_menus text[]` on `users` is the existing "which modules can this user open" mechanism — a new Field Service entry would plug into this the same way other modules do.
- **Project/data scoping ("lingkup"):** `lib/project-scope.ts` (client) mirrored by SQL functions `lingkup_semua()`, `lingkup_divisi()`, `boleh_lihat_baris()`, `boleh_lihat_project()` (`05_functions_triggers.sql`) — admin/superadmin/team see broadly, sales see their own division/own-named rows. `lingkup_semua()` currently treats **any** `team` role as full-scope, which is broader than Field Service will want (PIC must NOT get broad scope).
- Team/group config: `lib/kelompok.ts` reads assignable groups from `app_settings` (DB-driven, no hardcoding) — the intended pattern; several legacy modules (Picket Showroom, KPI Team) violate it with hardcoded names/per-team columns (documented tech debt, **do not copy that pattern**).
- **Ownership checks are predominantly name-based** (`assign_name = jwt_full_name()`, `pic = jwt_full_name()`), not `user_id`-based. This is the platform's biggest structural authorization weakness (see §12) and directly conflicts with the Field Service mandate that *"a PIC must never execute another PIC's assigned location."* Name-matching is not an acceptable authorization primitive for that guarantee.

## 6. Existing RLS

- All ~59 tables have RLS **enabled** in production. Policies use JWT claim helpers (no `auth.uid()`): `jwt_claim(name)`, `jwt_full_name()`, `jwt_user_id()` (casts `sub`→uuid), `lingkup_semua()`, `lingkup_divisi()`, `boleh_lihat_baris(...)`, `boleh_lihat_project(...)`, all defined in `sql/full-schema/05_functions_triggers.sql` and granted to `anon, authenticated` (JWT role claim is deliberately `'anon'`).
- Standard shapes: `FOR ALL USING (lingkup_semua()) WITH CHECK (lingkup_semua())` for admin/team-managed tables; row-ownership policies (`entered_by = jwt_claim('username') OR lingkup_semua()`) for user content.
- Column-freeze trigger pattern: `guard_users_privileged_columns()` blocks client writes to privileged `users` columns (role, allowed_menus, access_level, etc.) — **this trigger pattern (RLS row scope + trigger column freeze) is the template to reuse** for any Field Service privileged column (e.g. preventing a PIC from editing their own assignment).
- Several sensitive tables have RLS enabled with **zero policies** (deny-all-to-client, service-role only) — the pattern to use for any Field Service table that must never be client-writable (e.g. GPS validation audit trail).
- Testing convention: `scripts/uji-rls/` spins up an ephemeral local Postgres, loads real policy SQL, and simulates multiple JWT identities doing real DML inside rolled-back transactions. **This is the required methodology for validating new Field Service RLS**, not just policy-text review.
- Known drift: `sql/full-schema/04_rls.sql` is a stale snapshot; several policies have since been superseded by dated one-off files not yet folded back in.

## 7. Existing Storage

- 5–7 Supabase Storage buckets (`reminder-photos`, `ticket-photos`, `project-files`, `movement-files`, `review-photos`, `learning-answers`, brand-logo bucket), **all public** (`storage.buckets.public = true`).
- Upload pattern: client compresses image (`lib/image-compress.ts`, dual full/thumb sizes) → `supabase.storage.from(bucket).upload(...)` → `getPublicUrl()` stored as a plain string column.
- **No signed URLs used anywhere.** A hardening pass (`sql/hardening-storage-wajib-login.sql`) requires login for write ops but SELECT/read remains fully public-by-bucket-flag. Migration to private buckets + signed URLs is explicitly flagged as deferred P1 tech debt in `docs/HARDENING-AUDIT-BASELINE.md`.
- **Implication:** the instruction's requirement ("private storage, signed URLs, client can only access evidence for authorized projects") is **not something this repo currently does anywhere** — it must be built new for Field Service evidence, as a deliberate deviation from the platform's existing (public-bucket) convention. See deviation log D-002.

## 8. Existing UI Components

`components/shared/**` (single export surface via `index.ts`) is a mature, directly-reusable design system: `Modal`/`ConfirmDialog`/`ModalPortal` (+ centralized z-index scale), `Toast`, `StatCard`/`StatCardGrid`, `MobileListCard` (canonical mobile card pattern), `Charts.tsx`/`MiniPieChart`, `ActionIcons`/`ActionGroup`, `FlowSteps` (stage-progress diagram — directly applicable to an execution/verification pipeline), `FormActions`/`FormParts`, `PageHeader`, `EmptyState`/`ErrorState`/`LoadingSpinner`/`LoadingScreen`, `MultiDatePicker`, `AuditTrailPanel`, `Username`, `LogoMerek`, `SalesPicker` (searchable user picker — reusable for PIC assignment UI), `AdminEditFields`, `StarRating`.

**Gap:** no map/geolocation component exists anywhere (`MapPin`, static-map preview, distance/geofence widget) — 100% new for Field Service.

## 9. Existing Dashboards

`app/dashboard` implements a **Widget Registry** pattern (`Widgets.tsx`: `WIDGETS` array of `{id, permission, priority, size, Component}`) resolved through `permissions.ts` (declarative permission predicates, not hardcoded per-widget checks), plus `useWorkQueue` (My Action/Today/Upcoming bucketing reusing each module's own "is this mine" logic) and `GlobalSearch` (extensible `ResultType` union). `analytics-dashboard` and `kpi-team` provide additional KPI/scoring patterns. **Directly reusable** for a Field Service dashboard widget and a "Today's Work" PIC view.

## 10. Existing Export/Import

Three **inconsistent** export approaches coexist: (1) `lib/xlsx-loader.ts` (CDN SheetJS) used by ticketing/picket-showroom/project-progress, (2) `xlsx-js-style` npm package (kpi-team), (3) `exceljs` + `file-saver` npm (incentive-pts). No shared style-constants module — each file redefines header/border colors inline. **Recommendation:** Field Service exports should follow convention (1) (`loadXLSX`), matching its closest analog (`project-progress`), rather than introducing a fourth approach.

No bulk **import** exists anywhere in the current codebase (no CSV/XLSX parse-validate-preview-confirm flow for any module) — the Field Service bulk-import requirement (§46–48 of the instructions) is **entirely new functionality**, though the export tooling (`xlsx`/`exceljs`, already in `package.json`) can be reused for parsing.

## 11. Existing Notification Infrastructure

Two channels: in-app (`notifications` table, `lib/notifications.ts`) and outbound WhatsApp/Telegram (`lib/wa.ts`, `app/api/notifikasi/telegram/route.ts`). A newer unified router (`lib/notifikasi/router.ts: kirimNotifikasi({event, inApp?, whatsapp?, telegram?})`) looks up per-event channel toggles from `app_settings` via `lib/notifikasi/pengaturan.ts`, with an event catalog in `lib/notifikasi/katalog.ts`. **Caveat:** most (~61/62) existing send points bypass the router and call `sendWA` directly; only calls that pass an `event` string get gated by admin toggles. **Field Service must route every notification through `kirimNotifikasi()` with a real event key from day one** — do not repeat the legacy shortcut.

WhatsApp provider abstraction (`lib/notifikasi/penyedia-wa.ts`) supports pluggable providers (Fonnte default, Meta Cloud, custom webhook); secrets live server-side in `rahasia_integrasi` (service-role only) or `app_settings` (secret-looking keys blocked by trigger).

## 12. Existing Map Functionality

**None.** Repo-wide search for `navigator.geolocation`, `google.maps`, `latitude`/`longitude` found zero application code hits. `next.config.js` sets `Permissions-Policy: geolocation=()` — **the browser Geolocation API is explicitly disabled** at the HTTP header level today. No PWA scaffolding (`next-pwa`, `manifest.json`, service worker) exists. GPS check-in/out and any map visualization are 100% new infrastructure — see architecture doc for the plan (native browser geolocation for GPS; Google Maps JS API, cost-controlled, for visualization only, per instruction §21–22).

## 13. Existing Settings Architecture

`app_settings (key, value jsonb)` is the platform's generic config store, already used for notification-event toggles, assignable-team config, and KPI config — this is the reusable primitive for the instruction's **SYSTEM DEFAULT → PROJECT OVERRIDE → LOCATION OVERRIDE** configuration model (§60–64): system defaults via `app_settings`, project overrides via a new `fs_project_settings` table, location overrides via columns/JSONB on the location row itself.

## 14. Technical Risks (inherited, relevant to Field Service)

1. **Client-direct-to-DB architecture** — nearly all authorization must live in Postgres (RLS + triggers); UI checks are not a security boundary. Field Service's hard requirement ("GPS does not give permission; assignment does, and it must be enforced server-side") fits this model well *if* RLS is built correctly with `user_id` FKs — but is exactly the kind of guarantee the platform's existing name-based RLS has failed to hold elsewhere. Do not copy the name-based pattern.
2. **Self-rename privilege issue** — `users.full_name`/`username` are not frozen against self-edit in all paths, which breaks any RLS relying on name equality. Confirms the decision to key all Field Service assignment/ownership on `user_id`, never name.
3. **`WITH CHECK (true)` insert policies** on several tables let any logged-in user insert arbitrary rows/statuses — do not copy for Field Service tables (execution instances, check-ins, evidence, reviews must validate actor and force safe initial status).
4. **Storage fully public, no signed URLs anywhere** — must build private-bucket/signed-URL flow new for evidence (deviation from convention, justified by explicit instruction requirement).
5. **No DB-level state-machine enforcement anywhere** — Field Service's `NOT_STARTED → ... → VERIFIED` (with `REVISION_REQUIRED` branch) lifecycle needs new trigger-enforced transition guards; no existing table to copy this from, though the column-freeze trigger pattern (`guard_users_privileged_columns`) is a usable template shape.
6. **No optimistic-locking/idempotency convention** — Field Service check-in/check-out/evidence-submit/completion must implement explicit compare-and-swap and/or unique constraints from scratch; nothing to reuse here beyond the general Postgres tools.
7. **Stale `sql/full-schema/` dump** — do not treat it as ground truth; cross-reference dated `sql/*.sql` files and live Supabase introspection before building on any existing table.
8. **`lingkup_semua()` grants broad scope to any `team` role** — must not be reused verbatim for Field Service PIC scoping (a PIC is a narrow, assignment-based scope, not a broad "team" scope).

## 15. Conflicting Modules

None of the existing modules conflict at the data-model level with the new Field Service entities (locations, execution points, PIC assignments, execution instances, evidence, reviews) — they are additive. The one naming collision to watch: the instructions use "project" generically, while the existing platform already has a **very overloaded "project" concept** (`project_requests`, `progress_projects`, `incentive_projects` are three different tables). **Recommendation:** name the new top-level entity `fs_projects` (or `field_service_projects`) explicitly, never bare `projects`, to avoid ambiguity with existing modules and existing `GlobalSearch`/dashboard code that already keys off `ResultType` strings like `'project'`/`'progress'`.

## 16. Recommended Reuse Strategy

`REUSE > EXTEND > MODIFY > CREATE NEW`, applied as:

- **Reuse as-is:** auth/session/JWT system, `components/shared/**` design system, Widget Registry + permission resolver, `AuditTrailPanel`/`logAudit()` pattern, `MultiFileField`/`uploadFiles()` upload pattern (adapted to a private bucket), `MiniCalendar`, `SalesPicker` (for PIC picking), `kirimNotifikasi()` notification router, `app_settings` for system defaults, `xlsx-loader.ts` export convention, cron pattern (`app/api/cron/*` + `CRON_SECRET`) for recurring-instance generation, `scripts/uji-rls/` RLS test methodology, RLS helper-function + column-freeze-trigger pattern (new functions, same shape).
- **Extend:** `allowed_menus`/dashboard registry/`GlobalSearch` `ResultType` union to include the new module; `lib/notifikasi/katalog.ts` with new event keys; `lib/jabatan.ts`-style single-source role config, extended with the six new Field Service roles as an **additive** role dimension (not replacing `role`/`access_level`).
- **Modify (carefully, evidence-based):** none of the existing modules need modification to support Field Service — this is a purely additive module. `next.config.js` needs one targeted change (scope the `Permissions-Policy` geolocation directive to `self` instead of blocking it entirely) — see deviation log D-003.
- **Create new:** location master + map, execution points, PIC assignment, recurring schedule + execution instance generator, GPS validation engine, check-in/out + work session, evidence (private storage), client review/verification workflow, execution matrix, exception center, bulk import, Field Service dashboards (provider/PIC/client).

## 17. Modules to Extend

- `app/dashboard` — add a Field Service widget + work-queue source.
- `app/dashboard/_components/GlobalSearch.tsx` — add `'fieldservice'`/`'fs_location'`/`'fs_execution'` result types.
- `lib/notifikasi/katalog.ts` — add Field Service event keys.
- `components/shared/index.ts` — add new map/geofence components here so other modules can eventually reuse them too.

## 18. Modules to Isolate

- All Field Service code lives under `app/field-service/**` (routes), `lib/field-service/**` (services/helpers), `sql/field-service-*.sql` + a new `supabase/migrations/0xx_field_service_*.sql` set, and new tables prefixed `fs_` — kept isolated from existing modules' tables/RLS so a bug in one cannot silently break the other, per the instruction's "never modify unrelated modules" rule.
- Existing modules (`ticketing`, `reminder-schedule`, `incentive-pts`, `learning-center`, `picket-showroom`, `daily-report`, `tech-note`, `unit-movement`, `form-review`, `form-require-project`) are **out of scope** and must not be touched.

## 19. Modules That Should Not Be Exposed in the New Product

If Field Service is ever deployed as a distinct product surface (e.g. a separate Vercel project/subdomain for provider/client users who should not see the internal ticketing/incentive/learning-center tooling), the following should not be exposed to Field Service-only users regardless of technical reuse: `incentive-pts` (internal sales incentive), `kpi-team` (internal performance scoring), `learning-center` (internal training), `picket-showroom` (unrelated front-desk scheduling), `tech-note` (internal engineering notes), Admin Panel secret/integration management (`app/api/integrasi/rahasia`). This is a routing/menu (`allowed_menus`) concern, not a code-deletion concern — nothing should be removed, only gated.

---

*No implementation performed in this phase, per instruction. See `docs/field-service-architecture.md` for the transformation plan and `docs/field-service-acceptance-matrix.md` for the test scenarios that will gate Phase 2+.*
