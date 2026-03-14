CREATE OR REPLACE FUNCTION public.get_finance_stats(p_from timestamp with time zone, p_to timestamp with time zone, p_executor uuid DEFAULT NULL::uuid)
 RETURNS TABLE(bucket text, orders_count bigint, total_price numeric, total_fuel_cost numeric, net_income numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  urole text;
begin
  select role into urole from public.profiles where id = uid;

  if urole is null then
    raise exception 'No profile/role for current user';
  end if;

  -- Базовый набор заявок с фильтрами по дате
  -- (если p_from/p_to = null, берём без ограничений по соответствующей границе)
  return query
  with base as (
    select
      o.status,
      coalesce(o.price, 0)::numeric as price,
      coalesce(o.fuel_cost, 0)::numeric as fuel_cost
    from public.orders o
    where
      (p_from is null or o.datetime >= p_from) and
      (p_to   is null or o.datetime <  p_to)   and
      (
        -- admin/dispatcher: всё, опционально фильтр по исполнителю
        (urole in ('admin','dispatcher') and (p_executor is null or o.assigned_to = p_executor))
        -- worker: только свои заявки
        or (urole = 'worker' and o.assigned_to = uid)
      )
  )
  select
    coalesce(status, 'ALL') as bucket,
    count(*)::bigint as orders_count,
    sum(price) as total_price,
    sum(fuel_cost) as total_fuel_cost,
    sum(price - fuel_cost) as net_income
  from base
  group by rollup(status)
  order by case when status is null then 1 else 0 end, status;
end;
$function$

