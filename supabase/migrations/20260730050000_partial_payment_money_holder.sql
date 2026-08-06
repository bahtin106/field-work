-- In the partial-payment workflow, different customer payments may be
-- received by different parties. Keep the order-level holder for the simple
-- Paid / Unpaid workflow and store the actual holder on every ledger row.

alter table public.order_customer_payments
  add column if not exists money_holder text;

-- Backfill is metadata normalization, not a user edit. Temporarily suppress
-- write-mode checks and audit/status triggers so historical timestamps remain
-- intact, including rows belonging to companies where the mode is now off.
alter table public.order_customer_payments
  disable trigger trg_order_customer_payments_require_enabled;
alter table public.order_customer_payments
  disable trigger trg_order_customer_payments_touch;
alter table public.order_customer_payments
  disable trigger trg_order_customer_payments_refresh_status;

update public.order_customer_payments payment
   set money_holder = coalesce(order_row.finance_money_holder, 'company')
  from public.orders order_row
 where order_row.id = payment.order_id
   and payment.money_holder is null;

alter table public.order_customer_payments
  enable trigger trg_order_customer_payments_require_enabled;
alter table public.order_customer_payments
  enable trigger trg_order_customer_payments_touch;
alter table public.order_customer_payments
  enable trigger trg_order_customer_payments_refresh_status;

alter table public.order_customer_payments
  alter column money_holder set default 'company',
  alter column money_holder set not null;

alter table public.order_customer_payments
  drop constraint if exists order_customer_payments_money_holder_check;
alter table public.order_customer_payments
  add constraint order_customer_payments_money_holder_check
  check (money_holder in ('company', 'executor'));

comment on column public.order_customer_payments.money_holder is
  'The party that actually received this customer payment: company or executor.';

create or replace function public.refresh_order_finance_settlement_v3(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_snapshot public.order_finance_snapshots%rowtype;
  v_partial_payments_enabled boolean := false;
  v_work_mode text := 'company';
  v_customer_received_by_company numeric := 0;
  v_customer_received_by_executor numeric := 0;
  v_signed_settlement numeric := 0;
  v_direction text := 'settled';
  v_amount numeric := 0;
  v_status text := 'due';
  v_breakdown jsonb := '{}'::jsonb;
begin
  if p_order_id is null then
    return;
  end if;

  select *
    into v_order
    from public.orders
   where id = p_order_id;

  if not found then
    return;
  end if;

  select
    company.use_partial_payments,
    company.work_mode
    into v_partial_payments_enabled, v_work_mode
    from public.companies company
   where company.id = v_order.company_id;

  select *
    into v_snapshot
    from public.order_finance_snapshots
   where order_id = p_order_id
   for update;

  if not found then
    return;
  end if;

  if coalesce(v_work_mode, 'company') = 'solo' then
    v_signed_settlement := 0;
  elsif coalesce(v_partial_payments_enabled, false) then
    select
      coalesce(sum(payment.amount) filter (
        where payment.money_holder = 'company'
      ), 0),
      coalesce(sum(payment.amount) filter (
        where payment.money_holder = 'executor'
      ), 0)
      into
        v_customer_received_by_company,
        v_customer_received_by_executor
      from public.order_customer_payments payment
     where payment.order_id = p_order_id;

    -- The executor's customer receipts already cover the same amount of the
    -- worker entitlement. Completed transfers then reduce the remaining debt.
    v_signed_settlement :=
      coalesce(v_snapshot.worker_payable_total, 0)
      - v_customer_received_by_executor
      - coalesce(v_snapshot.worker_paid_total, 0)
      + coalesce(v_snapshot.company_received_total, 0);
  else
    -- Preserve the original order-level behavior in the simple workflow.
    if coalesce(v_order.finance_money_holder, 'company') = 'executor' then
      v_customer_received_by_executor :=
        coalesce(v_snapshot.customer_total, 0);
    else
      v_customer_received_by_company :=
        coalesce(v_snapshot.customer_total, 0);
    end if;

    v_signed_settlement :=
      coalesce(v_snapshot.worker_payable_total, 0)
      - v_customer_received_by_executor
      - coalesce(v_snapshot.worker_paid_total, 0)
      + coalesce(v_snapshot.company_received_total, 0);
  end if;

  v_signed_settlement := round(coalesce(v_signed_settlement, 0), 2);
  v_customer_received_by_company :=
    round(coalesce(v_customer_received_by_company, 0), 2);
  v_customer_received_by_executor :=
    round(coalesce(v_customer_received_by_executor, 0), 2);

  if abs(v_signed_settlement) < 0.005 then
    v_direction := 'settled';
    v_amount := 0;
    v_status := 'settled';
  elsif v_signed_settlement > 0 then
    v_direction := 'company_to_executor';
    v_amount := v_signed_settlement;
  else
    v_direction := 'executor_to_company';
    v_amount := abs(v_signed_settlement);
  end if;

  if v_direction <> 'settled'
     and lower(coalesce(v_order.payment_status, 'unpaid')) <> 'paid' then
    v_status := 'waiting_customer_payment';
  end if;

  v_breakdown := coalesce(v_snapshot.breakdown_json, '{}'::jsonb);
  v_breakdown := jsonb_set(
    v_breakdown,
    '{settlement}',
    coalesce(v_breakdown -> 'settlement', '{}'::jsonb)
      || jsonb_build_object(
        'money_holder',
        case
          when coalesce(v_work_mode, 'company') = 'solo' then 'company'
          when coalesce(v_partial_payments_enabled, false) then 'per_payment'
          else coalesce(v_order.finance_money_holder, 'company')
        end,
        'customer_received_by_company', v_customer_received_by_company,
        'customer_received_by_executor', v_customer_received_by_executor,
        'worker_paid', round(coalesce(v_snapshot.worker_paid_total, 0), 2),
        'company_received', round(coalesce(v_snapshot.company_received_total, 0), 2),
        'direction', v_direction,
        'amount', round(v_amount, 2),
        'status', v_status
      ),
    true
  );

  update public.order_finance_snapshots
     set settlement_direction = v_direction,
         settlement_amount = round(v_amount, 2),
         settlement_status = v_status,
         breakdown_json = v_breakdown
   where order_id = p_order_id
     and (
       settlement_direction is distinct from v_direction
       or settlement_amount is distinct from round(v_amount, 2)
       or settlement_status is distinct from v_status
       or breakdown_json is distinct from v_breakdown
     );
end;
$$;

create or replace function public.trg_refresh_order_customer_payment_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_order_id uuid;
  v_old_order_id uuid;
begin
  v_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  v_old_order_id := case when tg_op = 'UPDATE' then old.order_id else null end;

  perform public.refresh_order_customer_payment_state_v1(v_order_id);
  perform public.refresh_order_finance_settlement_v3(v_order_id);

  if v_old_order_id is not null and v_old_order_id is distinct from v_order_id then
    perform public.refresh_order_customer_payment_state_v1(v_old_order_id);
    perform public.refresh_order_finance_settlement_v3(v_old_order_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.trg_refresh_payment_state_from_finance_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  perform public.refresh_order_customer_payment_state_v1(new.order_id);
  perform public.refresh_order_finance_settlement_v3(new.order_id);
  return new;
end;
$$;

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
  v_money_holder text;
  v_paid_at timestamptz;
  v_note text;
  v_cash_enabled boolean;
  v_cashless_enabled boolean;
  v_work_mode text;
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
  v_money_holder := lower(coalesce(
    nullif(p_payload ->> 'money_holder', ''),
    case when v_payment_id is not null then v_existing.money_holder end,
    v_order.finance_money_holder,
    'company'
  ));
  v_note := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');

  if v_amount is null or v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero' using errcode = '23514';
  end if;
  if v_method not in ('cash', 'cashless') then
    raise exception 'Unsupported payment method' using errcode = '23514';
  end if;
  if v_money_holder not in ('company', 'executor') then
    raise exception 'Unsupported payment money holder' using errcode = '23514';
  end if;
  if v_paid_at > now() + interval '5 minutes' then
    raise exception 'Payment date cannot be in the future' using errcode = '23514';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Payment note is too long' using errcode = '23514';
  end if;

  select
    company.payment_method_cash_enabled,
    company.payment_method_cashless_enabled,
    company.work_mode
    into v_cash_enabled, v_cashless_enabled, v_work_mode
    from public.companies company
   where company.id = v_order.company_id;

  if coalesce(v_work_mode, 'company') = 'solo' then
    v_money_holder := 'company';
  end if;

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
      money_holder,
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
      v_money_holder,
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
           money_holder = v_money_holder,
           paid_at = v_paid_at,
           note = v_note,
           updated_by = auth.uid()
     where id = v_payment_id
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

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
    insert into public.order_customer_payments (
      company_id,
      order_id,
      amount,
      payment_method,
      money_holder,
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
      case
        when new.work_mode = 'solo' then 'company'
        else coalesce(order_row.finance_money_holder, 'company')
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
      perform public.refresh_order_finance_settlement_v3(v_order_id);
    end loop;
  else
    update public.orders
       set payment_status = 'unpaid',
           updated_at = now()
     where company_id = new.id
       and payment_status = 'partial';

    for v_order_id in
      select order_row.id
        from public.orders order_row
       where order_row.company_id = new.id
    loop
      perform public.refresh_order_finance_settlement_v3(v_order_id);
    end loop;
  end if;

  return new;
end;
$$;

do $backfill$
declare
  v_order_id uuid;
begin
  for v_order_id in
    select distinct payment.order_id
      from public.order_customer_payments payment
  loop
    perform public.refresh_order_finance_settlement_v3(v_order_id);
  end loop;
end;
$backfill$;

revoke all on function public.refresh_order_finance_settlement_v3(uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
