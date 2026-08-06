begin;

-- Companies that use a single payment channel should not have to select it
-- on every request. Keep the configured default separately from historical
-- request values so re-enabling the field does not rewrite the past.
alter table public.companies
  add column if not exists use_payment_methods boolean not null default true,
  add column if not exists default_payment_method text not null default 'cash';

alter table public.companies
  drop constraint if exists companies_default_payment_method_check;
alter table public.companies
  add constraint companies_default_payment_method_check
  check (default_payment_method in ('cash', 'cashless'));

comment on column public.companies.use_payment_methods is
  'Whether requests show a selectable customer payment method.';
comment on column public.companies.default_payment_method is
  'Payment method assigned to new requests while payment-method selection is disabled.';

create or replace function public.trg_apply_company_payment_method_setting()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_use_payment_methods boolean;
  v_default_payment_method text;
begin
  select company.use_payment_methods, company.default_payment_method
    into v_use_payment_methods, v_default_payment_method
    from public.companies company
   where company.id = new.company_id;

  if found and not coalesce(v_use_payment_methods, true) then
    new.payment_method := case
      when v_default_payment_method = 'cashless' then 'cashless'
      else 'cash'
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_company_payment_method_setting on public.orders;
create trigger trg_apply_company_payment_method_setting
before insert or update of company_id, payment_method
on public.orders
for each row execute function public.trg_apply_company_payment_method_setting();

-- A hidden payment-method field must not leave invisible conditions active in
-- finance schemes. The condition is preserved and starts working again when
-- the company enables payment-method selection.
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
      v_expected := lower(coalesce(v_value #>> '{}', ''));
      if v_expected <> 'any' and not exists (
        select 1
          from public.companies company
         where company.id = p_order.company_id
           and company.use_payment_methods is true
      ) then
        return false;
      end if;
      v_actual := lower(coalesce(p_order.payment_method, 'cash'));
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

create or replace function public.trg_recalculate_finance_on_work_types_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_id uuid;
begin
  if old.use_work_types is not distinct from new.use_work_types
     and old.use_payment_methods is not distinct from new.use_payment_methods then
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
after update of use_work_types, use_payment_methods
on public.companies
for each row execute function public.trg_recalculate_finance_on_work_types_change();

commit;
