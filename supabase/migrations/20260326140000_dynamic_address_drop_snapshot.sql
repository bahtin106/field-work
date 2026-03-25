-- 1. Make order address dynamic: when address_mode='object', show live address from client_objects
-- 2. Drop object_name_snapshot column

begin;

-- Drop dependent objects
drop function if exists public.search_orders(text, uuid, text, text[], boolean, integer, integer);
drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;
drop view if exists public.order_payouts;

-- Drop object_name_snapshot column
alter table public.orders drop column if exists object_name_snapshot;

-- Recreate orders_read_masked with dynamic address from object
create view public.orders_read_masked as
select
  o.id, o.created_at, o.comment, o.status,
  o.media_file_1, o.media_file_2, o.media_file_3, o.media_file_4, o.media_file_5,
  o.assigned_to, o.title, o.urgent, o.start_price,
  o.company_id, o.department_id, o.time_window_start, o.time_window_end,
  o.duration_min, o.arrival_at, o.departure_at, o.tags,
  o.discount, o.payment_status, o.updated_at, o.completed_at,
  o.work_type_id, o.currency, o.created_by_user_id, o.creation_source,
  o.feed_entered_at, o.client_id, o.object_id,
  o.address_mode,
  -- Dynamic address: object-mode → live from client_objects; custom-mode → from orders
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.country, o.country) else o.country end as country,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.region, o.region) else o.region end as region,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.city, o.city) else o.city end as city,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.street, o.street) else o.street end as street,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.house, o.house) else o.house end as house,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.postal_code, o.postal_code) else o.postal_code end as postal_code,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.floor, o.floor) else o.floor end as floor,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.entrance, o.entrance) else o.entrance end as entrance,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.apartment, o.apartment) else o.apartment end as apartment,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.entrance_info, co.comment, o.entrance_info) else o.entrance_info end as entrance_info,
  o.parking_notes,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.geo_lat, o.geo_lat) else o.geo_lat end as geo_lat,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.geo_lng, o.geo_lng) else o.geo_lng end as geo_lng,
  case when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.district, o.district) else o.district end as district,
  o.payment_method,
  o.finance_income_total, o.finance_expense_total,
  o.finance_discount_total, o.finance_gross_total,
  o.finance_net_total, o.finance_calculated_at,
  coalesce(
    nullif(trim(both from coalesce(c.full_name, '')), ''),
    nullif(regexp_replace(trim(both from concat_ws(' ', c.last_name, c.first_name, coalesce(c.middle_name, ''))), '\s+', ' ', 'g'), '')
  ) as fio,
  co.name as object_name,
  co.summary as object_summary,
  c.phone as customer_phone_visible,
  c.additional_phone_1 as secondary_phone_search,
  mask_order_phone_ru(c.phone) as customer_phone_masked
from public.orders o
left join public.client_objects co on co.id = o.object_id
left join public.clients c on c.id = o.client_id;

create view public.orders_secure as select * from public.orders_read_masked;
create view public.orders_secure_v2 as select * from public.orders_read_masked;

create view public.order_payouts as
select o.id as order_id, o.assigned_to, o.company_id, o.status,
  o.time_window_start as datetime, o.start_price,
  r.fuel_cost::numeric(12,2) as fuel_cost, r.payout,
  r.reimburse_fuel as fuel_reimbursable, r.rule_source
from public.orders o
left join lateral calc_order_payout(o.id) r on true;

-- Recreate update_order_if_version without object_name_snapshot
create or replace function public.update_order_if_version(
  p_order_id text, p_expected_updated_at timestamptz, p_patch jsonb
) returns public.orders
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_current public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  select * into v_current from public.orders where id::text = p_order_id for update;
  if not found then return null; end if;
  if p_expected_updated_at is not null and v_current.updated_at is distinct from p_expected_updated_at then
    return null;
  end if;
  update public.orders o set
    title = case when p_patch ? 'title' then nullif(p_patch->>'title', '') else o.title end,
    comment = case when p_patch ? 'comment' then nullif(p_patch->>'comment', '') else o.comment end,
    fio = case when p_patch ? 'fio' then nullif(p_patch->>'fio', '') else o.fio end,
    phone = case when p_patch ? 'phone' then nullif(p_patch->>'phone', '') else o.phone end,
    secondary_phone = case when p_patch ? 'secondary_phone' then nullif(p_patch->>'secondary_phone', '') else o.secondary_phone end,
    contact_email = case when p_patch ? 'contact_email' then nullif(p_patch->>'contact_email', '') else o.contact_email end,
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
    department_id = case when p_patch ? 'department_id' then nullif(p_patch->>'department_id', '')::uuid else o.department_id end,
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
    media_file_1 = case when p_patch ? 'media_file_1' then case when p_patch->'media_file_1' = 'null'::jsonb then null else array(select jsonb_array_elements_text(p_patch->'media_file_1')) end else o.media_file_1 end,
    media_file_2 = case when p_patch ? 'media_file_2' then case when p_patch->'media_file_2' = 'null'::jsonb then null else array(select jsonb_array_elements_text(p_patch->'media_file_2')) end else o.media_file_2 end,
    media_file_3 = case when p_patch ? 'media_file_3' then case when p_patch->'media_file_3' = 'null'::jsonb then null else array(select jsonb_array_elements_text(p_patch->'media_file_3')) end else o.media_file_3 end,
    media_file_4 = case when p_patch ? 'media_file_4' then case when p_patch->'media_file_4' = 'null'::jsonb then null else array(select jsonb_array_elements_text(p_patch->'media_file_4')) end else o.media_file_4 end,
    media_file_5 = case when p_patch ? 'media_file_5' then case when p_patch->'media_file_5' = 'null'::jsonb then null else array(select jsonb_array_elements_text(p_patch->'media_file_5')) end else o.media_file_5 end,
    payment_method = case when p_patch ? 'payment_method' then nullif(p_patch->>'payment_method', '') else o.payment_method end,
    currency = case when p_patch ? 'currency' then nullif(p_patch->>'currency', '') else o.currency end,
    updated_at = now()
  where o.id::text = p_order_id
  returning * into v_updated;
  return v_updated;
end;
$$;

-- Recreate search_orders
create or replace function public.search_orders(
  p_query text, p_company_id uuid, p_status text,
  p_work_type_ids text[], p_include_feed boolean,
  p_limit integer, p_offset integer
) returns setof public.orders_secure_v2
language sql security definer set search_path to 'public'
as $function$
  select v.* from public.orders_secure_v2 v
  where (p_company_id is null or v.company_id = p_company_id)
    and (nullif(trim(coalesce(p_status, '')), '') is null or v.status = p_status)
    and (p_work_type_ids is null or cardinality(p_work_type_ids) = 0 or v.work_type_id::text = any(p_work_type_ids))
    and (coalesce(p_include_feed, true) or v.assigned_to is not null)
    and (nullif(trim(coalesce(p_query, '')), '') is null or to_jsonb(v)::text ilike '%' || trim(p_query) || '%')
  order by coalesce(v.time_window_start, v.created_at::date) desc nulls last
  limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

commit;
