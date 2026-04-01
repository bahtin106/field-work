begin;

revoke all on table public.subscription_email_sla_metrics from anon;
revoke all on table public.subscription_email_sla_metrics from authenticated;
revoke all on table public.subscription_email_sla_metrics from public;

grant select on table public.subscription_email_sla_metrics to service_role;

commit;
