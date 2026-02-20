#!/usr/bin/env bash
set -euo pipefail

# Required:
#   PUSH_SEND_URL="https://<your-supabase>/functions/v1/push-send"
# Optional:
#   PUSH_WORKER_KEY="<same value as edge env PUSH_WORKER_KEY>"
#   PUSH_LIMIT="100"

: "${PUSH_SEND_URL:?PUSH_SEND_URL is required}"

limit="${PUSH_LIMIT:-100}"

if [[ -n "${PUSH_WORKER_KEY:-}" ]]; then
  curl --fail --silent --show-error \
    -X POST "$PUSH_SEND_URL" \
    -H "Content-Type: application/json" \
    -H "x-worker-key: ${PUSH_WORKER_KEY}" \
    -d "{\"limit\": ${limit}}"
else
  curl --fail --silent --show-error \
    -X POST "$PUSH_SEND_URL" \
    -H "Content-Type: application/json" \
    -d "{\"limit\": ${limit}}"
fi
