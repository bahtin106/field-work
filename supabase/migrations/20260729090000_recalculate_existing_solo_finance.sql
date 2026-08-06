begin;

-- Migration 800 establishes the durable mode before its snapshot trigger is
-- installed. Normalize already existing open solo requests once so they use
-- the same personal-income view as every subsequent recalculation.
do $recalculate_existing_solo_finance$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select order_row.id
      from public.orders order_row
      join public.companies company on company.id = order_row.company_id
      left join public.order_finance_snapshots snapshot on snapshot.order_id = order_row.id
     where company.work_mode = 'solo'
       and snapshot.locked_at is null
  loop
    perform public.recalculate_order_finance_v2(v_order_id, true);
  end loop;
end;
$recalculate_existing_solo_finance$;

commit;
