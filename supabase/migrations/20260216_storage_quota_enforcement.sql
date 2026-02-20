-- Enforce company storage quota (1 GB) for uploads into storage.objects.
-- Applies to:
--   - orders-photos bucket (orders/<order_id>/...)
--   - avatars bucket (profiles/<profile_id>/...)

CREATE OR REPLACE FUNCTION public.can_upload_storage_object(
  p_bucket_id text,
  p_name text,
  p_size_bytes bigint DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_company_id uuid;
  v_total_bytes bigint := 0;
  v_limit_bytes bigint := public.company_storage_limit_bytes();
  v_prefix text;
  v_entity_id text;
  v_size_bytes bigint := GREATEST(COALESCE(p_size_bytes, 0), 0);
  v_profiles_has_user_id boolean := false;
BEGIN
  IF p_bucket_id IS NULL OR p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN false;
  END IF;

  v_prefix := split_part(p_name, '/', 1);
  v_entity_id := split_part(p_name, '/', 2);

  IF p_bucket_id = 'orders-photos' AND v_prefix = 'orders' THEN
    SELECT o.company_id
    INTO v_company_id
    FROM public.orders o
    WHERE o.id::text = v_entity_id
    LIMIT 1;
  ELSIF p_bucket_id = 'avatars' AND v_prefix = 'profiles' THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'profiles'
        AND c.column_name = 'user_id'
    )
    INTO v_profiles_has_user_id;

    IF v_profiles_has_user_id THEN
      SELECT p.company_id
      INTO v_company_id
      FROM public.profiles p
      WHERE p.id::text = v_entity_id OR p.user_id::text = v_entity_id
      LIMIT 1;
    ELSE
      SELECT p.company_id
      INTO v_company_id
      FROM public.profiles p
      WHERE p.id::text = v_entity_id
      LIMIT 1;
    END IF;
  ELSE
    RETURN false;
  END IF;

  IF v_company_id IS NULL OR NOT public.can_read_company_storage(v_company_id) THEN
    RETURN false;
  END IF;

  SELECT x.total_bytes
  INTO v_total_bytes
  FROM public.compute_company_storage_usage_bytes(v_company_id) x;

  RETURN (COALESCE(v_total_bytes, 0) + v_size_bytes) <= v_limit_bytes;
END;
$$;

DROP POLICY IF EXISTS orders_photos_insert_authenticated ON storage.objects;
CREATE POLICY orders_photos_insert_authenticated
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'orders-photos'
  AND (storage.foldername(name))[1] = 'orders'
  AND public.can_upload_storage_object(
    bucket_id,
    name,
    CASE
      WHEN COALESCE(metadata->>'size', '') ~ '^[0-9]+$' THEN (metadata->>'size')::bigint
      ELSE 0
    END
  )
);

DROP POLICY IF EXISTS avatars_insert_authenticated ON storage.objects;
CREATE POLICY avatars_insert_authenticated
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'profiles'
  AND public.can_upload_storage_object(
    bucket_id,
    name,
    CASE
      WHEN COALESCE(metadata->>'size', '') ~ '^[0-9]+$' THEN (metadata->>'size')::bigint
      ELSE 0
    END
  )
);

GRANT EXECUTE ON FUNCTION public.can_upload_storage_object(text, text, bigint) TO authenticated;
