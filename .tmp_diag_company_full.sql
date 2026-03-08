-- company + subscription
SELECT c.id, c.name, cs.current_period_end, cs.status,
       ((date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) - ((now() AT TIME ZONE 'UTC')::date))::int AS days_left_utc
FROM public.companies c
LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id
WHERE c.id = 'a8f52d3f-c189-4df2-9690-b34a26d2e114';

-- admins and email resolution
SELECT
  p.id AS profile_id,
  p.user_id,
  p.role,
  p.is_suspended,
  p.email AS profile_email,
  au1.email AS auth_email_by_profile_id,
  au2.email AS auth_email_by_user_id,
  COALESCE(NULLIF(au2.email,''), NULLIF(au1.email,''), NULLIF(p.email,'')) AS resolved_email
FROM public.profiles p
LEFT JOIN auth.users au1 ON au1.id = p.id
LEFT JOIN auth.users au2 ON au2.id = p.user_id
WHERE p.company_id = 'a8f52d3f-c189-4df2-9690-b34a26d2e114'
  AND p.role = 'admin'
ORDER BY p.created_at;

-- reminder history
SELECT id, recipient_user_id, event_type, period_end_date, email, sent_at, created_at
FROM public.subscription_email_notifications
WHERE company_id = 'a8f52d3f-c189-4df2-9690-b34a26d2e114'
ORDER BY id DESC
LIMIT 20;
