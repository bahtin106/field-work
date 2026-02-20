-- Admin storage overview: split total usage into system/media and provide per-part 24h deltas.
-- Notes:
-- - total (used_bytes) still comes from VPS df snapshots.
-- - media/system breakdown is read from metric.raw when available.
-- - if breakdown is missing in snapshots, we fallback safely:
--   media delta = 0, system delta = total delta.

DROP FUNCTION IF EXISTS public.admin_get_storage_overview();

CREATE OR REPLACE FUNCTION public.admin_get_storage_overview()
RETURNS TABLE(
  source_code text,
  source_name text,
  provider text,
  plan_name text,
  quota_bytes bigint,
  filesystem_total_bytes bigint,
  used_bytes bigint,
  remaining_bytes bigint,
  used_percent numeric(7,2),
  measured_at timestamptz,
  delta_used_bytes_24h bigint,
  system_used_bytes bigint,
  media_used_bytes bigint,
  delta_system_used_bytes_24h bigint,
  delta_media_used_bytes_24h bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_storage_assert_access();

  RETURN QUERY
  WITH src AS (
    SELECT s.*
    FROM public.admin_storage_sources s
    WHERE s.is_active = true
  ),
  latest AS (
    SELECT DISTINCT ON (m.source_id)
      m.source_id,
      m.measured_at,
      m.filesystem_total_bytes,
      m.used_bytes,
      COALESCE(m.raw, '{}'::jsonb) AS raw
    FROM public.admin_storage_metrics m
    JOIN src s ON s.id = m.source_id
    ORDER BY m.source_id, m.measured_at DESC
  ),
  baseline_24h AS (
    SELECT
      l.source_id,
      CASE
        WHEN before24.used_bytes IS NOT NULL THEN before24.used_bytes
        ELSE earliest_in_window.used_bytes
      END AS baseline_used_bytes,
      CASE
        WHEN before24.used_bytes IS NOT NULL THEN COALESCE(before24.raw, '{}'::jsonb)
        ELSE COALESCE(earliest_in_window.raw, '{}'::jsonb)
      END AS baseline_raw
    FROM latest l
    LEFT JOIN LATERAL (
      SELECT m.used_bytes, m.raw
      FROM public.admin_storage_metrics m
      WHERE m.source_id = l.source_id
        AND m.measured_at <= l.measured_at - interval '24 hours'
      ORDER BY m.measured_at DESC
      LIMIT 1
    ) before24 ON true
    LEFT JOIN LATERAL (
      SELECT m.used_bytes, m.raw
      FROM public.admin_storage_metrics m
      WHERE m.source_id = l.source_id
        AND m.measured_at > l.measured_at - interval '24 hours'
        AND m.measured_at <= l.measured_at
      ORDER BY m.measured_at ASC
      LIMIT 1
    ) earliest_in_window ON true
  ),
  parsed AS (
    SELECT
      s.code AS source_code,
      s.name AS source_name,
      s.provider,
      s.plan_name,
      s.quota_bytes,
      l.filesystem_total_bytes,
      l.used_bytes,
      l.measured_at,
      b.baseline_used_bytes,
      CASE
        WHEN COALESCE(l.raw->>'media_bytes', '') ~ '^[0-9]+$' THEN (l.raw->>'media_bytes')::bigint
        ELSE NULL
      END AS latest_media_raw,
      CASE
        WHEN COALESCE(l.raw->>'system_bytes', '') ~ '^[0-9]+$' THEN (l.raw->>'system_bytes')::bigint
        ELSE NULL
      END AS latest_system_raw,
      CASE
        WHEN COALESCE(b.baseline_raw->>'media_bytes', '') ~ '^[0-9]+$' THEN (b.baseline_raw->>'media_bytes')::bigint
        ELSE NULL
      END AS baseline_media_raw,
      CASE
        WHEN COALESCE(b.baseline_raw->>'system_bytes', '') ~ '^[0-9]+$' THEN (b.baseline_raw->>'system_bytes')::bigint
        ELSE NULL
      END AS baseline_system_raw
    FROM src s
    LEFT JOIN latest l ON l.source_id = s.id
    LEFT JOIN baseline_24h b ON b.source_id = s.id
  ),
  normalized AS (
    SELECT
      p.*,
      COALESCE(
        p.latest_media_raw,
        CASE
          WHEN p.latest_system_raw IS NOT NULL THEN GREATEST(COALESCE(p.used_bytes, 0) - p.latest_system_raw, 0)
          ELSE NULL
        END,
        0
      ) AS latest_media_used,
      COALESCE(
        p.latest_system_raw,
        CASE
          WHEN p.latest_media_raw IS NOT NULL THEN GREATEST(COALESCE(p.used_bytes, 0) - p.latest_media_raw, 0)
          ELSE COALESCE(p.used_bytes, 0)
        END
      ) AS latest_system_used,
      COALESCE(
        p.baseline_media_raw,
        CASE
          WHEN p.baseline_system_raw IS NOT NULL THEN GREATEST(COALESCE(p.baseline_used_bytes, 0) - p.baseline_system_raw, 0)
          ELSE NULL
        END,
        0
      ) AS baseline_media_used,
      COALESCE(
        p.baseline_system_raw,
        CASE
          WHEN p.baseline_media_raw IS NOT NULL THEN GREATEST(COALESCE(p.baseline_used_bytes, 0) - p.baseline_media_raw, 0)
          ELSE COALESCE(p.baseline_used_bytes, 0)
        END
      ) AS baseline_system_used,
      ((p.latest_media_raw IS NOT NULL OR p.latest_system_raw IS NOT NULL)
       AND (p.baseline_media_raw IS NOT NULL OR p.baseline_system_raw IS NOT NULL)) AS has_breakdown_for_delta
    FROM parsed p
  )
  SELECT
    n.source_code,
    n.source_name,
    n.provider,
    n.plan_name,
    n.quota_bytes,
    n.filesystem_total_bytes,
    COALESCE(n.used_bytes, 0) AS used_bytes,
    GREATEST(
      COALESCE(n.quota_bytes, n.filesystem_total_bytes, 0) - COALESCE(n.used_bytes, 0),
      0
    ) AS remaining_bytes,
    CASE
      WHEN COALESCE(n.quota_bytes, n.filesystem_total_bytes, 0) <= 0 THEN 0::numeric
      ELSE ROUND(
        (
          COALESCE(n.used_bytes, 0)::numeric
          / COALESCE(n.quota_bytes, n.filesystem_total_bytes)::numeric
        ) * 100,
        2
      )
    END AS used_percent,
    n.measured_at,
    CASE
      WHEN n.used_bytes IS NULL OR n.baseline_used_bytes IS NULL THEN 0
      ELSE n.used_bytes - n.baseline_used_bytes
    END AS delta_used_bytes_24h,
    COALESCE(n.latest_system_used, 0) AS system_used_bytes,
    COALESCE(n.latest_media_used, 0) AS media_used_bytes,
    CASE
      WHEN n.used_bytes IS NULL OR n.baseline_used_bytes IS NULL THEN 0
      WHEN n.has_breakdown_for_delta THEN COALESCE(n.latest_system_used, 0) - COALESCE(n.baseline_system_used, 0)
      ELSE n.used_bytes - n.baseline_used_bytes
    END AS delta_system_used_bytes_24h,
    CASE
      WHEN n.used_bytes IS NULL OR n.baseline_used_bytes IS NULL THEN 0
      WHEN n.has_breakdown_for_delta THEN COALESCE(n.latest_media_used, 0) - COALESCE(n.baseline_media_used, 0)
      ELSE 0
    END AS delta_media_used_bytes_24h
  FROM normalized n
  ORDER BY n.source_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_storage_overview() TO authenticated;
