-- A company using the simple payment workflow must never expose the internal
-- "partial" state.  Normalize rows created before the optional-mode setting
-- was introduced and protect future writes from stale clients.

update public.orders order_row
   set payment_status = 'unpaid',
       updated_at = now()
  from public.companies company
 where company.id = order_row.company_id
   and company.use_partial_payments is false
   and order_row.payment_status = 'partial';

create or replace function public.normalize_order_payment_status_for_company_mode()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_partial_payments_enabled boolean := false;
begin
  if lower(coalesce(new.payment_status, 'unpaid')) <> 'partial' then
    return new;
  end if;

  select company.use_partial_payments
    into v_partial_payments_enabled
    from public.companies company
   where company.id = new.company_id;

  if not coalesce(v_partial_payments_enabled, false) then
    new.payment_status := 'unpaid';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_normalize_payment_status_for_mode
  on public.orders;
create trigger trg_orders_normalize_payment_status_for_mode
before insert or update of company_id, payment_status
on public.orders
for each row execute function public.normalize_order_payment_status_for_company_mode();

notify pgrst, 'reload schema';
