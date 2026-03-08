#!/usr/bin/env bash
set -euo pipefail

set -a
source /root/n8n-install/supabase/docker/.env
set +a

cat >/tmp/reconcile_body.json <<'EOF'
{"limit":400,"dry_run":false}
EOF

curl -sS -X POST "http://127.0.0.1:${KONG_HTTP_PORT}/functions/v1/yandex-disk-reconcile" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "x-reconcile-key: ${YANDEX_RECONCILE_KEY}" \
  -H "Content-Type: application/json" \
  --data @/tmp/reconcile_body.json
