-- Partial-payment accounting is optional.  New and existing companies keep
-- the original Paid / Unpaid workflow until an administrator enables it.

alter table public.companies
  add column if not exists use_partial_payments boolean not null default false;

comment on column public.companies.use_partial_payments is
  'When true, payment status is derived from order_customer_payments. When false, Paid/Unpaid is edited manually.';

create or replace function public.refresh_order_customer_payment_state_v1(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_total numeric := 0;
  v_paid numeric := 0;
  v_status text := 'unpaid';
  v_enabled boolean := false;
begin
  if p_order_id is null then
    return;
  end if;

  select
    company.use_partial_payments,
    greatest(
      coalesce(snapshot.customer_total, order_row.start_price, 0),
      0
    )
    into v_enabled, v_total
    from public.orders order_row
    join public.companies company
      on company.id = order_row.company_id
    left join public.order_finance_snapshots snapshot
      on snapshot.order_id = order_row.id
   where order_row.id = p_order_id;

  if not found or not coalesce(v_enabled, false) then
    return;
  end if;

  select coalesce(sum(payment.amount), 0)
    into v_paid
    from public.order_customer_payments payment
   where payment.order_id = p_order_id;

  v_total := round(greatest(coalesce(v_total, 0), 0), 2);
  v_paid := round(greatest(coalesce(v_paid, 0), 0), 2);
  v_status := case
    when v_paid <= 0 then 'unpaid'
    when v_total <= 0 or v_paid + 0.005 >= v_total then 'paid'
    else 'partial'
  end;

  update public.orders
     set payment_status = v_status,
         updated_at = now()
   where id = p_order_id
     and payment_status is distinct from v_status;
end;
$$;

create or replace function public.ensure_partial_payments_enabled_for_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
      from public.companies company
     where company.id = new.company_id
       and company.use_partial_payments is true
  ) then
    raise exception 'partial_payments_disabled' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_customer_payments_require_enabled
  on public.order_customer_payments;
create trigger trg_order_customer_payments_require_enabled
before insert or update
on public.order_customer_payments
for each row execute function public.ensure_partial_payments_enabled_for_write();

create or replace function public.apply_company_partial_payments_mode()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_order_id uuid;
begin
  if old.use_partial_payments is not distinct from new.use_partial_payments then
    return new;
  end if;

  if new.use_partial_payments then
    -- A company moving from the simple workflow should not lose already paid
    -- requests.  Import one opening payment only when no history exists.
    insert into public.order_customer_payments (
      company_id,
      order_id,
      amount,
      payment_method,
      paid_at,
      source,
      created_at,
      updated_at
    )
    select
      order_row.company_id,
      order_row.id,
      round(
        greatest(
          coalesce(snapshot.customer_total, order_row.start_price, 0),
          0
        ),
        2
      ),
      case
        when lower(coalesce(order_row.payment_method, 'cash')) = 'cashless'
          then 'cashless'
        else 'cash'
      end,
      coalesce(order_row.updated_at, now()),
      'legacy',
      coalesce(order_row.updated_at, now()),
      coalesce(order_row.updated_at, now())
    from public.orders order_row
    left join public.order_finance_snapshots snapshot
      on snapshot.order_id = order_row.id
    where order_row.company_id = new.id
      and order_row.payment_status = 'paid'
      and greatest(coalesce(snapshot.customer_total, order_row.start_price, 0), 0) > 0
      and not exists (
        select 1
          from public.order_customer_payments payment
         where payment.order_id = order_row.id
      );

    for v_order_id in
      select order_row.id
        from public.orders order_row
       where order_row.company_id = new.id
    loop
      perform public.refresh_order_customer_payment_state_v1(v_order_id);
    end loop;
  else
    -- The simple workflow has only Paid and Unpaid.  A partial amount is not
    -- a full payment, so its compatible state is Unpaid.  Ledger rows remain.
    update public.orders
       set payment_status = 'unpaid',
           updated_at = now()
     where company_id = new.id
       and payment_status = 'partial';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_companies_apply_partial_payments_mode
  on public.companies;
create trigger trg_companies_apply_partial_payments_mode
after update of use_partial_payments
on public.companies
for each row execute function public.apply_company_partial_payments_mode();

create or replace function public.set_company_partial_payments_enabled_v1(
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if lower(coalesce(public.user_role(), '')) <> 'admin' then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;

  v_company_id := public.user_company_id();
  if v_company_id is null then
    raise exception 'Company is not accessible' using errcode = '42501';
  end if;

  update public.companies
     set use_partial_payments = coalesce(p_enabled, false)
   where id = v_company_id;

  if not found then
    raise exception 'Company is not accessible' using errcode = '42501';
  end if;

  return true;
end;
$$;

create or replace function public.delete_order_customer_payment_v1(
  p_payment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_payment public.order_customer_payments%rowtype;
  v_partial_payments_enabled boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select payment.*
    into v_payment
    from public.order_customer_payments payment
   where payment.id = p_payment_id
   for update;

  if not found or v_payment.company_id is distinct from public.user_company_id() then
    raise exception 'Payment is not accessible' using errcode = '42501';
  end if;

  select company.use_partial_payments
    into v_partial_payments_enabled
    from public.companies company
   where company.id = v_payment.company_id;

  if not v_partial_payments_enabled then
    raise exception 'partial_payments_disabled' using errcode = '55000';
  end if;
  if not public.current_user_has_app_permission(
    'canEditFinanceEntries',
    public.finance_permission_default(public.user_role(), 'canEditFinanceEntries')
  ) then
    raise exception 'Finance edit permission required' using errcode = '42501';
  end if;
  if not public.billing_can_edit_company(v_payment.company_id) then
    raise exception 'subscription_read_only';
  end if;

  delete from public.order_customer_payments
   where id = v_payment.id;

  return true;
end;
$$;

-- A stored condition for "partially paid" stays intact while the mode is off,
-- but it cannot match until the company enables payment history again.
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
  v_partial_payments_enabled boolean;
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

      if v_expected = 'partial' then
        select company.use_partial_payments
          into v_partial_payments_enabled
          from public.companies company
         where company.id = p_order.company_id;
        if not coalesce(v_partial_payments_enabled, false) then
          return false;
        end if;
      end if;

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

revoke all on function public.set_company_partial_payments_enabled_v1(boolean)
  from public, anon;
grant execute on function public.set_company_partial_payments_enabled_v1(boolean)
  to authenticated, service_role;

notify pgrst, 'reload schema';
