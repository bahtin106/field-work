# Calendar Network Diagnostic (Step 5)

## What was checked
1. Realtime container logs (`realtime-dev.supabase-realtime`) for reconnect/error patterns.
2. Client subscription code paths:
   - `useRequestRealtimeSync` (requests)
   - `PermissionsProvider` realtime/broadcast/auth listeners
3. Auth/session call patterns:
   - `SimpleAuthProvider` startup/session handling
   - profile/permissions fetch paths

## Findings
- No clear reconnect storm was observed in realtime logs; normal billing metrics and periodic idle shutdown messages appeared.
- Calendar previously attached realtime immediately on focus; this was moved to post-interaction enable to avoid startup contention.
- Permissions/auth architecture still has multiple independent identity fetch paths (`getSession`, `getUser`, profile lookups) across providers. This is architecturally valid but adds network chatter at startup.
- Calendar-critical request paths are now reduced:
  - calendar query limited to date window
  - executors/departments deferred until filter interaction

## Risk notes
- Publication mapping currently does not list `orders` in `pg_publication_rel` output. If realtime changes are expected for orders, infra-level realtime publication config should be validated separately.

## Actions taken in code (already committed)
- Deferred calendar realtime subscription start (`InteractionManager.runAfterInteractions`).
- Deferred non-critical filter data fetches.
- Added range-based calendar query and adjacent prefetch.
