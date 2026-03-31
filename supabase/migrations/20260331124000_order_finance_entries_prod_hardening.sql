begin;

-- 1) Tighten grants: no anonymous direct access.
revoke all on table public.order_finance_entries from anon;
revoke all on table public.order_finance_entries from authenticated;
revoke all on table public.order_finance_entries from service_role;

grant select, insert, update, delete on table public.order_finance_entries to authenticated;
grant select, insert, update, delete on table public.order_finance_entries to service_role;

drop policy if exists order_finance_entries_service_role_all on public.order_finance_entries;
create policy order_finance_entries_service_role_all
on public.order_finance_entries
for all
to service_role
using (true)
with check (true);

-- 2) Normalize legacy mixed-mode rows before strict consistency checks.
update public.order_finance_entries
set
  input_percent = 0
where calc_mode = 'fixed'
  and input_percent <> 0;

update public.order_finance_entries
set
  input_amount = 0
where calc_mode = 'percent'
  and input_amount <> 0;

-- 3) Integrity constraints for stable finance semantics.
alter table public.order_finance_entries
  drop constraint if exists order_finance_entries_title_nonempty_check,
  drop constraint if exists order_finance_entries_sort_order_nonnegative_check,
  drop constraint if exists order_finance_entries_input_percent_max_check,
  drop constraint if exists order_finance_entries_created_by_fkey,
  drop constraint if exists order_finance_entries_updated_by_fkey;

alter table public.order_finance_entries
  add constraint order_finance_entries_title_nonempty_check
    check (btrim(title) <> ''),
  add constraint order_finance_entries_sort_order_nonnegative_check
    check (sort_order >= 0),
  add constraint order_finance_entries_input_percent_max_check
    check (input_percent <= 100),
  add constraint order_finance_entries_created_by_fkey
    foreign key (created_by)
    references public.profiles(id)
    on delete set null,
  add constraint order_finance_entries_updated_by_fkey
    foreign key (updated_by)
    references public.profiles(id)
    on delete set null;

commit;
