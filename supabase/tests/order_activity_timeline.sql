\set ON_ERROR_STOP on

-- Run after the migration. Test writes are always rolled back.
begin;

create temporary table order_activity_test_context on commit drop as
select
  p.id as test_admin_id,
  o.id as test_order_id,
  o.company_id as test_company_id,
  company.work_mode as test_work_mode,
  null::uuid as test_payment_id,
  null::uuid as test_derived_audit_id,
  gen_random_uuid() as test_finance_entity_id,
  null::uuid as test_finance_insert_audit_id,
  null::uuid as test_finance_initialization_audit_id,
  null::uuid as test_finance_numeric_noop_audit_id,
  clock_timestamp() as test_finance_occurred_at
from public.profiles p
join public.companies company on company.id = p.company_id
join lateral (
  select candidate.id, candidate.company_id
  from public.orders candidate
  where candidate.company_id = p.company_id
  order by candidate.updated_at desc nulls last
  limit 1
) o on true
where lower(coalesce(p.role, '')) = 'admin'
order by p.updated_at desc nulls last
limit 1;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', context.test_admin_id, 'role', 'authenticated')::text,
  true
)
from order_activity_test_context context;

do $test$
declare
  v_order_id uuid;
  v_company_id uuid;
  v_work_mode text;
begin
  select test_order_id, test_company_id, test_work_mode
    into strict v_order_id, v_company_id, v_work_mode
  from order_activity_test_context;

  update public.companies set order_history_enabled = false where id = v_company_id;

  if v_work_mode = 'company' then
    if not (select order_history_enabled from public.companies where id = v_company_id) then
      raise exception 'company order history was disabled';
    end if;
    begin
      perform public.set_company_order_history_enabled_v1(false);
      raise exception 'company history toggle unexpectedly accepted false';
    exception
      when insufficient_privilege then null;
    end;
  else
    begin
      perform public.get_order_activity(v_order_id, 1, null, null);
      raise exception 'disabled solo order-history feature allowed timeline access';
    exception
      when insufficient_privilege then
        if position('order history feature is disabled' in sqlerrm) = 0 then
          raise;
        end if;
    end;
  end if;
end;
$test$;

select public.set_company_order_history_enabled_v1(true);
select public.set_company_partial_payments_enabled_v1(true);

do $test$
begin
  if not exists (
    select 1
    from public.companies company
    join order_activity_test_context context
      on context.test_company_id = company.id
    where company.order_history_enabled is true
  ) then
    raise exception 'admin feature RPC did not leave order history enabled';
  end if;
end;
$test$;

do $test$
begin
  if not public.order_permission_default('admin', 'canViewOrderHistory') then
    raise exception 'admin order-history default must be enabled';
  end if;
  if not public.order_permission_default('dispatcher', 'canViewOrderHistory') then
    raise exception 'dispatcher order-history default must be enabled';
  end if;
  if public.order_permission_default('worker', 'canViewOrderHistory') then
    raise exception 'worker order-history default must be disabled';
  end if;
end;
$test$;

with inserted_payment as (
  insert into public.order_customer_payments (
  company_id,
  order_id,
  amount,
  payment_method,
  paid_at,
  note,
  source,
  created_by,
  updated_by,
  money_holder
) select
  context.test_company_id,
  context.test_order_id,
  123.45,
  'cash',
  now(),
  'order activity transactional verification',
  'manual',
  context.test_admin_id,
  context.test_admin_id,
  'company'
  from order_activity_test_context context
  returning id
)
update order_activity_test_context context
set test_payment_id = inserted_payment.id
from inserted_payment;

-- A SECURITY DEFINER/server-side write can legitimately carry no auth.uid()
-- while preserving the initiating employee in updated_by. The audit trigger
-- must recover that verified same-company actor instead of losing attribution.
select set_config('request.jwt.claims', '{}'::jsonb::text, true);

update public.order_customer_payments payment
set note = 'order activity actor fallback verification',
    updated_by = context.test_admin_id
from order_activity_test_context context
where payment.id = context.test_payment_id;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', context.test_admin_id, 'role', 'authenticated')::text,
  true
)
from order_activity_test_context context;

update public.orders
set phone = 'ORDER_ACTIVITY_SECRET_VALUE'
where id = (select test_order_id from order_activity_test_context);

-- Aggregate finance totals are implementation details recalculated after a
-- causal finance action. They remain in the immutable audit archive but must
-- never be exposed as standalone user-facing timeline events.
with inserted_derived_audit as (
  insert into public.app_entity_audit_log (
    company_id,
    entity_type,
    entity_id,
    action,
    actor_user_id,
    before_data,
    after_data,
    changed_fields,
    order_id
  ) select
    context.test_company_id,
    'orders',
    context.test_order_id::text,
    'update',
    null,
    jsonb_build_object('finance_expense_total', 0),
    jsonb_build_object('finance_expense_total', 1000),
    array['finance_expense_total']::text[],
    context.test_order_id
  from order_activity_test_context context
  returning id
)
update order_activity_test_context context
set test_derived_audit_id = inserted_derived_audit.id
from inserted_derived_audit;

-- A finance entry creation and its same-transaction amount initialization are
-- one user action. Historical audit rows may contain both technical records;
-- the timeline must expose one enriched creation event with the final amount.
with inserted_finance_audit as (
  insert into public.app_entity_audit_log (
    company_id,
    entity_type,
    entity_id,
    action,
    actor_user_id,
    before_data,
    after_data,
    changed_fields,
    order_id,
    created_at
  ) select
    context.test_company_id,
    'order_finance_entries',
    context.test_finance_entity_id::text,
    'insert',
    context.test_admin_id,
    null,
    jsonb_build_object(
      'kind', 'expense',
      'title', 'timeline initialization verification',
      'calc_mode', 'fixed',
      'input_amount', 70,
      'input_percent', 0,
      'percent_base', 'base_price',
      'calculated_amount', 0,
      'visibility_scope', 'all',
      'is_system', false,
      'expense_payer', 'company',
      'finance_effect', 'company_cost'
    ),
    null,
    context.test_order_id,
    context.test_finance_occurred_at
  from order_activity_test_context context
  returning id
)
update order_activity_test_context context
set test_finance_insert_audit_id = inserted_finance_audit.id
from inserted_finance_audit;

with inserted_initialization_audit as (
  insert into public.app_entity_audit_log (
    company_id,
    entity_type,
    entity_id,
    action,
    actor_user_id,
    before_data,
    after_data,
    changed_fields,
    order_id,
    created_at
  ) select
    context.test_company_id,
    'order_finance_entries',
    context.test_finance_entity_id::text,
    'update',
    context.test_admin_id,
    jsonb_build_object(
      'title', 'timeline initialization verification',
      'calculated_amount', 0
    ),
    jsonb_build_object(
      'title', 'timeline initialization verification',
      'calculated_amount', 70
    ),
    array['calculated_amount']::text[],
    context.test_order_id,
    context.test_finance_occurred_at
  from order_activity_test_context context
  returning id
)
update order_activity_test_context context
set test_finance_initialization_audit_id = inserted_initialization_audit.id
from inserted_initialization_audit;

with inserted_numeric_noop_audit as (
  insert into public.app_entity_audit_log (
    company_id,
    entity_type,
    entity_id,
    action,
    actor_user_id,
    before_data,
    after_data,
    changed_fields,
    order_id,
    created_at
  ) select
    context.test_company_id,
    'order_finance_entries',
    context.test_finance_entity_id::text,
    'update',
    context.test_admin_id,
    jsonb_build_object('input_amount', 70::numeric),
    jsonb_build_object('input_amount', 70.00::numeric),
    array['input_amount']::text[],
    context.test_order_id,
    context.test_finance_occurred_at
  from order_activity_test_context context
  returning id
)
update order_activity_test_context context
set test_finance_numeric_noop_audit_id = inserted_numeric_noop_audit.id
from inserted_numeric_noop_audit;

do $test$
declare
  v_context record;
  v_payment_audit_count integer;
  v_payment_fallback_audit_count integer;
  v_payment_timeline_count integer;
  v_finance_creation_count integer;
  v_finance_creation_amount numeric;
  v_finance_creation_changes jsonb;
  v_phone_change jsonb;
begin
  select *
  into strict v_context
  from order_activity_test_context;

  select count(*) into v_payment_audit_count
  from public.app_entity_audit_log a
  where a.entity_type = 'order_customer_payments'
    and a.entity_id = v_context.test_payment_id::text
    and a.order_id = v_context.test_order_id
    and a.actor_user_id = v_context.test_admin_id
    and a.action = 'insert';

  if v_payment_audit_count <> 1 then
    raise exception 'payment audit trigger did not create exactly one typed event';
  end if;

  select count(*) into v_payment_fallback_audit_count
  from public.app_entity_audit_log a
  where a.entity_type = 'order_customer_payments'
    and a.entity_id = v_context.test_payment_id::text
    and a.order_id = v_context.test_order_id
    and a.actor_user_id = v_context.test_admin_id
    and a.action = 'update'
    and 'note' = any(coalesce(a.changed_fields, '{}'::text[]));

  if v_payment_fallback_audit_count <> 1 then
    raise exception 'server-side audit did not recover the verified row actor';
  end if;

  select count(*) into v_payment_timeline_count
  from public.get_order_activity(v_context.test_order_id, 100, null, null) e
  where e.entity_type = 'order_customer_payments'
    and e.context->>'entity_id' = v_context.test_payment_id::text
    and e.action = 'insert';

  if v_payment_timeline_count <> 1 then
    raise exception 'payment event is missing from the order timeline';
  end if;

  if exists (
    select 1
    from public.get_order_activity(v_context.test_order_id, 100, null, null) e
    where e.event_id = v_context.test_derived_audit_id
  ) then
    raise exception 'derived finance total leaked into the user-facing order timeline';
  end if;

  if public.order_activity_value_is_distinct('70'::jsonb, '70.00'::jsonb) then
    raise exception 'numeric formatting was treated as a real value change';
  end if;

  select count(*), max((e.context->>'amount')::numeric)
    into v_finance_creation_count, v_finance_creation_amount
  from public.get_order_activity(v_context.test_order_id, 100, null, null) e
  where e.event_id = v_context.test_finance_insert_audit_id
    and e.entity_type = 'order_finance_entries'
    and e.action = 'insert';

  if v_finance_creation_count <> 1 or v_finance_creation_amount <> 70 then
    raise exception 'finance creation was not enriched with its initialized amount';
  end if;

  select e.changes
    into strict v_finance_creation_changes
  from public.get_order_activity(v_context.test_order_id, 100, null, null) e
  where e.event_id = v_context.test_finance_insert_audit_id;

  if jsonb_array_length(v_finance_creation_changes) <> 6
     or exists (
       select 1
       from unnest(array[
         'kind', 'title', 'calc_mode', 'input_amount', 'visibility_scope', 'expense_payer'
       ]::text[]) required(field)
       where not exists (
         select 1
         from jsonb_array_elements(v_finance_creation_changes) change
         where change->>'field' = required.field
       )
     )
     or exists (
       select 1
       from jsonb_array_elements(v_finance_creation_changes) change
       where change->>'field' = any(array[
         'input_percent', 'percent_base', 'calculated_amount', 'is_system', 'finance_effect'
       ]::text[])
     ) then
    raise exception 'fixed finance creation returned the wrong semantic field set: %',
      v_finance_creation_changes;
  end if;

  if exists (
    select 1
    from public.get_order_activity(v_context.test_order_id, 100, null, null) e
    where e.event_id in (
      v_context.test_finance_initialization_audit_id,
      v_context.test_finance_numeric_noop_audit_id
    )
  ) then
    raise exception 'finance initialization or numeric no-op leaked as a second timeline event';
  end if;

  select change into v_phone_change
  from public.get_order_activity(v_context.test_order_id, 100, null, null) e
  cross join lateral jsonb_array_elements(e.changes) change
  where change->>'field' = 'phone'
  order by e.occurred_at desc
  limit 1;

  if v_phone_change is null
     or v_phone_change->>'redacted' <> 'true'
     or v_phone_change ? 'before'
     or v_phone_change ? 'after'
     or v_phone_change::text like '%ORDER_ACTIVITY_SECRET_VALUE%' then
    raise exception 'phone change was not safely redacted';
  end if;

  if exists (
    select 1
    from public.get_order_activity(v_context.test_order_id, 100, null, null) e
    cross join lateral jsonb_array_elements(e.changes) change
    where change->>'field' like 'media_file_%'
      and (
        jsonb_typeof(change->'before') not in ('number', 'null')
        or jsonb_typeof(change->'after') not in ('number', 'null')
      )
  ) then
    raise exception 'media history exposed a value other than a file count';
  end if;
end;
$test$;

select 'order activity timeline verification passed' as result;

rollback;
