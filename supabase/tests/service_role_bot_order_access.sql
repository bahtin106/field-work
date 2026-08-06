\set ON_ERROR_STOP on

begin;

create temporary table service_role_bot_test_context on commit drop as
select
  worker.id as worker_id,
  worker.company_id,
  company.use_order_statuses,
  order_row.client_id,
  order_row.object_id,
  order_row.address_mode
from public.profiles worker
join public.companies company on company.id = worker.company_id
join lateral (
  select candidate.client_id, candidate.object_id, candidate.address_mode
  from public.orders candidate
  where candidate.company_id = worker.company_id
  limit 1
) order_row on true
where lower(coalesce(worker.role, '')) = 'worker'
limit 1;

do $test$
begin
  if not exists (select 1 from service_role_bot_test_context) then
    raise exception 'service-role bot test requires a worker in a company with an order';
  end if;

  if not has_table_privilege('service_role', 'public.app_role_permissions', 'SELECT')
     or not has_table_privilege('service_role', 'public.app_role_permissions', 'INSERT')
     or not has_table_privilege('service_role', 'public.app_role_permissions', 'UPDATE')
     or not has_table_privilege('service_role', 'public.app_role_permissions', 'DELETE') then
    raise exception 'service_role is missing app_role_permissions privileges';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosrc ilike '%request.jwt.claim.role%'
  ) then
    raise exception 'legacy service-role checks remain installed';
  end if;
end;
$test$;

grant select on service_role_bot_test_context to service_role;

set local role service_role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);

do $test$
begin
  if public.effective_request_role() <> 'service_role' then
    raise exception 'modern PostgREST claims did not resolve service_role';
  end if;

  if not public.current_user_has_app_permission('canAssignExecutors', false) then
    raise exception 'service_role did not bypass application role permissions';
  end if;

  perform 1 from public.app_role_permissions limit 1;
end;
$test$;

insert into public.orders (
  company_id,
  title,
  client_id,
  object_id,
  address_mode,
  assigned_to,
  status,
  urgent,
  creation_source
)
select
  context.company_id,
  '__service_role_bot_regression_test__ ' || source.provider,
  context.client_id,
  context.object_id,
  coalesce(context.address_mode, 'object'),
  context.worker_id,
  case when context.use_order_statuses then 'new' else 'Новый' end,
  false,
  source.provider
from service_role_bot_test_context context
cross join (values ('telegram'::text), ('max'::text)) source(provider);

select 'service-role bot order verification passed' as result;

rollback;
