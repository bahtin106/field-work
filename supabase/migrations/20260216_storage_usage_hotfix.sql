-- Hotfix for storage usage/accounting:
-- 1) support avatars path mapped by profiles.user_id when present
-- 2) keep quota enforcement aligned with the same profile id/user_id logic

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
        ON (p.id::text = split_part(o.name, '/', 2) OR p.user_id::text = split_part(o.name, '/', 2))
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
        ON p.id::text = split_part(o.name, '/', 2)
      WHERE o.bucket_id = 'avatars'
        AND split_part(o.name, '/', 1) = 'profiles'
        AND p.company_id = p_company_id;
    END IF;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.compute_company_storage_usage_bytes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_upload_storage_object(text, text, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_company_storage(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_member boolean := false;
  v_is_owner boolean := false;
  v_ok boolean := false;
  v_has_user_id_col boolean := false;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  -- Allow trusted DB contexts (SQL editor / service role) for diagnostics and admin jobs.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN true;
  END IF;
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;

  IF to_regprocedure('public.is_company_member(uuid)') IS NOT NULL THEN
    BEGIN
      v_is_member := COALESCE(public.is_company_member(p_company_id), false);
    EXCEPTION WHEN OTHERS THEN
      v_is_member := false;
    END;
  END IF;

  IF to_regprocedure('public.is_company_owner(uuid)') IS NOT NULL THEN
    BEGIN
      v_is_owner := COALESCE(public.is_company_owner(p_company_id), false);
    EXCEPTION WHEN OTHERS THEN
      v_is_owner := false;
    END;
  END IF;

  IF v_is_member OR v_is_owner THEN
    RETURN true;
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'profiles'
      AND c.column_name = 'user_id'
  )
  INTO v_has_user_id_col;

  BEGIN
    IF v_has_user_id_col THEN
      EXECUTE $q$
        SELECT EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE (p.id = $1 OR p.user_id = $1)
            AND p.company_id = $2
        )
      $q$
      INTO v_ok
      USING v_uid, p_company_id;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = v_uid
          AND p.company_id = p_company_id
      )
      INTO v_ok;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;

  RETURN COALESCE(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_storage_usage(
  p_company_id uuid,
  p_force_refresh boolean DEFAULT false
)
RETURNS TABLE(
  company_id uuid,
  limit_bytes bigint,
  data_bytes bigint,
  media_bytes bigint,
  media_orders_bytes bigint,
  media_avatars_bytes bigint,
  total_bytes bigint,
  used_percent numeric(7,2),
  remaining_bytes bigint,
  data_tables_breakdown jsonb,
  refreshed_at timestamptz,
  stale boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit_bytes bigint := public.company_storage_limit_bytes();
  v_cache public.company_storage_usage_cache%ROWTYPE;
  v_should_recompute boolean := p_force_refresh;
  v_data_bytes bigint := 0;
  v_media_orders_bytes bigint := 0;
  v_media_avatars_bytes bigint := 0;
  v_media_bytes bigint := 0;
  v_total_bytes bigint := 0;
  v_breakdown jsonb := '{}'::jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  IF NOT public.can_read_company_storage(p_company_id) THEN
    RAISE EXCEPTION 'access denied to company %', p_company_id USING ERRCODE = '42501';
  END IF;

  SELECT c.*
  INTO v_cache
  FROM public.company_storage_usage_cache c
  WHERE c.company_id = p_company_id;

  IF NOT FOUND THEN
    v_should_recompute := true;
  ELSIF (now() - v_cache.refreshed_at) > interval '5 minutes' THEN
    v_should_recompute := true;
  END IF;

  IF v_should_recompute THEN
    SELECT
      x.data_bytes,
      x.media_orders_bytes,
      x.media_avatars_bytes,
      x.media_bytes,
      x.total_bytes,
      x.data_tables_breakdown
    INTO
      v_data_bytes,
      v_media_orders_bytes,
      v_media_avatars_bytes,
      v_media_bytes,
      v_total_bytes,
      v_breakdown
    FROM public.compute_company_storage_usage_bytes(p_company_id) x;

    INSERT INTO public.company_storage_usage_cache (
      company_id,
      limit_bytes,
      data_bytes,
      media_bytes,
      media_orders_bytes,
      media_avatars_bytes,
      total_bytes,
      data_tables_breakdown,
      refreshed_at
    )
    VALUES (
      p_company_id,
      v_limit_bytes,
      v_data_bytes,
      v_media_bytes,
      v_media_orders_bytes,
      v_media_avatars_bytes,
      v_total_bytes,
      COALESCE(v_breakdown, '{}'::jsonb),
      now()
    )
    ON CONFLICT ON CONSTRAINT company_storage_usage_cache_pkey DO UPDATE
    SET
      limit_bytes = EXCLUDED.limit_bytes,
      data_bytes = EXCLUDED.data_bytes,
      media_bytes = EXCLUDED.media_bytes,
      media_orders_bytes = EXCLUDED.media_orders_bytes,
      media_avatars_bytes = EXCLUDED.media_avatars_bytes,
      total_bytes = EXCLUDED.total_bytes,
      data_tables_breakdown = EXCLUDED.data_tables_breakdown,
      refreshed_at = EXCLUDED.refreshed_at;

    SELECT c.*
    INTO v_cache
    FROM public.company_storage_usage_cache c
    WHERE c.company_id = p_company_id;
  END IF;

  RETURN QUERY
  SELECT
    p_company_id AS company_id,
    v_cache.limit_bytes,
    v_cache.data_bytes,
    v_cache.media_bytes,
    v_cache.media_orders_bytes,
    v_cache.media_avatars_bytes,
    v_cache.total_bytes,
    CASE
      WHEN v_cache.limit_bytes <= 0 THEN 0::numeric
      ELSE ROUND(((v_cache.total_bytes::numeric / v_cache.limit_bytes::numeric) * 100)::numeric, 2)
    END AS used_percent,
    GREATEST(v_cache.limit_bytes - v_cache.total_bytes, 0) AS remaining_bytes,
    COALESCE(v_cache.data_tables_breakdown, '{}'::jsonb),
    v_cache.refreshed_at,
    ((now() - v_cache.refreshed_at) > interval '5 minutes') AS stale;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_read_company_storage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_storage_usage(uuid, boolean) TO authenticated;
