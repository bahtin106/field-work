begin;

-- 1) Integrity + Studio navigation (FK arrow).
alter table public.company_subscriptions
  drop constraint if exists company_subscriptions_company_id_fkey;

alter table public.company_subscriptions
  add constraint company_subscriptions_company_id_fkey
  foreign key (company_id)
  references public.companies(id)
  on delete cascade;

-- 2) Remove redundant index (covered by UNIQUE company_id index).
drop index if exists public.idx_company_subscriptions_company_id;

-- 3) Temporal integrity for subscription window.
alter table public.company_subscriptions
  drop constraint if exists company_subscriptions_period_window_check;

alter table public.company_subscriptions
  add constraint company_subscriptions_period_window_check
  check (current_period_end >= current_period_start);

-- 4) Drop legacy columns no longer used in single-plan model.
alter table public.company_subscriptions
  drop constraint if exists company_subscriptions_overlimit_grace_days_check,
  drop constraint if exists company_subscriptions_seat_overlimit_policy_check,
  drop constraint if exists company_subscriptions_paid_seats_additional_check;

alter table public.company_subscriptions
  drop column if exists plan_id,
  drop column if exists grace_period_days,
  drop column if exists seat_overlimit_policy,
  drop column if exists overlimit_grace_days,
  drop column if exists included_owner_seat,
  drop column if exists paid_seats_additional;

-- 5) Keep compatibility with existing app RPC calls while removing legacy fields.
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
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      source,
      paid_seats_total
    ) values (
      p_company_id,
      'active',
      now(),
      public.subscription_reporting_timestamp(now() + interval '14 days'),
      false,
      'manual',
      1
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
      paid_seats_total = greatest(1, coalesce(paid_seats_total, 1)),
      updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
  elsif v_sub.status <> (case when v_sub.current_period_end >= now() then 'active' else 'expired' end)
     or v_sub.paid_seats_total is null
  then
    update public.company_subscriptions
    set
      status = case when current_period_end >= now() then 'active' else 'expired' end,
      paid_seats_total = greatest(1, coalesce(paid_seats_total, 1)),
      updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
  end if;

  return v_sub;
end;
$$;

create or replace function public.apply_pending_seat_change_if_due(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.company_subscriptions%rowtype;
begin
  if p_company_id is null then
    return false;
  end if;

  select * into v_sub
  from public.company_subscriptions
  where company_id = p_company_id
  limit 1;

  if v_sub.id is null then
    return false;
  end if;

  if v_sub.pending_paid_seats_total is null or v_sub.pending_apply_at is null or now() < v_sub.pending_apply_at then
    return false;
  end if;

  update public.company_subscriptions
  set
    paid_seats_total = greatest(1, v_sub.pending_paid_seats_total),
    pending_paid_seats_total = null,
    pending_apply_at = null,
    updated_at = now()
  where company_id = p_company_id;

  perform public.enforce_seat_limit(p_company_id);
  return true;
end;
$$;

create or replace function public.set_paid_seats_total(
  p_company_id uuid,
  p_paid_seats_total integer,
  p_apply_next_period boolean default true
)
returns jsonb
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

  if p_paid_seats_total is null or p_paid_seats_total < 1 then
    raise exception 'paid_seats_total must be >= 1';
  end if;

  if not public.is_company_license_admin(p_company_id) then
    raise exception 'license admin access required for company %', p_company_id using errcode='42501';
  end if;

  v_sub := public.ensure_company_subscription(p_company_id);

  if coalesce(p_apply_next_period, true) and p_paid_seats_total < v_sub.paid_seats_total then
    update public.company_subscriptions
    set
      pending_paid_seats_total = p_paid_seats_total,
      pending_apply_at = v_sub.current_period_end,
      updated_at = now()
    where company_id = p_company_id;

    return jsonb_build_object(
      'ok', true,
      'scheduled', true,
      'apply_at', v_sub.current_period_end,
      'current_paid_seats_total', v_sub.paid_seats_total,
      'pending_paid_seats_total', p_paid_seats_total
    );
  end if;

  update public.company_subscriptions
  set
    paid_seats_total = p_paid_seats_total,
    pending_paid_seats_total = null,
    pending_apply_at = null,
    updated_at = now()
  where company_id = p_company_id;

  perform public.enforce_seat_limit(p_company_id);

  return jsonb_build_object(
    'ok', true,
    'scheduled', false,
    'paid_seats_total', p_paid_seats_total
  );
end;
$$;

create or replace function public.admin_set_company_seat_policy(
  p_company_id uuid,
  p_seat_overlimit_policy text,
  p_overlimit_grace_days integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_super_admin();
  perform public.ensure_company_subscription(p_company_id);

  update public.company_subscriptions
  set updated_at = now()
  where company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'seat_overlimit_policy', 'block_new_members',
    'overlimit_grace_days', 0,
    'note', 'Seat over-limit scenarios are disabled'
  );
end;
$$;

create or replace function public.admin_set_company_subscription_super(
  p_company_id uuid,
  p_plan_code text default null,
  p_status text default null,
  p_period_end timestamptz default null,
  p_grace_period_days integer default null,
  p_extra_seats integer default null,
  p_extra_storage_gb integer default null,
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
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    source,
    paid_seats_total
  )
  values (
    p_company_id,
    v_status,
    coalesce(v_existing.current_period_start, now()),
    v_period_end,
    v_cancel_at_period_end,
    'admin',
    greatest(1, coalesce(v_existing.paid_seats_total, 1))
  )
  on conflict (company_id)
  do update set
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    source = 'admin',
    updated_at = now()
  returning * into v_sub;

  if p_extra_seats is not null then
    v_paid_total := greatest(1, 1 + greatest(0, p_extra_seats));

    update public.company_subscriptions
    set
      paid_seats_total = v_paid_total,
      updated_at = now()
    where company_id = p_company_id
    returning * into v_sub;

    perform public.enforce_seat_limit(p_company_id);
  end if;

  perform public.repair_company_seat_pool(p_company_id);
  return v_sub;
end;
$$;

create or replace function public.admin_get_company(p_company_id uuid)
returns table(
  company_id uuid,
  name text,
  timezone text,
  currency text,
  employees_count integer,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  grace_period_days integer,
  extra_seats integer,
  extra_storage_gb integer,
  is_active boolean,
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
    0 as grace_period_days,
    greatest(0, coalesce(cs.paid_seats_total, 1) - 1) as extra_seats,
    0::int as extra_storage_gb,
    c.is_active,
    c.created_at,
    c.updated_at
  from public.companies c
  left join public.company_subscriptions cs on cs.company_id = c.id
  where c.id = p_company_id
  limit 1;
end;
$$;

commit;

