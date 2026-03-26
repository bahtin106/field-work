-- Revoke public authenticated rights and drop table CASCADE
-- 1) Revoke public role rights (anon/authenticated)
REVOKE ALL ON public.app_company_settings FROM anon;
REVOKE ALL ON public.app_company_settings FROM authenticated;

-- show grants after revoke
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='app_company_settings'
ORDER BY grantee, privilege_type;

-- 2) Drop table cascade
BEGIN;
  DROP TABLE public.app_company_settings CASCADE;
COMMIT;

-- 3) Verify removal
SELECT to_regclass('public.app_company_settings') AS original_exists;
