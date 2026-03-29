begin;

-- 1) Keep companies.owner_id as a valid fallback ownership source.
-- Backfill only for companies with NULL owner_id; pick deterministic admin profile.
with owner_candidate as (
  select
    p.company_id,
    (array_agg(p.id order by p.created_at asc nulls last, p.id asc))[1] as owner_profile_id
  from public.profiles p
  where p.company_id is not null
    and lower(coalesce(p.role, '')) = 'admin'
  group by p.company_id
)
update public.companies c
set owner_id = oc.owner_profile_id
from owner_candidate oc
where c.id = oc.company_id
  and c.owner_id is null;

-- 2) Enforce referential integrity for owner_id.
alter table public.companies
  drop constraint if exists companies_owner_id_fkey;

alter table public.companies
  add constraint companies_owner_id_fkey
  foreign key (owner_id)
  references public.profiles(id)
  on delete set null;

-- 3) Keep companies.updated_at current on every update.
-- Use existing trigger function if available.
do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    execute 'drop trigger if exists trg_companies_set_updated_at on public.companies';
    execute 'create trigger trg_companies_set_updated_at before update on public.companies for each row execute function public.set_updated_at()';
  elsif to_regprocedure('public.tg_set_updated_at()') is not null then
    execute 'drop trigger if exists trg_companies_set_updated_at on public.companies';
    execute 'create trigger trg_companies_set_updated_at before update on public.companies for each row execute function public.tg_set_updated_at()';
  else
    create or replace function public._companies_touch_updated_at()
    returns trigger
    language plpgsql
    as $fn$
    begin
      new.updated_at := timezone('utc', now());
      return new;
    end
    $fn$;

    drop trigger if exists trg_companies_set_updated_at on public.companies;
    create trigger trg_companies_set_updated_at
    before update on public.companies
    for each row execute function public._companies_touch_updated_at();
  end if;
end
$$;

commit;