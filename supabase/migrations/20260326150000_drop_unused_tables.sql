-- Drop unused tables and dead functions
-- Tables verified: no app code refs, no DB triggers, no FK dependencies, no active function calls

begin;

-- Drop dead functions first
drop function if exists public.log_audit;
drop function if exists public.list_audit_logs;

-- Drop tables (CASCADE to remove dependent RLS policies)
drop table if exists public.crew_members cascade;
drop table if exists public.crews cascade;
drop table if exists public.billing_events cascade;
drop table if exists public.app_admins cascade;
drop table if exists public.app_audit_log cascade;
drop table if exists public._backup_profiles_policies cascade;

commit;
