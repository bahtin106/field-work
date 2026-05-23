alter table public.billing_yookassa_payments
  add column if not exists subscription_period_start timestamptz,
  add column if not exists subscription_period_end timestamptz;

with latest_paid as (
  select distinct on (p.company_id)
    p.id,
    s.current_period_start,
    s.current_period_end
  from public.billing_yookassa_payments p
  join public.company_subscriptions s on s.company_id = p.company_id
  where p.status = 'succeeded'
    and p.subscription_period_start is null
    and p.subscription_period_end is null
  order by p.company_id, p.paid_at desc nulls last, p.created_at desc
)
update public.billing_yookassa_payments p
set
  subscription_period_start = latest_paid.current_period_start,
  subscription_period_end = latest_paid.current_period_end
from latest_paid
where p.id = latest_paid.id;

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
    subscription_period_start = v_new_period_start,
    subscription_period_end = v_new_period_end,
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
