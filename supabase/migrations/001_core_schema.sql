-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 001
-- Core schema: auth/session, generic config, audit, notifications.
--
-- This replaces the old multi-module Work Management schema. Only the tables
-- backing the surviving base (custom auth/session, Admin Panel user
-- management, generic notifications, generic settings, audit trail, secret
-- storage) are recreated here. Field Service (`fs_*`) tables are defined in
-- later migrations (004+) — see docs/field-service-architecture.md.
--
-- Conventions carried over deliberately from the platform's prior schema
-- (see docs/field-service-audit.md §4-6 for the full rationale):
--   - No Supabase Auth. Custom session (user_sessions) + bcrypt
--     (user_credentials) + a self-issued PostgREST JWT (see 002, lib/db-token.ts).
--   - RLS policies read JWT claims via helper functions (jwt_claim/jwt_user_id/
--     jwt_full_name), never auth.uid().
--   - uuid primary keys via pgcrypto's gen_random_uuid().
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── users ─────────────────────────────────────────────────────────────────
-- Core account table (not Supabase Auth). Privileged columns are frozen
-- against client self-edit by the guard_users_privileged_columns trigger
-- (see 002_core_functions.sql) — only service-role (Admin Panel API routes)
-- may change them.
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  username text NOT NULL,
  role text NOT NULL DEFAULT 'guest',
  full_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  team_type text,
  phone_number text,
  -- Menu-level access control — see app/dashboard/_components/shared.ts
  -- (ALL_MENU_KEYS). Field Service menu keys get added there as the module
  -- is built; this column doesn't need to change shape.
  allowed_menus text[] NOT NULL DEFAULT ARRAY[]::text[],
  sales_division text,
  jabatan text,
  atasan_id uuid,
  is_internal_sales boolean NOT NULL DEFAULT false,
  access_level text NOT NULL DEFAULT 'guest',
  -- Verified only via /api/notifikasi/telegram (action 'hubungkan') — never
  -- typed in directly. Frozen against self-edit, same as role/access_level.
  telegram_chat_id text,
  -- Field Service role — additive dimension, independent of `role`/
  -- `access_level` (see docs/field-service-architecture.md §3,
  -- docs/field-service-decision-log.md DEC-004). NULL = not a Field Service
  -- user yet.
  fs_role text,
  PRIMARY KEY (id),
  UNIQUE (username),
  FOREIGN KEY (atasan_id) REFERENCES public.users(id) ON DELETE SET NULL,
  -- 'superadmin' added here even though no seed data uses it yet — the prior
  -- schema's CHECK omitted it while code/RLS referenced it throughout,
  -- a drift documented in docs/field-service-audit.md §3/§5.
  CONSTRAINT users_role_check CHECK (role = ANY (ARRAY['admin', 'superadmin', 'team', 'guest'])),
  CONSTRAINT users_access_level_check CHECK (access_level = ANY (ARRAY['full', 'guest'])),
  CONSTRAINT users_fs_role_check CHECK (
    fs_role IS NULL OR fs_role = ANY (ARRAY[
      'PROVIDER_ADMIN', 'PROVIDER_SUPERVISOR', 'FIELD_PIC',
      'CLIENT_ADMIN', 'CLIENT_MANAGER', 'CLIENT_VIEWER'
    ])
  )
);

CREATE INDEX idx_users_role ON public.users USING btree (role);
CREATE INDEX idx_users_username ON public.users USING btree (username);
CREATE INDEX idx_users_atasan_id ON public.users USING btree (atasan_id);
CREATE INDEX idx_users_fs_role ON public.users USING btree (fs_role) WHERE fs_role IS NOT NULL;

-- ── user_credentials ─────────────────────────────────────────────────────
-- bcrypt hash, separate from `users` so a leaked SELECT on users never
-- exposes it. Service-role only (see 003_core_rls.sql).
CREATE TABLE public.user_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  password_hash text NOT NULL,
  algorithm text NOT NULL DEFAULT 'bcrypt',
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (user_id),
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- ── user_sessions ────────────────────────────────────────────────────────
-- Only the SHA-256 hash of the session cookie token is stored — the raw
-- token never touches the database (see lib/server-auth.ts).
CREATE TABLE public.user_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL,
  ip_address text,
  user_agent text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (token_hash),
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_sessions_user ON public.user_sessions USING btree (user_id);
CREATE INDEX idx_user_sessions_token ON public.user_sessions USING btree (token_hash);
CREATE INDEX idx_user_sessions_exp ON public.user_sessions USING btree (expires_at);

-- ── login_attempts ───────────────────────────────────────────────────────
-- Brute-force lockout bookkeeping (5/15min per username, 30/15min per IP).
CREATE TABLE public.login_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  username text NOT NULL,
  ip_address text,
  attempted_at timestamptz DEFAULT now(),
  success boolean DEFAULT false,
  PRIMARY KEY (id)
);

CREATE INDEX idx_login_attempts_username ON public.login_attempts USING btree (username, attempted_at);
CREATE INDEX idx_login_attempts_ip ON public.login_attempts USING btree (ip_address, attempted_at);

-- ── password_reset_otps ──────────────────────────────────────────────────
-- SHA-256 hashed OTP (never the raw code), sent via WhatsApp.
CREATE TABLE public.password_reset_otps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  username text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX idx_otp_username ON public.password_reset_otps USING btree (username);

-- ── audit_trail ──────────────────────────────────────────────────────────
-- Generic cross-module audit log (lib/audit.ts). module='field-service' for
-- everything the new module logs — see the reuse strategy in
-- docs/field-service-audit.md §16.
CREATE TABLE public.audit_trail (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text,
  user_name text,
  action varchar(50) NOT NULL,
  module varchar(100) NOT NULL,
  target_id text,
  target_name text,
  old_value text,
  new_value text,
  notes text,
  ip_address varchar(50),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX idx_audit_trail_user_id ON public.audit_trail USING btree (user_id);
CREATE INDEX idx_audit_trail_module ON public.audit_trail USING btree (module);
CREATE INDEX idx_audit_trail_action ON public.audit_trail USING btree (action);
CREATE INDEX idx_audit_trail_created ON public.audit_trail USING btree (created_at DESC);

-- ── notifications ────────────────────────────────────────────────────────
-- Generic per-user in-app notification (lib/notifications.ts,
-- lib/notifikasi/router.ts). Field Service events route through here too.
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  type varchar(50) NOT NULL DEFAULT 'system',
  title text NOT NULL,
  body text,
  action_url varchar(255),
  ref_id text,
  created_by text,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);
CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created ON public.notifications USING btree (created_at DESC);

-- ── app_settings ─────────────────────────────────────────────────────────
-- Generic system-config store (kelompok/teams, notification channel
-- toggles, and — per the Field Service config plan — the SYSTEM DEFAULT
-- layer for GPS radius/evidence rules etc. under a namespaced key).
CREATE TABLE public.app_settings (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (key)
);

-- ── rahasia_integrasi ────────────────────────────────────────────────────
-- Server-only secret store for integrations (WhatsApp/Telegram provider
-- tokens etc.) — never readable by anon/authenticated (see 003_core_rls.sql).
CREATE TABLE public.rahasia_integrasi (
  kunci text NOT NULL,
  nilai text NOT NULL,
  diperbarui_pada timestamptz NOT NULL DEFAULT now(),
  diperbarui_oleh text,
  PRIMARY KEY (kunci)
);
