-- Add cached display_url to order_media_external_map for faster image delivery

alter table public.order_media_external_map
  add column if not exists display_url text;

alter table public.order_media_external_map
  add column if not exists display_url_updated_at timestamptz;

-- Grant no direct access to clients (same RLS rules already apply)
revoke select (display_url, display_url_updated_at)
  on table public.order_media_external_map
  from anon, authenticated;

revoke update (display_url, display_url_updated_at)
  on table public.order_media_external_map
  from anon, authenticated;