begin;

-- Finance V2 separates customer revenue, worker compensation, company costs,
-- reimbursements and cash settlement. The legacy engine used the same
-- "expense" row for several of those meanings, which made correct reporting
-- impossible.

alter table public.orders
  add column if not exists finance_money_holder text not null default 'company';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.orders'::regclass
       and conname = 'orders_finance_money_holder_check'
  ) then
    alter table public.orders
      add constraint orders_finance_money_holder_check
      check (finance_money_holder in ('company', 'executor'));
  end if;
end;
$$;

alter table public.order_finance_entries
  add column if not exists finance_effect text;

select set_config('app.finance_recalc_in_progress', '1', true);

update public.order_finance_entries
   set finance_effect = case
     when kind = 'income' then 'customer_charge'
     when kind = 'discount' then 'customer_discount'
     when kind = 'expense' and coalesce(expense_payer, 'company') = 'executor'
       then 'worker_reimbursement'
     else 'company_cost'
   end
 where finance_effect is null
    or btrim(finance_effect) = '';

select set_config('app.finance_recalc_in_progress', '0', true);

alter table public.order_finance_entries
  alter column finance_effect drop default,
  alter column finance_effect set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.order_finance_entries'::regclass
       and conname = 'order_finance_entries_effect_check'
  ) then
    alter table public.order_finance_entries
      add constraint order_finance_entries_effect_check
      check (
        finance_effect in (
          'customer_charge',
          'customer_discount',
          'company_cost',
          'worker_reimbursement',
          'worker_bonus',
          'worker_deduction',
          'worker_payment',
          'company_remittance'
        )
      );
  end if;
end;
$$;

create or replace function public.finance_v2_normalize_entry_effect()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  -- Older clients do not send finance_effect. Derive it from the legacy
  -- kind/payer pair so a rolling app update cannot reinterpret their rows.
  if tg_op = 'INSERT' and (
    new.finance_effect is null or btrim(new.finance_effect) = ''
  ) then
    new.finance_effect := case
      when new.kind = 'income' then 'customer_charge'
      when new.kind = 'discount' then 'customer_discount'
      when new.kind = 'expense' and coalesce(new.expense_payer, 'company') = 'executor'
        then 'worker_reimbursement'
      else 'company_cost'
    end;
  elsif tg_op = 'UPDATE' and (
    new.finance_effect is null
    or btrim(new.finance_effect) = ''
    or (
      new.finance_effect is not distinct from old.finance_effect
      and (
        new.kind is distinct from old.kind
        or new.expense_payer is distinct from old.expense_payer
      )
    )
  ) then
    new.finance_effect := case
      when new.kind = 'income' then 'customer_charge'
      when new.kind = 'discount' then 'customer_discount'
      when new.kind = 'expense' and coalesce(new.expense_payer, 'company') = 'executor'
        then 'worker_reimbursement'
      else 'company_cost'
    end;
  end if;

  new.kind := case
    when new.finance_effect = 'customer_charge' then 'income'
    when new.finance_effect = 'customer_discount' then 'discount'
    else 'expense'
  end;
  new.expense_payer := case
    when new.finance_effect = 'worker_reimbursement' then 'executor'
    else 'company'
  end;
  return new;
end;
$$;

drop trigger if exists trg_finance_v2_normalize_entry_effect
  on public.order_finance_entries;
create trigger trg_finance_v2_normalize_entry_effect
before insert or update of finance_effect, kind, expense_payer
on public.order_finance_entries
for each row execute function public.finance_v2_normalize_entry_effect();

revoke all on function public.finance_v2_normalize_entry_effect()
  from public, anon, authenticated;

create table if not exists public.company_finance_schemes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  conditions_json jsonb not null default '{"op":"all","conditions":[]}'::jsonb,
  is_default boolean not null default false,
  is_enabled boolean not null default true,
  priority integer not null default 100,
  current_version_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.company_finance_scheme_versions (
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references public.company_finance_schemes(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  compensation_mode text not null check (
    compensation_mode in (
      'worker_percent',
      'company_percent',
      'worker_fixed',
      'company_fixed',
      'worker_fixed_plus_percent',
      'manual'
    )
  ),
  fixed_amount numeric(14,2) not null default 0 check (fixed_amount >= 0),
  percent_value numeric(9,4) not null default 0 check (percent_value >= 0),
  percent_base text not null default 'customer_total' check (
    percent_base in ('base_price', 'customer_total', 'income_total')
  ),
  minimum_worker_amount numeric(14,2) check (minimum_worker_amount is null or minimum_worker_amount >= 0),
  maximum_worker_amount numeric(14,2) check (maximum_worker_amount is null or maximum_worker_amount >= 0),
  configuration_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (scheme_id, version_number)
);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.company_finance_schemes'::regclass
       and conname = 'company_finance_schemes_current_version_id_fkey'
  ) then
    alter table public.company_finance_schemes
      add constraint company_finance_schemes_current_version_id_fkey
      foreign key (current_version_id)
      references public.company_finance_scheme_versions(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists company_finance_schemes_company_priority_idx
  on public.company_finance_schemes(company_id, is_enabled, priority, created_at)
  where archived_at is null;

create unique index if not exists company_finance_schemes_one_default_idx
  on public.company_finance_schemes(company_id)
  where is_default = true and archived_at is null;

create index if not exists company_finance_scheme_versions_scheme_idx
  on public.company_finance_scheme_versions(scheme_id, version_number desc);

create table if not exists public.order_finance_snapshots (
  order_id uuid primary key references public.orders(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  scheme_id uuid references public.company_finance_schemes(id) on delete set null,
  scheme_version_id uuid references public.company_finance_scheme_versions(id) on delete set null,
  scheme_name text,
  scheme_version_number integer,
  money_holder text not null default 'company' check (money_holder in ('company', 'executor')),
  customer_base_total numeric(14,2) not null default 0,
  customer_charge_total numeric(14,2) not null default 0,
  customer_discount_total numeric(14,2) not null default 0,
  customer_total numeric(14,2) not null default 0,
  worker_base_compensation_total numeric(14,2) not null default 0,
  worker_bonus_total numeric(14,2) not null default 0,
  worker_deduction_total numeric(14,2) not null default 0,
  worker_compensation_total numeric(14,2) not null default 0,
  worker_reimbursement_total numeric(14,2) not null default 0,
  worker_payable_total numeric(14,2) not null default 0,
  company_cost_total numeric(14,2) not null default 0,
  company_margin_total numeric(14,2) not null default 0,
  worker_paid_total numeric(14,2) not null default 0,
  company_received_total numeric(14,2) not null default 0,
  settlement_direction text not null default 'settled' check (
    settlement_direction in ('company_to_executor', 'executor_to_company', 'settled')
  ),
  settlement_amount numeric(14,2) not null default 0,
  settlement_status text not null default 'due' check (
    settlement_status in ('due', 'waiting_customer_payment', 'settled')
  ),
  breakdown_json jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  locked_at timestamptz
);

create index if not exists order_finance_snapshots_company_calculated_idx
  on public.order_finance_snapshots(company_id, calculated_at desc);

create index if not exists order_finance_snapshots_scheme_version_idx
  on public.order_finance_snapshots(scheme_version_id);

create or replace function public.finance_v2_validate_conditions(p_conditions jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_root jsonb := coalesce(p_conditions, '{"op":"all","conditions":[]}'::jsonb);
  v_item jsonb;
  v_fact text;
  v_operator text;
  v_value jsonb;
  v_scalar text;
  v_num numeric;
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(v_root) <> 'object'
     or lower(coalesce(v_root ->> 'op', 'all')) <> 'all'
     or jsonb_typeof(coalesce(v_root -> 'conditions', '[]'::jsonb)) <> 'array' then
    return false;
  end if;

  for v_item in
    select value
      from jsonb_array_elements(coalesce(v_root -> 'conditions', '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;

    v_fact := lower(coalesce(v_item ->> 'fact', ''));
    v_operator := lower(coalesce(v_item ->> 'operator', ''));
    v_value := v_item -> 'value';

    if v_fact = 'payment_method' then
      if v_operator <> 'eq' or jsonb_typeof(v_value) <> 'string' then return false; end if;
      v_scalar := lower(coalesce(v_value #>> '{}', ''));
      if v_scalar not in ('cash', 'cashless', 'any') then return false; end if;
    elsif v_fact = 'payment_status' then
      if v_operator <> 'eq' or jsonb_typeof(v_value) <> 'string' then return false; end if;
      v_scalar := lower(coalesce(v_value #>> '{}', ''));
      if v_scalar not in ('paid', 'unpaid', 'any') then return false; end if;
    elsif v_fact = 'work_type_id' then
      if v_operator = 'eq' then
        if jsonb_typeof(v_value) <> 'string'
           or lower(coalesce(v_value #>> '{}', '')) !~ v_uuid_re then
          return false;
        end if;
      elsif v_operator = 'in' then
        if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) = 0 then
          return false;
        end if;
        if exists (
          select 1
            from jsonb_array_elements(v_value) as item(value)
           where jsonb_typeof(item.value) <> 'string'
              or lower(coalesce(item.value #>> '{}', '')) !~ v_uuid_re
        ) then
          return false;
        end if;
      else
        return false;
      end if;
    elsif v_fact in (
      'base_price',
      'price',
      'start_price',
      'customer_total',
      'gross_before_discount',
      'gross_after_discount',
      'income_total'
    ) then
      if v_operator not in ('eq', 'gte', 'lte')
         or jsonb_typeof(v_value) not in ('number', 'string') then
        return false;
      end if;
      begin
        v_num := (v_value #>> '{}')::numeric;
      exception when others then
        return false;
      end;
      if v_num < 0 then return false; end if;
    else
      return false;
    end if;
  end loop;

  return true;
end;
$$;

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

create or replace function public.finance_v2_compute_amount(
  p_calc_mode text,
  p_input_amount numeric,
  p_input_percent numeric,
  p_percent_base text,
  p_base_price numeric,
  p_customer_before_discount numeric,
  p_customer_total numeric,
  p_income_total numeric
)
returns numeric
language sql
immutable
set search_path = pg_catalog
as $$
  select round(
    case
      when lower(coalesce(p_calc_mode, 'fixed')) = 'fixed'
        then greatest(coalesce(p_input_amount, 0), 0)
      else greatest(
        case lower(coalesce(p_percent_base, 'base_price'))
          when 'base_price' then coalesce(p_base_price, 0)
          when 'gross_before_discount' then coalesce(p_customer_before_discount, 0)
          when 'gross_after_discount' then coalesce(p_customer_total, 0)
          when 'customer_total' then coalesce(p_customer_total, 0)
          when 'income_total' then coalesce(p_income_total, 0)
          else coalesce(p_base_price, 0)
        end,
        0
      ) * greatest(coalesce(p_input_percent, 0), 0) / 100.0
    end,
    2
  );
$$;

create or replace function public.recalculate_order_finance_v2(
  p_order_id uuid,
  p_refresh_scheme boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_entry record;
  v_bound_snapshot public.order_finance_snapshots%rowtype;
  v_scheme record;
  v_effect text;
  v_base_price numeric := 0;
  v_income numeric := 0;
  v_discount numeric := 0;
  v_customer_before_discount numeric := 0;
  v_customer_total numeric := 0;
  v_company_direct_cost numeric := 0;
  v_worker_reimbursement numeric := 0;
  v_worker_bonus numeric := 0;
  v_worker_deduction numeric := 0;
  v_worker_paid numeric := 0;
  v_company_received numeric := 0;
  v_worker_base_compensation numeric := 0;
  v_worker_compensation numeric := 0;
  v_worker_payable numeric := 0;
  v_company_cost numeric := 0;
  v_company_margin numeric := 0;
  v_amount numeric := 0;
  v_percent_base_amount numeric := 0;
  v_signed_settlement numeric := 0;
  v_settlement_direction text := 'settled';
  v_settlement_amount numeric := 0;
  v_settlement_status text := 'due';
  v_scheme_id uuid;
  v_version_id uuid;
  v_scheme_name text;
  v_version_number integer;
  v_scheme_found boolean := false;
  v_mode text := 'manual';
  v_fixed numeric := 0;
  v_percent numeric := 0;
  v_percent_base text := 'customer_total';
  v_minimum numeric;
  v_maximum numeric;
  v_locked_at timestamptz;
begin
  perform set_config('app.finance_recalc_in_progress', '1', true);

  select *
    into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    perform set_config('app.finance_recalc_in_progress', '0', true);
    return;
  end if;

  select *
    into v_bound_snapshot
    from public.order_finance_snapshots
   where order_id = v_order.id;

  v_base_price := round(greatest(coalesce(v_order.start_price, 0), 0), 2);

  -- Legacy automatic rows are replaced by the semantic scheme snapshot.
  delete from public.order_finance_entries
   where order_id = v_order.id
     and is_system = true;

  -- Pass 1: customer charges. Percent charges use the initial order amount,
  -- avoiding formulas that recursively depend on their own result.
  for v_entry in
    select e.*
      from public.order_finance_entries e
     where e.order_id = v_order.id
       and e.is_system is not true
       and e.finance_effect = 'customer_charge'
     order by e.sort_order, e.created_at, e.id
  loop
    v_amount := public.finance_v2_compute_amount(
      v_entry.calc_mode,
      v_entry.input_amount,
      v_entry.input_percent,
      'base_price',
      v_base_price,
      v_base_price,
      v_base_price,
      0
    );
    update public.order_finance_entries
       set calculated_amount = v_amount,
           updated_at = now(),
           updated_by = auth.uid()
     where id = v_entry.id;
    v_income := v_income + v_amount;
  end loop;

  v_customer_before_discount := v_base_price + v_income;

  -- Pass 2: discounts use stable customer inputs produced by pass 1.
  for v_entry in
    select e.*
      from public.order_finance_entries e
     where e.order_id = v_order.id
       and e.is_system is not true
       and e.finance_effect = 'customer_discount'
     order by e.sort_order, e.created_at, e.id
  loop
    v_amount := public.finance_v2_compute_amount(
      v_entry.calc_mode,
      v_entry.input_amount,
      v_entry.input_percent,
      v_entry.percent_base,
      v_base_price,
      v_customer_before_discount,
      v_customer_before_discount,
      v_income
    );
    update public.order_finance_entries
       set calculated_amount = v_amount,
           updated_at = now(),
           updated_by = auth.uid()
     where id = v_entry.id;
    v_discount := v_discount + v_amount;
  end loop;

  v_customer_total := round(v_customer_before_discount - v_discount, 2);

  -- Pass 3: costs, compensation adjustments and completed transfers are all
  -- evaluated against the final, stable customer amount.
  for v_entry in
    select e.*
      from public.order_finance_entries e
     where e.order_id = v_order.id
       and e.is_system is not true
       and e.finance_effect not in ('customer_charge', 'customer_discount')
     order by e.sort_order, e.created_at, e.id
  loop
    v_effect := v_entry.finance_effect;
    v_amount := public.finance_v2_compute_amount(
      v_entry.calc_mode,
      v_entry.input_amount,
      v_entry.input_percent,
      v_entry.percent_base,
      v_base_price,
      v_customer_before_discount,
      v_customer_total,
      v_income
    );
    update public.order_finance_entries
       set calculated_amount = v_amount,
           updated_at = now(),
           updated_by = auth.uid()
     where id = v_entry.id;

    case v_effect
      when 'company_cost' then v_company_direct_cost := v_company_direct_cost + v_amount;
      when 'worker_reimbursement' then v_worker_reimbursement := v_worker_reimbursement + v_amount;
      when 'worker_bonus' then v_worker_bonus := v_worker_bonus + v_amount;
      when 'worker_deduction' then v_worker_deduction := v_worker_deduction + v_amount;
      when 'worker_payment' then v_worker_paid := v_worker_paid + v_amount;
      when 'company_remittance' then v_company_received := v_company_received + v_amount;
      else null;
    end case;
  end loop;

  -- Completed requests keep the exact version that produced their historical
  -- result. Open requests use the latest matching version.
  if v_bound_snapshot.locked_at is not null and not p_refresh_scheme then
    -- A completed order without a scheme is locked to manual calculation too;
    -- adding a company default later must not rewrite its history.
    if v_bound_snapshot.scheme_version_id is not null then
      select
        s.id as scheme_id,
        v.id as version_id,
        coalesce(v_bound_snapshot.scheme_name, s.name) as scheme_name,
        v.version_number,
        v.compensation_mode,
        v.fixed_amount,
        v.percent_value,
        v.percent_base,
        v.minimum_worker_amount,
        v.maximum_worker_amount
        into v_scheme
        from public.company_finance_scheme_versions v
        left join public.company_finance_schemes s on s.id = v.scheme_id
       where v.id = v_bound_snapshot.scheme_version_id;
      v_scheme_found := found;
    end if;
  else
    select
      s.id as scheme_id,
      v.id as version_id,
      s.name as scheme_name,
      v.version_number,
      v.compensation_mode,
      v.fixed_amount,
      v.percent_value,
      v.percent_base,
      v.minimum_worker_amount,
      v.maximum_worker_amount
      into v_scheme
      from public.company_finance_schemes s
      join public.company_finance_scheme_versions v
        on v.id = s.current_version_id
     where s.company_id = v_order.company_id
       and s.archived_at is null
       and s.is_enabled = true
       and public.finance_v2_conditions_match(
         s.conditions_json,
         v_order,
         v_customer_total,
         v_income
       )
     order by s.is_default asc, s.priority asc, s.created_at asc
     limit 1;
    v_scheme_found := found;
  end if;

  if v_scheme_found then
    v_scheme_id := v_scheme.scheme_id;
    v_version_id := v_scheme.version_id;
    v_scheme_name := v_scheme.scheme_name;
    v_version_number := v_scheme.version_number;
    v_mode := v_scheme.compensation_mode;
    v_fixed := coalesce(v_scheme.fixed_amount, 0);
    v_percent := coalesce(v_scheme.percent_value, 0);
    v_percent_base := coalesce(v_scheme.percent_base, 'customer_total');
    v_minimum := v_scheme.minimum_worker_amount;
    v_maximum := v_scheme.maximum_worker_amount;
  end if;

  v_percent_base_amount := case v_percent_base
    when 'base_price' then v_base_price
    when 'income_total' then v_income
    else v_customer_total
  end;

  v_worker_base_compensation := case v_mode
    when 'worker_percent'
      then v_percent_base_amount * v_percent / 100.0
    when 'company_percent'
      then v_customer_total - (v_percent_base_amount * v_percent / 100.0)
    when 'worker_fixed'
      then v_fixed
    when 'company_fixed'
      then v_customer_total - v_fixed
    when 'worker_fixed_plus_percent'
      then v_fixed + (v_percent_base_amount * v_percent / 100.0)
    else 0
  end;

  v_worker_base_compensation := greatest(round(v_worker_base_compensation, 2), 0);
  if v_minimum is not null then
    v_worker_base_compensation := greatest(v_worker_base_compensation, v_minimum);
  end if;
  if v_maximum is not null then
    v_worker_base_compensation := least(v_worker_base_compensation, v_maximum);
  end if;

  v_worker_compensation := round(
    greatest(v_worker_base_compensation + v_worker_bonus - v_worker_deduction, 0),
    2
  );
  v_company_cost := round(v_company_direct_cost + v_worker_reimbursement, 2);
  v_worker_payable := round(v_worker_compensation + v_worker_reimbursement, 2);
  v_company_margin := round(v_customer_total - v_worker_compensation - v_company_cost, 2);

  -- Positive signed balance means the company owes the worker; negative means
  -- the worker owes the company. Completed transfers reduce that balance.
  if coalesce(v_order.finance_money_holder, 'company') = 'executor' then
    v_signed_settlement := v_worker_payable - v_customer_total;
  else
    v_signed_settlement := v_worker_payable;
  end if;
  v_signed_settlement := round(v_signed_settlement - v_worker_paid + v_company_received, 2);

  if abs(v_signed_settlement) < 0.005 then
    v_settlement_direction := 'settled';
    v_settlement_amount := 0;
    v_settlement_status := 'settled';
  elsif v_signed_settlement > 0 then
    v_settlement_direction := 'company_to_executor';
    v_settlement_amount := v_signed_settlement;
  else
    v_settlement_direction := 'executor_to_company';
    v_settlement_amount := abs(v_signed_settlement);
  end if;

  if v_settlement_direction <> 'settled'
     and lower(coalesce(v_order.payment_status, 'unpaid')) <> 'paid' then
    v_settlement_status := 'waiting_customer_payment';
  end if;

  v_locked_at := v_bound_snapshot.locked_at;
  if v_locked_at is null
     and (
       v_order.completed_at is not null
       or lower(coalesce(v_order.status, '')) in ('done', 'completed')
     ) then
    v_locked_at := now();
  end if;

  insert into public.order_finance_snapshots (
    order_id,
    company_id,
    scheme_id,
    scheme_version_id,
    scheme_name,
    scheme_version_number,
    money_holder,
    customer_base_total,
    customer_charge_total,
    customer_discount_total,
    customer_total,
    worker_base_compensation_total,
    worker_bonus_total,
    worker_deduction_total,
    worker_compensation_total,
    worker_reimbursement_total,
    worker_payable_total,
    company_cost_total,
    company_margin_total,
    worker_paid_total,
    company_received_total,
    settlement_direction,
    settlement_amount,
    settlement_status,
    breakdown_json,
    calculated_at,
    locked_at
  ) values (
    v_order.id,
    v_order.company_id,
    v_scheme_id,
    v_version_id,
    v_scheme_name,
    v_version_number,
    coalesce(v_order.finance_money_holder, 'company'),
    round(v_base_price, 2),
    round(v_income, 2),
    round(v_discount, 2),
    round(v_customer_total, 2),
    round(v_worker_base_compensation, 2),
    round(v_worker_bonus, 2),
    round(v_worker_deduction, 2),
    round(v_worker_compensation, 2),
    round(v_worker_reimbursement, 2),
    round(v_worker_payable, 2),
    round(v_company_cost, 2),
    round(v_company_margin, 2),
    round(v_worker_paid, 2),
    round(v_company_received, 2),
    v_settlement_direction,
    round(v_settlement_amount, 2),
    v_settlement_status,
    jsonb_build_object(
      'customer', jsonb_build_object(
        'base', round(v_base_price, 2),
        'charges', round(v_income, 2),
        'discounts', round(v_discount, 2),
        'total', round(v_customer_total, 2)
      ),
      'worker', jsonb_build_object(
        'base_compensation', round(v_worker_base_compensation, 2),
        'bonuses', round(v_worker_bonus, 2),
        'deductions', round(v_worker_deduction, 2),
        'compensation', round(v_worker_compensation, 2),
        'reimbursements', round(v_worker_reimbursement, 2),
        'payable', round(v_worker_payable, 2)
      ),
      'company', jsonb_build_object(
        'direct_costs', round(v_company_direct_cost, 2),
        'total_costs', round(v_company_cost, 2),
        'margin', round(v_company_margin, 2)
      ),
      'settlement', jsonb_build_object(
        'money_holder', coalesce(v_order.finance_money_holder, 'company'),
        'worker_paid', round(v_worker_paid, 2),
        'company_received', round(v_company_received, 2),
        'direction', v_settlement_direction,
        'amount', round(v_settlement_amount, 2),
        'status', v_settlement_status
      )
    ),
    now(),
    v_locked_at
  )
  on conflict (order_id)
  do update set
    company_id = excluded.company_id,
    scheme_id = excluded.scheme_id,
    scheme_version_id = excluded.scheme_version_id,
    scheme_name = excluded.scheme_name,
    scheme_version_number = excluded.scheme_version_number,
    money_holder = excluded.money_holder,
    customer_base_total = excluded.customer_base_total,
    customer_charge_total = excluded.customer_charge_total,
    customer_discount_total = excluded.customer_discount_total,
    customer_total = excluded.customer_total,
    worker_base_compensation_total = excluded.worker_base_compensation_total,
    worker_bonus_total = excluded.worker_bonus_total,
    worker_deduction_total = excluded.worker_deduction_total,
    worker_compensation_total = excluded.worker_compensation_total,
    worker_reimbursement_total = excluded.worker_reimbursement_total,
    worker_payable_total = excluded.worker_payable_total,
    company_cost_total = excluded.company_cost_total,
    company_margin_total = excluded.company_margin_total,
    worker_paid_total = excluded.worker_paid_total,
    company_received_total = excluded.company_received_total,
    settlement_direction = excluded.settlement_direction,
    settlement_amount = excluded.settlement_amount,
    settlement_status = excluded.settlement_status,
    breakdown_json = excluded.breakdown_json,
    calculated_at = excluded.calculated_at,
    locked_at = coalesce(public.order_finance_snapshots.locked_at, excluded.locked_at);

  update public.orders
     set finance_income_total = round(v_income, 2),
         finance_discount_total = round(v_discount, 2),
         finance_expense_total = round(v_company_cost, 2),
         finance_gross_total = round(v_customer_total, 2),
         finance_net_total = round(v_company_margin, 2),
         finance_calculated_at = now()
   where id = v_order.id;

  perform set_config('app.finance_recalc_in_progress', '0', true);
exception when others then
  perform set_config('app.finance_recalc_in_progress', '0', true);
  raise;
end;
$$;

create or replace function public.recalculate_order_finance_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.recalculate_order_finance_v2(p_order_id, false);
end;
$$;

create or replace function public.trg_recalculate_order_finance_from_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(current_setting('app.finance_recalc_in_progress', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.recalculate_order_finance_v2(new.id, false);
    return new;
  end if;

  if coalesce(new.start_price, 0) is distinct from coalesce(old.start_price, 0)
     or coalesce(new.assigned_to::text, '') is distinct from coalesce(old.assigned_to::text, '')
     or coalesce(new.company_id::text, '') is distinct from coalesce(old.company_id::text, '')
     or coalesce(new.payment_method, '') is distinct from coalesce(old.payment_method, '')
     or coalesce(new.payment_status, '') is distinct from coalesce(old.payment_status, '')
     or coalesce(new.work_type_id::text, '') is distinct from coalesce(old.work_type_id::text, '')
     or coalesce(new.finance_money_holder, 'company') is distinct from coalesce(old.finance_money_holder, 'company')
     or coalesce(new.status, '') is distinct from coalesce(old.status, '') then
    perform public.recalculate_order_finance_v2(new.id, false);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_recalculate_finance on public.orders;
create trigger trg_orders_recalculate_finance
after insert or update of
  start_price,
  assigned_to,
  company_id,
  payment_method,
  payment_status,
  work_type_id,
  finance_money_holder,
  status
on public.orders
for each row execute function public.trg_recalculate_order_finance_from_order();

create or replace function public.trg_recalculate_order_finance_from_entry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_id uuid;
begin
  if coalesce(current_setting('app.finance_recalc_in_progress', true), '') = '1' then
    return coalesce(new, old);
  end if;

  v_order_id := coalesce(new.order_id, old.order_id);
  if v_order_id is not null then
    perform public.recalculate_order_finance_v2(v_order_id, false);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_order_finance_entries_recalculate on public.order_finance_entries;
create trigger trg_order_finance_entries_recalculate
after insert or update or delete
on public.order_finance_entries
for each row execute function public.trg_recalculate_order_finance_from_entry();

-- The legacy rule trigger is intentionally retired. V2 scheme changes go
-- through transactional RPCs and create immutable versions.
drop trigger if exists trg_company_finance_rules_recalculate
  on public.company_finance_rules;

create or replace function public.upsert_company_finance_scheme_v2(p_payload jsonb)
returns public.company_finance_schemes
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_company_id uuid;
  v_scheme_id uuid;
  v_scheme public.company_finance_schemes%rowtype;
  v_version_id uuid;
  v_version_number integer;
  v_name text;
  v_conditions jsonb;
  v_mode text;
  v_fixed numeric;
  v_percent numeric;
  v_percent_base text;
  v_minimum numeric;
  v_maximum numeric;
  v_is_default boolean;
  v_is_enabled boolean;
  v_priority integer;
  v_apply_existing boolean;
  v_order_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_company_id := nullif(p_payload ->> 'company_id', '')::uuid;
  if v_company_id is null or v_company_id is distinct from public.user_company_id() then
    raise exception 'Company is not accessible' using errcode = '42501';
  end if;
  if not public.current_user_has_app_permission(
    'canManageFinanceRules',
    public.finance_permission_default(public.user_role(), 'canManageFinanceRules')
  ) then
    raise exception 'Finance scheme permission required' using errcode = '42501';
  end if;

  v_scheme_id := nullif(p_payload ->> 'id', '')::uuid;
  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  v_conditions := coalesce(p_payload -> 'conditions_json', '{"op":"all","conditions":[]}'::jsonb);
  v_mode := lower(coalesce(p_payload ->> 'compensation_mode', 'manual'));
  v_fixed := greatest(coalesce(nullif(p_payload ->> 'fixed_amount', '')::numeric, 0), 0);
  v_percent := greatest(coalesce(nullif(p_payload ->> 'percent_value', '')::numeric, 0), 0);
  v_percent_base := lower(coalesce(p_payload ->> 'percent_base', 'customer_total'));
  v_minimum := nullif(p_payload ->> 'minimum_worker_amount', '')::numeric;
  v_maximum := nullif(p_payload ->> 'maximum_worker_amount', '')::numeric;
  v_is_default := coalesce((p_payload ->> 'is_default')::boolean, false);
  v_is_enabled := coalesce((p_payload ->> 'is_enabled')::boolean, true);
  v_priority := coalesce(nullif(p_payload ->> 'priority', '')::integer, 100);
  v_apply_existing := coalesce((p_payload ->> 'apply_to_existing')::boolean, false);

  if v_name = '' then raise exception 'Scheme name is required' using errcode = '23514'; end if;
  if v_mode not in (
    'worker_percent',
    'company_percent',
    'worker_fixed',
    'company_fixed',
    'worker_fixed_plus_percent',
    'manual'
  ) then
    raise exception 'Unsupported compensation mode' using errcode = '23514';
  end if;
  if v_percent_base not in ('base_price', 'customer_total', 'income_total') then
    raise exception 'Unsupported percent base' using errcode = '23514';
  end if;
  if not public.finance_v2_validate_conditions(v_conditions) then
    raise exception 'Invalid finance scheme conditions' using errcode = '23514';
  end if;
  if v_is_default then
    v_conditions := '{"op":"all","conditions":[]}'::jsonb;
  end if;
  if not v_is_default
     and jsonb_array_length(coalesce(v_conditions -> 'conditions', '[]'::jsonb)) = 0 then
    raise exception 'A non-default finance scheme requires at least one condition'
      using errcode = '23514';
  end if;
  if v_minimum is not null and v_minimum < 0 then
    raise exception 'Minimum worker amount cannot be negative' using errcode = '23514';
  end if;
  if v_maximum is not null and v_maximum < 0 then
    raise exception 'Maximum worker amount cannot be negative' using errcode = '23514';
  end if;
  if v_minimum is not null and v_maximum is not null and v_minimum > v_maximum then
    raise exception 'Minimum worker amount cannot exceed maximum' using errcode = '23514';
  end if;

  if v_is_default then
    update public.company_finance_schemes
       set is_default = false,
           updated_at = now(),
           updated_by = auth.uid()
     where company_id = v_company_id
       and archived_at is null
       and is_default = true
       and (v_scheme_id is null or id <> v_scheme_id);
  end if;

  if v_scheme_id is null then
    insert into public.company_finance_schemes (
      company_id,
      name,
      conditions_json,
      is_default,
      is_enabled,
      priority,
      created_by,
      updated_by
    ) values (
      v_company_id,
      v_name,
      v_conditions,
      v_is_default,
      v_is_enabled,
      v_priority,
      auth.uid(),
      auth.uid()
    )
    returning id into v_scheme_id;
  else
    update public.company_finance_schemes
       set name = v_name,
           conditions_json = v_conditions,
           is_default = v_is_default,
           is_enabled = v_is_enabled,
           priority = v_priority,
           archived_at = null,
           updated_at = now(),
           updated_by = auth.uid()
     where id = v_scheme_id
       and company_id = v_company_id
    returning * into v_scheme;
    if not found then
      raise exception 'Finance scheme not found' using errcode = 'P0002';
    end if;
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_version_number
    from public.company_finance_scheme_versions
   where scheme_id = v_scheme_id;

  insert into public.company_finance_scheme_versions (
    scheme_id,
    company_id,
    version_number,
    compensation_mode,
    fixed_amount,
    percent_value,
    percent_base,
    minimum_worker_amount,
    maximum_worker_amount,
    configuration_json,
    created_by
  ) values (
    v_scheme_id,
    v_company_id,
    v_version_number,
    v_mode,
    round(v_fixed, 2),
    round(v_percent, 4),
    v_percent_base,
    case when v_minimum is null then null else round(v_minimum, 2) end,
    case when v_maximum is null then null else round(v_maximum, 2) end,
    coalesce(p_payload -> 'configuration_json', '{}'::jsonb),
    auth.uid()
  )
  returning id into v_version_id;

  update public.company_finance_schemes
     set current_version_id = v_version_id,
         updated_at = now(),
         updated_by = auth.uid()
   where id = v_scheme_id
  returning * into v_scheme;

  if v_apply_existing then
    for v_order_id in
      select o.id
        from public.orders o
        left join public.order_finance_snapshots snap on snap.order_id = o.id
       where o.company_id = v_company_id
         and snap.locked_at is null
    loop
      perform public.recalculate_order_finance_v2(v_order_id, true);
    end loop;
  end if;

  return v_scheme;
end;
$$;

create or replace function public.archive_company_finance_scheme_v2(
  p_scheme_id uuid,
  p_recalculate_existing boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_scheme public.company_finance_schemes%rowtype;
  v_order_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.current_user_has_app_permission(
    'canManageFinanceRules',
    public.finance_permission_default(public.user_role(), 'canManageFinanceRules')
  ) then
    raise exception 'Finance scheme permission required' using errcode = '42501';
  end if;

  select *
    into v_scheme
    from public.company_finance_schemes
   where id = p_scheme_id
     and company_id = public.user_company_id()
   for update;
  if not found then
    raise exception 'Finance scheme not found' using errcode = 'P0002';
  end if;

  update public.company_finance_schemes
     set is_enabled = false,
         is_default = false,
         archived_at = now(),
         updated_at = now(),
         updated_by = auth.uid()
   where id = v_scheme.id;

  if p_recalculate_existing then
    for v_order_id in
      select o.id
        from public.orders o
        left join public.order_finance_snapshots snap on snap.order_id = o.id
       where o.company_id = v_scheme.company_id
         and snap.locked_at is null
    loop
      perform public.recalculate_order_finance_v2(v_order_id, true);
    end loop;
  end if;

  return true;
end;
$$;

create or replace function public.set_company_finance_scheme_enabled_v2(
  p_scheme_id uuid,
  p_is_enabled boolean,
  p_recalculate_existing boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_scheme public.company_finance_schemes%rowtype;
  v_order_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.current_user_has_app_permission(
    'canManageFinanceRules',
    public.finance_permission_default(public.user_role(), 'canManageFinanceRules')
  ) then
    raise exception 'Finance scheme permission required' using errcode = '42501';
  end if;

  select *
    into v_scheme
    from public.company_finance_schemes
   where id = p_scheme_id
     and company_id = public.user_company_id()
     and archived_at is null
   for update;
  if not found then
    raise exception 'Finance scheme not found' using errcode = 'P0002';
  end if;

  update public.company_finance_schemes
     set is_enabled = coalesce(p_is_enabled, false),
         updated_at = now(),
         updated_by = auth.uid()
   where id = v_scheme.id;

  if p_recalculate_existing then
    for v_order_id in
      select o.id
        from public.orders o
        left join public.order_finance_snapshots snap on snap.order_id = o.id
       where o.company_id = v_scheme.company_id
         and snap.locked_at is null
    loop
      perform public.recalculate_order_finance_v2(v_order_id, true);
    end loop;
  end if;

  return true;
end;
$$;

create or replace function public.set_order_finance_money_holder_v2(
  p_order_id uuid,
  p_money_holder text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_holder text := lower(coalesce(p_money_holder, 'company'));
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_holder not in ('company', 'executor') then
    raise exception 'Unsupported money holder' using errcode = '23514';
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

  update public.orders
     set finance_money_holder = v_holder,
         updated_at = now()
   where id = v_order.id;

  return true;
end;
$$;

alter table public.company_finance_schemes enable row level security;
alter table public.company_finance_scheme_versions enable row level security;
alter table public.order_finance_snapshots enable row level security;

drop policy if exists company_finance_schemes_select on public.company_finance_schemes;
create policy company_finance_schemes_select
on public.company_finance_schemes
for select
to authenticated
using (
  company_id = public.user_company_id()
  and public.current_user_has_app_permission(
    'canManageFinanceRules',
    public.finance_permission_default(public.user_role(), 'canManageFinanceRules')
  )
);

drop policy if exists company_finance_scheme_versions_select on public.company_finance_scheme_versions;
create policy company_finance_scheme_versions_select
on public.company_finance_scheme_versions
for select
to authenticated
using (
  company_id = public.user_company_id()
  and public.current_user_has_app_permission(
    'canManageFinanceRules',
    public.finance_permission_default(public.user_role(), 'canManageFinanceRules')
  )
);

drop policy if exists order_finance_snapshots_select on public.order_finance_snapshots;
create policy order_finance_snapshots_select
on public.order_finance_snapshots
for select
to authenticated
using (
  company_id = public.user_company_id()
  and public.current_user_has_app_permission(
    'canViewFinanceAll',
    public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
  )
);

revoke all on table public.company_finance_schemes from public, anon, authenticated;
revoke all on table public.company_finance_scheme_versions from public, anon, authenticated;
revoke all on table public.order_finance_snapshots from public, anon, authenticated;
grant select on table public.company_finance_schemes to authenticated, service_role;
grant select on table public.company_finance_scheme_versions to authenticated, service_role;
grant select on table public.order_finance_snapshots to authenticated, service_role;

revoke all on function public.upsert_company_finance_scheme_v2(jsonb) from public, anon;
revoke all on function public.archive_company_finance_scheme_v2(uuid, boolean) from public, anon;
revoke all on function public.set_company_finance_scheme_enabled_v2(uuid, boolean, boolean)
  from public, anon;
revoke all on function public.set_order_finance_money_holder_v2(uuid, text) from public, anon;
revoke all on function public.recalculate_order_finance_v2(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.recalculate_order_finance_totals(uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_company_finance_scheme_v2(jsonb) to authenticated, service_role;
grant execute on function public.archive_company_finance_scheme_v2(uuid, boolean) to authenticated, service_role;
grant execute on function public.set_company_finance_scheme_enabled_v2(uuid, boolean, boolean)
  to authenticated, service_role;
grant execute on function public.set_order_finance_money_holder_v2(uuid, text) to authenticated, service_role;
grant execute on function public.recalculate_order_finance_v2(uuid, boolean) to service_role;
grant execute on function public.recalculate_order_finance_totals(uuid) to service_role;

-- Convert test-mode legacy rules into one semantic scheme per rule. A rule
-- previously "assigned to executor" becomes an executor share; a rule aimed
-- at the company becomes a company share with the worker receiving the
-- remainder. Existing manual entries remain untouched.
do $migration$
declare
  v_rule public.company_finance_rules%rowtype;
  v_scheme_id uuid;
  v_version_id uuid;
  v_mode text;
  v_is_default boolean;
  v_has_no_conditions boolean;
  v_scheme_enabled boolean;
begin
  perform set_config('app.finance_recalc_in_progress', '1', true);

  for v_rule in
    select r.*
      from public.company_finance_rules r
     where r.is_enabled = true
     order by r.company_id, r.sort_order, r.created_at
  loop
    v_has_no_conditions :=
      jsonb_array_length(coalesce(v_rule.conditions_json -> 'conditions', '[]'::jsonb)) = 0;
    v_is_default :=
      v_has_no_conditions
      and not exists (
        select 1
          from public.company_finance_schemes s
         where s.company_id = v_rule.company_id
           and s.is_default = true
           and s.archived_at is null
      );
    v_scheme_enabled := not v_has_no_conditions or v_is_default;

    insert into public.company_finance_schemes (
      company_id,
      name,
      conditions_json,
      is_default,
      is_enabled,
      priority,
      created_by,
      updated_by
    ) values (
      v_rule.company_id,
      v_rule.name,
      coalesce(v_rule.conditions_json, '{"op":"all","conditions":[]}'::jsonb),
      v_is_default,
      v_scheme_enabled,
      v_rule.sort_order,
      null,
      null
    )
    returning id into v_scheme_id;

    v_mode := case
      when v_rule.recipient_mode = 'assigned_to' and v_rule.calc_mode = 'percent'
        then 'worker_percent'
      when v_rule.recipient_mode = 'assigned_to'
        then 'worker_fixed'
      when v_rule.calc_mode = 'percent'
        then 'company_percent'
      else 'company_fixed'
    end;

    insert into public.company_finance_scheme_versions (
      scheme_id,
      company_id,
      version_number,
      compensation_mode,
      fixed_amount,
      percent_value,
      percent_base,
      created_by
    ) values (
      v_scheme_id,
      v_rule.company_id,
      1,
      v_mode,
      coalesce(v_rule.fixed_amount, 0),
      coalesce(v_rule.percent_value, 0),
      case
        when v_rule.percent_base = 'base_price' then 'base_price'
        when v_rule.percent_base = 'income_total' then 'income_total'
        else 'customer_total'
      end,
      null
    )
    returning id into v_version_id;

    update public.company_finance_schemes
       set current_version_id = v_version_id
     where id = v_scheme_id;
  end loop;

  update public.company_finance_rules
     set is_enabled = false,
         updated_at = now();

  delete from public.order_finance_entries
   where is_system = true;

  perform set_config('app.finance_recalc_in_progress', '0', true);
exception when others then
  perform set_config('app.finance_recalc_in_progress', '0', true);
  raise;
end;
$migration$;

do $backfill$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select id from public.orders
  loop
    perform public.recalculate_order_finance_v2(v_order_id, true);
  end loop;
end;
$backfill$;

commit;
