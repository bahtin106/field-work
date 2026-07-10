begin;

create or replace function public.delete_company_order_status(
  p_status_id uuid,
  p_replacement_status_key text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_status public.company_order_statuses%rowtype;
  v_replacement_key text := nullif(btrim(coalesce(p_replacement_status_key, '')), '');
  v_has_orders boolean;
begin
  if p_status_id is null then
    raise exception 'status_id_required' using errcode = '22023';
  end if;

  select *
    into v_status
    from public.company_order_statuses s
   where s.id = p_status_id
   for update;

  if not found then
    return;
  end if;

  if not public.is_super_admin()
     and (v_status.company_id <> public.user_company_id() or not public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_status.is_feed then
    raise exception 'feed_status_is_immutable' using errcode = '23514';
  end if;

  perform 1
    from public.companies c
   where c.id = v_status.company_id
   for update;

  select exists (
    select 1
      from public.orders o
     where o.company_id = v_status.company_id
       and o.status = v_status.status_key
     for update
  )
    into v_has_orders;

  if v_has_orders and v_replacement_key is null then
    raise exception 'company_order_status_replacement_required' using errcode = '23514';
  end if;

  if v_has_orders then
    perform 1
      from public.company_order_statuses s
     where s.company_id = v_status.company_id
       and s.status_key = v_replacement_key
       and s.id <> v_status.id
       and s.is_feed = false
     for key share;

    if not found then
      raise exception 'replacement_status_not_available' using errcode = '23514';
    end if;
  end if;

  perform set_config('app.order_statuses_delete_in_progress', '1', true);

  if v_has_orders then
    update public.orders
       set status = v_replacement_key
     where company_id = v_status.company_id
       and status = v_status.status_key;
  end if;

  delete from public.company_order_statuses
   where id = v_status.id;
end;
$$;

revoke all on function public.delete_company_order_status(uuid, text) from public, anon;
grant execute on function public.delete_company_order_status(uuid, text) to authenticated, service_role;

commit;
