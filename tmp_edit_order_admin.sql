CREATE OR REPLACE FUNCTION public.edit_order_admin(p_id uuid, p jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _allowed boolean;
  _row public.orders;
begin
  -- Жёсткая проверка роли: только admin/dispatcher
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','dispatcher')
  ) into _allowed;

  if not _allowed then
    raise exception 'forbidden';
  end if;

  update public.orders o
  set
    title       = coalesce(p->>'title', o.title),
    comment     = coalesce(p->>'comment', o.comment),
    region      = coalesce(p->>'region', o.region),
    city        = coalesce(p->>'city', o.city),
    street      = coalesce(p->>'street', o.street),
    house       = coalesce(p->>'house', o.house),
    fio         = coalesce(p->>'fio', o.fio),
    phone       = coalesce(p->>'phone', o.phone),
    assigned_to = coalesce((p->>'assigned_to')::uuid, o.assigned_to),
    datetime    = coalesce((p->>'datetime')::timestamptz, o.datetime),
    status      = coalesce(p->>'status', o.status),
    urgent      = coalesce((p->>'urgent')::boolean, o.urgent),
    price       = coalesce((p->>'price')::numeric, o.price),
    fuel_cost   = coalesce((p->>'fuel_cost')::numeric, o.fuel_cost)
  where o.id = p_id
  returning * into _row;

  if not found then
    raise exception 'not_found';
  end if;

  return _row;
end;
$function$

