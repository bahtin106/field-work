begin;

drop function if exists public.search_orders(text, uuid, text, text[], boolean, integer, integer);
drop view if exists public.orders_secure_v2;
drop view if exists public.orders_secure;
drop view if exists public.orders_read_masked;

drop trigger if exists trg_client_objects_sync_audit on public.client_objects;
drop function if exists public.client_objects_sync_audit();
drop function if exists public.client_object_summary(text, text, text, text, text, text, text, text);

do $$
begin
  if to_regclass('public.client_addresses') is not null then
    execute 'drop trigger if exists trg_client_addresses_sync_audit on public.client_addresses';
    execute 'drop trigger if exists trg_client_addresses_sync_client_summary on public.client_addresses';
  end if;
end
$$;

drop function if exists public.client_addresses_sync_audit();
drop function if exists public.client_addresses_sync_client_summary();
drop function if exists public.client_address_summary(text, text, text, text, text, text, text, text);

drop function if exists public.update_order_if_version(text, timestamptz, jsonb);

alter table public.client_objects
  add column if not exists office text;

alter table public.orders
  add column if not exists office text;

do $$
begin
  if to_regclass('public.client_addresses') is not null then
    execute 'alter table public.client_addresses add column if not exists office text';
  end if;
end
$$;

update public.orders o
   set office = co.office
  from public.client_objects co
 where o.object_id = co.id
   and nullif(trim(coalesce(o.office, '')), '') is null
   and nullif(trim(coalesce(co.office, '')), '') is not null;

create or replace function public.client_object_summary(
  p_country text,
  p_region text,
  p_city text,
  p_street text,
  p_house text,
  p_office text,
  p_entrance text,
  p_apartment text
)
returns text
language sql
immutable
as $$
  select nullif(
    concat_ws(
      ', ',
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_street, '')), ''),
      nullif(btrim(coalesce(p_house, '')), ''),
      case
        when nullif(btrim(coalesce(p_office, '')), '') is null then null
        else 'оф. ' || btrim(p_office)
      end
    ),
    ''
  );
$$;

create or replace function public.client_objects_sync_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = new.client_id;

  if v_company_id is null then
    raise exception 'client % not found for object', new.client_id using errcode = '23503';
  end if;

  new.company_id := v_company_id;
  new.name := coalesce(nullif(btrim(coalesce(new.name, '')), ''), 'Объект');
  new.country := nullif(btrim(coalesce(new.country, '')), '');
  new.region := nullif(btrim(coalesce(new.region, '')), '');
  new.city := nullif(btrim(coalesce(new.city, '')), '');
  new.street := nullif(btrim(coalesce(new.street, '')), '');
  new.house := nullif(btrim(coalesce(new.house, '')), '');
  new.postal_code := nullif(btrim(coalesce(new.postal_code, '')), '');
  new.office := nullif(btrim(coalesce(new.office, '')), '');
  new.floor := nullif(btrim(coalesce(new.floor, '')), '');
  new.entrance := nullif(btrim(coalesce(new.entrance, '')), '');
  new.apartment := nullif(btrim(coalesce(new.apartment, '')), '');
  new.entrance_info := nullif(btrim(coalesce(new.entrance_info, '')), '');
  new.parking_notes := nullif(btrim(coalesce(new.parking_notes, '')), '');
  new.geo_lat := nullif(btrim(coalesce(new.geo_lat, '')), '');
  new.geo_lng := nullif(btrim(coalesce(new.geo_lng, '')), '');
  new.summary := public.client_object_summary(
    new.country,
    new.region,
    new.city,
    new.street,
    new.house,
    new.office,
    new.entrance,
    new.apartment
  );

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);

  return new;
end;
$$;

create trigger trg_client_objects_sync_audit
before insert or update on public.client_objects
for each row execute function public.client_objects_sync_audit();

do $$
begin
  if to_regclass('public.client_addresses') is not null then
    execute $sql$
      create or replace function public.client_address_summary(
        p_country text,
        p_region text,
        p_city text,
        p_street text,
        p_house text,
        p_office text,
        p_entrance text,
        p_apartment text
      )
      returns text
      language sql
      immutable
      as $fn$
        select nullif(
          concat_ws(
            ', ',
            nullif(btrim(coalesce(p_city, '')), ''),
            nullif(btrim(coalesce(p_street, '')), ''),
            nullif(btrim(coalesce(p_house, '')), ''),
            case
              when nullif(btrim(coalesce(p_office, '')), '') is null then null
              else 'оф. ' || btrim(p_office)
            end
          ),
          ''
        );
      $fn$;
    $sql$;

    execute $sql$
      create or replace function public.client_addresses_sync_audit()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      declare
        v_company_id uuid;
      begin
        select c.company_id into v_company_id
          from public.clients c
         where c.id = new.client_id;

        if v_company_id is null then
          raise exception 'client % not found for address', new.client_id using errcode = '23503';
        end if;

        new.company_id := v_company_id;
        new.label := coalesce(nullif(btrim(coalesce(new.label, '')), ''), 'Основной адрес');
        new.country := nullif(btrim(coalesce(new.country, '')), '');
        new.region := nullif(btrim(coalesce(new.region, '')), '');
        new.city := nullif(btrim(coalesce(new.city, '')), '');
        new.street := nullif(btrim(coalesce(new.street, '')), '');
        new.house := nullif(btrim(coalesce(new.house, '')), '');
        new.postal_code := nullif(btrim(coalesce(new.postal_code, '')), '');
        new.office := nullif(btrim(coalesce(new.office, '')), '');
        new.floor := nullif(btrim(coalesce(new.floor, '')), '');
        new.entrance := nullif(btrim(coalesce(new.entrance, '')), '');
        new.apartment := nullif(btrim(coalesce(new.apartment, '')), '');
        new.entrance_info := nullif(btrim(coalesce(new.entrance_info, '')), '');
        new.parking_notes := nullif(btrim(coalesce(new.parking_notes, '')), '');
        new.geo_lat := nullif(btrim(coalesce(new.geo_lat, '')), '');
        new.geo_lng := nullif(btrim(coalesce(new.geo_lng, '')), '');

        if tg_op = 'INSERT' then
          new.created_at := coalesce(new.created_at, now());
          new.created_by := coalesce(new.created_by, auth.uid());
        end if;

        new.updated_at := now();
        new.updated_by := coalesce(auth.uid(), new.updated_by);

        return new;
      end;
      $fn$;
    $sql$;

    execute $sql$
      create or replace function public.client_addresses_sync_client_summary()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      declare
        v_client_id uuid := coalesce(new.client_id, old.client_id);
        v_summary text;
      begin
        select public.client_address_summary(
                 a.country,
                 a.region,
                 a.city,
                 a.street,
                 a.house,
                 a.office,
                 a.entrance,
                 a.apartment
               )
          into v_summary
          from public.client_addresses a
         where a.client_id = v_client_id
         order by a.is_primary desc, a.created_at asc
         limit 1;

        update public.clients c
           set object_address = v_summary,
               updated_at = now(),
               updated_by = auth.uid()
         where c.id = v_client_id;

        return coalesce(new, old);
      end;
      $fn$;
    $sql$;

    execute 'create trigger trg_client_addresses_sync_audit before insert or update on public.client_addresses for each row execute function public.client_addresses_sync_audit()';
    execute 'create trigger trg_client_addresses_sync_client_summary after insert or update or delete on public.client_addresses for each row execute function public.client_addresses_sync_client_summary()';
  end if;
end
$$;

alter table public.client_objects
  drop column if exists building,
  drop column if exists intercom;

alter table public.orders
  drop column if exists building,
  drop column if exists intercom;

do $$
begin
  if to_regclass('public.client_addresses') is not null then
    execute 'alter table public.client_addresses drop column if exists building, drop column if exists intercom';
  end if;
end
$$;

update public.client_objects
   set summary = public.client_object_summary(
     country,
     region,
     city,
     street,
     house,
     office,
     entrance,
     apartment
   );

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
$$;

grant execute on function public.update_order_if_version(text, timestamptz, jsonb) to authenticated;

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
  c.phone as customer_phone_visible,
  c.additional_phone_1 as secondary_phone_search,
  public.mask_order_phone_ru(c.phone) as customer_phone_masked
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
       or to_jsonb(v)::text ilike '%' || trim(p_query) || '%'
     )
   order by coalesce(v.time_window_start, v.created_at) desc nulls last
   limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.search_orders(text, uuid, text, text[], boolean, integer, integer)
  to authenticated;

commit;
