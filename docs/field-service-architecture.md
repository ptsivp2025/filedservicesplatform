# Field Service & Proof of Execution — Transformation Plan (Phase 1)

Date: 2026-09-10
Depends on: `docs/field-service-audit.md`. This is a **plan document** — no migrations, RLS, or
application code are created in this phase, per instruction ("Do not implement yet").

---

## 1. Guiding Constraints (carried from audit)

- Additive module. No existing table, RLS policy, page, or component is modified except:
  `next.config.js` `Permissions-Policy` header (scope `geolocation=()` → `geolocation=(self)`).
  Everything else is new, under isolated namespaces.
- Reuse auth/session/JWT, design system, dashboard registry, notification router, export
  convention, cron pattern, RLS helper+trigger-freeze pattern, audit-log pattern.
- Deviate deliberately (and only) where the instruction requires something the platform doesn't
  do today: private storage + signed URLs for evidence, `user_id`-keyed RLS ownership (not
  name-based), DB-enforced status state machine, browser Geolocation enabled and used.
- All authorization-critical logic (assignment match, GPS validity, status transitions) is
  enforced in Postgres (RLS + `SECURITY DEFINER` functions + triggers), never trusted from the
  client — consistent with how the rest of the platform already treats RLS as the real boundary.

## 2. Namespacing

- Routes: `app/field-service/**` (provider/admin UI), `app/field-service/pic/**` (mobile PIC
  flow) or a dedicated top-level `app/fs-pic/**` if a distinct mobile-first layout is warranted,
  `app/field-service/client/**` (client review UI) — exact split decided in Phase 3 once the
  provider/PIC/client UX needs are prototyped; all live under one `field-service` route family
  so `allowed_menus` gating is a single prefix check.
- API routes: `app/api/field-service/**` for anything that must run server-side with the service
  role (check-in GPS validation, evidence signed-URL issuance, status transitions, bulk import).
- Tables: prefix `fs_` (e.g. `fs_areas`, `fs_locations`) to avoid collision with the existing
  overloaded "project" naming (see audit §15).
- Library code: `lib/field-service/**` (e.g. `lib/field-service/gps.ts`, `assignment.ts`,
  `schedule.ts`, `status.ts`).
- SQL: `sql/field-service-*.sql` for iterative/manual scripts (matching repo convention) and a
  proper `supabase/migrations/0xx_field_service_*.sql` set for the authoritative history.

## 3. Roles — Additive, Not Replacing

Do not replace `users.role`/`access_level`. Add a new column `users.fs_role text` (nullable —
`NULL` means "not a Field Service user"), CHECK-constrained to:

```
PROVIDER_ADMIN | PROVIDER_SUPERVISOR | FIELD_PIC | CLIENT_ADMIN | CLIENT_MANAGER | CLIENT_VIEWER
```

A global `admin`/`access_level='full'` user is still recognized as provider-admin-equivalent for
Field Service (mirrors how `access_level` already elevates users platform-wide) — resolved via a
`fs_is_provider_admin()` SQL helper that checks `lingkup_semua() OR fs_role = 'PROVIDER_ADMIN'`,
not by duplicating admin logic.

`allowed_menus` gets a new value (`'field-service'`) so the module composes with the existing
menu-gating mechanism rather than inventing a second one.

## 4. Core Data Model

```
fs_projects                 (the client engagement/contract — explicitly NOT named "projects"
                              bare, to avoid collision with progress_projects/project_requests)
  └─ fs_areas                (logical grouping, e.g. "Jakarta Utara")
       └─ fs_locations       (Location Master — physical site, authoritative coordinates)
            └─ fs_execution_points   (TV/display/point within a location)
fs_pic_assignments           (user_id + location_id [+ execution_point_id] + effective/end date
                              + active flag + schedule ref — THE authorization boundary)
fs_recurring_schedules        (location/execution_point + weekday pattern + effective range)
fs_execution_instances         (materialized single occurrence: date + location + execution_point
                              + assigned PIC + config snapshot + status)
fs_work_sessions              (check-in → check-out span for one execution instance)
fs_gps_events                 (every GPS capture: check-in/out + raw + validation result — audit,
                              never client-writable)
fs_evidence                  (file metadata, private bucket path, execution/task linkage)
fs_reviews                   (client verify / revision-required decisions + notes)
fs_project_settings           (per-project override of system defaults — GPS radius, evidence
                              min count, schedule, review-required, etc.)
fs_playlists / fs_content      (optional, only if project uses TV/display content — expected vs
                              actual, snapshotted per execution instance)
fs_audit_log                 (reuses the existing `audit_trail` table + `lib/audit.ts` helpers
                              with `module = 'field-service'`, rather than a new table, unless a
                              structured per-record timeline is needed — mirrors the
                              `tech_note_history` precedent for that case)
```

Design notes:
- `fs_locations` stores `latitude numeric`, `longitude numeric`, `gps_radius_m int`, `address`,
  `timezone text DEFAULT 'Asia/Jakarta'`, `status`. Coordinates are authoritative; PIC UI never
  writes to this table.
- `fs_pic_assignments.user_id` is a mandatory `uuid REFERENCES users(id)` — **never** a name
  column, directly addressing the audit's #1 structural risk (name-based ownership / self-rename
  exposure). Uniqueness: partial unique index on `(location_id, execution_point_id, schedule_id)
  WHERE active` unless the project explicitly enables multi-PIC (a `fs_projects.allow_multi_pic
  boolean` flag gates whether the conflict-check function permits a second active row).
- `fs_execution_instances` carries a `config_snapshot jsonb` (GPS radius, evidence requirements,
  expected playlist id/name at generation time) so later changes to `fs_project_settings` or
  `fs_playlists` never rewrite history (instruction §19/§30/§86).
- `fs_evidence` never stores files inline — only `bucket`, `path`, `mime_type`, `size_bytes`,
  `uploaded_by`, `execution_instance_id`, `task_id`, `hash` (optional). File bytes live in a new
  **private** Supabase Storage bucket `fs-evidence`.

## 5. Assignment Is the Authorization Boundary — Enforcement Plan

Three independent layers, all server-side, mirroring the platform's existing RLS-helper +
trigger-freeze template (audit §6):

1. **RLS on `fs_execution_instances`/`fs_work_sessions`/`fs_evidence`:** a PIC (`fs_role =
   'FIELD_PIC'`) may `SELECT`/`INSERT`/`UPDATE` only rows where
   `fs_is_assigned(jwt_user_id(), location_id, execution_point_id, instance_date)` is true — a
   `SECURITY DEFINER` SQL function that checks `fs_pic_assignments` for an **active, date-in-range,
   user_id-matching** row. Provider admin/supervisor bypass via `fs_is_provider_admin()`. Client
   roles get a separate read-only policy scoped by `fs_projects` membership.
2. **Check-in `SECURITY DEFINER` RPC (`fs_check_in(instance_id, lat, lng, accuracy)`):**
   re-validates assignment (never trusts a pre-fetched instance id blindly — re-derives location
   from `instance_id` server-side), computes distance via `ST_DistanceSphere`/haversine against
   `fs_locations.latitude/longitude`, compares to the effective radius (see §7 config precedence),
   validates the instance's schedule window, and only then inserts `fs_gps_events` +
   `fs_work_sessions`. Returns one of the GPS trust states in §8. This function is the single
   place `ASSIGNMENT_MISMATCH` is decided — the client never computes or asserts it.
3. **Trigger column-freeze on `fs_pic_assignments`:** only provider-admin/supervisor (service
   role or `fs_is_provider_admin()`) can write `user_id`, `location_id`, `execution_point_id`,
   `active`, `effective_date`, `end_date` — a PIC cannot self-assign or extend their own access,
   mirroring `guard_users_privileged_columns()`.

This directly satisfies the mandatory cross-PIC test (instruction §81): PIC A with valid GPS at
PIC B's location is rejected by layer 1 (RLS won't even return the row) and, if somehow reached
via the RPC with a manipulated instance id, by layer 2's independent re-derivation — there is no
path where GPS proximity alone grants access.

## 6. GPS Validation

- Acquisition: browser/device `navigator.geolocation.getCurrentPosition` (no Google Maps API
  call for this) — requires flipping `next.config.js` `Permissions-Policy` from `geolocation=()`
  to `geolocation=(self)` (deviation D-003, justified and logged).
- Validation is entirely server-side (`fs_check_in`/`fs_check_out` RPCs), per instruction §23–24:
  distance-in-radius **and** active assignment **and** correct project **and** correct execution
  instance **and** correct schedule window — all four, not distance alone.
- Trust states stored on `fs_gps_events.validation_status`, enumerated exactly as instruction §25:
  `VALID | LOW_ACCURACY | OUTSIDE_RADIUS | LOCATION_PERMISSION_DENIED | LOCATION_UNAVAILABLE |
  SUSPICIOUS | MOCK_LOCATION_DETECTED | ASSIGNMENT_MISMATCH | SCHEDULE_MISMATCH`.
- Anti-spoof layer (v1, browser/PWA-realistic — documented limitation, not claimed as bulletproof
  per instruction §26): flag `SUSPICIOUS` when accuracy is implausibly perfect, when two
  consecutive check-ins imply impossible travel speed, or when `navigator.geolocation` reports a
  mock-provider hint where the platform exposes one. Native-wrapper-grade device attestation is
  explicitly out of scope for v1 and recorded as a known limitation.

## 7. Configuration System

`app_settings` (existing) holds Field Service **system defaults** under a namespaced key (e.g.
`app_settings['field_service.defaults']` jsonb) — reuses the existing generic config table
instead of inventing a parallel one. `fs_project_settings` (new, one row per `fs_projects`) holds
**project overrides**. Location-level overrides are JSONB columns directly on `fs_locations`
(`gps_radius_override`, `checklist_override`, etc.) rather than a fourth table, per instruction
§62 ("do not expose unnecessary complexity"). A single SQL function
`fs_effective_setting(location_id, key)` resolves system → project → location precedence and is
the only place the "Effective value / Source" UI (§63) reads from.

## 8. Recurring Schedule → Execution Instance

`fs_recurring_schedules` stores the weekday pattern per location/execution point (not per PIC —
PIC comes from `fs_pic_assignments`, keeping schedule and assignment independently editable).
Materialization into `fs_execution_instances` runs as a new cron job
(`app/api/cron/fs-generate-instances`, same `CRON_SECRET` guard pattern as existing
`/api/cron/escalate|digest`), generating a rolling window (e.g. next 30 days) rather than
generating all future dates up front — keeps the table bounded even at 3,000+ locations. The
function is idempotent (unique constraint on `(location_id, execution_point_id, instance_date)`)
so a re-run never duplicates instances.

## 9. Status Lifecycle (server-enforced)

```
NOT_STARTED → IN_PROGRESS → SUBMITTED → COMPLETED → WAITING_REVIEW → VERIFIED
                                                            └→ REVISION_REQUIRED → IN_PROGRESS
```

New DB pattern (no existing table has this — build once, reuse the shape): a
`fs_status_transition(instance_id, new_status)` `SECURITY DEFINER` function holding an explicit
allow-list of `(from, to, allowed_actor_role)` pairs, called by every status-changing RPC instead
of raw `UPDATE ... SET status`. This is the concrete fix for the instruction's "COMPLETED ≠
VERIFIED" and "provider cannot self-verify" rules (§33/§87) and for the general platform
weakness noted in the audit ("no DB-level transition validation anywhere").

## 10. Evidence & Private Storage

New bucket `fs-evidence`, created **private** (`public = false`) — first private bucket in the
platform, a deliberate deviation from the existing public-bucket convention (audit §7,
deviation D-002). Upload flow reuses the existing client-side compression pattern
(`lib/image-compress.ts`, dual full/thumb) and the `uploadFiles()`-style sequential-upload loop
from `unit-movement`, but the read path is new: `app/api/field-service/evidence/[id]/route.ts`
issues a short-TTL `createSignedUrl` after checking the caller's RLS-equivalent authorization in
application code (belt-and-suspenders alongside `storage.objects` RLS scoped to the bucket).
`fs_evidence` rows carry `execution_instance_id`, `task_id`, `uploaded_by`, `mime_type`,
`size_bytes`, `validation_status` per instruction §31.

## 11. Client Review

`fs_reviews` (one row per client decision): `execution_instance_id`, `reviewer_id`, `decision`
(`VERIFIED|REVISION_REQUIRED`), `notes`, `created_at` — append-only (a new review row on
re-review, not an update), giving a free audit trail without needing a separate history table.
The existing `project-progress` public-share-token pattern (`share/[token]/page.tsx` +
service-role-backed API route with explicit column allowlists) is the template for a
client-facing execution detail/proof page, extended to also accept the `VERIFY`/`REQUEST
REVISION` POST actions (that route currently is read-only and needs the write actions added —
new code, not a modification of the existing project-progress route).

## 12. Dashboards, Matrix, Exception Center

- Provider/PIC/Client dashboards each get one new widget wired into the existing Widget Registry
  (`app/dashboard/_components/widgets/Widgets.tsx`) plus dedicated full pages under
  `app/field-service/**` for the execution matrix and exception center (server-paginated,
  server-filtered — required at 3,000+ scale per instruction §16/§37).
- `useWorkQueue`-style bucketing (Today/Upcoming/Overdue) reused for the PIC "Today's Work" view
  and the provider "what's late" view.
- `GlobalSearch.tsx`'s `ResultType` union gets `'fs_location' | 'fs_execution'` entries.

## 13. Map

Google Maps JS API used **only** for visualization/navigation (instruction §21–22):
admin location-mapping (pin drop + address search + radius preview), admin/client map view with
marker clustering (required at 3,000+ points — no library currently in `package.json`; add a
clustering-capable Maps wrapper only, not a new map engine), and a PIC "Navigate" button that
opens the device's native maps app with the Location Master's coordinates (never GPS is used to
call the Maps API). No architecture blocks a later map-provider swap: all coordinate storage and
distance math live in `fs_locations`/SQL functions, independent of which JS map library renders
them.

## 14. Notifications

All Field Service notifications route through `kirimNotifikasi({event, ...})` from day one (audit
§11) with new event keys in `lib/notifikasi/katalog.ts`: `fieldservice.assignment_created`,
`fieldservice.upcoming_visit`, `fieldservice.revision_requested`, `fieldservice.exception`,
`fieldservice.submitted`, `fieldservice.verified`. No new provider/channel work needed — reuses
WhatsApp/Telegram/in-app as-is.

## 15. Export / Bulk Import

Exports follow the `lib/xlsx-loader.ts` (CDN SheetJS) convention, matching `project-progress`.
Bulk import (net-new capability, no existing pattern to copy) follows the instruction's
upload → parse → validate → preview → conflict-check → confirm → import pipeline (§46–48),
staged in a temporary `fs_import_batches`/`fs_import_rows` pair (status per row: valid / invalid /
warning / conflict) so nothing is inserted into `fs_locations`/`fs_pic_assignments` until an
explicit confirm step — never a direct bulk `INSERT` from parsed rows.

## 16. Performance / Scale (3,000+ execution points)

Server-side pagination and filtering everywhere (no `select('*')` unbounded fetch — matching the
project-progress share route's explicit-column-allowlist discipline), composite indexes on
`(location_id, instance_date)`, `(assigned_pic_user_id, instance_date)`, `(status)`,
`(review_status)` per instruction §52, map clustering + viewport-based marker loading, rolling
30-day instance materialization (not "generate all future dates"), and bulk assignment as a
single set-based SQL operation rather than N client round-trips.

## 17. Phased Delivery (maps to instruction §106)

| Phase | Deliverable |
|---|---|
| 0 (done) | `docs/field-service-audit.md` |
| 1 (this doc) | `docs/field-service-architecture.md`, `docs/field-service-acceptance-matrix.md` |
| 2 | Migrations for §4 tables, RLS (§5), triggers (§9), `scripts/uji-rls`-style tests |
| 3 | Location Master + map + areas + execution points + PIC assignment + schedule + config UI |
| 4 | Execution instance generator, GPS engine, check-in/out, work session, evidence upload |
| 5 | Client review/verification + share-link extension |
| 6 | Provider/PIC/Client dashboards, execution matrix, exception center |
| 7 | Bulk import, bulk assignment, export/reports |
| 8 | Security/RLS/GPS/anti-spoof/performance/mobile-UX hardening pass |

Each phase ends with the INSPECT → TYPECHECK → LINT → TEST → BUILD → git-diff-review →
regression-check loop from the instruction's execution protocol, logged in
`docs/field-service-decision-log.md` / `docs/field-service-deviation-log.md`.

## 18. Deviations From Baseline Convention (summary — full entries in deviation log)

| ID | Deviation | Why |
|---|---|---|
| D-002 | First private Storage bucket + signed URLs | Instruction explicitly requires access-controlled evidence; platform-wide convention is public buckets |
| D-003 | `Permissions-Policy: geolocation` scoped to `self` instead of fully blocked | GPS check-in is a core requirement; currently disabled platform-wide |
| D-004 | `user_id`-keyed RLS ownership for all new `fs_*` tables (never name-based) | Existing name-based pattern has a documented self-rename exposure; must not be inherited by a module whose core guarantee is per-user assignment |
| D-005 | DB-enforced status state machine (new pattern) | No existing table enforces transitions; Field Service's COMPLETED≠VERIFIED guarantee requires it |
