-- In partial-payment mode orders.payment_status is derived from the customer
-- payment ledger. A direct write used to start a finance recalculation, whose
-- snapshot trigger immediately wrote the ledger-derived value back. Besides
-- reverting the user's write, that produced two opposite audit events.

create or replace function public.refresh_order_customer_payment_state_v1(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_total numeric := 0;
  v_paid numeric := 0;
  v_status text := 'unpaid';
  v_enabled boolean := false;
  v_previous_sync_state text;
begin
  if p_order_id is null then
    return;
  end if;

  select
    company.use_partial_payments,
    greatest(
      coalesce(snapshot.customer_total, order_row.start_price, 0),
      0
    )
    into v_enabled, v_total
    from public.orders order_row
    join public.companies company
      on company.id = order_row.company_id
    left join public.order_finance_snapshots snapshot
      on snapshot.order_id = order_row.id
   where order_row.id = p_order_id;

  if not found or not coalesce(v_enabled, false) then
    return;
  end if;

  select coalesce(sum(payment.amount), 0)
    into v_paid
    from public.order_customer_payments payment
   where payment.order_id = p_order_id;

  v_total := round(greatest(coalesce(v_total, 0), 0), 2);
  v_paid := round(greatest(coalesce(v_paid, 0), 0), 2);
  v_status := case
    when v_paid <= 0 then 'unpaid'
    when v_total <= 0 or v_paid + 0.005 >= v_total then 'paid'
    else 'partial'
  end;

  -- Only this derived-state function may write payment_status while the
  -- company's partial-payment workflow is enabled. Restore the previous
  -- transaction-local value so a later unrelated write is never whitelisted.
  v_previous_sync_state := current_setting(
    'app.customer_payment_status_sync_in_progress',
    true
  );
  perform set_config('app.customer_payment_status_sync_in_progress', '1', true);
  begin
    update public.orders
       set payment_status = v_status,
           updated_at = now()
     where id = p_order_id
       and payment_status is distinct from v_status;
  exception when others then
    perform set_config(
      'app.customer_payment_status_sync_in_progress',
      coalesce(v_previous_sync_state, ''),
      true
    );
    raise;
  end;
  perform set_config(
    'app.customer_payment_status_sync_in_progress',
    coalesce(v_previous_sync_state, ''),
    true
  );
end;
$$;

create or replace function public.guard_derived_order_payment_status_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.payment_status is distinct from new.payment_status
     and coalesce(
       current_setting('app.customer_payment_status_sync_in_progress', true),
       ''
     ) <> '1'
     and exists (
       select 1
         from public.companies company
        where company.id = new.company_id
          and company.use_partial_payments is true
     ) then
    raise exception 'payment_status_managed_by_customer_payments'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_guard_derived_payment_status on public.orders;
create trigger trg_orders_guard_derived_payment_status
before update of payment_status on public.orders
for each row execute function public.guard_derived_order_payment_status_v1();

revoke all on function public.guard_derived_order_payment_status_v1()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
