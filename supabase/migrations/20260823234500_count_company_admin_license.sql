begin;

-- Every active assignment consumes a paid seat. The company administrator is
-- the mandatory first assignment, not a seat-exempt account.
create or replace function public.company_used_seats(p_company_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_count integer := 0;
begin
  if p_company_id is null then
    return 0;
  end if;

  select count(distinct s.user_id)::integer
    into v_count
  from public.company_seat_assignments s
  join public.profiles p
    on p.id = s.user_id
   and p.company_id = p_company_id
  where s.company_id = p_company_id
    and s.revoked_at is null;

  return coalesce(v_count, 0);
end;
$function$;

grant execute on function public.company_used_seats(uuid) to authenticated;

-- Keep the administrator assignment invariant in one internal helper. A
-- deliberately admin-blocked profile is the only administrator that does not
-- consume a seat until it is unblocked.
create or replace function public.ensure_company_admin_seat(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inserted integer := 0;
begin
  if p_company_id is null then
    return 0;
  end if;

  insert into public.company_seat_assignments (company_id, user_id, reason)
  select p_company_id, p.id, 'admin_required'
  from public.profiles p
  where p.company_id = p_company_id
    and lower(coalesce(p.role, '')) = 'admin'
    and not coalesce(p.is_admin_blocked, false)
    and not public.user_has_active_seat(p_company_id, p.id)
  on conflict (company_id, user_id) where revoked_at is null do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

revoke all on function public.ensure_company_admin_seat(uuid) from public, anon, authenticated;
grant execute on function public.ensure_company_admin_seat(uuid) to service_role;

create or replace function public.auto_restore_license_blocked_members(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_paid integer := 0;
  v_used integer := 0;
  v_free integer := 0;
  v_restored integer := 0;
  v_inserted integer := 0;
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

  -- Reserve the mandatory administrator seat before calculating capacity.
  perform public.ensure_company_admin_seat(p_company_id);
  perform public.enforce_seat_limit(p_company_id);

  select greatest(1, coalesce(cs.paid_seats_total, 1))
    into v_paid
  from public.company_subscriptions cs
  where cs.company_id = p_company_id
  limit 1;

  v_used := public.company_used_seats(p_company_id);
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
        and not coalesce(p.is_admin_blocked, false)
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
    if v_inserted > 0 then
      update public.profiles p
      set
        license_state = 'active',
        blocked_reason = null
      where p.id = v_user_id
        and p.company_id = p_company_id
        and not coalesce(p.is_admin_blocked, false);
      v_restored := v_restored + 1;
    end if;
  end loop;

  return v_restored;
end;
$function$;

create or replace function public.repair_company_seat_pool(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_revoked_not_in_company integer := 0;
  v_revoked_blocked integer := 0;
  v_revoked_manual_blocked integer := 0;
  v_revoked_duplicates integer := 0;
  v_revoked_expired integer := 0;
  v_revoked_over_limit integer := 0;
  v_assigned_required_admins integer := 0;
  v_restored_auto integer := 0;
  v_profiles_synced integer := 0;
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

  -- Serialize reconciliation and manual assignment for a single company.
  perform 1
  from public.companies c
  where c.id = p_company_id
  for update;

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
  select count(*)::integer into v_revoked_not_in_company from revoked;

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
  select count(*)::integer into v_revoked_blocked from revoked;

  -- A company administrator cannot be manually deprived of the mandatory
  -- seat. Manual license blocks continue to apply to ordinary employees.
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
      and lower(coalesce(p.role, '')) <> 'admin'
      and lower(coalesce(p.blocked_reason, '')) in ('manual', 'admin_block', 'admin_blocked')
    returning s.id
  )
  select count(*)::integer into v_revoked_manual_blocked from revoked;

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
  select count(*)::integer into v_revoked_duplicates from revoked;

  v_assigned_required_admins := public.ensure_company_admin_seat(p_company_id);
  v_subscription_active := public.company_subscription_is_active(p_company_id);

  if v_subscription_active then
    -- enforce_seat_limit already excludes administrators from downgrade
    -- victims, so the mandatory seat is always retained.
    v_revoked_over_limit := public.enforce_seat_limit(p_company_id);
    v_restored_auto := public.auto_restore_license_blocked_members(p_company_id);
  else
    -- Expiry blocks employee access and releases employee assignments. The
    -- administrator remains active so they can view and renew the subscription.
    with revoked as (
      update public.company_seat_assignments s
      set
        revoked_at = now(),
        reason = 'subscription_expired'
      from public.profiles p
      where s.company_id = p_company_id
        and s.revoked_at is null
        and p.id = s.user_id
        and p.company_id = p_company_id
        and lower(coalesce(p.role, '')) <> 'admin'
      returning s.id
    )
    select count(*)::integer into v_revoked_expired from revoked;
  end if;

  with desired as (
    select
      p.id,
      case
        when coalesce(p.is_admin_blocked, false)
          or (
            lower(coalesce(p.role, '')) <> 'admin'
            and lower(coalesce(p.blocked_reason, '')) in ('manual', 'admin_block', 'admin_blocked')
          ) then 'blocked_by_license'
        when lower(coalesce(p.role, '')) = 'admin' then 'active'
        when not v_subscription_active then 'blocked_by_license'
        when public.user_has_active_seat(p_company_id, p.id) then 'active'
        else 'blocked_by_license'
      end as license_state,
      case
        when coalesce(p.is_admin_blocked, false)
          or (
            lower(coalesce(p.role, '')) <> 'admin'
            and lower(coalesce(p.blocked_reason, '')) in ('manual', 'admin_block', 'admin_blocked')
          ) then coalesce(nullif(p.blocked_reason, ''), 'admin_blocked')
        when lower(coalesce(p.role, '')) = 'admin' then null
        when not v_subscription_active then 'subscription_expired'
        when public.user_has_active_seat(p_company_id, p.id) then null
        else 'no_paid_seat'
      end as blocked_reason
    from public.profiles p
    where p.company_id = p_company_id
  ),
  synced as (
    update public.profiles p
    set
      license_state = d.license_state,
      blocked_reason = d.blocked_reason
    from desired d
    where p.id = d.id
      and (
        p.license_state is distinct from d.license_state
        or p.blocked_reason is distinct from d.blocked_reason
      )
    returning p.id
  )
  select count(*)::integer into v_profiles_synced from synced;

  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'revoked_not_in_company', v_revoked_not_in_company,
    'revoked_admin_license_exempt', 0,
    'assigned_required_admins', v_assigned_required_admins,
    'revoked_admin_blocked', v_revoked_blocked,
    'revoked_manual_admin_blocked', v_revoked_manual_blocked,
    'revoked_duplicates', v_revoked_duplicates,
    'revoked_subscription_expired', v_revoked_expired,
    'revoked_over_limit', v_revoked_over_limit,
    'restored_license_blocked', v_restored_auto,
    'profiles_synced', v_profiles_synced,
    'used_seats', public.company_used_seats(p_company_id),
    'paid_seats', public.company_paid_seats_total(p_company_id)
  );
end;
$function$;

create or replace function public.revoke_seat(
  p_company_id uuid,
  p_user_id uuid,
  p_reason text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'manual');
  v_role text;
begin
  if p_company_id is null or p_user_id is null then
    raise exception 'company_id and user_id are required';
  end if;

  if not public.is_company_license_admin(p_company_id) then
    raise exception 'license admin access required for company %', p_company_id using errcode = '42501';
  end if;

  select lower(coalesce(p.role, ''))
    into v_role
  from public.profiles p
  where p.id = p_user_id
    and p.company_id = p_company_id
  limit 1;

  if v_role is null then
    raise exception 'user % is not in company %', p_user_id, p_company_id;
  end if;

  if v_role = 'admin' then
    raise exception 'administrator seat is required' using errcode = '42501';
  end if;

  perform 1
  from public.companies c
  where c.id = p_company_id
  for update;

  update public.company_seat_assignments
  set revoked_at = now(), reason = v_reason
  where company_id = p_company_id
    and user_id = p_user_id
    and revoked_at is null;

  update public.profiles
  set
    license_state = 'blocked_by_license',
    blocked_reason = v_reason
  where id = p_user_id
    and company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'user_id', p_user_id,
    'reason', v_reason
  );
end;
$function$;

create or replace function public.sync_member_license_state(p_company_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_has_seat boolean;
  v_role text;
  v_admin_blocked boolean := false;
begin
  if p_company_id is null or p_user_id is null then
    return;
  end if;

  select lower(coalesce(p.role, '')), coalesce(p.is_admin_blocked, false)
    into v_role, v_admin_blocked
  from public.profiles p
  where p.id = p_user_id
    and p.company_id = p_company_id;

  if v_role = 'admin' then
    if v_admin_blocked then
      update public.company_seat_assignments
      set revoked_at = now(), reason = 'admin_block'
      where company_id = p_company_id
        and user_id = p_user_id
        and revoked_at is null;

      update public.profiles p
      set
        license_state = 'blocked_by_license',
        blocked_reason = coalesce(nullif(p.blocked_reason, ''), 'admin_blocked')
      where p.id = p_user_id
        and p.company_id = p_company_id;
    else
      perform public.ensure_company_admin_seat(p_company_id);
      update public.profiles p
      set license_state = 'active', blocked_reason = null
      where p.id = p_user_id
        and p.company_id = p_company_id;
      if public.company_subscription_is_active(p_company_id) then
        perform public.enforce_seat_limit(p_company_id);
      end if;
    end if;
    return;
  end if;

  v_has_seat := public.user_has_active_seat(p_company_id, p_user_id);

  update public.profiles p
  set
    license_state = case when v_has_seat then 'active' else 'blocked_by_license' end,
    blocked_reason = case when v_has_seat then null else coalesce(p.blocked_reason, 'no_paid_seat') end
  where p.id = p_user_id
    and p.company_id = p_company_id;
end;
$function$;

create or replace function public.trg_profiles_license_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.company_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.company_id is distinct from new.company_id
     and old.company_id is not null
  then
    update public.company_seat_assignments
    set revoked_at = now(), reason = 'moved_company'
    where company_id = old.company_id
      and user_id = new.id
      and revoked_at is null;
  end if;

  if coalesce(new.is_admin_blocked, false) then
    update public.company_seat_assignments
    set revoked_at = now(), reason = 'admin_block'
    where company_id = new.company_id
      and user_id = new.id
      and revoked_at is null;

    if coalesce(new.license_state, 'active') <> 'blocked_by_license' then
      update public.profiles
      set license_state = 'blocked_by_license'
      where id = new.id
        and coalesce(license_state, 'active') <> 'blocked_by_license';
    end if;

    return new;
  end if;

  if lower(coalesce(new.role, '')) = 'admin' then
    perform public.ensure_company_admin_seat(new.company_id);

    update public.profiles
    set license_state = 'active', blocked_reason = null
    where id = new.id
      and (
        coalesce(license_state, 'active') <> 'active'
        or blocked_reason is not null
      );

    if public.company_subscription_is_active(new.company_id) then
      perform public.enforce_seat_limit(new.company_id);
    end if;
    return new;
  end if;

  if coalesce(new.license_state, 'active') = 'active' then
    if not public.user_has_active_seat(new.company_id, new.id) then
      if public.can_company_add_member(new.company_id) then
        insert into public.company_seat_assignments (company_id, user_id, reason)
        values (new.company_id, new.id, 'manual')
        on conflict do nothing;
      else
        update public.profiles
        set license_state = 'blocked_by_license', blocked_reason = 'no_paid_seat'
        where id = new.id;
      end if;
    end if;
  else
    update public.company_seat_assignments
    set revoked_at = now(), reason = coalesce(new.blocked_reason, 'license_block')
    where company_id = new.company_id
      and user_id = new.id
      and revoked_at is null;
  end if;

  return new;
end;
$function$;

revoke all on function public.trg_profiles_license_after() from public, anon, authenticated;

grant execute on function public.auto_restore_license_blocked_members(uuid) to authenticated;
grant execute on function public.repair_company_seat_pool(uuid) to authenticated;
grant execute on function public.revoke_seat(uuid, uuid, text) to authenticated;

-- Reconcile existing companies after all invariants are in place. This adds
-- the mandatory administrator seat and only downgrades ordinary employees if
-- an active company was already using every paid seat.
do $function$
declare
  v_company_id uuid;
begin
  for v_company_id in
    select distinct p.company_id
    from public.profiles p
    where p.company_id is not null
      and lower(coalesce(p.role, '')) = 'admin'
  loop
    perform public.repair_company_seat_pool(v_company_id);
  end loop;
end;
$function$;

commit;
