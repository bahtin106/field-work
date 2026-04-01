begin;

alter table public.subscription_email_queue force row level security;

revoke all on table public.subscription_email_queue from anon;
revoke all on table public.subscription_email_queue from authenticated;
revoke all on table public.subscription_email_queue from public;

grant select, insert, update, delete on table public.subscription_email_queue to service_role;

revoke all on sequence public.subscription_email_queue_id_seq from anon;
revoke all on sequence public.subscription_email_queue_id_seq from authenticated;
revoke all on sequence public.subscription_email_queue_id_seq from public;

grant usage, select on sequence public.subscription_email_queue_id_seq to service_role;

commit;
