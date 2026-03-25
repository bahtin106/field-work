-- Orders table cleanup: rename columns, drop unused, fix defaults.
-- Renames: contract_file→media_file_1, photo_before→media_file_2,
--          photo_after→media_file_3, act_file→media_file_4, price→start_price
-- Drops: total_amount, tax_rate, crew_id, customer_company
-- Fixes: payment_status DEFAULT 'unpaid', backfill NULLs
-- Adds: creation_source text column

begin;

-- 0. Drop trigger BEFORE renaming columns (old trigger references 'price')
drop trigger if exists trg_orders_recalculate_finance on public.orders;

-- 1. Drop dependent views and functions first
drop function if exists public.search_orders(text, uuid, text, text[], boolean, integer, integer);
drop function if exists public.fetch_orders_for_date(date);
drop materialized view if exists public.mv_orders_daily_counts;
drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;
drop view if exists public.order_payouts;

-- 2. Rename columns
alter table public.orders rename column contract_file to media_file_1;
alter table public.orders rename column photo_before  to media_file_2;
alter table public.orders rename column photo_after   to media_file_3;
alter table public.orders rename column act_file      to media_file_4;
alter table public.orders rename column price         to start_price;

-- 3. Drop unused columns
alter table public.orders drop column if exists total_amount;
alter table public.orders drop column if exists tax_rate;
alter table public.orders drop column if exists crew_id;
alter table public.orders drop column if exists customer_company;

-- 4. Fix payment_status: set default and backfill
alter table public.orders alter column payment_status set default 'unpaid';
update public.orders set payment_status = 'unpaid' where payment_status is null or btrim(payment_status) = '';

-- 5. Add creation_source column
alter table public.orders add column if not exists creation_source text;
comment on column public.orders.creation_source is 'How the order was created: app, telegram, api, etc.';

-- 6. Temporarily drop FK constraint, update both tables, then restore FK
alter table public.company_entity_field_settings
  drop constraint if exists company_entity_field_settings_entity_type_field_key_fkey;

-- Update child table first
update public.company_entity_field_settings set field_key = 'media_file_1' where entity_type = 'order' and field_key = 'contract_file';
update public.company_entity_field_settings set field_key = 'media_file_2' where entity_type = 'order' and field_key = 'photo_before';
update public.company_entity_field_settings set field_key = 'media_file_3' where entity_type = 'order' and field_key = 'photo_after';
update public.company_entity_field_settings set field_key = 'media_file_4' where entity_type = 'order' and field_key = 'act_file';
update public.company_entity_field_settings set field_key = 'start_price'  where entity_type = 'order' and field_key = 'price';
delete from public.company_entity_field_settings where entity_type = 'order' and field_key in ('total_amount', 'tax_rate', 'crew_id', 'customer_company');

-- Update parent table
update public.entity_field_catalog set field_key = 'media_file_1' where entity_type = 'order' and field_key = 'contract_file';
update public.entity_field_catalog set field_key = 'media_file_2' where entity_type = 'order' and field_key = 'photo_before';
update public.entity_field_catalog set field_key = 'media_file_3' where entity_type = 'order' and field_key = 'photo_after';
update public.entity_field_catalog set field_key = 'media_file_4' where entity_type = 'order' and field_key = 'act_file';
update public.entity_field_catalog set field_key = 'start_price'  where entity_type = 'order' and field_key = 'price';
delete from public.entity_field_catalog where entity_type = 'order' and field_key in ('total_amount', 'tax_rate', 'crew_id', 'customer_company');

-- Restore FK constraint
alter table public.company_entity_field_settings
  add constraint company_entity_field_settings_entity_type_field_key_fkey
  foreign key (entity_type, field_key)
  references public.entity_field_catalog (entity_type, field_key)
  on update cascade on delete cascade;

-- 7. Also update order_media_external_map category values
update public.order_media_external_map set category = 'media_file_1' where category = 'contract_file';
update public.order_media_external_map set category = 'media_file_2' where category = 'photo_before';
update public.order_media_external_map set category = 'media_file_3' where category = 'photo_after';
update public.order_media_external_map set category = 'media_file_4' where category = 'act_file';

-- 8. Recreate order_payouts view
create or replace view public.order_payouts as
select
  o.id as order_id,
  o.assigned_to,
  o.company_id,
  o.status,
  o.time_window_start as datetime,
  o.start_price,
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

-- 9. Recreate orders_read_masked view (without dropped columns)
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
  o.discount,
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

-- 10. Recreate orders_secure view
create view public.orders_secure as
select
  orders_read_masked.id,
  orders_read_masked.created_at,
  orders_read_masked.comment,
  orders_read_masked.status,
  orders_read_masked.media_file_1,
  orders_read_masked.media_file_2,
  orders_read_masked.media_file_3,
  orders_read_masked.media_file_4,
  orders_read_masked.media_file_5,
  orders_read_masked.assigned_to,
  orders_read_masked.title,
  orders_read_masked.urgent,
  orders_read_masked.start_price,
  orders_read_masked.company_id,
  orders_read_masked.department_id,
  orders_read_masked.time_window_start,
  orders_read_masked.time_window_end,
  orders_read_masked.duration_min,
  orders_read_masked.arrival_at,
  orders_read_masked.departure_at,
  orders_read_masked.tags,
  orders_read_masked.discount,
  orders_read_masked.payment_status,
  orders_read_masked.updated_at,
  orders_read_masked.completed_at,
  orders_read_masked.work_type_id,
  orders_read_masked.currency,
  orders_read_masked.created_by_user_id,
  orders_read_masked.creation_source,
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

-- 11. Recreate orders_secure_v2 view
create view public.orders_secure_v2 as
select
  orders_read_masked.id,
  orders_read_masked.created_at,
  orders_read_masked.comment,
  orders_read_masked.status,
  orders_read_masked.media_file_1,
  orders_read_masked.media_file_2,
  orders_read_masked.media_file_3,
  orders_read_masked.media_file_4,
  orders_read_masked.media_file_5,
  orders_read_masked.assigned_to,
  orders_read_masked.title,
  orders_read_masked.urgent,
  orders_read_masked.start_price,
  orders_read_masked.company_id,
  orders_read_masked.department_id,
  orders_read_masked.time_window_start,
  orders_read_masked.time_window_end,
  orders_read_masked.duration_min,
  orders_read_masked.arrival_at,
  orders_read_masked.departure_at,
  orders_read_masked.tags,
  orders_read_masked.discount,
  orders_read_masked.payment_status,
  orders_read_masked.updated_at,
  orders_read_masked.completed_at,
  orders_read_masked.work_type_id,
  orders_read_masked.currency,
  orders_read_masked.created_by_user_id,
  orders_read_masked.creation_source,
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

-- 12. Recreate fetch_orders_for_date
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

-- 13. Recreate search_orders
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

-- 14. Recreate update_order_if_version with renamed columns
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
         office = case when p_patch ? 'office' then nullif(p_patch->>'office', '') else o.office end,
         floor = case when p_patch ? 'floor' then nullif(p_patch->>'floor', '') else o.floor end,
         entrance = case when p_patch ? 'entrance' then nullif(p_patch->>'entrance', '') else o.entrance end,
         apartment = case when p_patch ? 'apartment' then nullif(p_patch->>'apartment', '') else o.apartment end,
         media_file_1 = case
           when p_patch ? 'media_file_1' then
             case
               when p_patch->'media_file_1' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'media_file_1'))
             end
           else o.media_file_1
         end,
         media_file_2 = case
           when p_patch ? 'media_file_2' then
             case
               when p_patch->'media_file_2' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'media_file_2'))
             end
           else o.media_file_2
         end,
         media_file_3 = case
           when p_patch ? 'media_file_3' then
             case
               when p_patch->'media_file_3' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'media_file_3'))
             end
           else o.media_file_3
         end,
         media_file_4 = case
           when p_patch ? 'media_file_4' then
             case
               when p_patch->'media_file_4' = 'null'::jsonb then null
               else array(select jsonb_array_elements_text(p_patch->'media_file_4'))
             end
           else o.media_file_4
         end,
         updated_at = now(),
         updated_by = auth.uid()
   where o.id = v_current.id
   returning * into v_updated;

  return v_updated;
end;
$function$;

-- 15. Recreate calc_order_payout with renamed column
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
  select o.company_id, o.assigned_to, coalesce(o.start_price, 0)
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

-- 16. Recreate recalculate_order_finance_totals with renamed column
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
  v_base_for_calc numeric := 0;
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

  v_base_price := coalesce(v_order.start_price, 0);

  for v_entry in
    select e.*
      from public.order_finance_entries e
     where e.order_id = v_order.id
     order by e.sort_order asc, e.created_at asc, e.id asc
  loop
    v_gross_before_discount := v_base_price + v_income;
    v_gross_after_discount := v_gross_before_discount - v_discount;
    v_net_before_expense := v_gross_after_discount - v_expense;

    case lower(coalesce(v_entry.percent_base, 'base_price'))
      when 'base_price' then v_base_for_calc := coalesce(v_base_price, 0);
      when 'gross_before_discount' then v_base_for_calc := coalesce(v_gross_before_discount, 0);
      when 'gross_after_discount' then v_base_for_calc := coalesce(v_gross_after_discount, 0);
      when 'income_total' then v_base_for_calc := coalesce(v_income, 0);
      else v_base_for_calc := coalesce(v_base_price, 0);
    end case;

    if lower(coalesce(v_entry.calc_mode, 'fixed')) = 'fixed' then
      v_amount := round(coalesce(v_entry.input_amount, 0), 2);
      if lower(coalesce(v_entry.kind, 'expense')) = 'expense' then
        v_amount := least(v_amount, greatest(v_base_for_calc, 0));
      end if;
    else
      v_amount := round((greatest(v_base_for_calc, 0) * coalesce(v_entry.input_percent, 0) / 100.0)::numeric, 2);
    end if;

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
exception when others then
  perform set_config('app.finance_recalc_in_progress', '0', true);
  raise;
end;
$function$;

-- 17. Recreate finance_rule_conditions_match with renamed column
create or replace function public.finance_rule_conditions_match(
  p_conditions jsonb,
  p_order public.orders
)
returns boolean
language plpgsql
stable
as $$
declare
  v_root jsonb := coalesce(p_conditions, '{"op":"all","conditions":[]}'::jsonb);
  v_item jsonb;
  v_fact text;
  v_operator text;
  v_value jsonb;
  v_actual text;
  v_expected text;
  v_actual_num numeric;
  v_expected_num numeric;
  v_base_price numeric;
  v_income_total numeric;
  v_discount_total numeric;
  v_gross_before_discount numeric;
  v_gross_after_discount numeric;
begin
  if not public.finance_validate_rule_conditions(v_root) then
    return false;
  end if;

  v_base_price := coalesce(p_order.start_price, 0);
  v_income_total := coalesce(p_order.finance_income_total, 0);
  v_discount_total := coalesce(p_order.finance_discount_total, 0);
  v_gross_before_discount := v_base_price + v_income_total;
  v_gross_after_discount := v_gross_before_discount - v_discount_total;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_root->'conditions', '[]'::jsonb))
  loop
    v_fact := lower(coalesce(v_item->>'fact', ''));
    v_operator := lower(coalesce(v_item->>'operator', ''));
    v_value := v_item->'value';

    if v_fact = 'payment_method' then
      v_actual := lower(coalesce(p_order.payment_method, 'cash'));
      v_expected := lower(coalesce(v_value #>> '{}', ''));
      if v_operator <> 'eq' then
        return false;
      end if;
      if v_expected = 'any' then
        continue;
      end if;
      if v_actual <> v_expected then
        return false;
      end if;
    elsif v_fact = 'payment_status' then
      v_actual := lower(coalesce(p_order.payment_status, 'unpaid'));
      v_expected := lower(coalesce(v_value #>> '{}', ''));
      if v_operator <> 'eq' then
        return false;
      end if;
      if v_expected = 'any' then
        continue;
      end if;
      if v_actual <> v_expected then
        return false;
      end if;
    else
      if v_fact = 'base_price' or v_fact = 'price' or v_fact = 'start_price' then
        v_actual_num := v_base_price;
      elsif v_fact = 'gross_before_discount' then
        v_actual_num := v_gross_before_discount;
      elsif v_fact = 'gross_after_discount' then
        v_actual_num := v_gross_after_discount;
      elsif v_fact = 'income_total' then
        v_actual_num := v_income_total;
      else
        return false;
      end if;

      v_expected_num := (v_value #>> '{}')::numeric;
      if v_operator = 'eq' and v_actual_num <> v_expected_num then
        return false;
      elsif v_operator = 'gte' and v_actual_num < v_expected_num then
        return false;
      elsif v_operator = 'lte' and v_actual_num > v_expected_num then
        return false;
      elsif v_operator not in ('eq', 'gte', 'lte') then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

-- 18. Recreate apply_order_finance_rules with renamed column
create or replace function public.apply_order_finance_rules(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_rule public.company_finance_rules%rowtype;
  v_recipient uuid;
  v_conditions jsonb;
  v_matched boolean;
  v_enabled_rule_ids uuid[] := '{}'::uuid[];
  v_matched_rule_ids uuid[] := '{}'::uuid[];
begin
  select *
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    return;
  end if;

  select coalesce(array_agg(r.id), '{}'::uuid[])
    into v_enabled_rule_ids
   from public.company_finance_rules r
   where r.company_id = v_order.company_id
     and r.is_enabled = true
     and (
       r.apply_to_existing = true
       or coalesce(r.updated_at, r.created_at) <= v_order.created_at
     );

  for v_rule in
    select *
     from public.company_finance_rules r
     where r.company_id = v_order.company_id
       and r.is_enabled = true
       and (
         r.apply_to_existing = true
         or coalesce(r.updated_at, r.created_at) <= v_order.created_at
       )
     order by r.sort_order asc, r.created_at asc
  loop
    v_conditions := coalesce(v_rule.conditions_json, '{"op":"all","conditions":[]}'::jsonb);
    v_matched := public.finance_rule_conditions_match(v_conditions, v_order);

    if not v_matched then
      continue;
    end if;

    v_matched_rule_ids := array_append(v_matched_rule_ids, v_rule.id);

    v_recipient := case
      when v_rule.recipient_mode = 'assigned_to' then v_order.assigned_to
      when v_rule.recipient_mode = 'manual_user' then v_rule.recipient_user_id
      else null
    end;

    insert into public.order_finance_entries (
      company_id,
      order_id,
      rule_id,
      kind,
      title,
      note,
      calc_mode,
      input_amount,
      input_percent,
      percent_base,
      expense_payer,
      recipient_user_id,
      requires_note,
      note_visible,
      visibility_scope,
      is_system,
      sort_order,
      rule_match_snapshot,
      created_by,
      updated_by
    ) values (
      v_order.company_id,
      v_order.id,
      v_rule.id,
      v_rule.kind,
      v_rule.name,
      nullif(btrim(coalesce(v_rule.note_template, '')), ''),
      v_rule.calc_mode,
      coalesce(v_rule.fixed_amount, 0),
      coalesce(v_rule.percent_value, 0),
      v_rule.percent_base,
      case
        when v_rule.kind = 'expense' then coalesce(v_rule.expense_payer, 'company')
        else 'company'
      end,
      v_recipient,
      v_rule.requires_note,
      v_rule.note_visible,
      case when v_rule.recipient_mode in ('assigned_to', 'manual_user') then 'own_only' else 'all' end,
      true,
      v_rule.sort_order,
      jsonb_build_object(
        'matched_at', now(),
        'conditions', v_conditions,
        'order_snapshot', jsonb_build_object(
          'payment_method', v_order.payment_method,
          'payment_status', v_order.payment_status,
          'base_price', coalesce(v_order.start_price, 0),
          'gross_before_discount', coalesce(v_order.start_price, 0) + coalesce(v_order.finance_income_total, 0),
          'gross_after_discount', coalesce(v_order.finance_gross_total, coalesce(v_order.start_price, 0) + coalesce(v_order.finance_income_total, 0) - coalesce(v_order.finance_discount_total, 0)),
          'income_total', coalesce(v_order.finance_income_total, 0)
        )
      ),
      auth.uid(),
      auth.uid()
    )
    on conflict (order_id, rule_id)
    do update set
      kind = excluded.kind,
      title = excluded.title,
      note = excluded.note,
      calc_mode = excluded.calc_mode,
      input_amount = excluded.input_amount,
      input_percent = excluded.input_percent,
      percent_base = excluded.percent_base,
      expense_payer = excluded.expense_payer,
      recipient_user_id = excluded.recipient_user_id,
      requires_note = excluded.requires_note,
      note_visible = excluded.note_visible,
      visibility_scope = excluded.visibility_scope,
      sort_order = excluded.sort_order,
      rule_match_snapshot = excluded.rule_match_snapshot,
      updated_at = now(),
      updated_by = auth.uid();
  end loop;

  if coalesce(array_length(v_enabled_rule_ids, 1), 0) > 0 then
    delete from public.order_finance_entries e
     where e.order_id = v_order.id
       and e.is_system = true
       and e.rule_id = any(v_enabled_rule_ids)
       and (
         coalesce(array_length(v_matched_rule_ids, 1), 0) = 0
         or not (e.rule_id = any(v_matched_rule_ids))
       );
  end if;
end;
$$;

-- 19. Grant privileges
grant select on public.orders_read_masked, public.orders_secure, public.orders_secure_v2, public.order_payouts
to authenticated, service_role;

-- 20. Restore mv_orders_daily_counts
create materialized view public.mv_orders_daily_counts as
select
  o.company_id,
  coalesce(o.time_window_start::date, o.created_at::date) as day,
  o.status,
  count(*) as cnt
from public.orders o
where o.company_id is not null
group by o.company_id, coalesce(o.time_window_start::date, o.created_at::date), o.status;

create unique index if not exists mv_orders_daily_counts_uniq
  on public.mv_orders_daily_counts (company_id, day, status);

-- 21. Recreate trigger function to use start_price instead of price
create or replace function public.trg_recalculate_order_finance_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.finance_recalc_in_progress', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.recalculate_order_finance_totals(new.id);
    return new;
  end if;

  if (
    coalesce(new.start_price, 0) is distinct from coalesce(old.start_price, 0)
    or coalesce(new.assigned_to::text, '') is distinct from coalesce(old.assigned_to::text, '')
    or coalesce(new.company_id::text, '') is distinct from coalesce(old.company_id::text, '')
    or coalesce(new.payment_method, '') is distinct from coalesce(old.payment_method, '')
    or coalesce(new.payment_status, '') is distinct from coalesce(old.payment_status, '')
  ) then
    perform public.recalculate_order_finance_totals(new.id);
  end if;

  return new;
end;
$$;

-- 22. Recreate trigger to monitor start_price instead of price
drop trigger if exists trg_orders_recalculate_finance on public.orders;
create trigger trg_orders_recalculate_finance
after insert or update of start_price, assigned_to, company_id, payment_method, payment_status
on public.orders
for each row execute function public.trg_recalculate_order_finance_from_order();

commit;
