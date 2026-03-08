begin;

grant usage on schema public to service_role;

grant select, insert, update, delete on table public.messenger_integrations to service_role;
grant select, insert, update, delete on table public.company_messenger_field_settings to service_role;
grant select, insert, update, delete on table public.messenger_conversations to service_role;
grant select, insert, update, delete on table public.messenger_update_log to service_role;
grant select on table public.messenger_field_catalog to service_role;

commit;
