#!/usr/bin/env bash
set -euo pipefail

set -a
source /root/n8n-install/supabase/docker/.env
set +a

curl --fail-with-body --silent --show-error --max-time 240 \
  -X POST "http://127.0.0.1:${KONG_HTTP_PORT}/functions/v1/account-deletion" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"action":"process_pending","limit":10}'

printf '\n'
