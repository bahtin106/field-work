\set ON_ERROR_STOP on

begin;

create temporary table statistics_test_context on commit drop as
select
  admin.id as admin_id,
  worker.id as worker_id,
  company.id as company_id,
  (clock_timestamp() at time zone coalesce(nullif(company.timezone, ''), 'UTC'))::date as today
from public.companies company
join public.profiles admin
  on admin.company_id = company.id
 and lower(coalesce(admin.role, '')) = 'admin'
join lateral (
  select profile.id
  from public.profiles profile
  where profile.company_id = company.id
    and lower(coalesce(profile.role, '')) = 'worker'
  order by profile.created_at, profile.id
  limit 1
) worker on true
where company.work_mode = 'company'
order by company.created_at, company.id
limit 1;

do $test$
begin
  if not exists (select 1 from statistics_test_context) then
    raise exception 'statistics test requires a company with an admin and worker';
  end if;
end;
$test$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
  true
)
from statistics_test_context;

do $test$
declare
  v_context statistics_test_context%rowtype;
  v_result jsonb;
  v_filtered jsonb;
  v_definition text;
begin
  select * into strict v_context from statistics_test_context;
  select pg_catalog.pg_get_functiondef(procedure.oid)
    into strict v_definition
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'get_statistics_dashboard_v2'
     and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
       'p_from date, p_to date, p_scope text, p_employee_ids uuid[], p_department_ids uuid[], p_include_no_department boolean, p_work_type_ids uuid[], p_include_no_work_type boolean';
  if position('company_owes_worker' in v_definition) > 0
     or position('worker_owes_company' in v_definition) > 0
     or position('company_to_executor' in v_definition) = 0
     or position('executor_to_company' in v_definition) = 0 then
    raise exception 'statistics settlement directions do not match Finance V2';
  end if;
  v_result := public.get_statistics_dashboard_v2(
    v_context.today - 29,
    v_context.today,
    'company',
    null,
    null,
    false
  );

  if v_result #>> '{meta,scope}' <> 'company' then
    raise exception 'administrator did not receive company scope';
  end if;
  if coalesce((v_result #>> '{meta,can_view_company}')::boolean, false) is not true then
    raise exception 'administrator lost company statistics access';
  end if;
  if jsonb_typeof(v_result -> 'trend') <> 'array'
     or jsonb_typeof(v_result -> 'statuses') <> 'array'
     or jsonb_typeof(v_result #> '{filter_options,employees}') <> 'array'
     or jsonb_typeof(v_result #> '{filter_options,work_types}') <> 'array' then
    raise exception 'statistics response shape is incomplete';
  end if;
  if jsonb_typeof(v_result #> '{summary,registered}') <> 'number'
     or jsonb_typeof(v_result #> '{summary,profit}') <> 'number' then
    raise exception 'administrator summary is missing numeric metrics';
  end if;
  if coalesce((v_result #>> '{meta,use_work_types}')::boolean, false) then
    v_filtered := public.get_statistics_dashboard_v2(
      v_context.today - 29,
      v_context.today,
      'company',
      null,
      null,
      false,
      array['00000000-0000-0000-0000-000000000001'::uuid],
      false
    );
    if (v_filtered #>> '{summary,registered}')::integer <> 0
       or (v_filtered #>> '{summary,completed}')::integer <> 0 then
      raise exception 'work-type filter was not applied to statistics';
    end if;
  end if;
end;
$test$;

insert into public.app_role_permissions (company_id, role, key, value)
select company_id, 'worker', 'canViewFinanceStatsAll', false
from statistics_test_context
on conflict (company_id, role, key) do update set value = excluded.value;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', worker_id, 'role', 'authenticated')::text,
  true
)
from statistics_test_context;

do $test$
declare
  v_context statistics_test_context%rowtype;
  v_result jsonb;
begin
  select * into strict v_context from statistics_test_context;
  v_result := public.get_statistics_dashboard_v2(
    v_context.today - 29,
    v_context.today,
    'me',
    null,
    null,
    false
  );

  if v_result #>> '{meta,scope}' <> 'me' then
    raise exception 'worker personal scope was not enforced';
  end if;
  if (v_result #> '{summary,revenue}') is distinct from 'null'::jsonb
     or (v_result #> '{summary,profit}') is distinct from 'null'::jsonb then
    raise exception 'worker personal response exposed company finance';
  end if;
  if jsonb_typeof(v_result #> '{summary,personal_earnings}') <> 'number' then
    raise exception 'worker personal earnings are missing';
  end if;
  if jsonb_array_length(v_result #> '{filter_options,employees}') <> 0 then
    raise exception 'worker personal response exposed company filter options';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_result -> 'trend') item
    where item -> 'revenue' is distinct from 'null'::jsonb
       or item -> 'profit' is distinct from 'null'::jsonb
  ) then
    raise exception 'worker personal trend exposed company finance';
  end if;
  begin
    perform public.get_statistics_dashboard_v2(
      v_context.today - 29,
      v_context.today,
      'company',
      null,
      null,
      false
    );
    raise exception 'worker opened company statistics without permission';
  exception
    when insufficient_privilege then
      if position('Company statistics permission required' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$test$;

update public.app_role_permissions permission
set value = true
from statistics_test_context context
where permission.company_id = context.company_id
  and permission.role = 'worker'
  and permission.key = 'canViewFinanceStatsAll';

insert into public.app_role_permissions (company_id, role, key, value)
select company_id, 'worker', 'canViewFinanceAll', true
from statistics_test_context
on conflict (company_id, role, key) do update set value = excluded.value;

do $test$
declare
  v_context statistics_test_context%rowtype;
  v_result jsonb;
begin
  select * into strict v_context from statistics_test_context;
  v_result := public.get_statistics_dashboard_v2(
    v_context.today - 29,
    v_context.today,
    'company',
    array[v_context.worker_id],
    null,
    false
  );

  if v_result #>> '{meta,scope}' <> 'company' then
    raise exception 'configured worker could not open company statistics';
  end if;
  if jsonb_typeof(v_result #> '{summary,revenue}') <> 'number' then
    raise exception 'authorized company finance summary is missing';
  end if;
end;
$test$;

create temporary table statistics_solo_test_context on commit drop as
select
  admin.id as admin_id,
  company.id as company_id,
  (clock_timestamp() at time zone coalesce(nullif(company.timezone, ''), 'UTC'))::date as today
from public.companies company
join public.profiles admin
  on admin.company_id = company.id
 and lower(coalesce(admin.role, '')) = 'admin'
where company.work_mode = 'solo'
order by company.created_at, company.id
limit 1;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
  true
)
from statistics_solo_test_context;

do $test$
declare
  v_context statistics_solo_test_context%rowtype;
  v_result jsonb;
begin
  select * into v_context from statistics_solo_test_context;
  if not found then
    return;
  end if;
  v_result := public.get_statistics_dashboard_v2(
    v_context.today - 29,
    v_context.today,
    'me',
    null,
    null,
    false
  );

  if v_result #>> '{meta,work_mode}' <> 'solo'
     or v_result #>> '{meta,scope}' <> 'company' then
    raise exception 'solo administrator scope was not normalized';
  end if;
  if jsonb_typeof(v_result #> '{summary,personal_earnings}') <> 'number'
     or jsonb_typeof(v_result #> '{summary,profit}') <> 'number' then
    raise exception 'solo administrator finance summary is incomplete';
  end if;
  if jsonb_array_length(v_result #> '{filter_options,employees}') <> 0
     or jsonb_array_length(v_result #> '{filter_options,departments}') <> 0 then
    raise exception 'solo mode exposed company team filters';
  end if;
end;
$test$;

select 'statistics dashboard verification passed' as result;

rollback;
