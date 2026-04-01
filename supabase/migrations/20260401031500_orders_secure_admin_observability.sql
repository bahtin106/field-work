begin;

-- AAA: keep strict tenant boundary for JWT sessions,
-- but allow operational observability in direct admin SQL sessions without JWT.

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
  case
    when public.can_view_order_phone(orm.company_id, orm.assigned_to, orm.time_window_start, orm.departure_at)
      then orm.customer_phone_visible
    else null
  end as customer_phone_visible,
  orm.secondary_phone_search,
  orm.customer_phone_masked
from public.orders_read_masked orm
where (
  coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  or orm.company_id = public.user_company_id()
  or (
    coalesce(current_setting('request.jwt.claims', true), '') = ''
    and current_user in ('postgres', 'supabase_admin')
  )
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
  case
    when public.can_view_order_phone(orm.company_id, orm.assigned_to, orm.time_window_start, orm.departure_at)
      then orm.customer_phone_visible
    else null
  end as customer_phone_visible,
  orm.secondary_phone_search,
  orm.customer_phone_masked
from public.orders_read_masked orm
where (
  coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  or orm.company_id = public.user_company_id()
  or (
    coalesce(current_setting('request.jwt.claims', true), '') = ''
    and current_user in ('postgres', 'supabase_admin')
  )
);

commit;
