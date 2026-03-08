#!/usr/bin/env bash
set -euo pipefail
set -a
source /root/n8n-install/.env
set +a

# Extract YANDEX_RECONCILE_KEY from container
RECONCILE_KEY=$(docker exec supabase-edge-functions printenv YANDEX_RECONCILE_KEY 2>/dev/null || echo "")

curl -sS -X POST "http://127.0.0.1:8000/functions/v1/yandex-disk-reconcile" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "x-reconcile-key: ${RECONCILE_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"limit":400,"dry_run":false}' \
  >> /var/log/yandex_reconcile.log 2>&1

printf '\n' >> /var/log/yandex_reconcile.log
