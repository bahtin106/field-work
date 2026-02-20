-- Strengthen storage usage cache invalidation.
-- If company cannot be resolved for an object change, invalidate all cache rows (fail-safe).

CREATE OR REPLACE FUNCTION public.invalidate_company_storage_usage_cache_for_object(
  p_bucket_id text,
  p_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_company_id_for_storage_object(p_bucket_id, p_name);
  IF v_company_id IS NULL THEN
    DELETE FROM public.company_storage_usage_cache;
    RETURN;
  END IF;

  DELETE FROM public.company_storage_usage_cache c
  WHERE c.company_id = v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invalidate_company_storage_usage_cache_for_object(text, text) TO authenticated;
