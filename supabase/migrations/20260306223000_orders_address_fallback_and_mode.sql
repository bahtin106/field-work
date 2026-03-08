begin;

alter table public.orders
  add column if not exists address_mode text,
  add column if not exists object_name_snapshot text,
  add column if not exists country text,
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists street text,
  add column if not exists house text,
  add column if not exists postal_code text,
  add column if not exists building text,
  add column if not exists floor text,
  add column if not exists entrance text,
  add column if not exists apartment text,
  add column if not exists intercom text,
  add column if not exists entrance_info text,
  add column if not exists parking_notes text,
  add column if not exists geo_lat text,
  add column if not exists geo_lng text;

update public.orders
set address_mode = case
  when object_id is null then 'custom'
  else 'object'
end
where address_mode is null;

alter table public.orders
  alter column address_mode set default 'object';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'orders_address_mode_chk'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_address_mode_chk
      check (address_mode in ('object', 'custom'));
  end if;
end
$$;

alter table public.orders
  alter column address_mode set not null;

update public.orders o
   set object_name_snapshot = co.name,
       country = co.country,
       region = co.region,
       city = co.city,
       street = co.street,
       house = co.house,
       postal_code = co.postal_code,
       building = co.building,
       floor = co.floor,
       entrance = co.entrance,
       apartment = co.apartment,
       intercom = co.intercom,
       entrance_info = co.entrance_info,
       parking_notes = co.parking_notes,
       geo_lat = co.geo_lat::text,
       geo_lng = co.geo_lng::text
  from public.client_objects co
 where o.object_id = co.id
   and (
     o.object_name_snapshot is null
     or o.city is null
     or o.street is null
     or o.house is null
   );

drop trigger if exists trg_orders_validate_object_link on public.orders;

alter table public.orders
  drop constraint if exists orders_object_id_fkey;

alter table public.orders
  add constraint orders_object_id_fkey
  foreign key (object_id) references public.client_objects(id) on delete set null;

create or replace function public.orders_validate_object_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.client_objects%rowtype;
begin
  if new.object_id is null then
    return new;
  end if;

  select *
    into v_object
    from public.client_objects
   where id = new.object_id;

  if v_object.id is null then
    raise exception 'client object % not found', new.object_id
      using errcode = '23503';
  end if;

  if new.company_id is distinct from v_object.company_id then
    raise exception 'client object % does not belong to company %', new.object_id, new.company_id
      using errcode = '42501';
  end if;

  if new.client_id is not null and new.client_id is distinct from v_object.client_id then
    raise exception 'client object % does not belong to client %', new.object_id, new.client_id
      using errcode = '42501';
  end if;

  new.client_id := v_object.client_id;
  return new;
end;
$$;

create trigger trg_orders_validate_object_link
before insert or update of company_id, client_id, object_id
on public.orders
for each row
execute function public.orders_validate_object_link();

commit;
