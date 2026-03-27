begin;

-- Normalize company names consistently in DB checks/indexes.
create or replace function public.normalize_company_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
$$;

-- Delete test companies by exact ids,
-- including rows in all BASE TABLES that have company_id.
do $$
declare
  v_target_company_ids uuid[] := array[
    '37501afa-a154-4bc7-92c6-9ef435c18319'::uuid,
    'd3cd290f-3f17-4055-a9bf-35a3ef9d5f3c'::uuid
  ];
  r record;
begin
  if coalesce(array_length(v_target_company_ids, 1), 0) = 0 then
    return;
  end if;

  for r in
    select distinct c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'company_id'
      and c.table_name <> 'companies'
      and t.table_type = 'BASE TABLE'
  loop
    execute format('delete from public.%I where company_id = any($1)', r.table_name)
      using v_target_company_ids;
  end loop;

  delete from public.companies c
  where c.id = any(v_target_company_ids);
end
$$;

-- Hard uniqueness for company names (case/space insensitive).
create unique index if not exists companies_name_normalized_uq
  on public.companies ((lower(public.normalize_company_name(name))));

-- Useful operational indexes.
create index if not exists companies_is_active_idx on public.companies (is_active);
create index if not exists companies_owner_id_idx on public.companies (owner_id);

-- Tighten table-level grants; rely on RLS for row-level control.
revoke all on table public.companies from anon, authenticated;
grant select, update on table public.companies to authenticated;
grant select, insert, update, delete on table public.companies to service_role;

-- Readable app validation helper (single source of truth with DB normalization).
create or replace function public.company_name_is_available(
  p_name text,
  p_exclude_company_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_norm text := public.normalize_company_name(p_name);
begin
  if auth.uid() is null then
    return false;
  end if;

  if v_norm is null then
    return false;
  end if;

  return not exists (
    select 1
    from public.companies c
    where lower(public.normalize_company_name(c.name)) = lower(v_norm)
      and (p_exclude_company_id is null or c.id <> p_exclude_company_id)
  );
end;
$$;

grant execute on function public.company_name_is_available(text, uuid) to authenticated;

-- Extend super-admin update function: include company active flag + robust name validation.
drop function if exists public.admin_update_company_super(uuid, text, text, text);

create or replace function public.admin_update_company_super(
  p_company_id uuid,
  p_name text default null,
  p_timezone text default null,
  p_currency text default null,
  p_is_active boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name_norm text;
  v_is_active boolean;
begin
  perform public.admin_assert_super_admin();

  if p_name is not null then
    v_name_norm := public.normalize_company_name(p_name);
    if v_name_norm is null then
      raise exception 'company name is required' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.companies c
      where c.id <> p_company_id
        and lower(public.normalize_company_name(c.name)) = lower(v_name_norm)
    ) then
      raise exception 'company with this name already exists' using errcode = '23505';
    end if;
  end if;

  update public.companies c
  set
    name = coalesce(v_name_norm, c.name),
    timezone = coalesce(p_timezone, c.timezone),
    currency = coalesce(p_currency, c.currency),
    is_active = coalesce(p_is_active, c.is_active)
  where c.id = p_company_id
  returning c.is_active into v_is_active;

  if not found then
    raise exception 'company not found: %', p_company_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'is_active', v_is_active
  );
end;
$$;

grant execute on function public.admin_update_company_super(uuid, text, text, text, boolean) to authenticated;

-- Dedicated super-admin toggle for company activation/deactivation.
create or replace function public.admin_set_company_active_super(
  p_company_id uuid,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_is_active boolean;
begin
  perform public.admin_assert_super_admin();

  update public.companies c
  set is_active = coalesce(p_is_active, c.is_active)
  where c.id = p_company_id
  returning c.is_active into v_effective_is_active;

  if not found then
    raise exception 'company not found: %', p_company_id;
  end if;

  if v_effective_is_active then
    update public.profiles p
    set
      is_admin_blocked = false,
      blocked_reason = null,
      updated_at = timezone('utc', now())
    where p.company_id = p_company_id
      and lower(coalesce(p.blocked_reason, '')) = 'company_inactive'
      and not exists (
        select 1
        from public.super_admins sa
        where sa.is_active = true
          and (sa.user_id = p.id or sa.profile_id = p.id)
      );
  else
    update public.profiles p
    set
      is_admin_blocked = true,
      blocked_reason = 'company_inactive',
      updated_at = timezone('utc', now())
    where p.company_id = p_company_id
      and not exists (
        select 1
        from public.super_admins sa
        where sa.is_active = true
          and (sa.user_id = p.id or sa.profile_id = p.id)
      );
  end if;

  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'is_active', v_effective_is_active
  );
end;
$$;

grant execute on function public.admin_set_company_active_super(uuid, boolean) to authenticated;

-- Keep admin company details aligned with new active flag.
drop function if exists public.admin_get_company(uuid);

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
    coalesce(cs.grace_period_days, 0) as grace_period_days,
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

grant execute on function public.admin_get_company(uuid) to authenticated;

-- Global login gate: inactive company blocks all company users, including company admins.
create or replace function public.get_my_access_state()
returns table(
  user_id uuid,
  company_id uuid,
  admin_blocked boolean,
  license_state text,
  has_seat boolean,
  can_login boolean,
  block_code text,
  block_message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_has_seat boolean := false;
  v_admin_blocked boolean := false;
  v_license_state text := 'active';
  v_can_login boolean := true;
  v_block_code text := null;
  v_block_message text := null;
  v_is_owner_or_admin boolean := false;
  v_subscription_active boolean := true;
  v_company_active boolean := true;
  v_is_super_admin boolean := false;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid
  limit 1;

  if v_profile.id is null then
    return query
    select
      v_uid,
      null::uuid,
      false,
      'active'::text,
      false,
      false,
      'profile_missing'::text,
      'Profile not found'::text;
    return;
  end if;

  v_is_super_admin := public.is_super_admin();

  if v_profile.company_id is not null then
    select coalesce(c.is_active, true)
      into v_company_active
    from public.companies c
    where c.id = v_profile.company_id;

    v_company_active := coalesce(v_company_active, true);

    perform public.apply_pending_seat_change_if_due(v_profile.company_id);
    v_has_seat := public.user_has_active_seat(v_profile.company_id, v_uid);
    v_is_owner_or_admin :=
      public.is_company_owner(v_profile.company_id)
      or lower(coalesce(v_profile.role, '')) = 'admin';
    v_subscription_active := public.billing_can_edit_company(v_profile.company_id);
  end if;

  v_admin_blocked := coalesce(v_profile.is_admin_blocked, false)
    or coalesce(v_profile.is_suspended, false)
    or lower(coalesce(v_profile.blocked_reason, '')) in ('manual', 'admin_block', 'admin_blocked', 'company_inactive');

  v_license_state := case
    when v_is_super_admin then 'active'
    when not v_company_active then 'blocked_by_company'
    when v_is_owner_or_admin then 'active'
    when not v_subscription_active then 'blocked_by_license'
    else coalesce(v_profile.license_state, case when v_has_seat then 'active' else 'blocked_by_license' end)
  end;

  if (not v_company_active) and (not v_is_super_admin) then
    v_can_login := false;
    v_block_code := 'company_inactive';
    v_block_message := 'Company is deactivated by super-admin.';
  elsif v_admin_blocked and (not v_is_super_admin) then
    v_can_login := false;
    v_block_code := 'admin_blocked';
    v_block_message := 'Access blocked by administrator';
  elsif v_is_super_admin then
    v_can_login := true;
    v_block_code := null;
    v_block_message := null;
  elsif v_is_owner_or_admin then
    v_can_login := true;
    v_block_code := null;
    v_block_message := null;
  elsif (not v_subscription_active) or v_license_state = 'blocked_by_license' or not v_has_seat then
    v_can_login := false;
    v_block_code := 'blocked_by_license';
    if not v_subscription_active then
      v_block_message := 'Subscription expired. Renew subscription to continue.';
    else
      v_block_message := 'No paid seat available. Contact your company administrator.';
    end if;
  else
    v_can_login := true;
  end if;

  return query
  select
    v_uid,
    v_profile.company_id,
    v_admin_blocked,
    v_license_state,
    v_has_seat,
    v_can_login,
    v_block_code,
    v_block_message;
end;
$$;

grant execute on function public.get_my_access_state() to authenticated;

commit;
