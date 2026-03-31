begin;

-- Principle of least privilege for public API roles.
revoke all on table public.orders from anon;
revoke all on table public.orders from authenticated;
revoke all on table public.orders from service_role;
grant select, insert, update, delete on table public.orders to authenticated;
grant select, insert, update, delete on table public.orders to service_role;

-- Remove legacy broad/duplicate policies that weaken company boundary.
drop policy if exists "Workers can view assigned orders" on public.orders;
drop policy if exists "Workers can update assigned orders" on public.orders;
drop policy if exists orders_select_admin_all on public.orders;

-- Normalize media_file_5 to match other media array columns.
update public.orders
set media_file_5 = '{}'::text[]
where media_file_5 is null;

alter table public.orders
  alter column media_file_5 set default '{}'::text[],
  alter column media_file_5 set not null;

commit;