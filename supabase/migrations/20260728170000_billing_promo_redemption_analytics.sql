begin;

create index if not exists idx_billing_yookassa_payments_paid_promo
  on public.billing_yookassa_payments (promo_code_id, paid_at desc)
  include (company_id, discount_amount)
  where promo_code_id is not null
    and status = 'succeeded'
    and paid_at is not null;

create or replace function public.admin_list_billing_promo_codes_v2()
returns table(
  id uuid,
  code text,
  name text,
  discount_type text,
  discount_value numeric,
  valid_until timestamptz,
  is_active boolean,
  comment text,
  created_at timestamptz,
  updated_at timestamptz,
  successful_redemptions bigint,
  unique_companies_count bigint,
  total_discount_amount numeric,
  last_redeemed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.admin_assert_super_admin();
  perform public.deactivate_expired_billing_promo_codes();

  return query
  select
    promo.id,
    promo.code,
    promo.name,
    promo.discount_type,
    promo.discount_value,
    promo.valid_until,
    promo.is_active,
    promo.comment,
    promo.created_at,
    promo.updated_at,
    count(payment.id) as successful_redemptions,
    count(distinct payment.company_id) as unique_companies_count,
    coalesce(sum(payment.discount_amount), 0)::numeric as total_discount_amount,
    max(payment.paid_at) as last_redeemed_at
  from public.billing_promo_codes promo
  left join public.billing_yookassa_payments payment
    on payment.promo_code_id = promo.id
    and payment.status = 'succeeded'
    and payment.paid_at is not null
  group by promo.id
  order by promo.created_at desc, promo.code asc;
end;
$function$;

create or replace function public.admin_create_billing_promo_code(
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
set search_path = public
as $function$
declare
  v_row public.billing_promo_codes%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_type text := lower(btrim(coalesce(p_discount_type, '')));
  v_value numeric := coalesce(p_discount_value, 0);
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.admin_assert_super_admin();

  if v_code = '' then
    raise exception 'promo code is required';
  end if;

  if length(v_code) > 64 then
    raise exception 'promo code is too long';
  end if;

  if v_name = '' then
    v_name := v_code;
  end if;

  if length(v_name) > 128 then
    raise exception 'promo code name is too long';
  end if;

  if v_type not in ('percent', 'fixed') then
    raise exception 'discount type must be percent or fixed';
  end if;

  if v_value <= 0 then
    raise exception 'discount value must be greater than zero';
  end if;

  if v_type = 'percent' and v_value > 100 then
    raise exception 'percent discount cannot be greater than 100';
  end if;

  if p_valid_until is not null and p_valid_until <= now() then
    raise exception 'promo code expiration must be in the future';
  end if;

  if length(coalesce(v_comment, '')) > 2000 then
    raise exception 'promo code comment is too long';
  end if;

  insert into public.billing_promo_codes (
    code,
    name,
    discount_type,
    discount_value,
    valid_until,
    is_active,
    comment,
    created_by
  )
  values (
    v_code,
    v_name,
    v_type,
    round(v_value, 2),
    p_valid_until,
    coalesce(p_is_active, true),
    v_comment,
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.admin_set_billing_promo_code_active(
  p_id uuid,
  p_is_active boolean
)
returns public.billing_promo_codes
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.billing_promo_codes%rowtype;
begin
  perform public.admin_assert_super_admin();

  if p_id is null then
    raise exception 'promo code id is required';
  end if;

  select *
  into v_row
  from public.billing_promo_codes
  where id = p_id
  for update;

  if v_row.id is null then
    raise exception 'promo code was not found';
  end if;

  if coalesce(p_is_active, false)
    and v_row.valid_until is not null
    and v_row.valid_until <= now()
  then
    raise exception 'expired promo code cannot be activated';
  end if;

  update public.billing_promo_codes
  set is_active = coalesce(p_is_active, false)
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.admin_delete_billing_promo_code(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_deleted_id uuid;
begin
  perform public.admin_assert_super_admin();

  if p_id is null then
    raise exception 'promo code id is required';
  end if;

  delete from public.billing_promo_codes
  where id = p_id
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'promo code was not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_deleted_id);
end;
$function$;

revoke all on function public.admin_list_billing_promo_codes_v2() from public, anon;
revoke all on function public.admin_create_billing_promo_code(
  text,
  text,
  text,
  numeric,
  timestamptz,
  boolean,
  text
) from public, anon;
revoke all on function public.admin_set_billing_promo_code_active(uuid, boolean) from public, anon;
revoke all on function public.admin_delete_billing_promo_code(uuid) from public, anon;

grant execute on function public.admin_list_billing_promo_codes_v2() to authenticated, service_role;
grant execute on function public.admin_create_billing_promo_code(
  text,
  text,
  text,
  numeric,
  timestamptz,
  boolean,
  text
) to authenticated, service_role;
grant execute on function public.admin_set_billing_promo_code_active(uuid, boolean)
  to authenticated, service_role;
grant execute on function public.admin_delete_billing_promo_code(uuid)
  to authenticated, service_role;

commit;
