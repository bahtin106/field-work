-- Migration: create finance_currency_recalc_jobs table and update company_set_currency to enqueue recalculation job

-- Create jobs table
CREATE TABLE IF NOT EXISTS public.finance_currency_recalc_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  new_currency text NOT NULL,
  rate numeric NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_count bigint NOT NULL DEFAULT 0,
  total_count bigint NULL,
  batch_size int NOT NULL DEFAULT 1000,
  error text NULL
);

CREATE INDEX IF NOT EXISTS idx_finance_currency_recalc_jobs_company_id_status ON public.finance_currency_recalc_jobs(company_id, status);

-- Ensure companies has recalc_job_id column (if not already)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'recalc_job_id'
  ) THEN
    ALTER TABLE public.companies ADD COLUMN recalc_job_id uuid NULL;
  END IF;
END$$;

-- Replace company_set_currency to enqueue job for price recalculation while updating orders.currency immediately
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
  job_id uuid;
BEGIN
  -- Update companies record with new currency and rate
  UPDATE companies
  SET currency = p_new_currency,
      currency_rate = p_rate,
      currency_rate_updated_at = now()
  WHERE id = p_company_id;

  -- Immediately update orders.currency to reflect new currency (fast single-column update)
  UPDATE orders
  SET currency = p_new_currency
  WHERE company_id = p_company_id;

  IF p_recalc_existing THEN
    -- enqueue a background job to recalc numeric fields (price/fuel_cost) in batches
    INSERT INTO public.finance_currency_recalc_jobs(company_id, new_currency, rate, status, created_at, updated_at)
    VALUES (p_company_id, p_new_currency, p_rate, 'pending', now(), now())
    RETURNING id INTO job_id;

    -- mark company as in-progress and record job id
    UPDATE companies
    SET recalc_in_progress = true,
        recalc_job_id = job_id
    WHERE id = p_company_id;

    -- notify listener (worker)
    PERFORM pg_notify('currency_recalc_queue', job_id::text);

    RETURN jsonb_build_object('ok', true, 'enqueued', true, 'job_id', job_id::text);
  END IF;

  RETURN jsonb_build_object('ok', true, 'enqueued', false);
EXCEPTION WHEN OTHERS THEN
  -- try to clear recalc flag if something failed
  BEGIN
    UPDATE companies SET recalc_in_progress = false, recalc_job_id = NULL WHERE id = p_company_id;
  EXCEPTION WHEN OTHERS THEN
    -- ignore
  END;
  RAISE;
END;
$$;

COMMENT ON FUNCTION public.company_set_currency(uuid,text,numeric,boolean) IS
  'Set company currency and optionally enqueue background recalculation job. Immediately updates orders.currency; heavy numeric recalcs are performed by background worker.';
