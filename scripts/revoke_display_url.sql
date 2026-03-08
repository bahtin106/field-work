REVOKE SELECT (display_url, display_url_updated_at)
  ON TABLE public.order_media_external_map
  FROM anon, authenticated;

REVOKE UPDATE (display_url, display_url_updated_at)
  ON TABLE public.order_media_external_map
  FROM anon, authenticated;
