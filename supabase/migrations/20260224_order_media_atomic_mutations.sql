-- Atomic media URL mutations for concurrent order editing.
-- Prevents lost updates when multiple users upload/delete media in the same order.

CREATE OR REPLACE FUNCTION public.append_order_media_url(
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
    RAISE EXCEPTION 'Unsupported category';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF p_category = 'contract_file' THEN
    v_next := ARRAY(
      SELECT x.val
      FROM (
        SELECT e AS val, MIN(ord) AS first_ord
        FROM unnest(COALESCE(v_order.contract_file, '{}'::text[]) || ARRAY[p_url]) WITH ORDINALITY t(e, ord)
        WHERE COALESCE(e, '') <> ''
        GROUP BY e
      ) x
      ORDER BY x.first_ord
    );
    UPDATE public.orders o
    SET contract_file = v_next,
        updated_at = now()
    WHERE o.id = v_order.id
    RETURNING o.contract_file, o.updated_at
    INTO media_urls, updated_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_category = 'photo_before' THEN
    v_next := ARRAY(
      SELECT x.val
      FROM (
        SELECT e AS val, MIN(ord) AS first_ord
        FROM unnest(COALESCE(v_order.photo_before, '{}'::text[]) || ARRAY[p_url]) WITH ORDINALITY t(e, ord)
        WHERE COALESCE(e, '') <> ''
        GROUP BY e
      ) x
      ORDER BY x.first_ord
    );
    UPDATE public.orders o
    SET photo_before = v_next,
        updated_at = now()
    WHERE o.id = v_order.id
    RETURNING o.photo_before, o.updated_at
    INTO media_urls, updated_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_category = 'photo_after' THEN
    v_next := ARRAY(
      SELECT x.val
      FROM (
        SELECT e AS val, MIN(ord) AS first_ord
        FROM unnest(COALESCE(v_order.photo_after, '{}'::text[]) || ARRAY[p_url]) WITH ORDINALITY t(e, ord)
        WHERE COALESCE(e, '') <> ''
        GROUP BY e
      ) x
      ORDER BY x.first_ord
    );
    UPDATE public.orders o
    SET photo_after = v_next,
        updated_at = now()
    WHERE o.id = v_order.id
    RETURNING o.photo_after, o.updated_at
    INTO media_urls, updated_at;
    RETURN NEXT;
    RETURN;
  END IF;

  v_next := ARRAY(
    SELECT x.val
    FROM (
      SELECT e AS val, MIN(ord) AS first_ord
      FROM unnest(COALESCE(v_order.act_file, '{}'::text[]) || ARRAY[p_url]) WITH ORDINALITY t(e, ord)
      WHERE COALESCE(e, '') <> ''
      GROUP BY e
    ) x
    ORDER BY x.first_ord
  );
  UPDATE public.orders o
  SET act_file = v_next,
      updated_at = now()
  WHERE o.id = v_order.id
  RETURNING o.act_file, o.updated_at
  INTO media_urls, updated_at;
  RETURN NEXT;
  RETURN;
END;
$$;

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
    RAISE EXCEPTION 'Unsupported category';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF p_category = 'contract_file' THEN
    v_next := ARRAY(
      SELECT e
      FROM unnest(COALESCE(v_order.contract_file, '{}'::text[])) t(e)
      WHERE COALESCE(e, '') <> ''
        AND e <> p_url
    );
    UPDATE public.orders o
    SET contract_file = NULLIF(v_next, '{}'::text[]),
        updated_at = now()
    WHERE o.id = v_order.id
    RETURNING o.contract_file, o.updated_at
    INTO media_urls, updated_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_category = 'photo_before' THEN
    v_next := ARRAY(
      SELECT e
      FROM unnest(COALESCE(v_order.photo_before, '{}'::text[])) t(e)
      WHERE COALESCE(e, '') <> ''
        AND e <> p_url
    );
    UPDATE public.orders o
    SET photo_before = NULLIF(v_next, '{}'::text[]),
        updated_at = now()
    WHERE o.id = v_order.id
    RETURNING o.photo_before, o.updated_at
    INTO media_urls, updated_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_category = 'photo_after' THEN
    v_next := ARRAY(
      SELECT e
      FROM unnest(COALESCE(v_order.photo_after, '{}'::text[])) t(e)
      WHERE COALESCE(e, '') <> ''
        AND e <> p_url
    );
    UPDATE public.orders o
    SET photo_after = NULLIF(v_next, '{}'::text[]),
        updated_at = now()
    WHERE o.id = v_order.id
    RETURNING o.photo_after, o.updated_at
    INTO media_urls, updated_at;
    RETURN NEXT;
    RETURN;
  END IF;

  v_next := ARRAY(
    SELECT e
    FROM unnest(COALESCE(v_order.act_file, '{}'::text[])) t(e)
    WHERE COALESCE(e, '') <> ''
      AND e <> p_url
  );
  UPDATE public.orders o
  SET act_file = NULLIF(v_next, '{}'::text[]),
      updated_at = now()
  WHERE o.id = v_order.id
  RETURNING o.act_file, o.updated_at
  INTO media_urls, updated_at;
  RETURN NEXT;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_order_media_url(uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_order_media_url(uuid, uuid, text, text) TO authenticated, service_role;
