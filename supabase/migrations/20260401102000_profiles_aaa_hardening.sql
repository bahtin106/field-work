-- Profiles AAA hardening: timestamps, FK navigation, and lookup indexes.

-- 1) Keep updated_at fresh on each row update.
drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

-- 2) FK for fast navigation and integrity in Studio/UI.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_company_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_company_id_fkey
      foreign key (company_id)
      references public.companies(id)
      on delete set null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_department_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_department_id_fkey
      foreign key (department_id)
      references public.departments(id)
      on delete set null;
  end if;
end
$$;

-- 3) Query-performance indexes for frequent filters.
create index if not exists idx_profiles_company_id on public.profiles(company_id);
create index if not exists idx_profiles_department_id on public.profiles(department_id);
