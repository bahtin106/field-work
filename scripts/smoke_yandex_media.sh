#!/usr/bin/env bash
set -euo pipefail
set -a
source /root/n8n-install/supabase/docker/.env
set +a

cat >/tmp/yandex_media_req.json <<'EOF'
{"action":"resolve_urls","order_id":"00000000-0000-0000-0000-000000000000","urls":[]}
EOF

HTTP_CODE=$(curl -sS -o /tmp/yandex_media_resp.json -w "%{http_code}" \
  -X POST "http://127.0.0.1:${KONG_HTTP_PORT}/functions/v1/yandex-disk-media" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  --data @/tmp/yandex_media_req.json)

echo "HTTP ${HTTP_CODE}"
cat /tmp/yandex_media_resp.json
