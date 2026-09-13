# Field Service — Decision Log

Chronological record of non-obvious decisions made during the transformation, with rationale.
Append new entries; do not rewrite history.

---

### 2026-09-10 — DEC-001: Recreated the designated branch from the updated `main`

**Context:** The designated branch `claude/field-service-transformation-6qq2js` and the `main` it
was based on were both empty (README only) at session start. Mid-audit, the real 430-file
application was pushed to `main` (commit `72e61df`) and the old feature branch was deleted
upstream.
**Decision:** Recreated `claude/field-service-transformation-6qq2js` from the new `origin/main`
(`git checkout -B ... origin/main`) rather than continuing on the empty branch or fabricating an
audit of nonexistent code.
**Rationale:** The instruction's entire premise is transforming an *existing* application; an
empty repo has no baseline to audit or reuse. Confirmed with the user before proceeding.

### 2026-09-10 — DEC-002: New top-level entity named `fs_projects`, not `projects`

**Context:** The existing platform already has three different "project" concepts
(`project_requests`, `progress_projects`, `incentive_projects`) plus a `GlobalSearch` `ResultType`
union keyed on strings like `'project'`/`'progress'`.
**Decision:** All new Field Service tables are prefixed `fs_`; the client-engagement entity is
`fs_projects`, never bare `projects`.
**Rationale:** Avoids ambiguity with existing modules, existing search result types, and existing
developer mental model of "project" in this codebase.

### 2026-09-10 — DEC-003: PIC assignment ownership keyed on `user_id`, never on name

**Context:** The existing platform's RLS predominantly matches ownership by `full_name`/`username`
string equality, and has a documented self-rename privilege issue (users can edit their own
`full_name` and inherit another user's row ownership under RLS).
**Decision:** Every new Field Service table with an ownership/assignment concept uses a mandatory
`user_id uuid REFERENCES users(id)` column; RLS and the check-in RPC key exclusively on that.
**Rationale:** The instruction's core guarantee ("a PIC must never execute another PIC's assigned
location") cannot be reliably enforced on a mutable string; this is a hard requirement, not a
style preference.

### 2026-09-10 — DEC-004: Field Service roles are an additive column, not a replacement

**Context:** Existing global roles are `admin`/`team`/`guest` + `access_level` (`full`/`guest`) +
`allowed_menus`.
**Decision:** Add `users.fs_role` (nullable, six-value CHECK) instead of overloading or replacing
`role`.
**Rationale:** Preserves every existing role check across the rest of the platform untouched;
Field Service authorization composes with, rather than forks, the existing model.

### 2026-09-10 — DEC-005: Status transitions enforced by a single allow-list function

**Context:** No table in the existing platform enforces status-transition ordering at the DB
level; several modules have documented "illegal transition" bugs as a result (e.g. tickets moving
`Solved → Pending` freely).
**Decision:** All `fs_execution_instances` status changes go through one
`fs_status_transition(instance_id, new_status)` `SECURITY DEFINER` function with an explicit
`(from, to, allowed_actor_role)` allow-list, rather than raw `UPDATE ... SET status`.
**Rationale:** This is the mechanism that guarantees `COMPLETED ≠ VERIFIED` and "provider cannot
self-verify" — both explicit, non-negotiable instruction requirements.
