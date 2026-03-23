begin;

-- Migrate legacy condition fact "money_holder" to equivalent payment_method condition.
with migrated as (
  select
    r.id,
    jsonb_set(
      coalesce(r.conditions_json, '{"op":"all","conditions":[]}'::jsonb),
      '{conditions}',
      coalesce(
        (
          select jsonb_agg(
            case
              when lower(coalesce(c.value->>'fact', '')) = 'money_holder' then
                jsonb_build_object(
                  'fact', 'payment_method',
                  'operator', 'eq',
                  'value', case lower(coalesce(c.value->>'value', ''))
                    when 'company' then 'cashless'
                    when 'executor' then 'cash'
                    else 'any'
                  end
                )
              else c.value
            end
            order by c.ord
          )
          from jsonb_array_elements(coalesce(r.conditions_json->'conditions', '[]'::jsonb)) with ordinality as c(value, ord)
        ),
        '[]'::jsonb
      ),
      true
    ) as new_conditions
  from public.company_finance_rules r
)
update public.company_finance_rules r
   set conditions_json = m.new_conditions,
       updated_at = now()
  from migrated m
 where m.id = r.id
   and coalesce(r.conditions_json, '{"op":"all","conditions":[]}'::jsonb) <> m.new_conditions;

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

    if v_fact in ('payment_method', 'payment_status') then
      if v_fact = 'payment_method' then
        v_allowed := array['cash', 'cashless', 'any'];
      else
        v_allowed := array['paid', 'unpaid', 'any'];
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

create or replace function public.apply_order_finance_rules(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_rule public.company_finance_rules%rowtype;
  v_recipient uuid;
  v_conditions jsonb;
  v_matched boolean;
  v_enabled_rule_ids uuid[] := '{}'::uuid[];
  v_matched_rule_ids uuid[] := '{}'::uuid[];
begin
  select *
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    return;
  end if;

  select coalesce(array_agg(r.id), '{}'::uuid[])
    into v_enabled_rule_ids
   from public.company_finance_rules r
   where r.company_id = v_order.company_id
     and r.is_enabled = true
     and (
       r.apply_to_existing = true
       or coalesce(r.updated_at, r.created_at) <= v_order.created_at
     );

  for v_rule in
    select *
     from public.company_finance_rules r
     where r.company_id = v_order.company_id
       and r.is_enabled = true
       and (
         r.apply_to_existing = true
         or coalesce(r.updated_at, r.created_at) <= v_order.created_at
       )
     order by r.sort_order asc, r.created_at asc
  loop
    v_conditions := coalesce(v_rule.conditions_json, '{"op":"all","conditions":[]}'::jsonb);
    v_matched := public.finance_rule_conditions_match(v_conditions, v_order);

    if not v_matched then
      continue;
    end if;

    v_matched_rule_ids := array_append(v_matched_rule_ids, v_rule.id);

    v_recipient := case
      when v_rule.recipient_mode = 'assigned_to' then v_order.assigned_to
      when v_rule.recipient_mode = 'manual_user' then v_rule.recipient_user_id
      else null
    end;

    insert into public.order_finance_entries (
      company_id,
      order_id,
      rule_id,
      kind,
      title,
      note,
      calc_mode,
      input_amount,
      input_percent,
      percent_base,
      expense_payer,
      recipient_user_id,
      requires_note,
      note_visible,
      visibility_scope,
      is_system,
      sort_order,
      rule_match_snapshot,
      created_by,
      updated_by
    ) values (
      v_order.company_id,
      v_order.id,
      v_rule.id,
      v_rule.kind,
      v_rule.name,
      nullif(btrim(coalesce(v_rule.note_template, '')), ''),
      v_rule.calc_mode,
      coalesce(v_rule.fixed_amount, 0),
      coalesce(v_rule.percent_value, 0),
      v_rule.percent_base,
      case
        when v_rule.kind = 'expense' then coalesce(v_rule.expense_payer, 'company')
        else 'company'
      end,
      v_recipient,
      v_rule.requires_note,
      v_rule.note_visible,
      case when v_rule.recipient_mode in ('assigned_to', 'manual_user') then 'own_only' else 'all' end,
      true,
      v_rule.sort_order,
      jsonb_build_object(
        'matched_at', now(),
        'conditions', v_conditions,
        'order_snapshot', jsonb_build_object(
          'payment_method', v_order.payment_method,
          'payment_status', v_order.payment_status,
          'base_price', coalesce(v_order.price, 0),
          'gross_before_discount', coalesce(v_order.price, 0) + coalesce(v_order.finance_income_total, 0),
          'gross_after_discount', coalesce(v_order.finance_gross_total, coalesce(v_order.price, 0) + coalesce(v_order.finance_income_total, 0) - coalesce(v_order.finance_discount_total, 0)),
          'income_total', coalesce(v_order.finance_income_total, 0)
        )
      ),
      auth.uid(),
      auth.uid()
    )
    on conflict (order_id, rule_id)
    do update set
      kind = excluded.kind,
      title = excluded.title,
      note = excluded.note,
      calc_mode = excluded.calc_mode,
      input_amount = excluded.input_amount,
      input_percent = excluded.input_percent,
      percent_base = excluded.percent_base,
      expense_payer = excluded.expense_payer,
      recipient_user_id = excluded.recipient_user_id,
      requires_note = excluded.requires_note,
      note_visible = excluded.note_visible,
      visibility_scope = excluded.visibility_scope,
      sort_order = excluded.sort_order,
      rule_match_snapshot = excluded.rule_match_snapshot,
      updated_at = now(),
      updated_by = auth.uid();
  end loop;

  if coalesce(array_length(v_enabled_rule_ids, 1), 0) > 0 then
    delete from public.order_finance_entries e
     where e.order_id = v_order.id
       and e.is_system = true
       and e.rule_id = any(v_enabled_rule_ids)
       and (
         coalesce(array_length(v_matched_rule_ids, 1), 0) = 0
         or not (e.rule_id = any(v_matched_rule_ids))
       );
  end if;
end;
$$;

commit;
