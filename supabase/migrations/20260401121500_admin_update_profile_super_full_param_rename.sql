-- Rename admin_update_profile_super_full named boolean parameter
-- from p_is_suspended to p_is_admin_blocked (DROP+CREATE required by PostgreSQL).

drop function if exists public.admin_update_profile_super_full(
  uuid, text, text, text, uuid, text, date, text, text, boolean
);

create function public.admin_update_profile_super_full(
  p_profile_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_role text default null,
  p_company_id uuid default null,
  p_phone text default null,
  p_birthdate date default null,
  p_department_id text default null,
  p_avatar_url text default null,
  p_is_admin_blocked boolean default null
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

  if p_is_admin_blocked is not null then
    update public.profiles
    set
      is_admin_blocked = p_is_admin_blocked,
      blocked_reason = case
        when p_is_admin_blocked then coalesce(nullif(blocked_reason, ''), 'admin_block')
        when lower(coalesce(blocked_reason, '')) in ('manual', 'admin_block', 'admin_blocked') then null
        else blocked_reason
      end
    where id = p_profile_id;
  end if;

  return jsonb_build_object('ok', true, 'profile_id', p_profile_id);
end;
$$;

grant execute on function public.admin_update_profile_super_full(
  uuid, text, text, text, uuid, text, date, text, text, boolean
) to anon, authenticated;
