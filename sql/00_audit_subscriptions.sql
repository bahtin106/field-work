-- sql/00_audit_subscriptions.sql
-- Safe DB audit for subscription rollout (read-only)
-- Contains SELECT statements and DO blocks with RAISE NOTICE only.

-- 1) List base schemas and tables
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('public', 'auth')
ORDER BY table_schema, table_name;

-- 2) Check candidate core tables
SELECT c.table_schema, c.table_name
FROM information_schema.tables c
WHERE (c.table_schema, c.table_name) IN (
  ('public', 'companies'),
  ('public', 'organizations'),
  ('public', 'company_members'),
  ('public', 'profiles'),
  ('public', 'users'),
  ('auth', 'users')
)
ORDER BY c.table_schema, c.table_name;

-- 3) Columns for candidate core tables (focus on company/owner/plan/payment)
SELECT c.table_schema,
       c.table_name,
       c.column_name,
       c.data_type,
       c.is_nullable,
       c.column_default
FROM information_schema.columns c
WHERE (c.table_schema, c.table_name) IN (
  ('public', 'companies'),
  ('public', 'organizations'),
  ('public', 'company_members'),
  ('public', 'profiles'),
  ('public', 'users'),
  ('auth', 'users')
)
OR (
  c.table_schema = 'public'
  AND (
    c.column_name ILIKE '%plan%'
    OR c.column_name ILIKE '%billing%'
    OR c.column_name ILIKE '%subscription%'
    OR c.column_name ILIKE '%payment%'
    OR c.column_name ILIKE '%tariff%'
  )
)
ORDER BY c.table_schema, c.table_name, c.ordinal_position;

-- 4) Tables with likely billing/subscription semantics
SELECT t.table_schema, t.table_name
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND (
    t.table_name ILIKE '%billing%'
    OR t.table_name ILIKE '%subscription%'
    OR t.table_name ILIKE '%payment%'
    OR t.table_name ILIKE '%plan%'
    OR t.table_name ILIKE '%tariff%'
  )
ORDER BY t.table_schema, t.table_name;

-- 5) Potential company relations in public.* (company_id/owner_id)
SELECT c.table_schema, c.table_name, c.column_name, c.data_type
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.column_name IN ('company_id', 'organization_id', 'owner_id', 'user_id', 'created_by')
ORDER BY c.table_name, c.column_name;

-- 6) Foreign keys that reference companies/organizations/profiles/auth.users
SELECT
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema AS references_schema,
  ccu.table_name AS references_table,
  ccu.column_name AS references_column,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND (
    ccu.table_name IN ('companies', 'organizations', 'profiles')
    OR (ccu.table_schema = 'auth' AND ccu.table_name = 'users')
  )
ORDER BY tc.table_name, kcu.column_name;

-- 7) Existing RLS state on key tables
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'companies',
    'organizations',
    'company_members',
    'profiles',
    'orders',
    'billing_plans',
    'billing_addons',
    'company_subscriptions',
    'company_subscription_addons',
    'billing_events'
  )
ORDER BY c.relname;

-- 8) Existing policies on key tables
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'companies',
    'organizations',
    'company_members',
    'profiles',
    'orders',
    'billing_plans',
    'billing_addons',
    'company_subscriptions',
    'company_subscription_addons',
    'billing_events'
  )
ORDER BY tablename, policyname;

-- 9) Diagnostic notices for missing/alternative core tables
DO $$
DECLARE
  has_companies boolean;
  has_organizations boolean;
  has_company_members boolean;
  has_profiles boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'companies'
  ) INTO has_companies;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organizations'
  ) INTO has_organizations;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_members'
  ) INTO has_company_members;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) INTO has_profiles;

  IF NOT has_companies AND has_organizations THEN
    RAISE NOTICE 'Found organizations but not companies. Migration should target organizations mapping.';
  ELSIF NOT has_companies THEN
    RAISE NOTICE 'Neither companies nor organizations table found in public schema.';
  END IF;

  IF NOT has_company_members THEN
    RAISE NOTICE 'company_members table not found. Ownership checks must fallback to profiles/companies columns.';
  END IF;

  IF NOT has_profiles THEN
    RAISE NOTICE 'profiles table not found. Ensure user-company relation source exists before applying subscription schema.';
  END IF;
END
$$;
