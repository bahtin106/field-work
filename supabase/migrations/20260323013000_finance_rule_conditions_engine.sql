begin;

alter table public.company_finance_rules
  add column if not exists conditions_json jsonb not null default '{"op":"all","conditions":[]}'::jsonb;

alter table public.order_finance_entries
  add column if not exists rule_match_snapshot jsonb;

create index if not exists company_finance_rules_conditions_gin_idx
  on public.company_finance_rules using gin (conditions_json jsonb_path_ops);

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
        v_allowed := array['cash', 'cashless'];
      elsif v_fact = 'payment_status' then
        v_allowed := array['paid', 'unpaid'];
      else
        v_allowed := array['company', 'executor'];
      end if;

      if v_operator = 'eq' then
        if jsonb_typeof(v_value) <> 'string' then
          return false;
        end if;
        v_scalar := lower(coalesce(v_value #>> '{}', ''));
        if not (v_scalar = any(v_allowed)) then
          return false;
        end if;
      elsif v_operator = 'in' then
        if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) = 0 then
          return false;
        end if;

        if exists (
          select 1
          from jsonb_array_elements(v_value) as elem(value)
          where jsonb_typeof(elem.value) <> 'string'
        ) then
          return false;
        end if;

        if exists (
          select 1
          from jsonb_array_elements_text(v_value) as elem(value)
          where lower(elem.value) <> all(v_allowed)
        ) then
          return false;
        end if;
      else
        return false;
      end if;
    elsif v_fact = 'price' then
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

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'company_finance_rules_conditions_json_check'
       and conrelid = 'public.company_finance_rules'::regclass
  ) then
    alter table public.company_finance_rules
      drop constraint company_finance_rules_conditions_json_check;
  end if;

  alter table public.company_finance_rules
    add constraint company_finance_rules_conditions_json_check
    check (public.finance_validate_rule_conditions(conditions_json));
end
$$;

update public.company_finance_rules
   set conditions_json = '{"op":"all","conditions":[]}'::jsonb
 where conditions_json is null;

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
  v_order_price numeric;
  v_expected_num numeric;
begin
  if not public.finance_validate_rule_conditions(v_root) then
    return false;
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_root->'conditions', '[]'::jsonb))
  loop
    v_fact := lower(coalesce(v_item->>'fact', ''));
    v_operator := lower(coalesce(v_item->>'operator', ''));
    v_value := v_item->'value';

    if v_fact = 'payment_method' then
      v_actual := lower(coalesce(p_order.payment_method, 'cash'));
    elsif v_fact = 'payment_status' then
      v_actual := lower(coalesce(p_order.payment_status, 'unpaid'));
    elsif v_fact = 'money_holder' then
      v_actual := case
        when lower(coalesce(p_order.payment_method, 'cash')) = 'cashless' then 'company'
        else 'executor'
      end;
    elsif v_fact = 'price' then
      v_order_price := coalesce(p_order.price, 0);
    else
      return false;
    end if;

    if v_fact in ('payment_method', 'payment_status', 'money_holder') then
      if v_operator = 'eq' then
        v_expected := lower(coalesce(v_value #>> '{}', ''));
        if v_actual <> v_expected then
          return false;
        end if;
      elsif v_operator = 'in' then
        if not exists (
          select 1
          from jsonb_array_elements_text(v_value) as elem(value)
          where lower(elem.value) = v_actual
        ) then
          return false;
        end if;
      else
        return false;
      end if;
    else
      v_expected_num := (v_value #>> '{}')::numeric;
      if v_operator = 'eq' and v_order_price <> v_expected_num then
        return false;
      elsif v_operator = 'gte' and v_order_price < v_expected_num then
        return false;
      elsif v_operator = 'lte' and v_order_price > v_expected_num then
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
begin
  select *
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    return;
  end if;

  delete from public.order_finance_entries e
   where e.order_id = v_order.id
     and e.is_system = true;

  for v_rule in
    select *
      from public.company_finance_rules r
     where r.company_id = v_order.company_id
       and r.is_enabled = true
     order by r.sort_order asc, r.created_at asc
  loop
    v_conditions := coalesce(v_rule.conditions_json, '{"op":"all","conditions":[]}'::jsonb);
    v_matched := public.finance_rule_conditions_match(v_conditions, v_order);

    if not v_matched then
      continue;
    end if;

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
          'money_holder', case when lower(coalesce(v_order.payment_method, 'cash')) = 'cashless' then 'company' else 'executor' end,
          'price', coalesce(v_order.price, 0)
        )
      ),
      auth.uid(),
      auth.uid()
    );
  end loop;
end;
$$;

create or replace function public.trg_recalculate_order_finance_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.finance_recalc_in_progress', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.recalculate_order_finance_totals(new.id);
    return new;
  end if;

  if (
    coalesce(new.price, 0) is distinct from coalesce(old.price, 0)
    or coalesce(new.assigned_to::text, '') is distinct from coalesce(old.assigned_to::text, '')
    or coalesce(new.company_id::text, '') is distinct from coalesce(old.company_id::text, '')
    or coalesce(new.payment_method, '') is distinct from coalesce(old.payment_method, '')
    or coalesce(new.payment_status, '') is distinct from coalesce(old.payment_status, '')
  ) then
    perform public.recalculate_order_finance_totals(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_recalculate_finance on public.orders;
create trigger trg_orders_recalculate_finance
after insert or update of price, assigned_to, company_id, payment_method, payment_status
on public.orders
for each row execute function public.trg_recalculate_order_finance_from_order();

commit;