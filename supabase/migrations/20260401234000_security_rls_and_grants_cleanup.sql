begin;

-- =========================
-- A) app_entity_audit_log hardening
-- =========================

-- Parent stays queryable for authenticated via existing SELECT policy.
alter table public.app_entity_audit_log force row level security;

-- Tight grants on parent
revoke all on table public.app_entity_audit_log from anon;
revoke all on table public.app_entity_audit_log from public;
revoke all on table public.app_entity_audit_log from authenticated;

grant select on table public.app_entity_audit_log to authenticated;
grant select, insert on table public.app_entity_audit_log to service_role;

-- Existing partitions: enable RLS + remove direct public/auth access
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOR v_tbl IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'public.app_entity_audit_log'::regclass
      AND c.relkind = 'r'
  LOOP
    EXECUTE format('alter table public.%I enable row level security', v_tbl);
    EXECUTE format('revoke all on table public.%I from anon, authenticated, public', v_tbl);
    EXECUTE format('grant select on table public.%I to service_role', v_tbl);
  END LOOP;
END
$$;

-- Future partitions: auto-enable RLS and lock direct grants right after create.
create or replace function public.ensure_app_entity_audit_log_partitions(p_months_ahead integer default 3)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_months integer := greatest(coalesce(p_months_ahead, 3), 1);
  v_start date := date_trunc('month', now())::date;
  v_from date;
  v_to date;
  v_name text;
begin
  for i in 0..v_months loop
    v_from := (v_start + make_interval(months => i))::date;
    v_to := (v_start + make_interval(months => i + 1))::date;
    v_name := format('app_entity_audit_log_p%s', to_char(v_from, 'YYYYMM'));
    execute format(
      'create table if not exists public.%I partition of public.app_entity_audit_log for values from (%L) to (%L)',
      v_name,
      v_from,
      v_to
    );
    execute format('alter table public.%I enable row level security', v_name);
    execute format('revoke all on table public.%I from anon, authenticated, public', v_name);
    execute format('grant select on table public.%I to service_role', v_name);
  end loop;
end;
$$;

-- =========================
-- B) storage/admin tables: enable RLS and tighten grants
-- =========================

alter table public.admin_storage_sources enable row level security;
alter table public.admin_storage_metrics enable row level security;
alter table public.company_storage_usage_cache enable row level security;

revoke all on table public.admin_storage_sources from anon;
revoke all on table public.admin_storage_sources from authenticated;
revoke all on table public.admin_storage_sources from public;

grant select, insert, update, delete on table public.admin_storage_sources to service_role;

drop policy if exists admin_storage_sources_service_role_all on public.admin_storage_sources;
create policy admin_storage_sources_service_role_all
on public.admin_storage_sources
as permissive
for all
to service_role
using (true)
with check (true);

revoke all on table public.admin_storage_metrics from anon;
revoke all on table public.admin_storage_metrics from authenticated;
revoke all on table public.admin_storage_metrics from public;

grant select, insert, update, delete on table public.admin_storage_metrics to service_role;

drop policy if exists admin_storage_metrics_service_role_all on public.admin_storage_metrics;
create policy admin_storage_metrics_service_role_all
on public.admin_storage_metrics
as permissive
for all
to service_role
using (true)
with check (true);

revoke all on table public.company_storage_usage_cache from anon;
revoke all on table public.company_storage_usage_cache from authenticated;
revoke all on table public.company_storage_usage_cache from public;

grant select, insert, update, delete on table public.company_storage_usage_cache to service_role;

drop policy if exists company_storage_usage_cache_service_role_all on public.company_storage_usage_cache;
create policy company_storage_usage_cache_service_role_all
on public.company_storage_usage_cache
as permissive
for all
to service_role
using (true)
with check (true);

revoke all on sequence public.admin_storage_metrics_id_seq from anon, authenticated, public;
grant usage, select on sequence public.admin_storage_metrics_id_seq to service_role;

commit;
