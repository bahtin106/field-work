begin;

-- Trashed requests are immutable. Changing the company-wide work-type
-- visibility recalculates finance for every active unlocked request; including
-- a trashed request makes its mutation guard reject the whole settings change.
create or replace function public.trg_recalculate_finance_on_work_types_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_id uuid;
begin
  if old.use_work_types is not distinct from new.use_work_types then
    return new;
  end if;

  for v_order_id in
    select order_row.id
      from public.orders order_row
      left join public.order_finance_snapshots snapshot on snapshot.order_id = order_row.id
     where order_row.company_id = new.id
       and snapshot.locked_at is null
       and not exists (
         select 1
           from public.trash_entries trash_entry
          where trash_entry.entity_type = 'order'
            and trash_entry.entity_id = order_row.id
       )
  loop
    perform public.recalculate_order_finance_v2(v_order_id, true);
  end loop;

  return new;
end;
$$;

comment on function public.trg_recalculate_finance_on_work_types_change() is
  'Recalculates finance when work-type visibility changes; immutable trashed requests are excluded.';

notify pgrst, 'reload schema';

commit;
