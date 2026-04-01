begin;

-- Remove noisy Expo Go runtime warnings from client error logs.
delete from public.error_logs
where lower(coalesce(message, '')) like '%expo-notifications:%removed from expo go%'
   or lower(coalesce(message, '')) like '%`expo-notifications` functionality is not fully supported in expo go%'
   or lower(coalesce(message, '')) like '%expo go can no longer provide full access to the media library%'
   or lower(coalesce(message, '')) like '%androids permission requirements, expo go can no longer provide full access to the media library%';

commit;
