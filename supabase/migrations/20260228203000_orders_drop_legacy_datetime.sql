begin;

do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      p.proname as routine_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('search_orders')
  loop
    execute format(
      'drop function if exists %I.%I(%s);',
      r.schema_name,
      r.routine_name,
      r.identity_args
    );
  end loop;
end
$$;

drop materialized view if exists public.mv_orders_daily_counts;
drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;

alter table public.orders
  drop column if exists datetime;

create or replace view public.orders_read_masked as
select
  o.*,
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
  co.summary as object_summary,
  co.country,
  co.region,
  co.city,
  co.street,
  co.house,
  co.postal_code,
  co.building,
  co.floor,
  co.entrance,
  co.apartment,
  co.intercom,
  co.entrance_info,
  co.parking_notes,
  co.geo_lat,
  co.geo_lng,
  c.secondary_phone,
  c.email as contact_email,
  c.contact_pref,
  c.phone as customer_phone_visible,
  public.mask_order_phone_ru(c.phone) as customer_phone_masked,
  c.phone as phone_visible
from public.orders o
left join public.client_objects co on co.id = o.object_id
left join public.clients c on c.id = o.client_id;

create or replace view public.orders_secure as
select *
from public.orders_read_masked;

create or replace view public.orders_secure_v2 as
select *
from public.orders_read_masked;

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
       or concat_ws(
         ' ',
         v.title,
         v.fio,
         v.customer_phone_visible,
         v.secondary_phone,
         v.contact_email,
         v.contact_pref,
         v.region,
         v.city,
         v.street,
         v.house,
         v.object_name,
         v.object_summary
       ) ilike '%' || trim(p_query) || '%'
     )
   order by coalesce(v.time_window_start, v.created_at) desc nulls last
   limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.search_orders(text, uuid, text, text[], boolean, integer, integer)
  to authenticated;

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

commit;
