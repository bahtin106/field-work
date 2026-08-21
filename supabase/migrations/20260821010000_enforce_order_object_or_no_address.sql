-- An order has exactly one of two object states:
--   1. object_id points to an active object belonging to the same company/client;
--   2. object_id is null and the order is explicitly stored as "No address".
--
-- Object deletion and stale concurrent order edits use the same advisory lock,
-- so a deleted object cannot be reattached after its linked orders are detached.

create or replace function public.enforce_order_object_or_no_address()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_object public.client_objects%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.company_id is not distinct from old.company_id
       and new.client_id is not distinct from old.client_id
       and new.object_id is not distinct from old.object_id
       and new.address_mode is not distinct from old.address_mode
       and new.country is not distinct from old.country
       and new.region is not distinct from old.region
       and new.district is not distinct from old.district
       and new.city is not distinct from old.city
       and new.street is not distinct from old.street
       and new.house is not distinct from old.house
       and new.postal_code is not distinct from old.postal_code
       and new.floor is not distinct from old.floor
       and new.entrance is not distinct from old.entrance
       and new.apartment is not distinct from old.apartment
       and new.entrance_info is not distinct from old.entrance_info
       and new.parking_notes is not distinct from old.parking_notes
       and new.geo_lat is not distinct from old.geo_lat
       and new.geo_lng is not distinct from old.geo_lng then
      return new;
    end if;
  end if;

  if new.object_id is null then
    new.address_mode := 'custom';
    new.country := null;
    new.region := null;
    new.district := null;
    new.city := null;
    new.street := null;
    new.house := null;
    new.postal_code := null;
    new.floor := null;
    new.entrance := null;
    new.apartment := null;
    new.entrance_info := null;
    new.parking_notes := null;
    new.geo_lat := null;
    new.geo_lng := null;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('order-object:' || new.object_id::text, 0)
  );

  select object_row.*
    into v_object
  from public.client_objects object_row
  where object_row.id = new.object_id
    and object_row.company_id = new.company_id
    and object_row.client_id = new.client_id
    and not exists (
      select 1
      from public.trash_entries trash
      where trash.company_id = new.company_id
        and trash.entity_type = 'client_object'
        and trash.entity_id = object_row.id
    )
  for key share;

  if not found then
    raise exception 'order_object_not_available'
      using errcode = '55000';
  end if;

  new.address_mode := 'object';
  new.country := v_object.country;
  new.region := v_object.region;
  new.district := v_object.district;
  new.city := v_object.city;
  new.street := v_object.street;
  new.house := v_object.house;
  new.postal_code := v_object.postal_code;
  new.floor := v_object.floor;
  new.entrance := v_object.entrance;
  new.apartment := v_object.apartment;
  new.entrance_info := v_object.comment;
  new.parking_notes := null;
  new.geo_lat := v_object.geo_lat;
  new.geo_lng := v_object.geo_lng;
  return new;
end;
$$;

revoke all on function public.enforce_order_object_or_no_address()
  from public, anon, authenticated;

drop trigger if exists orders_enforce_object_or_no_address on public.orders;
create trigger orders_enforce_object_or_no_address
before insert or update on public.orders
for each row execute function public.enforce_order_object_or_no_address();

-- Trashed orders remain as protected rows until purge. Allow only the exact
-- relation cleanup performed by the object-delete trigger; every other edit of
-- a trashed order stays blocked.
create or replace function public.guard_trashed_entity_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_entity_type text;
begin
  if public.effective_request_role() = 'service_role' then
    return new;
  end if;
  if current_setting('app.order_object_relation_migration', true) = 'on' then
    return new;
  end if;
  v_entity_type := case tg_table_name
    when 'orders' then 'order'
    when 'clients' then 'client'
    when 'client_objects' then 'client_object'
    else null
  end;
  if exists (
    select 1 from public.trash_entries t
    where t.entity_type = v_entity_type and t.entity_id = old.id
  ) then
    if v_entity_type = 'order'
       and current_setting('app.order_object_detach', true) = 'on'
       and new.object_id is null
       and new.address_mode = 'custom'
       and new.country is null
       and new.region is null
       and new.district is null
       and new.city is null
       and new.street is null
       and new.house is null
       and new.postal_code is null
       and new.floor is null
       and new.entrance is null
       and new.apartment is null
       and new.entrance_info is null
       and new.parking_notes is null
       and new.geo_lat is null
       and new.geo_lng is null
       and (
         to_jsonb(old) - array[
           'object_id', 'address_mode', 'country', 'region', 'district', 'city',
           'street', 'house', 'postal_code', 'floor', 'entrance', 'apartment',
           'entrance_info', 'parking_notes', 'geo_lat', 'geo_lng',
           'updated_at', 'updated_by', 'updated_by_user_id'
         ]
       ) = (
         to_jsonb(new) - array[
           'object_id', 'address_mode', 'country', 'region', 'district', 'city',
           'street', 'house', 'postal_code', 'floor', 'entrance', 'apartment',
           'entrance_info', 'parking_notes', 'geo_lat', 'geo_lng',
           'updated_at', 'updated_by', 'updated_by_user_id'
         ]
       ) then
      return new;
    end if;

    -- Deleting company dictionaries must still be able to detach a now-invalid
    -- reference. The user-visible snapshot remains immutable in record_data.
    if v_entity_type = 'order'
       and (to_jsonb(old) - array['work_type_id','department_id','updated_at','updated_by'])
           = (to_jsonb(new) - array['work_type_id','department_id','updated_at','updated_by'])
       and (
         to_jsonb(new) -> 'work_type_id' is not distinct from 'null'::jsonb
         or to_jsonb(new) -> 'work_type_id' is not distinct from to_jsonb(old) -> 'work_type_id'
       )
       and (
         to_jsonb(new) -> 'department_id' is not distinct from 'null'::jsonb
         or to_jsonb(new) -> 'department_id' is not distinct from to_jsonb(old) -> 'department_id'
       ) then
      return new;
    end if;
    raise exception 'Deleted entities are read-only' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.detach_orders_before_client_object_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('order-object:' || old.id::text, 0)
  );
  perform pg_catalog.set_config('app.order_object_detach', 'on', true);

  update public.orders
  set object_id = null
  where company_id = old.company_id
    and object_id = old.id;

  return old;
end;
$$;

revoke all on function public.detach_orders_before_client_object_delete()
  from public, anon, authenticated;

drop trigger if exists a_client_objects_detach_orders_before_delete on public.client_objects;
create trigger a_client_objects_detach_orders_before_delete
before delete on public.client_objects
for each row execute function public.detach_orders_before_client_object_delete();

-- Repair only inconsistent legacy rows. Valid object links retain their
-- existing snapshots; future relation writes refresh the snapshot atomically.
select pg_catalog.set_config('app.order_object_relation_migration', 'on', true);

update public.orders order_row
set object_id = null
where order_row.object_id is not null
  and not exists (
    select 1
    from public.client_objects object_row
    where object_row.id = order_row.object_id
      and object_row.company_id = order_row.company_id
      and object_row.client_id = order_row.client_id
      and not exists (
        select 1
        from public.trash_entries trash
        where trash.company_id = order_row.company_id
          and trash.entity_type = 'client_object'
          and trash.entity_id = object_row.id
      )
  );

update public.orders
set address_mode = 'custom',
    country = null,
    region = null,
    district = null,
    city = null,
    street = null,
    house = null,
    postal_code = null,
    floor = null,
    entrance = null,
    apartment = null,
    entrance_info = null,
    parking_notes = null,
    geo_lat = null,
    geo_lng = null
where object_id is null
  and (
    address_mode is distinct from 'custom'
    or country is not null
    or region is not null
    or district is not null
    or city is not null
    or street is not null
    or house is not null
    or postal_code is not null
    or floor is not null
    or entrance is not null
    or apartment is not null
    or entrance_info is not null
    or parking_notes is not null
    or geo_lat is not null
    or geo_lng is not null
  );

update public.orders order_row
set address_mode = 'object'
where order_row.object_id is not null
  and order_row.address_mode is distinct from 'object';

select pg_catalog.set_config('app.order_object_relation_migration', 'off', true);

alter table public.orders
  drop constraint if exists orders_object_or_no_address_check;
alter table public.orders
  add constraint orders_object_or_no_address_check
  check (
    (object_id is not null and address_mode = 'object')
    or (
      object_id is null
      and address_mode = 'custom'
      and country is null
      and region is null
      and district is null
      and city is null
      and street is null
      and house is null
      and postal_code is null
      and floor is null
      and entrance is null
      and apartment is null
      and entrance_info is null
      and parking_notes is null
      and geo_lat is null
      and geo_lng is null
    )
  );
