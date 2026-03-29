begin;

-- 1) Drop legacy recipient mode variant that depended on recipient_user_id.
update public.company_finance_rules
set recipient_mode = 'assigned_to'
where recipient_mode = 'manual_user';

alter table public.company_finance_rules
  drop constraint if exists company_finance_rules_recipient_mode_check;

alter table public.company_finance_rules
  add constraint company_finance_rules_recipient_mode_check
  check (recipient_mode = any (array['none'::text, 'assigned_to'::text]));

-- 2) Remove dead rule columns.
alter table public.company_finance_rules
  drop column if exists recipient_user_id,
  drop column if exists requires_note,
  drop column if exists note_visible,
  drop column if exists created_by,
  drop column if exists updated_by;

-- 3) Keep finance engine behavior stable after column cleanup.
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
      false,
      true,
      case when v_rule.recipient_mode = 'assigned_to' then 'own_only' else 'all' end,
      true,
      v_rule.sort_order,
      jsonb_build_object(
        'matched_at', now(),
        'conditions', v_conditions,
        'order_snapshot', jsonb_build_object(
          'payment_method', v_order.payment_method,
          'payment_status', v_order.payment_status,
          'base_price', coalesce(v_order.start_price, 0),
          'gross_before_discount', coalesce(v_order.start_price, 0) + coalesce(v_order.finance_income_total, 0),
          'gross_after_discount', coalesce(v_order.finance_gross_total, coalesce(v_order.start_price, 0) + coalesce(v_order.finance_income_total, 0) - coalesce(v_order.finance_discount_total, 0)),
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

