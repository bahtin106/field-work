-- Atomic optimistic-concurrency update for orders.
-- Returns updated row when successful, NULL when row is missing or version conflict.

CREATE OR REPLACE FUNCTION public.update_order_if_version(
  p_order_id text,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.orders%ROWTYPE;
  v_updated public.orders%ROWTYPE;
BEGIN
  SELECT *
  INTO v_current
  FROM public.orders
  WHERE id::text = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN NULL;
  END IF;

  UPDATE public.orders o
  SET
    title = CASE WHEN p_patch ? 'title' THEN (p_patch->>'title') ELSE o.title END,
    comment = CASE WHEN p_patch ? 'comment' THEN (p_patch->>'comment') ELSE o.comment END,
    region = CASE WHEN p_patch ? 'region' THEN (p_patch->>'region') ELSE o.region END,
    city = CASE WHEN p_patch ? 'city' THEN (p_patch->>'city') ELSE o.city END,
    street = CASE WHEN p_patch ? 'street' THEN (p_patch->>'street') ELSE o.street END,
    house = CASE WHEN p_patch ? 'house' THEN (p_patch->>'house') ELSE o.house END,
    fio = CASE WHEN p_patch ? 'fio' THEN (p_patch->>'fio') ELSE o.fio END,
    phone = CASE WHEN p_patch ? 'phone' THEN (p_patch->>'phone') ELSE o.phone END,
    assigned_to = CASE
      WHEN p_patch ? 'assigned_to' THEN NULLIF(p_patch->>'assigned_to', '')::uuid
      ELSE o.assigned_to
    END,
    time_window_start = CASE
      WHEN p_patch ? 'time_window_start' THEN NULLIF(p_patch->>'time_window_start', '')::timestamptz
      ELSE o.time_window_start
    END,
    status = CASE WHEN p_patch ? 'status' THEN (p_patch->>'status') ELSE o.status END,
    urgent = CASE
      WHEN p_patch ? 'urgent' THEN COALESCE((p_patch->>'urgent')::boolean, false)
      ELSE o.urgent
    END,
    department_id = CASE
      WHEN p_patch ? 'department_id' THEN NULLIF(p_patch->>'department_id', '')::int
      ELSE o.department_id
    END,
    price = CASE
      WHEN p_patch ? 'price' THEN NULLIF(p_patch->>'price', '')::numeric
      ELSE o.price
    END,
    fuel_cost = CASE
      WHEN p_patch ? 'fuel_cost' THEN NULLIF(p_patch->>'fuel_cost', '')::numeric
      ELSE o.fuel_cost
    END,
    work_type_id = CASE
      WHEN p_patch ? 'work_type_id' THEN NULLIF(p_patch->>'work_type_id', '')::int
      ELSE o.work_type_id
    END,
    contract_file = CASE
      WHEN p_patch ? 'contract_file' THEN
        CASE
          WHEN p_patch->'contract_file' = 'null'::jsonb THEN NULL
          ELSE ARRAY(SELECT jsonb_array_elements_text(p_patch->'contract_file'))
        END
      ELSE o.contract_file
    END,
    photo_before = CASE
      WHEN p_patch ? 'photo_before' THEN
        CASE
          WHEN p_patch->'photo_before' = 'null'::jsonb THEN NULL
          ELSE ARRAY(SELECT jsonb_array_elements_text(p_patch->'photo_before'))
        END
      ELSE o.photo_before
    END,
    photo_after = CASE
      WHEN p_patch ? 'photo_after' THEN
        CASE
          WHEN p_patch->'photo_after' = 'null'::jsonb THEN NULL
          ELSE ARRAY(SELECT jsonb_array_elements_text(p_patch->'photo_after'))
        END
      ELSE o.photo_after
    END,
    act_file = CASE
      WHEN p_patch ? 'act_file' THEN
        CASE
          WHEN p_patch->'act_file' = 'null'::jsonb THEN NULL
          ELSE ARRAY(SELECT jsonb_array_elements_text(p_patch->'act_file'))
        END
      ELSE o.act_file
    END
  WHERE o.id::text = p_order_id
  RETURNING o.*
  INTO v_updated;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_order_if_version(text, timestamptz, jsonb) TO authenticated;
