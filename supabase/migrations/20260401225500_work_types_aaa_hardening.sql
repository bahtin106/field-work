begin;

-- 1) Integrity hardening
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.work_types'::regclass
      and conname='work_types_company_id_fkey'
  ) then
    alter table public.work_types
      add constraint work_types_company_id_fkey
      foreign key (company_id)
      references public.companies(id)
      on delete cascade;
  end if;
end
$$;

-- 2) Enforce sane naming at DB level (UI already does this).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.work_types'::regclass
      and conname='work_types_name_len_chk'
  ) then
    alter table public.work_types
      add constraint work_types_name_len_chk
      check (char_length(btrim(name)) between 1 and 64);
  end if;
end
$$;

-- Case-insensitive uniqueness per company.
create unique index if not exists work_types_company_name_ci_key
  on public.work_types (company_id, lower(btrim(name)));

-- 3) Keep updated_at fresh on updates.
drop trigger if exists trg_work_types_set_updated_at on public.work_types;
create trigger trg_work_types_set_updated_at
before update on public.work_types
for each row
execute function public.tg_set_updated_at();

-- 4) Security hardening (RLS + grants + explicit policies)
alter table public.work_types force row level security;

revoke all on table public.work_types from anon;
revoke all on table public.work_types from public;
revoke all on table public.work_types from authenticated;

grant select, insert, update, delete on table public.work_types to authenticated;
grant select, insert, update, delete on table public.work_types to service_role;

drop policy if exists "All can read work types" on public.work_types;
drop policy if exists work_types_select_same_company on public.work_types;
drop policy if exists work_types_insert_admins on public.work_types;
drop policy if exists work_types_update_admins on public.work_types;
drop policy if exists work_types_delete_admins on public.work_types;
drop policy if exists work_types_service_role_all on public.work_types;

create policy work_types_service_role_all
  on public.work_types
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

create policy work_types_select_secure
  on public.work_types
  as permissive
  for select
  to authenticated
  using ((company_id = public.user_company_id()) or public.is_super_admin());

create policy work_types_insert_secure
  on public.work_types
  as permissive
  for insert
  to authenticated
  with check (
    public.is_super_admin()
    or (company_id = public.user_company_id() and public.is_admin_or_dispatcher())
  );

create policy work_types_update_secure
  on public.work_types
  as permissive
  for update
  to authenticated
  using (
    public.is_super_admin()
    or (company_id = public.user_company_id() and public.is_admin_or_dispatcher())
  )
  with check (
    public.is_super_admin()
    or (company_id = public.user_company_id() and public.is_admin_or_dispatcher())
  );

create policy work_types_delete_secure
  on public.work_types
  as permissive
  for delete
  to authenticated
  using (
    public.is_super_admin()
    or (company_id = public.user_company_id() and public.is_admin_or_dispatcher())
  );

commit;
