-- Replace legacy client addresses with client objects and move order address ownership
-- to client_objects. Safe for repeated execution.

create table if not exists public.client_objects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null default 'Объект',
  is_primary boolean not null default false,
  country text,
  region text,
  city text,
  street text,
  house text,
  postal_code text,
  building text,
  floor text,
  entrance text,
  apartment text,
  intercom text,
  entrance_info text,
  parking_notes text,
  geo_lat text,
  geo_lng text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index if not exists client_objects_client_idx
  on public.client_objects(client_id);

create index if not exists client_objects_company_client_idx
  on public.client_objects(company_id, client_id);

create index if not exists client_objects_company_name_idx
  on public.client_objects(company_id, lower(name));

create unique index if not exists client_objects_primary_unique_idx
  on public.client_objects(client_id)
  where is_primary;

create or replace function public.client_object_summary(
  p_country text,
  p_region text,
  p_city text,
  p_street text,
  p_house text,
  p_building text,
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
      nullif(trim(coalesce(p_country, '')), ''),
      nullif(trim(coalesce(p_region, '')), ''),
      nullif(trim(coalesce(p_city, '')), ''),
      nullif(trim(coalesce(p_street, '')), ''),
      nullif(trim(coalesce(p_house, '')), ''),
      nullif(trim(coalesce(p_building, '')), ''),
      nullif(trim(coalesce(p_entrance, '')), ''),
      nullif(trim(coalesce(p_apartment, '')), '')
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
    raise exception 'client % not found', new.client_id using errcode = '23503';
  end if;

  new.company_id := v_company_id;
  new.name := nullif(trim(coalesce(new.name, '')), '');
  if new.name is null then
    new.name := 'Объект';
  end if;

  new.country := nullif(trim(coalesce(new.country, '')), '');
  new.region := nullif(trim(coalesce(new.region, '')), '');
  new.city := nullif(trim(coalesce(new.city, '')), '');
  new.street := nullif(trim(coalesce(new.street, '')), '');
  new.house := nullif(trim(coalesce(new.house, '')), '');
  new.postal_code := nullif(trim(coalesce(new.postal_code, '')), '');
  new.building := nullif(trim(coalesce(new.building, '')), '');
  new.floor := nullif(trim(coalesce(new.floor, '')), '');
  new.entrance := nullif(trim(coalesce(new.entrance, '')), '');
  new.apartment := nullif(trim(coalesce(new.apartment, '')), '');
  new.intercom := nullif(trim(coalesce(new.intercom, '')), '');
  new.entrance_info := nullif(trim(coalesce(new.entrance_info, '')), '');
  new.parking_notes := nullif(trim(coalesce(new.parking_notes, '')), '');
  new.geo_lat := nullif(trim(coalesce(new.geo_lat, '')), '');
  new.geo_lng := nullif(trim(coalesce(new.geo_lng, '')), '');
  new.summary := public.client_object_summary(
    new.country,
    new.region,
    new.city,
    new.street,
    new.house,
    new.building,
    new.entrance,
    new.apartment
  );
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());

    if not exists (
      select 1
        from public.client_objects o
       where o.client_id = new.client_id
    ) then
      new.is_primary := true;
    end if;
  end if;

  if new.is_primary then
    update public.client_objects
       set is_primary = false,
           updated_at = now(),
           updated_by = auth.uid()
     where client_id = new.client_id
       and id <> new.id
       and is_primary = true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_client_objects_sync_audit on public.client_objects;
create trigger trg_client_objects_sync_audit
before insert or update on public.client_objects
for each row execute function public.client_objects_sync_audit();

alter table public.client_objects enable row level security;

drop policy if exists client_objects_select_company on public.client_objects;
create policy client_objects_select_company
on public.client_objects
for select
to authenticated
using (
  company_id = user_company_id()
);

drop policy if exists client_objects_insert_company on public.client_objects;
create policy client_objects_insert_company
on public.client_objects
for insert
to authenticated
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists client_objects_update_company on public.client_objects;
create policy client_objects_update_company
on public.client_objects
for update
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
)
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

drop policy if exists client_objects_delete_company on public.client_objects;
create policy client_objects_delete_company
on public.client_objects
for delete
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditClients',
    clients_permission_default(user_role(), 'canEditClients')
  )
);

grant select, insert, update, delete on public.client_objects to authenticated;

do $$
begin
  if to_regclass('public.client_addresses') is not null then
    insert into public.client_objects (
  id,
  client_id,
  company_id,
  name,
  is_primary,
  country,
  region,
  city,
  street,
  house,
  postal_code,
  building,
  floor,
  entrance,
  apartment,
  intercom,
  entrance_info,
  parking_notes,
  geo_lat,
  geo_lng,
  summary,
  created_at,
  updated_at,
  created_by,
  updated_by
)
select
  a.id,
  a.client_id,
  a.company_id,
  coalesce(nullif(trim(a.label), ''), 'Объект'),
  coalesce(a.is_primary, false),
  a.country,
  a.region,
  a.city,
  a.street,
  a.house,
  a.postal_code,
  a.building,
  a.floor,
  a.entrance,
  a.apartment,
  a.intercom,
  a.entrance_info,
  a.parking_notes,
  a.geo_lat,
  a.geo_lng,
  public.client_object_summary(
    a.country,
    a.region,
    a.city,
    a.street,
    a.house,
    a.building,
    a.entrance,
    a.apartment
  ),
  coalesce(a.created_at, now()),
  coalesce(a.updated_at, now()),
  a.created_by,
  a.updated_by
from public.client_addresses a
on conflict (id) do update
set
  client_id = excluded.client_id,
  company_id = excluded.company_id,
  name = excluded.name,
  is_primary = excluded.is_primary,
  country = excluded.country,
  region = excluded.region,
  city = excluded.city,
  street = excluded.street,
  house = excluded.house,
  postal_code = excluded.postal_code,
  building = excluded.building,
  floor = excluded.floor,
  entrance = excluded.entrance,
  apartment = excluded.apartment,
  intercom = excluded.intercom,
  entrance_info = excluded.entrance_info,
  parking_notes = excluded.parking_notes,
  geo_lat = excluded.geo_lat,
  geo_lng = excluded.geo_lng,
  summary = excluded.summary,
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by;
  end if;
end
$$;


do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'clients'
       and column_name = 'object_address'
  ) then
    insert into public.client_objects (
      client_id,
      company_id,
      name,
      is_primary,
      street,
      summary,
      created_at,
      updated_at,
      created_by,
      updated_by
    )
    select
      c.id,
      c.company_id,
      'Объект',
      true,
      nullif(trim(coalesce(c.object_address, '')), ''),
      nullif(trim(coalesce(c.object_address, '')), ''),
      c.created_at,
      c.updated_at,
      c.created_by,
      c.updated_by
    from public.clients c
    where nullif(trim(coalesce(c.object_address, '')), '') is not null
      and not exists (
        select 1
          from public.client_objects o
         where o.client_id = c.id
      );
  end if;
end
$$;

alter table public.orders add column if not exists object_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'orders_object_id_fkey'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_object_id_fkey
      foreign key (object_id) references public.client_objects(id) on delete set null;
  end if;
end
$$;

create index if not exists orders_company_object_idx
  on public.orders(company_id, object_id)
  where object_id is not null;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'client_address_id'
  ) then
    update public.orders o
       set object_id = o.client_address_id
     where o.client_address_id is not null
       and exists (
         select 1
           from public.client_objects co
          where co.id = o.client_address_id
       );
  end if;

  -- Legacy migration: only run if orders still have address columns
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'country'
  ) then
    -- Use dynamic SQL to avoid parse-time errors if some address columns are missing
    declare
      v_sql text;
    begin
      v_sql := $sql$
      with legacy_order_objects as (
        select distinct on (o.client_id, public.client_object_summary(
            o.country,
            o.region,
            o.city,
            o.street,
            o.house,
            o.building,
            o.entrance,
            o.apartment
          ))
          o.client_id,
          o.company_id,
          public.client_object_summary(
            o.country,
            o.region,
            o.city,
            o.street,
            o.house,
            o.building,
            o.entrance,
            o.apartment
          ) as summary,
          o.country,
          o.region,
          o.city,
          o.street,
          o.house,
          o.postal_code,
          o.building,
          o.floor,
          o.entrance,
          o.apartment,
          o.intercom,
          o.entrance_info,
          o.parking_notes,
          o.geo_lat,
          o.geo_lng
        from public.orders o
        where o.client_id is not null
          and o.object_id is null
          and public.client_object_summary(
            o.country,
            o.region,
            o.city,
            o.street,
            o.house,
            o.building,
            o.entrance,
            o.apartment
          ) is not null
        order by o.client_id, public.client_object_summary(
            o.country,
            o.region,
            o.city,
            o.street,
            o.house,
            o.building,
            o.entrance,
            o.apartment
          ), o.created_at asc, o.id asc
      )
      insert into public.client_objects (
        client_id,
        company_id,
        name,
        is_primary,
        country,
        region,
        city,
        street,
        house,
        postal_code,
        building,
        floor,
        entrance,
        apartment,
        intercom,
        entrance_info,
        parking_notes,
        geo_lat,
        geo_lng,
        summary
      )
      select
        l.client_id,
        l.company_id,
        'Объект',
        false,
        l.country,
        l.region,
        l.city,
        l.street,
        l.house,
        l.postal_code,
        l.building,
        l.floor,
        l.entrance,
        l.apartment,
        l.intercom,
        l.entrance_info,
        l.parking_notes,
        l.geo_lat,
        l.geo_lng,
        l.summary
      from legacy_order_objects l
      where not exists (
        select 1
          from public.client_objects co
         where co.client_id = l.client_id
           and co.summary is not distinct from l.summary
      );

      update public.orders o
         set object_id = co.id
        from public.client_objects co
       where o.client_id = co.client_id
         and o.object_id is null
         and public.client_object_summary(
           o.country,
           o.region,
           o.city,
           o.street,
           o.house,
           o.building,
           o.entrance,
           o.apartment
         ) is not distinct from co.summary;
      $sql$;

      execute v_sql;
    end;
  end if;
end
$$;

create or replace function public.orders_sync_client_from_object()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_company_id uuid;
  v_object public.client_objects%rowtype;
begin
  if new.object_id is null then
    new.region := null;
    new.city := null;
    new.street := null;
    new.house := null;
    new.country := null;
    new.postal_code := null;
    new.building := null;
    new.floor := null;
    new.entrance := null;
    new.apartment := null;
    new.intercom := null;
    new.parking_notes := null;
    new.geo_lat := null;
    new.geo_lng := null;
    return new;
  end if;

  select *
    into v_object
    from public.client_objects o
   where o.id = new.object_id;

  if v_object.id is null then
    raise exception 'client object % not found', new.object_id using errcode = '23503';
  end if;

  v_client_id := v_object.client_id;
  v_company_id := v_object.company_id;

  if new.company_id is distinct from v_company_id then
    raise exception 'client object % does not belong to company %', new.object_id, new.company_id using errcode = '42501';
  end if;

  if new.client_id is not null and new.client_id is distinct from v_client_id then
    raise exception 'client object % does not belong to client %', new.object_id, new.client_id using errcode = '42501';
  end if;

  new.client_id := v_client_id;
  new.region := v_object.region;
  new.city := v_object.city;
  new.street := v_object.street;
  new.house := v_object.house;
  new.country := v_object.country;
  new.postal_code := v_object.postal_code;
  new.building := v_object.building;
  new.floor := v_object.floor;
  new.entrance := v_object.entrance;
  new.apartment := v_object.apartment;
  new.intercom := v_object.intercom;
  new.parking_notes := v_object.parking_notes;
  new.geo_lat := v_object.geo_lat;
  new.geo_lng := v_object.geo_lng;
  return new;
end;
$$;

drop trigger if exists trg_orders_sync_client_from_object on public.orders;
create trigger trg_orders_sync_client_from_object
before insert or update of object_id, client_id, company_id on public.orders
for each row execute function public.orders_sync_client_from_object();

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
     set title = case when p_patch ? 'title' then (p_patch->>'title') else o.title end,
         comment = case when p_patch ? 'comment' then (p_patch->>'comment') else o.comment end,
         fio = case when p_patch ? 'fio' then (p_patch->>'fio') else o.fio end,
         phone = case when p_patch ? 'phone' then (p_patch->>'phone') else o.phone end,
         secondary_phone = case when p_patch ? 'secondary_phone' then nullif(p_patch->>'secondary_phone', '') else o.secondary_phone end,
         contact_email = case when p_patch ? 'contact_email' then nullif(p_patch->>'contact_email', '') else o.contact_email end,
         contact_pref = case
           when p_patch ? 'contact_pref' then nullif(p_patch->>'contact_pref', '')::public.contact_pref_enum
           else o.contact_pref
         end,
         entrance_info = case when p_patch ? 'entrance_info' then nullif(p_patch->>'entrance_info', '') else o.entrance_info end,
         assigned_to = case
           when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid
           else o.assigned_to
         end,
         client_id = case
           when p_patch ? 'client_id' then nullif(p_patch->>'client_id', '')::uuid
           else o.client_id
         end,
         object_id = case
           when p_patch ? 'object_id' then nullif(p_patch->>'object_id', '')::uuid
           else o.object_id
         end,
         time_window_start = case
           when p_patch ? 'time_window_start' then nullif(p_patch->>'time_window_start', '')::timestamptz
           else o.time_window_start
         end,
         time_window_end = case
           when p_patch ? 'time_window_end' then nullif(p_patch->>'time_window_end', '')::timestamptz
           else o.time_window_end
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

drop trigger if exists trg_client_addresses_sync_audit on public.client_addresses;
drop trigger if exists trg_client_addresses_sync_client_summary on public.client_addresses;
drop trigger if exists trg_clients_create_default_address on public.clients;
drop function if exists public.client_addresses_sync_audit();
drop function if exists public.client_addresses_sync_client_summary();
drop function if exists public.clients_create_default_address();
drop trigger if exists trg_orders_validate_client_address_company on public.orders;
drop function if exists public.orders_validate_client_address_company();
drop function if exists public.client_address_summary(text, text, text, text, text, text, text, text);

drop policy if exists client_addresses_select_company on public.client_addresses;
drop policy if exists client_addresses_insert_company on public.client_addresses;
drop policy if exists client_addresses_update_company on public.client_addresses;
drop policy if exists client_addresses_delete_company on public.client_addresses;

alter table public.orders drop constraint if exists orders_client_address_id_fkey;
drop index if exists orders_company_client_address_idx;

drop table if exists public.client_addresses;

alter table public.clients drop column if exists object_address;

alter table public.orders
  drop column if exists client_address_id;

comment on column public.orders.region is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.city is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.street is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.house is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.country is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.postal_code is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.building is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.floor is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.entrance is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.apartment is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.intercom is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.parking_notes is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.geo_lat is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
comment on column public.orders.geo_lng is
  'DEPRECATED COMPATIBILITY COLUMN: populated from client_objects via object_id. Do not write directly.';
