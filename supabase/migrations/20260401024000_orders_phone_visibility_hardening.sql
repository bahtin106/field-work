begin;

-- PII hardening: gate visible customer phone in secure order views.
-- Keep column shape unchanged; only value visibility changes.

create or replace function public.can_view_order_phone(
  p_company_id uuid,
  p_assigned_to uuid,
  p_time_window_start date,
  p_departure_at timestamptz
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_mode text;
  v_before_mins integer;
  v_after_mins integer;
  v_tz text;
  v_anchor timestamptz;
begin
  -- Internal service access keeps full visibility.
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return true;
  end if;

  -- Admin/dispatcher in same company can always see visible phone.
  if is_admin_or_dispatcher() then
    return true;
  end if;

  -- Workers only for their own assigned orders.
  if p_assigned_to is null or p_assigned_to <> current_user_id() then
    return false;
  end if;

  select
    lower(coalesce(c.worker_phone_mode, 'always')),
    greatest(coalesce(c.worker_phone_window_before_mins, 0), 0),
    greatest(coalesce(c.worker_phone_window_after_mins, 0), 0),
    coalesce(nullif(trim(c.timezone), ''), 'UTC')
  into
    v_mode,
    v_before_mins,
    v_after_mins,
    v_tz
  from public.companies c
  where c.id = p_company_id;

  if v_mode is null then
    -- Fail closed if company settings are missing.
    return false;
  end if;

  if v_mode in ('off', 'never') then
    return false;
  end if;

  if v_mode = 'always' then
    return true;
  end if;

  if v_mode <> 'window' then
    -- Unknown mode fallback.
    return false;
  end if;

  -- Anchor time for the window:
  -- 1) exact departure_at when available
  -- 2) end of departure day in company timezone when only date is known
  if p_departure_at is not null then
    v_anchor := p_departure_at;
  elsif p_time_window_start is not null then
    v_anchor := ((p_time_window_start::timestamp + time '23:59:59') at time zone v_tz);
  else
    return false;
  end if;

  return now() between (v_anchor - make_interval(mins => v_before_mins))
                 and (v_anchor + make_interval(mins => v_after_mins));
end
$$;

revoke all on function public.can_view_order_phone(uuid, uuid, date, timestamptz) from public, anon;
grant execute on function public.can_view_order_phone(uuid, uuid, date, timestamptz) to authenticated, service_role;

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
);

commit;
