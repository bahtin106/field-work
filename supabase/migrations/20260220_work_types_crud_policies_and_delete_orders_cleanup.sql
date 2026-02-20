-- Restore full CRUD access for work_types settings and keep orders consistent on delete.

alter table if exists public.work_types enable row level security;

drop policy if exists work_types_select_admins on public.work_types;
create policy work_types_select_admins
  on public.work_types
  for select
  to authenticated
  using ((company_id = user_company_id()) and is_admin_or_dispatcher());

drop policy if exists work_types_insert_admins on public.work_types;
create policy work_types_insert_admins
  on public.work_types
  for insert
  to authenticated
  with check ((company_id = user_company_id()) and is_admin_or_dispatcher());

drop policy if exists work_types_update_admins on public.work_types;
create policy work_types_update_admins
  on public.work_types
  for update
  to authenticated
  using ((company_id = user_company_id()) and is_admin_or_dispatcher())
  with check ((company_id = user_company_id()) and is_admin_or_dispatcher());

drop policy if exists work_types_delete_admins on public.work_types;
create policy work_types_delete_admins
  on public.work_types
  for delete
  to authenticated
  using ((company_id = user_company_id()) and is_admin_or_dispatcher());

create or replace function public.work_types_before_delete_nullify_orders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set work_type_id = null
   where company_id = old.company_id
     and work_type_id = old.id;
  return old;
end;
$$;

drop trigger if exists work_types_before_delete_nullify_orders_trg on public.work_types;
create trigger work_types_before_delete_nullify_orders_trg
before delete on public.work_types
for each row
execute function public.work_types_before_delete_nullify_orders();
