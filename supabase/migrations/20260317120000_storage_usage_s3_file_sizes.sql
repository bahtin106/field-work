-- Add file_size_bytes to all external media map tables
-- and rewrite compute_company_storage_usage_bytes to count S3 media from these tables.

-- 1) Add file_size_bytes column to all 3 external media map tables
alter table public.order_media_external_map
  add column if not exists file_size_bytes bigint not null default 0;

alter table public.profile_media_external_map
  add column if not exists file_size_bytes bigint not null default 0;

alter table public.finance_entry_media_external_map
  add column if not exists file_size_bytes bigint not null default 0;

-- 2) Rewrite compute_company_storage_usage_bytes to sum media from external maps
--    instead of (only) from storage.objects.
--    We keep the old storage.objects path as fallback for any legacy data.
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
  v_media_finance_bytes bigint := 0;
  v_legacy_orders_bytes bigint := 0;
  v_legacy_avatars_bytes bigint := 0;
  v_table_bytes bigint := 0;
  v_data_breakdown jsonb := '{}'::jsonb;
  v_profiles_has_user_id boolean := false;
  rec record;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  -- Sum text/table data (all public tables with company_id)
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

  -- === S3 media from external map tables ===

  -- Order media (order_media_external_map)
  IF to_regclass('public.order_media_external_map') IS NOT NULL THEN
    SELECT COALESCE(SUM(m.file_size_bytes), 0)::bigint
    INTO v_media_orders_bytes
    FROM public.order_media_external_map m
    WHERE m.company_id = p_company_id;
  END IF;

  -- Profile media / avatars (profile_media_external_map)
  IF to_regclass('public.profile_media_external_map') IS NOT NULL THEN
    SELECT COALESCE(SUM(m.file_size_bytes), 0)::bigint
    INTO v_media_avatars_bytes
    FROM public.profile_media_external_map m
    WHERE m.company_id = p_company_id;
  END IF;

  -- Finance entry media (finance_entry_media_external_map)
  IF to_regclass('public.finance_entry_media_external_map') IS NOT NULL THEN
    SELECT COALESCE(SUM(m.file_size_bytes), 0)::bigint
    INTO v_media_finance_bytes
    FROM public.finance_entry_media_external_map m
    WHERE m.company_id = p_company_id;
  END IF;

  -- === Legacy: Supabase built-in storage (storage.objects) ===
  -- Keep for backward compatibility with any files still in Supabase storage

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
    INTO v_legacy_orders_bytes
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
      INTO v_legacy_avatars_bytes
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
      INTO v_legacy_avatars_bytes
      FROM storage.objects o
      JOIN public.profiles p
        ON p.id::text = split_part(o.name, '/', 2)
      WHERE o.bucket_id = 'avatars'
        AND split_part(o.name, '/', 1) = 'profiles'
        AND p.company_id = p_company_id;
    END IF;
  END IF;

  -- Combine: use the GREATER of S3-tracked vs legacy per category
  -- (avoids double-counting if same file tracked both ways)
  v_media_orders_bytes := GREATEST(v_media_orders_bytes, v_legacy_orders_bytes) + v_media_finance_bytes;
  v_media_avatars_bytes := GREATEST(v_media_avatars_bytes, v_legacy_avatars_bytes);

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

-- Invalidate all cached storage data so next request recomputes
DELETE FROM public.company_storage_usage_cache;

GRANT EXECUTE ON FUNCTION public.compute_company_storage_usage_bytes(uuid) TO authenticated;
