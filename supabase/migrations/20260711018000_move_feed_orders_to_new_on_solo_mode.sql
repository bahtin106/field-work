create or replace function public.normalize_orders_for_solo_mode(
  p_company_id uuid,
  p_admin_user_id uuid,
  p_silent_notifications boolean default true
)
returns table(reassigned_count integer, feed_to_new_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reassigned integer := 0;
  v_feed_to_new integer := 0;
  v_statuses_enabled boolean := false;
begin
  if p_company_id is null then
    raise exception 'p_company_id is required' using errcode = '22023';
  end if;

  if p_admin_user_id is null then
    raise exception 'p_admin_user_id is required' using errcode = '22023';
  end if;

  if p_silent_notifications then
    perform set_config('app.suppress_assigned_notifications', 'on', true);
  end if;

  select c.use_order_statuses
    into v_statuses_enabled
    from public.companies c
   where c.id = p_company_id
   for key share;

  with target as (
    select
      o.id,
      (o.assigned_to is distinct from p_admin_user_id) as need_reassign,
      (public.normalize_company_order_status_key(o.status) = 'feed') as need_feed_to_new
    from public.orders o
    where o.company_id = p_company_id
      and (
        o.assigned_to is distinct from p_admin_user_id
        or public.normalize_company_order_status_key(o.status) = 'feed'
      )
  ),
  upd as (
    update public.orders o
    set
      assigned_to = p_admin_user_id,
      status = case
        when t.need_feed_to_new and coalesce(v_statuses_enabled, false) then 'new'
        when t.need_feed_to_new then U&'\041D\043E\0432\044B\0439'
        else o.status
      end
    from target t
    where o.id = t.id
    returning t.need_reassign, t.need_feed_to_new
  )
  select
    coalesce(sum(case when need_reassign then 1 else 0 end), 0),
    coalesce(sum(case when need_feed_to_new then 1 else 0 end), 0)
  into v_reassigned, v_feed_to_new
  from upd;

  return query select v_reassigned, v_feed_to_new;
end;
$$;

revoke all on function public.normalize_orders_for_solo_mode(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.normalize_orders_for_solo_mode(uuid, uuid, boolean) to service_role;
