-- Legacy admin RPCs predate the stricter company/super-admin model. Keep
-- current app flows working, but remove direct client access to unused or
-- billing-sensitive helpers and scope the one still used by employee details.

create or replace function public.admin_get_profile_with_email(target_user_id uuid)
returns table(id uuid, full_name text, user_role text, email text, birthdate date)
language plpgsql
security definer
set search_path = public, auth, extensions
as $function$
declare
  v_requester_id uuid := auth.uid();
  v_requester_role text;
  v_requester_company_id uuid;
  v_target_company_id uuid;
begin
  if v_requester_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.role, p.company_id
    into v_requester_role, v_requester_company_id
  from public.profiles p
  where p.id = v_requester_id;

  select p.company_id
    into v_target_company_id
  from public.profiles p
  where p.id = target_user_id;

  if not public.is_super_admin() then
    if v_requester_role is distinct from 'admin'
       or v_requester_company_id is null
       or v_target_company_id is null
       or v_requester_company_id is distinct from v_target_company_id then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  select
    p.id::uuid,
    p.full_name::text,
    p.role::text as user_role,
    u.email::text,
    p.birthdate::date
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = target_user_id;
end;
$function$;

grant execute on function public.admin_get_profile_with_email(uuid) to authenticated, service_role;

revoke execute on function public.admin_company_employees_count(uuid) from authenticated;
grant execute on function public.admin_company_employees_count(uuid) to service_role;

revoke execute on function public.admin_list_users_min(text, uuid) from authenticated;
grant execute on function public.admin_list_users_min(text, uuid) to service_role;

revoke execute on function public.admin_set_role(uuid, text) from authenticated;
grant execute on function public.admin_set_role(uuid, text) to service_role;

revoke execute on function public.admin_set_role_by_email(text, text) from authenticated;
grant execute on function public.admin_set_role_by_email(text, text) to service_role;

revoke execute on function public.admin_set_subscription(uuid, text, timestamp with time zone, text, jsonb) from authenticated;
grant execute on function public.admin_set_subscription(uuid, text, timestamp with time zone, text, jsonb) to service_role;

revoke execute on function public.admin_update_profile(uuid, text, text, text, text, date) from authenticated;
grant execute on function public.admin_update_profile(uuid, text, text, text, text, date) to service_role;

revoke execute on function public.set_paid_seats_total(uuid, integer, boolean) from authenticated;
grant execute on function public.set_paid_seats_total(uuid, integer, boolean) to service_role;
