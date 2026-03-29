begin;

-- 1) Data normalization.
update public.departments
set name = regexp_replace(btrim(name), '\s+', ' ', 'g')
where name is distinct from regexp_replace(btrim(name), '\s+', ' ', 'g');

-- 2) Integrity: company relation + valid names.
alter table public.departments
  drop constraint if exists departments_company_id_fkey;

alter table public.departments
  add constraint departments_company_id_fkey
  foreign key (company_id)
  references public.companies(id)
  on delete cascade
  not valid;

alter table public.departments
  validate constraint departments_company_id_fkey;

alter table public.departments
  drop constraint if exists departments_name_nonempty_check;

alter table public.departments
  add constraint departments_name_nonempty_check
  check (btrim(name) <> '');

-- 3) Unique department name per company (case-insensitive) for active records.
create unique index if not exists departments_company_name_unique_live_idx
  on public.departments (company_id, lower(btrim(name)))
  where deleted_at is null;

-- 4) Keep updated_at reliable + keep name normalized on writes.
create or replace function public.departments_normalize_and_touch()
returns trigger
language plpgsql
as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_departments_normalize_and_touch
  on public.departments;

create trigger trg_departments_normalize_and_touch
before insert or update on public.departments
for each row execute function public.departments_normalize_and_touch();

-- 5) Company limits should ignore soft-deleted rows.
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
     and d.deleted_at is null
     and (tg_op = 'INSERT' or d.id is distinct from new.id);

  if v_count >= 10 then
    raise exception 'DEPARTMENTS_LIMIT_REACHED'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- 6) RLS hardening: remove global authenticated read policy (cross-company leakage risk).
drop policy if exists "All can read departments" on public.departments;

commit;