-- Departments feature hardening:
-- 1) Company-level toggle (use_departments), default OFF for new companies.
-- 2) Soft-disable support for departments (is_enabled).
-- 3) Max 10 departments per company.
-- 4) Validation triggers so disabled/off departments cannot be newly selected
--    in orders/profiles while historical values remain valid.
-- 5) Missing INSERT RLS policy for departments.

alter table if exists public.companies
  add column if not exists use_departments boolean;

update public.companies c
set use_departments = case
  when exists (
    select 1
    from public.departments d
    where d.company_id = c.id
  ) then true
  else false
end
where c.use_departments is null;

alter table if exists public.companies
  alter column use_departments set default false;

alter table if exists public.companies
  alter column use_departments set not null;

alter table if exists public.departments
  add column if not exists is_enabled boolean not null default true;

update public.departments
set is_enabled = true
where is_enabled is null;

create index if not exists departments_company_enabled_name_idx
  on public.departments (company_id, is_enabled, name);

create or replace function public.departments_enforce_company_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id public.companies.id%type;
  v_count bigint;
begin
  v_company_id := new.company_id;
  if v_company_id is null then
    return new;
  end if;

  select count(*)
    into v_count
    from public.departments d
   where d.company_id = v_company_id
     and (tg_op = 'INSERT' or d.id is distinct from new.id);

  if v_count >= 10 then
    raise exception 'DEPARTMENTS_LIMIT_REACHED'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_departments_enforce_company_limit on public.departments;
create trigger trg_departments_enforce_company_limit
before insert or update of company_id
on public.departments
for each row
execute function public.departments_enforce_company_limit();

create or replace function public.orders_validate_enabled_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_use_departments boolean;
  v_is_enabled boolean;
begin
  if new.department_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.department_id is not distinct from old.department_id then
    return new;
  end if;

  select c.use_departments
    into v_use_departments
    from public.companies c
   where c.id = new.company_id
   limit 1;

  if v_use_departments is null then
    raise exception 'COMPANY_NOT_FOUND_FOR_ORDER'
      using errcode = '23503';
  end if;

  if v_use_departments = false then
    raise exception 'DEPARTMENTS_DISABLED_FOR_SELECTION'
      using errcode = '23514';
  end if;

  select d.is_enabled
    into v_is_enabled
    from public.departments d
   where d.id = new.department_id
     and d.company_id = new.company_id
   limit 1;

  if v_is_enabled is null then
    raise exception 'DEPARTMENT_NOT_FOUND_IN_COMPANY'
      using errcode = '23503';
  end if;

  if v_is_enabled = false then
    raise exception 'DEPARTMENT_DISABLED_FOR_SELECTION'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_validate_enabled_department on public.orders;
create trigger trg_orders_validate_enabled_department
before insert or update of department_id, company_id
on public.orders
for each row
execute function public.orders_validate_enabled_department();

create or replace function public.profiles_validate_enabled_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id public.companies.id%type;
  v_use_departments boolean;
  v_is_enabled boolean;
begin
  if new.department_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.department_id is not distinct from old.department_id then
    return new;
  end if;

  v_company_id := coalesce(new.company_id, old.company_id);
  if v_company_id is null then
    raise exception 'PROFILE_COMPANY_REQUIRED_FOR_DEPARTMENT'
      using errcode = '23514';
  end if;

  select c.use_departments
    into v_use_departments
    from public.companies c
   where c.id = v_company_id
   limit 1;

  if v_use_departments is null then
    raise exception 'COMPANY_NOT_FOUND_FOR_PROFILE'
      using errcode = '23503';
  end if;

  if v_use_departments = false then
    raise exception 'DEPARTMENTS_DISABLED_FOR_SELECTION'
      using errcode = '23514';
  end if;

  select d.is_enabled
    into v_is_enabled
    from public.departments d
   where d.id = new.department_id
     and d.company_id = v_company_id
   limit 1;

  if v_is_enabled is null then
    raise exception 'DEPARTMENT_NOT_FOUND_IN_COMPANY'
      using errcode = '23503';
  end if;

  if v_is_enabled = false then
    raise exception 'DEPARTMENT_DISABLED_FOR_SELECTION'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_validate_enabled_department on public.profiles;
create trigger trg_profiles_validate_enabled_department
before insert or update of department_id, company_id
on public.profiles
for each row
execute function public.profiles_validate_enabled_department();

drop policy if exists departments_insert_admin_dispatcher on public.departments;
create policy departments_insert_admin_dispatcher
  on public.departments
  for insert
  to authenticated
  with check ((company_id = user_company_id()) and is_admin_or_dispatcher());
