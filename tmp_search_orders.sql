CREATE OR REPLACE FUNCTION public.search_orders(p_query text, p_company_id uuid, p_status text, p_work_type_ids text[], p_include_feed boolean, p_limit integer, p_offset integer)
 RETURNS SETOF orders_secure_v2
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.*
    from public.orders_secure_v2 v
   where (p_company_id is null or v.company_id = p_company_id)
     and (
       nullif(trim(coalesce(p_status, '')), '') is null
       or v.status = p_status
     )
     and (
       p_work_type_ids is null
       or cardinality(p_work_type_ids) = 0
       or v.work_type_id::text = any (p_work_type_ids)
     )
     and (
       coalesce(p_include_feed, true)
       or v.assigned_to is not null
     )
     and (
       nullif(trim(coalesce(p_query, '')), '') is null
       or to_jsonb(v)::text ilike '%' || trim(p_query) || '%'
     )
   order by coalesce(v.time_window_start, v.created_at) desc nulls last
   limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$function$

