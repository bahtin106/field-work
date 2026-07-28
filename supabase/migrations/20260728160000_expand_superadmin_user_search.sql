begin;

create or replace function public.admin_list_users_v2(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  profile_id uuid,
  user_id uuid,
  email text,
  first_name text,
  middle_name text,
  last_name text,
  full_name text,
  phone text,
  role text,
  company_id uuid,
  company_name text,
  is_super_admin boolean,
  created_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_search text := nullif(btrim(p_search), '');
begin
  perform public.admin_assert_super_admin();

  return query
  with user_rows as (
    select
      p.id as profile_id,
      case
        when (to_jsonb(p)->>'user_id') ~* '^[0-9a-f-]{36}$'
          then (to_jsonb(p)->>'user_id')::uuid
        else p.id
      end as user_id,
      coalesce(nullif(btrim(p.email), ''), nullif(btrim(au.email), '')) as email,
      p.first_name,
      p.middle_name,
      p.last_name,
      p.full_name,
      p.phone,
      p.role,
      p.company_id,
      c.name as company_name,
      exists (
        select 1
        from public.super_admins sa
        where sa.is_active = true
          and (
            sa.profile_id = p.id
            or sa.user_id = case
              when (to_jsonb(p)->>'user_id') ~* '^[0-9a-f-]{36}$'
                then (to_jsonb(p)->>'user_id')::uuid
              else p.id
            end
          )
      ) as is_super_admin,
      p.created_at,
      p.last_seen_at
    from public.profiles p
    left join auth.users au on au.id = case
      when (to_jsonb(p)->>'user_id') ~* '^[0-9a-f-]{36}$'
        then (to_jsonb(p)->>'user_id')::uuid
      else p.id
    end
    left join public.companies c on c.id = p.company_id
  )
  select
    row.profile_id,
    row.user_id,
    row.email,
    row.first_name,
    row.middle_name,
    row.last_name,
    row.full_name,
    row.phone,
    row.role,
    row.company_id,
    row.company_name,
    row.is_super_admin,
    row.created_at,
    row.last_seen_at
  from user_rows row
  where v_search is null
    or concat_ws(
      ' ',
      row.profile_id::text,
      row.user_id::text,
      row.email,
      row.first_name,
      row.middle_name,
      row.last_name,
      row.full_name,
      row.phone,
      regexp_replace(coalesce(row.phone, ''), '[^0-9]+', '', 'g'),
      row.role,
      case lower(coalesce(row.role, ''))
        when 'admin' then 'администратор admin administrator'
        when 'dispatcher' then 'диспетчер dispatcher'
        when 'worker' then 'рабочий работник worker employee'
        else null
      end,
      row.company_id::text,
      row.company_name,
      case
        when row.is_super_admin
          then 'суперадминистратор супер администратор superadmin super admin'
        else null
      end,
      to_char(row.created_at at time zone 'Europe/Moscow', 'DD.MM.YYYY'),
      to_char(row.created_at at time zone 'Europe/Moscow', 'MM/DD/YYYY'),
      to_char(row.created_at at time zone 'Europe/Moscow', 'YYYY-MM-DD'),
      to_char(row.last_seen_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'),
      to_char(row.last_seen_at at time zone 'Europe/Moscow', 'MM/DD/YYYY HH12:MI AM'),
      to_char(row.last_seen_at at time zone 'Europe/Moscow', 'YYYY-MM-DD HH24:MI')
    ) ilike ('%' || v_search || '%')
  order by coalesce(
    nullif(btrim(row.full_name), ''),
    nullif(btrim(concat_ws(' ', row.last_name, row.first_name, row.middle_name)), ''),
    row.email,
    row.profile_id::text
  )
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.admin_list_users_v2(text, integer, integer) from public, anon;
grant execute on function public.admin_list_users_v2(text, integer, integer) to authenticated, service_role;

commit;
