BEGIN;

create or replace function public.normalize_orders_for_solo_mode(
  p_company_id uuid,
  p_admin_user_id uuid,
  p_silent_notifications boolean default true
)
returns table(
  reassigned_count integer,
  feed_to_new_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reassigned integer := 0;
  v_feed_to_new integer := 0;
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

  with target as (
    select
      o.id,
      (o.assigned_to is distinct from p_admin_user_id) as need_reassign,
      (o.status = 'В ленте') as need_feed_to_new
    from public.orders o
    where o.company_id = p_company_id
      and (
        o.assigned_to is distinct from p_admin_user_id
        or o.status = 'В ленте'
      )
  ),
  upd as (
    update public.orders o
    set
      assigned_to = p_admin_user_id,
      status = case
        when o.status = 'В ленте' then 'Новый'
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

  return query
  select v_reassigned, v_feed_to_new;
end;
$$;

revoke all on function public.normalize_orders_for_solo_mode(uuid, uuid, boolean) from public;
grant execute on function public.normalize_orders_for_solo_mode(uuid, uuid, boolean) to authenticated;
grant execute on function public.normalize_orders_for_solo_mode(uuid, uuid, boolean) to service_role;

COMMIT;

