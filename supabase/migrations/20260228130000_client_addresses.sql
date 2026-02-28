-- Client addresses: normalized reusable address book per client with order linkage.

create table if not exists public.client_addresses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null default 'Основной адрес',
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

alter table public.client_addresses
  alter column label set default 'Основной адрес';

create index if not exists client_addresses_client_idx
  on public.client_addresses(client_id);

create index if not exists client_addresses_company_idx
  on public.client_addresses(company_id);

create unique index if not exists client_addresses_primary_unique_idx
  on public.client_addresses(client_id)
  where is_primary;

create or replace function public.client_address_summary(
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

create or replace function public.client_addresses_sync_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select c.company_id into v_company_id
  from public.clients c
  where c.id = new.client_id;

  if v_company_id is null then
    raise exception 'client % not found', new.client_id using errcode = '23503';
  end if;

  new.company_id := v_company_id;
  new.label := nullif(trim(coalesce(new.label, '')), '');
  if new.label is null then
    new.label := 'Основной адрес';
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
    if not exists (
      select 1
      from public.client_addresses a
      where a.client_id = new.client_id
    ) then
      new.is_primary := true;
    end if;
  end if;

  if new.is_primary then
    update public.client_addresses
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

drop trigger if exists trg_client_addresses_sync_audit on public.client_addresses;
create trigger trg_client_addresses_sync_audit
before insert or update on public.client_addresses
for each row execute function public.client_addresses_sync_audit();

create or replace function public.client_addresses_sync_client_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
           a.building,
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

  return null;
end;
$$;

drop trigger if exists trg_client_addresses_sync_client_summary on public.client_addresses;
create trigger trg_client_addresses_sync_client_summary
after insert or update or delete on public.client_addresses
for each row execute function public.client_addresses_sync_client_summary();

create or replace function public.clients_create_default_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_addresses (
    client_id,
    company_id,
    label,
    is_primary,
    street,
    created_by,
    updated_by
  )
  values (
    new.id,
    new.company_id,
    'Основной адрес',
    true,
    nullif(trim(coalesce(new.object_address, '')), ''),
    auth.uid(),
    auth.uid()
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_clients_create_default_address on public.clients;
create trigger trg_clients_create_default_address
after insert on public.clients
for each row execute function public.clients_create_default_address();

insert into public.client_addresses (
  client_id,
  company_id,
  label,
  is_primary,
  street,
  created_by,
  updated_by
)
select
  c.id,
  c.company_id,
  'Основной адрес',
  true,
  nullif(trim(coalesce(c.object_address, '')), ''),
  c.created_by,
  c.updated_by
from public.clients c
where not exists (
  select 1
  from public.client_addresses a
  where a.client_id = c.id
);

alter table public.client_addresses enable row level security;

drop policy if exists client_addresses_select_company on public.client_addresses;
create policy client_addresses_select_company
on public.client_addresses
for select
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canViewClients',
    clients_permission_default(user_role(), 'canViewClients')
  )
);

drop policy if exists client_addresses_insert_company on public.client_addresses;
create policy client_addresses_insert_company
on public.client_addresses
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

drop policy if exists client_addresses_update_company on public.client_addresses;
create policy client_addresses_update_company
on public.client_addresses
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

drop policy if exists client_addresses_delete_company on public.client_addresses;
create policy client_addresses_delete_company
on public.client_addresses
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

grant select, insert, update, delete on public.client_addresses to authenticated;

alter table public.orders add column if not exists client_address_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_client_address_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_client_address_id_fkey
      foreign key (client_address_id) references public.client_addresses(id) on delete set null;
  end if;
end
$$;

create index if not exists orders_company_client_address_idx
  on public.orders(company_id, client_address_id)
  where client_address_id is not null;

create or replace function public.orders_validate_client_address_company()
returns trigger
language plpgsql
as $$
declare
  v_client_id uuid;
  v_company_id uuid;
begin
  if new.client_address_id is null then
    return new;
  end if;

  select a.client_id, a.company_id
    into v_client_id, v_company_id
    from public.client_addresses a
   where a.id = new.client_address_id;

  if v_client_id is null then
    raise exception 'client address % not found', new.client_address_id using errcode = '23503';
  end if;

  if v_company_id <> new.company_id then
    raise exception 'client address % does not belong to company %', new.client_address_id, new.company_id using errcode = '42501';
  end if;

  if new.client_id is not null and v_client_id <> new.client_id then
    raise exception 'client address % does not belong to client %', new.client_address_id, new.client_id using errcode = '42501';
  end if;

  return new;
end
$$;

drop trigger if exists trg_orders_validate_client_address_company on public.orders;
create trigger trg_orders_validate_client_address_company
before insert or update of client_address_id, client_id, company_id on public.orders
for each row execute function public.orders_validate_client_address_company();
