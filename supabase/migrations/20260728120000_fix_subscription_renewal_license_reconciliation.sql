begin;

-- Subscription state and caller authorization are different concerns.
-- Internal reconciliation can run as a super-admin/service operation, so it
-- must not depend on whether the caller is a member of the target company.
create or replace function public.company_subscription_is_active(p_company_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_company_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.company_subscriptions cs
    where cs.company_id = p_company_id
      and cs.current_period_end is not null
      and cs.current_period_end >= now()
  );
end;
$$;

revoke all on function public.company_subscription_is_active(uuid) from public;
revoke all on function public.company_subscription_is_active(uuid) from anon;
revoke all on function public.company_subscription_is_active(uuid) from authenticated;

create or replace function public.billing_can_edit_company(p_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sub public.company_subscriptions%rowtype;
begin
  -- Keep the existing application authorization boundary unchanged.
  -- Internal subscription reconciliation uses company_subscription_is_active()
  -- directly and therefore does not need broader access here.
  if not public.is_company_member(p_company_id) then
    return false;
  end if;

  v_sub := public.ensure_company_subscription(p_company_id);
  return v_sub.current_period_end >= now();
end;
$$;

grant execute on function public.billing_can_edit_company(uuid) to authenticated;

create or replace function public.company_used_seats(p_company_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if p_company_id is null then
    return 0;
  end if;

  select count(distinct s.user_id)::int
  into v_count
  from public.company_seat_assignments s
  join public.profiles p
    on p.id = s.user_id
   and p.company_id = p_company_id
  where s.company_id = p_company_id
    and s.revoked_at is null
    and lower(coalesce(p.role, '')) <> 'admin';

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.company_used_seats(uuid) to authenticated;

create or replace function public.auto_restore_license_blocked_members(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid int := 0;
  v_used int := 0;
  v_free int := 0;
  v_restored int := 0;
  v_inserted int := 0;
  v_user_id uuid;
begin
  if p_company_id is null then
    return 0;
  end if;

  if auth.uid() is not null
     and not public.is_company_license_admin(p_company_id)
     and not public.is_super_admin()
     and not public.is_company_owner(p_company_id)
  then
    raise exception 'license admin access required for company %', p_company_id using errcode = '42501';
  end if;

  if not public.company_subscription_is_active(p_company_id) then
    return 0;
  end if;

  -- Read the subscription row directly. Unlike the public reporting RPC,
  -- this sees the period update made earlier in the same renewal transaction.
  select greatest(1, coalesce(cs.paid_seats_total, 1))
  into v_paid
  from public.company_subscriptions cs
  where cs.company_id = p_company_id
  limit 1;

  select count(distinct s.user_id)::int
  into v_used
  from public.company_seat_assignments s
  join public.profiles p
    on p.id = s.user_id
   and p.company_id = p_company_id
  where s.company_id = p_company_id
    and s.revoked_at is null
    and lower(coalesce(p.role, '')) <> 'admin';

  v_free := greatest(0, coalesce(v_paid, 0) - coalesce(v_used, 0));
  if v_free <= 0 then
    return 0;
  end if;

  for v_user_id in
    with candidates as (
      select
        p.id as user_id,
        p.last_seen_at,
        p.blocked_reason,
        (
          select max(s.assigned_at)
          from public.company_seat_assignments s
          where s.company_id = p_company_id
            and s.user_id = p.id
        ) as last_assigned_at
      from public.profiles p
      where p.company_id = p_company_id
        and lower(coalesce(p.role, '')) <> 'admin'
        and coalesce(p.is_admin_blocked, false) = false
        and lower(coalesce(p.blocked_reason, '')) not in ('manual', 'admin_block', 'admin_blocked')
        and coalesce(p.license_state, 'active') = 'blocked_by_license'
        and not public.user_has_active_seat(p_company_id, p.id)
    )
    select c.user_id
    from candidates c
    order by
      case
        when lower(coalesce(c.blocked_reason, '')) in (
          'no_paid_seat',
          'subscription_expired',
          'auto_downgrade',
          'license_block'
        ) then 0
        else 1
      end,
      coalesce(c.last_seen_at, to_timestamp(0)) desc,
      coalesce(c.last_assigned_at, to_timestamp(0)) desc,
      c.user_id
    limit v_free
  loop
    insert into public.company_seat_assignments (company_id, user_id, reason)
    values (p_company_id, v_user_id, 'auto_restore')
    on conflict (company_id, user_id) where revoked_at is null do nothing;

    get diagnostics v_inserted = row_count;
    v_restored := v_restored + v_inserted;
  end loop;

  return v_restored;
end;
$$;

-- Seat increases and subscription renewals now share exactly one restoration
-- algorithm instead of maintaining two subtly different implementations.
create or replace function public.auto_restore_seats_after_increase(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.auto_restore_license_blocked_members(p_company_id);
end;
$$;

create or replace function public.repair_company_seat_pool(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked_not_in_company int := 0;
  v_revoked_admin_exempt int := 0;
  v_revoked_blocked int := 0;
  v_revoked_manual_blocked int := 0;
  v_revoked_duplicates int := 0;
  v_restored_auto int := 0;
  v_profiles_synced int := 0;
  v_subscription_active boolean := false;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if auth.uid() is not null
     and not public.is_company_license_admin(p_company_id)
     and not public.is_super_admin()
     and not public.is_company_owner(p_company_id)
  then
    raise exception 'license admin access required for company %', p_company_id using errcode = '42501';
  end if;

  with revoked as (
    update public.company_seat_assignments s
    set
      revoked_at = now(),
      reason = 'repair_not_in_company'
    from public.profiles p
    where s.company_id = p_company_id
      and s.revoked_at is null
      and p.id = s.user_id
      and p.company_id is distinct from p_company_id
    returning s.id
  )
  select count(*)::int into v_revoked_not_in_company from revoked;

  -- Company administrators have independent access and never consume an
  -- employee license. Remove any legacy assignment left after a role change.
  with revoked as (
    update public.company_seat_assignments s
    set
      revoked_at = now(),
      reason = 'repair_admin_license_exempt'
    from public.profiles p
    where s.company_id = p_company_id
      and s.revoked_at is null
      and p.id = s.user_id
      and p.company_id = p_company_id
      and lower(coalesce(p.role, '')) = 'admin'
    returning s.id
  )
  select count(*)::int into v_revoked_admin_exempt from revoked;

  with revoked as (
    update public.company_seat_assignments s
    set
      revoked_at = now(),
      reason = 'repair_admin_blocked'
    from public.profiles p
    where s.company_id = p_company_id
      and s.revoked_at is null
      and p.id = s.user_id
      and p.company_id = p_company_id
      and coalesce(p.is_admin_blocked, false)
    returning s.id
  )
  select count(*)::int into v_revoked_blocked from revoked;

  with revoked as (
    update public.company_seat_assignments s
    set
      revoked_at = now(),
      reason = 'repair_manual_admin_blocked'
    from public.profiles p
    where s.company_id = p_company_id
      and s.revoked_at is null
      and p.id = s.user_id
      and p.company_id = p_company_id
      and lower(coalesce(p.blocked_reason, '')) in ('manual', 'admin_block', 'admin_blocked')
    returning s.id
  )
  select count(*)::int into v_revoked_manual_blocked from revoked;

  with ranked as (
    select
      s.id,
      row_number() over (
        partition by s.company_id, s.user_id
        order by s.assigned_at desc, s.id desc
      ) as rn
    from public.company_seat_assignments s
    where s.company_id = p_company_id
      and s.revoked_at is null
  ),
  revoked as (
    update public.company_seat_assignments s
    set
      revoked_at = now(),
      reason = 'repair_duplicate_active'
    from ranked r
    where s.id = r.id
      and r.rn > 1
      and s.revoked_at is null
    returning s.id
  )
  select count(*)::int into v_revoked_duplicates from revoked;

  v_subscription_active := public.company_subscription_is_active(p_company_id);
  if v_subscription_active then
    v_restored_auto := public.auto_restore_license_blocked_members(p_company_id);
  end if;

  with synced as (
    update public.profiles p
    set
      license_state = case
        when lower(coalesce(p.role, '')) = 'admin' then 'active'
        when coalesce(p.is_admin_blocked, false)
          or lower(coalesce(p.blocked_reason, '')) in ('manual', 'admin_block', 'admin_blocked')
          then 'blocked_by_license'
        when not v_subscription_active then 'blocked_by_license'
        when exists (
          select 1
          from public.company_seat_assignments s
          where s.company_id = p_company_id
            and s.user_id = p.id
            and s.revoked_at is null
        ) then 'active'
        else 'blocked_by_license'
      end,
      blocked_reason = case
        when coalesce(p.is_admin_blocked, false)
          or lower(coalesce(p.blocked_reason, '')) in ('manual', 'admin_block', 'admin_blocked')
          then coalesce(nullif(p.blocked_reason, ''), 'admin_blocked')
        when lower(coalesce(p.role, '')) = 'admin' then null
        when not v_subscription_active then 'subscription_expired'
        when exists (
          select 1
          from public.company_seat_assignments s
          where s.company_id = p_company_id
            and s.user_id = p.id
            and s.revoked_at is null
        ) then null
        else 'no_paid_seat'
      end
    where p.company_id = p_company_id
    returning p.id
  )
  select count(*)::int into v_profiles_synced from synced;

  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'revoked_not_in_company', v_revoked_not_in_company,
    'revoked_admin_license_exempt', v_revoked_admin_exempt,
    'revoked_admin_blocked', v_revoked_blocked,
    'revoked_manual_admin_blocked', v_revoked_manual_blocked,
    'revoked_duplicates', v_revoked_duplicates,
    'restored_license_blocked', v_restored_auto,
    'profiles_synced', v_profiles_synced,
    'used_seats', public.company_used_seats(p_company_id),
    'paid_seats', public.company_paid_seats_total(p_company_id)
  );
end;
$$;

grant execute on function public.auto_restore_license_blocked_members(uuid) to authenticated;
grant execute on function public.auto_restore_seats_after_increase(uuid) to authenticated;
grant execute on function public.repair_company_seat_pool(uuid) to authenticated;

-- Heal only active companies carrying stale expiry blocks from an earlier
-- renewal. Manual/admin blocks remain untouched.
do $$
declare
  v_company_id uuid;
begin
  for v_company_id in
    select distinct cs.company_id
    from public.company_subscriptions cs
    join public.profiles p on p.company_id = cs.company_id
    where cs.current_period_end is not null
      and cs.current_period_end >= now()
      and coalesce(p.is_admin_blocked, false) = false
      and lower(coalesce(p.blocked_reason, '')) = 'subscription_expired'
  loop
    perform public.repair_company_seat_pool(v_company_id);
  end loop;
end;
$$;

commit;
