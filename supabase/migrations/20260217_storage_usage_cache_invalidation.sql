-- Invalidate company storage usage cache when storage objects change.
-- This makes billing/storage counters react immediately after upload/delete.

CREATE OR REPLACE FUNCTION public.resolve_company_id_for_storage_object(
  p_bucket_id text,
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_prefix text;
  v_entity_id text;
  v_company_id uuid;
  v_profiles_has_user_id boolean := false;
BEGIN
  IF p_bucket_id IS NULL OR p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN NULL;
  END IF;

  v_prefix := split_part(p_name, '/', 1);
  v_entity_id := split_part(p_name, '/', 2);

  IF p_bucket_id = 'orders-photos' AND v_prefix = 'orders' THEN
    SELECT o.company_id
    INTO v_company_id
    FROM public.orders o
    WHERE o.id::text = v_entity_id
    LIMIT 1;
    RETURN v_company_id;
  END IF;

  IF p_bucket_id = 'avatars' AND v_prefix = 'profiles' THEN
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
      RETURN v_company_id;
    END IF;

    SELECT p.company_id
    INTO v_company_id
    FROM public.profiles p
    WHERE p.id::text = v_entity_id
    LIMIT 1;
    RETURN v_company_id;
  END IF;

  RETURN NULL;
END;
$$;

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
    RETURN;
  END IF;

  DELETE FROM public.company_storage_usage_cache c
  WHERE c.company_id = v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_invalidate_company_storage_usage_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.invalidate_company_storage_usage_cache_for_object(NEW.bucket_id, NEW.name);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM public.invalidate_company_storage_usage_cache_for_object(OLD.bucket_id, OLD.name);
    PERFORM public.invalidate_company_storage_usage_cache_for_object(NEW.bucket_id, NEW.name);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.invalidate_company_storage_usage_cache_for_object(OLD.bucket_id, OLD.name);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_invalidate_company_storage_usage_cache ON storage.objects';
    EXECUTE '
      CREATE TRIGGER trg_invalidate_company_storage_usage_cache
      AFTER INSERT OR UPDATE OR DELETE ON storage.objects
      FOR EACH ROW
      EXECUTE FUNCTION public.tg_invalidate_company_storage_usage_cache()
    ';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_company_id_for_storage_object(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invalidate_company_storage_usage_cache_for_object(text, text) TO authenticated;
