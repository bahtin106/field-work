# Calendar Performance Diagnostic (Step 1)

## Baseline (from current logs)
- `requests.executors fetch`: ~472ms
- `requests.calendar fetch`: first ~494ms, then cached ~125ms
- `employees.departments fetch`: ~471ms
- `Calendar first-content`: ~1747ms

## Frontend findings (no functional changes)
1. Calendar screen is monolithic (`app/orders/calendar.jsx`, ~1947 lines), with large mount-time work in one component tree.
2. Month and year tab logic lives in one screen and both heavy structures are prepared in same render pass (`dynamicMonths`, `monthWeeksByIndex`, `dynamicYears`).
3. High mount-side state/effect pressure:
   - Many `useEffect`/`useFocusEffect` run at first open.
   - Several mount-time state sync effects can trigger extra renders (`selectedDate/currentMonth`, measurement sync, scope/filter resets).
4. Heavy date computations in render pipeline:
   - `monthWeeksByIndex` computes week matrices for a wide month window.
   - Multiple `format/new Date` calls for indexing and labels.
5. Month pager currently uses `FlatList` + custom gesture infrastructure and many shared values, adding overhead in JS/UI coordination.
6. Orders list item is feature-rich (`components/DynamicOrderCard.jsx`) and expensive to render in batch during initial paint.
7. Data side:
   - Calendar query is now optimized vs previous state, but still returns a broad payload and then performs client-side indexing/filtering.
   - Additional parallel requests (executors/departments/profile/permissions) compete with first paint.
8. Subscriptions:
   - Realtime sync exists for requests and permissions; initial attach can add startup work.
9. Potential duplicate profile access path remains in app architecture (`SimpleAuthProvider` + permissions/profile hooks), though calendar itself was already reduced.

## Most likely root cause (ranked)
1. **UI construction cost on first mount** (big monolithic tree + month matrix generation + list/card rendering).
2. **Too much concurrent mount work** (effects/state sync + multiple queries/subscriptions).
3. **Custom gesture/pager complexity** with cross-thread coordination.
4. **Broad data handling on client** (indexing/filtering after fetch).

## Constraints validated
- Visual UI must stay unchanged.
- Functional behavior preserved.
- Need architectural/perf refactor only.
