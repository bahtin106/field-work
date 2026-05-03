#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE="${SUBSCRIPTION_EMAIL_LOCK_FILE:-/var/lock/subscription-email-worker.lock}"
BATCH_LIMIT="${SUBSCRIPTION_EMAIL_BATCH_LIMIT:-100}"
MAX_BATCHES="${SUBSCRIPTION_EMAIL_MAX_BATCHES:-5}"
PROCESSING_TIMEOUT="${SUBSCRIPTION_EMAIL_PROCESSING_TIMEOUT:-15 minutes}"
EMAIL_API_URL="${EMAIL_API_URL:-http://localhost:3000/send-email}"
EMAIL_AUTH_HEADER=()
if [[ -n "${EMAIL_SERVER_API_TOKEN:-}" ]]; then
  EMAIL_AUTH_HEADER=(-H "X-Email-Server-Token: ${EMAIL_SERVER_API_TOKEN}")
fi
PSQL_CMD="docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) [skip] previous subscription email worker run is still active"
  exit 0
fi

enqueue_sql="SELECT COALESCE(SUM(enqueued_count), 0)::int FROM public.enqueue_due_subscription_email_jobs(now());"
ENQUEUED=$(echo "$enqueue_sql" | eval "$PSQL_CMD -A -t" | tr -d '[:space:]' || echo "0")

echo "$(date -u +%FT%TZ) [info] enqueued=${ENQUEUED}"

TOTAL_CLAIMED=0
TOTAL_SENT=0
TOTAL_FAILED=0

for ((batch=1; batch<=MAX_BATCHES; batch++)); do
  CLAIM_SQL=$(cat <<SQL_EOF
WITH claimed AS (
  SELECT *
  FROM public.claim_subscription_email_jobs(${BATCH_LIMIT}, interval '${PROCESSING_TIMEOUT}')
)
SELECT
  c.id,
  jsonb_build_object(
    'type', 'subscription-reminder',
    'email', c.email,
    'firstName', COALESCE(c.payload->>'first_name', ''),
    'lastName', COALESCE(c.payload->>'last_name', ''),
    'companyName', COALESCE(c.payload->>'company_name', ''),
    'subscriptionEvent', c.event_type,
    'daysLeft', COALESCE((c.payload->>'days_left')::int, 0),
    'periodEndIso', COALESCE(c.payload->>'period_end_iso', c.period_end_iso::text, ''),
    'timeZone', COALESCE(NULLIF(trim(comp.timezone), ''), c.payload->>'company_timezone', 'UTC'),
    'lang', COALESCE(c.locale, 'ru')
  )::text AS body
FROM claimed c
LEFT JOIN public.companies comp ON comp.id = c.company_id
ORDER BY c.id;
SQL_EOF
)

  ROWS=$(echo "$CLAIM_SQL" | eval "$PSQL_CMD -A -F $'\t' -t")
  if [[ -z "${ROWS//[[:space:]]/}" ]]; then
    break
  fi

  BATCH_CLAIMED=0
  while IFS=$'\t' read -r job_id body_json; do
    [[ -z "${job_id:-}" ]] && continue
    BATCH_CLAIMED=$((BATCH_CLAIMED + 1))

    tmp_body="$(mktemp)"
    http_code="$(curl -sS --max-time 30 -o "$tmp_body" -w "%{http_code}" -X POST "$EMAIL_API_URL" -H 'Content-Type: application/json' "${EMAIL_AUTH_HEADER[@]}" --data "$body_json" || echo '000')"
    response_body="$(cat "$tmp_body" 2>/dev/null || true)"
    rm -f "$tmp_body"

    if [[ "$http_code" =~ ^2[0-9][0-9]$ ]] && echo "$response_body" | grep -q '"success":true'; then
      echo "SELECT public.finish_subscription_email_job(${job_id}, true, NULL, ${http_code}, NULL);" | eval "$PSQL_CMD" >/dev/null
      TOTAL_SENT=$((TOTAL_SENT + 1))
      echo "$(date -u +%FT%TZ) [sent] job_id=${job_id}"
    else
      err='send-email failed'
      if [[ "$http_code" == "000" ]]; then
        err='send-email network failure'
      fi
      echo "SELECT public.finish_subscription_email_job(${job_id}, false, '${err}', ${http_code}, NULL);" | eval "$PSQL_CMD" >/dev/null
      TOTAL_FAILED=$((TOTAL_FAILED + 1))
      echo "$(date -u +%FT%TZ) [fail] job_id=${job_id} status=${http_code} body=${response_body}"
    fi
  done <<< "$ROWS"

  TOTAL_CLAIMED=$((TOTAL_CLAIMED + BATCH_CLAIMED))
  if (( BATCH_CLAIMED < BATCH_LIMIT )); then
    break
  fi
done

SLA_SQL="SELECT metric, value, threshold, severity, message FROM public.get_subscription_email_sla_breaches();"
SLA_ROWS=$(echo "$SLA_SQL" | eval "$PSQL_CMD -A -F $'\t' -t" || true)
if [[ -n "${SLA_ROWS//[[:space:]]/}" ]]; then
  while IFS=$'\t' read -r metric value threshold severity message; do
    [[ -z "${metric:-}" ]] && continue
    echo "$(date -u +%FT%TZ) [sla] severity=${severity} metric=${metric} value=${value} threshold=${threshold} message=${message}"
  done <<< "$SLA_ROWS"
fi

echo "$(date -u +%FT%TZ) [done] claimed=${TOTAL_CLAIMED} sent=${TOTAL_SENT} failed=${TOTAL_FAILED} enqueued=${ENQUEUED}"
