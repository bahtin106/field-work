begin;

drop function if exists public.admin_delete_billing_promo_code(uuid);
drop function if exists public.admin_set_billing_promo_code_active(uuid, boolean);
drop function if exists public.admin_create_billing_promo_code(
  text,
  text,
  text,
  numeric,
  timestamptz,
  boolean,
  text
);
drop function if exists public.admin_list_billing_promo_codes_v2();
drop index if exists public.idx_billing_yookassa_payments_paid_promo;

commit;
