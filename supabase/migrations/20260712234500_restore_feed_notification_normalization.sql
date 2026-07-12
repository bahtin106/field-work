begin;

create or replace function public.tg_orders_set_feed_entered_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_is_feed boolean;
  v_old_is_feed boolean := false;
begin
  v_new_is_feed :=
    public.normalize_company_order_status_key(new.status) = 'feed'
    and new.assigned_to is null;

  if tg_op = 'UPDATE' then
    v_old_is_feed :=
      public.normalize_company_order_status_key(old.status) = 'feed'
      and old.assigned_to is null;
  end if;

  if v_new_is_feed then
    if tg_op = 'INSERT' or not v_old_is_feed then
      new.feed_entered_at := now();
    else
      new.feed_entered_at := coalesce(new.feed_entered_at, old.feed_entered_at, now());
    end if;
  else
    new.feed_entered_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_set_feed_entered_at on public.orders;
create trigger trg_orders_set_feed_entered_at
before insert or update of status, assigned_to on public.orders
for each row
execute function public.tg_orders_set_feed_entered_at();

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
  v_new_status_key text;
  v_old_status_key text;
  v_suppress_assigned_notifications boolean := lower(coalesce(current_setting('app.suppress_assigned_notifications', true), '')) in ('1', 'true', 'yes', 'on');
begin
  v_order_id := new.id::text;
  v_company_id := new.company_id;
  v_transition_key := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  v_actor_user_id := auth.uid();
  v_creator_user_id := coalesce(new.created_by_user_id, v_actor_user_id);
  v_new_status_key := public.normalize_company_order_status_key(new.status);

  if tg_op = 'INSERT' then
    if v_new_status_key = 'feed' and new.assigned_to is null then
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

  v_creator_user_id := coalesce(new.created_by_user_id, old.created_by_user_id, v_actor_user_id);
  v_old_status_key := public.normalize_company_order_status_key(old.status);

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

  if v_new_status_key = 'feed'
     and new.assigned_to is null
     and (v_old_status_key is distinct from 'feed' or old.assigned_to is not null) then
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

  return new;
end;
$$;

create or replace function public.enqueue_stale_feed_reminders(p_delay interval default '00:20:00'::interval)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_default_delay_minutes integer :=
    greatest(1, least(43200, coalesce(floor(extract(epoch from p_delay) / 60)::integer, 20)));
begin
  if to_regclass('public.orders') is null then
    return 0;
  end if;

  with candidates as (
    select
      o.id::text as order_id,
      o.company_id,
      coalesce(o.feed_entered_at, o.updated_at, o.created_at, now()) as feed_since_ts,
      coalesce(
        o.created_by_user_id,
        case
          when (to_jsonb(o)->>'created_by') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (to_jsonb(o)->>'created_by')::uuid
          when (to_jsonb(o)->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (to_jsonb(o)->>'user_id')::uuid
          when (to_jsonb(o)->>'owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (to_jsonb(o)->>'owner_id')::uuid
          else null
        end
      ) as raw_creator_user_id
    from public.orders o
    where public.normalize_company_order_status_key(o.status) = 'feed'
      and o.assigned_to is null
  ),
  candidates_with_recipient as (
    select
      c.order_id,
      c.company_id,
      c.feed_since_ts,
      coalesce(creator_profile.id, fallback_admin.id) as recipient_user_id,
      creator_profile.id is null as fallback_to_admin
    from candidates c
    left join public.profiles creator_profile
      on creator_profile.id = c.raw_creator_user_id
     and creator_profile.company_id = c.company_id
     and creator_profile.role in ('admin', 'dispatcher', 'worker')
     and coalesce(creator_profile.is_admin_blocked, false) = false
    left join lateral (
      select p.id
      from public.profiles p
      where p.company_id = c.company_id
        and p.role = 'admin'
        and coalesce(p.is_admin_blocked, false) = false
      order by coalesce(p.created_at, p.updated_at, now()) asc, p.id asc
      limit 1
    ) fallback_admin on true
  ),
  candidates_with_delay as (
    select
      c.order_id,
      c.company_id,
      c.feed_since_ts,
      c.recipient_user_id,
      c.fallback_to_admin,
      greatest(1, least(43200, coalesce(np.reminder_delay_minutes, v_default_delay_minutes))) as delay_minutes
    from candidates_with_recipient c
    left join public.notification_prefs np
      on np.user_id = c.recipient_user_id
    where c.recipient_user_id is not null
      and coalesce(np.allow, true) = true
      and coalesce(np.reminders, true) = true
  ),
  inserted as (
    insert into public.notification_events (
      event_type,
      company_id,
      order_id,
      recipient_user_id,
      payload,
      dedupe_key
    )
    select
      'feed_stale_reminder',
      c.company_id,
      c.order_id,
      c.recipient_user_id,
      jsonb_build_object(
        'order_id', c.order_id,
        'event', 'feed_stale_reminder',
        'delay_minutes', c.delay_minutes,
        'fallback_to_admin', c.fallback_to_admin
      ),
      'feed_stale_reminder:' || c.order_id || ':' || c.recipient_user_id::text || ':' ||
        extract(epoch from date_trunc('second', c.feed_since_ts))::bigint::text
    from candidates_with_delay c
    where c.feed_since_ts <= now() - make_interval(mins => c.delay_minutes)
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return coalesce(v_inserted, 0);
end;
$$;

update public.orders o
set feed_entered_at = coalesce(o.feed_entered_at, o.updated_at, o.created_at, now())
where public.normalize_company_order_status_key(o.status) = 'feed'
  and o.assigned_to is null
  and o.feed_entered_at is null;

drop index if exists public.idx_orders_feed_unassigned_reminder;
create index if not exists idx_orders_feed_unassigned_reminder
  on public.orders (company_id, feed_entered_at, updated_at, created_at, id)
  where public.normalize_company_order_status_key(status) = 'feed'
    and assigned_to is null;

revoke all on function public.tg_orders_set_feed_entered_at() from public, anon, authenticated;
revoke all on function public.tg_orders_enqueue_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_stale_feed_reminders(interval) from public, anon, authenticated;
grant execute on function public.enqueue_stale_feed_reminders(interval) to service_role;

commit;
