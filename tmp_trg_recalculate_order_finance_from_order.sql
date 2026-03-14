CREATE OR REPLACE FUNCTION public.trg_recalculate_order_finance_from_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_setting('app.finance_recalc_in_progress', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.recalculate_order_finance_totals(new.id);
    return new;
  end if;

  if (
    coalesce(new.price, 0) is distinct from coalesce(old.price, 0)
    or coalesce(new.fuel_cost, 0) is distinct from coalesce(old.fuel_cost, 0)
    or coalesce(new.assigned_to::text, '') is distinct from coalesce(old.assigned_to::text, '')
    or coalesce(new.company_id::text, '') is distinct from coalesce(old.company_id::text, '')
  ) then
    perform public.recalculate_order_finance_totals(new.id);
  end if;

  return new;
end;
$function$

