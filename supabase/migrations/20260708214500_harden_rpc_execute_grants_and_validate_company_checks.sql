-- Remove default PUBLIC/anon execute access from SECURITY DEFINER RPCs whose
-- callers are either authenticated app users, service-role edge functions, or
-- database triggers. This keeps existing intended callers but closes accidental
-- anonymous function exposure.

-- Client RPCs used directly by the mobile app after authentication.
revoke execute on function public.bootstrap_my_profile_from_auth() from public, anon;
grant execute on function public.bootstrap_my_profile_from_auth() to authenticated, service_role;

revoke execute on function public.list_orders_light(
  text,
  text,
  text,
  uuid[],
  uuid[],
  uuid,
  uuid[],
  integer,
  integer,
  uuid,
  text[],
  date,
  date,
  numeric,
  numeric
) from public, anon;
grant execute on function public.list_orders_light(
  text,
  text,
  text,
  uuid[],
  uuid[],
  uuid,
  uuid[],
  integer,
  integer,
  uuid,
  text[],
  date,
  date,
  numeric,
  numeric
) to authenticated, service_role;

revoke execute on function public.set_quiet_hours_self(text, text, text) from public, anon;
grant execute on function public.set_quiet_hours_self(text, text, text) to authenticated, service_role;

-- Service-role/trigger-only helpers. They either have no end-user auth checks
-- or are invoked from trusted edge functions/triggers, so authenticated clients
-- should not execute them directly.
revoke execute on function public.append_object_media_url_v1(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.append_object_media_url_v1(uuid, uuid, text, text) to service_role;

revoke execute on function public.remove_object_media_url_v1(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.remove_object_media_url_v1(uuid, uuid, text, text) to service_role;

revoke execute on function public.bootstrap_profile_company_on_auth_signup() from public, anon, authenticated;
grant execute on function public.bootstrap_profile_company_on_auth_signup() to service_role;

revoke execute on function public.deactivate_expired_billing_promo_codes() from public, anon, authenticated;
grant execute on function public.deactivate_expired_billing_promo_codes() to service_role;

revoke execute on function public.enqueue_support_feedback_notification() from public, anon, authenticated;
grant execute on function public.enqueue_support_feedback_notification() to service_role;

revoke execute on function public.ensure_company_subscription(uuid) from public, anon, authenticated;
grant execute on function public.ensure_company_subscription(uuid) to service_role;

revoke execute on function public.ensure_company_subscription(uuid, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.ensure_company_subscription(uuid, integer, integer, integer, integer) to service_role;

-- Existing data was checked before validation; these constraints now become
-- planner-visible and stop showing up as unfinished schema work.
alter table public.companies validate constraint companies_feed_order_card_fields_is_array;
alter table public.companies validate constraint companies_worker_phone_hide_condition_valid;
alter table public.companies validate constraint companies_worker_phone_offsets_valid;
alter table public.companies validate constraint companies_worker_phone_show_condition_valid;
alter table public.companies validate constraint companies_worker_phone_statuses_valid;
