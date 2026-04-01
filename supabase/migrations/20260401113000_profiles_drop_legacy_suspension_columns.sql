-- Complete migration away from legacy profile suspension columns.
-- Canonical fields: is_admin_blocked + blocked_reason + license_state.

-- 1) Keep legacy RPC signature for compatibility, but write only canonical fields.
create or replace function public.admin_update_profile_super_full(
  p_profile_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_role text default null,
  p_company_id uuid default null,
  p_phone text default null,
  p_birthdate date default null,
  p_department_id text default null,
  p_avatar_url text default null,
  p_is_suspended boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
  v_role text;
  v_company_id uuid;
  v_full_name text;
  v_department_col_type text;
begin
  perform public.admin_assert_super_admin();

  if p_role is not null and lower(p_role) not in ('admin', 'dispatcher', 'worker') then
    raise exception 'unsupported role: %', p_role;
  end if;

  select first_name, last_name, role, company_id
    into v_first_name, v_last_name, v_role, v_company_id
  from public.profiles
  where id = p_profile_id
  limit 1;

  if v_role is null then
    raise exception 'profile not found: %', p_profile_id;
  end if;

  v_first_name := coalesce(p_first_name, v_first_name);
  v_last_name := coalesce(p_last_name, v_last_name);
  v_role := coalesce(p_role, v_role);
  v_company_id := coalesce(p_company_id, v_company_id);
  v_full_name := nullif(trim(concat_ws(' ', v_first_name, v_last_name)), '');

  update public.profiles
  set
    first_name = v_first_name,
    last_name = v_last_name,
    full_name = v_full_name,
    role = v_role,
    company_id = v_company_id
  where id = p_profile_id;

  if p_phone is not null then
    update public.profiles
    set phone = nullif(trim(p_phone), '')
    where id = p_profile_id;
  end if;

  if p_birthdate is not null then
    update public.profiles
    set birthdate = p_birthdate
    where id = p_profile_id;
  end if;

  if p_avatar_url is not null then
    update public.profiles
    set avatar_url = nullif(trim(p_avatar_url), '')
    where id = p_profile_id;
  end if;

  if p_department_id is not null then
    select format_type(a.atttypid, a.atttypmod)
      into v_department_col_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and a.attname = 'department_id'
      and a.attnum > 0
      and not a.attisdropped
    limit 1;

    if v_department_col_type is not null then
      execute format(
        'update public.profiles set department_id = nullif($1, '''')::%s where id = $2',
        v_department_col_type
      )
      using p_department_id, p_profile_id;
    end if;
  end if;

  if p_is_suspended is not null then
    update public.profiles
    set
      is_admin_blocked = p_is_suspended,
      blocked_reason = case
        when p_is_suspended then coalesce(nullif(blocked_reason, ''), 'admin_block')
        when lower(coalesce(blocked_reason, '')) in ('manual', 'admin_block', 'admin_blocked') then null
        else blocked_reason
      end
    where id = p_profile_id;
  end if;

  return jsonb_build_object('ok', true, 'profile_id', p_profile_id);
end;
$$;

-- 2) Canonical license triggers without legacy columns.
create or replace function public.trg_profiles_license_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(old.is_admin_blocked, false) = true
     and coalesce(new.is_admin_blocked, false) = false
     and coalesce(old.license_state, 'active') = 'blocked_by_license'
     and not public.user_has_active_seat(new.company_id, new.id)
     and not public.can_company_add_member(new.company_id)
  then
    raise exception 'no free paid seats to unblock member' using errcode='42501';
  end if;

  if tg_op = 'UPDATE'
     and coalesce(old.license_state, 'active') = 'blocked_by_license'
     and coalesce(new.license_state, 'active') = 'active'
     and not public.user_has_active_seat(new.company_id, new.id)
     and not public.can_company_add_member(new.company_id)
  then
    raise exception 'no free paid seats to activate member' using errcode='42501';
  end if;

  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.company_id is distinct from old.company_id) then
    if public.can_company_add_member(new.company_id) then
      new.license_state := 'active';
      new.blocked_reason := null;
    else
      new.license_state := 'blocked_by_license';
      new.blocked_reason := 'no_paid_seat';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.trg_profiles_license_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.company_id is distinct from new.company_id and old.company_id is not null then
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

    update public.profiles
    set license_state = coalesce(license_state, 'blocked_by_license')
    where id = new.id;

    return new;
  end if;

  if coalesce(new.license_state, 'active') = 'active' then
    if not public.user_has_active_seat(new.company_id, new.id) then
      if public.can_company_add_member(new.company_id) then
        insert into public.company_seat_assignments(company_id, user_id, reason)
        values (new.company_id, new.id, 'manual')
        on conflict do nothing;
      else
        update public.profiles
        set
          license_state = 'blocked_by_license',
          blocked_reason = 'no_paid_seat'
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
$$;

drop trigger if exists trg_profiles_license_before on public.profiles;
create trigger trg_profiles_license_before
before insert or update of company_id, is_admin_blocked
on public.profiles
for each row
execute function public.trg_profiles_license_before();

drop trigger if exists trg_profiles_license_after on public.profiles;
create trigger trg_profiles_license_after
after insert or update of company_id, is_admin_blocked, license_state
on public.profiles
for each row
execute function public.trg_profiles_license_after();

-- 3) Rewrite remaining public functions that still mention legacy suspension fields.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname not in (
        'admin_update_profile_super_full',
        'trg_profiles_license_before',
        'trg_profiles_license_after'
      )
      and (
        pg_get_functiondef(p.oid) ilike '%is_suspended%'
        or pg_get_functiondef(p.oid) ilike '%suspended_at%'
        or pg_get_functiondef(p.oid) ilike '%suspend_reason%'
      )
  loop
    v_def := pg_get_functiondef(r.oid);

    v_def := replace(v_def, 'COALESCE(p.is_admin_blocked, false) OR COALESCE(p.is_suspended, false)', 'COALESCE(p.is_admin_blocked, false)');
    v_def := replace(v_def, 'COALESCE(NEW.is_admin_blocked, false) OR COALESCE(NEW.is_suspended, false)', 'COALESCE(NEW.is_admin_blocked, false)');
    v_def := replace(v_def, 'COALESCE(OLD.is_admin_blocked, false) OR COALESCE(OLD.is_suspended, false)', 'COALESCE(OLD.is_admin_blocked, false)');
    v_def := replace(v_def, 'COALESCE(creator_profile.is_admin_blocked, false) OR COALESCE(creator_profile.is_suspended, false)', 'COALESCE(creator_profile.is_admin_blocked, false)');
    v_def := replace(v_def, 'COALESCE(p.is_suspended, false) = false', 'true');
    v_def := replace(v_def, 'COALESCE(creator_profile.is_suspended, false) = false', 'true');

    v_def := replace(v_def, '.is_suspended', '.is_admin_blocked');
    v_def := replace(v_def, 'is_suspended asc', 'is_admin_blocked asc');
    v_def := replace(v_def, 'p.suspended_at', 'NULL::timestamp with time zone');

    execute v_def;
  end loop;
end
$$;

-- 4) Update guarded self-update policy to canonical fields only.
drop policy if exists profiles_update_self_guarded on public.profiles;
create policy profiles_update_self_guarded
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role is not distinct from (select p.role from public.profiles p where p.id = auth.uid())
  and company_id is not distinct from (select p.company_id from public.profiles p where p.id = auth.uid())
  and department_id is not distinct from (select p.department_id from public.profiles p where p.id = auth.uid())
  and email is not distinct from (select p.email from public.profiles p where p.id = auth.uid())
  and is_admin_blocked is not distinct from (select p.is_admin_blocked from public.profiles p where p.id = auth.uid())
  and license_state is not distinct from (select p.license_state from public.profiles p where p.id = auth.uid())
  and blocked_reason is not distinct from (select p.blocked_reason from public.profiles p where p.id = auth.uid())
);

-- 5) Final cleanup: drop legacy columns.
alter table public.profiles
  drop column if exists is_suspended,
  drop column if exists suspended_at,
  drop column if exists suspend_reason;
