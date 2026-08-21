\set ON_ERROR_STOP on

-- Run after 20260820200000_guard_derived_payment_status_updates.sql.
-- All writes are rolled back.
begin;

create temporary table payment_status_guard_context on commit drop as
select
  profile.id as admin_id,
  order_row.id as order_id,
  order_row.company_id,
  company.use_partial_payments as original_partial_mode
from public.profiles profile
join public.companies company on company.id = profile.company_id
join lateral (
  select candidate.id, candidate.company_id
  from public.orders candidate
  where candidate.company_id = profile.company_id
  order by candidate.updated_at desc nulls last
  limit 1
) order_row on true
where lower(coalesce(profile.role, '')) = 'admin'
order by profile.updated_at desc nulls last
limit 1;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', context.admin_id, 'role', 'authenticated')::text,
  true
)
from payment_status_guard_context context;

select public.set_company_partial_payments_enabled_v1(false);

create temporary table payment_status_guard_audit_before_manual on commit drop as
select audit.id
from public.app_entity_audit_log audit
join payment_status_guard_context context on context.order_id = audit.order_id;

update public.orders order_row
set payment_status = case when order_row.payment_status = 'paid' then 'unpaid' else 'paid' end,
    updated_at = now()
where order_row.id = (select context.order_id from payment_status_guard_context context);

do $test$
declare
  v_order_id uuid;
  v_event_count integer;
begin
  select context.order_id into strict v_order_id
  from payment_status_guard_context context;

  select count(*) into v_event_count
  from public.app_entity_audit_log audit
  where audit.order_id = v_order_id
    and audit.entity_type = 'orders'
    and audit.action = 'update'
    and 'payment_status' = any(coalesce(audit.changed_fields, '{}'::text[]))
    and not exists (
      select 1
      from payment_status_guard_audit_before_manual before_row
      where before_row.id = audit.id
    );

  if v_event_count <> 1 then
    raise exception 'manual payment status update created % audit events instead of one', v_event_count;
  end if;
end;
$test$;

select public.set_company_partial_payments_enabled_v1(true);

create temporary table payment_status_guard_audit_before_rejected on commit drop as
select audit.id
from public.app_entity_audit_log audit
join payment_status_guard_context context on context.order_id = audit.order_id;

do $test$
declare
  v_order_id uuid;
begin
  select context.order_id into strict v_order_id
  from payment_status_guard_context context;

  begin
    update public.orders order_row
    set payment_status = case when order_row.payment_status = 'paid' then 'unpaid' else 'paid' end,
        updated_at = now()
    where order_row.id = v_order_id;

    raise exception 'derived payment status accepted a direct update';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'payment_status_managed_by_customer_payments' then
        raise;
      end if;
  end;
end;
$test$;

do $test$
declare
  v_order_id uuid;
  v_event_count integer;
begin
  select context.order_id into strict v_order_id
  from payment_status_guard_context context;

  select count(*) into v_event_count
  from public.app_entity_audit_log audit
  where audit.order_id = v_order_id
    and audit.entity_type = 'orders'
    and 'payment_status' = any(coalesce(audit.changed_fields, '{}'::text[]))
    and not exists (
      select 1
      from payment_status_guard_audit_before_rejected before_row
      where before_row.id = audit.id
    );

  if v_event_count <> 0 then
    raise exception 'rejected direct payment status update leaked into the audit log';
  end if;
end;
$test$;

rollback;
