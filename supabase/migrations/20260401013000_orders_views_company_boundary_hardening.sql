begin;

-- Harden order read views for authenticated users while keeping service role compatibility.

create or replace view public.orders_secure as
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
from public.orders_read_masked orm
where (
  coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  or current_user in ('postgres', 'supabase_admin')
  or orm.company_id = public.user_company_id()
);

create or replace view public.orders_secure_v2 as
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
from public.orders_read_masked orm
where (
  coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  or current_user in ('postgres', 'supabase_admin')
  or orm.company_id = public.user_company_id()
);

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
  where (
      coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      or current_user in ('postgres', 'supabase_admin')
      or p_company_id is null
      or p_company_id = public.user_company_id()
    )
    and (p_company_id is null or v.company_id = p_company_id)
    and (nullif(trim(coalesce(p_status, '')), '') is null or v.status = p_status)
    and (p_work_type_ids is null or cardinality(p_work_type_ids) = 0 or v.work_type_id::text = any(p_work_type_ids))
    and (coalesce(p_include_feed, true) or v.assigned_to is not null)
    and (nullif(trim(coalesce(p_query, '')), '') is null or to_jsonb(v)::text ilike '%' || trim(p_query) || '%')
  order by coalesce(v.time_window_start, v.created_at::date) desc nulls last
  limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on table public.orders_read_masked from public, anon, authenticated, service_role;
revoke all on table public.orders_secure from public, anon, authenticated, service_role;
revoke all on table public.orders_secure_v2 from public, anon, authenticated, service_role;

grant select on table public.orders_read_masked to service_role;
grant select on table public.orders_secure to authenticated, service_role;
grant select on table public.orders_secure_v2 to authenticated, service_role;

revoke all on function public.search_orders(text, uuid, text, text[], boolean, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_orders(text, uuid, text, text[], boolean, integer, integer) to authenticated, service_role;

commit;
