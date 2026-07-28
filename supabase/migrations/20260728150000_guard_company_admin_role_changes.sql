begin;

create or replace function public.enforce_company_admin_continuity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_company_exists boolean := false;
  v_owner_id uuid := null;
  v_account_type text := '';
begin
  if lower(coalesce(old.role, '')) <> 'admin'
     or (
       tg_op = 'UPDATE'
       and lower(coalesce(new.role, '')) = 'admin'
       and new.company_id is not distinct from old.company_id
     )
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if old.company_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select true, c.owner_id
    into v_company_exists, v_owner_id
  from public.companies c
  where c.id = old.company_id
  for update;

  -- Company deletion uses ON DELETE SET NULL for profiles. At that point the
  -- parent company is already gone, so continuity is intentionally irrelevant.
  if not coalesce(v_company_exists, false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select lower(coalesce(u.raw_user_meta_data ->> 'account_type', ''))
    into v_account_type
  from auth.users u
  where u.id = old.id;

  if v_account_type = 'solo' then
    raise exception 'SOLO_ADMIN_ROLE_LOCKED'
      using errcode = '23514',
            detail = 'A solo account must keep its administrator role.';
  end if;

  if v_owner_id = old.id then
    raise exception 'COMPANY_ADMIN_TRANSFER_REQUIRED'
      using errcode = '23514',
            detail = 'Transfer company ownership before changing the owner administrator role.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.company_id = old.company_id
      and p.id <> old.id
      and lower(coalesce(p.role, '')) = 'admin'
  ) then
    raise exception 'COMPANY_ADMIN_TRANSFER_REQUIRED'
      using errcode = '23514',
            detail = 'A company must always have at least one administrator.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists trg_profiles_require_company_admin on public.profiles;
create trigger trg_profiles_require_company_admin
before delete or update of role, company_id
on public.profiles
for each row
execute function public.enforce_company_admin_continuity();

revoke all on function public.enforce_company_admin_continuity() from public, anon, authenticated;

create or replace function public.admin_get_company_role_context_super(
  p_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_profile public.profiles%rowtype;
  v_owner_id uuid := null;
  v_account_type text := 'company';
  v_candidates jsonb := '[]'::jsonb;
  v_admin_count integer := 0;
begin
  perform public.admin_assert_super_admin();

  select p.*
    into v_profile
  from public.profiles p
  where p.id = p_profile_id;

  if v_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  select
    c.owner_id,
    coalesce((
      select lower(nullif(u.raw_user_meta_data ->> 'account_type', ''))
      from auth.users u
      where u.id = v_profile.id
    ), 'company')
    into v_owner_id, v_account_type
  from public.companies c
  where c.id = v_profile.company_id;

  if v_profile.company_id is null or not found then
    raise exception 'COMPANY_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  select count(*)::integer
    into v_admin_count
  from public.profiles p
  where p.company_id = v_profile.company_id
    and lower(coalesce(p.role, '')) = 'admin';

  select coalesce(
    jsonb_agg(candidate.payload order by candidate.sort_name, candidate.profile_id),
    '[]'::jsonb
  )
    into v_candidates
  from (
    select
      p.id as profile_id,
      lower(coalesce(
        nullif(btrim(p.full_name), ''),
        nullif(btrim(concat_ws(' ', p.last_name, p.first_name, p.middle_name)), ''),
        nullif(btrim(p.email), ''),
        p.id::text
      )) as sort_name,
      jsonb_build_object(
        'id', p.id,
        'email', nullif(btrim(p.email), ''),
        'full_name', coalesce(
          nullif(btrim(p.full_name), ''),
          nullif(btrim(concat_ws(' ', p.last_name, p.first_name, p.middle_name)), ''),
          nullif(btrim(p.email), '')
        ),
        'first_name', p.first_name,
        'middle_name', p.middle_name,
        'last_name', p.last_name,
        'role', lower(coalesce(p.role, 'worker')),
        'license_state', p.license_state
      ) as payload
    from public.profiles p
    where p.company_id = v_profile.company_id
      and p.id <> v_profile.id
      and not coalesce(p.is_admin_blocked, false)
      and lower(coalesce(p.role, '')) in ('admin', 'dispatcher', 'worker')
  ) candidate;

  return jsonb_build_object(
    'profile_id', v_profile.id,
    'company_id', v_profile.company_id,
    'current_role', lower(coalesce(v_profile.role, 'worker')),
    'account_type', v_account_type,
    'is_solo', v_account_type = 'solo',
    'is_company_owner', v_owner_id = v_profile.id,
    'admin_count', v_admin_count,
    'requires_transfer_on_demotion',
      lower(coalesce(v_profile.role, '')) = 'admin' and v_account_type <> 'solo',
    'role_editable', v_account_type <> 'solo',
    'candidates', v_candidates
  );
end;
$function$;

revoke all on function public.admin_get_company_role_context_super(uuid) from public, anon;
grant execute on function public.admin_get_company_role_context_super(uuid)
  to authenticated, service_role;

create or replace function public.admin_change_company_role_super(
  p_profile_id uuid,
  p_new_role text,
  p_successor_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_profile public.profiles%rowtype;
  v_successor public.profiles%rowtype;
  v_company_owner_id uuid := null;
  v_account_type text := 'company';
  v_new_role text := lower(nullif(btrim(p_new_role), ''));
  v_previous_role text;
  v_admin_count integer := 0;
  v_role_changed boolean := false;
begin
  perform public.admin_assert_super_admin();

  if v_new_role is null or v_new_role not in ('admin', 'dispatcher', 'worker') then
    raise exception 'UNSUPPORTED_ROLE'
      using errcode = '22023';
  end if;

  select p.*
    into v_profile
  from public.profiles p
  where p.id = p_profile_id
  for update;

  if v_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND'
      using errcode = 'P0002';
  end if;
  if v_profile.company_id is null then
    raise exception 'COMPANY_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  select c.owner_id
    into v_company_owner_id
  from public.companies c
  where c.id = v_profile.company_id
  for update;

  if not found then
    raise exception 'COMPANY_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  select coalesce(
    lower(nullif(u.raw_user_meta_data ->> 'account_type', '')),
    'company'
  )
    into v_account_type
  from auth.users u
  where u.id = v_profile.id;
  v_account_type := coalesce(v_account_type, 'company');
  v_previous_role := lower(coalesce(v_profile.role, 'worker'));

  if v_account_type = 'solo' and v_new_role <> 'admin' then
    raise exception 'SOLO_ADMIN_ROLE_LOCKED'
      using errcode = '23514',
            detail = 'A solo account must keep its administrator role.';
  end if;

  if v_previous_role = 'admin' and v_new_role <> 'admin' then
    if p_successor_profile_id is null then
      raise exception 'COMPANY_ADMIN_TRANSFER_REQUIRED'
        using errcode = '23514',
              detail = 'Select another company employee as administrator.';
    end if;
    if p_successor_profile_id = v_profile.id then
      raise exception 'INVALID_ADMIN_SUCCESSOR'
        using errcode = '22023';
    end if;

    select p.*
      into v_successor
    from public.profiles p
    where p.id = p_successor_profile_id
      and p.company_id = v_profile.company_id
    for update;

    if v_successor.id is null then
      raise exception 'ADMIN_SUCCESSOR_NOT_FOUND'
        using errcode = 'P0002';
    end if;
    if coalesce(v_successor.is_admin_blocked, false) then
      raise exception 'ADMIN_SUCCESSOR_BLOCKED'
        using errcode = '23514';
    end if;

    update public.profiles
    set role = 'admin'
    where id = v_successor.id;

    update public.companies
    set owner_id = v_successor.id,
        updated_at = now()
    where id = v_profile.company_id;

    update public.profiles
    set role = v_new_role
    where id = v_profile.id;

    v_role_changed := true;
  elsif v_previous_role is distinct from v_new_role then
    update public.profiles
    set role = v_new_role
    where id = v_profile.id;

    if v_new_role = 'admin'
       and (
         v_company_owner_id is null
         or not exists (
           select 1
           from public.profiles owner_profile
           where owner_profile.id = v_company_owner_id
             and owner_profile.company_id = v_profile.company_id
             and lower(coalesce(owner_profile.role, '')) = 'admin'
         )
       )
    then
      update public.companies
      set owner_id = v_profile.id,
          updated_at = now()
      where id = v_profile.company_id;
    end if;

    v_role_changed := true;
  end if;

  select count(*)::integer
    into v_admin_count
  from public.profiles p
  where p.company_id = v_profile.company_id
    and lower(coalesce(p.role, '')) = 'admin';

  if v_admin_count < 1 then
    raise exception 'COMPANY_ADMIN_REQUIRED'
      using errcode = '23514';
  end if;

  perform public.repair_company_seat_pool(v_profile.company_id);

  return jsonb_build_object(
    'ok', true,
    'profile_id', v_profile.id,
    'company_id', v_profile.company_id,
    'previous_role', v_previous_role,
    'role', v_new_role,
    'role_changed', v_role_changed,
    'successor_profile_id',
      case
        when v_previous_role = 'admin' and v_new_role <> 'admin'
          then p_successor_profile_id
        else null
      end,
    'admin_count', v_admin_count
  );
end;
$function$;

revoke all on function public.admin_change_company_role_super(uuid, text, uuid)
  from public, anon;
grant execute on function public.admin_change_company_role_super(uuid, text, uuid)
  to authenticated, service_role;

create or replace function public.admin_update_profile_super_full_v2(
  p_profile_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_role text default null,
  p_company_id uuid default null,
  p_phone text default null,
  p_birthdate date default null,
  p_department_id text default null,
  p_avatar_url text default null,
  p_is_admin_blocked boolean default null,
  p_successor_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_profile_result jsonb;
  v_role_result jsonb := '{}'::jsonb;
begin
  perform public.admin_assert_super_admin();

  -- Both calls execute inside the same RPC transaction: if role validation
  -- fails, the accompanying profile edits are rolled back as well.
  v_profile_result := public.admin_update_profile_super_full(
    p_profile_id => p_profile_id,
    p_first_name => p_first_name,
    p_last_name => p_last_name,
    p_role => null,
    p_company_id => p_company_id,
    p_phone => p_phone,
    p_birthdate => p_birthdate,
    p_department_id => p_department_id,
    p_avatar_url => p_avatar_url,
    p_is_admin_blocked => p_is_admin_blocked
  );

  if p_role is not null then
    v_role_result := public.admin_change_company_role_super(
      p_profile_id,
      p_role,
      p_successor_profile_id
    );
  end if;

  return coalesce(v_profile_result, '{}'::jsonb)
    || coalesce(v_role_result, '{}'::jsonb)
    || jsonb_build_object('ok', true, 'profile_id', p_profile_id);
end;
$function$;

revoke all on function public.admin_update_profile_super_full_v2(
  uuid, text, text, text, uuid, text, date, text, text, boolean, uuid
) from public, anon;
grant execute on function public.admin_update_profile_super_full_v2(
  uuid, text, text, text, uuid, text, date, text, text, boolean, uuid
) to authenticated, service_role;

commit;
