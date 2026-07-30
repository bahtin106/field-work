begin;

-- Finance viewers need to see the formula that produced an order snapshot.
-- Read the immutable scheme version rather than the current company scheme so
-- later edits never rewrite the explanation shown for an existing request.
create or replace function public.get_order_finance_scheme_rule_v2(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_snapshot public.order_finance_snapshots%rowtype;
  v_version public.company_finance_scheme_versions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
    into v_snapshot
    from public.order_finance_snapshots
   where order_id = p_order_id;

  if not found or v_snapshot.company_id is distinct from public.user_company_id() then
    raise exception 'Order finance is not accessible' using errcode = '42501';
  end if;

  if not public.current_user_has_app_permission(
    'canViewFinanceAll',
    public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
  ) then
    raise exception 'Finance view permission required' using errcode = '42501';
  end if;

  if v_snapshot.scheme_version_id is null then
    return null;
  end if;

  select *
    into v_version
    from public.company_finance_scheme_versions
   where id = v_snapshot.scheme_version_id
     and company_id = v_snapshot.company_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'scheme_name', v_snapshot.scheme_name,
    'compensation_mode', v_version.compensation_mode,
    'fixed_amount', v_version.fixed_amount,
    'percent_value', v_version.percent_value,
    'percent_base', v_version.percent_base,
    'minimum_worker_amount', v_version.minimum_worker_amount,
    'maximum_worker_amount', v_version.maximum_worker_amount
  );
end;
$$;

revoke all on function public.get_order_finance_scheme_rule_v2(uuid)
  from public, anon;
grant execute on function public.get_order_finance_scheme_rule_v2(uuid)
  to authenticated, service_role;

commit;
