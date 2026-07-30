begin;

-- A scheme stores work-type identifiers rather than names. This keeps a
-- rename safe, and this helper makes sure a new or edited scheme cannot point
-- at a type that belongs to another company or no longer exists.
create or replace function public.finance_v2_conditions_reference_current_work_types(
  p_conditions jsonb,
  p_company_id uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  with condition_values as (
    select lower(value) as work_type_id
      from jsonb_array_elements(coalesce(p_conditions -> 'conditions', '[]'::jsonb)) as condition_row(condition)
      cross join lateral jsonb_array_elements_text(
        case
          when lower(coalesce(condition_row.condition ->> 'fact', '')) <> 'work_type_id'
            then '[]'::jsonb
          when lower(coalesce(condition_row.condition ->> 'operator', '')) = 'eq'
            then jsonb_build_array(condition_row.condition -> 'value')
          when jsonb_typeof(condition_row.condition -> 'value') = 'array'
            then condition_row.condition -> 'value'
          else '[]'::jsonb
        end
      ) as values_row(value)
  )
  select not exists (
    select 1
      from condition_values requested
     where not exists (
       select 1
         from public.work_types work_type
        where work_type.company_id = p_company_id
          and lower(work_type.id::text) = requested.work_type_id
     )
  );
$$;

create or replace function public.trg_validate_finance_scheme_work_types()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.is_default then
    return new;
  end if;

  if not public.finance_v2_conditions_reference_current_work_types(
    new.conditions_json,
    new.company_id
  ) then
    raise exception 'FINANCE_SCHEME_WORK_TYPE_NOT_FOUND' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_finance_scheme_work_types
  on public.company_finance_schemes;
create trigger trg_validate_finance_scheme_work_types
before insert or update of company_id, conditions_json, is_default
on public.company_finance_schemes
for each row execute function public.trg_validate_finance_scheme_work_types();

-- If the feature is disabled, a work-type condition must not silently keep
-- affecting the calculation. The saved condition remains intact so turning
-- the feature back on restores the configured behaviour.
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
      if not exists (
        select 1
          from public.companies company
         where company.id = p_order.company_id
           and company.use_work_types is true
      ) then
        return false;
      end if;

      v_actual := lower(coalesce(p_order.work_type_id::text, ''));
      if v_actual = '' or not exists (
        select 1
          from public.work_types work_type
         where work_type.id = p_order.work_type_id
           and work_type.company_id = p_order.company_id
      ) then
        return false;
      end if;

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

-- Recalculate all open requests immediately when the company turns the
-- feature on or off. Closed snapshots stay immutable.
create or replace function public.trg_recalculate_finance_on_work_types_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_id uuid;
begin
  if old.use_work_types is not distinct from new.use_work_types then
    return new;
  end if;

  for v_order_id in
    select order_row.id
      from public.orders order_row
      left join public.order_finance_snapshots snapshot on snapshot.order_id = order_row.id
     where order_row.company_id = new.id
       and snapshot.locked_at is null
  loop
    perform public.recalculate_order_finance_v2(v_order_id, true);
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_recalculate_finance_on_work_types_change
  on public.companies;
create trigger trg_recalculate_finance_on_work_types_change
after update of use_work_types
on public.companies
for each row execute function public.trg_recalculate_finance_on_work_types_change();

-- This is deliberately transactional: an active finance scheme is a hard
-- reference. Removing its type without first changing the scheme would turn
-- a precise rule into a silent fallback rule.
create or replace function public.delete_work_type_v2(
  p_company_id uuid,
  p_work_type_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_work_type public.work_types%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
    into v_work_type
    from public.work_types
   where id = p_work_type_id
     and company_id = p_company_id
   for update;

  if not found then
    raise exception 'WORK_TYPE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not (
    public.is_super_admin()
    or (
      v_work_type.company_id = public.user_company_id()
      and public.is_admin_or_dispatcher()
    )
  ) then
    raise exception 'WORK_TYPE_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  if not public.billing_can_edit_company(v_work_type.company_id) then
    raise exception 'WORK_TYPE_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.company_finance_schemes scheme
      cross join lateral jsonb_array_elements(
        coalesce(scheme.conditions_json -> 'conditions', '[]'::jsonb)
      ) as condition_row(condition)
     where scheme.company_id = v_work_type.company_id
       and scheme.archived_at is null
       and lower(coalesce(condition_row.condition ->> 'fact', '')) = 'work_type_id'
       and (
         (
           lower(coalesce(condition_row.condition ->> 'operator', '')) = 'eq'
           and lower(coalesce(condition_row.condition ->> 'value', '')) = lower(v_work_type.id::text)
         )
         or (
           lower(coalesce(condition_row.condition ->> 'operator', '')) = 'in'
           and exists (
             select 1
               from jsonb_array_elements_text(
                 case
                   when jsonb_typeof(condition_row.condition -> 'value') = 'array'
                     then condition_row.condition -> 'value'
                   else '[]'::jsonb
                 end
               ) as selected_type(value)
              where lower(selected_type.value) = lower(v_work_type.id::text)
           )
         )
       )
  ) then
    raise exception 'WORK_TYPE_USED_BY_FINANCE_SCHEMES' using errcode = '23503';
  end if;

  update public.orders
     set work_type_id = null,
         updated_at = now()
   where company_id = v_work_type.company_id
     and work_type_id = v_work_type.id;

  delete from public.work_types
   where id = v_work_type.id
     and company_id = v_work_type.company_id;

  return true;
end;
$$;

revoke all on function public.delete_work_type_v2(uuid, uuid) from public, anon;
grant execute on function public.delete_work_type_v2(uuid, uuid) to authenticated, service_role;

commit;
