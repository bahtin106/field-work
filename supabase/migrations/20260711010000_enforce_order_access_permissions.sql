begin;

insert into public.app_role_permissions (company_id, role, key, value)
select c.id, role_defaults.role, 'canCompleteOwnOrders', role_defaults.value
from public.companies c
cross join (
  values
    ('admin'::text, true),
    ('dispatcher'::text, true),
    ('worker'::text, false)
) as role_defaults(role, value)
on conflict (company_id, role, key) do nothing;

insert into public.app_role_permissions (company_id, role, key, value)
select c.id, role_defaults.role, 'canCompleteOtherOrders', role_defaults.value
from public.companies c
cross join (
  values
    ('admin'::text, true),
    ('dispatcher'::text, true),
    ('worker'::text, false)
) as role_defaults(role, value)
on conflict (company_id, role, key) do nothing;

create or replace function public.order_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, auth, storage, extensions
as $$
  select case
    when lower(coalesce(p_role, '')) in ('admin', 'dispatcher') then
      p_key in (
        'canCreateOrders', 'canEditOrders', 'canCompleteOwnOrders', 'canCompleteOtherOrders',
        'canViewAllOrders', 'canDeleteOrders', 'canViewOrderPhotos',
        'canAddGalleryPhotos', 'canAddCameraPhotos'
      )
    when lower(coalesce(p_role, '')) = 'worker' then
      p_key in ('canViewOrderPhotos', 'canAddCameraPhotos')
    else false
  end;
$$;

create or replace function public.order_role_has_permission(
  p_company_id uuid,
  p_role text,
  p_key text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, storage, extensions
as $$
  select coalesce(
    (
      select arp.value
      from public.app_role_permissions arp
      where arp.company_id = p_company_id
        and arp.role = lower(coalesce(p_role, ''))
        and arp.key = p_key
      limit 1
    ),
    public.order_permission_default(p_role, p_key)
  );
$$;

revoke all on function public.order_role_has_permission(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.order_role_has_permission(uuid, text, text) to service_role;

create or replace function public.can_current_user_view_order(
  p_company_id uuid,
  p_assigned_to uuid,
  p_created_by_user_id uuid,
  p_status text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, storage, extensions
as $$
  select case
    when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then true
    when auth.uid() is null or p_company_id is distinct from public.user_company_id() then false
    when public.current_user_has_app_permission(
      'canViewAllOrders',
      public.order_permission_default(public.user_role(), 'canViewAllOrders')
    ) then true
    when p_assigned_to = auth.uid() or p_created_by_user_id = auth.uid() then true
    when p_status = 'feed' and exists (
      select 1
      from public.companies c
      where c.id = p_company_id
        and c.use_order_statuses = true
        and c.feed_status_enabled = true
    ) then true
    else false
  end;
$$;

create or replace function public.can_current_user_view_order_by_id(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, storage, extensions
as $$
  select public.can_current_user_view_order(
    o.company_id,
    o.assigned_to,
    o.created_by_user_id,
    o.status
  )
  from public.orders o
  where o.id = p_order_id;
$$;

create or replace function public.can_current_user_complete_order(
  p_company_id uuid,
  p_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, storage, extensions
as $$
  select
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or (
      auth.uid() is not null
      and p_company_id = public.user_company_id()
      and p_assigned_to = auth.uid()
      and public.current_user_has_app_permission(
        'canCompleteOwnOrders',
        public.order_permission_default(public.user_role(), 'canCompleteOwnOrders')
      )
    );
$$;

do $$
begin
  if to_regprocedure('public.update_order_if_version_impl(text,timestamp with time zone,jsonb)') is null
     and to_regprocedure('public.update_order_if_version(text,timestamp with time zone,jsonb)') is not null then
    alter function public.update_order_if_version(text, timestamp with time zone, jsonb)
      rename to update_order_if_version_impl;
  end if;
end;
$$;

create or replace function public.update_order_if_version(
  p_order_id text,
  p_expected_updated_at timestamp with time zone,
  p_patch jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = pg_catalog, public, auth, storage, extensions
as $$
declare
  v_current public.orders%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return public.update_order_if_version_impl(p_order_id, p_expected_updated_at, p_patch);
  end if;

  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_current
  from public.orders
  where id::text = p_order_id
  for update;

  if not found then
    return null;
  end if;

  if v_current.company_id is distinct from public.user_company_id() then
    raise exception 'forbidden';
  end if;

  if not public.billing_can_edit_company(v_current.company_id) then
    raise exception 'subscription_read_only';
  end if;

  if p_patch ->> 'status' = 'done'
     and v_current.status is distinct from 'done'
     and not public.can_current_user_complete_order(v_current.company_id, v_current.assigned_to) then
    raise exception 'insufficient_order_permission';
  end if;

  if public.current_user_has_app_permission(
    'canEditOrders',
    public.order_permission_default(public.user_role(), 'canEditOrders')
  ) then
    return public.update_order_if_version_impl(p_order_id, p_expected_updated_at, p_patch);
  end if;

  if p_patch = '{"status":"done"}'::jsonb
     and public.can_current_user_complete_order(v_current.company_id, v_current.assigned_to) then
    return public.update_order_if_version_impl(p_order_id, p_expected_updated_at, p_patch);
  end if;

  raise exception 'insufficient_order_permission';
end;
$$;

revoke all on function public.update_order_if_version_impl(text, timestamp with time zone, jsonb)
  from public, anon, authenticated;
revoke all on function public.update_order_if_version(text, timestamp with time zone, jsonb)
  from public;
grant execute on function public.update_order_if_version(text, timestamp with time zone, jsonb)
  to authenticated, service_role;

create or replace function public.accept_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth, storage, extensions
as $$
declare
  v_order public.orders%rowtype;
  v_statuses_enabled boolean;
  v_feed_enabled boolean;
  v_next_status text;
  v_updated integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return false;
  end if;

  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    if v_order.company_id is distinct from public.user_company_id() then
      raise exception 'forbidden';
    end if;
    if not public.billing_can_edit_company(v_order.company_id) then
      raise exception 'subscription_read_only';
    end if;
    if not public.current_user_has_app_permission(
      'canEditOrders',
      public.order_permission_default(public.user_role(), 'canEditOrders')
    ) then
      raise exception 'insufficient_order_permission';
    end if;
  end if;

  if v_order.assigned_to is not null then
    return false;
  end if;

  select c.use_order_statuses, c.feed_status_enabled
    into v_statuses_enabled, v_feed_enabled
    from public.companies c
   where c.id = v_order.company_id;

  if coalesce(v_statuses_enabled, false) and coalesce(v_feed_enabled, false)
     and v_order.status is distinct from 'feed' then
    return false;
  end if;

  if coalesce(v_statuses_enabled, false) and exists (
    select 1
    from public.company_order_statuses s
    where s.company_id = v_order.company_id
      and s.status_key = 'in_progress'
      and s.is_feed = false
  ) then
    v_next_status := 'in_progress';
  elsif coalesce(v_statuses_enabled, false) then
    v_next_status := null;
  else
    v_next_status := U&'\0412 \0440\0430\0431\043E\0442\0435';
  end if;

  perform set_config('app.suppress_assigned_notifications', 'true', true);

  update public.orders o
     set assigned_to = auth.uid(),
         status = v_next_status,
         updated_at = now()
   where o.id = p_order_id
     and o.assigned_to is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.accept_order(uuid) from public;
grant execute on function public.accept_order(uuid) to authenticated, service_role;

drop policy if exists "orders_select_combined" on public.orders;
drop policy if exists "orders_insert_admin_dispatcher" on public.orders;
drop policy if exists "orders_update_combined" on public.orders;
drop policy if exists "orders_delete_admin_dispatcher" on public.orders;
drop policy if exists "orders_block_insert_by_subscription" on public.orders;
drop policy if exists "orders_block_update_by_subscription" on public.orders;
drop policy if exists "orders_block_delete_by_subscription" on public.orders;
drop policy if exists "orders_select_configured_access" on public.orders;
drop policy if exists "orders_insert_configured_access" on public.orders;
drop policy if exists "orders_update_configured_access" on public.orders;
drop policy if exists "orders_delete_configured_access" on public.orders;
drop policy if exists "orders_subscription_insert_guard" on public.orders;
drop policy if exists "orders_subscription_update_guard" on public.orders;
drop policy if exists "orders_subscription_delete_guard" on public.orders;

create policy "orders_select_configured_access"
on public.orders
for select
to authenticated
using (public.can_current_user_view_order(company_id, assigned_to, created_by_user_id, status));

create policy "orders_insert_configured_access"
on public.orders
for insert
to authenticated
with check (
  company_id = public.user_company_id()
  and public.current_user_has_app_permission(
    'canCreateOrders',
    public.order_permission_default(public.user_role(), 'canCreateOrders')
  )
);

create policy "orders_update_configured_access"
on public.orders
for update
to authenticated
using (
  company_id = public.user_company_id()
  and public.current_user_has_app_permission(
    'canEditOrders',
    public.order_permission_default(public.user_role(), 'canEditOrders')
  )
)
with check (
  company_id = public.user_company_id()
  and public.current_user_has_app_permission(
    'canEditOrders',
    public.order_permission_default(public.user_role(), 'canEditOrders')
  )
);

create policy "orders_delete_configured_access"
on public.orders
for delete
to authenticated
using (
  company_id = public.user_company_id()
  and public.current_user_has_app_permission(
    'canDeleteOrders',
    public.order_permission_default(public.user_role(), 'canDeleteOrders')
  )
);

create policy "orders_subscription_insert_guard"
on public.orders
as restrictive
for insert
to authenticated
with check (public.billing_can_edit_company(public.user_company_id()));

create policy "orders_subscription_update_guard"
on public.orders
as restrictive
for update
to authenticated
using (public.billing_can_edit_company(company_id))
with check (public.billing_can_edit_company(company_id));

create policy "orders_subscription_delete_guard"
on public.orders
as restrictive
for delete
to authenticated
using (public.billing_can_edit_company(company_id));

drop policy if exists "media_assets_select_company" on public.media_assets;
drop policy if exists "media_assets_select_configured_access" on public.media_assets;

create policy "media_assets_select_configured_access"
on public.media_assets
for select
to authenticated
using (
  company_id = public.user_company_id()
  and (
    entity_type not in ('order', 'finance_entry')
    or (
      public.current_user_has_app_permission(
        'canViewOrderPhotos',
        public.order_permission_default(public.user_role(), 'canViewOrderPhotos')
      )
      and public.can_current_user_view_order_by_id(
        coalesce(parent_order_id, case when entity_type = 'order' then entity_id else null end)
      )
    )
  )
);

commit;
