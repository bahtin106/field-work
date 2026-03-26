begin;

-- Keep technical key, clarify business meaning.
comment on column public.client_objects.apartment is
  'Квартира/офис (technical key kept as apartment for backward compatibility)';

-- Replace trigger function so it no longer depends on deprecated columns.
create or replace function public.client_objects_sync_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_actor_id uuid;
begin
  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = new.client_id;

  if v_company_id is null then
    raise exception 'client % not found for object', new.client_id using errcode = '23503';
  end if;

  v_actor_id := auth.uid();

  new.company_id := v_company_id;
  new.name := coalesce(nullif(btrim(coalesce(new.name, '')), ''), 'Новый объект');
  new.country := nullif(btrim(coalesce(new.country, '')), '');
  new.region := nullif(btrim(coalesce(new.region, '')), '');
  new.district := nullif(btrim(coalesce(new.district, '')), '');
  new.city := nullif(btrim(coalesce(new.city, '')), '');
  new.street := nullif(btrim(coalesce(new.street, '')), '');
  new.house := nullif(btrim(coalesce(new.house, '')), '');
  new.postal_code := nullif(btrim(coalesce(new.postal_code, '')), '');
  new.floor := nullif(btrim(coalesce(new.floor, '')), '');
  new.entrance := nullif(btrim(coalesce(new.entrance, '')), '');
  new.apartment := nullif(btrim(coalesce(new.apartment, '')), '');
  new.comment := nullif(btrim(coalesce(new.comment, '')), '');
  new.geo_lat := nullif(btrim(coalesce(new.geo_lat, '')), '');
  new.geo_lng := nullif(btrim(coalesce(new.geo_lng, '')), '');
  new.additional_phone_1 := nullif(btrim(coalesce(new.additional_phone_1, '')), '');
  new.additional_phone_1_label := nullif(left(btrim(coalesce(new.additional_phone_1_label, '')), 48), '');
  new.additional_phone_2 := nullif(btrim(coalesce(new.additional_phone_2, '')), '');
  new.additional_phone_2_label := nullif(left(btrim(coalesce(new.additional_phone_2_label, '')), 48), '');
  new.additional_phone_3 := nullif(btrim(coalesce(new.additional_phone_3, '')), '');
  new.additional_phone_3_label := nullif(left(btrim(coalesce(new.additional_phone_3_label, '')), 48), '');

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, timezone('utc'::text, now()));
    new.created_by := coalesce(new.created_by, v_actor_id);

    if not exists (
      select 1
        from public.client_objects o
       where o.client_id = new.client_id
         and coalesce(o.is_primary, false)
    ) then
      new.is_primary := true;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(old.is_primary, false)
     and not coalesce(new.is_primary, false)
     and not exists (
       select 1
         from public.client_objects o
        where o.client_id = new.client_id
          and o.id <> new.id
          and coalesce(o.is_primary, false)
     ) then
    new.is_primary := true;
  end if;

  if coalesce(new.is_primary, false) then
    if exists (
      select 1
        from public.client_objects o
       where o.client_id = new.client_id
         and o.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(o.is_primary, false)
    ) then
      update public.client_objects
         set is_primary = false,
             updated_at = timezone('utc'::text, now()),
             updated_by = coalesce(v_actor_id, updated_by)
       where client_id = new.client_id
         and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(is_primary, false);
    end if;
  end if;

  new.updated_at := timezone('utc'::text, now());
  new.updated_by := coalesce(v_actor_id, new.updated_by, old.updated_by);

  return new;
end
$$;

-- Drop dependent views/functions before dropping columns.
drop function if exists public.search_orders(text, uuid, text, text[], boolean, integer, integer);
drop function if exists public.search_company_objects_for_order(text, text, text, text, uuid, integer);
drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;
drop view if exists public.order_payouts;

-- Remove legacy columns from client_objects.
alter table public.client_objects
  drop column if exists entrance_info,
  drop column if exists summary;

-- Recreate orders_read_masked without dependencies on dropped columns.
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
  o.finance_income_total, o.finance_expense_total,
  o.finance_discount_total, o.finance_gross_total,
  o.finance_net_total, o.finance_calculated_at,
  coalesce(
    nullif(trim(both from coalesce(c.full_name, '')), ''),
    nullif(regexp_replace(trim(both from concat_ws(' ', c.last_name, c.first_name, coalesce(c.middle_name, ''))), '\s+', ' ', 'g'), '')
  ) as fio,
  co.name as object_name,
  nullif(public.client_object_summary(co.country, co.region, co.city, co.street, co.house, null, co.entrance, co.apartment), '') as object_summary,
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

create or replace function public.search_company_objects_for_order(
  p_query text default '',
  p_street text default '',
  p_house text default '',
  p_city text default '',
  p_client_id uuid default null,
  p_limit integer default 8
)
returns table (
  object_id uuid,
  client_id uuid,
  object_name text,
  client_name text,
  short_address text,
  score real,
  is_same_client boolean,
  country text,
  region text,
  district text,
  city text,
  street text,
  house text,
  postal_code text,
  office text,
  floor text,
  entrance text,
  apartment text,
  entrance_info text,
  parking_notes text,
  geo_lat text,
  geo_lng text
)
language sql
stable
set search_path = public, extensions
as $$
  with input as (
    select
      public.normalize_search_text(p_query) as norm_query,
      public.normalize_search_text(p_street) as norm_street,
      public.normalize_search_text(p_city) as norm_city,
      public.normalize_search_token(p_house) as norm_house,
      greatest(1, least(coalesce(p_limit, 8), 12)) as safe_limit,
      p_client_id as preferred_client_id
  ),
  source as (
    select
      co.id as object_id,
      co.client_id,
      co.name as object_name,
      c.full_name as client_name,
      trim(concat_ws(', ', nullif(co.city, ''), nullif(co.street, ''), nullif(co.house, ''))) as short_address,
      co.country,
      co.region,
      co.district,
      co.city,
      co.street,
      co.house,
      co.postal_code,
      null::text as office,
      co.floor,
      co.entrance,
      co.apartment,
      co.comment as entrance_info,
      null::text as parking_notes,
      co.geo_lat,
      co.geo_lng,
      public.normalize_search_text(co.street) as norm_street,
      public.normalize_search_text(co.city) as norm_city,
      public.normalize_search_token(co.house) as norm_house,
      public.normalize_search_text(
        concat_ws(
          ' ',
          coalesce(co.name, ''),
          coalesce(c.full_name, ''),
          coalesce(co.city, ''),
          coalesce(co.street, ''),
          coalesce(co.house, ''),
          coalesce(co.apartment, ''),
          coalesce(co.entrance, ''),
          coalesce(co.postal_code, '')
        )
      ) as norm_blob
    from public.client_objects co
    join public.clients c on c.id = co.client_id
    where co.company_id = public.user_company_id()
  ),
  ranked as (
    select
      s.*,
      i.preferred_client_id,
      case
        when i.norm_house = '' then 0.12
        when s.norm_house = i.norm_house then 1.0
        when s.norm_house like i.norm_house || '%' or i.norm_house like s.norm_house || '%' then 0.72
        else 0.0
      end as house_score,
      case
        when i.norm_street = '' then 0.0
        else greatest(similarity(s.norm_street, i.norm_street), word_similarity(s.norm_street, i.norm_street))
      end as street_score,
      case
        when i.norm_city = '' then 0.18
        else greatest(similarity(s.norm_city, i.norm_city), word_similarity(s.norm_city, i.norm_city))
      end as city_score,
      case
        when i.norm_query = '' then 0.0
        else greatest(similarity(s.norm_blob, i.norm_query), word_similarity(s.norm_blob, i.norm_query))
      end as query_score
    from source s
    cross join input i
    where (i.norm_query <> '' or i.norm_street <> '' or i.norm_house <> '')
      and (
        (i.norm_house <> '' and (s.norm_house = i.norm_house or s.norm_house like i.norm_house || '%' or i.norm_house like s.norm_house || '%'))
        or (i.norm_street <> '' and greatest(similarity(s.norm_street, i.norm_street), word_similarity(s.norm_street, i.norm_street)) >= 0.42)
        or (i.norm_query <> '' and greatest(similarity(s.norm_blob, i.norm_query), word_similarity(s.norm_blob, i.norm_query)) >= 0.36)
      )
  ),
  scored as (
    select
      r.*,
      (
        r.house_score * 0.34 +
        r.street_score * 0.36 +
        r.city_score * 0.10 +
        r.query_score * 0.12 +
        case when r.preferred_client_id is not null and r.client_id = r.preferred_client_id then 0.08 else 0 end
      )::real as score,
      (r.preferred_client_id is not null and r.client_id = r.preferred_client_id) as is_same_client
    from ranked r
  )
  select
    s.object_id,
    s.client_id,
    s.object_name,
    s.client_name,
    s.short_address,
    s.score,
    s.is_same_client,
    s.country,
    s.region,
    s.district,
    s.city,
    s.street,
    s.house,
    s.postal_code,
    s.office,
    s.floor,
    s.entrance,
    s.apartment,
    s.entrance_info,
    s.parking_notes,
    s.geo_lat,
    s.geo_lng
  from scored s
  cross join input i
  where s.score >= case when i.norm_street <> '' and i.norm_house <> '' then 0.44 else 0.52 end
  order by
    s.score desc,
    s.is_same_client desc,
    s.object_name asc,
    s.object_id asc
  limit (select safe_limit from input);
$$;

grant execute on function public.search_company_objects_for_order(text, text, text, text, uuid, integer) to authenticated;

commit;
