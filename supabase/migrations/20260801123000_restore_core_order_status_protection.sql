begin;

-- Keep the board and the database aligned: system statuses can be displayed,
-- but their identity and presentation are not editable by a company admin.
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

revoke all on function public.company_order_statuses_guard_write() from public, anon, authenticated;

commit;
