begin;

-- Trashed requests are immutable. When a company leaves only one payment
-- method enabled, normalize active unlocked requests only; attempting to
-- update a trashed request makes the trash guard reject the whole settings
-- change.
create or replace function public.trg_normalize_payment_methods_on_company_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_single_payment_method text;
begin
  if old.payment_method_cash_enabled is not distinct from new.payment_method_cash_enabled
     and old.payment_method_cashless_enabled is not distinct from new.payment_method_cashless_enabled then
    return new;
  end if;

  v_single_payment_method := case
    when new.payment_method_cash_enabled and not new.payment_method_cashless_enabled then 'cash'
    when new.payment_method_cashless_enabled and not new.payment_method_cash_enabled then 'cashless'
    else null
  end;

  if v_single_payment_method is not null then
    update public.orders order_row
       set payment_method = v_single_payment_method
     where order_row.company_id = new.id
       and order_row.payment_method is distinct from v_single_payment_method
       and not exists (
         select 1
           from public.trash_entries trash_entry
          where trash_entry.entity_type = 'order'
            and trash_entry.entity_id = order_row.id
       )
       and not exists (
         select 1
           from public.order_finance_snapshots snapshot
          where snapshot.order_id = order_row.id
            and snapshot.locked_at is not null
       );
  end if;

  return new;
end;
$$;

comment on function public.trg_normalize_payment_methods_on_company_change() is
  'Normalizes the payment method of active unlocked requests when company payment-method availability changes; immutable trashed requests are excluded.';

notify pgrst, 'reload schema';

commit;
