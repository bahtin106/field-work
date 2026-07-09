create or replace function public.check_employee_orders(employee_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_role text;
  v_actor_company_id uuid;
  v_target_company_id uuid;
  v_is_super_admin boolean := public.is_super_admin();
  active_count integer := 0;
  total_count integer := 0;
  available_employees json;
begin
  if employee_id is null then
    raise exception 'Employee id is required' using errcode = '22023';
  end if;

  select p.role, p.company_id
    into v_actor_role, v_actor_company_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1;

  if not v_is_super_admin and coalesce(v_actor_role, '') not in ('admin', 'dispatcher') then
    raise exception 'Access denied. Only admins and dispatchers can check employee orders.'
      using errcode = '42501';
  end if;

  select p.company_id
    into v_target_company_id
  from public.profiles p
  where p.id = employee_id
  limit 1;

  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  if not v_is_super_admin and v_target_company_id is distinct from v_actor_company_id then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select count(*)
    into active_count
  from public.orders o
  where o.assigned_to = employee_id
    and o.status not in ('completed', 'cancelled');

  select count(*)
    into total_count
  from public.orders o
  where o.assigned_to = employee_id;

  select json_agg(
    json_build_object(
      'id', p.id,
      'email', p.email,
      'first_name', p.first_name,
      'middle_name', p.middle_name,
      'last_name', p.last_name,
      'full_name', p.full_name,
      'role', p.role
    )
    order by lower(coalesce(nullif(p.full_name, ''), p.email, p.id::text))
  )
    into available_employees
  from public.profiles p
  where p.company_id is not distinct from v_target_company_id
    and p.id <> employee_id
    and p.role in ('worker', 'admin', 'dispatcher')
    and p.is_admin_blocked = false;

  return json_build_object(
    'activeOrdersCount', active_count,
    'totalOrdersCount', total_count,
    'hasOrders', total_count > 0,
    'availableEmployees', coalesce(available_employees, '[]'::json)
  );
end;
$$;

grant execute on function public.check_employee_orders(uuid) to authenticated;
