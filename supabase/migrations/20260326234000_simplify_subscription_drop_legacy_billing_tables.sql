-- Simplify subscription model to single plan + seats in company_subscriptions.
-- Removes dependency on billing_plans / billing_addons and drops legacy tables.

begin;

-- 1) Normalize paid seats from legacy addon rows before removing addons.
do $$
begin
  if to_regclass('public.company_subscription_addons') is not null
     and to_regclass('public.billing_addons') is not null then
    execute $q$
      with addon_extra as (
        select
          csa.subscription_id,
          coalesce(sum(csa.quantity) filter (where ba.code = 'extra_seat'), 0)::int as extra_seats
        from public.company_subscription_addons csa
        join public.billing_addons ba on ba.id = csa.addon_id
        group by csa.subscription_id
      )
      update public.company_subscriptions cs
      set
        paid_seats_total = greatest(coalesce(cs.paid_seats_total, 1), 1 + coalesce(a.extra_seats, 0)),
        paid_seats_additional = greatest(0, greatest(coalesce(cs.paid_seats_total, 1), 1 + coalesce(a.extra_seats, 0)) - 1),
        updated_at = now()
      from addon_extra a
      where cs.id = a.subscription_id
    $q$;
  end if;
end
$$;

update public.company_subscriptions
set
  paid_seats_total = coalesce(paid_seats_total, 1),
  paid_seats_additional = greatest(0, coalesce(paid_seats_total, 1) - 1),
  updated_at = now()
where paid_seats_total is null
   or paid_seats_additional is null;

-- 2) plan_id becomes optional (single-plan model no longer needs billing_plans FK).
alter table if exists public.company_subscriptions
  alter column plan_id drop not null;

-- 3) Recreate core subscription helpers without billing_* dependencies.
create or replace function public.ensure_company_subscription(p_company_id uuid)
returns public.company_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.company_subscriptions%rowtype;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'company not found: %', p_company_id;
  end if;

  select * into v_sub
  from public.company_subscriptions
  where company_id = p_company_id
  limit 1;

  if v_sub.id is null then
    insert into public.company_subscriptions (
      company_id,
      plan_id,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      grace_period_days,
      source,
      paid_seats_total,
      paid_seats_additional
    ) values (
      p_company_id,
      null,
      'active',
      now(),
      public.subscription_reporting_timestamp(now() + interval '14 days'),
      false,
      0,
      'manual',
      1,
      0
    )
    returning * into v_sub;
  end if;

  if v_sub.current_period_end is not null
     and v_sub.current_period_end <> public.subscription_reporting_timestamp(v_sub.current_period_end)
  then
    update public.company_subscriptions
    set
      current_period_end = public.subscription_reporting_timestamp(current_period_end),
      status = case when public.subscription_reporting_timestamp(current_period_end) >= now() then 'active' else 'expired' end,
      paid_seats_total = coalesce(paid_seats_total, 1),
      paid_seats_additional = greatest(0, coalesce(paid_seats_total, 1) - 1),
      updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
  elsif v_sub.status <> (case when v_sub.current_period_end >= now() then 'active' else 'expired' end)
     or v_sub.paid_seats_total is null
     or v_sub.paid_seats_additional is null
  then
    update public.company_subscriptions
    set
      status = case when current_period_end >= now() then 'active' else 'expired' end,
      paid_seats_total = coalesce(paid_seats_total, 1),
      paid_seats_additional = greatest(0, coalesce(paid_seats_total, 1) - 1),
      updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
  end if;

  return v_sub;
end;
$$;

create or replace function public.get_company_entitlements(p_company_id uuid)
returns table(
  company_id uuid,
  is_owner boolean,
  plan_code text,
  plan_name text,
  status text,
  current_period_end timestamptz,
  grace_period_days int,
  can_edit boolean,
  days_left int,
  allowed_seats int,
  used_seats int,
  allowed_storage_gb int,
  used_storage_gb numeric,
  features jsonb,
  addons jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_member boolean;
  v_is_owner boolean;
  v_sub public.company_subscriptions%rowtype;
  v_policy text;
  v_allowed_seats int;
begin
  v_is_member := public.is_company_member(p_company_id);
  v_is_owner := public.is_company_owner(p_company_id);

  if not v_is_member and not v_is_owner then
    raise exception 'access denied to company %', p_company_id using errcode = '42501';
  end if;

  v_sub := public.ensure_company_subscription(p_company_id);
  v_policy := public.company_seat_overlimit_policy(p_company_id);
  v_allowed_seats := greatest(0, coalesce(v_sub.paid_seats_total, 1));

  return query
  with used as (
    select public.company_used_seats(p_company_id) as used_seats,
           0::numeric as used_storage_gb
  )
  select
    p_company_id as company_id,
    v_is_owner as is_owner,
    case when v_is_owner then 'subscription_base' else null end as plan_code,
    case when v_is_owner then 'Subscription' else null end as plan_name,
    case when v_sub.current_period_end >= now() then 'active' else 'expired' end as status,
    v_sub.current_period_end,
    0 as grace_period_days,
    public.billing_can_edit_company(p_company_id) as can_edit,
    case
      when v_sub.current_period_end is null or v_sub.current_period_end <= now() then 0
      else ceil(extract(epoch from (v_sub.current_period_end - now())) / 86400.0)::int
    end as days_left,
    case when v_is_owner then v_allowed_seats else null end as allowed_seats,
    u.used_seats,
    null::int as allowed_storage_gb,
    u.used_storage_gb,
    jsonb_build_object(
      'seat_policy', v_policy,
      'is_over_limit', (u.used_seats > v_allowed_seats),
      'over_limit_by', greatest(0, u.used_seats - v_allowed_seats),
      'can_add_members', public.can_company_add_member(p_company_id)
    ) as features,
    '{}'::jsonb as addons
  from used u;
end;
$$;

create or replace function public.admin_list_companies(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table(
  company_id uuid,
  name text,
  timezone text,
  currency text,
  employees_count int,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_super_admin();

  return query
  select
    c.id as company_id,
    c.name,
    c.timezone,
    c.currency,
    public.admin_company_employees_count(c.id) as employees_count,
    'subscription_base'::text as plan_code,
    case
      when cs.current_period_end is not null and cs.current_period_end >= now() then 'active'
      else 'expired'
    end as subscription_status,
    cs.current_period_end,
    c.updated_at
  from public.companies c
  left join public.company_subscriptions cs on cs.company_id = c.id
  where
    coalesce(p_search, '') = ''
    or coalesce(c.name, '') ilike ('%' || p_search || '%')
    or c.id::text ilike ('%' || p_search || '%')
  order by coalesce(c.name, c.id::text)
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.admin_get_company(p_company_id uuid)
returns table(
  company_id uuid,
  name text,
  timezone text,
  currency text,
  employees_count int,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  grace_period_days int,
  extra_seats int,
  extra_storage_gb int,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_super_admin();

  return query
  select
    c.id as company_id,
    c.name,
    c.timezone,
    c.currency,
    public.admin_company_employees_count(c.id) as employees_count,
    'subscription_base'::text as plan_code,
    case
      when cs.current_period_end is null or cs.current_period_end < now() then 'expired'
      else 'active'
    end as subscription_status,
    cs.current_period_end,
    coalesce(cs.grace_period_days, 0) as grace_period_days,
    greatest(0, coalesce(cs.paid_seats_total, 1) - 1) as extra_seats,
    0::int as extra_storage_gb,
    c.created_at,
    c.updated_at
  from public.companies c
  left join public.company_subscriptions cs on cs.company_id = c.id
  where c.id = p_company_id
  limit 1;
end;
$$;

create or replace function public.admin_get_company_subscription_meta(p_company_id uuid)
returns table(
  company_id uuid,
  plan_code text,
  subscription_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_period_days int,
  cancel_at_period_end boolean,
  source text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_super_admin();
  perform public.ensure_company_subscription(p_company_id);

  return query
  select
    cs.company_id,
    'subscription_base'::text as plan_code,
    case when cs.current_period_end >= now() then 'active' else 'expired' end as subscription_status,
    cs.current_period_start,
    cs.current_period_end,
    0 as grace_period_days,
    coalesce(cs.cancel_at_period_end, false) as cancel_at_period_end,
    cs.source
  from public.company_subscriptions cs
  where cs.company_id = p_company_id
  limit 1;
end;
$$;

create or replace function public.admin_set_company_subscription_super(
  p_company_id uuid,
  p_plan_code text default null,
  p_status text default null,
  p_period_end timestamptz default null,
  p_grace_period_days int default null,
  p_extra_seats int default null,
  p_extra_storage_gb int default null,
  p_cancel_at_period_end boolean default null,
  p_addons_json jsonb default null
)
returns public.company_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.company_subscriptions%rowtype;
  v_sub public.company_subscriptions%rowtype;
  v_status text;
  v_period_end timestamptz;
  v_cancel_at_period_end boolean;
  v_paid_total int;
begin
  perform public.admin_assert_super_admin();

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'company not found: %', p_company_id;
  end if;

  v_existing := public.ensure_company_subscription(p_company_id);

  v_period_end := public.subscription_reporting_timestamp(
    coalesce(p_period_end, v_existing.current_period_end, now() + interval '30 days')
  );
  v_status := coalesce(
    case when p_status in ('active', 'expired') then p_status else null end,
    case when v_period_end >= now() then 'active' else 'expired' end
  );
  v_cancel_at_period_end := coalesce(p_cancel_at_period_end, v_existing.cancel_at_period_end, false);

  insert into public.company_subscriptions (
    company_id,
    plan_id,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    grace_period_days,
    source,
    paid_seats_total,
    paid_seats_additional
  ) values (
    p_company_id,
    null,
    v_status,
    coalesce(v_existing.current_period_start, now()),
    v_period_end,
    v_cancel_at_period_end,
    0,
    'admin',
    coalesce(v_existing.paid_seats_total, 1),
    coalesce(v_existing.paid_seats_additional, greatest(0, coalesce(v_existing.paid_seats_total, 1) - 1))
  )
  on conflict (company_id)
  do update set
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    grace_period_days = 0,
    source = 'admin',
    updated_at = now()
  returning * into v_sub;

  if p_extra_seats is not null then
    if v_period_end > now() then
      v_paid_total := greatest(1, 1 + greatest(0, p_extra_seats));
    else
      v_paid_total := 0;
    end if;

    update public.company_subscriptions
    set
      paid_seats_total = v_paid_total,
      paid_seats_additional = greatest(0, v_paid_total - 1),
      updated_at = now()
    where company_id = p_company_id
    returning * into v_sub;

    perform public.enforce_seat_limit(p_company_id);
  end if;

  perform public.repair_company_seat_pool(p_company_id);

  return v_sub;
end;
$$;

-- 4) Keep grants explicit.
grant execute on function public.ensure_company_subscription(uuid) to authenticated;
grant execute on function public.get_company_entitlements(uuid) to authenticated;
grant execute on function public.admin_list_companies(text, int, int) to authenticated;
grant execute on function public.admin_get_company(uuid) to authenticated;
grant execute on function public.admin_get_company_subscription_meta(uuid) to authenticated;
grant execute on function public.admin_set_company_subscription_super(uuid, text, text, timestamptz, int, int, int, boolean, jsonb) to authenticated;

-- 5) Drop all FK constraints that still point to legacy billing tables.
do $$
declare
  r record;
begin
  if to_regclass('public.billing_plans') is not null then
    for r in
      select conrelid::regclass as tbl, conname
      from pg_constraint
      where contype = 'f'
        and confrelid = 'public.billing_plans'::regclass
    loop
      execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
    end loop;
  end if;

  if to_regclass('public.billing_addons') is not null then
    for r in
      select conrelid::regclass as tbl, conname
      from pg_constraint
      where contype = 'f'
        and confrelid = 'public.billing_addons'::regclass
    loop
      execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
    end loop;
  end if;
end
$$;

-- 6) Drop legacy functions that still depend on old billing tables.
do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_depend d on d.objid = p.oid and d.classid = 'pg_proc'::regclass
    where n.nspname = 'public'
      and d.refobjid in (
        to_regclass('public.billing_plans'),
        to_regclass('public.billing_addons'),
        to_regclass('public.company_subscription_addons')
      )
      and p.proname not in (
        'ensure_company_subscription',
        'get_company_entitlements',
        'admin_list_companies',
        'admin_get_company',
        'admin_get_company_subscription_meta',
        'admin_set_company_subscription_super'
      )
  loop
    execute format(
      'drop function if exists %I.%I(%s)',
      r.schema_name,
      r.function_name,
      r.identity_args
    );
  end loop;
end
$$;

-- 7) Remove legacy addon/plan storage.
drop table if exists public.company_subscription_addons;
drop table if exists public.billing_addons;
drop table if exists public.billing_plans;

commit;
