begin;

-- `new` and `done` have system meaning: new work starts in `new`, while
-- `done` records completed_at and freezes the finance snapshot. Their display
-- properties must not be changed or removed by a company administrator.
create or replace function public.company_order_statuses_guard_write()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_statuses_enabled boolean;
  v_regular_count integer;
begin
  if tg_op = 'INSERT' then
    select c.use_order_statuses
      into v_statuses_enabled
      from public.companies c
     where c.id = new.company_id
     for update;

    if not found then
      raise exception 'company_not_found' using errcode = '23503';
    end if;

    if not coalesce(v_statuses_enabled, false)
       and coalesce(current_setting('app.order_statuses_initializing', true), '') <> '1' then
      raise exception 'order_statuses_disabled' using errcode = '23514';
    end if;

    new.name := btrim(new.name);
    new.status_key := btrim(new.status_key);

    if new.is_feed then
      if new.status_key <> 'feed' then
        raise exception 'feed_status_key_is_reserved' using errcode = '23514';
      end if;
      new.sort_order := 0;
    else
      if new.status_key = 'feed' then
        raise exception 'feed_status_key_is_reserved' using errcode = '23514';
      end if;

      select count(*)
        into v_regular_count
        from public.company_order_statuses s
       where s.company_id = new.company_id
         and s.is_feed = false;

      if v_regular_count >= 10 then
        raise exception 'company_order_statuses_limit_reached' using errcode = '23514';
      end if;
    end if;

    return new;
  end if;

  select c.use_order_statuses
    into v_statuses_enabled
    from public.companies c
   where c.id = old.company_id
   for key share;

  if not coalesce(v_statuses_enabled, false) then
    raise exception 'order_statuses_disabled' using errcode = '23514';
  end if;

  if old.is_feed then
    if new.is_feed is distinct from old.is_feed
       or new.status_key is distinct from old.status_key
       or new.name is distinct from old.name
       or new.sort_order is distinct from old.sort_order then
      raise exception 'feed_status_is_immutable' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.company_id is distinct from old.company_id
     or new.status_key is distinct from old.status_key
     or new.is_feed is distinct from old.is_feed then
    raise exception 'company_order_status_identity_is_immutable' using errcode = '23514';
  end if;

  if old.status_key in ('new', 'done')
     and (
       new.name is distinct from old.name
       or new.color is distinct from old.color
       or new.sort_order is distinct from old.sort_order
     ) then
    raise exception 'core_order_status_is_immutable' using errcode = '23514';
  end if;

  new.name := btrim(new.name);
  return new;
end;
$$;

create or replace function public.company_order_statuses_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_has_orders boolean;
begin
  if old.is_feed
     and coalesce(current_setting('app.company_deletion_in_progress', true), '') <> '1' then
    raise exception 'feed_status_is_immutable' using errcode = '23514';
  end if;

  if old.status_key in ('new', 'done')
     and coalesce(current_setting('app.company_deletion_in_progress', true), '') <> '1' then
    raise exception 'core_order_status_is_immutable' using errcode = '23514';
  end if;

  select exists (
    select 1
      from public.orders o
     where o.company_id = old.company_id
       and o.status = old.status_key
     for update
  )
    into v_has_orders;

  if v_has_orders
     and coalesce(current_setting('app.order_statuses_delete_in_progress', true), '') <> '1' then
    raise exception 'company_order_status_replacement_required' using errcode = '23514';
  end if;

  return old;
end;
$$;

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

  if v_status.status_key in ('new', 'done') then
    raise exception 'core_order_status_is_immutable' using errcode = '23514';
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
