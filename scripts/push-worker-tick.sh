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

: "${PUSH_SEND_URL:?PUSH_SEND_URL is required}"
: "${PUSH_WORKER_KEY:?PUSH_WORKER_KEY is required}"
[[ "${PUSH_WORKER_KEY}" =~ ^[A-Za-z0-9_-]{32,128}$ ]]
[[ "${PUSH_SEND_URL}" != *$'\n'* && "${PUSH_SEND_URL}" != *$'\r'* ]]
[[ "${PUSH_SEND_URL}" != *$'\t'* && "${PUSH_SEND_URL}" != *' '* ]]
[[ "${PUSH_SEND_URL}" != *'"'* && "${PUSH_SEND_URL}" != *\\* ]]
if [[ "${PUSH_SEND_URL}" == https://* ]]; then
  :
elif [[ "${PUSH_SEND_URL}" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/|$) ]]; then
  :
else
  echo 'PUSH_SEND_URL must use HTTPS unless it targets the local loopback interface' >&2
  exit 1
fi

limit="${PUSH_LIMIT:-100}"
[[ "${limit}" =~ ^[0-9]+$ ]]
(( limit >= 1 && limit <= 200 ))

{
  printf 'request = "POST"\n'
  printf 'url = "%s"\n' "${PUSH_SEND_URL}"
  printf 'header = "Content-Type: application/json"\n'
  printf 'header = "x-worker-key: %s"\n' "${PUSH_WORKER_KEY}"
  printf 'data = "{\\"limit\\": %s}"\n' "${limit}"
} | curl --fail --silent --show-error --config -
