BEGIN;

CREATE OR REPLACE FUNCTION public.sync_subscription_access_states()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_processed int := 0;
  v_fixed int := 0;
BEGIN
  FOR v_company_id IN
    WITH candidates AS (
      SELECT DISTINCT cs.company_id
      FROM public.company_subscriptions cs
      WHERE cs.company_id IS NOT NULL
        AND (
          (
            cs.current_period_end < now()
            AND EXISTS (
              SELECT 1
              FROM public.profiles p
              WHERE p.company_id = cs.company_id
                AND lower(COALESCE(p.role, '')) <> 'admin'
                AND COALESCE(p.license_state, 'active') <> 'blocked_by_license'
            )
          )
          OR
          (
            cs.current_period_end >= now()
            AND EXISTS (
              SELECT 1
              FROM public.profiles p
              WHERE p.company_id = cs.company_id
                AND lower(COALESCE(p.role, '')) <> 'admin'
                AND COALESCE(p.license_state, 'active') = 'blocked_by_license'
                AND lower(COALESCE(p.blocked_reason, '')) IN (
                  'subscription_expired',
                  'no_paid_seat',
                  'license_block',
                  'auto_downgrade'
                )
            )
          )
        )
    )
    SELECT company_id FROM candidates
  LOOP
    v_processed := v_processed + 1;
    PERFORM public.repair_company_seat_pool(v_company_id);
    v_fixed := v_fixed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'fixed', v_fixed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_subscription_access_states() TO service_role;

COMMIT;
