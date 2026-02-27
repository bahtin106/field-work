-- Backfill clients from existing orders and enforce per-company uniqueness by phone/email.
-- Safe to run multiple times.

create or replace function public.normalize_phone_digits(p_phone text)
returns text
language sql
immutable
as $$
  with raw as (
    select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') as digits
  )
  select case
    when digits is null then null
    when length(digits) = 11 and left(digits, 1) = '8' then '7' || substr(digits, 2)
    when length(digits) = 10 then '7' || digits
    when length(digits) = 11 and left(digits, 1) = '7' then digits
    else digits
  end
  from raw;
$$;

create or replace function public.normalize_email_text(p_email text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

lock table public.clients in share row exclusive mode;
lock table public.orders in share row exclusive mode;

-- 1) Deduplicate existing clients by normalized phone within company.
with normalized as (
  select
    c.id,
    c.company_id,
    c.created_at,
    public.normalize_phone_digits(c.phone) as phone_key,
    row_number() over (
      partition by c.company_id, public.normalize_phone_digits(c.phone)
      order by c.created_at asc nulls last, c.id asc
    ) as rn,
    first_value(c.id) over (
      partition by c.company_id, public.normalize_phone_digits(c.phone)
      order by c.created_at asc nulls last, c.id asc
    ) as keep_id
  from public.clients c
  where public.normalize_phone_digits(c.phone) is not null
), map as (
  select id as duplicate_id, keep_id
  from normalized
  where rn > 1
)
update public.orders o
set client_id = m.keep_id
from map m
where o.client_id = m.duplicate_id;

with normalized as (
  select
    c.id,
    c.company_id,
    c.created_at,
    public.normalize_phone_digits(c.phone) as phone_key,
    row_number() over (
      partition by c.company_id, public.normalize_phone_digits(c.phone)
      order by c.created_at asc nulls last, c.id asc
    ) as rn,
    first_value(c.id) over (
      partition by c.company_id, public.normalize_phone_digits(c.phone)
      order by c.created_at asc nulls last, c.id asc
    ) as keep_id
  from public.clients c
  where public.normalize_phone_digits(c.phone) is not null
), map as (
  select id as duplicate_id, keep_id
  from normalized
  where rn > 1
)
update public.clients k
set
  first_name = case
    when btrim(coalesce(k.first_name, '')) = '' and btrim(coalesce(d.first_name, '')) <> '' then d.first_name
    else k.first_name
  end,
  last_name = case
    when btrim(coalesce(k.last_name, '')) = '' and btrim(coalesce(d.last_name, '')) <> '' then d.last_name
    else k.last_name
  end,
  middle_name = coalesce(k.middle_name, d.middle_name),
  email = coalesce(k.email, d.email),
  avatar_url = coalesce(k.avatar_url, d.avatar_url),
  object_address = coalesce(k.object_address, d.object_address),
  updated_at = now()
from map m
join public.clients d on d.id = m.duplicate_id
where k.id = m.keep_id;

with normalized as (
  select
    c.id,
    c.company_id,
    c.created_at,
    public.normalize_phone_digits(c.phone) as phone_key,
    row_number() over (
      partition by c.company_id, public.normalize_phone_digits(c.phone)
      order by c.created_at asc nulls last, c.id asc
    ) as rn
  from public.clients c
  where public.normalize_phone_digits(c.phone) is not null
)
delete from public.clients c
using normalized n
where c.id = n.id
  and n.rn > 1;

-- 2) Deduplicate existing clients by normalized email within company.
with normalized as (
  select
    c.id,
    c.company_id,
    c.created_at,
    public.normalize_email_text(c.email) as email_key,
    row_number() over (
      partition by c.company_id, public.normalize_email_text(c.email)
      order by c.created_at asc nulls last, c.id asc
    ) as rn,
    first_value(c.id) over (
      partition by c.company_id, public.normalize_email_text(c.email)
      order by c.created_at asc nulls last, c.id asc
    ) as keep_id
  from public.clients c
  where public.normalize_email_text(c.email) is not null
), map as (
  select id as duplicate_id, keep_id
  from normalized
  where rn > 1
)
update public.orders o
set client_id = m.keep_id
from map m
where o.client_id = m.duplicate_id;

with normalized as (
  select
    c.id,
    c.company_id,
    c.created_at,
    public.normalize_email_text(c.email) as email_key,
    row_number() over (
      partition by c.company_id, public.normalize_email_text(c.email)
      order by c.created_at asc nulls last, c.id asc
    ) as rn,
    first_value(c.id) over (
      partition by c.company_id, public.normalize_email_text(c.email)
      order by c.created_at asc nulls last, c.id asc
    ) as keep_id
  from public.clients c
  where public.normalize_email_text(c.email) is not null
), map as (
  select id as duplicate_id, keep_id
  from normalized
  where rn > 1
)
update public.clients k
set
  first_name = case
    when btrim(coalesce(k.first_name, '')) = '' and btrim(coalesce(d.first_name, '')) <> '' then d.first_name
    else k.first_name
  end,
  last_name = case
    when btrim(coalesce(k.last_name, '')) = '' and btrim(coalesce(d.last_name, '')) <> '' then d.last_name
    else k.last_name
  end,
  middle_name = coalesce(k.middle_name, d.middle_name),
  phone = coalesce(k.phone, d.phone),
  avatar_url = coalesce(k.avatar_url, d.avatar_url),
  object_address = coalesce(k.object_address, d.object_address),
  updated_at = now()
from map m
join public.clients d on d.id = m.duplicate_id
where k.id = m.keep_id;

with normalized as (
  select
    c.id,
    c.company_id,
    c.created_at,
    public.normalize_email_text(c.email) as email_key,
    row_number() over (
      partition by c.company_id, public.normalize_email_text(c.email)
      order by c.created_at asc nulls last, c.id asc
    ) as rn
  from public.clients c
  where public.normalize_email_text(c.email) is not null
)
delete from public.clients c
using normalized n
where c.id = n.id
  and n.rn > 1;

-- 3) Enforce uniqueness with normalized keys.
drop index if exists public.clients_company_email_unique_idx;

create unique index if not exists clients_company_phone_unique_idx
  on public.clients(company_id, public.normalize_phone_digits(phone))
  where public.normalize_phone_digits(phone) is not null;

create unique index if not exists clients_company_email_unique_idx
  on public.clients(company_id, public.normalize_email_text(email))
  where public.normalize_email_text(email) is not null;

-- 4) Create missing clients from existing orders (keyed by normalized phone).
with orders_source as (
  select
    o.company_id,
    public.normalize_phone_digits(o.phone) as phone_key,
    nullif(regexp_replace(btrim(coalesce(max(nullif(o.fio, '')), '')), '\s+', ' ', 'g'), '') as fio_clean
  from public.orders o
  where public.normalize_phone_digits(o.phone) is not null
  group by o.company_id, public.normalize_phone_digits(o.phone)
), names as (
  select
    s.company_id,
    s.phone_key,
    s.fio_clean,
    case
      when s.fio_clean is null then array[]::text[]
      else regexp_split_to_array(s.fio_clean, '\s+')
    end as parts
  from orders_source s
)
insert into public.clients (
  company_id,
  first_name,
  last_name,
  middle_name,
  phone
)
select
  n.company_id,
  case
    when coalesce(array_length(n.parts, 1), 0) = 1 then n.parts[1]
    when coalesce(array_length(n.parts, 1), 0) >= 2 then n.parts[2]
    else ''
  end as first_name,
  case
    when coalesce(array_length(n.parts, 1), 0) >= 2 then n.parts[1]
    else ''
  end as last_name,
  case
    when coalesce(array_length(n.parts, 1), 0) >= 3 then nullif(array_to_string(n.parts[3:array_length(n.parts, 1)], ' '), '')
    else null
  end as middle_name,
  '+' || n.phone_key as phone
from names n
on conflict do nothing;

-- 5) Link all existing orders to the resolved client by normalized phone.
update public.orders o
set client_id = c.id
from public.clients c
where o.client_id is null
  and o.company_id = c.company_id
  and public.normalize_phone_digits(o.phone) is not null
  and public.normalize_phone_digits(o.phone) = public.normalize_phone_digits(c.phone);
