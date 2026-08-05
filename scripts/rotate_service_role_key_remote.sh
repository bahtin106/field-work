#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
This script is intentionally disabled.

Replacing only SERVICE_ROLE_KEY does not revoke an exposed JWT that was signed by
the existing JWT_SECRET. For a suspected service-role leak, rotate JWT_SECRET,
ANON_KEY, and SERVICE_ROLE_KEY together; publish a compatible client update with
the new public anon key; restart the Supabase stack; then verify old keys return
401. Follow SECURITY_INCIDENT_20260805.md before making any production change.
EOF

exit 2
