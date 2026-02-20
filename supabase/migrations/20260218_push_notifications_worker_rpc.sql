BEGIN;

CREATE OR REPLACE FUNCTION public.get_company_notification_recipients(
  p_company_id uuid
)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id AS user_id
  FROM public.profiles p
  WHERE p.company_id = p_company_id
    AND p.role IN ('admin', 'dispatcher', 'worker');
$$;

CREATE OR REPLACE FUNCTION public.get_notification_prefs_bulk(
  p_user_ids uuid[]
)
RETURNS TABLE(
  user_id uuid,
  allow boolean,
  new_orders boolean,
  feed_orders boolean,
  reminders boolean,
  quiet_start time,
  quiet_end time
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    np.user_id,
    np.allow,
    np.new_orders,
    np.feed_orders,
    np.reminders,
    np.quiet_start,
    np.quiet_end
  FROM public.notification_prefs np
  WHERE np.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]));
$$;

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
  SELECT pt.user_id, pt.token
  FROM public.push_tokens pt
  WHERE pt.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]))
    AND COALESCE(pt.is_valid, true) = true
    AND pt.token IS NOT NULL
    AND length(pt.token) > 0;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_notification_recipients(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_notification_prefs_bulk(uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_push_tokens_bulk(uuid[]) TO anon, authenticated, service_role;

COMMIT;
