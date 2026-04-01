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
