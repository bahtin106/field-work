-- Keep media arrays non-null when removing last url from orders.* columns.
-- Some environments have NOT NULL constraints on these columns.

CREATE OR REPLACE FUNCTION public.remove_order_media_url(
  p_order_id uuid,
  p_company_id uuid,
  p_category text,
  p_url text
)
RETURNS TABLE(media_urls text[], updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_next text[];
BEGIN
  IF p_category NOT IN ('contract_file', 'photo_before', 'photo_after', 'act_file') THEN
    RAISE EXCEPTION 'Invalid category %', p_category;
  END IF;

  SELECT *
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.company_id = p_company_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or forbidden';
  END IF;

  IF p_category = 'contract_file' THEN
    SELECT COALESCE(ARRAY(
      SELECT e
      FROM unnest(COALESCE(v_order.contract_file, '{}'::text[])) t(e)
      WHERE e IS NOT NULL AND e <> p_url
    ), '{}'::text[]) INTO v_next;

    UPDATE public.orders o
    SET contract_file = v_next,
        updated_at = now()
    WHERE o.id = p_order_id
    RETURNING o.contract_file, o.updated_at
    INTO media_urls, updated_at;

    RETURN NEXT;
    RETURN;
  END IF;

  IF p_category = 'photo_before' THEN
    SELECT COALESCE(ARRAY(
      SELECT e
      FROM unnest(COALESCE(v_order.photo_before, '{}'::text[])) t(e)
      WHERE e IS NOT NULL AND e <> p_url
    ), '{}'::text[]) INTO v_next;

    UPDATE public.orders o
    SET photo_before = v_next,
        updated_at = now()
    WHERE o.id = p_order_id
    RETURNING o.photo_before, o.updated_at
    INTO media_urls, updated_at;

    RETURN NEXT;
    RETURN;
  END IF;

  IF p_category = 'photo_after' THEN
    SELECT COALESCE(ARRAY(
      SELECT e
      FROM unnest(COALESCE(v_order.photo_after, '{}'::text[])) t(e)
      WHERE e IS NOT NULL AND e <> p_url
    ), '{}'::text[]) INTO v_next;

    UPDATE public.orders o
    SET photo_after = v_next,
        updated_at = now()
    WHERE o.id = p_order_id
    RETURNING o.photo_after, o.updated_at
    INTO media_urls, updated_at;

    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE(ARRAY(
    SELECT e
    FROM unnest(COALESCE(v_order.act_file, '{}'::text[])) t(e)
    WHERE e IS NOT NULL AND e <> p_url
  ), '{}'::text[]) INTO v_next;

  UPDATE public.orders o
  SET act_file = v_next,
      updated_at = now()
  WHERE o.id = p_order_id
  RETURNING o.act_file, o.updated_at
  INTO media_urls, updated_at;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_order_media_url(uuid, uuid, text, text) TO authenticated, service_role;

