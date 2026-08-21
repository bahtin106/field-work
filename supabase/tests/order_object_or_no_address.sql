\set ON_ERROR_STOP on

-- Run after 20260821010000_enforce_order_object_or_no_address.sql.
-- The test uses a real active request but rolls every change back.
begin;

create temporary table order_object_guard_context on commit drop as
select
  profile.id as admin_id,
  order_row.id as order_id,
  order_row.company_id,
  order_row.client_id,
  null::uuid as test_object_id
from public.profiles profile
join lateral (
  select candidate.id, candidate.company_id, candidate.client_id
  from public.orders candidate
  where candidate.company_id = profile.company_id
    and candidate.client_id is not null
    and not exists (
      select 1
      from public.trash_entries trash
      where trash.entity_type = 'order'
        and trash.entity_id = candidate.id
    )
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
from order_object_guard_context context;

with inserted as (
  insert into public.client_objects (company_id, client_id, name, is_primary)
  select context.company_id, context.client_id, 'Object relation guard test', false
  from order_object_guard_context context
  returning id
)
update order_object_guard_context context
set test_object_id = inserted.id
from inserted;

update public.orders order_row
set object_id = context.test_object_id,
    address_mode = 'custom',
    city = 'stale city'
from order_object_guard_context context
where order_row.id = context.order_id;

do $test$
declare
  v_context order_object_guard_context%rowtype;
  v_order public.orders%rowtype;
  v_object public.client_objects%rowtype;
begin
  select * into strict v_context from order_object_guard_context;
  select * into strict v_order from public.orders where id = v_context.order_id;
  select * into strict v_object from public.client_objects where id = v_context.test_object_id;

  if v_order.object_id is distinct from v_context.test_object_id
     or v_order.address_mode is distinct from 'object'
     or v_order.city is distinct from v_object.city then
    raise exception 'valid object selection was not normalized atomically';
  end if;
end;
$test$;

do $test$
declare
  v_context order_object_guard_context%rowtype;
begin
  select * into strict v_context from order_object_guard_context;
  begin
    update public.orders
    set client_id = null,
        object_id = v_context.test_object_id
    where id = v_context.order_id;
    raise exception 'object/client mismatch was accepted';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'order_object_not_available' then
        raise;
      end if;
  end;
end;
$test$;

update public.orders order_row
set object_id = null,
    address_mode = 'object',
    country = 'stale country',
    city = 'stale city',
    street = 'stale street',
    geo_lat = '46.000001',
    geo_lng = '48.000001'
from order_object_guard_context context
where order_row.id = context.order_id;

do $test$
declare
  v_order public.orders%rowtype;
begin
  select order_row.* into strict v_order
  from public.orders order_row
  join order_object_guard_context context on context.order_id = order_row.id;

  if v_order.object_id is not null
     or v_order.address_mode is distinct from 'custom'
     or v_order.country is not null
     or v_order.region is not null
     or v_order.district is not null
     or v_order.city is not null
     or v_order.street is not null
     or v_order.house is not null
     or v_order.postal_code is not null
     or v_order.floor is not null
     or v_order.entrance is not null
     or v_order.apartment is not null
     or v_order.entrance_info is not null
     or v_order.parking_notes is not null
     or v_order.geo_lat is not null
     or v_order.geo_lng is not null then
    raise exception 'No address state retained an object or an address snapshot';
  end if;
end;
$test$;

update public.orders order_row
set object_id = context.test_object_id
from order_object_guard_context context
where order_row.id = context.order_id;

create temporary table order_object_guard_audit_before_delete on commit drop as
select audit.id
from public.app_entity_audit_log audit
join order_object_guard_context context on context.order_id = audit.order_id;

delete from public.client_objects object_row
using order_object_guard_context context
where object_row.id = context.test_object_id;

do $test$
declare
  v_context order_object_guard_context%rowtype;
  v_order public.orders%rowtype;
  v_event_count integer;
begin
  select * into strict v_context from order_object_guard_context;
  select * into strict v_order from public.orders where id = v_context.order_id;

  if v_order.object_id is not null or v_order.address_mode is distinct from 'custom' then
    raise exception 'object deletion did not switch the linked request to No address';
  end if;

  if not exists (
    select 1
    from public.trash_entries trash
    where trash.company_id = v_context.company_id
      and trash.entity_type = 'client_object'
      and trash.entity_id = v_context.test_object_id
  ) then
    raise exception 'object deletion did not create a trash entry';
  end if;

  select count(*) into v_event_count
  from public.app_entity_audit_log audit
  where audit.order_id = v_context.order_id
    and audit.entity_type = 'orders'
    and audit.action = 'update'
    and 'object_id' = any(coalesce(audit.changed_fields, '{}'::text[]))
    and not exists (
      select 1
      from order_object_guard_audit_before_delete before_row
      where before_row.id = audit.id
    );

  if v_event_count <> 1 then
    raise exception 'object deletion created % relation history events instead of one', v_event_count;
  end if;
end;
$test$;

do $test$
declare
  v_context order_object_guard_context%rowtype;
begin
  select * into strict v_context from order_object_guard_context;
  begin
    update public.orders
    set object_id = v_context.test_object_id
    where id = v_context.order_id;
    raise exception 'trashed object was reattached by a stale write';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'order_object_not_available' then
        raise;
      end if;
  end;
end;
$test$;

-- Restoring an object removes its trash marker, but intentionally does not
-- guess which requests should be linked again. A newer user choice wins.
delete from public.trash_entries trash
using order_object_guard_context context
where trash.company_id = context.company_id
  and trash.entity_type = 'client_object'
  and trash.entity_id = context.test_object_id;

do $test$
declare
  v_context order_object_guard_context%rowtype;
  v_order public.orders%rowtype;
begin
  select * into strict v_context from order_object_guard_context;
  select * into strict v_order from public.orders where id = v_context.order_id;
  if v_order.object_id is not null or v_order.address_mode is distinct from 'custom' then
    raise exception 'restoring the object unexpectedly rewrote the request relation';
  end if;
end;
$test$;

rollback;
