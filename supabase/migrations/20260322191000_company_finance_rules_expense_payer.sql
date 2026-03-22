alter table public.company_finance_rules
  add column if not exists expense_payer text;

update public.company_finance_rules
   set expense_payer = 'company'
 where expense_payer is null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'company_finance_rules_expense_payer_check'
  ) then
    alter table public.company_finance_rules
      add constraint company_finance_rules_expense_payer_check
      check (expense_payer in ('company', 'executor'));
  end if;
end
$$;

alter table public.company_finance_rules
  alter column expense_payer set default 'company',
  alter column expense_payer set not null;

comment on column public.company_finance_rules.expense_payer is
  'For expense rules only: who pays this expense (company|executor).';

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
     and e.is_system = true
     and not exists (
       select 1
         from public.company_finance_rules r
        where r.id = e.rule_id
          and r.company_id = v_order.company_id
          and r.is_enabled = true
     );

  for v_rule in
    select *
      from public.company_finance_rules r
     where r.company_id = v_order.company_id
       and r.is_enabled = true
     order by r.sort_order asc, r.created_at asc
  loop
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
      auth.uid(),
      auth.uid()
    )
    on conflict (order_id, rule_id)
    do update
    set
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
      is_system = true,
      updated_at = now(),
      updated_by = auth.uid();
  end loop;
end;
$$;
