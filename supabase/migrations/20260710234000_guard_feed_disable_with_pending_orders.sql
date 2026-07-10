begin;

create or replace function public.orders_serialize_feed_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is not null
     and public.normalize_company_order_status_key(new.status) = 'feed' then
    perform pg_advisory_xact_lock(hashtextextended('company-feed:' || new.company_id::text, 0));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_feed_status_serialization on public.orders;
create trigger trg_orders_feed_status_serialization
before insert or update of status, company_id on public.orders
for each row
execute function public.orders_serialize_feed_status_change();

create or replace function public.companies_guard_direct_feed_disable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.feed_status_enabled is true
     and new.feed_status_enabled is false
     and coalesce(current_setting('app.feed_status_change_in_progress', true), '') <> '1' then
    raise exception 'company_feed_disable_requires_rpc' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_companies_guard_direct_feed_disable on public.companies;
create trigger trg_companies_guard_direct_feed_disable
before update of feed_status_enabled on public.companies
for each row
execute function public.companies_guard_direct_feed_disable();

create or replace function public.set_company_feed_status_enabled(
  p_company_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_company public.companies%rowtype;
begin
  if p_company_id is null or p_enabled is null then
    raise exception 'invalid_feed_status_setting' using errcode = '22023';
  end if;

  if not public.is_super_admin()
     and (p_company_id <> public.user_company_id() or not public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('company-feed:' || p_company_id::text, 0));

  select *
    into v_company
    from public.companies c
   where c.id = p_company_id
   for update;

  if not found then
    raise exception 'company_not_found' using errcode = 'P0002';
  end if;

  if p_enabled is false and exists (
    select 1
      from public.orders o
     where o.company_id = p_company_id
       and public.normalize_company_order_status_key(o.status) = 'feed'
  ) then
    raise exception 'company_feed_has_orders' using errcode = '23514';
  end if;

  perform set_config('app.feed_status_change_in_progress', '1', true);

  update public.companies
     set feed_status_enabled = p_enabled
   where id = p_company_id;
end;
$$;

revoke all on function public.set_company_feed_status_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_company_feed_status_enabled(uuid, boolean) to authenticated, service_role;

commit;
