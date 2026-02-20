-- sql/00_audit_licensing.sql
-- Licensing and access audit (SELECT-only)

-- 1) Core tables existence
SELECT
  t.table_schema,
  t.table_name,
  t.table_type
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'companies',
    'company_members',
    'profiles',
    'company_subscriptions',
    'company_subscription_addons',
    'billing_plans',
    'billing_addons',
    'super_admins',
    'company_seat_assignments'
  )
ORDER BY t.table_name;

-- 2) Columns relevant to roles/blocking/company links
SELECT
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('profiles', 'company_members', 'companies', 'company_subscriptions', 'super_admins')
  AND (
    c.column_name ILIKE '%role%'
    OR c.column_name ILIKE '%company%'
    OR c.column_name ILIKE '%suspend%'
    OR c.column_name ILIKE '%block%'
    OR c.column_name ILIKE '%active%'
    OR c.column_name ILIKE '%seat%'
    OR c.column_name ILIKE '%license%'
    OR c.column_name IN ('id', 'user_id', 'profile_id', 'email', 'created_at', 'updated_at')
  )
ORDER BY c.table_name, c.ordinal_position;

-- 3) Primary/unique/check constraints on core tables
SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.check_constraints cc
  ON cc.constraint_schema = tc.constraint_schema
 AND cc.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN (
    'profiles',
    'company_members',
    'companies',
    'company_subscriptions',
    'company_subscription_addons',
    'billing_plans',
    'billing_addons',
    'super_admins',
    'company_seat_assignments'
  )
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 4) Foreign keys among company/user tables
SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema AS referenced_schema,
  ccu.table_name AS referenced_table,
  ccu.column_name AS referenced_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND (
    tc.table_name IN ('profiles', 'company_members', 'companies', 'company_subscriptions', 'company_subscription_addons', 'super_admins', 'company_seat_assignments')
    OR ccu.table_name IN ('profiles', 'company_members', 'companies', 'company_subscriptions', 'company_subscription_addons', 'super_admins', 'company_seat_assignments')
  )
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;

-- 5) RLS status on core tables
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'profiles',
    'company_members',
    'companies',
    'company_subscriptions',
    'company_subscription_addons',
    'billing_plans',
    'billing_addons',
    'super_admins',
    'company_seat_assignments'
  )
ORDER BY c.relname;

-- 6) RLS policies on core tables
SELECT
  p.schemaname,
  p.tablename,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename IN (
    'profiles',
    'company_members',
    'companies',
    'company_subscriptions',
    'company_subscription_addons',
    'billing_plans',
    'billing_addons',
    'super_admins',
    'company_seat_assignments'
  )
ORDER BY p.tablename, p.policyname;

-- 7) Triggers related to licensing/blocking/access
SELECT
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN ('profiles', 'company_members', 'company_subscriptions', 'company_subscription_addons')
ORDER BY event_object_table, trigger_name, event_manipulation;

-- 8) Indexes related to company/user/blocking/seat fields
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'company_members', 'company_subscriptions', 'company_subscription_addons', 'companies', 'super_admins', 'company_seat_assignments')
ORDER BY tablename, indexname;

-- 9) Security-definer functions related to access/licensing/user management
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%company%'
    OR p.proname ILIKE '%seat%'
    OR p.proname ILIKE '%subscription%'
    OR p.proname ILIKE '%entitlement%'
    OR p.proname ILIKE '%invite%'
    OR p.proname ILIKE '%access%'
    OR p.proname ILIKE '%suspend%'
    OR p.proname ILIKE '%block%'
  )
ORDER BY p.proname, args;

-- 10) Function source snippets for critical functions
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_functiondef(p.oid) AS function_ddl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'invite_user',
    'get_company_entitlements',
    'billing_can_edit_company',
    'is_company_member',
    'is_company_owner',
    'is_super_admin',
    'admin_set_company_subscription_super',
    'admin_get_company',
    'admin_list_users',
    'admin_get_user_profile_full',
    'get_my_access_state'
  )
ORDER BY p.proname;

-- 11) Grants on core tables to authenticated/anons/service roles
SELECT
  grantee,
  table_schema,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles',
    'company_members',
    'companies',
    'company_subscriptions',
    'company_subscription_addons',
    'billing_plans',
    'billing_addons',
    'super_admins',
    'company_seat_assignments'
  )
  AND grantee IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY table_name, grantee, privilege_type;

-- 12) Approximate row counts (safe even if some tables are absent)
SELECT
  c.relname AS table_name,
  c.reltuples::bigint AS approx_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'profiles',
    'company_members',
    'companies',
    'company_subscriptions',
    'company_subscription_addons',
    'super_admins',
    'company_seat_assignments'
  )
ORDER BY c.relname;
