CREATE OR REPLACE FUNCTION public.recalculate_order_finance_totals(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_entry record;
  v_base_price numeric := 0;
  v_fuel_cost numeric := 0;
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
  v_fuel_cost := coalesce(v_order.fuel_cost, 0);

  for v_entry in
    select e.*
      from public.order_finance_entries e
     where e.order_id = v_order.id
     order by e.sort_order asc, e.created_at asc, e.id asc
  loop
    v_gross_before_discount := v_base_price + v_income;
    v_gross_after_discount := v_gross_before_discount - v_discount;
    v_net_before_expense := v_gross_after_discount - v_fuel_cost - v_expense;

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
         finance_expense_total = round(v_expense + v_fuel_cost, 2),
         finance_gross_total = round(v_gross_after_discount, 2),
         finance_net_total = round(v_gross_after_discount - (v_expense + v_fuel_cost), 2),
         finance_calculated_at = now()
   where o.id = v_order.id;

  perform set_config('app.finance_recalc_in_progress', '0', true);
end;
$function$

