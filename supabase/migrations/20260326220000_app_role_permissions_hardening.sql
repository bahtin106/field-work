-- Hardening for access-permission storage at scale:
-- 1) consistent updated_at/updated_by on every write
-- 2) stable uniqueness for upsert
-- 3) FK navigation ("arrows") in Supabase Table Editor for company_id and updated_by

begin;

alter table if exists public.app_role_permissions
  add column if not exists updated_at timestamptz;

alter table if exists public.app_role_permissions
  alter column updated_at set default timezone('utc', now());

update public.app_role_permissions
set updated_at = timezone('utc', now())
where updated_at is null;

alter table if exists public.app_role_permissions
  alter column updated_at set not null;

alter table if exists public.app_role_permissions
  add column if not exists updated_by uuid;

create or replace function public.tg_app_role_permissions_touch_audit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid;
begin
  begin
    v_uid := auth.uid();
  exception
    when others then
      v_uid := null;
  end;

  new.updated_at := timezone('utc', now());

  if v_uid is not null then
    new.updated_by := v_uid;
  elsif tg_op = 'UPDATE' then
    new.updated_by := coalesce(new.updated_by, old.updated_by);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_app_role_permissions_touch_audit on public.app_role_permissions;
create trigger trg_app_role_permissions_touch_audit
before insert or update on public.app_role_permissions
for each row execute function public.tg_app_role_permissions_touch_audit();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.app_role_permissions'::regclass
      and conname = 'app_role_permissions_company_role_key_uk'
  ) then
    alter table public.app_role_permissions
      add constraint app_role_permissions_company_role_key_uk
      unique (company_id, role, key);
  end if;
end
$$;

create index if not exists idx_app_role_permissions_company on public.app_role_permissions(company_id);

update public.app_role_permissions p
set updated_by = null
where p.updated_by is not null
  and not exists (
    select 1
    from public.profiles pr
    where pr.id = p.updated_by
  );

do $$
declare
  company_orphans bigint;
begin
  select count(*)
  into company_orphans
  from public.app_role_permissions p
  left join public.companies c on c.id = p.company_id
  where c.id is null;

  if company_orphans = 0 then
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.app_role_permissions'::regclass
        and conname = 'app_role_permissions_company_id_fkey'
    ) then
      alter table public.app_role_permissions
        add constraint app_role_permissions_company_id_fkey
        foreign key (company_id)
        references public.companies(id)
        on delete cascade;
    end if;
  else
    raise notice 'Skip FK app_role_permissions_company_id_fkey: found % orphan company_id rows', company_orphans;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.app_role_permissions'::regclass
      and conname = 'app_role_permissions_updated_by_fkey'
  ) then
    alter table public.app_role_permissions
      add constraint app_role_permissions_updated_by_fkey
      foreign key (updated_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

commit;
