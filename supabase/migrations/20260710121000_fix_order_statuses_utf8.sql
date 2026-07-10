begin;

-- Use PostgreSQL Unicode escapes here so deployment remains byte-stable across
-- Windows PowerShell, SSH and the Linux database container.
create or replace function public.normalize_company_order_status_key(p_status text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text := lower(btrim(coalesce(p_status, '')));
begin
  if v_value = '' then
    return null;
  end if;

  if v_value in ('feed', 'in_feed', U&'\0412 \043B\0435\043D\0442\0435', U&'\043B\0435\043D\0442\0430') then
    return 'feed';
  end if;
  if v_value in ('new', U&'\041D\043E\0432\044B\0439', U&'\041D\043E\0432\0430\044F') then
    return 'new';
  end if;
  if v_value in ('in_progress', 'progress', 'in progress', U&'\0412 \0440\0430\0431\043E\0442\0435') then
    return 'in_progress';
  end if;
  if v_value in (
    'done',
    'completed',
    'complete',
    U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F',
    U&'\0417\0430\0432\0435\0440\0448\0435\043D\043D\0430\044F',
    U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\044B\0435',
    U&'\0417\0430\0432\0435\0440\0448\0435\043D\043D\044B\0435'
  ) then
    return 'done';
  end if;
  if v_value in ('waiting', 'pending', U&'\0412 \043E\0436\0438\0434\0430\043D\0438\0438') then
    return 'waiting';
  end if;

  return btrim(p_status);
end;
$$;

create or replace function public.companies_apply_order_status_settings()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.use_order_statuses is true and coalesce(old.use_order_statuses, false) is false then
    if new.order_statuses_initialized_at is null then
      perform set_config('app.order_statuses_initializing', '1', true);

      insert into public.company_order_statuses (company_id, status_key, name, is_feed, sort_order)
      values
        (new.id, 'feed', U&'\0412 \043B\0435\043D\0442\0435', true, 0),
        (new.id, 'new', U&'\041D\043E\0432\044B\0439', false, 1),
        (new.id, 'in_progress', U&'\0412 \0440\0430\0431\043E\0442\0435', false, 2),
        (new.id, 'done', U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F', false, 3),
        (new.id, 'waiting', U&'\0412 \043E\0436\0438\0434\0430\043D\0438\0438', false, 4)
      on conflict (company_id, status_key) do nothing;

      new.feed_status_enabled := true;
      new.order_statuses_initialized_at := now();
    end if;

    update public.orders
       set status = public.normalize_company_order_status_key(status)
     where company_id = new.id
       and status is not null;

    update public.orders o
       set status = null
     where o.company_id = new.id
       and o.status is not null
       and not exists (
         select 1
           from public.company_order_statuses s
          where s.company_id = o.company_id
            and s.status_key = o.status
       );
  end if;

  return new;
end;
$$;

update public.company_order_statuses
   set name = case status_key
     when 'feed' then U&'\0412 \043B\0435\043D\0442\0435'
     when 'new' then U&'\041D\043E\0432\044B\0439'
     when 'in_progress' then U&'\0412 \0440\0430\0431\043E\0442\0435'
     when 'done' then U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F'
     when 'waiting' then U&'\0412 \043E\0436\0438\0434\0430\043D\0438\0438'
     else name
   end
 where status_key in ('feed', 'new', 'in_progress', 'done', 'waiting')
   and name ~ '^[?]+$';

create or replace function public.orders_normalize_and_validate_status()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_statuses_enabled boolean;
  v_feed_enabled boolean;
  v_normalized_status text;
begin
  select c.use_order_statuses, c.feed_status_enabled
    into v_statuses_enabled, v_feed_enabled
    from public.companies c
   where c.id = new.company_id
   for key share;

  if not coalesce(v_statuses_enabled, false) then
    if public.normalize_company_order_status_key(new.status) = 'feed' then
      new.status := U&'\041D\043E\0432\044B\0439';
    end if;
    return new;
  end if;

  v_normalized_status := public.normalize_company_order_status_key(new.status);
  if v_normalized_status = 'feed' and not coalesce(v_feed_enabled, false) then
    if exists (
      select 1
        from public.company_order_statuses s
       where s.company_id = new.company_id
         and s.status_key = 'new'
    ) then
      v_normalized_status := 'new';
    else
      new.status := null;
      return new;
    end if;
  end if;
  if v_normalized_status is null then
    new.status := null;
    return new;
  end if;

  perform 1
    from public.company_order_statuses s
   where s.company_id = new.company_id
     and s.status_key = v_normalized_status
   for key share;

  if not found then
    if v_normalized_status = 'new' then
      new.status := null;
      return new;
    end if;
    raise exception 'company_order_status_not_available' using errcode = '23514';
  end if;

  new.status := v_normalized_status;
  return new;
end;
$$;

create or replace function public.tg_orders_set_feed_entered_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in (U&'\0412 \043B\0435\043D\0442\0435', 'feed') then
    if tg_op = 'INSERT' then
      new.feed_entered_at := coalesce(new.feed_entered_at, now());
    elsif old.status is distinct from new.status then
      new.feed_entered_at := now();
    else
      new.feed_entered_at := coalesce(new.feed_entered_at, old.feed_entered_at, now());
    end if;
  elsif tg_op = 'UPDATE' and old.status in (U&'\0412 \043B\0435\043D\0442\0435', 'feed') then
    new.feed_entered_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.orders_sync_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in (U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F', 'done') then
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;
    end if;
    return new;
  end if;

  if new.status in (U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F', 'done') then
    new.completed_at := coalesce(new.completed_at, old.completed_at, now());
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.accept_order(p_order_id uuid)
returns boolean
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_updated integer;
  v_company_id uuid;
  v_statuses_enabled boolean;
  v_next_status text;
begin
  select o.company_id
    into v_company_id
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    return false;
  end if;

  select c.use_order_statuses
    into v_statuses_enabled
    from public.companies c
   where c.id = v_company_id;

  if coalesce(v_statuses_enabled, false) then
    if exists (
      select 1
        from public.company_order_statuses s
       where s.company_id = v_company_id
         and s.status_key = 'in_progress'
         and s.is_feed = false
    ) then
      v_next_status := 'in_progress';
    else
      v_next_status := null;
    end if;
  else
    v_next_status := U&'\0412 \0440\0430\0431\043E\0442\0435';
  end if;

  perform set_config('app.suppress_assigned_notifications', 'true', true);

  update public.orders o
     set assigned_to = auth.uid(),
         status = v_next_status
   where o.id = p_order_id
     and o.assigned_to is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

create or replace function public.tg_orders_enqueue_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id text;
  v_company_id uuid;
  v_transition_key text;
  v_actor_user_id uuid;
  v_creator_user_id uuid;
  v_suppress_assigned_notifications boolean := lower(coalesce(current_setting('app.suppress_assigned_notifications', true), '')) in ('1', 'true', 'yes', 'on');
begin
  v_order_id := new.id::text;
  v_company_id := new.company_id;
  v_transition_key := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  v_actor_user_id := auth.uid();
  v_creator_user_id := coalesce(new.created_by_user_id, v_actor_user_id);

  if tg_op = 'INSERT' then
    if new.status in (U&'\0412 \043B\0435\043D\0442\0435', 'feed') and new.assigned_to is null then
      perform public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        null,
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'feed_new_order',
          'creator_user_id', v_creator_user_id,
          'actor_user_id', v_actor_user_id
        ),
        'feed_new_order:' || v_order_id || ':' || v_transition_key
      );
    elsif new.assigned_to is not null and not v_suppress_assigned_notifications then
      perform public.enqueue_notification_event(
        'assigned_new_order',
        v_company_id,
        v_order_id,
        new.assigned_to,
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'assigned_new_order',
          'actor_user_id', v_actor_user_id,
          'assigned_to_user_id', new.assigned_to
        ),
        'assigned_new_order:' || v_order_id || ':' || new.assigned_to::text || ':' || v_transition_key
      );
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_creator_user_id := coalesce(new.created_by_user_id, old.created_by_user_id, v_actor_user_id);

    if new.assigned_to is distinct from old.assigned_to
       and new.assigned_to is not null
       and not v_suppress_assigned_notifications then
      perform public.enqueue_notification_event(
        'assigned_new_order',
        v_company_id,
        v_order_id,
        new.assigned_to,
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'assigned_new_order',
          'actor_user_id', v_actor_user_id,
          'assigned_to_user_id', new.assigned_to
        ),
        'assigned_new_order:' || v_order_id || ':' || new.assigned_to::text || ':' || v_transition_key
      );
    end if;

    if new.status in (U&'\0412 \043B\0435\043D\0442\0435', 'feed')
       and new.assigned_to is null
       and new.status is distinct from old.status then
      perform public.enqueue_notification_event(
        'feed_new_order',
        v_company_id,
        v_order_id,
        null,
        jsonb_build_object(
          'order_id', v_order_id,
          'event', 'feed_new_order',
          'creator_user_id', v_creator_user_id,
          'actor_user_id', v_actor_user_id,
          'updated_by_user_id', v_actor_user_id
        ),
        'feed_new_order:' || v_order_id || ':' || v_transition_key
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.normalize_company_order_status_key(text) from public, anon;
grant execute on function public.normalize_company_order_status_key(text) to authenticated, service_role;
revoke all on function public.companies_apply_order_status_settings() from public, anon, authenticated;
revoke all on function public.orders_normalize_and_validate_status() from public, anon, authenticated;
revoke all on function public.accept_order(uuid) from public, anon;
grant execute on function public.accept_order(uuid) to authenticated, service_role;

commit;
