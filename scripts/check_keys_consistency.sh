#!/bin/bash
echo "=== Checking SERVICE_ROLE_KEY across Supabase containers ==="
echo ""

for container in supabase-auth supabase-rest abebfeb9314b_supabase-kong supabase-edge-functions; do
    echo "Container: $container"
    docker exec $container printenv | grep -E '^(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)=' | sed 's/=.*/=(hidden)/' || echo "  (no SERVICE_ROLE_KEY found)"
    echo ""
done

echo "=== Comparing key hashes ==="
echo ""
ENV_HASH=$(grep "^SERVICE_ROLE_KEY=" /root/n8n-install/.env | cut -d= -f2 | tr -d '"' | sha256sum | awk '{print $1}')
echo "ENV file hash: $ENV_HASH"

for container in supabase-auth supabase-rest abebfeb9314b_supabase-kong supabase-edge-functions; do
    CONTAINER_HASH=$(docker exec $container sh -c 'printenv SUPABASE_SERVICE_ROLE_KEY SERVICE_ROLE_KEY 2>/dev/null' | head -1 | sha256sum | awk '{print $1}')
    MATCH=""
    [ "$CONTAINER_HASH" = "$ENV_HASH" ] && MATCH="✓ MATCH" || MATCH="✗ MISMATCH"
    echo "$container: $CONTAINER_HASH $MATCH"
done
