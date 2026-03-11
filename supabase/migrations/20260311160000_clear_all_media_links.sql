-- One-off cleanup of all media links stored in application data.
-- Intended for removing test media references from DB while remote files
-- are deleted separately from storage.

begin;

update public.orders
set
  contract_file = '{}'::text[],
  photo_before = '{}'::text[],
  photo_after = '{}'::text[],
  act_file = '{}'::text[]
where
  coalesce(array_length(contract_file, 1), 0) > 0
  or coalesce(array_length(photo_before, 1), 0) > 0
  or coalesce(array_length(photo_after, 1), 0) > 0
  or coalesce(array_length(act_file, 1), 0) > 0;

update public.profiles
set avatar_url = null
where nullif(trim(coalesce(avatar_url, '')), '') is not null;

update public.clients
set avatar_url = null
where nullif(trim(coalesce(avatar_url, '')), '') is not null;

update public.client_objects
set photo_url = null
where nullif(trim(coalesce(photo_url, '')), '') is not null;

delete from public.order_media_external_map;
delete from public.profile_media_external_map;
delete from public.media_cleanup_queue;

commit;
