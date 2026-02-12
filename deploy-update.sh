#!/bin/bash
# Deploy updated email-server.js to VPS

ssh root@5.35.91.118 <<'SSHEOF'
echo "[1/5] Starting email-server container..."
docker start email-server 2>/dev/null || true
sleep 3

echo "[2/5] Checking if container is running..."
docker ps | grep email-server

echo "[3/5] Copying updated email-server.js to container..."
docker cp /tmp/email-server.js email-server:/app/email-server.js

echo "[4/5] Restarting email-server..."
docker restart email-server
sleep 3

echo "[5/5] Checking logs..."
docker logs email-server --tail 15
SSHEOF
