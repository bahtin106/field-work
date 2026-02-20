-- Fix delta_used_bytes_24h calculation for admin storage overview.
-- Goal: show meaningful net change over the last 24h based on available snapshots.
-- Strategy:
-- 1) Prefer snapshot at/before (latest - 24h)
-- 2) Fallback to earliest snapshot within last 24h
-- 3) If no baseline exists, delta = 0

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
  delta_used_bytes_24h bigint
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
      m.used_bytes
    FROM public.admin_storage_metrics m
    JOIN src s ON s.id = m.source_id
    ORDER BY m.source_id, m.measured_at DESC
  ),
  baseline_24h AS (
    SELECT
      l.source_id,
      COALESCE(before24.used_bytes, earliest_in_window.used_bytes) AS baseline_used_bytes
    FROM latest l
    LEFT JOIN LATERAL (
      SELECT m.used_bytes
      FROM public.admin_storage_metrics m
      WHERE m.source_id = l.source_id
        AND m.measured_at <= l.measured_at - interval '24 hours'
      ORDER BY m.measured_at DESC
      LIMIT 1
    ) before24 ON true
    LEFT JOIN LATERAL (
      SELECT m.used_bytes
      FROM public.admin_storage_metrics m
      WHERE m.source_id = l.source_id
        AND m.measured_at > l.measured_at - interval '24 hours'
        AND m.measured_at <= l.measured_at
      ORDER BY m.measured_at ASC
      LIMIT 1
    ) earliest_in_window ON true
  )
  SELECT
    s.code AS source_code,
    s.name AS source_name,
    s.provider,
    s.plan_name,
    s.quota_bytes,
    l.filesystem_total_bytes,
    COALESCE(l.used_bytes, 0) AS used_bytes,
    GREATEST(
      COALESCE(s.quota_bytes, l.filesystem_total_bytes, 0) - COALESCE(l.used_bytes, 0),
      0
    ) AS remaining_bytes,
    CASE
      WHEN COALESCE(s.quota_bytes, l.filesystem_total_bytes, 0) <= 0 THEN 0::numeric
      ELSE ROUND(
        (
          COALESCE(l.used_bytes, 0)::numeric
          / COALESCE(s.quota_bytes, l.filesystem_total_bytes)::numeric
        ) * 100,
        2
      )
    END AS used_percent,
    l.measured_at,
    CASE
      WHEN l.used_bytes IS NULL OR b.baseline_used_bytes IS NULL THEN 0
      ELSE l.used_bytes - b.baseline_used_bytes
    END AS delta_used_bytes_24h
  FROM src s
  LEFT JOIN latest l ON l.source_id = s.id
  LEFT JOIN baseline_24h b ON b.source_id = s.id
  ORDER BY s.code;
END;
$$;
