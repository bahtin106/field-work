-- Customer payments are stored as an appendable ledger.  orders.payment_status
-- remains the compatibility field consumed by lists and finance conditions, but
-- its value is now derived from the ledger and the current customer total.

create table if not exists public.order_customer_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(14,2) not null,
  payment_method text not null,
  paid_at timestamptz not null default now(),
  note text,
  source text not null default 'manual',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_customer_payments_amount_check check (amount > 0),
  constraint order_customer_payments_method_check
    check (payment_method in ('cash', 'cashless')),
  constraint order_customer_payments_note_check
    check (note is null or char_length(note) <= 500),
  constraint order_customer_payments_source_check
    check (source in ('manual', 'legacy'))
);

create index if not exists idx_order_customer_payments_order_paid_at
  on public.order_customer_payments(order_id, paid_at desc, created_at desc);

create index if not exists idx_order_customer_payments_company
  on public.order_customer_payments(company_id);

comment on table public.order_customer_payments is
  'Actual customer payments for an order. Multiple rows support prepayments and installments.';
comment on column public.order_customer_payments.source is
  'manual for a regular payment; legacy for a paid status migrated before the ledger existed.';

create or replace function public.touch_order_customer_payment_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_order_customer_payments_touch
  on public.order_customer_payments;
create trigger trg_order_customer_payments_touch
before update
on public.order_customer_payments
for each row execute function public.touch_order_customer_payment_updated_at();

-- Preserve already paid test requests as one imported payment.  Unpaid
-- requests need no ledger rows.
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
where lower(coalesce(order_row.payment_status, 'unpaid')) in (
    'paid',
    'оплачено',
    'оплачен'
  )
  and greatest(coalesce(snapshot.customer_total, order_row.start_price, 0), 0) > 0
  and not exists (
    select 1
    from public.order_customer_payments payment
    where payment.order_id = order_row.id
  );

update public.orders
set payment_status = case
  when lower(coalesce(payment_status, 'unpaid')) in (
    'paid',
    'оплачено',
    'оплачен'
  ) then 'paid'
  when lower(coalesce(payment_status, 'unpaid')) = 'partial' then 'partial'
  else 'unpaid'
end
where payment_status is null
   or lower(payment_status) not in ('paid', 'partial', 'unpaid');

alter table public.orders
  alter column payment_status set default 'unpaid';

update public.orders
set payment_status = 'unpaid'
where payment_status is null;

alter table public.orders
  alter column payment_status set not null;

alter table public.orders
  drop constraint if exists orders_payment_status_check;
alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('unpaid', 'partial', 'paid'));

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
begin
  if p_order_id is null then
    return;
  end if;

  select greatest(
           coalesce(snapshot.customer_total, order_row.start_price, 0),
           0
         )
    into v_total
    from public.orders order_row
    left join public.order_finance_snapshots snapshot
      on snapshot.order_id = order_row.id
   where order_row.id = p_order_id;

  if not found then
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

create or replace function public.trg_refresh_order_customer_payment_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  perform public.refresh_order_customer_payment_state_v1(
    case when tg_op = 'DELETE' then old.order_id else new.order_id end
  );
  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    perform public.refresh_order_customer_payment_state_v1(old.order_id);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_customer_payments_refresh_status
  on public.order_customer_payments;
create trigger trg_order_customer_payments_refresh_status
after insert or update or delete
on public.order_customer_payments
for each row execute function public.trg_refresh_order_customer_payment_state();

create or replace function public.trg_refresh_payment_state_from_finance_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  perform public.refresh_order_customer_payment_state_v1(new.order_id);
  return new;
end;
$$;

drop trigger if exists trg_order_finance_snapshot_refresh_payment_state
  on public.order_finance_snapshots;
create trigger trg_order_finance_snapshot_refresh_payment_state
after insert or update of customer_total
on public.order_finance_snapshots
for each row
execute function public.trg_refresh_payment_state_from_finance_snapshot();

create or replace function public.upsert_order_customer_payment_v1(
  p_payload jsonb
)
returns public.order_customer_payments
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_existing public.order_customer_payments%rowtype;
  v_result public.order_customer_payments%rowtype;
  v_payment_id uuid;
  v_amount numeric;
  v_method text;
  v_paid_at timestamptz;
  v_note text;
  v_cash_enabled boolean;
  v_cashless_enabled boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  begin
    v_payment_id := nullif(p_payload ->> 'id', '')::uuid;
    v_amount := round((p_payload ->> 'amount')::numeric, 2);
    v_paid_at := coalesce(
      nullif(p_payload ->> 'paid_at', '')::timestamptz,
      now()
    );
  exception when others then
    raise exception 'Invalid payment data' using errcode = '23514';
  end;

  select *
    into v_order
    from public.orders
   where id = nullif(p_payload ->> 'order_id', '')::uuid
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
  if not public.billing_can_edit_company(v_order.company_id) then
    raise exception 'subscription_read_only';
  end if;

  if v_payment_id is not null then
    select *
      into v_existing
      from public.order_customer_payments payment
     where payment.id = v_payment_id
       and payment.order_id = v_order.id
       and payment.company_id = v_order.company_id
     for update;
    if not found then
      raise exception 'Payment not found' using errcode = 'P0002';
    end if;
  end if;

  v_method := lower(coalesce(p_payload ->> 'payment_method', ''));
  v_note := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');

  if v_amount is null or v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero' using errcode = '23514';
  end if;
  if v_method not in ('cash', 'cashless') then
    raise exception 'Unsupported payment method' using errcode = '23514';
  end if;
  if v_paid_at > now() + interval '5 minutes' then
    raise exception 'Payment date cannot be in the future' using errcode = '23514';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Payment note is too long' using errcode = '23514';
  end if;

  select
    company.payment_method_cash_enabled,
    company.payment_method_cashless_enabled
    into v_cash_enabled, v_cashless_enabled
    from public.companies company
   where company.id = v_order.company_id;

  if (v_method = 'cash' and not coalesce(v_cash_enabled, false))
     or (v_method = 'cashless' and not coalesce(v_cashless_enabled, false)) then
    if v_payment_id is null or v_existing.payment_method is distinct from v_method then
      raise exception 'Payment method is disabled for the company'
        using errcode = '23514';
    end if;
  end if;

  if v_payment_id is null then
    insert into public.order_customer_payments (
      company_id,
      order_id,
      amount,
      payment_method,
      paid_at,
      note,
      source,
      created_by,
      updated_by
    ) values (
      v_order.company_id,
      v_order.id,
      v_amount,
      v_method,
      v_paid_at,
      v_note,
      'manual',
      auth.uid(),
      auth.uid()
    )
    returning * into v_result;
  else
    update public.order_customer_payments
       set amount = v_amount,
           payment_method = v_method,
           paid_at = v_paid_at,
           note = v_note,
           updated_by = auth.uid()
     where id = v_payment_id
    returning * into v_result;
  end if;

  return v_result;
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
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
    into v_payment
    from public.order_customer_payments payment
   where payment.id = p_payment_id
   for update;

  if not found or v_payment.company_id is distinct from public.user_company_id() then
    raise exception 'Payment is not accessible' using errcode = '42501';
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

alter table public.order_customer_payments enable row level security;

drop policy if exists order_customer_payments_select_company
  on public.order_customer_payments;
create policy order_customer_payments_select_company
on public.order_customer_payments
for select
to authenticated
using (
  company_id = public.user_company_id()
  and (
    public.current_user_has_app_permission(
      'canViewFinanceAll',
      public.finance_permission_default(public.user_role(), 'canViewFinanceAll')
    )
    or (
      public.current_user_has_app_permission(
        'canViewFinanceOwn',
        public.finance_permission_default(public.user_role(), 'canViewFinanceOwn')
      )
      and exists (
        select 1
        from public.orders order_row
        where order_row.id = order_customer_payments.order_id
          and order_row.assigned_to = auth.uid()
      )
    )
  )
);

revoke all on table public.order_customer_payments
  from public, anon, authenticated;
grant select on table public.order_customer_payments
  to authenticated, service_role;

revoke all on function public.upsert_order_customer_payment_v1(jsonb)
  from public, anon;
revoke all on function public.delete_order_customer_payment_v1(uuid)
  from public, anon;
grant execute on function public.upsert_order_customer_payment_v1(jsonb)
  to authenticated, service_role;
grant execute on function public.delete_order_customer_payment_v1(uuid)
  to authenticated, service_role;

-- Finance schemes may now explicitly target partially paid requests.
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
      if v_scalar not in ('paid', 'partial', 'unpaid', 'any') then return false; end if;
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

notify pgrst, 'reload schema';
