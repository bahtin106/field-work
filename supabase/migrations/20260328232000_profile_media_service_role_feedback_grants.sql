-- Ensure edge function profile-media-storage has required table privileges.

grant usage on schema public to service_role;

grant select, insert, update, delete on table public.feedbacks to service_role;
grant select, insert, update, delete on table public.feedback_attachments to service_role;
grant select, insert, update, delete on table public.profile_media_external_map to service_role;

grant select on table public.companies to service_role;
grant select, update on table public.company_yandex_disk_connections to service_role;
grant select on table public.profiles to service_role;
grant select on table public.clients to service_role;
grant select on table public.client_objects to service_role;

grant usage, select on sequence public.profile_media_external_map_id_seq to service_role;
