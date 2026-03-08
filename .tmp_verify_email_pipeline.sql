SELECT id,status,attempt_count,event_type,period_end_date,email,sent_at,dead_letter_at,created_at
FROM public.subscription_email_queue
ORDER BY id DESC
LIMIT 5;

SELECT id,event_type,period_end_date,email,sent_at,created_at
FROM public.subscription_email_notifications
ORDER BY id DESC
LIMIT 5;

SELECT * FROM public.subscription_email_sla_metrics;
