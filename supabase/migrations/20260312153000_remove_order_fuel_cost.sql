begin;

delete from public.app_role_permissions
where key in ('canViewOrderFuelCost', 'canEditOrderFuelCost');

delete from public.company_entity_field_settings
where entity_type = 'order'
  and field_key = 'fuel_cost';

create or replace function public.calc_order_payout(p_order_id uuid)
returns table(
  order_id uuid,
  assigned_to uuid,
  company_id uuid,
  price numeric,
  fuel_cost numeric,
  payout numeric,
  reimburse_fuel boolean,
  rule_source text
)
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_company uuid;
  v_user uuid;
  v_price numeric;
  v_method text;
  v_percent numeric;
  v_fixed numeric;
  v_reimburse boolean;
  v_src text := 'none';
begin
  select o.company_id, o.assigned_to, coalesce(o.price, 0)
    into v_company, v_user, v_price
  from public.orders o
  where o.id = p_order_id;

  if v_company is null then
    return query select p_order_id, v_user, v_company, v_price, 0::numeric, null::numeric, false, v_src;
    return;
  end if;

  select method, percent, fixed_amount, coalesce(reimburse_fuel, false), 'override'
    into v_method, v_percent, v_fixed, v_reimburse, v_src
  from public.compensation_overrides
  where company_id = v_company
    and user_id = v_user
    and is_active = true
    and current_date between active_from and coalesce(active_to, current_date + interval '100 years')
  limit 1;

  if v_method is null then
    select method, percent, fixed_amount, coalesce(reimburse_fuel, false), 'company'
      into v_method, v_percent, v_fixed, v_reimburse, v_src
    from public.compensation_rules
    where company_id = v_company
      and is_active = true
      and current_date between active_from and coalesce(active_to, current_date + interval '100 years')
    order by created_at desc
    limit 1;
  end if;

  return query
  select
    p_order_id,
    v_user,
    v_company,
    v_price,
    0::numeric as fuel_cost,
    case v_method
      when 'percent' then round((coalesce(v_percent, 0) / 100.0) * v_price, 2)
      when 'fixed' then coalesce(v_fixed, 0)
      when 'percent_plus_fixed' then round((coalesce(v_percent, 0) / 100.0) * v_price + coalesce(v_fixed, 0), 2)
      else null::numeric
    end as payout,
    coalesce(v_reimburse, false) as reimburse_fuel,
    v_src;
end;
$function$;

create or replace function public.get_finance_stats(
  p_from timestamptz,
  p_to timestamptz,
  p_executor uuid default null
)
returns table(
  bucket text,
  orders_count bigint,
  total_price numeric,
  total_fuel_cost numeric,
  net_income numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  urole text;
begin
  select role into urole from public.profiles where id = uid;

  if urole is null then
    raise exception 'No profile/role for current user';
  end if;

  return query
  with base as (
    select
      o.status,
      coalesce(o.price, 0)::numeric as price
    from public.orders o
    where
      (p_from is null or o.datetime >= p_from) and
      (p_to is null or o.datetime < p_to) and
      (
        (urole in ('admin', 'dispatcher') and (p_executor is null or o.assigned_to = p_executor))
        or (urole = 'worker' and o.assigned_to = uid)
      )
  )
  select
    coalesce(status, 'ALL') as bucket,
    count(*)::bigint as orders_count,
    sum(price) as total_price,
    0::numeric as total_fuel_cost,
    sum(price) as net_income
  from base
  group by rollup(status)
  order by case when status is null then 1 else 0 end, status;
end;
$function$;

create or replace function public.edit_order_admin(p_id uuid, p jsonb)
returns public.orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _allowed boolean;
  _row public.orders;
begin
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'dispatcher')
  ) into _allowed;

  if not _allowed then
    raise exception 'forbidden';
  end if;

  update public.orders o
  set
    title = coalesce(p->>'title', o.title),
    comment = coalesce(p->>'comment', o.comment),
    region = coalesce(p->>'region', o.region),
    city = coalesce(p->>'city', o.city),
    street = coalesce(p->>'street', o.street),
    house = coalesce(p->>'house', o.house),
    fio = coalesce(p->>'fio', o.fio),
    phone = coalesce(p->>'phone', o.phone),
    assigned_to = coalesce((p->>'assigned_to')::uuid, o.assigned_to),
    datetime = coalesce((p->>'datetime')::timestamptz, o.datetime),
    status = coalesce(p->>'status', o.status),
    urgent = coalesce((p->>'urgent')::boolean, o.urgent),
    price = coalesce((p->>'price')::numeric, o.price)
  where o.id = p_id
  returning * into _row;

  if not found then
    raise exception 'not_found';
  end if;

  return _row;
end;
$function$;

create or replace function public.company_set_currency(
  p_company_id uuid,
  p_currency text,
  p_recalc_existing boolean default false,
  p_currency_rate numeric default null
)
returns void
language plpgsql
security definer
as $function$
declare
  v_job_id uuid;
begin
  if not (public.is_admin() and p_company_id = public.user_company_id()) then
    raise exception 'Only company admin may change currency';
  end if;

  update public.companies
  set
    currency = p_currency,
    currency_rate = coalesce(p_currency_rate, currency_rate),
    currency_rate_updated_at = case when p_currency_rate is not null then now() else currency_rate_updated_at end
  where id = p_company_id;

  update public.orders
  set currency = p_currency
  where company_id = p_company_id;

  if p_recalc_existing then
    insert into public.finance_currency_recalc_jobs (company_id, requested_by, requested_at, status, rate)
    values (p_company_id, auth.uid()::uuid, now(), 'pending', p_currency_rate)
    returning id into v_job_id;

    update public.companies
    set recalc_in_progress = true,
        recalc_job_id = v_job_id
    where id = p_company_id;

    perform pg_notify('finance_currency_recalc_jobs', v_job_id::text);
  end if;
end;
$function$;

create or replace function public.company_set_currency(
  p_company_id uuid,
  p_new_currency text,
  p_rate numeric,
  p_recalc_existing boolean default true
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_use_work_types boolean;
  v_missing_worktype boolean;
begin
  if not is_admin() or user_company_id() is distinct from p_company_id then
    raise exception 'forbidden';
  end if;

  if p_new_currency not in ('RUB', 'USD', 'EUR') then
    raise exception 'Unsupported currency: %', p_new_currency;
  end if;

  if p_recalc_existing and (p_rate is null or p_rate <= 0) then
    raise exception 'Rate must be > 0 for recalculation';
  end if;

  update public.companies
  set recalc_in_progress = true
  where id = p_company_id;

  perform set_config('app.currency_recalc', '1', true);

  select use_work_types into v_use_work_types
  from public.companies
  where id = p_company_id;

  if p_recalc_existing then
    if v_use_work_types then
      select exists(
        select 1 from public.orders o
        where o.company_id = p_company_id and o.work_type_id is null
        limit 1
      ) into v_missing_worktype;

      if v_missing_worktype then
        raise exception 'Cannot recalc: work_type_id is required for some orders (company.use_work_types = true). Assign work types first.';
      end if;
    end if;

    update public.orders o
    set
      price = case when o.price is null then null else round(o.price * p_rate, 2) end,
      total_amount = case when o.total_amount is null then null else round(o.total_amount * p_rate, 2) end,
      discount = case when o.discount is null then null else round(o.discount * p_rate, 2) end,
      currency = p_new_currency
    where o.company_id = p_company_id;
  end if;

  update public.companies
  set
    currency = p_new_currency,
    currency_rate = case when p_recalc_existing then p_rate else currency_rate end,
    currency_rate_updated_at = case when p_recalc_existing then now() else currency_rate_updated_at end,
    recalc_in_progress = false
  where id = p_company_id;

exception when others then
  update public.companies
  set recalc_in_progress = false
  where id = p_company_id;
  raise;
end
$function$;

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
         time_window_start = case when p_patch ? 'time_window_start' then nullif(p_patch->>'time_window_start', '')::timestamptz else o.time_window_start end,
         time_window_end = case when p_patch ? 'time_window_end' then nullif(p_patch->>'time_window_end', '')::timestamptz else o.time_window_end end,
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

create or replace function public.recalculate_order_finance_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_entry record;
  v_base_price numeric := 0;
  v_income numeric := 0;
  v_discount numeric := 0;
  v_expense numeric := 0;
  v_amount numeric := 0;
  v_gross_before_discount numeric := 0;
  v_gross_after_discount numeric := 0;
  v_net_before_expense numeric := 0;
begin
  perform set_config('app.finance_recalc_in_progress', '1', true);

  select *
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    perform set_config('app.finance_recalc_in_progress', '0', true);
    return;
  end if;

  perform public.apply_order_finance_rules(v_order.id);

  v_base_price := coalesce(v_order.price, 0);

  for v_entry in
    select e.*
      from public.order_finance_entries e
     where e.order_id = v_order.id
     order by e.sort_order asc, e.created_at asc, e.id asc
  loop
    v_gross_before_discount := v_base_price + v_income;
    v_gross_after_discount := v_gross_before_discount - v_discount;
    v_net_before_expense := v_gross_after_discount - v_expense;

    v_amount := public.finance_compute_amount(
      v_entry.calc_mode,
      v_entry.input_amount,
      v_entry.input_percent,
      v_entry.percent_base,
      v_base_price,
      v_gross_before_discount,
      v_gross_after_discount,
      v_net_before_expense
    );

    update public.order_finance_entries
       set calculated_amount = v_amount,
           updated_at = now(),
           updated_by = auth.uid()
     where id = v_entry.id;

    if v_entry.kind = 'income' then
      v_income := v_income + v_amount;
    elsif v_entry.kind = 'discount' then
      v_discount := v_discount + v_amount;
    else
      v_expense := v_expense + v_amount;
    end if;
  end loop;

  v_gross_after_discount := (v_base_price + v_income - v_discount);

  update public.orders o
     set finance_income_total = round(v_income, 2),
         finance_discount_total = round(v_discount, 2),
         finance_expense_total = round(v_expense, 2),
         finance_gross_total = round(v_gross_after_discount, 2),
         finance_net_total = round(v_gross_after_discount - v_expense, 2),
         finance_calculated_at = now()
   where o.id = v_order.id;

  perform set_config('app.finance_recalc_in_progress', '0', true);
end;
$function$;

create or replace function public.trg_recalculate_order_finance_from_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.finance_recalc_in_progress', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.recalculate_order_finance_totals(new.id);
    return new;
  end if;

  if (
    coalesce(new.price, 0) is distinct from coalesce(old.price, 0)
    or coalesce(new.assigned_to::text, '') is distinct from coalesce(old.assigned_to::text, '')
    or coalesce(new.company_id::text, '') is distinct from coalesce(old.company_id::text, '')
  ) then
    perform public.recalculate_order_finance_totals(new.id);
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_orders_recalculate_finance on public.orders;

drop function if exists public.search_orders(text, uuid, text, text[], boolean, integer, integer);
drop function if exists public.fetch_orders_for_date(date);

drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;

create or replace view public.order_payouts as
select
  o.id as order_id,
  o.assigned_to,
  o.company_id,
  o.status,
  (o.time_window_start)::date as datetime,
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

alter table public.orders
  drop column if exists fuel_cost;

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
      regexp_replace(trim(both from concat_ws(' ', c.last_name, c.first_name, coalesce(c.middle_name, ''))), '\s+', ' ', 'g'),
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
  where date(t.time_window_start) = p_date
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
   order by coalesce(v.time_window_start, v.created_at) desc nulls last
   limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

grant select on public.orders_read_masked, public.orders_secure, public.orders_secure_v2, public.order_payouts
to authenticated, service_role;

create trigger trg_orders_recalculate_finance
after insert or update of price, assigned_to, company_id
on public.orders
for each row execute function public.trg_recalculate_order_finance_from_order();

comment on function public.company_set_currency(uuid, text, numeric, boolean)
is 'Set company currency and optionally recalc all orders price using provided rate. Updates orders.currency for all company orders.';

commit;
