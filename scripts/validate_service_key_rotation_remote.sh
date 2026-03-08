#!/usr/bin/env bash
set -euo pipefail

NEW_KEY=$(grep -E '^SERVICE_ROLE_KEY=' /root/n8n-install/supabase/docker/.env | tail -1 | cut -d= -f2- | tr -d '"')
BAK=$(ls -1t /root/n8n-install/supabase/docker/.env.bak_service_rotate_* | head -1)
OLD_KEY=$(grep -E '^SERVICE_ROLE_KEY=' "$BAK" | tail -1 | cut -d= -f2- | tr -d '"')

URL='http://127.0.0.1:8000/functions/v1/yandex-disk-reconcile'
BODY='{"limit":1,"dry_run":true}'

NEW_CODE=$(curl -s -o /tmp/new_key_resp.json -w '%{http_code}' -X POST "$URL" \
  -H "Authorization: Bearer ${NEW_KEY}" \
  -H "apikey: ${NEW_KEY}" \
  -H 'Content-Type: application/json' \
  -d "$BODY")

OLD_CODE=$(curl -s -o /tmp/old_key_resp.json -w '%{http_code}' -X POST "$URL" \
  -H "Authorization: Bearer ${OLD_KEY}" \
  -H "apikey: ${OLD_KEY}" \
  -H 'Content-Type: application/json' \
  -d "$BODY")

echo "new_code=${NEW_CODE}"
echo "old_code=${OLD_CODE}"
echo "new_resp=$(head -c 220 /tmp/new_key_resp.json)"
echo "old_resp=$(head -c 220 /tmp/old_key_resp.json)"
