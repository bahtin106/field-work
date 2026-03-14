CREATE OR REPLACE FUNCTION public.update_order_if_version(p_order_id text, p_expected_updated_at timestamp with time zone, p_patch jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         fuel_cost = case when p_patch ? 'fuel_cost' then nullif(p_patch->>'fuel_cost', '')::numeric else o.fuel_cost end,
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
$function$

