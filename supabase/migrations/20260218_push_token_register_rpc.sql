BEGIN;

CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token text,
  p_platform text DEFAULT 'unknown',
  p_device_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'Token is required';
  END IF;

  INSERT INTO public.push_tokens (
    user_id,
    token,
    platform,
    device_id,
    is_valid,
    invalid_reason,
    last_seen_at
  )
  VALUES (
    v_user_id,
    trim(p_token),
    COALESCE(NULLIF(trim(p_platform), ''), 'unknown'),
    NULLIF(trim(COALESCE(p_device_id, '')), ''),
    true,
    NULL,
    now()
  )
  ON CONFLICT (token) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    device_id = COALESCE(EXCLUDED.device_id, public.push_tokens.device_id),
    is_valid = true,
    invalid_reason = NULL,
    last_seen_at = now(),
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_push_token(text, text, text) TO authenticated, service_role;

COMMIT;
