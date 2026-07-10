begin;

alter table public.companies
  add column if not exists use_order_statuses boolean not null default false,
  add column if not exists feed_status_enabled boolean not null default false,
  add column if not exists order_statuses_initialized_at timestamptz;

create table if not exists public.company_order_statuses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  status_key text not null default ('custom_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  is_feed boolean not null default false,
  sort_order smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_order_statuses_name_check check (char_length(btrim(name)) between 1 and 64),
  constraint company_order_statuses_sort_order_check check (sort_order between 0 and 10),
  constraint company_order_statuses_key_check check (
    (is_feed and status_key = 'feed')
    or (
      not is_feed
      and (
        status_key in ('new', 'in_progress', 'done', 'waiting')
        or status_key ~ '^custom_[0-9a-f]{32}$'
      )
    )
  ),
  constraint company_order_statuses_company_key_unique unique (company_id, status_key)
);

create unique index if not exists company_order_statuses_company_name_unique
  on public.company_order_statuses (company_id, lower(btrim(name)));

create index if not exists company_order_statuses_company_sort_idx
  on public.company_order_statuses (company_id, is_feed desc, sort_order, created_at);

alter table public.company_order_statuses enable row level security;

drop policy if exists company_order_statuses_select on public.company_order_statuses;
create policy company_order_statuses_select
on public.company_order_statuses
for select
to authenticated
using (company_id = public.user_company_id() or public.is_super_admin());

drop policy if exists company_order_statuses_insert on public.company_order_statuses;
create policy company_order_statuses_insert
on public.company_order_statuses
for insert
to authenticated
with check (
  public.is_super_admin()
  or (company_id = public.user_company_id() and public.is_admin())
);

drop policy if exists company_order_statuses_update on public.company_order_statuses;
create policy company_order_statuses_update
on public.company_order_statuses
for update
to authenticated
using (
  public.is_super_admin()
  or (company_id = public.user_company_id() and public.is_admin())
)
with check (
  public.is_super_admin()
  or (company_id = public.user_company_id() and public.is_admin())
);

drop policy if exists company_order_statuses_delete on public.company_order_statuses;
create policy company_order_statuses_delete
on public.company_order_statuses
for delete
to authenticated
using (
  public.is_super_admin()
  or (company_id = public.user_company_id() and public.is_admin())
);

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

  if v_value in ('feed', 'in_feed', 'в ленте', 'лента') then
    return 'feed';
  end if;
  if v_value in ('new', 'новый', 'новая') then
    return 'new';
  end if;
  if v_value in ('in_progress', 'progress', 'in progress', 'в работе') then
    return 'in_progress';
  end if;
  if v_value in ('done', 'completed', 'complete', 'завершённая', 'завершенная', 'завершённые', 'завершенные') then
    return 'done';
  end if;
  if v_value in ('waiting', 'pending', 'в ожидании') then
    return 'waiting';
  end if;

  return btrim(p_status);
end;
$$;

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
  if old.is_feed then
    raise exception 'feed_status_is_immutable' using errcode = '23514';
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

drop trigger if exists trg_company_order_statuses_guard_write on public.company_order_statuses;
create trigger trg_company_order_statuses_guard_write
before insert or update on public.company_order_statuses
for each row
execute function public.company_order_statuses_guard_write();

drop trigger if exists trg_company_order_statuses_before_delete on public.company_order_statuses;
create trigger trg_company_order_statuses_before_delete
before delete on public.company_order_statuses
for each row
execute function public.company_order_statuses_before_delete();

drop trigger if exists trg_company_order_statuses_set_updated_at on public.company_order_statuses;
create trigger trg_company_order_statuses_set_updated_at
before update on public.company_order_statuses
for each row
execute function public.tg_set_updated_at();

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
        (new.id, 'feed', 'В ленте', true, 0),
        (new.id, 'new', 'Новый', false, 1),
        (new.id, 'in_progress', 'В работе', false, 2),
        (new.id, 'done', 'Завершённая', false, 3),
        (new.id, 'waiting', 'В ожидании', false, 4)
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

drop trigger if exists trg_companies_apply_order_status_settings on public.companies;
create trigger trg_companies_apply_order_status_settings
before update of use_order_statuses on public.companies
for each row
execute function public.companies_apply_order_status_settings();

alter table public.orders drop constraint if exists status_check;

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
    -- A disabled status system has no visible feed. Incoming bot requests must
    -- remain discoverable in the ordinary request list.
    if public.normalize_company_order_status_key(new.status) = 'feed' then
      new.status := 'Новый';
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
    -- Older clients and integrations still create a default "New" request.
    -- If that status was intentionally deleted, preserve the request without one.
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

create or replace function public.get_company_order_status_usage(p_status_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_company_id uuid;
begin
  select s.company_id
    into v_company_id
    from public.company_order_statuses s
   where s.id = p_status_id;

  if not found then
    return 0;
  end if;

  if not public.is_super_admin()
     and (v_company_id <> public.user_company_id() or not public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return (
    select count(*)::integer
      from public.orders o
     where o.company_id = v_company_id
       and o.status = (
         select s.status_key
           from public.company_order_statuses s
          where s.id = p_status_id
       )
  );
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

  if v_has_orders and v_replacement_key is not null then
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

drop trigger if exists trg_orders_normalize_and_validate_status on public.orders;
create trigger trg_orders_normalize_and_validate_status
before insert or update of status, company_id on public.orders
for each row
execute function public.orders_normalize_and_validate_status();

create or replace function public.tg_orders_set_feed_entered_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('В ленте', 'feed') then
    if tg_op = 'INSERT' then
      new.feed_entered_at := coalesce(new.feed_entered_at, now());
    elsif old.status is distinct from new.status then
      new.feed_entered_at := now();
    else
      new.feed_entered_at := coalesce(new.feed_entered_at, old.feed_entered_at, now());
    end if;
  elsif tg_op = 'UPDATE' and old.status in ('В ленте', 'feed') then
    new.feed_entered_at := null;
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
    v_next_status := 'В работе';
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

create or replace function public.orders_sync_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('Завершённая', 'done') then
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;
    end if;
    return new;
  end if;

  if new.status in ('Завершённая', 'done') then
    new.completed_at := coalesce(new.completed_at, old.completed_at, now());
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

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
    if new.status in ('В ленте', 'feed') and new.assigned_to is null then
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

    if new.status in ('В ленте', 'feed')
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
revoke all on function public.company_order_statuses_guard_write() from public, anon, authenticated;
revoke all on function public.company_order_statuses_before_delete() from public, anon, authenticated;
revoke all on function public.companies_apply_order_status_settings() from public, anon, authenticated;
revoke all on function public.orders_normalize_and_validate_status() from public, anon, authenticated;
revoke all on function public.accept_order(uuid) from public, anon;
grant execute on function public.accept_order(uuid) to authenticated, service_role;
revoke all on function public.get_company_order_status_usage(uuid) from public, anon;
grant execute on function public.get_company_order_status_usage(uuid) to authenticated, service_role;
revoke all on function public.delete_company_order_status(uuid, text) from public, anon;
grant execute on function public.delete_company_order_status(uuid, text) to authenticated, service_role;

commit;
