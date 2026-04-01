begin;

alter table public.subscription_email_runtime_config force row level security;

revoke all on table public.subscription_email_runtime_config from anon;
revoke all on table public.subscription_email_runtime_config from authenticated;
revoke all on table public.subscription_email_runtime_config from public;

grant select on table public.subscription_email_runtime_config to service_role;

commit;
