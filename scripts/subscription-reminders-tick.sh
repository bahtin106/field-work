#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE='/var/lock/subscription-reminders-tick.lock'
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) [skip] previous subscription reminder run is still active"
  exit 0
fi

SQL=$(cat <<'SQL_EOF'
WITH due_subscriptions AS (
  SELECT
    cs.company_id,
    cs.current_period_end,
    (date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) AS period_end_date,
    ((date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) - ((now() AT TIME ZONE 'UTC')::date))::int AS days_left,
    CASE
      WHEN ((date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) - ((now() AT TIME ZONE 'UTC')::date))::int <= 0 THEN 'expired'
      WHEN ((date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) - ((now() AT TIME ZONE 'UTC')::date))::int = 1 THEN 'warning_1d'
      WHEN ((date_trunc('day', cs.current_period_end AT TIME ZONE 'UTC')::date) - ((now() AT TIME ZONE 'UTC')::date))::int = 7 THEN 'warning_7d'
      ELSE NULL
    END AS event_type
  FROM public.company_subscriptions cs
  WHERE cs.company_id IS NOT NULL
    AND cs.current_period_end IS NOT NULL
), candidates AS (
  SELECT
    ds.company_id,
    p.id AS recipient_user_id,
    ds.event_type,
    ds.period_end_date,
    COALESCE(NULLIF(au.email, ''), NULLIF(to_jsonb(p)->>'email', '')) AS email,
    CASE WHEN lower(COALESCE(p.locale, 'ru')) LIKE 'en%' THEN 'en' ELSE 'ru' END AS lang,
    COALESCE(p.first_name, '') AS first_name,
    COALESCE(p.last_name, '') AS last_name,
    COALESCE(c.name, '') AS company_name,
    ds.days_left,
    ds.current_period_end
  FROM due_subscriptions ds
  JOIN public.profiles p
    ON p.company_id = ds.company_id
   AND p.role = 'admin'
   AND COALESCE(p.is_suspended, false) = false
  LEFT JOIN auth.users au
    ON au.id = COALESCE(NULLIF(to_jsonb(p)->>'user_id', '')::uuid, p.id)
  LEFT JOIN public.companies c ON c.id = ds.company_id
  WHERE ds.event_type IS NOT NULL
    AND COALESCE(NULLIF(au.email, ''), NULLIF(to_jsonb(p)->>'email', '')) IS NOT NULL
), ins AS (
  INSERT INTO public.subscription_email_notifications (
    company_id,
    recipient_user_id,
    event_type,
    period_end_date,
    email,
    locale,
    payload
  )
  SELECT
    c.company_id,
    c.recipient_user_id,
    c.event_type,
    c.period_end_date,
    c.email,
    c.lang,
    jsonb_build_object(
      'first_name', c.first_name,
      'last_name', c.last_name,
      'company_name', c.company_name,
      'days_left', c.days_left,
      'period_end_iso', c.current_period_end
    )
  FROM candidates c
  ON CONFLICT (company_id, recipient_user_id, event_type, period_end_date) DO NOTHING
  RETURNING id, email, payload, locale, event_type
)
SELECT
  i.id,
  jsonb_build_object(
    'type', 'subscription-reminder',
    'email', i.email,
    'firstName', COALESCE(i.payload->>'first_name', ''),
    'lastName', COALESCE(i.payload->>'last_name', ''),
    'companyName', COALESCE(i.payload->>'company_name', ''),
    'subscriptionEvent', i.event_type,
    'daysLeft', COALESCE((i.payload->>'days_left')::int, 0),
    'periodEndIso', COALESCE(i.payload->>'period_end_iso', ''),
    'lang', COALESCE(i.locale, 'ru')
  )::text AS email_body
FROM ins i
ORDER BY i.id;
SQL_EOF
)

ROWS=$(docker exec -i supabase-db psql -U supabase_admin -d postgres -A -F $'\t' -t -v ON_ERROR_STOP=1 -c "$SQL")

if [[ -z "${ROWS//[[:space:]]/}" ]]; then
  echo "$(date -u +%FT%TZ) [ok] no due subscription reminders"
  exit 0
fi

SENT=0
FAILED=0

while IFS=$'\t' read -r notification_id email_body; do
  [[ -z "${notification_id:-}" ]] && continue

  RESPONSE=$(curl -sS --max-time 30 -X POST http://localhost:3000/send-email \
    -H 'Content-Type: application/json' \
    --data "$email_body" || true)

  if echo "$RESPONSE" | grep -q '"success":true'; then
    docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c \
      "UPDATE public.subscription_email_notifications SET sent_at = now() WHERE id = ${notification_id};" >/dev/null
    SENT=$((SENT + 1))
    echo "$(date -u +%FT%TZ) [sent] notification_id=${notification_id}"
  else
    docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c \
      "DELETE FROM public.subscription_email_notifications WHERE id = ${notification_id};" >/dev/null
    FAILED=$((FAILED + 1))
    echo "$(date -u +%FT%TZ) [fail] notification_id=${notification_id} response=${RESPONSE}"
  fi
done <<< "$ROWS"

echo "$(date -u +%FT%TZ) [done] sent=${SENT} failed=${FAILED}"
