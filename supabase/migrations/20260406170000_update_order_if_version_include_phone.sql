begin;

alter table public.orders
  add column if not exists phone text;

create or replace function public.update_order_if_version(
  p_order_id text,
  p_expected_updated_at timestamp with time zone,
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
  select * into v_current
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
    title = case when p_patch ? 'title' then nullif(p_patch->>'title', '') else o.title end,
    comment = case
      when p_patch ? 'comment' then
        case
          when nullif(p_patch->>'comment', '') is null
               and o.creation_source = 'telegram'
               and nullif(btrim(coalesce(o.comment, '')), '') is not null
            then o.comment
          else nullif(p_patch->>'comment', '')
        end
      else o.comment
    end,
    phone = case when p_patch ? 'phone' then nullif(p_patch->>'phone', '') else o.phone end,
    entrance_info = case when p_patch ? 'entrance_info' then nullif(p_patch->>'entrance_info', '') else o.entrance_info end,
    parking_notes = case when p_patch ? 'parking_notes' then nullif(p_patch->>'parking_notes', '') else o.parking_notes end,
    geo_lat = case when p_patch ? 'geo_lat' then nullif(p_patch->>'geo_lat', '') else o.geo_lat end,
    geo_lng = case when p_patch ? 'geo_lng' then nullif(p_patch->>'geo_lng', '') else o.geo_lng end,
    address_mode = case when p_patch ? 'address_mode' then coalesce(nullif(p_patch->>'address_mode', ''), 'object') else o.address_mode end,
    assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid else o.assigned_to end,
    client_id = case when p_patch ? 'client_id' then nullif(p_patch->>'client_id', '')::uuid else o.client_id end,
    object_id = case when p_patch ? 'object_id' then nullif(p_patch->>'object_id', '')::uuid else o.object_id end,
    time_window_start = case when p_patch ? 'time_window_start' then nullif(p_patch->>'time_window_start', '')::date else o.time_window_start end,
    time_window_end = case when p_patch ? 'time_window_end' then nullif(p_patch->>'time_window_end', '')::date else o.time_window_end end,
    departure_time = case when p_patch ? 'departure_time' then nullif(p_patch->>'departure_time', '')::time else o.departure_time end,
    status = case when p_patch ? 'status' then nullif(p_patch->>'status', '') else o.status end,
    urgent = case when p_patch ? 'urgent' then coalesce((p_patch->>'urgent')::boolean, false) else o.urgent end,
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
    floor = case when p_patch ? 'floor' then nullif(p_patch->>'floor', '') else o.floor end,
    entrance = case when p_patch ? 'entrance' then nullif(p_patch->>'entrance', '') else o.entrance end,
    apartment = case when p_patch ? 'apartment' then nullif(p_patch->>'apartment', '') else o.apartment end,
    media_file_1 = case
      when p_patch ? 'media_file_1' then
        case
          when jsonb_typeof(p_patch->'media_file_1') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_1')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_1
    end,
    media_file_2 = case
      when p_patch ? 'media_file_2' then
        case
          when jsonb_typeof(p_patch->'media_file_2') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_2')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_2
    end,
    media_file_3 = case
      when p_patch ? 'media_file_3' then
        case
          when jsonb_typeof(p_patch->'media_file_3') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_3')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_3
    end,
    media_file_4 = case
      when p_patch ? 'media_file_4' then
        case
          when jsonb_typeof(p_patch->'media_file_4') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_4')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_4
    end,
    media_file_5 = case
      when p_patch ? 'media_file_5' then
        case
          when jsonb_typeof(p_patch->'media_file_5') = 'array' then coalesce(array(select jsonb_array_elements_text(p_patch->'media_file_5')), '{}'::text[])
          else '{}'::text[]
        end
      else o.media_file_5
    end,
    payment_method = case when p_patch ? 'payment_method' then nullif(p_patch->>'payment_method', '') else o.payment_method end,
    currency = case when p_patch ? 'currency' then nullif(p_patch->>'currency', '') else o.currency end,
    updated_at = now()
  where o.id::text = p_order_id
  returning * into v_updated;

  return v_updated;
end
$$;

commit;
