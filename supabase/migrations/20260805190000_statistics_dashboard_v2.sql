begin;

-- The legacy RPC references columns that no longer exist and calculated a
-- phone-sized data dump without company boundaries. The v2 dashboard is the
-- only statistics contract going forward.
drop function if exists public.get_finance_stats(timestamp with time zone, timestamp with time zone, uuid);
drop function if exists public.get_statistics_dashboard_v2(date, date, text, uuid[], uuid[], boolean);
drop function if exists public.get_statistics_dashboard_v2(date, date, text, uuid[], uuid[], boolean, uuid[], boolean);

create index if not exists orders_company_created_at_stats_idx
  on public.orders (company_id, created_at desc, id);

create index if not exists orders_company_completed_at_stats_idx
  on public.orders (company_id, completed_at desc, id)
  where completed_at is not null;

create index if not exists orders_company_assignee_completed_stats_idx
  on public.orders (company_id, assigned_to, completed_at desc, id)
  where assigned_to is not null and completed_at is not null;

create or replace function public.get_statistics_dashboard_v2(
  p_from date default null,
  p_to date default null,
  p_scope text default 'me',
  p_employee_ids uuid[] default null,
  p_department_ids uuid[] default null,
  p_include_no_department boolean default false,
  p_work_type_ids uuid[] default null,
  p_include_no_work_type boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_role text;
  v_work_mode text;
  v_currency text;
  v_timezone text;
  v_use_departments boolean := false;
  v_use_work_types boolean := false;
  v_can_view_company boolean := false;
  v_scope text;
  v_today date;
  v_from date;
  v_to date;
  v_previous_from date;
  v_previous_to date;
  v_days integer;
  v_granularity text;
  v_bucket_step interval;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select
    profile.company_id,
    lower(coalesce(profile.role, '')),
    coalesce(company.work_mode, 'company'),
    coalesce(nullif(company.currency, ''), 'RUB'),
    coalesce(nullif(company.timezone, ''), 'UTC'),
    coalesce(company.use_departments, false),
    coalesce(company.use_work_types, false)
  into
    v_company_id,
    v_role,
    v_work_mode,
    v_currency,
    v_timezone,
    v_use_departments,
    v_use_work_types
  from public.profiles profile
  join public.companies company on company.id = profile.company_id
  where profile.id = v_uid;

  if not found or v_company_id is null then
    raise exception 'Company is not accessible' using errcode = '42501';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    v_timezone := 'UTC';
  end if;

  v_can_view_company :=
    v_role = 'admin'
    or public.current_user_has_app_permission(
      'canViewFinanceStatsAll',
      public.finance_permission_default(v_role, 'canViewFinanceStatsAll')
    );

  if v_work_mode = 'solo' then
    -- Solo owners can have unassigned requests, so their complete personal
    -- dashboard uses the company-shaped scope without exposing team controls.
    v_scope := 'company';
  elsif lower(coalesce(p_scope, 'me')) = 'company' then
    if not v_can_view_company then
      raise exception 'Company statistics permission required' using errcode = '42501';
    end if;
    v_scope := 'company';
  else
    v_scope := 'me';
  end if;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_to := least(coalesce(p_to, v_today), v_today);
  v_from := coalesce(p_from, v_to - 29);

  if v_from > v_to then
    raise exception 'Invalid statistics period' using errcode = '22007';
  end if;
  if v_to - v_from > 7304 then
    raise exception 'Statistics period is too large' using errcode = '22023';
  end if;

  v_days := (v_to - v_from) + 1;
  v_previous_to := v_from - 1;
  v_previous_from := v_previous_to - (v_days - 1);

  if v_days <= 31 then
    v_granularity := 'day';
    v_bucket_step := interval '1 day';
  elsif v_days <= 186 then
    v_granularity := 'week';
    v_bucket_step := interval '7 days';
  else
    v_granularity := 'month';
    v_bucket_step := interval '1 month';
  end if;

  with
  scope_orders as materialized (
    select
      orders.id,
      orders.created_at,
      orders.completed_at,
      orders.status,
      public.normalize_company_order_status_key(orders.status) as status_key,
      orders.assigned_to,
      assignee.department_id,
      orders.work_type_id,
      orders.creation_source,
      orders.payment_method,
      (orders.created_at at time zone v_timezone)::date as registered_date,
      (orders.completed_at at time zone v_timezone)::date as completed_date
    from public.orders orders
    left join public.profiles assignee
      on assignee.id = orders.assigned_to
     and assignee.company_id = orders.company_id
    where orders.company_id = v_company_id
      and not exists (
        select 1
        from public.trash_entries trash
        where trash.entity_type = 'order'
          and trash.entity_id = orders.id
      )
      and (v_scope = 'company' or orders.assigned_to = v_uid)
      and (
        v_scope <> 'company'
        or coalesce(cardinality(p_employee_ids), 0) = 0
        or orders.assigned_to = any(p_employee_ids)
      )
      and (
        v_scope <> 'company'
        or (
          coalesce(cardinality(p_department_ids), 0) = 0
          and not coalesce(p_include_no_department, false)
        )
        or assignee.department_id = any(coalesce(p_department_ids, '{}'::uuid[]))
        or (coalesce(p_include_no_department, false) and assignee.department_id is null)
      )
      and (
        not v_use_work_types
        or (
          (
            coalesce(cardinality(p_work_type_ids), 0) = 0
            and not coalesce(p_include_no_work_type, false)
          )
          or orders.work_type_id = any(coalesce(p_work_type_ids, '{}'::uuid[]))
          or (coalesce(p_include_no_work_type, false) and orders.work_type_id is null)
        )
      )
  ),
  registered as materialized (
    select * from scope_orders
    where registered_date between v_from and v_to
  ),
  completed as materialized (
    select * from scope_orders
    where completed_date between v_from and v_to
  ),
  previous_registered as materialized (
    select * from scope_orders
    where registered_date between v_previous_from and v_previous_to
  ),
  previous_completed as materialized (
    select * from scope_orders
    where completed_date between v_previous_from and v_previous_to
  ),
  completed_finance as materialized (
    select
      completed.*,
      coalesce(snapshot.customer_base_total, 0)::numeric as base_total,
      coalesce(snapshot.customer_charge_total, 0)::numeric as additional_sales,
      coalesce(snapshot.customer_discount_total, 0)::numeric as discounts,
      coalesce(snapshot.customer_total, 0)::numeric as revenue,
      coalesce(snapshot.worker_compensation_total, 0)::numeric as employee_compensation,
      coalesce(snapshot.worker_paid_total, 0)::numeric as employee_paid,
      coalesce(snapshot.company_cost_total, 0)::numeric as company_expenses,
      coalesce(snapshot.company_margin_total, 0)::numeric as profit,
      case snapshot.settlement_direction
        when 'company_to_executor' then coalesce(snapshot.settlement_amount, 0)
        when 'executor_to_company' then -coalesce(snapshot.settlement_amount, 0)
        else 0
      end::numeric as settlement_balance
    from completed
    left join public.order_finance_snapshots snapshot on snapshot.order_id = completed.id
  ),
  previous_completed_finance as materialized (
    select
      previous_completed.*,
      coalesce(snapshot.customer_total, 0)::numeric as revenue,
      coalesce(snapshot.worker_compensation_total, 0)::numeric as employee_compensation,
      coalesce(snapshot.company_margin_total, 0)::numeric as profit
    from previous_completed
    left join public.order_finance_snapshots snapshot on snapshot.order_id = previous_completed.id
  ),
  buckets as (
    select
      bucket_start::date as bucket_start,
      least((bucket_start + v_bucket_step - interval '1 day')::date, v_to) as bucket_end
    from generate_series(v_from::timestamp, v_to::timestamp, v_bucket_step) bucket_start
  ),
  trend_rows as (
    select
      bucket.bucket_start,
      bucket.bucket_end,
      (select count(*) from registered item where item.registered_date between bucket.bucket_start and bucket.bucket_end) as registered_count,
      (select count(*) from completed item where item.completed_date between bucket.bucket_start and bucket.bucket_end) as completed_count,
      (select coalesce(sum(item.revenue), 0) from completed_finance item where item.completed_date between bucket.bucket_start and bucket.bucket_end) as revenue,
      (select coalesce(sum(item.profit), 0) from completed_finance item where item.completed_date between bucket.bucket_start and bucket.bucket_end) as profit,
      (select coalesce(sum(item.employee_compensation), 0) from completed_finance item where item.completed_date between bucket.bucket_start and bucket.bucket_end) as employee_earnings
    from buckets bucket
  ),
  status_rows as (
    select
      registered.status_key,
      coalesce(status.name, registered.status_key, 'unknown') as name,
      coalesce(status.color, '#64748B') as color,
      coalesce(status.sort_order, 32767) as sort_order,
      count(*) as orders_count
    from registered
    left join public.company_order_statuses status
      on status.company_id = v_company_id
     and status.status_key = registered.status_key
    group by registered.status_key, status.name, status.color, status.sort_order
  ),
  source_rows as (
    select coalesce(nullif(creation_source, ''), 'unknown') as key, count(*) as orders_count
    from registered
    group by coalesce(nullif(creation_source, ''), 'unknown')
  ),
  payment_method_rows as (
    select
      coalesce(nullif(payment_method, ''), 'unknown') as key,
      count(*) as completed_count,
      coalesce(sum(revenue), 0) as revenue
    from completed_finance
    group by coalesce(nullif(payment_method, ''), 'unknown')
  ),
  employees_dimension as materialized (
    select
      profile.id,
      coalesce(
        nullif(btrim(concat_ws(' ', profile.first_name, profile.middle_name, profile.last_name)), ''),
        nullif(profile.full_name, ''),
        nullif(profile.email, ''),
        '—'
      ) as name,
      lower(coalesce(profile.role, 'worker')) as role,
      profile.department_id,
      department.name as department_name,
      coalesce(profile.is_admin_blocked, false) as is_blocked
    from public.profiles profile
    left join public.departments department
      on department.id = profile.department_id
     and department.company_id = profile.company_id
    where profile.company_id = v_company_id
  ),
  employee_rows as (
    select
      employee.id,
      employee.name,
      employee.role,
      employee.department_id,
      employee.department_name,
      employee.is_blocked,
      (select count(*) from registered item where item.assigned_to = employee.id) as registered_count,
      (select count(*) from completed item where item.assigned_to = employee.id) as completed_count,
      (select coalesce(sum(item.revenue), 0) from completed_finance item where item.assigned_to = employee.id) as revenue,
      (select coalesce(sum(item.employee_compensation), 0) from completed_finance item where item.assigned_to = employee.id) as earnings,
      (select coalesce(sum(item.profit), 0) from completed_finance item where item.assigned_to = employee.id) as profit
    from employees_dimension employee
    where v_can_view_company and v_work_mode <> 'solo'
      and (
        coalesce(cardinality(p_employee_ids), 0) = 0
        or employee.id = any(p_employee_ids)
      )
      and (
        (
          coalesce(cardinality(p_department_ids), 0) = 0
          and not coalesce(p_include_no_department, false)
        )
        or employee.department_id = any(coalesce(p_department_ids, '{}'::uuid[]))
        or (coalesce(p_include_no_department, false) and employee.department_id is null)
      )
  ),
  department_rows as (
    select
      coalesce(employee.department_id::text, 'none') as key,
      coalesce(employee.department_name, '') as name,
      coalesce(sum(employee.registered_count), 0) as registered_count,
      coalesce(sum(employee.completed_count), 0) as completed_count,
      coalesce(sum(employee.revenue), 0) as revenue,
      coalesce(sum(employee.earnings), 0) as earnings,
      coalesce(sum(employee.profit), 0) as profit
    from employee_rows employee
    group by employee.department_id, employee.department_name
  ),
  additional_sale_rows as (
    select
      coalesce(nullif(btrim(entry.title), ''), '') as name,
      count(*) as entries_count,
      coalesce(sum(entry.calculated_amount), 0) as amount
    from public.order_finance_entries entry
    join completed on completed.id = entry.order_id
    where entry.company_id = v_company_id
      and entry.finance_effect = 'customer_charge'
      and entry.is_system is not true
      and (v_scope = 'company' or v_work_mode = 'solo')
    group by coalesce(nullif(btrim(entry.title), ''), '')
  ),
  expense_entry_rows as (
    select
      entry.finance_effect,
      coalesce(nullif(btrim(entry.title), ''), '') as name,
      count(*) as entries_count,
      coalesce(sum(entry.calculated_amount), 0) as amount
    from public.order_finance_entries entry
    join completed on completed.id = entry.order_id
    where entry.company_id = v_company_id
      and entry.finance_effect in ('company_cost', 'worker_reimbursement')
      and entry.is_system is not true
      and (v_scope = 'company' or v_work_mode = 'solo')
    group by entry.finance_effect, coalesce(nullif(btrim(entry.title), ''), '')
  )
  select jsonb_build_object(
    'meta', jsonb_build_object(
      'scope', v_scope,
      'can_view_company', v_can_view_company,
      'work_mode', v_work_mode,
      'currency', v_currency,
      'timezone', v_timezone,
      'use_departments', v_use_departments,
      'use_work_types', v_use_work_types,
      'from', v_from,
      'to', v_to,
      'previous_from', v_previous_from,
      'previous_to', v_previous_to,
      'granularity', v_granularity,
      'generated_at', clock_timestamp()
    ),
    'summary', jsonb_build_object(
      'registered', (select count(*) from registered),
      'completed', (select count(*) from completed),
      'completed_from_registered', (select count(*) from registered where status_key = 'done'),
      'not_completed_from_registered', (select count(*) from registered where status_key is distinct from 'done'),
      'completion_rate', coalesce(
        (select round(count(*) filter (where status_key = 'done')::numeric / nullif(count(*), 0), 4) from registered),
        0
      ),
      'average_cycle_hours', coalesce(
        (select round(avg(extract(epoch from (completed_at - created_at)) / 3600)::numeric, 1) from completed where completed_at >= created_at),
        0
      ),
      'revenue', case when v_scope = 'company' then coalesce((select round(sum(revenue), 2) from completed_finance), 0) else null end,
      'base_revenue', case when v_scope = 'company' then coalesce((select round(sum(base_total), 2) from completed_finance), 0) else null end,
      'additional_sales', case when v_scope = 'company' then coalesce((select round(sum(additional_sales), 2) from completed_finance), 0) else null end,
      'discounts', case when v_scope = 'company' then coalesce((select round(sum(discounts), 2) from completed_finance), 0) else null end,
      'employee_compensation', case when v_scope = 'company' then coalesce((select round(sum(employee_compensation), 2) from completed_finance), 0) else null end,
      'company_expenses', case when v_scope = 'company' then coalesce((select round(sum(company_expenses), 2) from completed_finance), 0) else null end,
      'total_expenses', case when v_scope = 'company' then coalesce((select round(sum(employee_compensation + company_expenses), 2) from completed_finance), 0) else null end,
      'profit', case when v_scope = 'company' then coalesce((select round(sum(profit), 2) from completed_finance), 0) else null end,
      'average_check', case when v_scope = 'company' then coalesce((select round(sum(revenue) / nullif(count(*), 0), 2) from completed_finance), 0) else null end,
      'personal_earnings', case
        when v_work_mode = 'solo' then coalesce((select round(sum(profit), 2) from completed_finance), 0)
        when v_scope = 'me' then coalesce((select round(sum(employee_compensation), 2) from completed_finance), 0)
        else null
      end,
      'personal_paid', case when v_scope = 'me' then coalesce((select round(sum(employee_paid), 2) from completed_finance), 0) else null end,
      'personal_settlement_balance', case when v_scope = 'me' then coalesce((select round(sum(settlement_balance), 2) from completed_finance), 0) else null end
    ),
    'comparison', jsonb_build_object(
      'registered', (select count(*) from previous_registered),
      'completed', (select count(*) from previous_completed),
      'revenue', case when v_scope = 'company' then coalesce((select round(sum(revenue), 2) from previous_completed_finance), 0) else null end,
      'profit', case when v_scope = 'company' then coalesce((select round(sum(profit), 2) from previous_completed_finance), 0) else null end,
      'personal_earnings', case
        when v_work_mode = 'solo' then coalesce((select round(sum(profit), 2) from previous_completed_finance), 0)
        when v_scope = 'me' then coalesce((select round(sum(employee_compensation), 2) from previous_completed_finance), 0)
        else null
      end
    ),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from', bucket_start,
        'to', bucket_end,
        'registered', registered_count,
        'completed', completed_count,
        'revenue', case when v_scope = 'company' then round(revenue, 2) else null end,
        'profit', case when v_scope = 'company' then round(profit, 2) else null end,
        'personal_earnings', case
          when v_work_mode = 'solo' then round(profit, 2)
          when v_scope = 'me' then round(employee_earnings, 2)
          else null
        end
      ) order by bucket_start)
      from trend_rows
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', status_key,
        'name', name,
        'color', color,
        'count', orders_count
      ) order by sort_order, name)
      from status_rows
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'count', orders_count) order by orders_count desc, key)
      from source_rows
    ), '[]'::jsonb),
    'payment_methods', case when v_scope = 'company' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', key,
        'completed', completed_count,
        'revenue', round(revenue, 2)
      ) order by revenue desc, key)
      from payment_method_rows
    ), '[]'::jsonb) else '[]'::jsonb end,
    'additional_sales', case when v_scope = 'company' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name,
        'count', entries_count,
        'amount', round(amount, 2)
      ) order by amount desc, name)
      from (select * from additional_sale_rows order by amount desc, name limit 50) ranked
    ), '[]'::jsonb) else '[]'::jsonb end,
    'expenses', case when v_scope = 'company' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'effect', finance_effect,
        'name', name,
        'count', entries_count,
        'amount', round(amount, 2)
      ) order by amount desc, name)
      from (select * from expense_entry_rows order by amount desc, name limit 50) ranked
    ), '[]'::jsonb) else '[]'::jsonb end,
    'employees', case when v_can_view_company and v_work_mode <> 'solo' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'role', role,
        'department_id', department_id,
        'department_name', department_name,
        'is_blocked', is_blocked,
        'registered', registered_count,
        'completed', completed_count,
        'revenue', round(revenue, 2),
        'earnings', round(earnings, 2),
        'profit', round(profit, 2)
      ) order by completed_count desc, name)
      from employee_rows
    ), '[]'::jsonb) else '[]'::jsonb end,
    'departments', case when v_can_view_company and v_work_mode <> 'solo' and v_use_departments then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', key,
        'name', name,
        'registered', registered_count,
        'completed', completed_count,
        'revenue', round(revenue, 2),
        'earnings', round(earnings, 2),
        'profit', round(profit, 2)
      ) order by completed_count desc, name)
      from department_rows
    ), '[]'::jsonb) else '[]'::jsonb end,
    'filter_options', jsonb_build_object(
      'employees', case when v_can_view_company and v_work_mode <> 'solo' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id,
          'name', name,
          'role', role,
          'department_id', department_id,
          'department_name', department_name,
          'is_blocked', is_blocked
        ) order by name)
        from employees_dimension
      ), '[]'::jsonb) else '[]'::jsonb end,
      'departments', case when v_can_view_company and v_work_mode <> 'solo' and v_use_departments then coalesce((
        select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
        from public.departments
        where company_id = v_company_id
          and deleted_at is null
          and coalesce(is_enabled, true)
      ), '[]'::jsonb) else '[]'::jsonb end,
      'work_types', case when v_use_work_types then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', work_type.id,
          'name', work_type.name,
          'is_enabled', work_type.is_enabled
        ) order by work_type.is_enabled desc, work_type.position, work_type.name)
        from public.work_types work_type
        where work_type.company_id = v_company_id
      ), '[]'::jsonb) else '[]'::jsonb end
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_statistics_dashboard_v2(date, date, text, uuid[], uuid[], boolean, uuid[], boolean)
  from public, anon;
grant execute on function public.get_statistics_dashboard_v2(date, date, text, uuid[], uuid[], boolean, uuid[], boolean)
  to authenticated, service_role;

commit;
