begin;

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

create or replace function public.can_current_user_complete_other_order(
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
      and p_assigned_to is not null
      and p_assigned_to <> auth.uid()
      and public.current_user_has_app_permission(
        'canCompleteOtherOrders',
        public.order_permission_default(public.user_role(), 'canCompleteOtherOrders')
      )
    );
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
     and not (
       public.can_current_user_complete_order(v_current.company_id, v_current.assigned_to)
       or public.can_current_user_complete_other_order(v_current.company_id, v_current.assigned_to)
     ) then
    raise exception 'insufficient_order_permission';
  end if;

  if public.current_user_has_app_permission(
    'canEditOrders',
    public.order_permission_default(public.user_role(), 'canEditOrders')
  ) then
    return public.update_order_if_version_impl(p_order_id, p_expected_updated_at, p_patch);
  end if;

  if p_patch = '{"status":"done"}'::jsonb
     and (
       public.can_current_user_complete_order(v_current.company_id, v_current.assigned_to)
       or public.can_current_user_complete_other_order(v_current.company_id, v_current.assigned_to)
     ) then
    return public.update_order_if_version_impl(p_order_id, p_expected_updated_at, p_patch);
  end if;

  raise exception 'insufficient_order_permission';
end;
$$;

revoke all on function public.update_order_if_version(text, timestamp with time zone, jsonb)
  from public;
grant execute on function public.update_order_if_version(text, timestamp with time zone, jsonb)
  to authenticated, service_role;

commit;
