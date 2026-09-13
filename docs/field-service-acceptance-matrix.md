# Field Service & Proof of Execution — Acceptance Matrix (Phase 1)

These scenarios (drawn from instruction §81–88, §107, §108) gate Phase 2+ completion. None are
implemented yet; this is the checklist implementation must satisfy, expressed as concrete
given/when/then cases against the data model in `docs/field-service-architecture.md`.

## Assignment

| # | Given | When | Then |
|---|---|---|---|
| A1 | PIC A assigned to `fs_locations` L001–L010 (active `fs_pic_assignments`) | PIC A opens/check-in on L001–L010 | ALLOW |
| A2 | Same as A1 | PIC A opens/check-in on L011 (unassigned) | DENY — `ASSIGNMENT_MISMATCH`, row not even visible via RLS |
| A3 | PIC A's assignment `end_date` has passed | PIC A attempts check-in on a previously-assigned location | DENY — inactive assignment does not authorize |
| A4 | Project has `allow_multi_pic = false` (default) | Admin attempts to create a second active assignment for the same location+execution point+schedule | Blocked with a conflict error, not silently overwritten |

## GPS (server-validated only — instruction §23–25, §81–82)

| # | Given | When | Then |
|---|---|---|---|
| G1 | Correct assignment + GPS inside radius + correct schedule + correct project | Check-in attempted | `VALID`, check-in allowed |
| G2 | Correct assignment + GPS outside radius | Check-in attempted | `OUTSIDE_RADIUS`, denied |
| G3 | **No** assignment for this PIC/location + GPS inside radius | Check-in attempted | `ASSIGNMENT_MISMATCH`, denied — **even though GPS is valid** (the mandatory cross-PIC test, §81) |
| G4 | Client submits `gps_valid: true` directly in the request body | Server ignores client-asserted validity and recomputes from raw lat/lng | Server value is authoritative; client claim has zero effect on outcome |
| G5 | GPS accuracy/speed pattern implausible (e.g. teleport between two check-ins) | Check-in attempted | `SUSPICIOUS` or `MOCK_LOCATION_DETECTED`, flagged per project policy |

## Schedule

| # | Given | When | Then |
|---|---|---|---|
| S1 | Assignment/schedule = Saturday+Sunday | PIC checks in on Saturday | ALLOW |
| S2 | Same as S1 | PIC checks in on a Tuesday, no exception configured | DENY — `SCHEDULE_MISMATCH` |
| S3 | Project explicitly configures a schedule exception | Off-schedule check-in attempted | ALLOW, per configured exception only |

## Evidence Ownership (§85)

| # | Given | When | Then |
|---|---|---|---|
| E1 | PIC A has an active work session on their own execution instance | PIC A uploads evidence | Accepted, linked to PIC A's instance/work session |
| E2 | PIC A manually edits `execution_id`/`location_id`/`task_id` in the upload request to point at PIC B's execution | Evidence upload attempted | DENY — server resolves ownership/assignment from the authenticated session, not from client-supplied IDs |
| E3 | Client (CLIENT_VIEWER) requests a signed URL for evidence on a project they are not a member of | Signed URL requested | DENY — 403, no URL issued, no enumeration of file existence |

## Historical Integrity (§86)

| # | Given | When | Then |
|---|---|---|---|
| H1 | Execution on 2026-09-12 snapshots "Playlist A" as expected content | Admin later changes the location's playlist to "Playlist B" | The 2026-09-12 execution instance still displays "Playlist A" |
| H2 | Execution created when `gps_radius = 100m` | Admin later changes location `gps_radius` to `50m` | The historical execution's `config_snapshot` still shows `100m` was the rule in force at execution time |

## Completion / Verification (§33, §87)

| # | Given | When | Then |
|---|---|---|---|
| C1 | PIC completes all tasks + evidence | Provider marks instance `COMPLETED` | Client sees `WAITING_REVIEW`, not `VERIFIED` |
| C2 | Instance is `WAITING_REVIEW` | Provider (any role) attempts to set status directly to `VERIFIED` | DENY — only a client reviewer role can transition to `VERIFIED` |
| C3 | Instance is `WAITING_REVIEW` | Client reviewer clicks Verify | Status → `VERIFIED`, `fs_reviews` row created |
| C4 | Instance is `WAITING_REVIEW` | Client reviewer clicks Request Revision with notes | Status → `REVISION_REQUIRED`, `fs_reviews` row created, provider notified |
| C5 | Instance is `REVISION_REQUIRED` | PIC resumes work | Status → `IN_PROGRESS` only (cannot jump straight to `VERIFIED` or `COMPLETED`) |

## Duplicate / Idempotency (§57–58, §88)

| # | Given | When | Then |
|---|---|---|---|
| D1 | PIC has no open work session on an instance | Check-in submitted twice in quick succession (e.g. network retry) | Exactly one `fs_work_sessions` row created; second call is a no-op or returns the existing session, never a second active session |
| D2 | Evidence upload retried due to network timeout | Same file/idempotency key resubmitted | No duplicate `fs_evidence` row |
| D3 | Completion submitted twice | Second "Complete" tap after success | State unchanged / no corruption; second call is a safe no-op |

## Client / Multi-Tenant Isolation (§84)

| # | Given | When | Then |
|---|---|---|---|
| I1 | Client A user, Project A | Client A requests Project B's execution instance by guessing/editing the ID in the URL or a direct API call | DENY — RLS blocks the row regardless of URL/ID manipulation |
| I2 | Viewer-level client role (`CLIENT_VIEWER`) | Attempts an admin action (e.g. editing `fs_locations`) | DENY — role check enforced server-side, not just hidden in UI |
| I3 | PROVIDER_SUPERVISOR (not client) | Attempts to submit a client `VERIFY`/`REQUEST REVISION` decision | DENY — provider roles cannot self-verify their own work |

## Final Security Checklist (§108 — carried forward, re-verified at Phase 8)

```
[ ] PIC cannot access unassigned location
[ ] PIC cannot access another PIC's execution
[ ] PIC cannot manipulate location ID to redirect an operation
[ ] PIC cannot manipulate execution ID to redirect an operation
[ ] PIC cannot fake frontend GPS validation (server always recomputes)
[ ] Client cannot access another client's project
[ ] Viewer cannot perform admin actions
[ ] Provider cannot self-verify client review
[ ] Evidence access requires authorization (signed URL, not public path)
[ ] RLS protects direct database/API access, not just UI
[ ] Service-role secrets never reach the browser
[ ] Status transitions are server-controlled via the allow-list function
[ ] Duplicate submissions are prevented (check-in, check-out, evidence, completion)
[ ] Historical execution remains intact after later master-data changes
```

## Performance Checklist (§109 — re-verified at Phase 8)

```
[ ] 3,000+ locations tested
[ ] Map clustering works
[ ] Server-side pagination works on the execution matrix
[ ] Dashboard queries optimized (no unbounded select('*'))
[ ] Bulk import tested at realistic volume
[ ] Bulk assignment tested
[ ] Evidence listing/signed-URL issuance optimized (no N+1)
[ ] Export tested at scale
[ ] Mobile PIC execution flow tested on a real device/network
[ ] Concurrent execution (multiple PICs checking in simultaneously) tested
```
