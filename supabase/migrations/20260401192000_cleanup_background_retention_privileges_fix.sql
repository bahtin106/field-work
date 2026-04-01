begin;

create or replace function public.cleanup_background_tables_retention(
  p_notification_days integer default 180,
  p_subscription_email_days integer default 365,
  p_media_cleanup_days integer default 90,
  p_messenger_update_days integer default 30,
  p_batch_limit integer default 200000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.cleanup_background_tables_retention(
    p_notification_days,
    p_subscription_email_days,
    p_media_cleanup_days,
    p_messenger_update_days,
    p_batch_limit,
    3650
  );
end;
$$;

revoke all on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) from public;
revoke all on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) from anon;
revoke all on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) from authenticated;
grant execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) to service_role;

revoke all on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer) from public;
revoke all on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer) from anon;
revoke all on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer) from authenticated;
grant execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer) to service_role;

commit;
