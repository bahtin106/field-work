-- Retention policy for admin_storage_metrics.
-- Keeps recent snapshots only (default: 36 hours) to preserve 24h delta accuracy.

CREATE INDEX IF NOT EXISTS idx_admin_storage_metrics_measured_at
  ON public.admin_storage_metrics(measured_at);

CREATE OR REPLACE FUNCTION public.admin_prune_storage_metrics(
  p_retain interval DEFAULT interval '36 hours'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted bigint := 0;
  v_retain interval := COALESCE(p_retain, interval '36 hours');
BEGIN
  PERFORM public.admin_storage_assert_access();

  IF v_retain < interval '24 hours' THEN
    RAISE EXCEPTION 'retain interval must be >= 24 hours';
  END IF;

  WITH deleted AS (
    DELETE FROM public.admin_storage_metrics
    WHERE measured_at < now() - v_retain
    RETURNING 1
  )
  SELECT COUNT(*)::bigint INTO v_deleted
  FROM deleted;

  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_prune_storage_metrics(interval) TO authenticated;
