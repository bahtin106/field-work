#!/bin/bash
set -euo pipefail

# Extract keys from .env and container
SERVICE_KEY=$(grep "^SERVICE_ROLE_KEY=" /root/n8n-install/.env | cut -d= -f2 | tr -d '"')
RECONCILE_KEY=$(docker exec supabase-edge-functions printenv YANDEX_RECONCILE_KEY)

echo "Testing yandex-disk-reconcile with valid keys..."
echo "=================================================="
echo ""

# Call reconcile with both keys
curl -v -X POST http://localhost:8000/functions/v1/yandex-disk-reconcile \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "x-reconcile-key: $RECONCILE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run":true,"limit":3}' 2>&1 | tee /tmp/reconcile_response.txt

echo ""
echo "=================================================="
echo "Response saved to /tmp/reconcile_response.txt"
