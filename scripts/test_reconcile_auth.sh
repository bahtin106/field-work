#!/bin/bash
set -euo pipefail

# Extract SERVICE_ROLE_KEY from .env (remove quotes)
KEY=$(grep "^SERVICE_ROLE_KEY=" /root/n8n-install/.env | cut -d= -f2 | tr -d '"')

echo "==================================================="
echo "Testing yandex-disk-reconcile authentication"
echo "==================================================="
echo ""

# Test 1: Invalid key
echo "[1/3] Testing with INVALID KEY..."
RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
  http://localhost:8000/functions/v1/yandex-disk-reconcile \
  -H 'Authorization: Bearer invalid-random-key-xyz' \
  -H 'Content-Type: application/json' \
  -d '{"dry_run":true,"limit":3}')
CODE=$(echo "$RESP" | grep HTTP_CODE | cut -d: -f2)
BODY=$(echo "$RESP" | grep -v HTTP_CODE)
echo "Status: $CODE (expected: 401)"
echo "Response: $BODY"
echo ""

# Test 2: No Authorization header
echo "[2/3] Testing with NO AUTHORIZATION..."
RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
  http://localhost:8000/functions/v1/yandex-disk-reconcile \
  -H 'Content-Type: application/json' \
  -d '{"dry_run":true,"limit":3}')
CODE=$(echo "$RESP" | grep HTTP_CODE | cut -d: -f2)
BODY=$(echo "$RESP" | grep -v HTTP_CODE)
echo "Status: $CODE (expected: 401)"
echo "Response: $BODY"
echo ""

# Test 3: Valid SERVICE_ROLE_KEY + x-reconcile-key
echo "[3/3] Testing with VALID SERVICE_ROLE_KEY + x-reconcile-key..."
RECONCILE_KEY=$(docker exec supabase-edge-functions printenv YANDEX_RECONCILE_KEY || echo "")
RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
  http://localhost:8000/functions/v1/yandex-disk-reconcile \
  -H "Authorization: Bearer $KEY" \
  -H "x-reconcile-key: $RECONCILE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run":true,"limit":5}')
CODE=$(echo "$RESP" | grep HTTP_CODE | cut -d: -f2)
BODY=$(echo "$RESP" | grep -v HTTP_CODE)
echo "Status: $CODE (expected: 200)"
echo "Response: $BODY"
echo ""

# Summary
echo "==================================================="
echo "AUTH TEST SUMMARY:"
echo "==================================================="
echo "Invalid key:      $([ \"$CODE\" = \"401\" ] && echo '✓ PASS' || echo '✗ FAIL')"
echo "No auth:          $([ \"$CODE\" = \"401\" ] && echo '✓ PASS' || echo '✗ FAIL')"
echo "Valid SERVICE KEY: $([ \"$CODE\" = \"200\" ] && echo '✓ PASS' || echo '✗ FAIL')"
