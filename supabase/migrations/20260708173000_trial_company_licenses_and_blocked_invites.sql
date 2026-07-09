create or replace function public.ensure_company_subscription(
  p_company_id uuid,
  p_paid_seats_total integer,
  p_owner_seats integer,
  p_free_member_seats integer,
  p_trial_days integer
)
returns public.company_subscriptions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sub public.company_subscriptions%rowtype;
  v_requested_paid_seats int;
  v_trial_days int;
  v_raise_existing boolean;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'company not found: %', p_company_id;
  end if;

  v_requested_paid_seats := greatest(
    1,
    case
      when p_paid_seats_total is not null then nullif(p_paid_seats_total, 0)
      when p_owner_seats is not null or p_free_member_seats is not null then
        nullif(coalesce(p_owner_seats, 1) + coalesce(p_free_member_seats, 0), 0)
      else 10
    end
  );
  v_trial_days := greatest(1, coalesce(p_trial_days, 14));
  v_raise_existing := p_paid_seats_total is not null
    or p_owner_seats is not null
    or p_free_member_seats is not null;

  select * into v_sub
  from public.company_subscriptions
  where company_id = p_company_id
  limit 1;

  if v_sub.id is null then
    insert into public.company_subscriptions (
      company_id,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      source,
      paid_seats_total
    ) values (
      p_company_id,
      'active',
      now(),
      public.subscription_reporting_timestamp(now() + make_interval(days => v_trial_days)),
      false,
      'manual',
      v_requested_paid_seats
    )
    returning * into v_sub;

    return v_sub;
  end if;

  update public.company_subscriptions
  set
    current_period_end = case
      when current_period_end is not null
        then public.subscription_reporting_timestamp(current_period_end)
      else current_period_end
    end,
    status = case
      when current_period_end is not null
       and public.subscription_reporting_timestamp(current_period_end) >= now()
        then 'active'
      else 'expired'
    end,
    paid_seats_total = case
      when v_raise_existing
       and current_period_end is not null
       and public.subscription_reporting_timestamp(current_period_end) >= now()
        then greatest(v_requested_paid_seats, coalesce(paid_seats_total, 1))
      else greatest(1, coalesce(paid_seats_total, 1))
    end,
    updated_at = now()
  where id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$function$;

create or replace function public.ensure_company_subscription(p_company_id uuid)
returns public.company_subscriptions
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public.ensure_company_subscription(p_company_id, null, null, null, null);
end;
$function$;
