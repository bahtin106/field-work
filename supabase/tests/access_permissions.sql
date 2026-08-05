\set ON_ERROR_STOP on

begin;

create temporary table access_test_context on commit drop as
select
  worker.id as worker_id,
  worker.company_id,
  order_row.id as order_id,
  order_row.assigned_to as original_assigned_to,
  order_row.start_price as original_start_price,
  admin_row.id as admin_id
from public.profiles worker
join lateral (
  select candidate.id, candidate.assigned_to, candidate.start_price
  from public.orders candidate
  where candidate.company_id = worker.company_id
  limit 1
) order_row on true
join lateral (
  select candidate.id
  from public.profiles candidate
  where candidate.company_id = worker.company_id
    and lower(coalesce(candidate.role, '')) = 'admin'
  limit 1
) admin_row on true
where lower(coalesce(worker.role, '')) = 'worker'
limit 1;

do $test$
begin
  if not exists (select 1 from access_test_context) then
    raise exception 'access test requires a worker in a company with an order';
  end if;
end;
$test$;

insert into public.app_role_permissions (company_id, role, key, value)
select company_id, 'worker', key, false
from access_test_context
cross join unnest(array[
  'canEditOrderAmount', 'canAssignExecutors', 'canViewClients', 'canViewObjects'
]::text[]) key
on conflict (company_id, role, key) do update set value = excluded.value;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', worker_id, 'role', 'authenticated')::text,
  true
)
from access_test_context;

do $test$
declare
  v_context access_test_context%rowtype;
begin
  select * into strict v_context from access_test_context;

  if exists (select 1 from public.clients_secure_including_trash_v1) then
    raise exception 'client secure view ignored canViewClients=false';
  end if;
  if exists (select 1 from public.client_objects_secure_including_trash_v1) then
    raise exception 'object secure view ignored canViewObjects=false';
  end if;

  begin
    update public.orders
    set start_price = coalesce(v_context.original_start_price, 0) + 1
    where id = v_context.order_id;
    raise exception 'order amount changed without canEditOrderAmount';
  exception
    when insufficient_privilege then
      if position('Order amount edit denied' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    update public.orders
    set assigned_to = gen_random_uuid()
    where id = v_context.order_id;
    raise exception 'order assignment changed without canAssignExecutors';
  exception
    when insufficient_privilege then
      if position('Order assignment denied' in sqlerrm) = 0 then raise; end if;
  end;
end;
$test$;

update public.app_role_permissions permission
set value = false
from access_test_context context
where permission.company_id = context.company_id
  and permission.role = 'admin'
  and permission.key = 'canDeleteOrders';

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
  true
)
from access_test_context;

do $test$
begin
  if not public.current_user_has_app_permission('canDeleteOrders', false) then
    raise exception 'administrator was locked out by a stored override';
  end if;
end;
$test$;

select 'access permission verification passed' as result;

rollback;
