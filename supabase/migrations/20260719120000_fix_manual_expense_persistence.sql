-- Fixed manual expenses are absolute amounts. They must not be capped by the
-- request base price: a request may legitimately have expenses before a price
-- is entered, and expenses may exceed its revenue.
begin;

create or replace function public.recalculate_order_finance_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_entry record;
  v_base_price numeric := 0;
  v_income numeric := 0;
  v_discount numeric := 0;
  v_expense numeric := 0;
  v_manual_expense numeric := 0;
  v_amount numeric := 0;
  v_base_for_calc numeric := 0;
  v_gross_before_discount numeric := 0;
  v_gross_after_discount numeric := 0;
begin
  perform set_config('app.finance_recalc_in_progress', '1', true);

  select *
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    perform set_config('app.finance_recalc_in_progress', '0', true);
    return;
  end if;

  perform public.apply_order_finance_rules(v_order.id);
  v_base_price := coalesce(v_order.start_price, 0);

  for v_entry in
    select e.*
      from public.order_finance_entries e
     where e.order_id = v_order.id
     order by e.sort_order asc, e.created_at asc, e.id asc
  loop
    v_gross_before_discount := v_base_price + v_income;
    v_gross_after_discount := v_gross_before_discount - v_discount;

    case lower(coalesce(v_entry.percent_base, 'base_price'))
      when 'base_price' then v_base_for_calc := coalesce(v_base_price, 0);
      when 'gross_before_discount' then v_base_for_calc := coalesce(v_gross_before_discount, 0);
      when 'gross_after_discount' then v_base_for_calc := coalesce(v_gross_after_discount, 0);
      when 'income_total' then v_base_for_calc := coalesce(v_income, 0);
      else v_base_for_calc := coalesce(v_base_price, 0);
    end case;

    if lower(coalesce(v_entry.calc_mode, 'fixed')) = 'fixed' then
      v_amount := round(coalesce(v_entry.input_amount, 0), 2);
    else
      v_amount := round(
        (greatest(v_base_for_calc, 0) * coalesce(v_entry.input_percent, 0) / 100.0)::numeric,
        2
      );
    end if;

    update public.order_finance_entries
       set calculated_amount = v_amount,
           updated_at = now(),
           updated_by = auth.uid()
     where id = v_entry.id;

    if v_entry.kind = 'income' then
      v_income := v_income + v_amount;
    elsif v_entry.kind = 'discount' then
      v_discount := v_discount + v_amount;
    else
      v_expense := v_expense + v_amount;
      if v_entry.is_system is not true then
        v_manual_expense := v_manual_expense + v_amount;
      end if;
    end if;
  end loop;

  v_gross_after_discount := v_base_price + v_income - v_discount;

  update public.orders o
     set finance_income_total = round(v_income, 2),
         finance_discount_total = round(v_discount, 2),
         finance_expense_total = round(v_manual_expense, 2),
         finance_gross_total = round(v_gross_after_discount, 2),
         finance_net_total = round(v_gross_after_discount - v_manual_expense, 2),
         finance_calculated_at = now()
   where o.id = v_order.id;

  perform set_config('app.finance_recalc_in_progress', '0', true);
exception when others then
  perform set_config('app.finance_recalc_in_progress', '0', true);
  raise;
end;
$function$;

-- A finance row belongs to one request for its entire lifetime. Enforce this
-- in the database as a final guard against stale clients and malformed writes.
create or replace function public.prevent_order_finance_entry_reparenting()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.order_id is distinct from old.order_id
     or new.company_id is distinct from old.company_id then
    raise exception 'Finance entries cannot be moved between requests or companies'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke execute on function public.prevent_order_finance_entry_reparenting()
  from public, anon, authenticated;

drop trigger if exists trg_prevent_order_finance_entry_reparenting
  on public.order_finance_entries;
create trigger trg_prevent_order_finance_entry_reparenting
before update of order_id, company_id
on public.order_finance_entries
for each row
execute function public.prevent_order_finance_entry_reparenting();

-- Restore fixed expenses that were persisted but calculated as zero/capped.
do $backfill$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select distinct e.order_id
      from public.order_finance_entries e
     where lower(coalesce(e.kind, 'expense')) = 'expense'
       and lower(coalesce(e.calc_mode, 'fixed')) = 'fixed'
       and coalesce(e.input_amount, 0) > 0
       and e.calculated_amount is distinct from round(coalesce(e.input_amount, 0), 2)
  loop
    perform public.recalculate_order_finance_totals(v_order_id);
  end loop;
end;
$backfill$;

commit;
