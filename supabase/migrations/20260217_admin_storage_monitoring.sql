-- Admin VPS storage monitoring (professional baseline).
-- Stores storage sources (plans/quotas) and time-series snapshots (usage metrics).
-- Intended for /admin/storage screen and future alerting/automation.

CREATE TABLE IF NOT EXISTS public.admin_storage_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  provider text,
  plan_name text,
  quota_bytes bigint,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_storage_sources_quota_bytes_chk CHECK (quota_bytes IS NULL OR quota_bytes > 0)
);

CREATE TABLE IF NOT EXISTS public.admin_storage_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES public.admin_storage_sources(id) ON DELETE CASCADE,
  measured_at timestamptz NOT NULL DEFAULT now(),
  filesystem_total_bytes bigint,
  used_bytes bigint NOT NULL,
  available_bytes bigint,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_storage_metrics_used_bytes_chk CHECK (used_bytes >= 0),
  CONSTRAINT admin_storage_metrics_filesystem_total_bytes_chk CHECK (filesystem_total_bytes IS NULL OR filesystem_total_bytes >= 0),
  CONSTRAINT admin_storage_metrics_available_bytes_chk CHECK (available_bytes IS NULL OR available_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_admin_storage_metrics_source_measured_at
  ON public.admin_storage_metrics(source_id, measured_at DESC);

CREATE OR REPLACE FUNCTION public.tg_admin_storage_sources_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_storage_sources_touch_updated_at ON public.admin_storage_sources;
CREATE TRIGGER trg_admin_storage_sources_touch_updated_at
BEFORE UPDATE ON public.admin_storage_sources
FOR EACH ROW
EXECUTE FUNCTION public.tg_admin_storage_sources_touch_updated_at();

CREATE OR REPLACE FUNCTION public.admin_storage_assert_access()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN;
  END IF;

  IF v_claim_role = 'service_role' THEN
    RETURN;
  END IF;

  PERFORM public.admin_assert_super_admin();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_storage_metric(
  p_source_code text,
  p_source_name text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_plan_name text DEFAULT NULL,
  p_quota_bytes bigint DEFAULT NULL,
  p_filesystem_total_bytes bigint DEFAULT NULL,
  p_used_bytes bigint DEFAULT NULL,
  p_available_bytes bigint DEFAULT NULL,
  p_measured_at timestamptz DEFAULT now(),
  p_raw jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  source_id uuid,
  source_code text,
  measured_at timestamptz,
  used_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.admin_storage_sources%ROWTYPE;
  v_used_bytes bigint := COALESCE(p_used_bytes, 0);
  v_available_bytes bigint := p_available_bytes;
BEGIN
  PERFORM public.admin_storage_assert_access();

  IF NULLIF(trim(COALESCE(p_source_code, '')), '') IS NULL THEN
    RAISE EXCEPTION 'source_code is required';
  END IF;

  IF p_quota_bytes IS NOT NULL AND p_quota_bytes <= 0 THEN
    RAISE EXCEPTION 'quota_bytes must be positive';
  END IF;

  IF p_filesystem_total_bytes IS NOT NULL AND p_filesystem_total_bytes < 0 THEN
    RAISE EXCEPTION 'filesystem_total_bytes must be >= 0';
  END IF;

  IF v_used_bytes < 0 THEN
    RAISE EXCEPTION 'used_bytes must be >= 0';
  END IF;

  IF v_available_bytes IS NOT NULL AND v_available_bytes < 0 THEN
    RAISE EXCEPTION 'available_bytes must be >= 0';
  END IF;

  INSERT INTO public.admin_storage_sources (
    code,
    name,
    provider,
    plan_name,
    quota_bytes,
    metadata
  )
  VALUES (
    trim(p_source_code),
    COALESCE(NULLIF(trim(p_source_name), ''), trim(p_source_code)),
    NULLIF(trim(p_provider), ''),
    NULLIF(trim(p_plan_name), ''),
    p_quota_bytes,
    COALESCE(p_raw, '{}'::jsonb)
  )
  ON CONFLICT (code) DO UPDATE
  SET
    name = COALESCE(NULLIF(trim(EXCLUDED.name), ''), public.admin_storage_sources.name),
    provider = COALESCE(EXCLUDED.provider, public.admin_storage_sources.provider),
    plan_name = COALESCE(EXCLUDED.plan_name, public.admin_storage_sources.plan_name),
    quota_bytes = COALESCE(EXCLUDED.quota_bytes, public.admin_storage_sources.quota_bytes),
    metadata = COALESCE(public.admin_storage_sources.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
  RETURNING *
  INTO v_source;

  INSERT INTO public.admin_storage_metrics (
    source_id,
    measured_at,
    filesystem_total_bytes,
    used_bytes,
    available_bytes,
    raw
  )
  VALUES (
    v_source.id,
    COALESCE(p_measured_at, now()),
    p_filesystem_total_bytes,
    v_used_bytes,
    v_available_bytes,
    COALESCE(p_raw, '{}'::jsonb)
  );

  RETURN QUERY
  SELECT v_source.id, v_source.code, COALESCE(p_measured_at, now()), v_used_bytes;
END;
$$;

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
  prev24 AS (
    SELECT
      l.source_id,
      p.used_bytes AS prev_used_bytes
    FROM latest l
    LEFT JOIN LATERAL (
      SELECT m.used_bytes
      FROM public.admin_storage_metrics m
      WHERE m.source_id = l.source_id
        AND m.measured_at <= l.measured_at - interval '24 hours'
      ORDER BY m.measured_at DESC
      LIMIT 1
    ) p ON true
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
      WHEN p.prev_used_bytes IS NULL OR l.used_bytes IS NULL THEN 0
      ELSE l.used_bytes - p.prev_used_bytes
    END AS delta_used_bytes_24h
  FROM src s
  LEFT JOIN latest l ON l.source_id = s.id
  LEFT JOIN prev24 p ON p.source_id = s.id
  ORDER BY s.code;
END;
$$;

REVOKE ALL ON TABLE public.admin_storage_sources FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_storage_metrics FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_storage_assert_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_storage_metric(text, text, text, text, bigint, bigint, bigint, bigint, timestamptz, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_storage_overview() TO authenticated;

