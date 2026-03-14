CREATE OR REPLACE FUNCTION public.calc_order_payout(p_order_id uuid)
 RETURNS TABLE(order_id uuid, assigned_to uuid, company_id uuid, price numeric, fuel_cost numeric, payout numeric, reimburse_fuel boolean, rule_source text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_company uuid;
  v_user uuid;
  v_price numeric;
  v_fuel numeric;
  v_method text;
  v_percent numeric;
  v_fixed numeric;
  v_reimburse boolean;
  v_src text := 'none';
begin
  select o.company_id, o.assigned_to, coalesce(o.price,0), coalesce(o.fuel_cost,0)
    into v_company, v_user, v_price, v_fuel
  from public.orders o
  where o.id = p_order_id;

  if v_company is null then
    return query select p_order_id, v_user, v_company, v_price, v_fuel, null::numeric, null::boolean, v_src;
    return;
  end if;

  -- 5.1 пытаемся найти активный персональный оверрайд
  select method, percent, fixed_amount, coalesce(reimburse_fuel, true), 'override'
    into v_method, v_percent, v_fixed, v_reimburse, v_src
  from public.compensation_overrides
  where company_id = v_company
    and user_id = v_user
    and is_active = true
    and current_date between active_from and coalesce(active_to, current_date + interval '100 years')
  limit 1;

  -- 5.2 если нет оверрайда — берём активное правило компании
  if v_method is null then
    select method, percent, fixed_amount, reimburse_fuel, 'company'
      into v_method, v_percent, v_fixed, v_reimburse, v_src
    from public.compensation_rules
    where company_id = v_company
      and is_active = true
      and current_date between active_from and coalesce(active_to, current_date + interval '100 years')
    order by created_at desc
    limit 1;
  end if;

  -- 5.3 считаем выплату
  -- Примечание: ГСМ не вычитаем из payout; если reimburse_fuel=true — это отдельная компенсация.
  -- При желании поменяем логику позже.
  return query
  select
    p_order_id,
    v_user,
    v_company,
    v_price,
    v_fuel,
    case v_method
      when 'percent' then round((coalesce(v_percent,0) / 100.0) * v_price, 2)
      when 'fixed' then coalesce(v_fixed,0)
      when 'percent_plus_fixed' then round((coalesce(v_percent,0) / 100.0) * v_price + coalesce(v_fixed,0), 2)
      else null::numeric
    end as payout,
    coalesce(v_reimburse, true) as reimburse_fuel,
    v_src;
end;
$function$

