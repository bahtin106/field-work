CREATE OR REPLACE FUNCTION public.fetch_orders_for_date(p_date date)
 RETURNS TABLE(order_json jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT to_jsonb(t)
  FROM public.orders_secure_v2 t
  WHERE DATE(t.time_window_start) = p_date
  ORDER BY t.time_window_start;
$function$

