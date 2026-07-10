begin;

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

revoke all on function public.update_order_if_version(text, timestamp with time zone, jsonb)
  from public;
grant execute on function public.update_order_if_version(text, timestamp with time zone, jsonb)
  to authenticated, service_role;

commit;
