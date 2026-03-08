#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE='/var/lock/subscription-email-worker.lock'
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) [skip] previous subscription email worker run is still active"
  exit 0
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "$PROJECT_ROOT"
node scripts/subscription-email-worker.js
