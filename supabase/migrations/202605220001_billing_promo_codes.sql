alter table public.company_subscriptions
  add column if not exists last_promo_code text,
  add column if not exists last_promo_discount_type text,
  add column if not exists last_promo_discount_value numeric(12,2),
  add column if not exists last_promo_discount_amount numeric(12,2);

alter table public.billing_yookassa_payments
  add column if not exists amount_before_discount numeric(12,2),
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists promo_code text,
  add column if not exists promo_code_id uuid,
  add column if not exists promo_discount_type text,
  add column if not exists promo_discount_value numeric(12,2);

create table if not exists public.billing_promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(12,2) not null check (discount_value >= 0),
  valid_until timestamptz,
  is_active boolean not null default true,
  comment text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_billing_promo_codes_code_lower
  on public.billing_promo_codes (lower(btrim(code)));

create index if not exists idx_billing_promo_codes_active_valid
  on public.billing_promo_codes (is_active, valid_until);

alter table public.billing_yookassa_payments
  drop constraint if exists billing_yookassa_payments_promo_code_id_fkey;

alter table public.billing_yookassa_payments
  add constraint billing_yookassa_payments_promo_code_id_fkey
  foreign key (promo_code_id) references public.billing_promo_codes(id) on delete set null;

create or replace function public.touch_billing_promo_codes_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_billing_promo_codes_updated_at on public.billing_promo_codes;
create trigger trg_billing_promo_codes_updated_at
before update on public.billing_promo_codes
for each row execute function public.touch_billing_promo_codes_updated_at();

create or replace function public.deactivate_expired_billing_promo_codes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer := 0;
begin
  update public.billing_promo_codes
  set is_active = false,
      updated_at = now()
  where is_active = true
    and valid_until is not null
    and valid_until < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.admin_list_billing_promo_codes()
returns table (
  id uuid,
  code text,
  name text,
  discount_type text,
  discount_value numeric,
  valid_until timestamptz,
  is_active boolean,
  comment text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'super admin access required' using errcode = '42501';
  end if;

  perform public.deactivate_expired_billing_promo_codes();

  return query
  select
    p.id,
    p.code,
    p.name,
    p.discount_type,
    p.discount_value,
    p.valid_until,
    p.is_active,
    p.comment,
    p.created_at,
    p.updated_at
  from public.billing_promo_codes p
  order by p.created_at desc, p.code asc;
end;
$function$;

create or replace function public.admin_upsert_billing_promo_code(
  p_id uuid,
  p_code text,
  p_name text,
  p_discount_type text,
  p_discount_value numeric,
  p_valid_until timestamptz,
  p_is_active boolean,
  p_comment text
)
returns public.billing_promo_codes
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.billing_promo_codes%rowtype;
  v_user_id uuid := auth.uid();
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_type text := lower(btrim(coalesce(p_discount_type, '')));
  v_value numeric := coalesce(p_discount_value, 0);
begin
  if not public.is_super_admin() then
    raise exception 'super admin access required' using errcode = '42501';
  end if;

  if v_code = '' then
    raise exception 'promo code is required';
  end if;

  if v_name = '' then
    v_name := v_code;
  end if;

  if v_type not in ('percent', 'fixed') then
    raise exception 'discount type must be percent or fixed';
  end if;

  if v_value < 0 then
    raise exception 'discount value must be non-negative';
  end if;

  if v_type = 'percent' and v_value > 100 then
    raise exception 'percent discount cannot be greater than 100';
  end if;

  perform public.deactivate_expired_billing_promo_codes();

  if p_id is null then
    insert into public.billing_promo_codes (
      code, name, discount_type, discount_value, valid_until, is_active, comment, created_by
    )
    values (
      v_code, v_name, v_type, round(v_value, 2), p_valid_until, coalesce(p_is_active, true), nullif(p_comment, ''), v_user_id
    )
    returning * into v_row;
  else
    update public.billing_promo_codes
    set
      code = v_code,
      name = v_name,
      discount_type = v_type,
      discount_value = round(v_value, 2),
      valid_until = p_valid_until,
      is_active = coalesce(p_is_active, true),
      comment = nullif(p_comment, '')
    where id = p_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'promo code was not found';
    end if;
  end if;

  return v_row;
end;
$function$;

create or replace function public.validate_billing_promo_code(
  p_code text,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_amount numeric := greatest(coalesce(p_amount, 0), 0);
  v_row public.billing_promo_codes%rowtype;
  v_discount numeric := 0;
  v_final numeric := v_amount;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'code', 'empty', 'error', 'Введите промокод');
  end if;

  select * into v_row
  from public.billing_promo_codes
  where lower(btrim(code)) = lower(v_code)
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Промокод не найден');
  end if;

  if v_row.valid_until is not null and v_row.valid_until < now() then
    update public.billing_promo_codes
    set is_active = false,
        updated_at = now()
    where id = v_row.id;

    return jsonb_build_object('ok', false, 'code', 'expired', 'error', 'Срок действия промокода истек');
  end if;

  if v_row.is_active is not true then
    return jsonb_build_object('ok', false, 'code', 'inactive', 'error', 'Промокод неактивен');
  end if;

  if v_row.discount_type = 'percent' then
    v_discount := round(v_amount * least(v_row.discount_value, 100) / 100, 2);
  else
    v_discount := round(least(v_row.discount_value, v_amount), 2);
  end if;

  if v_amount > 0 then
    v_discount := least(v_discount, greatest(v_amount - 1, 0));
  end if;

  v_final := round(greatest(v_amount - v_discount, 0), 2);

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'code', v_row.code,
    'name', v_row.name,
    'discount_type', v_row.discount_type,
    'discount_value', v_row.discount_value,
    'discount_amount', v_discount,
    'amount_before_discount', v_amount,
    'amount_after_discount', v_final,
    'valid_until', v_row.valid_until
  );
end;
$function$;

create or replace function public.apply_yookassa_subscription_payment(
  p_yookassa_payment_id text,
  p_company_id uuid,
  p_user_id uuid,
  p_paid_seats_total integer,
  p_period_months integer,
  p_amount_value numeric,
  p_currency text,
  p_raw_payment jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payment public.billing_yookassa_payments%rowtype;
  v_subscription public.company_subscriptions%rowtype;
  v_now timestamptz := now();
  v_old_period_end timestamptz;
  v_new_period_start timestamptz;
  v_new_period_end timestamptz;
  v_scheduled_downgrade boolean := false;
begin
  if p_yookassa_payment_id is null or length(trim(p_yookassa_payment_id)) = 0 then
    raise exception 'yookassa payment id is required';
  end if;

  if p_company_id is null or p_user_id is null then
    raise exception 'company_id and user_id are required';
  end if;

  if p_paid_seats_total is null or p_paid_seats_total < 1 then
    raise exception 'paid seats total must be >= 1';
  end if;

  if p_period_months is null or p_period_months < 1 then
    raise exception 'period months must be >= 1';
  end if;

  select * into v_payment
  from public.billing_yookassa_payments
  where yookassa_payment_id = p_yookassa_payment_id
  for update;

  if v_payment.id is null then
    insert into public.billing_yookassa_payments (
      company_id,
      user_id,
      yookassa_payment_id,
      idempotence_key,
      status,
      amount_value,
      amount_before_discount,
      currency,
      paid_seats_total,
      period_months,
      period_id,
      raw_payment
    )
    values (
      p_company_id,
      p_user_id,
      p_yookassa_payment_id,
      p_yookassa_payment_id,
      'succeeded',
      p_amount_value,
      p_amount_value,
      coalesce(nullif(p_currency, ''), 'RUB'),
      p_paid_seats_total,
      p_period_months,
      'external',
      coalesce(p_raw_payment, '{}'::jsonb)
    )
    returning * into v_payment;
  end if;

  if v_payment.applied_at is not null then
    return jsonb_build_object('ok', true, 'already_applied', true, 'payment_id', v_payment.id);
  end if;

  if v_payment.company_id <> p_company_id or v_payment.user_id <> p_user_id then
    raise exception 'payment owner mismatch';
  end if;

  v_subscription := public.ensure_company_subscription(p_company_id);
  v_old_period_end := v_subscription.current_period_end;
  v_new_period_start := greatest(v_now, v_subscription.current_period_end);
  v_new_period_end := v_new_period_start + make_interval(months => p_period_months);

  update public.company_subscriptions
  set
    status = 'active',
    current_period_start = v_new_period_start,
    current_period_end = v_new_period_end,
    source = 'yookassa',
    cancel_at_period_end = false,
    paid_seats_total = case
      when v_subscription.current_period_end > v_now and p_paid_seats_total < v_subscription.paid_seats_total
        then v_subscription.paid_seats_total
      else p_paid_seats_total
    end,
    pending_paid_seats_total = case
      when v_subscription.current_period_end > v_now and p_paid_seats_total < v_subscription.paid_seats_total
        then p_paid_seats_total
      else null
    end,
    pending_apply_at = case
      when v_subscription.current_period_end > v_now and p_paid_seats_total < v_subscription.paid_seats_total
        then v_old_period_end
      else null
    end,
    last_promo_code = v_payment.promo_code,
    last_promo_discount_type = v_payment.promo_discount_type,
    last_promo_discount_value = v_payment.promo_discount_value,
    last_promo_discount_amount = nullif(v_payment.discount_amount, 0),
    updated_at = v_now
  where company_id = p_company_id
  returning * into v_subscription;

  v_scheduled_downgrade := v_subscription.pending_paid_seats_total is not null;

  if v_scheduled_downgrade then
    perform public.auto_restore_seats_after_increase(p_company_id);
  else
    perform public.enforce_seat_limit(p_company_id);
    perform public.auto_restore_seats_after_increase(p_company_id);
  end if;

  update public.billing_yookassa_payments
  set
    status = 'succeeded',
    amount_value = p_amount_value,
    currency = coalesce(nullif(p_currency, ''), 'RUB'),
    paid_seats_total = p_paid_seats_total,
    period_months = p_period_months,
    paid_at = coalesce(paid_at, v_now),
    applied_at = v_now,
    raw_payment = coalesce(p_raw_payment, raw_payment, '{}'::jsonb),
    updated_at = v_now
  where id = v_payment.id;

  return jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'company_id', p_company_id,
    'current_period_start', v_new_period_start,
    'current_period_end', v_new_period_end,
    'paid_seats_total', v_subscription.paid_seats_total,
    'scheduled_downgrade', v_scheduled_downgrade,
    'pending_paid_seats_total', v_subscription.pending_paid_seats_total,
    'pending_apply_at', v_subscription.pending_apply_at,
    'promo_code', v_payment.promo_code,
    'promo_discount_amount', v_payment.discount_amount
  );
end;
$function$;

revoke all on function public.admin_list_billing_promo_codes() from public;
revoke all on function public.admin_upsert_billing_promo_code(uuid, text, text, text, numeric, timestamptz, boolean, text) from public;
revoke all on function public.validate_billing_promo_code(text, numeric) from public;
grant execute on function public.admin_list_billing_promo_codes() to authenticated;
grant execute on function public.admin_upsert_billing_promo_code(uuid, text, text, text, numeric, timestamptz, boolean, text) to authenticated;
grant execute on function public.validate_billing_promo_code(text, numeric) to authenticated, service_role;
