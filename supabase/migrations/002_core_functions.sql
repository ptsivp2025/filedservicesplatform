-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 002
-- RLS helper functions + privileged-column guard triggers.
--
-- Run AFTER 001_core_schema.sql, BEFORE 003_core_rls.sql (policies below call
-- these functions). This is the platform's established RLS pattern (no
-- Supabase Auth, so no auth.uid() — identity comes from a self-issued JWT's
-- claims, read via jwt_claim()). See docs/field-service-audit.md §5-6.
-- ============================================================================

-- Read a claim from the PostgREST request JWT. Empty string, never NULL, so
-- callers can safely compare with <> '' / = 'x' without NULL-handling.
CREATE OR REPLACE FUNCTION public.jwt_claim(nama text)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(current_setting('request.jwt.claims', true)::json ->> nama, '');
$$;

CREATE OR REPLACE FUNCTION public.jwt_full_name()
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jwt_claim('full_name');
$$;

CREATE OR REPLACE FUNCTION public.jwt_user_id()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT NULLIF(jwt_claim('sub'), '')::uuid;
$$;

-- Broad/admin-equivalent scope. NOTE: per docs/field-service-deviation-log.md
-- D-006, Field Service PIC/client scoping must NOT reuse this for
-- fs_* authorization (it grants any 'team' role broad access) — a narrower
-- fs_is_assigned()-style helper is introduced with the fs_* schema instead.
CREATE OR REPLACE FUNCTION public.lingkup_semua()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jwt_claim('user_role') IN ('admin', 'superadmin', 'team');
$$;

-- Narrower than lingkup_semua(): admin/superadmin, or the "Full Access"
-- per-account toggle — NOT every 'team' role. Used where a policy should
-- distinguish "manages this record" from "is on the internal team".
CREATE OR REPLACE FUNCTION public.admin_atau_full_access()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jwt_claim('user_role') = ANY (ARRAY['admin', 'superadmin'])
      OR jwt_claim('access_level') = 'full';
$$;

CREATE OR REPLACE FUNCTION public.boleh_tulis_pengaturan()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT lingkup_semua();
$$;

-- Blocks obviously secret-looking keys from ever landing in app_settings
-- (which is client-readable) — secrets belong in rahasia_integrasi or an
-- environment variable instead.
CREATE OR REPLACE FUNCTION public.kunci_rahasia(k text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT k ~* '(token|secret|api_?key|password|credential)';
$$;

CREATE OR REPLACE FUNCTION public.tolak_rahasia_di_pengaturan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF kunci_rahasia(NEW.key) THEN
    RAISE EXCEPTION
      'app_settings bukan tempat menyimpan rahasia. Kunci "%" ditolak. Simpan token/secret sebagai environment variable Edge Function atau Vercel.',
      NEW.key
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tolak_rahasia_di_pengaturan
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.tolak_rahasia_di_pengaturan();

-- Freezes columns that must only ever change via service-role (Admin Panel
-- API routes) — role/access_level/allowed_menus/fs_role, plus identity
-- (username/full_name/jabatan) and scoping columns (sales_division,
-- is_internal_sales), matching the platform's most-hardened form of this
-- trigger (see sql/guard-users-scope-columns.sql for the history of why
-- each column was added). This is the trigger that makes the self-rename
-- privilege issue documented in docs/field-service-audit.md §14(2)
-- impossible for the `users` table itself.
CREATE OR REPLACE FUNCTION public.guard_users_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- No INSERT policy grants anon/authenticated write access to `users`
    -- (see 003_core_rls.sql) — registration goes through service-role
    -- (app/api/auth/register). This branch is defense-in-depth only.
    NEW.role         := 'guest';
    NEW.access_level := 'guest';
    NEW.fs_role      := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.role             := OLD.role;
    NEW.access_level     := OLD.access_level;
    NEW.allowed_menus    := OLD.allowed_menus;
    NEW.fs_role          := OLD.fs_role;
    NEW.telegram_chat_id := OLD.telegram_chat_id;
    NEW.username         := OLD.username;
    NEW.full_name        := OLD.full_name;
    NEW.jabatan          := OLD.jabatan;
    NEW.sales_division   := OLD.sales_division;
    NEW.is_internal_sales:= OLD.is_internal_sales;
    NEW.team_type        := OLD.team_type;

    IF NOT public.admin_atau_full_access() THEN
      NEW.atasan_id := OLD.atasan_id;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_users_privileged
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_users_privileged_columns();
