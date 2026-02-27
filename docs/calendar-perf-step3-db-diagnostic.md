# Calendar DB Diagnostic (Step 3)

## Environment
- Host: `5.35.91.118` (root via SSH)
- DB container: `supabase-db`
- DB: `postgres` (user `supabase_admin`)

## What calendar runs
Calendar uses `orders_secure_v2` with sort by `time_window_start DESC` and optional `assigned_to` filter.

## EXPLAIN ANALYZE
### Query A (my scope)
```sql
SELECT id, time_window_start, assigned_to, status, company_id
FROM public.orders_secure_v2
WHERE assigned_to = '<user_uuid>'
ORDER BY time_window_start DESC NULLS LAST;
```
Plan observed:
- `Seq Scan on public.orders`
- `Sort` in-memory
- Execution ~`0.398 ms`

### Query B (all scope)
```sql
SELECT id, time_window_start, assigned_to, status, company_id
FROM public.orders_secure_v2
ORDER BY time_window_start DESC NULLS LAST;
```
Plan observed:
- `Seq Scan on public.orders`
- `Sort` in-memory
- Execution ~`0.209 ms`

## Current index state (`orders`)
- `Orders_pkey(id)`
- `idx_orders_created_by_user_id(created_by_user_id)`
- `orders_company_client_idx(company_id, client_id) WHERE client_id IS NOT NULL`

Missing for calendar access pattern:
- no index on `time_window_start`
- no index on `(assigned_to, time_window_start)`
- no index on `(company_id, time_window_start)`
- no index on `(status, time_window_start)`

## Realtime/publication check
- `pg_publication` currently lists only `realtime.messages` relation in `supabase_realtime_messages_publication`.
- Orders table-specific publication entry was not found via `pg_publication_rel`.

## Trigger check (`orders`)
Found business triggers (validation + notification enqueue), none look like heavy per-read blockers for calendar open.

## Conclusion
At current tiny cardinality, DB execution is not the dominant latency source (sub-ms execution for calendar SQL). Main delay is frontend mount/render architecture and concurrent client-side startup work.
