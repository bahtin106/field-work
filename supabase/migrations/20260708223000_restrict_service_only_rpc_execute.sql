-- Tighten SECURITY DEFINER RPCs that are workers/maintenance helpers.
-- They are called by cron, server scripts, or Edge Functions with service_role,
-- not directly by mobile authenticated users.

revoke execute on function public.append_order_media_url(uuid, uuid, text, text) from authenticated;
grant execute on function public.append_order_media_url(uuid, uuid, text, text) to service_role;

revoke execute on function public.append_order_media_url_v2(uuid, uuid, text, text) from authenticated;
grant execute on function public.append_order_media_url_v2(uuid, uuid, text, text) to service_role;

revoke execute on function public.remove_order_media_url(uuid, uuid, text, text) from authenticated;
grant execute on function public.remove_order_media_url(uuid, uuid, text, text) to service_role;

revoke execute on function public.remove_order_media_url_v2(uuid, uuid, text, text) from authenticated;
grant execute on function public.remove_order_media_url_v2(uuid, uuid, text, text) to service_role;

revoke execute on function public.archive_stale_messenger_conversations(integer, integer) from authenticated;
grant execute on function public.archive_stale_messenger_conversations(integer, integer) to service_role;

revoke execute on function public.claim_media_cleanup_jobs(integer, text, integer, text) from authenticated;
grant execute on function public.claim_media_cleanup_jobs(integer, text, integer, text) to service_role;

revoke execute on function public.claim_notification_events(integer) from authenticated;
grant execute on function public.claim_notification_events(integer) to service_role;

revoke execute on function public.claim_subscription_email_jobs(integer, interval) from authenticated;
grant execute on function public.claim_subscription_email_jobs(integer, interval) to service_role;

revoke execute on function public.cleanup_auth_identity_orphans(text, uuid) from authenticated;
grant execute on function public.cleanup_auth_identity_orphans(text, uuid) to service_role;

revoke execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) from authenticated;
grant execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer) to service_role;

revoke execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer) from authenticated;
grant execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer) to service_role;

revoke execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer, integer) from authenticated;
grant execute on function public.cleanup_background_tables_retention(integer, integer, integer, integer, integer, integer, integer) to service_role;

revoke execute on function public.cleanup_company_seat_assignments_history(integer, integer) from authenticated;
grant execute on function public.cleanup_company_seat_assignments_history(integer, integer) to service_role;

revoke execute on function public.cleanup_error_logs(integer) from authenticated;
grant execute on function public.cleanup_error_logs(integer) to service_role;

revoke execute on function public.cleanup_expired_company_integration_oauth_states(integer) from authenticated;
grant execute on function public.cleanup_expired_company_integration_oauth_states(integer) to service_role;

revoke execute on function public.cleanup_password_change_log(integer, integer) from authenticated;
grant execute on function public.cleanup_password_change_log(integer, integer) to service_role;

revoke execute on function public.cleanup_push_tokens_retention(integer, integer, integer) from authenticated;
grant execute on function public.cleanup_push_tokens_retention(integer, integer, integer) to service_role;

revoke execute on function public.enqueue_due_subscription_email_jobs(timestamp with time zone) from authenticated;
grant execute on function public.enqueue_due_subscription_email_jobs(timestamp with time zone) to service_role;

revoke execute on function public.finalize_media_cleanup_job(bigint, boolean, text, text, integer, boolean) from authenticated;
grant execute on function public.finalize_media_cleanup_job(bigint, boolean, text, text, integer, boolean) to service_role;

revoke execute on function public.finish_notification_event(bigint, boolean, text, interval) from authenticated;
grant execute on function public.finish_notification_event(bigint, boolean, text, interval) to service_role;

revoke execute on function public.finish_subscription_email_job(bigint, boolean, text, integer, jsonb) from authenticated;
grant execute on function public.finish_subscription_email_job(bigint, boolean, text, integer, jsonb) to service_role;

revoke execute on function public.get_subscription_email_sla_breaches() from authenticated;
grant execute on function public.get_subscription_email_sla_breaches() to service_role;

revoke execute on function public.maintain_app_entity_audit_log(integer, integer) from authenticated;
grant execute on function public.maintain_app_entity_audit_log(integer, integer) to service_role;

revoke execute on function public.prune_app_entity_audit_log_partitions(integer) from authenticated;
grant execute on function public.prune_app_entity_audit_log_partitions(integer) to service_role;

revoke execute on function public.purge_messenger_conversations_archive(integer, integer) from authenticated;
grant execute on function public.purge_messenger_conversations_archive(integer, integer) to service_role;

revoke execute on function public.requeue_subscription_email_job(bigint) from authenticated;
grant execute on function public.requeue_subscription_email_job(bigint) to service_role;

revoke execute on function public.schedule_push_worker_cron() from authenticated;
grant execute on function public.schedule_push_worker_cron() to service_role;

revoke execute on function public.sync_subscription_access_states() from authenticated;
grant execute on function public.sync_subscription_access_states() to service_role;

revoke execute on function public.trigger_push_worker(integer) from authenticated;
grant execute on function public.trigger_push_worker(integer) to service_role;

revoke execute on function public.validate_billing_promo_code(text, numeric) from authenticated;
grant execute on function public.validate_billing_promo_code(text, numeric) to service_role;
