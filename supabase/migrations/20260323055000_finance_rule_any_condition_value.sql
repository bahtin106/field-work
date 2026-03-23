begin;

create or replace function public.finance_validate_rule_conditions(p_conditions jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_root jsonb := coalesce(p_conditions, '{"op":"all","conditions":[]}'::jsonb);
  v_item jsonb;
  v_fact text;
  v_operator text;
  v_value jsonb;
  v_scalar text;
  v_num numeric;
  v_allowed text[];
begin
  if jsonb_typeof(v_root) <> 'object' then
    return false;
  end if;

  if lower(coalesce(v_root->>'op', 'all')) <> 'all' then
    return false;
  end if;

  if jsonb_typeof(coalesce(v_root->'conditions', '[]'::jsonb)) <> 'array' then
    return false;
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_root->'conditions', '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;

    v_fact := lower(coalesce(v_item->>'fact', ''));
    v_operator := lower(coalesce(v_item->>'operator', ''));
    v_value := v_item->'value';

    if v_fact in ('payment_method', 'payment_status', 'money_holder') then
      if v_fact = 'payment_method' then
        v_allowed := array['cash', 'cashless', 'any'];
      elsif v_fact = 'payment_status' then
        v_allowed := array['paid', 'unpaid', 'any'];
      else
        v_allowed := array['company', 'executor', 'any'];
      end if;

      if v_operator <> 'eq' then
        return false;
      end if;
      if jsonb_typeof(v_value) <> 'string' then
        return false;
      end if;
      v_scalar := lower(coalesce(v_value #>> '{}', ''));
      if not (v_scalar = any(v_allowed)) then
        return false;
      end if;
    elsif v_fact in ('price', 'base_price', 'gross_before_discount', 'gross_after_discount', 'income_total') then
      if v_operator not in ('eq', 'gte', 'lte') then
        return false;
      end if;

      if jsonb_typeof(v_value) not in ('number', 'string') then
        return false;
      end if;

      begin
        v_scalar := coalesce(v_value #>> '{}', '');
        v_num := v_scalar::numeric;
      exception when others then
        return false;
      end;

      if v_num < 0 then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.finance_rule_conditions_match(
  p_conditions jsonb,
  p_order public.orders
)
returns boolean
language plpgsql
stable
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
  v_base_price numeric;
  v_income_total numeric;
  v_discount_total numeric;
  v_gross_before_discount numeric;
  v_gross_after_discount numeric;
begin
  if not public.finance_validate_rule_conditions(v_root) then
    return false;
  end if;

  v_base_price := coalesce(p_order.price, 0);
  v_income_total := coalesce(p_order.finance_income_total, 0);
  v_discount_total := coalesce(p_order.finance_discount_total, 0);
  v_gross_before_discount := v_base_price + v_income_total;
  v_gross_after_discount := v_gross_before_discount - v_discount_total;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_root->'conditions', '[]'::jsonb))
  loop
    v_fact := lower(coalesce(v_item->>'fact', ''));
    v_operator := lower(coalesce(v_item->>'operator', ''));
    v_value := v_item->'value';

    if v_fact = 'payment_method' then
      v_actual := lower(coalesce(p_order.payment_method, 'cash'));
      v_expected := lower(coalesce(v_value #>> '{}', ''));
      if v_operator <> 'eq' then
        return false;
      end if;
      if v_expected = 'any' then
        continue;
      end if;
      if v_actual <> v_expected then
        return false;
      end if;
    elsif v_fact = 'payment_status' then
      v_actual := lower(coalesce(p_order.payment_status, 'unpaid'));
      v_expected := lower(coalesce(v_value #>> '{}', ''));
      if v_operator <> 'eq' then
        return false;
      end if;
      if v_expected = 'any' then
        continue;
      end if;
      if v_actual <> v_expected then
        return false;
      end if;
    elsif v_fact = 'money_holder' then
      v_actual := case
        when lower(coalesce(p_order.payment_method, 'cash')) = 'cashless' then 'company'
        else 'executor'
      end;
      v_expected := lower(coalesce(v_value #>> '{}', ''));
      if v_operator <> 'eq' then
        return false;
      end if;
      if v_expected = 'any' then
        continue;
      end if;
      if v_actual <> v_expected then
        return false;
      end if;
    else
      if v_fact = 'base_price' or v_fact = 'price' then
        v_actual_num := v_base_price;
      elsif v_fact = 'gross_before_discount' then
        v_actual_num := v_gross_before_discount;
      elsif v_fact = 'gross_after_discount' then
        v_actual_num := v_gross_after_discount;
      elsif v_fact = 'income_total' then
        v_actual_num := v_income_total;
      else
        return false;
      end if;

      v_expected_num := (v_value #>> '{}')::numeric;
      if v_operator = 'eq' and v_actual_num <> v_expected_num then
        return false;
      elsif v_operator = 'gte' and v_actual_num < v_expected_num then
        return false;
      elsif v_operator = 'lte' and v_actual_num > v_expected_num then
        return false;
      elsif v_operator not in ('eq', 'gte', 'lte') then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

commit;
