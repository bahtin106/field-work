create or replace function public.can_view_order_phone(
  p_company_id uuid,
  p_assigned_to uuid,
  p_time_window_start date,
  p_departure_at timestamp with time zone,
  p_status text,
  p_status_reference_at timestamp with time zone,
  p_departure_time time without time zone
)
returns boolean
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_mode text;
  v_tz text;
  v_anchor timestamptz;
  v_show_condition text;
  v_show_offset_mins integer;
  v_show_status text;
  v_hide_condition text;
  v_hide_offset_mins integer;
  v_hide_status text;
  v_status_key text;
  v_started boolean;
  v_stopped boolean;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return true;
  end if;

  if is_admin_or_dispatcher() then
    return true;
  end if;

  if p_assigned_to is null or p_assigned_to <> current_user_id() then
    return false;
  end if;

  select
    lower(coalesce(c.worker_phone_mode, 'always')),
    coalesce(nullif(trim(c.timezone), ''), 'UTC'),
    coalesce(c.worker_phone_show_condition, case
      when lower(coalesce(c.worker_phone_mode, 'always')) in ('off', 'never') then 'never'
      when lower(coalesce(c.worker_phone_mode, 'always')) = 'always' then 'always'
      else 'time_before_departure'
    end),
    greatest(coalesce(c.worker_phone_show_offset_mins, c.worker_phone_window_before_mins, 720), 0),
    coalesce(c.worker_phone_show_status, 'in_progress'),
    coalesce(c.worker_phone_hide_condition, case
      when lower(coalesce(c.worker_phone_mode, 'always')) in ('off', 'never') then 'never'
      when lower(coalesce(c.worker_phone_mode, 'always')) = 'always' then 'never'
      else 'time_after_departure'
    end),
    greatest(coalesce(c.worker_phone_hide_offset_mins, c.worker_phone_window_after_mins, 360), 0),
    coalesce(c.worker_phone_hide_status, 'done')
  into
    v_mode,
    v_tz,
    v_show_condition,
    v_show_offset_mins,
    v_show_status,
    v_hide_condition,
    v_hide_offset_mins,
    v_hide_status
  from public.companies c
  where c.id = p_company_id;

  if v_mode is null then
    return false;
  end if;

  if p_departure_at is not null then
    v_anchor := p_departure_at;
  elsif p_time_window_start is not null then
    v_anchor := ((p_time_window_start::timestamp + coalesce(p_departure_time, time '23:59:59')) at time zone v_tz);
  end if;

  v_status_key := public.normalize_order_status_key(p_status);

  v_started := case v_show_condition
    when 'always' then true
    when 'never' then false
    when 'time_before_departure' then v_anchor is not null and now() >= v_anchor - make_interval(mins => v_show_offset_mins)
    when 'status' then v_status_key = v_show_status and (
      v_show_offset_mins = 0
      or (p_status_reference_at is not null and now() >= p_status_reference_at + make_interval(mins => v_show_offset_mins))
    )
    else false
  end;

  if not v_started then
    return false;
  end if;

  v_stopped := case v_hide_condition
    when 'never' then false
    when 'time_after_departure' then v_anchor is not null and now() >= v_anchor + make_interval(mins => v_hide_offset_mins)
    when 'status' then v_status_key = v_hide_status and (
      v_hide_offset_mins = 0
      or (p_status_reference_at is not null and now() >= p_status_reference_at + make_interval(mins => v_hide_offset_mins))
    )
    else true
  end;

  return not v_stopped;
end;
$$;

create or replace function public.can_view_order_phone(
  p_company_id uuid,
  p_assigned_to uuid,
  p_time_window_start date,
  p_departure_at timestamp with time zone,
  p_status text,
  p_status_reference_at timestamp with time zone
)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select public.can_view_order_phone($1, $2, $3, $4, $5, $6, null::time without time zone);
$$;

create or replace function public.can_view_order_phone(
  p_company_id uuid,
  p_assigned_to uuid,
  p_time_window_start date,
  p_departure_at timestamp with time zone
)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select public.can_view_order_phone($1, $2, $3, $4, null::text, null::timestamp with time zone, null::time without time zone);
$$;

create or replace function public.orders_secure_rows()
returns setof orders_read_masked
language sql
stable security definer
set search_path to 'public'
as $$
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
      when public.can_view_order_phone(orm.company_id, orm.assigned_to, orm.time_window_start, orm.departure_at, orm.status, orm.updated_at, o.departure_time)
        then orm.customer_phone_visible
      else null::text
    end as customer_phone_visible,
    case
      when public.can_view_order_phone(orm.company_id, orm.assigned_to, orm.time_window_start, orm.departure_at, orm.status, orm.updated_at, o.departure_time)
        then orm.secondary_phone_search
      else null::text
    end as secondary_phone_search,
    orm.customer_phone_masked
  from public.orders_read_masked orm
  left join public.orders o on o.id = orm.id
  where (
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or orm.company_id = public.user_company_id()
    or (
      coalesce(current_setting('request.jwt.claims', true), '') = ''
      and current_user in ('postgres', 'supabase_admin')
    )
  );
$$;

notify pgrst, 'reload schema';
