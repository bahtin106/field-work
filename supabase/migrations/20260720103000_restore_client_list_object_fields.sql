-- The client list embeds non-sensitive location fields from client_objects.
-- Keep direct access limited to only the fields required by that read path;
-- phone, media and internal notes remain unavailable to authenticated users.
grant select (geo_lat, geo_lng, location_mode)
on table public.client_objects
to authenticated;
