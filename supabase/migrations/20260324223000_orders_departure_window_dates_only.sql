-- Normalize departure window columns to DATE-only semantics.
-- Also ensures time_window_end exists in environments where schema drift happened.

-- Break dependencies that block ALTER COLUMN TYPE.
drop function if exists public.search_orders(text, uuid, text, text[], boolean, integer, integer);
drop function if exists public.fetch_orders_for_date(date);
drop materialized view if exists public.mv_orders_daily_counts;
drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;
drop view if exists public.order_payouts;

alter table if exists public.orders
  add column if not exists time_window_start date,
  add column if not exists time_window_end date;

alter table if exists public.orders
  alter column time_window_start type date
  using case when time_window_start is null then null else time_window_start::date end,
  alter column time_window_end type date
  using case when time_window_end is null then null else time_window_end::date end;

create or replace function public.update_order_if_version(
  p_order_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
returns public.orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  select *
    into v_current
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
     set title = case when p_patch ? 'title' then nullif(p_patch->>'title', '') else o.title end,
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
         object_name_snapshot = case when p_patch ? 'object_name_snapshot' then nullif(p_patch->>'object_name_snapshot', '') else o.object_name_snapshot end,
         assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid else o.assigned_to end,
         client_id = case when p_patch ? 'client_id' then nullif(p_patch->>'client_id', '')::uuid else o.client_id end,
         object_id = case when p_patch ? 'object_id' then nullif(p_patch->>'object_id', '')::uuid else o.object_id end,
         time_window_start = case when p_patch ? 'time_window_start' then nullif(p_patch->>'time_window_start', '')::date else o.time_window_start end,
         time_window_end = case when p_patch ? 'time_window_end' then nullif(p_patch->>'time_window_end', '')::date else o.time_window_end end,
         departure_time = case when p_patch ? 'departure_time' then nullif(p_patch->>'departure_time', '')::time else o.departure_time end,
         status = case when p_patch ? 'status' then nullif(p_patch->>'status', '') else o.status end,
         urgent = case when p_patch ? 'urgent' then coalesce((p_patch->>'urgent')::boolean, false) else o.urgent end,
         department_id = case when p_patch ? 'department_id' then nullif(p_patch->>'department_id', '')::uuid else o.department_id end,
         price = case when p_patch ? 'price' then nullif(p_patch->>'price', '')::numeric else o.price end,
         work_type_id = case when p_patch ? 'work_type_id' then nullif(p_patch->>'work_type_id', '')::uuid else o.work_type_id end,
         country = case when p_patch ? 'country' then nullif(p_patch->>'country', '') else o.country end,
         region = case when p_patch ? 'region' then nullif(p_patch->>'region', '') else o.region end,
         district = case when p_patch ? 'district' then nullif(p_patch->>'district', '') else o.district end,
         city = case when p_patch ? 'city' then nullif(p_patch->>'city', '') else o.city end,
         street = case when p_patch ? 'street' then nullif(p_patch->>'street', '') else o.street end,
         house = case when p_patch ? 'house' then nullif(p_patch->>'house', '') else o.house end,
         postal_code = case when p_patch ? 'postal_code' then nullif(p_patch->>'postal_code', '') else o.postal_code end,
         office = case when p_patch ? 'office' then nullif(p_patch->>'office', '') else o.office end,
         floor = case when p_patch ? 'floor' then nullif(p_patch->>'floor', '') else o.floor end,
         entrance = case when p_patch ? 'entrance' then nullif(p_patch->>'entrance', '') else o.entrance end,
         apartment = case when p_patch ? 'apartment' then nullif(p_patch->>'apartment', '') else o.apartment end,
         contract_file = case
           when p_patch ? 'contract_file' then
             case
               when p_patch->'contract_file' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'contract_file'))
             end
           else o.contract_file
         end,
         photo_before = case
           when p_patch ? 'photo_before' then
             case
               when p_patch->'photo_before' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'photo_before'))
             end
           else o.photo_before
         end,
         photo_after = case
           when p_patch ? 'photo_after' then
             case
               when p_patch->'photo_after' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'photo_after'))
             end
           else o.photo_after
         end,
         act_file = case
           when p_patch ? 'act_file' then
             case
               when p_patch->'act_file' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'act_file'))
             end
           else o.act_file
         end,
         updated_at = now(),
         updated_by = auth.uid()
   where o.id = v_current.id
   returning * into v_updated;

  return v_updated;
end;
$function$;

grant execute on function public.update_order_if_version(text, timestamptz, jsonb) to authenticated;

create or replace view public.order_payouts as
select
  o.id as order_id,
  o.assigned_to,
  o.company_id,
  o.status,
  o.time_window_start as datetime,
  o.price,
  r.fuel_cost::numeric(12,2) as fuel_cost,
  r.payout,
  r.reimburse_fuel as fuel_reimbursable,
  r.rule_source
from public.orders o
left join lateral public.calc_order_payout(o.id) r(
  order_id,
  assigned_to,
  company_id,
  price,
  fuel_cost,
  payout,
  reimburse_fuel,
  rule_source
) on true;

create view public.orders_read_masked as
select
  o.id,
  o.created_at,
  o.comment,
  o.status,
  o.contract_file,
  o.act_file,
  o.photo_before,
  o.photo_after,
  o.assigned_to,
  o.title,
  o.urgent,
  o.price,
  o.company_id,
  o.department_id,
  o.crew_id,
  o.customer_company,
  o.time_window_start,
  o.time_window_end,
  o.duration_min,
  o.arrival_at,
  o.departure_at,
  o.tags,
  o.discount,
  o.tax_rate,
  o.total_amount,
  o.payment_status,
  o.updated_at,
  o.completed_at,
  o.work_type_id,
  o.currency,
  o.created_by_user_id,
  o.feed_entered_at,
  o.client_id,
  o.object_id,
  o.address_mode,
  o.object_name_snapshot,
  o.country,
  o.region,
  o.city,
  o.street,
  o.house,
  o.postal_code,
  o.floor,
  o.entrance,
  o.apartment,
  o.entrance_info,
  o.parking_notes,
  o.geo_lat,
  o.geo_lng,
  o.office,
  coalesce(
    nullif(trim(both from coalesce(c.full_name, '')), ''),
    nullif(
      regexp_replace(trim(both from concat_ws(' ', c.last_name, c.first_name, coalesce(c.middle_name, ''))), '\\s+', ' ', 'g'),
      ''
    )
  ) as fio,
  co.name as object_name,
  co.summary as object_summary,
  c.phone as customer_phone_visible,
  c.additional_phone_1 as secondary_phone_search,
  mask_order_phone_ru(c.phone) as customer_phone_masked
from public.orders o
left join public.client_objects co on co.id = o.object_id
left join public.clients c on c.id = o.client_id;

create view public.orders_secure as
select
  orders_read_masked.id,
  orders_read_masked.created_at,
  orders_read_masked.comment,
  orders_read_masked.status,
  orders_read_masked.contract_file,
  orders_read_masked.act_file,
  orders_read_masked.photo_before,
  orders_read_masked.photo_after,
  orders_read_masked.assigned_to,
  orders_read_masked.title,
  orders_read_masked.urgent,
  orders_read_masked.price,
  orders_read_masked.company_id,
  orders_read_masked.department_id,
  orders_read_masked.crew_id,
  orders_read_masked.customer_company,
  orders_read_masked.time_window_start,
  orders_read_masked.time_window_end,
  orders_read_masked.duration_min,
  orders_read_masked.arrival_at,
  orders_read_masked.departure_at,
  orders_read_masked.tags,
  orders_read_masked.discount,
  orders_read_masked.tax_rate,
  orders_read_masked.total_amount,
  orders_read_masked.payment_status,
  orders_read_masked.updated_at,
  orders_read_masked.completed_at,
  orders_read_masked.work_type_id,
  orders_read_masked.currency,
  orders_read_masked.created_by_user_id,
  orders_read_masked.feed_entered_at,
  orders_read_masked.client_id,
  orders_read_masked.object_id,
  orders_read_masked.address_mode,
  orders_read_masked.object_name_snapshot,
  orders_read_masked.country,
  orders_read_masked.region,
  orders_read_masked.city,
  orders_read_masked.street,
  orders_read_masked.house,
  orders_read_masked.postal_code,
  orders_read_masked.floor,
  orders_read_masked.entrance,
  orders_read_masked.apartment,
  orders_read_masked.entrance_info,
  orders_read_masked.parking_notes,
  orders_read_masked.geo_lat,
  orders_read_masked.geo_lng,
  orders_read_masked.office,
  orders_read_masked.fio,
  orders_read_masked.object_name,
  orders_read_masked.object_summary,
  orders_read_masked.customer_phone_visible,
  orders_read_masked.secondary_phone_search,
  orders_read_masked.customer_phone_masked
from public.orders_read_masked;

create view public.orders_secure_v2 as
select
  orders_read_masked.id,
  orders_read_masked.created_at,
  orders_read_masked.comment,
  orders_read_masked.status,
  orders_read_masked.contract_file,
  orders_read_masked.act_file,
  orders_read_masked.photo_before,
  orders_read_masked.photo_after,
  orders_read_masked.assigned_to,
  orders_read_masked.title,
  orders_read_masked.urgent,
  orders_read_masked.price,
  orders_read_masked.company_id,
  orders_read_masked.department_id,
  orders_read_masked.crew_id,
  orders_read_masked.customer_company,
  orders_read_masked.time_window_start,
  orders_read_masked.time_window_end,
  orders_read_masked.duration_min,
  orders_read_masked.arrival_at,
  orders_read_masked.departure_at,
  orders_read_masked.tags,
  orders_read_masked.discount,
  orders_read_masked.tax_rate,
  orders_read_masked.total_amount,
  orders_read_masked.payment_status,
  orders_read_masked.updated_at,
  orders_read_masked.completed_at,
  orders_read_masked.work_type_id,
  orders_read_masked.currency,
  orders_read_masked.created_by_user_id,
  orders_read_masked.feed_entered_at,
  orders_read_masked.client_id,
  orders_read_masked.object_id,
  orders_read_masked.address_mode,
  orders_read_masked.object_name_snapshot,
  orders_read_masked.country,
  orders_read_masked.region,
  orders_read_masked.city,
  orders_read_masked.street,
  orders_read_masked.house,
  orders_read_masked.postal_code,
  orders_read_masked.floor,
  orders_read_masked.entrance,
  orders_read_masked.apartment,
  orders_read_masked.entrance_info,
  orders_read_masked.parking_notes,
  orders_read_masked.geo_lat,
  orders_read_masked.geo_lng,
  orders_read_masked.office,
  orders_read_masked.fio,
  orders_read_masked.object_name,
  orders_read_masked.object_summary,
  orders_read_masked.customer_phone_visible,
  orders_read_masked.secondary_phone_search,
  orders_read_masked.customer_phone_masked
from public.orders_read_masked;

create or replace function public.fetch_orders_for_date(p_date date)
returns table(order_json jsonb)
language sql
stable
as $function$
  select to_jsonb(t)
  from public.orders_secure_v2 t
  where t.time_window_start = p_date
  order by t.time_window_start;
$function$;

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
set search_path to 'public'
as $function$
  select v.*
    from public.orders_secure_v2 v
   where (p_company_id is null or v.company_id = p_company_id)
     and (
       nullif(trim(coalesce(p_status, '')), '') is null
       or v.status = p_status
     )
     and (
       p_work_type_ids is null
       or cardinality(p_work_type_ids) = 0
       or v.work_type_id::text = any (p_work_type_ids)
     )
     and (
       coalesce(p_include_feed, true)
       or v.assigned_to is not null
     )
     and (
       nullif(trim(coalesce(p_query, '')), '') is null
       or to_jsonb(v)::text ilike '%' || trim(p_query) || '%'
     )
   order by coalesce(v.time_window_start, v.created_at::date) desc nulls last
   limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

grant select on public.orders_read_masked, public.orders_secure, public.orders_secure_v2, public.order_payouts
to authenticated, service_role;

-- Restore mv with the same shape and index.
create materialized view public.mv_orders_daily_counts as
select
  o.company_id,
  coalesce(o.time_window_start::date, o.created_at::date) as day,
  o.status,
  count(*)::bigint as orders_count
from public.orders o
group by 1, 2, 3;

create unique index if not exists mv_orders_daily_counts_company_day_status_idx
  on public.mv_orders_daily_counts(company_id, day, status);
