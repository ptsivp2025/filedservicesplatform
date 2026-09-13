-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 014
-- Audit trail generik untuk data master Field Service - siapa mengubah apa
-- dan kapan (docs/AUDIT-CONFIGURABILITY-NOTIFICATIONS-2026-09.md temuan
-- MEDIUM kedua). fs_reviews (005) sudah mencatat keputusan client
-- (VERIFIED/REVISION_REQUIRED) - ini melengkapi sisi DATA MASTER-nya:
-- lokasi/execution point/assignment/content yang diubah atau dihapus lewat
-- Admin Panel/Field Service.
--
-- Baris ini SENGAJA hanya menangkap DATA (trigger + tabel + RLS baca).
-- Halaman untuk MELIHAT riwayatnya belum dibangun di batch ini - datanya
-- sudah lengkap dan bisa langsung dibaca lewat Supabase SQL Editor atau
-- query PostgREST langsung sementara menunggu UI-nya menyusul.
-- ============================================================================

CREATE TABLE public.fs_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  action text NOT NULL,
  changed_by uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT fs_audit_log_action_check CHECK (action = ANY (ARRAY['INSERT', 'UPDATE', 'DELETE']))
);

CREATE INDEX idx_fs_audit_log_table_row ON public.fs_audit_log (table_name, row_id, created_at DESC);
CREATE INDEX idx_fs_audit_log_changed_by ON public.fs_audit_log (changed_by);

ALTER TABLE public.fs_audit_log ENABLE ROW LEVEL SECURITY;

-- Baca: PROVIDER_ADMIN saja - ini catatan internal, bukan sesuatu yang
-- ditampilkan ke Client atau PIC.
CREATE POLICY fs_audit_log_select ON public.fs_audit_log
  FOR SELECT TO anon, authenticated
  USING (fs_is_provider_admin());

-- Tidak ada policy INSERT/UPDATE/DELETE untuk anon/authenticated dengan
-- sengaja - satu-satunya jalan masuk adalah trigger di bawah, yang berjalan
-- SECURITY DEFINER (bukan lewat permintaan PostgREST biasa).

CREATE OR REPLACE FUNCTION public.fs_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.fs_audit_log (table_name, row_id, action, changed_by, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    COALESCE((NEW).id, (OLD).id),
    TG_OP,
    jwt_user_id(),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Data master Field Service yang paling penting diaudit - lokasi/titik/
-- assignment/content mengubah bagaimana operasi lapangan berjalan; fs_areas
-- dan fs_projects murni pengelompokan, tetap diaudit untuk kelengkapan
-- (mis. penghapusan project menghapus semuanya lewat cascade - riwayatnya
-- perlu terlihat dari sisi project juga, bukan cuma anak-anaknya).
CREATE TRIGGER trg_fs_audit_projects
  AFTER INSERT OR UPDATE OR DELETE ON public.fs_projects
  FOR EACH ROW EXECUTE FUNCTION public.fs_audit_trigger();

CREATE TRIGGER trg_fs_audit_areas
  AFTER INSERT OR UPDATE OR DELETE ON public.fs_areas
  FOR EACH ROW EXECUTE FUNCTION public.fs_audit_trigger();

CREATE TRIGGER trg_fs_audit_locations
  AFTER INSERT OR UPDATE OR DELETE ON public.fs_locations
  FOR EACH ROW EXECUTE FUNCTION public.fs_audit_trigger();

CREATE TRIGGER trg_fs_audit_execution_points
  AFTER INSERT OR UPDATE OR DELETE ON public.fs_execution_points
  FOR EACH ROW EXECUTE FUNCTION public.fs_audit_trigger();

CREATE TRIGGER trg_fs_audit_pic_assignments
  AFTER INSERT OR UPDATE OR DELETE ON public.fs_pic_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fs_audit_trigger();

CREATE TRIGGER trg_fs_audit_content
  AFTER INSERT OR UPDATE OR DELETE ON public.fs_content
  FOR EACH ROW EXECUTE FUNCTION public.fs_audit_trigger();
