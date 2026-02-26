BEGIN;

CREATE TABLE IF NOT EXISTS public.subscription_email_notifications (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('warning_7d', 'warning_1d', 'expired')),
  period_end_date date NOT NULL,
  email text,
  locale text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_email_notifications_unique_event
  ON public.subscription_email_notifications (company_id, recipient_user_id, event_type, period_end_date);

CREATE INDEX IF NOT EXISTS subscription_email_notifications_sent_at_idx
  ON public.subscription_email_notifications (sent_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_email_notifications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.subscription_email_notifications_id_seq TO service_role;

COMMIT;
