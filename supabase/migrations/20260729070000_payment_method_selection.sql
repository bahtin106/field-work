begin;

-- A company must offer at least one way for a customer to pay.  Keeping each
-- method as a separate setting makes it possible to use one fixed method or
-- give the user a choice of both methods in a request.
alter table public.companies
  add column if not exists payment_method_cash_enabled boolean not null default true,
  add column if not exists payment_method_cashless_enabled boolean not null default true;

alter table public.companies
  drop constraint if exists companies_payment_method_availability_check;
alter table public.companies
  add constraint companies_payment_method_availability_check
  check (payment_method_cash_enabled or payment_method_cashless_enabled);

comment on column public.companies.payment_method_cash_enabled is
  'Whether customers may pay requests in cash.';
comment on column public.companies.payment_method_cashless_enabled is
  'Whether customers may pay requests cashlessly.';

-- Preserve the previous setting when upgrading: a hidden selector meant that
-- the old default was the only available method.  Older application versions
-- should continue to show the field rather than hiding the new configuration.
drop trigger if exists trg_recalculate_finance_on_work_types_change on public.companies;

update public.companies
set payment_method_cash_enabled = case
      when use_payment_methods is false then default_payment_method = 'cash'
      else true
    end,
    payment_method_cashless_enabled = case
      when use_payment_methods is false then default_payment_method = 'cashless'
      else true
    end;

update public.companies
set default_payment_method = case
      when payment_method_cash_enabled then 'cash'
      else 'cashless'
    end,
    use_payment_methods = true
where default_payment_method is distinct from case
        when payment_method_cash_enabled then 'cash'
        else 'cashless'
      end
   or use_payment_methods is distinct from true;

-- Keep inserts and legacy clients inside the methods enabled by the company.
-- If a client sends an unavailable method, a single available method is used
-- automatically instead of allowing an invisible inconsistent value.
create or replace function public.trg_apply_company_payment_method_setting()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cash_enabled boolean;
  v_cashless_enabled boolean;
  v_default_payment_method text;
  v_requested_payment_method text;
begin
  select
    company.payment_method_cash_enabled,
    company.payment_method_cashless_enabled,
    company.default_payment_method
    into v_cash_enabled, v_cashless_enabled, v_default_payment_method
    from public.companies company
   where company.id = new.company_id;

  if not found then
    return new;
  end if;

  v_requested_payment_method := lower(coalesce(new.payment_method, ''));
  if (v_requested_payment_method = 'cash' and v_cash_enabled)
     or (v_requested_payment_method = 'cashless' and v_cashless_enabled) then
    return new;
  end if;

  new.payment_method := case
    when v_default_payment_method = 'cashless' and v_cashless_enabled then 'cashless'
    when v_cash_enabled then 'cash'
    else 'cashless'
  end;
  return new;
end;
$$;

-- A scheme may only match a payment-method condition if that method is
-- available for the company.  The special value "any" remains unconditional.
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
  v_cash_enabled boolean;
  v_cashless_enabled boolean;
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
      if v_expected <> 'any' then
        select
          company.payment_method_cash_enabled,
          company.payment_method_cashless_enabled
          into v_cash_enabled, v_cashless_enabled
          from public.companies company
         where company.id = p_order.company_id;

        if not found
           or (v_expected = 'cash' and not v_cash_enabled)
           or (v_expected = 'cashless' and not v_cashless_enabled) then
          return false;
        end if;
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

-- When a company leaves a single payment method, normalize only requests
-- whose financial history is not locked.  Their ordinary order trigger then
-- recalculates finance; completed requests keep their actual historical value.
create or replace function public.trg_normalize_payment_methods_on_company_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_single_payment_method text;
begin
  if old.payment_method_cash_enabled is not distinct from new.payment_method_cash_enabled
     and old.payment_method_cashless_enabled is not distinct from new.payment_method_cashless_enabled then
    return new;
  end if;

  v_single_payment_method := case
    when new.payment_method_cash_enabled and not new.payment_method_cashless_enabled then 'cash'
    when new.payment_method_cashless_enabled and not new.payment_method_cash_enabled then 'cashless'
    else null
  end;

  if v_single_payment_method is not null then
    update public.orders order_row
       set payment_method = v_single_payment_method
     where order_row.company_id = new.id
       and order_row.payment_method is distinct from v_single_payment_method
       and not exists (
         select 1
           from public.order_finance_snapshots snapshot
          where snapshot.order_id = order_row.id
            and snapshot.locked_at is not null
       );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_payment_methods_on_company_change on public.companies;
create trigger trg_normalize_payment_methods_on_company_change
after update of payment_method_cash_enabled, payment_method_cashless_enabled
on public.companies
for each row execute function public.trg_normalize_payment_methods_on_company_change();

-- The old combined trigger is split again: payment-method availability updates
-- are handled above, while work-type visibility keeps its established recalc.
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

create trigger trg_recalculate_finance_on_work_types_change
after update of use_work_types
on public.companies
for each row execute function public.trg_recalculate_finance_on_work_types_change();

commit;
