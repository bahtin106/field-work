#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

PUSH_WORKER_ENV="${PUSH_WORKER_ENV:-/root/.config/monitorapp/push-worker.env}"
if [[ ! -f "${PUSH_WORKER_ENV}" || -L "${PUSH_WORKER_ENV}" || ! -r "${PUSH_WORKER_ENV}" ]]; then
  echo "push worker secret environment is unavailable" >&2
  exit 1
fi
[[ "$(stat -c '%a %U:%G' "${PUSH_WORKER_ENV}")" == "600 root:root" ]]

set -a
# shellcheck disable=SC1090
source "${PUSH_WORKER_ENV}"
set +a

: "${PUSH_WORKER_KEY:?PUSH_WORKER_KEY is required}"

# Immediate delivery is handled by trigger_push_worker() through pg_net.
# This root-only cron fallback guarantees periodic catch-up if that path fails.
PUSH_SEND_URL="${PUSH_SEND_URL:-http://localhost:8000/functions/v1/push-send}"
PUSH_LIMIT="${PUSH_LIMIT:-100}"
PUSH_TIMEOUT_SECONDS="${PUSH_TIMEOUT_SECONDS:-15}"

export PUSH_SEND_URL PUSH_WORKER_KEY PUSH_LIMIT PUSH_WORKER_ENV

if ! timeout --signal=TERM "${PUSH_TIMEOUT_SECONDS}s" bash /root/push-worker-tick.sh >>/var/log/push-worker.log 2>&1; then
  logger -t monitorapp-push-worker 'push catch-up tick failed'
  exit 1
fi
