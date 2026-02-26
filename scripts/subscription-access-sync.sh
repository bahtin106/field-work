#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE='/var/lock/subscription-access-sync.lock'
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) [skip] previous sync is still active"
  exit 0
fi

RESULT=$(
docker exec -i supabase-db psql -U supabase_admin -d postgres -At -v ON_ERROR_STOP=1 <<'SQL'
select public.sync_subscription_access_states()::text;
SQL
)

echo "$(date -u +%FT%TZ) [ok] sync_subscription_access_states result=${RESULT}"
