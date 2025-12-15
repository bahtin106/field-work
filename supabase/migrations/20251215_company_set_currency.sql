-- Migration: create RPC to set company currency and optionally recalc orders
-- Creates function public.company_set_currency(p_company_id uuid, p_new_currency text, p_rate numeric default null, p_recalc_existing boolean default false)

-- NOTE: This migration should be applied via psql / Supabase migrations. Review for your environment.

CREATE OR REPLACE FUNCTION public.company_set_currency(
  p_company_id uuid,
  p_new_currency text,
  p_rate numeric DEFAULT NULL,
  p_recalc_existing boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _lock bigint;
BEGIN
  -- Acquire an advisory lock per company to prevent concurrent currency jobs
  _lock := ('x' || substr(md5(p_company_id::text), 1, 15))::bit(60)::bigint; -- derive numeric lock from uuid
  PERFORM pg_advisory_xact_lock(_lock);

  -- Mark recalc_in_progress if requested
  IF p_recalc_existing THEN
    UPDATE companies
    SET recalc_in_progress = true,
        recalc_job_id = gen_random_uuid()
    WHERE id = p_company_id;
  END IF;

  -- Update companies table with new currency and rate
  UPDATE companies
  SET currency = p_new_currency,
      currency_rate = p_rate,
      currency_rate_updated_at = now()
  WHERE id = p_company_id;

  -- Always update orders.currency to the new currency so UI and reports are consistent
  UPDATE orders
  SET currency = p_new_currency
  WHERE company_id = p_company_id;

  -- If recalculation requested and a rate is provided, update numeric finance fields
  IF p_recalc_existing AND p_rate IS NOT NULL THEN
    -- WARNING: This will update all matching rows in one statement. For very large tables
    -- consider implementing batch updates in a worker process to avoid long locks.
    UPDATE orders
    SET price = CASE WHEN price IS NULL THEN NULL ELSE round((price::numeric * p_rate)::numeric, 2) END,
        fuel_cost = CASE WHEN fuel_cost IS NULL THEN NULL ELSE round((fuel_cost::numeric * p_rate)::numeric, 2) END
    WHERE company_id = p_company_id;
  END IF;

  -- Clear recalc flag
  IF p_recalc_existing THEN
    UPDATE companies
    SET recalc_in_progress = false,
        recalc_job_id = NULL
    WHERE id = p_company_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id::text, 'new_currency', p_new_currency);
EXCEPTION WHEN OTHERS THEN
  -- Ensure recalc flag is cleared on error to avoid blocking edits permanently
  BEGIN
    UPDATE companies
    SET recalc_in_progress = false,
        recalc_job_id = NULL
    WHERE id = p_company_id;
  EXCEPTION WHEN OTHERS THEN
    -- ignore
  END;
  RAISE;
END;
$$;

COMMENT ON FUNCTION public.company_set_currency(uuid,text,numeric,boolean) IS 'Set company currency and optionally recalc all orders'' price/fuel_cost using provided rate. Updates orders.currency for all company orders.';
