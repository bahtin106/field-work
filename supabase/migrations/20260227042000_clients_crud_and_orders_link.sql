-- Clients: tenant-safe directory + permission-aware RLS + order linkage.
-- Safe for repeated execution.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  middle_name text,
  full_name text not null default '',
  email text,
  phone text,
  avatar_url text,
  object_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

alter table public.clients add column if not exists company_id uuid;
alter table public.clients add column if not exists first_name text;
alter table public.clients add column if not exists last_name text;
alter table public.clients add column if not exists middle_name text;
alter table public.clients add column if not exists full_name text;
alter table public.clients add column if not exists email text;
alter table public.clients add column if not exists phone text;
alter table public.clients add column if not exists avatar_url text;
alter table public.clients add column if not exists object_address text;
alter table public.clients add column if not exists created_at timestamptz;
alter table public.clients add column if not exists updated_at timestamptz;
alter table public.clients add column if not exists created_by uuid;
alter table public.clients add column if not exists updated_by uuid;

alter table public.clients
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.clients
set
  first_name = coalesce(first_name, ''),
  last_name = coalesce(last_name, ''),
  full_name = coalesce(full_name, ''),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.clients
  alter column first_name set not null,
  alter column last_name set not null,
  alter column full_name set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_company_id_fkey'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
end
$$;

create or replace function public.clients_sync_name_and_audit()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
  v_full_name text;
begin
  new.first_name := btrim(coalesce(new.first_name, ''));
  new.last_name := btrim(coalesce(new.last_name, ''));
  new.middle_name := nullif(btrim(coalesce(new.middle_name, '')), '');
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.object_address := nullif(btrim(coalesce(new.object_address, '')), '');

  v_full_name := nullif(
    regexp_replace(
      btrim(concat_ws(' ', new.last_name, new.first_name, coalesce(new.middle_name, ''))),
      '\s+',
      ' ',
      'g'
    ),
    ''
  );
  new.full_name := coalesce(v_full_name, '');
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, v_uid);
  end if;

  new.updated_by := coalesce(v_uid, new.updated_by);

  return new;
end
$$;

drop trigger if exists trg_clients_sync_name_and_audit on public.clients;
create trigger trg_clients_sync_name_and_audit
before insert or update on public.clients
for each row execute function public.clients_sync_name_and_audit();

create index if not exists clients_company_id_idx on public.clients(company_id);
create index if not exists clients_company_full_name_idx on public.clients(company_id, full_name);
create index if not exists clients_company_phone_idx on public.clients(company_id, phone) where phone is not null;
create unique index if not exists clients_company_email_unique_idx
  on public.clients(company_id, lower(email))
  where email is not null and btrim(email) <> '';

create or replace function public.clients_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
as $$
  select case
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then true
    when lower(coalesce(p_role, '')) = 'worker' then p_key = 'canViewClients'
    else false
  end;
$$;

create or replace function public.has_app_role_permission(
  p_company_id uuid,
  p_role text,
  p_key text,
  p_default boolean
)
returns boolean
language sql
stable
as $$
  select coalesce(
    (
      select p.value
      from public.app_role_permissions p
      where p.company_id = p_company_id
        and p.role = p_role
        and p.key = p_key
      limit 1
    ),
    p_default
  );
$$;

alter table public.clients enable row level security;

drop policy if exists clients_select_company on public.clients;
create policy clients_select_company
on public.clients
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

drop policy if exists clients_insert_company on public.clients;
create policy clients_insert_company
on public.clients
for insert
to authenticated
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canCreateClients',
    clients_permission_default(user_role(), 'canCreateClients')
  )
);

drop policy if exists clients_update_company on public.clients;
create policy clients_update_company
on public.clients
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

drop policy if exists clients_delete_company on public.clients;
create policy clients_delete_company
on public.clients
for delete
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canDeleteClients',
    clients_permission_default(user_role(), 'canDeleteClients')
  )
);

grant select, insert, update, delete on public.clients to authenticated;

alter table public.orders add column if not exists client_id uuid;

create index if not exists orders_company_client_idx
  on public.orders(company_id, client_id)
  where client_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_client_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete set null;
  end if;
end
$$;

create or replace function public.orders_validate_client_company()
returns trigger
language plpgsql
as $$
declare
  v_client_company_id uuid;
begin
  if new.client_id is null then
    return new;
  end if;

  select c.company_id
  into v_client_company_id
  from public.clients c
  where c.id = new.client_id;

  if v_client_company_id is null then
    raise exception 'client % not found', new.client_id using errcode = '23503';
  end if;

  if v_client_company_id <> new.company_id then
    raise exception 'client % does not belong to company %', new.client_id, new.company_id using errcode = '42501';
  end if;

  return new;
end
$$;

drop trigger if exists trg_orders_validate_client_company on public.orders;
create trigger trg_orders_validate_client_company
before insert or update of client_id, company_id on public.orders
for each row
execute function public.orders_validate_client_company();

with companies_with_access_settings as (
  select distinct company_id
  from public.app_role_permissions
),
role_permission_defaults as (
  select *
  from (
    values
      ('admin'::text, 'canViewClients'::text, true),
      ('admin'::text, 'canCreateClients'::text, true),
      ('admin'::text, 'canEditClients'::text, true),
      ('admin'::text, 'canDeleteClients'::text, true),
      ('dispatcher'::text, 'canViewClients'::text, true),
      ('dispatcher'::text, 'canCreateClients'::text, true),
      ('dispatcher'::text, 'canEditClients'::text, true),
      ('dispatcher'::text, 'canDeleteClients'::text, true),
      ('worker'::text, 'canViewClients'::text, true),
      ('worker'::text, 'canCreateClients'::text, false),
      ('worker'::text, 'canEditClients'::text, false),
      ('worker'::text, 'canDeleteClients'::text, false)
  ) as t(role, key, value)
)
insert into public.app_role_permissions (company_id, role, key, value)
select c.company_id, d.role, d.key, d.value
from companies_with_access_settings c
cross join role_permission_defaults d
where not exists (
  select 1
  from public.app_role_permissions p
  where p.company_id = c.company_id
    and p.role = d.role
    and p.key = d.key
)
on conflict (company_id, role, key) do nothing;
