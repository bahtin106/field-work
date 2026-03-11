begin;

-- ---- Finance permission defaults ----
create or replace function public.finance_permission_default(p_role text, p_key text)
returns boolean
language sql
immutable
as $$
  select case
    when lower(coalesce(p_role, '')) = 'admin' then true
    when lower(coalesce(p_role, '')) = 'dispatcher' then p_key in (
      'canViewFinanceOwn',
      'canViewFinanceAll',
      'canEditFinanceEntries',
      'canViewFinanceStatsAll'
    )
    when lower(coalesce(p_role, '')) = 'worker' then p_key in (
      'canViewFinanceOwn'
    )
    else false
  end;
$$;

with role_defaults as (
  select *
  from (
    values
      ('admin'::text, 'canViewFinanceOwn'::text, true),
      ('admin'::text, 'canViewFinanceAll'::text, true),
      ('admin'::text, 'canEditFinanceEntries'::text, true),
      ('admin'::text, 'canManageFinanceRules'::text, true),
      ('admin'::text, 'canViewFinanceStatsAll'::text, true),

      ('dispatcher'::text, 'canViewFinanceOwn'::text, true),
      ('dispatcher'::text, 'canViewFinanceAll'::text, true),
      ('dispatcher'::text, 'canEditFinanceEntries'::text, true),
      ('dispatcher'::text, 'canManageFinanceRules'::text, false),
      ('dispatcher'::text, 'canViewFinanceStatsAll'::text, true),

      ('worker'::text, 'canViewFinanceOwn'::text, true),
      ('worker'::text, 'canViewFinanceAll'::text, false),
      ('worker'::text, 'canEditFinanceEntries'::text, false),
      ('worker'::text, 'canManageFinanceRules'::text, false),
      ('worker'::text, 'canViewFinanceStatsAll'::text, false)
  ) as t(role, key, value)
),
companies_src as (
  select id as company_id
  from public.companies
)
insert into public.app_role_permissions(company_id, role, key, value)
select c.company_id, d.role, d.key, d.value
from companies_src c
cross join role_defaults d
where not exists (
  select 1
  from public.app_role_permissions p
  where p.company_id = c.company_id
    and p.role = d.role
    and p.key = d.key
)
on conflict (company_id, role, key) do nothing;

-- ---- Order finance rules ----
create table if not exists public.company_finance_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income', 'expense', 'discount')),
  calc_mode text not null default 'fixed' check (calc_mode in ('fixed', 'percent')),
  fixed_amount numeric(14,2) not null default 0 check (fixed_amount >= 0),
  percent_value numeric(9,4) not null default 0 check (percent_value >= 0),
  percent_base text not null default 'gross_after_discount'
    check (percent_base in ('base_price', 'gross_before_discount', 'gross_after_discount', 'net_before_expense')),
  recipient_mode text not null default 'none'
    check (recipient_mode in ('none', 'assigned_to', 'manual_user')),
  recipient_user_id uuid null references public.profiles(id) on delete set null,
  note_template text,
  requires_note boolean not null default false,
  note_visible boolean not null default true,
  is_enabled boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index if not exists company_finance_rules_company_sort_idx
  on public.company_finance_rules(company_id, is_enabled, sort_order, created_at);

-- ---- Order finance entries ----
create table if not exists public.order_finance_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rule_id uuid null references public.company_finance_rules(id) on delete set null,
  kind text not null check (kind in ('income', 'expense', 'discount')),
  title text not null,
  note text,
  calc_mode text not null default 'fixed' check (calc_mode in ('fixed', 'percent')),
  input_amount numeric(14,2) not null default 0 check (input_amount >= 0),
  input_percent numeric(9,4) not null default 0 check (input_percent >= 0),
  percent_base text not null default 'gross_after_discount'
    check (percent_base in ('base_price', 'gross_before_discount', 'gross_after_discount', 'net_before_expense')),
  calculated_amount numeric(14,2) not null default 0,
  recipient_user_id uuid null references public.profiles(id) on delete set null,
  requires_note boolean not null default false,
  note_visible boolean not null default true,
  visibility_scope text not null default 'all' check (visibility_scope in ('all', 'own_only', 'hidden')),
  is_system boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (order_id, rule_id)
);

create index if not exists order_finance_entries_order_sort_idx
  on public.order_finance_entries(order_id, sort_order, created_at);

create index if not exists order_finance_entries_company_recipient_idx
  on public.order_finance_entries(company_id, recipient_user_id, kind);

alter table public.orders
  add column if not exists finance_income_total numeric(14,2) not null default 0,
  add column if not exists finance_expense_total numeric(14,2) not null default 0,
  add column if not exists finance_discount_total numeric(14,2) not null default 0,
  add column if not exists finance_gross_total numeric(14,2) not null default 0,
  add column if not exists finance_net_total numeric(14,2) not null default 0,
  add column if not exists finance_calculated_at timestamptz;

-- ---- Audit table for entity-level history ----
create table if not exists public.app_entity_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  entity_type text not null,
  entity_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_user_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_entity_audit_log_company_created_idx
  on public.app_entity_audit_log(company_id, created_at desc);

create index if not exists app_entity_audit_log_entity_idx
  on public.app_entity_audit_log(entity_type, entity_id, created_at desc);

create or replace function public.entity_audit_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(tg_op);
  v_company_id uuid;
  v_entity_id text;
  v_before jsonb;
  v_after jsonb;
begin
  if v_action = 'insert' then
    v_after := to_jsonb(new);
    v_before := null;
  elsif v_action = 'update' then
    v_after := to_jsonb(new);
    v_before := to_jsonb(old);
    if v_after = v_before then
      return coalesce(new, old);
    end if;
  else
    v_after := null;
    v_before := to_jsonb(old);
  end if;

  v_company_id := coalesce((v_after->>'company_id')::uuid, (v_before->>'company_id')::uuid);
  v_entity_id := coalesce(v_after->>'id', v_before->>'id', 'unknown');

  insert into public.app_entity_audit_log (
    company_id,
    entity_type,
    entity_id,
    action,
    actor_user_id,
    before_data,
    after_data
  ) values (
    v_company_id,
    tg_table_name,
    v_entity_id,
    v_action,
    auth.uid(),
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;

-- ---- Finance computation ----
create or replace function public.finance_compute_amount(
  p_calc_mode text,
  p_input_amount numeric,
  p_input_percent numeric,
  p_percent_base text,
  p_base_price numeric,
  p_gross_before_discount numeric,
  p_gross_after_discount numeric,
  p_net_before_expense numeric
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_base numeric := 0;
begin
  if lower(coalesce(p_calc_mode, 'fixed')) = 'fixed' then
    return round(coalesce(p_input_amount, 0), 2);
  end if;

  case lower(coalesce(p_percent_base, 'gross_after_discount'))
    when 'base_price' then v_base := coalesce(p_base_price, 0);
    when 'gross_before_discount' then v_base := coalesce(p_gross_before_discount, 0);
    when 'gross_after_discount' then v_base := coalesce(p_gross_after_discount, 0);
    when 'net_before_expense' then v_base := coalesce(p_net_before_expense, 0);
    else v_base := coalesce(p_gross_after_discount, 0);
  end case;

  return round((v_base * coalesce(p_input_percent, 0) / 100.0)::numeric, 2);
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
  v_rule record;
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

create or replace function public.recalculate_order_finance_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_entry record;
  v_base_price numeric := 0;
  v_fuel_cost numeric := 0;
  v_income numeric := 0;
  v_discount numeric := 0;
  v_expense numeric := 0;
  v_amount numeric := 0;
  v_gross_before_discount numeric := 0;
  v_gross_after_discount numeric := 0;
  v_net_before_expense numeric := 0;
begin
  perform set_config('app.finance_recalc_in_progress', '1', true);

  select *
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    perform set_config('app.finance_recalc_in_progress', '0', true);
    return;
  end if;

  perform public.apply_order_finance_rules(v_order.id);

  v_base_price := coalesce(v_order.price, 0);
  v_fuel_cost := coalesce(v_order.fuel_cost, 0);

  for v_entry in
    select e.*
      from public.order_finance_entries e
     where e.order_id = v_order.id
     order by e.sort_order asc, e.created_at asc, e.id asc
  loop
    v_gross_before_discount := v_base_price + v_income;
    v_gross_after_discount := v_gross_before_discount - v_discount;
    v_net_before_expense := v_gross_after_discount - v_fuel_cost - v_expense;

    v_amount := public.finance_compute_amount(
      v_entry.calc_mode,
      v_entry.input_amount,
      v_entry.input_percent,
      v_entry.percent_base,
      v_base_price,
      v_gross_before_discount,
      v_gross_after_discount,
      v_net_before_expense
    );

    update public.order_finance_entries
       set calculated_amount = v_amount,
           updated_at = now(),
           updated_by = auth.uid()
     where id = v_entry.id;

    if v_entry.kind = 'income' then
      v_income := v_income + v_amount;
    elsif v_entry.kind = 'discount' then
      v_discount := v_discount + v_amount;
    else
      v_expense := v_expense + v_amount;
    end if;
  end loop;

  v_gross_after_discount := (v_base_price + v_income - v_discount);

  update public.orders o
     set finance_income_total = round(v_income, 2),
         finance_discount_total = round(v_discount, 2),
         finance_expense_total = round(v_expense + v_fuel_cost, 2),
         finance_gross_total = round(v_gross_after_discount, 2),
         finance_net_total = round(v_gross_after_discount - (v_expense + v_fuel_cost), 2),
         finance_calculated_at = now()
   where o.id = v_order.id;

  perform set_config('app.finance_recalc_in_progress', '0', true);
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
    or coalesce(new.fuel_cost, 0) is distinct from coalesce(old.fuel_cost, 0)
    or coalesce(new.assigned_to::text, '') is distinct from coalesce(old.assigned_to::text, '')
    or coalesce(new.company_id::text, '') is distinct from coalesce(old.company_id::text, '')
  ) then
    perform public.recalculate_order_finance_totals(new.id);
  end if;

  return new;
end;
$$;

create or replace function public.trg_recalculate_order_finance_from_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if coalesce(current_setting('app.finance_recalc_in_progress', true), '') = '1' then
    return coalesce(new, old);
  end if;

  v_order_id := coalesce(new.order_id, old.order_id);
  if v_order_id is not null then
    perform public.recalculate_order_finance_totals(v_order_id);
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.trg_recalculate_order_finance_from_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := coalesce(new.company_id, old.company_id);
  v_order_id uuid;
begin
  if v_company_id is null then
    return coalesce(new, old);
  end if;

  for v_order_id in
    select o.id
      from public.orders o
     where o.company_id = v_company_id
  loop
    perform public.recalculate_order_finance_totals(v_order_id);
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_orders_recalculate_finance on public.orders;
create trigger trg_orders_recalculate_finance
after insert or update of price, fuel_cost, assigned_to, company_id
on public.orders
for each row execute function public.trg_recalculate_order_finance_from_order();

drop trigger if exists trg_order_finance_entries_recalculate on public.order_finance_entries;
create trigger trg_order_finance_entries_recalculate
after insert or update or delete
on public.order_finance_entries
for each row execute function public.trg_recalculate_order_finance_from_entry();

drop trigger if exists trg_company_finance_rules_recalculate on public.company_finance_rules;
create trigger trg_company_finance_rules_recalculate
after insert or update or delete
on public.company_finance_rules
for each row execute function public.trg_recalculate_order_finance_from_rule();

-- ---- RLS ----
alter table public.company_finance_rules enable row level security;
alter table public.order_finance_entries enable row level security;
alter table public.app_entity_audit_log enable row level security;

drop policy if exists company_finance_rules_select_company on public.company_finance_rules;
create policy company_finance_rules_select_company
on public.company_finance_rules
for select
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canManageFinanceRules',
    finance_permission_default(user_role(), 'canManageFinanceRules')
  )
);

drop policy if exists company_finance_rules_write_company on public.company_finance_rules;
create policy company_finance_rules_write_company
on public.company_finance_rules
for all
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canManageFinanceRules',
    finance_permission_default(user_role(), 'canManageFinanceRules')
  )
)
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canManageFinanceRules',
    finance_permission_default(user_role(), 'canManageFinanceRules')
  )
);

drop policy if exists order_finance_entries_select_company on public.order_finance_entries;
create policy order_finance_entries_select_company
on public.order_finance_entries
for select
to authenticated
using (
  company_id = user_company_id()
  and (
    has_app_role_permission(
      company_id,
      user_role(),
      'canViewFinanceAll',
      finance_permission_default(user_role(), 'canViewFinanceAll')
    )
    or (
      has_app_role_permission(
        company_id,
        user_role(),
        'canViewFinanceOwn',
        finance_permission_default(user_role(), 'canViewFinanceOwn')
      )
      and (
        coalesce(recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = auth.uid()
        or exists (
          select 1
            from public.orders o
           where o.id = order_finance_entries.order_id
             and o.assigned_to = auth.uid()
        )
      )
    )
  )
);

drop policy if exists order_finance_entries_write_company on public.order_finance_entries;
create policy order_finance_entries_write_company
on public.order_finance_entries
for all
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditFinanceEntries',
    finance_permission_default(user_role(), 'canEditFinanceEntries')
  )
)
with check (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canEditFinanceEntries',
    finance_permission_default(user_role(), 'canEditFinanceEntries')
  )
);

drop policy if exists app_entity_audit_log_select_company on public.app_entity_audit_log;
create policy app_entity_audit_log_select_company
on public.app_entity_audit_log
for select
to authenticated
using (
  company_id = user_company_id()
  and has_app_role_permission(
    company_id,
    user_role(),
    'canViewFinanceStatsAll',
    finance_permission_default(user_role(), 'canViewFinanceStatsAll')
  )
);

-- ---- grants ----
grant select, insert, update, delete on public.company_finance_rules to authenticated;
grant select, insert, update, delete on public.order_finance_entries to authenticated;
grant select on public.app_entity_audit_log to authenticated;
grant execute on function public.recalculate_order_finance_totals(uuid) to authenticated, service_role;
grant execute on function public.apply_order_finance_rules(uuid) to authenticated, service_role;

-- ---- audit triggers ----
drop trigger if exists trg_orders_audit_capture on public.orders;
create trigger trg_orders_audit_capture
after insert or update or delete on public.orders
for each row execute function public.entity_audit_capture();

drop trigger if exists trg_clients_audit_capture on public.clients;
create trigger trg_clients_audit_capture
after insert or update or delete on public.clients
for each row execute function public.entity_audit_capture();

drop trigger if exists trg_client_objects_audit_capture on public.client_objects;
create trigger trg_client_objects_audit_capture
after insert or update or delete on public.client_objects
for each row execute function public.entity_audit_capture();

drop trigger if exists trg_order_finance_entries_audit_capture on public.order_finance_entries;
create trigger trg_order_finance_entries_audit_capture
after insert or update or delete on public.order_finance_entries
for each row execute function public.entity_audit_capture();

drop trigger if exists trg_company_finance_rules_audit_capture on public.company_finance_rules;
create trigger trg_company_finance_rules_audit_capture
after insert or update or delete on public.company_finance_rules
for each row execute function public.entity_audit_capture();

-- ---- Initial backfill ----
do $$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select id from public.orders
  loop
    perform public.recalculate_order_finance_totals(v_order_id);
  end loop;
end
$$;

commit;
