-- Company storage quota and usage accounting.
-- Business rule: every company has a fixed 1 GB quota, regardless of seats/payment/users.
-- Usage includes:
--   1) data bytes in public tables scoped by company_id
--   2) media bytes in storage.objects for:
--      - orders-photos bucket (orders/<order_id>/...)
--      - avatars bucket (profiles/<profile_id>/...)

CREATE TABLE IF NOT EXISTS public.company_storage_usage_cache (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  limit_bytes bigint NOT NULL,
  data_bytes bigint NOT NULL DEFAULT 0,
  media_bytes bigint NOT NULL DEFAULT 0,
  media_orders_bytes bigint NOT NULL DEFAULT 0,
  media_avatars_bytes bigint NOT NULL DEFAULT 0,
  total_bytes bigint NOT NULL DEFAULT 0,
  data_tables_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_storage_usage_cache_refreshed_at
  ON public.company_storage_usage_cache(refreshed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_company_storage_usage_cache_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_storage_usage_cache_touch_updated_at ON public.company_storage_usage_cache;
CREATE TRIGGER trg_company_storage_usage_cache_touch_updated_at
BEFORE UPDATE ON public.company_storage_usage_cache
FOR EACH ROW
EXECUTE FUNCTION public.tg_company_storage_usage_cache_touch_updated_at();

CREATE OR REPLACE FUNCTION public.company_storage_limit_bytes()
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 1073741824::bigint; -- 1 GB
$$;

CREATE OR REPLACE FUNCTION public.can_read_company_storage(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_ok boolean := false;
  v_has_user_id_col boolean := false;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  IF to_regprocedure('public.is_company_member(uuid)') IS NOT NULL THEN
    BEGIN
      v_ok := COALESCE(public.is_company_member(p_company_id), false);
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
    END;
  END IF;

  IF NOT v_ok AND to_regprocedure('public.is_company_owner(uuid)') IS NOT NULL THEN
    BEGIN
      v_ok := COALESCE(public.is_company_owner(p_company_id), false);
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
    END;
  END IF;

  IF v_ok THEN
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

  -- Count relational data bytes for every company-scoped base table.
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

  -- Count orders media bytes (orders-photos bucket).
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

  -- Count avatars media bytes (avatars bucket).
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
  v_recompute boolean := p_force_refresh;
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

  SELECT *
  INTO v_cache
  FROM public.company_storage_usage_cache c
  WHERE c.company_id = p_company_id;

  IF NOT FOUND THEN
    v_recompute := true;
  ELSIF (now() - v_cache.refreshed_at) > interval '5 minutes' THEN
    v_recompute := true;
  END IF;

  IF v_recompute THEN
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

    SELECT *
    INTO v_cache
    FROM public.company_storage_usage_cache c
    WHERE c.company_id = p_company_id;
  END IF;

  RETURN QUERY
  SELECT
    v_cache.company_id,
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

REVOKE ALL ON TABLE public.company_storage_usage_cache FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.company_storage_limit_bytes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_company_storage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_company_storage_usage_bytes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_storage_usage(uuid, boolean) TO authenticated;
