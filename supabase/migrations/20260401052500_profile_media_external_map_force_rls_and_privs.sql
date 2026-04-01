begin;

alter table public.profile_media_external_map force row level security;

revoke references, trigger, truncate on table public.profile_media_external_map from service_role;
revoke references, trigger, truncate on table public.profile_media_external_map from authenticated;
revoke references, trigger, truncate on table public.profile_media_external_map from anon;

grant select, insert, update, delete on table public.profile_media_external_map to service_role;

commit;
