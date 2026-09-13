# Field Service — Deviation Log

Record of every place the Field Service module deliberately deviates from an established
platform-wide convention (per `docs/field-service-audit.md`), with justification. A deviation is
different from a decision (`field-service-decision-log.md`): it specifically marks "we are *not*
following the existing pattern here, on purpose."

---

### D-001 — Repository state at session start did not match the task premise

**Convention assumed by the task:** An existing, feature-complete Work Management application to
audit and extend.
**What was actually found:** `main` and the designated branch contained only a README. The real
application (430 files) was pushed to `main` during this session, after the task began.
**Resolution:** Confirmed with the user, then rebuilt the designated branch from the corrected
`main`. Not a deviation in the code sense, but recorded here because it affects how every other
entry in this log and the audit should be read (i.e., against the corrected `main`, not the
original empty state).

### D-002 — First private Storage bucket + signed URLs

**Convention:** Every existing Supabase Storage bucket (`reminder-photos`, `ticket-photos`,
`project-files`, `movement-files`, `review-photos`, `learning-answers`) is public; access control
is "unguessable URL" only, explicitly flagged as deferred tech debt in existing hardening audits.
**Deviation:** `fs-evidence` will be created as a **private** bucket, read via short-TTL
`createSignedUrl`, gated by an application-layer authorization check.
**Justification:** Instruction §32 explicitly requires "private storage, signed URLs, enforce
authorization before file access, prevent unauthorized evidence enumeration" for proof-of-
execution evidence. This is a named requirement of the product, not incidental — the deviation is
intentional and scoped to the new bucket only; no existing bucket is touched.

### D-003 — `Permissions-Policy: geolocation` narrowed from fully-blocked to same-origin

**Convention:** `next.config.js` currently sets `Permissions-Policy: geolocation=()`, disabling
the browser Geolocation API platform-wide.
**Deviation:** Will be changed to `geolocation=(self)` (same-origin only, still blocked for any
third-party/embedded context) so the PIC check-in/out flow can call
`navigator.geolocation.getCurrentPosition`.
**Justification:** GPS check-in is a core, named requirement (instruction §20, §27–28). Scoping to
`self` (rather than removing the header/opening it wide) keeps the rest of the existing security
header posture intact — this is the one line in `next.config.js` this project is allowed to touch,
per the audit's "additive module" constraint.

### D-004 — `user_id`-keyed RLS ownership instead of name-based matching

**Convention:** Most existing write-policies match ownership via `full_name`/`username` JWT-claim
equality (`assign_name = jwt_full_name()`), a pattern with a documented self-rename exposure.
**Deviation:** All new `fs_*` RLS policies and the check-in RPC key exclusively on
`user_id`/`jwt_user_id()`.
**Justification:** See decision log DEC-003 — this is the only way to make the instruction's
"assignment is the authorization boundary, and must never be bypassable" guarantee hold.

### D-005 — DB-enforced status state machine (new pattern, not present elsewhere)

**Convention:** No existing table enforces status-transition ordering at the database level;
status is a free-text CHECK-enum column with no transition guard.
**Deviation:** `fs_execution_instances.status` changes are only permitted through
`fs_status_transition()`, which rejects any transition not on an explicit allow-list.
**Justification:** See decision log DEC-005 — required to guarantee `COMPLETED ≠ VERIFIED` and
that providers cannot self-verify (instruction §33, §87), which free-text status cannot guarantee.

### D-006 — `lingkup_semua()` is not reused for PIC scoping

**Convention:** `lingkup_semua()` (existing RLS helper) grants broad, near-admin data visibility
to **any** user with `role = 'team'`.
**Deviation:** A `FIELD_PIC` (`fs_role`) user's visibility into `fs_*` tables is computed by a new,
narrower `fs_is_assigned(...)` helper — never by `lingkup_semua()` — even though many `team`-role
users will also hold `fs_role = 'FIELD_PIC'`.
**Justification:** Instruction's core rule is that assignment, not team membership, is the
authorization boundary. Reusing the broad `team` grant would silently let any team member see
every location, defeating the purpose of the module.
