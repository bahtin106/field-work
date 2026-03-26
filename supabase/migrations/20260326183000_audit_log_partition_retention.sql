begin;

-- 1) Prepare new partitioned audit table (drop-in replacement).
create table if not exists public._app_entity_audit_log_new (
  id uuid not null default gen_random_uuid(),
  company_id uuid,
  entity_type text not null,
  entity_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_user_id uuid,
  before_data jsonb,
  after_data jsonb,
  changed_fields text[],
  created_at timestamptz not null default now(),
  primary key (created_at, id)
) partition by range (created_at);

-- Default partition to avoid write failures if a future partition was not created yet.
create table if not exists public.app_entity_audit_log_default
  partition of public._app_entity_audit_log_new
  default;

-- Current month + next 3 months partitions.
do $$
declare
  v_start date := date_trunc('month', now())::date;
  v_from date;
  v_to date;
  v_name text;
begin
  for i in 0..3 loop
    v_from := (v_start + make_interval(months => i))::date;
    v_to := (v_start + make_interval(months => i + 1))::date;
    v_name := format('app_entity_audit_log_p%s', to_char(v_from, 'YYYYMM'));
    execute format(
      'create table if not exists public.%I partition of public._app_entity_audit_log_new for values from (%L) to (%L)',
      v_name,
      v_from,
      v_to
    );
  end loop;
end
$$;

-- Partitioned indexes.
create index if not exists _app_entity_audit_log_new_company_created_idx
  on public._app_entity_audit_log_new(company_id, created_at desc);
create index if not exists _app_entity_audit_log_new_entity_idx
  on public._app_entity_audit_log_new(entity_type, entity_id, created_at desc);
create index if not exists _app_entity_audit_log_new_actor_created_idx
  on public._app_entity_audit_log_new(actor_user_id, created_at desc);

-- 2) Backfill existing data once.
insert into public._app_entity_audit_log_new (
  id, company_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, changed_fields, created_at
)
select
  id, company_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, null::text[], created_at
from public.app_entity_audit_log;

-- 3) Atomic swap.
alter table public.app_entity_audit_log rename to _app_entity_audit_log_legacy_20260326;
alter table public._app_entity_audit_log_new rename to app_entity_audit_log;

-- 4) Keep security contract.
alter table public.app_entity_audit_log enable row level security;

drop policy if exists app_entity_audit_log_select_company on public.app_entity_audit_log;
create policy app_entity_audit_log_select_company
on public.app_entity_audit_log
for select
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canViewFinanceStatsAll',
    finance_permission_default(user_role(), 'canViewFinanceStatsAll')
  )
);

grant select on public.app_entity_audit_log to authenticated;

-- 5) Upgrade audit trigger writer to avoid noisy updates and expose changed fields.
create or replace function public.entity_audit_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(tg_op);
  v_company_id uuid;
  v_entity_id text;
  v_before jsonb;
  v_after jsonb;
  v_before_cmp jsonb;
  v_after_cmp jsonb;
  v_changed_fields text[];
  v_noise_keys text[] := array[
    'updated_at',
    'updated_by',
    'finance_calculated_at'
  ];
begin
  if v_action = 'insert' then
    v_after := to_jsonb(new);
    v_before := null;
    v_changed_fields := null;
  elsif v_action = 'update' then
    v_after := to_jsonb(new);
    v_before := to_jsonb(old);

    v_before_cmp := coalesce(v_before, '{}'::jsonb) - v_noise_keys;
    v_after_cmp := coalesce(v_after, '{}'::jsonb) - v_noise_keys;

    if v_after_cmp = v_before_cmp then
      return coalesce(new, old);
    end if;

    select coalesce(array_agg(k order by k), '{}'::text[])
      into v_changed_fields
    from (
      select jsonb_object_keys as k
      from jsonb_object_keys(v_before_cmp || v_after_cmp)
    ) keys
    where v_before_cmp -> keys.k is distinct from v_after_cmp -> keys.k;
  else
    v_after := null;
    v_before := to_jsonb(old);
    v_changed_fields := null;
  end if;

  v_company_id := coalesce((v_after->>'company_id')::uuid, (v_before->>'company_id')::uuid);
  v_entity_id := coalesce(v_after->>'id', v_before->>'id', 'unknown');

  insert into public.app_entity_audit_log (
    company_id,
    entity_type,
    entity_id,
    action,
    actor_user_id,
    before_data,
    after_data,
    changed_fields
  ) values (
    v_company_id,
    tg_table_name,
    v_entity_id,
    v_action,
    auth.uid(),
    v_before,
    v_after,
    v_changed_fields
  );

  return coalesce(new, old);
end;
$$;

-- 6) Maintenance helpers: create partitions ahead and prune old partitions.
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
  end loop;
end;
$$;

create or replace function public.prune_app_entity_audit_log_partitions(p_keep_months integer default 18)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep integer := greatest(coalesce(p_keep_months, 18), 1);
  v_cutoff date := (date_trunc('month', now()) - make_interval(months => v_keep))::date;
  v_dropped integer := 0;
  r record;
  v_partition_month date;
begin
  for r in
    select c.relname as partition_name
    from pg_inherits i
    join pg_class p on p.oid = i.inhparent
    join pg_namespace pn on pn.oid = p.relnamespace
    join pg_class c on c.oid = i.inhrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    where pn.nspname = 'public'
      and p.relname = 'app_entity_audit_log'
      and cn.nspname = 'public'
      and c.relname like 'app_entity_audit_log_p%'
  loop
    begin
      v_partition_month := to_date(substring(r.partition_name from 'p([0-9]{6})$'), 'YYYYMM');
    exception when others then
      v_partition_month := null;
    end;

    if v_partition_month is not null and v_partition_month < v_cutoff then
      execute format('drop table if exists public.%I', r.partition_name);
      v_dropped := v_dropped + 1;
    end if;
  end loop;

  return v_dropped;
end;
$$;

create or replace function public.maintain_app_entity_audit_log(
  p_keep_months integer default 18,
  p_months_ahead integer default 3
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dropped integer;
begin
  perform public.ensure_app_entity_audit_log_partitions(p_months_ahead);
  select public.prune_app_entity_audit_log_partitions(p_keep_months) into v_dropped;
  return coalesce(v_dropped, 0);
end;
$$;

grant execute on function public.ensure_app_entity_audit_log_partitions(integer) to service_role;
grant execute on function public.prune_app_entity_audit_log_partitions(integer) to service_role;
grant execute on function public.maintain_app_entity_audit_log(integer, integer) to service_role;

-- Run once now.
select public.maintain_app_entity_audit_log(18, 3);

-- Optional scheduler via pg_cron, if installed.
do $$
declare
  v_exists boolean;
begin
  select exists(select 1 from pg_extension where extname = 'pg_cron') into v_exists;
  if v_exists then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'app_entity_audit_log_maintain';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'app_entity_audit_log_maintain',
      '17 2 * * *',
      'select public.maintain_app_entity_audit_log(18, 3);'
    );
  end if;
end
$$;

-- 7) Drop tiny legacy copy after successful swap.
drop table if exists public._app_entity_audit_log_legacy_20260326;

commit;
