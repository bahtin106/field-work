BEGIN;

CREATE OR REPLACE FUNCTION public.get_push_tokens_bulk(
  p_user_ids uuid[]
)
RETURNS TABLE(
  user_id uuid,
  token text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      pt.user_id,
      pt.token,
      ROW_NUMBER() OVER (
        PARTITION BY pt.user_id, COALESCE(NULLIF(trim(pt.device_id), ''), pt.token)
        ORDER BY COALESCE(pt.last_seen_at, pt.updated_at, pt.created_at) DESC, pt.id DESC
      ) AS rn
    FROM public.push_tokens pt
    WHERE pt.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]))
      AND COALESCE(pt.is_valid, true) = true
      AND pt.token IS NOT NULL
      AND length(pt.token) > 0
  )
  SELECT ranked.user_id, ranked.token
  FROM ranked
  WHERE ranked.rn = 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_push_tokens_bulk(uuid[]) TO service_role;

COMMIT;
