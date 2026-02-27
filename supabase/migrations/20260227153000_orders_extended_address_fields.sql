-- Add extended address fields for orders and support optimistic-concurrency updates.
-- Safe for repeated execution.

alter table public.orders add column if not exists country text;
alter table public.orders add column if not exists postal_code text;
alter table public.orders add column if not exists building text;
alter table public.orders add column if not exists floor text;
alter table public.orders add column if not exists entrance text;
alter table public.orders add column if not exists apartment text;
alter table public.orders add column if not exists intercom text;
alter table public.orders add column if not exists secondary_phone text;
alter table public.orders add column if not exists contact_email text;
alter table public.orders add column if not exists contact_pref text;
alter table public.orders add column if not exists entrance_info text;
alter table public.orders add column if not exists parking_notes text;
alter table public.orders add column if not exists geo_lat text;
alter table public.orders add column if not exists geo_lng text;
alter table public.orders add column if not exists datetime text;
alter table public.orders add column if not exists tz text;

create or replace function public.update_order_if_version(
  p_order_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
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
  set
    title = case when p_patch ? 'title' then (p_patch->>'title') else o.title end,
    comment = case when p_patch ? 'comment' then (p_patch->>'comment') else o.comment end,
    region = case when p_patch ? 'region' then (p_patch->>'region') else o.region end,
    city = case when p_patch ? 'city' then (p_patch->>'city') else o.city end,
    street = case when p_patch ? 'street' then (p_patch->>'street') else o.street end,
    house = case when p_patch ? 'house' then (p_patch->>'house') else o.house end,
    country = case when p_patch ? 'country' then (p_patch->>'country') else o.country end,
    postal_code = case when p_patch ? 'postal_code' then (p_patch->>'postal_code') else o.postal_code end,
    building = case when p_patch ? 'building' then (p_patch->>'building') else o.building end,
    floor = case when p_patch ? 'floor' then (p_patch->>'floor') else o.floor end,
    entrance = case when p_patch ? 'entrance' then (p_patch->>'entrance') else o.entrance end,
    apartment = case when p_patch ? 'apartment' then (p_patch->>'apartment') else o.apartment end,
    intercom = case when p_patch ? 'intercom' then (p_patch->>'intercom') else o.intercom end,
    fio = case when p_patch ? 'fio' then (p_patch->>'fio') else o.fio end,
    phone = case when p_patch ? 'phone' then (p_patch->>'phone') else o.phone end,
    secondary_phone = case when p_patch ? 'secondary_phone' then nullif(p_patch->>'secondary_phone', '') else o.secondary_phone end,
    contact_email = case when p_patch ? 'contact_email' then nullif(p_patch->>'contact_email', '') else o.contact_email end,
    contact_pref = case
      when p_patch ? 'contact_pref' then nullif(p_patch->>'contact_pref', '')::public.contact_pref_enum
      else o.contact_pref
    end,
    entrance_info = case when p_patch ? 'entrance_info' then nullif(p_patch->>'entrance_info', '') else o.entrance_info end,
    parking_notes = case when p_patch ? 'parking_notes' then nullif(p_patch->>'parking_notes', '') else o.parking_notes end,
    geo_lat = case when p_patch ? 'geo_lat' then nullif(p_patch->>'geo_lat', '') else o.geo_lat end,
    geo_lng = case when p_patch ? 'geo_lng' then nullif(p_patch->>'geo_lng', '') else o.geo_lng end,
    datetime = case when p_patch ? 'datetime' then nullif(p_patch->>'datetime', '') else o.datetime end,
    tz = case when p_patch ? 'tz' then nullif(p_patch->>'tz', '') else o.tz end,
    assigned_to = case
      when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid
      else o.assigned_to
    end,
    time_window_start = case
      when p_patch ? 'time_window_start' then nullif(p_patch->>'time_window_start', '')::timestamptz
      else o.time_window_start
    end,
    status = case when p_patch ? 'status' then (p_patch->>'status') else o.status end,
    urgent = case
      when p_patch ? 'urgent' then coalesce((p_patch->>'urgent')::boolean, false)
      else o.urgent
    end,
    department_id = case
      when p_patch ? 'department_id' then nullif(p_patch->>'department_id', '')::uuid
      else o.department_id
    end,
    price = case
      when p_patch ? 'price' then nullif(p_patch->>'price', '')::numeric
      else o.price
    end,
    fuel_cost = case
      when p_patch ? 'fuel_cost' then nullif(p_patch->>'fuel_cost', '')::numeric
      else o.fuel_cost
    end,
    work_type_id = case
      when p_patch ? 'work_type_id' then nullif(p_patch->>'work_type_id', '')::uuid
      else o.work_type_id
    end,
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
    end
  where o.id::text = p_order_id
  returning o.*
  into v_updated;

  return v_updated;
end;
$$;

grant execute on function public.update_order_if_version(text, timestamptz, jsonb) to authenticated;
