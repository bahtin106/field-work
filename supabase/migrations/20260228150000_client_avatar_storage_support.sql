-- Support client avatar uploads stored under avatars/profiles/clients/<client_id>/...
-- Keeps upload quota checks, storage usage accounting and cache invalidation aligned.

CREATE OR REPLACE FUNCTION public.compute_company_storage_usage_bytes(p_company_id uuid)
RETURNS TABLE(
  data_bytes bigint,
  media_orders_bytes bigint,
  media_avatars_bytes bigint,
  media_bytes bigint,
  total_bytes bigint,
  data_tables_breakdown jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_data_bytes bigint := 0;
  v_media_orders_bytes bigint := 0;
  v_media_avatars_bytes bigint := 0;
  v_client_avatar_bytes bigint := 0;
  v_table_bytes bigint := 0;
  v_data_breakdown jsonb := '{}'::jsonb;
  v_profiles_has_user_id boolean := false;
  rec record;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  FOR rec IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'company_storage_usage_cache'
    GROUP BY c.table_schema, c.table_name
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'SELECT COALESCE(SUM(pg_column_size(x)), 0)::bigint FROM %I.%I x WHERE x.company_id = $1',
      rec.table_schema,
      rec.table_name
    )
    INTO v_table_bytes
    USING p_company_id;

    v_table_bytes := COALESCE(v_table_bytes, 0);
    v_data_bytes := v_data_bytes + v_table_bytes;

    IF v_table_bytes > 0 THEN
      v_data_breakdown := v_data_breakdown || jsonb_build_object(rec.table_name, v_table_bytes);
    END IF;
  END LOOP;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'profiles'
      AND c.column_name = 'user_id'
  )
  INTO v_profiles_has_user_id;

  IF to_regclass('storage.objects') IS NOT NULL
     AND to_regclass('public.orders') IS NOT NULL THEN
    SELECT COALESCE(
      SUM(
        CASE
          WHEN COALESCE(o.metadata->>'size', '') ~ '^[0-9]+$'
            THEN (o.metadata->>'size')::bigint
          ELSE 0
        END
      ),
      0
    )::bigint
    INTO v_media_orders_bytes
    FROM storage.objects o
    JOIN public.orders ord
      ON ord.id::text = split_part(o.name, '/', 2)
    WHERE o.bucket_id = 'orders-photos'
      AND split_part(o.name, '/', 1) = 'orders'
      AND ord.company_id = p_company_id;
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL
     AND to_regclass('public.profiles') IS NOT NULL THEN
    IF v_profiles_has_user_id THEN
      SELECT COALESCE(
        SUM(
          CASE
            WHEN COALESCE(o.metadata->>'size', '') ~ '^[0-9]+$'
              THEN (o.metadata->>'size')::bigint
            ELSE 0
          END
        ),
        0
      )::bigint
      INTO v_media_avatars_bytes
      FROM storage.objects o
      JOIN public.profiles p
        ON split_part(o.name, '/', 2) <> 'clients'
       AND (p.id::text = split_part(o.name, '/', 2) OR p.user_id::text = split_part(o.name, '/', 2))
      WHERE o.bucket_id = 'avatars'
        AND split_part(o.name, '/', 1) = 'profiles'
        AND p.company_id = p_company_id;
    ELSE
      SELECT COALESCE(
        SUM(
          CASE
            WHEN COALESCE(o.metadata->>'size', '') ~ '^[0-9]+$'
              THEN (o.metadata->>'size')::bigint
            ELSE 0
          END
        ),
        0
      )::bigint
      INTO v_media_avatars_bytes
      FROM storage.objects o
      JOIN public.profiles p
        ON split_part(o.name, '/', 2) <> 'clients'
       AND p.id::text = split_part(o.name, '/', 2)
      WHERE o.bucket_id = 'avatars'
        AND split_part(o.name, '/', 1) = 'profiles'
        AND p.company_id = p_company_id;
    END IF;
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL
     AND to_regclass('public.clients') IS NOT NULL THEN
    SELECT COALESCE(
      SUM(
        CASE
          WHEN COALESCE(o.metadata->>'size', '') ~ '^[0-9]+$'
            THEN (o.metadata->>'size')::bigint
          ELSE 0
        END
      ),
      0
    )::bigint
    INTO v_client_avatar_bytes
    FROM storage.objects o
    JOIN public.clients c
      ON c.id::text = split_part(o.name, '/', 3)
    WHERE o.bucket_id = 'avatars'
      AND split_part(o.name, '/', 1) = 'profiles'
      AND split_part(o.name, '/', 2) = 'clients'
      AND c.company_id = p_company_id;
  END IF;

  v_media_avatars_bytes := COALESCE(v_media_avatars_bytes, 0) + COALESCE(v_client_avatar_bytes, 0);

  RETURN QUERY
  SELECT
    v_data_bytes,
    v_media_orders_bytes,
    v_media_avatars_bytes,
    (v_media_orders_bytes + v_media_avatars_bytes) AS media_bytes,
    (v_data_bytes + v_media_orders_bytes + v_media_avatars_bytes) AS total_bytes,
    v_data_breakdown;
END;
$$;

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
  v_child_entity_id text;
  v_size_bytes bigint := GREATEST(COALESCE(p_size_bytes, 0), 0);
  v_profiles_has_user_id boolean := false;
BEGIN
  IF p_bucket_id IS NULL OR p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN false;
  END IF;

  v_prefix := split_part(p_name, '/', 1);
  v_entity_id := split_part(p_name, '/', 2);
  v_child_entity_id := split_part(p_name, '/', 3);

  IF p_bucket_id = 'orders-photos' AND v_prefix = 'orders' THEN
    SELECT o.company_id
    INTO v_company_id
    FROM public.orders o
    WHERE o.id::text = v_entity_id
    LIMIT 1;
  ELSIF p_bucket_id = 'avatars' AND v_prefix = 'profiles' THEN
    IF v_entity_id = 'clients' AND to_regclass('public.clients') IS NOT NULL THEN
      SELECT c.company_id
      INTO v_company_id
      FROM public.clients c
      WHERE c.id::text = v_child_entity_id
      LIMIT 1;
    ELSE
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
  v_child_entity_id text;
  v_company_id uuid;
  v_profiles_has_user_id boolean := false;
BEGIN
  IF p_bucket_id IS NULL OR p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN NULL;
  END IF;

  v_prefix := split_part(p_name, '/', 1);
  v_entity_id := split_part(p_name, '/', 2);
  v_child_entity_id := split_part(p_name, '/', 3);

  IF p_bucket_id = 'orders-photos' AND v_prefix = 'orders' THEN
    SELECT o.company_id
    INTO v_company_id
    FROM public.orders o
    WHERE o.id::text = v_entity_id
    LIMIT 1;
    RETURN v_company_id;
  END IF;

  IF p_bucket_id = 'avatars' AND v_prefix = 'profiles' THEN
    IF v_entity_id = 'clients' AND to_regclass('public.clients') IS NOT NULL THEN
      SELECT c.company_id
      INTO v_company_id
      FROM public.clients c
      WHERE c.id::text = v_child_entity_id
      LIMIT 1;
      RETURN v_company_id;
    END IF;

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
