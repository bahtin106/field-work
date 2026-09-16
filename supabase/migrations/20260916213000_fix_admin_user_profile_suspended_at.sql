begin;

create or replace function public.admin_get_user_profile_full(p_profile_id uuid)
returns table(
  profile_id uuid,
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  full_name text,
  role text,
  company_id uuid,
  company_name text,
  phone text,
  birthdate date,
  avatar_url text,
  department_id text,
  department_name text,
  is_suspended boolean,
  suspended_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
begin
  perform public.admin_assert_super_admin();

  return query
  with src as (
    select
      p.id as profile_id,
      case
        when (to_jsonb(p) ->> 'user_id') ~* '^[0-9a-f-]{36}$'
          then (to_jsonb(p) ->> 'user_id')::uuid
        else p.id
      end as user_id,
      p.email as profile_email,
      p.first_name,
      p.last_name,
      p.full_name,
      p.role,
      p.company_id,
      p.phone,
      p.birthdate,
      p.avatar_url,
      p.department_id::text as department_id,
      p.is_admin_blocked,
      null::timestamptz as suspended_at,
      p.last_seen_at
    from public.profiles p
    where p.id = p_profile_id
    limit 1
  )
  select
    s.profile_id,
    s.user_id,
    coalesce(s.profile_email, au.email)::text as email,
    s.first_name,
    s.last_name,
    s.full_name,
    s.role,
    s.company_id,
    c.name::text as company_name,
    s.phone,
    s.birthdate,
    s.avatar_url,
    s.department_id,
    d.name::text as department_name,
    coalesce(s.is_admin_blocked, false) as is_suspended,
    s.suspended_at,
    s.last_seen_at
  from src s
  left join public.companies c on c.id = s.company_id
  left join public.departments d on d.id::text = s.department_id
  left join auth.users au on au.id = s.user_id
  limit 1;
end;
$function$;

revoke all on function public.admin_get_user_profile_full(uuid)
  from public, anon;
grant execute on function public.admin_get_user_profile_full(uuid)
  to authenticated, service_role;

commit;
