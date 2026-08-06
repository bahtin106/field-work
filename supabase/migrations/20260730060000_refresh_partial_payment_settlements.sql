-- Orders without payment rows also need to stop using the legacy order-level
-- holder as soon as the company enables per-payment accounting.

do $backfill$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select order_row.id
      from public.orders order_row
      join public.companies company
        on company.id = order_row.company_id
     where company.use_partial_payments is true
  loop
    perform public.refresh_order_finance_settlement_v3(v_order_id);
  end loop;
end;
$backfill$;
