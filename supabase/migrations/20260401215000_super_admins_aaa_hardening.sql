begin;

alter table public.super_admins force row level security;

-- Tighten direct table access; super-admin checks should go via SECURITY DEFINER functions.
revoke all on table public.super_admins from anon;
revoke all on table public.super_admins from authenticated;
revoke all on table public.super_admins from public;
grant select, insert, update, delete on table public.super_admins to service_role;

-- Keep an explicit service policy and remove deny-all authenticated policy noise.
drop policy if exists super_admins_no_auth_access on public.super_admins;
drop policy if exists super_admins_service_role_all on public.super_admins;
create policy super_admins_service_role_all
on public.super_admins
as permissive
for all
to service_role
using (true)
with check (true);

-- Data integrity: if both ids are set, they must match (auth.users.id == profiles.id contract).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.super_admins'::regclass
      and conname='super_admins_user_profile_match_chk'
  ) then
    alter table public.super_admins
      add constraint super_admins_user_profile_match_chk
      check (user_id is null or profile_id is null or user_id = profile_id);
  end if;
end
$$;

-- Referential integrity (safe: already verified zero orphans).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.super_admins'::regclass
      and conname='super_admins_user_id_fkey'
  ) then
    alter table public.super_admins
      add constraint super_admins_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.super_admins'::regclass
      and conname='super_admins_profile_id_fkey'
  ) then
    alter table public.super_admins
      add constraint super_admins_profile_id_fkey
      foreign key (profile_id)
      references public.profiles(id)
      on delete cascade;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.super_admins'::regclass
      and conname='super_admins_created_by_fkey'
  ) then
    alter table public.super_admins
      add constraint super_admins_created_by_fkey
      foreign key (created_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

-- Query-path indexes for is_super_admin() checks.
create index if not exists idx_super_admins_user_active
  on public.super_admins (user_id)
  where is_active and user_id is not null;

create index if not exists idx_super_admins_profile_active
  on public.super_admins (profile_id)
  where is_active and profile_id is not null;

commit;
