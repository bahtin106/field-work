begin;

-- 1) Ensure work type field is enabled in order form when company uses work types.
insert into public.company_entity_field_settings (
  company_id,
  entity_type,
  field_key,
  is_enabled,
  is_required,
  created_at,
  updated_at,
  custom_label
)
select
  c.id,
  'order',
  'work_type_id',
  true,
  false,
  now(),
  now(),
  null
from public.companies c
where c.use_work_types = true
  and not exists (
    select 1
    from public.company_entity_field_settings s
    where s.company_id = c.id
      and s.entity_type = 'order'
      and s.field_key = 'work_type_id'
  );

update public.company_entity_field_settings s
set
  is_enabled = true,
  updated_at = now()
from public.companies c
where s.company_id = c.id
  and s.entity_type = 'order'
  and s.field_key = 'work_type_id'
  and c.use_work_types = true
  and s.is_enabled is distinct from true;

-- 2) Best-effort backfill work_type_id from latest audit snapshot.
with latest_work_type as (
  select distinct on (l.entity_id)
    l.entity_id::uuid as order_id,
    nullif(l.after_data->>'work_type_id', '')::uuid as work_type_id
  from public.app_entity_audit_log l
  where l.entity_type = 'orders'
    and nullif(l.after_data->>'work_type_id', '') is not null
    and l.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  order by l.entity_id, l.created_at desc
)
update public.orders o
set work_type_id = lw.work_type_id
from latest_work_type lw
where o.id = lw.order_id
  and o.work_type_id is null
  and exists (
    select 1
    from public.work_types wt
    where wt.id = lw.work_type_id
      and wt.company_id = o.company_id
      and wt.is_enabled = true
  );

-- 3) Remove order-level department contour.
drop function if exists public.search_orders(text, uuid, text, text[], boolean, integer, integer);
drop trigger if exists trg_orders_validate_enabled_department on public.orders;
drop policy if exists orders_insert_admin_dispatcher on public.orders;

drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;

alter table public.orders
  drop constraint if exists orders_department_id_fkey;

drop index if exists public.idx_orders_department_id;

alter table public.orders
  drop column if exists department_id;

drop function if exists public.orders_validate_enabled_department();

create or replace function public.orders_enforce_company_dept()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_company uuid;
begin
  v_company := coalesce(new.company_id, public.user_company_id());
  if v_company is null then
    raise exception 'orders.company_id is NULL and user_company_id() is NULL';
  end if;
  new.company_id := v_company;
  return new;
end
$$;

create or replace function public.update_order_if_version(
  p_order_id text,
  p_expected_updated_at timestamp with time zone,
  p_patch jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  select * into v_current
  from public.orders
  where id::text = p_order_id
  for update;

  if not found then
    return null;
  end if;

  if p_expected_updated_at is not null
     and v_current.updated_at is distinct from p_expected_updated_at then
    return null;
  end if;

  update public.orders o
  set
    title = case when p_patch ? 'title' then nullif(p_patch->>'title', '') else o.title end,
    comment = case when p_patch ? 'comment' then nullif(p_patch->>'comment', '') else o.comment end,
    entrance_info = case when p_patch ? 'entrance_info' then nullif(p_patch->>'entrance_info', '') else o.entrance_info end,
    parking_notes = case when p_patch ? 'parking_notes' then nullif(p_patch->>'parking_notes', '') else o.parking_notes end,
    geo_lat = case when p_patch ? 'geo_lat' then nullif(p_patch->>'geo_lat', '') else o.geo_lat end,
    geo_lng = case when p_patch ? 'geo_lng' then nullif(p_patch->>'geo_lng', '') else o.geo_lng end,
    address_mode = case when p_patch ? 'address_mode' then coalesce(nullif(p_patch->>'address_mode', ''), 'object') else o.address_mode end,
    assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid else o.assigned_to end,
    client_id = case when p_patch ? 'client_id' then nullif(p_patch->>'client_id', '')::uuid else o.client_id end,
    object_id = case when p_patch ? 'object_id' then nullif(p_patch->>'object_id', '')::uuid else o.object_id end,
    time_window_start = case when p_patch ? 'time_window_start' then nullif(p_patch->>'time_window_start', '')::date else o.time_window_start end,
    time_window_end = case when p_patch ? 'time_window_end' then nullif(p_patch->>'time_window_end', '')::date else o.time_window_end end,
    departure_time = case when p_patch ? 'departure_time' then nullif(p_patch->>'departure_time', '')::time else o.departure_time end,
    status = case when p_patch ? 'status' then nullif(p_patch->>'status', '') else o.status end,
    urgent = case when p_patch ? 'urgent' then coalesce((p_patch->>'urgent')::boolean, false) else o.urgent end,
    start_price = case when p_patch ? 'start_price' then nullif(p_patch->>'start_price', '')::numeric else o.start_price end,
    work_type_id = case when p_patch ? 'work_type_id' then nullif(p_patch->>'work_type_id', '')::uuid else o.work_type_id end,
    payment_status = case when p_patch ? 'payment_status' then coalesce(nullif(p_patch->>'payment_status', ''), 'unpaid') else o.payment_status end,
    country = case when p_patch ? 'country' then nullif(p_patch->>'country', '') else o.country end,
    region = case when p_patch ? 'region' then nullif(p_patch->>'region', '') else o.region end,
    district = case when p_patch ? 'district' then nullif(p_patch->>'district', '') else o.district end,
    city = case when p_patch ? 'city' then nullif(p_patch->>'city', '') else o.city end,
    street = case when p_patch ? 'street' then nullif(p_patch->>'street', '') else o.street end,
    house = case when p_patch ? 'house' then nullif(p_patch->>'house', '') else o.house end,
    postal_code = case when p_patch ? 'postal_code' then nullif(p_patch->>'postal_code', '') else o.postal_code end,
    floor = case when p_patch ? 'floor' then nullif(p_patch->>'floor', '') else o.floor end,
    entrance = case when p_patch ? 'entrance' then nullif(p_patch->>'entrance', '') else o.entrance end,
    apartment = case when p_patch ? 'apartment' then nullif(p_patch->>'apartment', '') else o.apartment end,
    media_file_1 = case
      when p_patch ? 'media_file_1' then
        case
          when jsonb_typeof(p_patch->'media_file_1') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_1')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_1
    end,
    media_file_2 = case
      when p_patch ? 'media_file_2' then
        case
          when jsonb_typeof(p_patch->'media_file_2') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_2')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_2
    end,
    media_file_3 = case
      when p_patch ? 'media_file_3' then
        case
          when jsonb_typeof(p_patch->'media_file_3') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_3')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_3
    end,
    media_file_4 = case
      when p_patch ? 'media_file_4' then
        case
          when jsonb_typeof(p_patch->'media_file_4') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_4')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_4
    end,
    media_file_5 = case
      when p_patch ? 'media_file_5' then
        case
          when jsonb_typeof(p_patch->'media_file_5') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_5')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_5
    end,
    payment_method = case when p_patch ? 'payment_method' then nullif(p_patch->>'payment_method', '') else o.payment_method end,
    currency = case when p_patch ? 'currency' then nullif(p_patch->>'currency', '') else o.currency end,
    updated_at = now()
  where o.id::text = p_order_id
  returning * into v_updated;

  return v_updated;
end
$$;

drop policy if exists orders_insert_admin_dispatcher on public.orders;
create policy orders_insert_admin_dispatcher
on public.orders
for insert
to authenticated
with check (
  is_admin_or_dispatcher()
  and company_id = user_company_id()
);

create view public.orders_read_masked as
select
  o.id,
  o.created_at,
  o.comment,
  o.status,
  o.media_file_1,
  o.media_file_2,
  o.media_file_3,
  o.media_file_4,
  o.media_file_5,
  o.assigned_to,
  o.title,
  o.urgent,
  o.start_price,
  o.company_id,
  o.time_window_start,
  o.time_window_end,
  o.duration_min,
  o.arrival_at,
  o.departure_at,
  o.tags,
  o.payment_status,
  o.updated_at,
  o.completed_at,
  o.work_type_id,
  o.currency,
  o.created_by_user_id,
  o.creation_source,
  o.feed_entered_at,
  o.client_id,
  o.object_id,
  o.address_mode,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.country, o.country) else o.country end as country,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.region, o.region) else o.region end as region,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.city, o.city) else o.city end as city,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.street, o.street) else o.street end as street,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.house, o.house) else o.house end as house,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.postal_code, o.postal_code) else o.postal_code end as postal_code,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.floor, o.floor) else o.floor end as floor,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.entrance, o.entrance) else o.entrance end as entrance,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.apartment, o.apartment) else o.apartment end as apartment,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.comment, o.entrance_info) else o.entrance_info end as entrance_info,
  o.parking_notes,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.geo_lat, o.geo_lat) else o.geo_lat end as geo_lat,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.geo_lng, o.geo_lng) else o.geo_lng end as geo_lng,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.district, o.district) else o.district end as district,
  o.payment_method,
  o.finance_income_total,
  o.finance_expense_total,
  o.finance_discount_total,
  o.finance_gross_total,
  o.finance_net_total,
  o.finance_calculated_at,
  coalesce(
    nullif(trim(coalesce(c.full_name, '')), ''),
    nullif(
      regexp_replace(
        trim(concat_ws(' ', c.last_name, c.first_name, coalesce(c.middle_name, ''))),
        '\s+',
        ' ',
        'g'
      ),
      ''
    )
  ) as fio,
  co.name as object_name,
  nullif(client_object_summary(co.country, co.region, co.city, co.street, co.house, null, co.entrance, co.apartment), '') as object_summary,
  c.phone as customer_phone_visible,
  c.additional_phone_1 as secondary_phone_search,
  mask_order_phone_ru(c.phone) as customer_phone_masked
from public.orders o
left join public.client_objects co on co.id = o.object_id
left join public.clients c on c.id = o.client_id;

create view public.orders_secure as
select
  orm.id,
  orm.created_at,
  orm.comment,
  orm.status,
  orm.media_file_1,
  orm.media_file_2,
  orm.media_file_3,
  orm.media_file_4,
  orm.media_file_5,
  orm.assigned_to,
  orm.title,
  orm.urgent,
  orm.start_price,
  orm.company_id,
  orm.time_window_start,
  orm.time_window_end,
  orm.duration_min,
  orm.arrival_at,
  orm.departure_at,
  orm.tags,
  orm.payment_status,
  orm.updated_at,
  orm.completed_at,
  orm.work_type_id,
  orm.currency,
  orm.created_by_user_id,
  orm.creation_source,
  orm.feed_entered_at,
  orm.client_id,
  orm.object_id,
  orm.address_mode,
  orm.country,
  orm.region,
  orm.city,
  orm.street,
  orm.house,
  orm.postal_code,
  orm.floor,
  orm.entrance,
  orm.apartment,
  orm.entrance_info,
  orm.parking_notes,
  orm.geo_lat,
  orm.geo_lng,
  orm.district,
  orm.payment_method,
  orm.finance_income_total,
  orm.finance_expense_total,
  orm.finance_discount_total,
  orm.finance_gross_total,
  orm.finance_net_total,
  orm.finance_calculated_at,
  orm.fio,
  orm.object_name,
  orm.object_summary,
  orm.customer_phone_visible,
  orm.secondary_phone_search,
  orm.customer_phone_masked
from public.orders_read_masked orm;

create view public.orders_secure_v2 as
select
  orm.id,
  orm.created_at,
  orm.comment,
  orm.status,
  orm.media_file_1,
  orm.media_file_2,
  orm.media_file_3,
  orm.media_file_4,
  orm.media_file_5,
  orm.assigned_to,
  orm.title,
  orm.urgent,
  orm.start_price,
  orm.company_id,
  orm.time_window_start,
  orm.time_window_end,
  orm.duration_min,
  orm.arrival_at,
  orm.departure_at,
  orm.tags,
  orm.payment_status,
  orm.updated_at,
  orm.completed_at,
  orm.work_type_id,
  orm.currency,
  orm.created_by_user_id,
  orm.creation_source,
  orm.feed_entered_at,
  orm.client_id,
  orm.object_id,
  orm.address_mode,
  orm.country,
  orm.region,
  orm.city,
  orm.street,
  orm.house,
  orm.postal_code,
  orm.floor,
  orm.entrance,
  orm.apartment,
  orm.entrance_info,
  orm.parking_notes,
  orm.geo_lat,
  orm.geo_lng,
  orm.district,
  orm.payment_method,
  orm.finance_income_total,
  orm.finance_expense_total,
  orm.finance_discount_total,
  orm.finance_gross_total,
  orm.finance_net_total,
  orm.finance_calculated_at,
  orm.fio,
  orm.object_name,
  orm.object_summary,
  orm.customer_phone_visible,
  orm.secondary_phone_search,
  orm.customer_phone_masked
from public.orders_read_masked orm;

revoke all on table public.orders_read_masked from public, anon, authenticated, service_role;
revoke all on table public.orders_secure from public, anon, authenticated, service_role;
revoke all on table public.orders_secure_v2 from public, anon, authenticated, service_role;
grant select on table public.orders_read_masked to authenticated, service_role;
grant select on table public.orders_secure to authenticated, service_role;
grant select on table public.orders_secure_v2 to authenticated, service_role;

create or replace function public.search_orders(
  p_query text,
  p_company_id uuid,
  p_status text,
  p_work_type_ids text[],
  p_include_feed boolean,
  p_limit integer,
  p_offset integer
)
returns setof public.orders_secure_v2
language sql
security definer
set search_path = public
as $$
  select v.*
  from public.orders_secure_v2 v
  where (p_company_id is null or v.company_id = p_company_id)
    and (nullif(trim(coalesce(p_status, '')), '') is null or v.status = p_status)
    and (p_work_type_ids is null or cardinality(p_work_type_ids) = 0 or v.work_type_id::text = any(p_work_type_ids))
    and (coalesce(p_include_feed, true) or v.assigned_to is not null)
    and (nullif(trim(coalesce(p_query, '')), '') is null or to_jsonb(v)::text ilike '%' || trim(p_query) || '%')
  order by coalesce(v.time_window_start, v.created_at::date) desc nulls last
  limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_orders(text, uuid, text, text[], boolean, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_orders(text, uuid, text, text[], boolean, integer, integer) to authenticated, service_role;

commit;
