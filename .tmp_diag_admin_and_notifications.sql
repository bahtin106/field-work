-- admins and email resolution, compatible with schemas that may not have profiles.user_id
SELECT
  p.id AS profile_id,
  (to_jsonb(p)->>'user_id') AS user_id_text,
  p.role,
  p.is_suspended,
  NULLIF(to_jsonb(p)->>'email', '') AS profile_email,
  au1.email AS auth_email_by_profile_id,
  au2.email AS auth_email_by_user_id,
  COALESCE(NULLIF(au2.email,''), NULLIF(au1.email,''), NULLIF(to_jsonb(p)->>'email','')) AS resolved_email
FROM public.profiles p
LEFT JOIN auth.users au1 ON au1.id = p.id
LEFT JOIN auth.users au2 ON au2.id = NULLIF(to_jsonb(p)->>'user_id','')::uuid
WHERE p.company_id = 'a8f52d3f-c189-4df2-9690-b34a26d2e114'
  AND p.role = 'admin'
ORDER BY p.created_at;

SELECT id, recipient_user_id, event_type, period_end_date, email, sent_at, created_at
FROM public.subscription_email_notifications
WHERE company_id = 'a8f52d3f-c189-4df2-9690-b34a26d2e114'
ORDER BY id DESC
LIMIT 20;
