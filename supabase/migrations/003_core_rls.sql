-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 003
-- RLS: enable + policies for the core tables.
--
-- Run AFTER 002_core_functions.sql. Mirrors the platform's final/hardened
-- policy shapes (see docs/field-service-audit.md §5-6) rather than its
-- original, looser ones — in particular no table here has a `WITH CHECK
-- (true)` policy, which the audit flags as the platform's biggest recurring
-- RLS mistake (§14.3).
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rahasia_integrasi ENABLE ROW LEVEL SECURITY;

-- ── users ─────────────────────────────────────────────────────────────────
-- SELECT: any logged-in user (assignment pickers, org chart, PIC lists all
-- need to read the whole table) — anonymous reads are still denied.
CREATE POLICY users_baca ON public.users
  FOR SELECT TO anon, authenticated
  USING (jwt_claim('sub') <> '');

-- UPDATE: self (e.g. phone number on the Profile page), or an
-- admin/team-scope actor (e.g. org-chart supervisor mapping). Privileged
-- columns stay frozen by trg_guard_users_privileged regardless of this
-- policy passing.
CREATE POLICY users_ubah ON public.users
  FOR UPDATE TO anon, authenticated
  USING (id::text = jwt_claim('sub') OR lingkup_semua())
  WITH CHECK (id::text = jwt_claim('sub') OR lingkup_semua());

CREATE POLICY users_hapus ON public.users
  FOR DELETE TO anon, authenticated
  USING (jwt_claim('user_role') IN ('admin', 'superadmin'));

-- No INSERT policy: registration (app/api/auth/register) and admin-created
-- accounts (app/api/admin/users) both go through the service-role client,
-- which bypasses RLS entirely. A client-side INSERT policy is unnecessary
-- attack surface — see docs/field-service-audit.md §14.3.

-- ── audit_trail ──────────────────────────────────────────────────────────
CREATE POLICY audit_trail_baca ON public.audit_trail
  FOR SELECT TO anon, authenticated
  USING (jwt_claim('sub') <> '');

-- Scoped to the caller's own id — logAudit() (lib/audit.ts) always writes
-- user_id = the caller's own id, so a forged audit entry attributed to
-- someone else is rejected at the database, not just unused by the client.
CREATE POLICY audit_trail_tambah ON public.audit_trail
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id = jwt_claim('sub'));

-- ── notifications ────────────────────────────────────────────────────────
-- Split per-command (not a single FOR ALL) so INSERT can stay open enough
-- to notify someone else, while SELECT/UPDATE/DELETE stay scoped to the
-- owner or an admin — this is what stops a non-admin from redirecting or
-- reading another user's notification.
CREATE POLICY nt_select ON public.notifications
  FOR SELECT TO anon, authenticated
  USING (user_id = jwt_claim('sub') OR admin_atau_full_access());

CREATE POLICY nt_insert ON public.notifications
  FOR INSERT TO anon, authenticated
  WITH CHECK (jwt_claim('sub') <> '');

CREATE POLICY nt_update ON public.notifications
  FOR UPDATE TO anon, authenticated
  USING (user_id = jwt_claim('sub') OR admin_atau_full_access())
  WITH CHECK (user_id = jwt_claim('sub') OR admin_atau_full_access());

CREATE POLICY nt_delete ON public.notifications
  FOR DELETE TO anon, authenticated
  USING (user_id = jwt_claim('sub') OR admin_atau_full_access());

-- ── app_settings ─────────────────────────────────────────────────────────
-- Readable by anyone logged in EXCEPT secret-looking keys (kunci_rahasia) —
-- those never belong here in the first place (trg_tolak_rahasia_di_pengaturan
-- blocks writing them), this is the read-side backstop.
CREATE POLICY as_baca ON public.app_settings
  FOR SELECT TO anon, authenticated
  USING (NOT kunci_rahasia(key));

CREATE POLICY as_insert ON public.app_settings
  FOR INSERT TO anon, authenticated
  WITH CHECK (boleh_tulis_pengaturan());

CREATE POLICY as_update ON public.app_settings
  FOR UPDATE TO anon, authenticated
  USING (boleh_tulis_pengaturan())
  WITH CHECK (boleh_tulis_pengaturan());

CREATE POLICY as_delete ON public.app_settings
  FOR DELETE TO anon, authenticated
  USING (boleh_tulis_pengaturan());

-- ── Deny-all-to-client tables ────────────────────────────────────────────
-- user_credentials, user_sessions, login_attempts, password_reset_otps,
-- rahasia_integrasi: RLS is enabled above with NO policies for
-- anon/authenticated, which means PostgREST denies every operation from the
-- browser — these are accessed exclusively via service-role from server-side
-- route handlers (lib/server-auth.ts, lib/supabase-admin.ts,
-- lib/rahasia-server.ts). This is deliberate, not an oversight — see
-- docs/field-service-audit.md §5-6.
