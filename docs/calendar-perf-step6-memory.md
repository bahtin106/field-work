# Calendar Memory & Listener Audit (Step 6)

## Scope
- `app/orders/calendar.jsx`
- request realtime hooks
- permissions/auth providers

## Checked items
1. Unreleased timers / RAF callbacks
2. Unreleased subscriptions/listeners/channels
3. Object/function recreation hot paths
4. Potential heavy retained caches

## Findings
- Calendar screen has cleanup for RAF/timers and query cancelation in focus cleanup.
- Request realtime hook unsubscribes channel and clears timer in cleanup.
- Permissions provider unsubscribes app state, auth, and channels on cleanup.
- `DynamicOrderCard` has global executor name cache; this is intentional but unbounded. It is small in practice for employee count, but technically retained for app lifetime.
- Main memory/perf pressure is not leak-type; it is mount-time CPU work and initial concurrent async tasks.

## Architectural adjustments already applied
- On-demand month-week cache instead of precomputing full window each render cycle.
- Deferred optional data sources and realtime startup.
- Date-window querying to reduce payload retained in memory/index structures.

## Remaining optional hardening (not applied to avoid functional drift)
- Add soft upper bound to global executor cache.
- Move calendar tab bodies into isolated memoized child components to reduce retained parent closure capture.
