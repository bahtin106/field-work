begin;

-- An open request can intentionally use manual financial calculation even
-- when it matches a company-wide scheme. Keep the choice on the request so
-- routine recalculations never attach the scheme again.
alter table public.orders
  add column if not exists finance_scheme_disabled boolean not null default false;

comment on column public.orders.finance_scheme_disabled is
  'When true, the request intentionally does not use an automatic finance scheme and is calculated manually.';

create or replace function public.finance_v2_conditions_match(
  p_conditions jsonb,
  p_order public.orders,
  p_customer_total numeric,
  p_income_total numeric
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_root jsonb := coalesce(p_conditions, '{"op":"all","conditions":[]}'::jsonb);
  v_item jsonb;
  v_fact text;
  v_operator text;
  v_value jsonb;
  v_actual text;
  v_expected text;
  v_actual_num numeric;
  v_expected_num numeric;
begin
  if coalesce(p_order.finance_scheme_disabled, false) then
    return false;
  end if;

  if not public.finance_v2_validate_conditions(v_root) then
    return false;
  end if;

  for v_item in
    select value
      from jsonb_array_elements(coalesce(v_root -> 'conditions', '[]'::jsonb))
  loop
    v_fact := lower(coalesce(v_item ->> 'fact', ''));
    v_operator := lower(coalesce(v_item ->> 'operator', ''));
    v_value := v_item -> 'value';

    if v_fact = 'payment_method' then
      v_actual := lower(coalesce(p_order.payment_method, 'cash'));
      v_expected := lower(coalesce(v_value #>> '{}', ''));
      if v_expected <> 'any' and v_actual <> v_expected then return false; end if;
    elsif v_fact = 'payment_status' then
      v_actual := lower(coalesce(p_order.payment_status, 'unpaid'));
      v_expected := lower(coalesce(v_value #>> '{}', ''));
      if v_expected <> 'any' and v_actual <> v_expected then return false; end if;
    elsif v_fact = 'work_type_id' then
      v_actual := lower(coalesce(p_order.work_type_id::text, ''));
      if v_actual = '' then return false; end if;
      if v_operator = 'eq' then
        if v_actual <> lower(coalesce(v_value #>> '{}', '')) then return false; end if;
      elsif not exists (
        select 1
          from jsonb_array_elements_text(v_value) as item(value)
         where lower(item.value) = v_actual
      ) then
        return false;
      end if;
    else
      v_actual_num := case
        when v_fact in ('base_price', 'price', 'start_price') then coalesce(p_order.start_price, 0)
        when v_fact in ('customer_total', 'gross_after_discount') then coalesce(p_customer_total, 0)
        when v_fact = 'gross_before_discount'
          then coalesce(p_order.start_price, 0) + coalesce(p_income_total, 0)
        when v_fact = 'income_total' then coalesce(p_income_total, 0)
        else 0
      end;
      v_expected_num := (v_value #>> '{}')::numeric;
      if v_operator = 'eq' and v_actual_num <> v_expected_num then return false; end if;
      if v_operator = 'gte' and v_actual_num < v_expected_num then return false; end if;
      if v_operator = 'lte' and v_actual_num > v_expected_num then return false; end if;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.set_order_finance_scheme_disabled_v2(
  p_order_id uuid,
  p_is_disabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
    into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found or v_order.company_id is distinct from public.user_company_id() then
    raise exception 'Order is not accessible' using errcode = '42501';
  end if;

  if not public.current_user_has_app_permission(
    'canEditFinanceEntries',
    public.finance_permission_default(public.user_role(), 'canEditFinanceEntries')
  ) then
    raise exception 'Finance edit permission required' using errcode = '42501';
  end if;

  if v_order.completed_at is not null
     or lower(coalesce(v_order.status, '')) in ('done', 'completed') then
    raise exception 'Completed order finance is locked' using errcode = '55000';
  end if;

  update public.orders
     set finance_scheme_disabled = coalesce(p_is_disabled, false),
         updated_at = now()
   where id = v_order.id;

  perform public.recalculate_order_finance_v2(v_order.id, true);
  return true;
end;
$$;

revoke all on function public.set_order_finance_scheme_disabled_v2(uuid, boolean)
  from public, anon;
grant execute on function public.set_order_finance_scheme_disabled_v2(uuid, boolean)
  to authenticated, service_role;

commit;
