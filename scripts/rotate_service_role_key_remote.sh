#!/usr/bin/env bash
set -euo pipefail

cp /root/n8n-install/supabase/docker/.env /root/n8n-install/supabase/docker/.env.bak_service_rotate_$(date +%Y%m%d_%H%M%S)
cp /root/n8n-install/.env /root/n8n-install/.env.bak_service_rotate_$(date +%Y%m%d_%H%M%S)

OLD_KEY=$(grep -E "^SERVICE_ROLE_KEY=" /root/n8n-install/supabase/docker/.env | head -1 | cut -d= -f2- | tr -d '"')
JWT_SECRET=$(grep -E "^JWT_SECRET=" /root/n8n-install/supabase/docker/.env | head -1 | cut -d= -f2- | tr -d '"')

if [ -z "$OLD_KEY" ] || [ -z "$JWT_SECRET" ]; then
  echo "missing key material" >&2
  exit 1
fi

export OLD_KEY
export JWT_SECRET

NEW_KEY=$(python3 - <<'PY'
import os, json, time, base64, hmac, hashlib
secret=os.environ['JWT_SECRET'].encode()
header={"alg":"HS256","typ":"JWT"}
now=int(time.time())
payload={"role":"service_role","iss":"supabase","iat":now,"exp":now+5*365*24*3600}

def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

segments=[
    b64url(json.dumps(header,separators=(",",":")).encode()),
    b64url(json.dumps(payload,separators=(",",":")).encode())
]
signing='.'.join(segments).encode()
sig=b64url(hmac.new(secret, signing, hashlib.sha256).digest())
print('.'.join(segments+[sig]))
PY
)

export NEW_KEY

OLD_KEY_HASH=$(printf "%s" "$OLD_KEY" | sha256sum | awk '{print $1}')
NEW_KEY_HASH=$(printf "%s" "$NEW_KEY" | sha256sum | awk '{print $1}')

python3 - <<'PY'
import os
from pathlib import Path
old=os.environ['OLD_KEY']
new=os.environ['NEW_KEY']
for p in [Path('/root/n8n-install/supabase/docker/.env'), Path('/root/n8n-install/.env')]:
    t=p.read_text()
    t=t.replace('\nSERVICE_ROLE_KEY="'+old+'"', '\nSERVICE_ROLE_KEY="'+new+'"')
    t=t.replace('\nSERVICE_ROLE_KEY='+old, '\nSERVICE_ROLE_KEY='+new)
    p.write_text(t)
print('updated_env_files')
PY

echo "old_hash=${OLD_KEY_HASH}"
echo "new_hash=${NEW_KEY_HASH}"
