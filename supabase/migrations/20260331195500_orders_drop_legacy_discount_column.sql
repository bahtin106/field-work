begin;

drop function if exists public.search_orders(text, uuid, text, text[], boolean, integer, integer);

drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;

alter table public.orders
  drop column if exists discount;

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
  o.department_id,
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
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.country, o.country)
    else o.country
  end as country,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.region, o.region)
    else o.region
  end as region,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.city, o.city)
    else o.city
  end as city,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.street, o.street)
    else o.street
  end as street,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.house, o.house)
    else o.house
  end as house,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.postal_code, o.postal_code)
    else o.postal_code
  end as postal_code,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.floor, o.floor)
    else o.floor
  end as floor,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.entrance, o.entrance)
    else o.entrance
  end as entrance,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.apartment, o.apartment)
    else o.apartment
  end as apartment,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.comment, o.entrance_info)
    else o.entrance_info
  end as entrance_info,
  o.parking_notes,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.geo_lat, o.geo_lat)
    else o.geo_lat
  end as geo_lat,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.geo_lng, o.geo_lng)
    else o.geo_lng
  end as geo_lng,
  case
    when o.address_mode = 'object' and o.object_id is not null and co.id is not null then coalesce(co.district, o.district)
    else o.district
  end as district,
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
  nullif(
    client_object_summary(co.country, co.region, co.city, co.street, co.house, null, co.entrance, co.apartment),
    ''
  ) as object_summary,
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
  orm.department_id,
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
  orm.department_id,
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

grant select on public.orders_read_masked to authenticated, service_role;
grant select on public.orders_secure to authenticated, service_role;
grant select on public.orders_secure_v2 to authenticated, service_role;

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

grant execute on function public.search_orders(text, uuid, text, text[], boolean, integer, integer)
  to authenticated, service_role;

commit;
