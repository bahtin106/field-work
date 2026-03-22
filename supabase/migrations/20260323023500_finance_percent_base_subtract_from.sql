begin;

update public.company_finance_rules
   set percent_base = 'gross_after_discount'
 where percent_base = 'net_before_expense';

update public.order_finance_entries
   set percent_base = 'gross_after_discount'
 where percent_base = 'net_before_expense';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'company_finance_rules_percent_base_check'
      and conrelid = 'public.company_finance_rules'::regclass
  ) then
    alter table public.company_finance_rules
      drop constraint company_finance_rules_percent_base_check;
  end if;

  alter table public.company_finance_rules
    add constraint company_finance_rules_percent_base_check
    check (percent_base in ('base_price', 'gross_before_discount', 'gross_after_discount', 'income_total'));
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'order_finance_entries_percent_base_check'
      and conrelid = 'public.order_finance_entries'::regclass
  ) then
    alter table public.order_finance_entries
      drop constraint order_finance_entries_percent_base_check;
  end if;

  alter table public.order_finance_entries
    add constraint order_finance_entries_percent_base_check
    check (percent_base in ('base_price', 'gross_before_discount', 'gross_after_discount', 'income_total'));
end
$$;

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
  v_amount numeric := 0;
  v_gross_before_discount numeric := 0;
  v_gross_after_discount numeric := 0;
  v_net_before_expense numeric := 0;
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

  v_base_price := coalesce(v_order.price, 0);

  for v_entry in
    select e.*
      from public.order_finance_entries e
     where e.order_id = v_order.id
     order by e.sort_order asc, e.created_at asc, e.id asc
  loop
    v_gross_before_discount := v_base_price + v_income;
    v_gross_after_discount := v_gross_before_discount - v_discount;
    v_net_before_expense := v_gross_after_discount - v_expense;

    if lower(coalesce(v_entry.calc_mode, 'fixed')) = 'percent'
       and lower(coalesce(v_entry.percent_base, '')) = 'income_total' then
      v_amount := round((coalesce(v_income, 0) * coalesce(v_entry.input_percent, 0) / 100.0)::numeric, 2);
    else
      v_amount := public.finance_compute_amount(
        v_entry.calc_mode,
        v_entry.input_amount,
        v_entry.input_percent,
        v_entry.percent_base,
        v_base_price,
        v_gross_before_discount,
        v_gross_after_discount,
        v_net_before_expense
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
    end if;
  end loop;

  v_gross_after_discount := (v_base_price + v_income - v_discount);

  update public.orders o
     set finance_income_total = round(v_income, 2),
         finance_discount_total = round(v_discount, 2),
         finance_expense_total = round(v_expense, 2),
         finance_gross_total = round(v_gross_after_discount, 2),
         finance_net_total = round(v_gross_after_discount - v_expense, 2),
         finance_calculated_at = now()
   where o.id = v_order.id;

  perform set_config('app.finance_recalc_in_progress', '0', true);
end;
$function$;

commit;