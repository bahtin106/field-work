-- Remove broad authenticated Storage object policies from legacy media
-- buckets. Avatars keep self-scoped access; order media is handled by
-- service-role Edge Functions and external media storage.

drop policy if exists avatars_select_authenticated on storage.objects;
drop policy if exists avatars_insert_authenticated on storage.objects;
drop policy if exists avatars_update_authenticated on storage.objects;
drop policy if exists avatars_delete_authenticated on storage.objects;

drop policy if exists orders_photos_select_authenticated on storage.objects;
drop policy if exists orders_photos_insert_authenticated on storage.objects;
drop policy if exists orders_photos_update_authenticated on storage.objects;
drop policy if exists orders_photos_delete_authenticated on storage.objects;
