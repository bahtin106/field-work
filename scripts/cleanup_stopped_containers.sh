#!/bin/bash
# Remove ALL Supabase containers (running or stopped)
echo "Finding all Supabase containers..."
docker ps -a --filter name=supabase --format '{{.Names}}' | while read name; do
    echo "Removing: $name"
    docker rm -f "$name" 2>/dev/null
done

docker ps -a --filter name=realtime-dev.supabase --format '{{.Names}}' | while read name; do
    echo "Removing: $name"
    docker rm -f "$name" 2>/dev/null
done

echo "Cleanup complete"
