> **Status (2026-02-11): Legacy reference.** This document contains historical notes about removed hooks (`useQueryWithCache`, `useRealtimeSync`).
> Current data layer uses TanStack Query feature hooks in `src/features/*` with shared keys in `src/shared/query/queryKeys.ts`.
# Perf Upgrade Plan (Instant UI / SWR / Prefetch / Realtime)

## Step 0: Inventory

### Current stack
- Framework: Expo SDK `54.0.32` (`expo-router` entrypoint, file-based routing).
- Navigation: `expo-router` (`app/_layout.js` + stack screens + custom bottom tabs in `components/navigation/BottomNav.jsx`).
- Data client: Supabase JS (`lib/supabase.js`, anon + optional service role client).
- Query/cache: TanStack Query is already installed and active, plus custom cache layer (`components/hooks/useQueryWithCache.js`, `lib/cache/DataCache.js`, several `globalThis` caches).
- Persisted cache: already used via React Query persist provider + AsyncStorage, now moved to shared provider module.

### Screens located
- Tabs:
  - Home: `app/orders/index.jsx` + `components/UniversalHome.jsx`
  - My Requests: `app/orders/my-orders.js`
  - All Requests: `app/orders/all-orders.jsx`
  - Calendar: `app/orders/calendar.jsx`
- Request details/edit:
  - View: `app/orders/[id].jsx`
  - Edit: `app/orders/edit/[id].jsx`
- Employees flow:
  - List: `app/users/index.jsx`
  - Create: `app/users/new.jsx`
  - View: `app/users/[id]/index.jsx`
  - Edit: `app/users/[id]/edit.jsx`

### Bottlenecks found
- Mixed data paradigms in one app: React Query + custom `useQueryWithCache` + `globalThis` caches.
- Screen-level fetch in many `useEffect` blocks (`all-orders`, `calendar`, `users`, `order detail/edit`).
- Duplicated request logic across screens (filters, permissions checks, list/detail fetch, manual retries).
- Manual cache hydration logic in screens (e.g. `all-orders`) instead of shared query keys/hooks.
- Realtime and polling are inconsistent (some screens use subscriptions, some manual intervals, some none).
- Prefetch logic is split between `lib/prefetch.js`, custom link prefetch, and ad-hoc screen behavior.

### Dev-only performance metrics
- Added shared dev metrics helper: `src/shared/perf/devMetrics.ts`.
- Tracks:
  - `screen mount -> first content`
  - `network fetch duration`
- Logs in dev only (`__DEV__`).

## Step 1 baseline changes done
- Introduced shared query layer modules:
  - `src/shared/query/queryClient.ts`
  - `src/shared/query/QueryProvider.tsx`
  - `src/shared/query/queryKeys.ts`
- Moved root provider wiring in `app/_layout.js` to shared `QueryProvider`.
- Kept persisted cache (AsyncStorage), query defaults and excluded auth-sensitive keys from dehydration.

## Data layer migration scope

### New shared API/query modules
- Requests:
  - `src/features/requests/api.ts`
  - `src/features/requests/queries.ts`
- Employees:
  - `src/features/employees/api.ts`
  - `src/features/employees/queries.ts`
- Profile:
  - `src/features/profile/api.ts`
  - `src/features/profile/queries.ts`
- Shared query messages:
  - `src/shared/messages/queryMessages.ts`

### Target screens to migrate first
1. `app/orders/all-orders.jsx`
2. `app/orders/calendar.jsx`
3. `app/users/index.jsx`, `app/users/new.jsx`, `app/users/[id]/edit.jsx`
4. `app/orders/[id].jsx`, `app/orders/edit/[id].jsx`

## What will be replaced
- Screen-level direct Supabase list/detail reads in `useEffect` (target screens).
- Manual ad-hoc cache in screen components where React Query can own cache.
- Duplicated realtime/polling logic with shared query hooks + focused polling fallback.

## What is intentionally preserved
- Existing navigation structure (no rewrite).
- Existing visual and interaction behavior on РІР‚СљMy RequestsРІР‚Сњ (already instant).
- Existing permission checks and business rules, moved progressively into shared layer.

## Migration status (current)
- `app/orders/all-orders.jsx`:
  - moved to `useAllRequests`
  - SWR behavior + focus-only polling fallback
  - realtime sync + detail prefetch (visible/tap)
  - dev metrics (`mount -> first content`)
- `app/orders/calendar.jsx`:
  - moved to `useCalendarRequests`
  - realtime sync + focus-only polling fallback
  - detail prefetch for visible requests
  - dev metrics (`mount -> first content`)
- `app/orders/edit/[id].jsx`:
  - moved to `useRequest`
  - manual per-screen realtime subscription removed
  - save path moved to `useUpdateRequestMutation`
- `app/orders/[id].jsx`:
  - detail load switched to shared cache via `ensureRequestPrefetch`
  - added `useRequest` + `useRequestRealtimeSync` for SWR/realtime updates
  - added dev metrics (`RequestView` mount -> first content)
  - removed local `ORDER_CACHE` usage; detail now relies on shared query cache only
- `app/users/index.jsx`:
  - moved to `useEmployees` + `useDepartmentsQuery`
  - realtime sync + focused refetch fallback
  - employee detail prefetch from list
- `app/users/new.jsx`:
  - department loading moved to `useMyCompanyIdQuery` + `useDepartmentsQuery`
- `app/users/[id]/edit.jsx`:
  - department loading moved to `useMyCompanyIdQuery` + `useDepartmentsQuery`
  - removed duplicated manual departments refresh calls
- `app/users/[id]/index.jsx`:
  - moved from custom `useQueryWithCache` to `useEmployee`
  - realtime sync unified via shared employees query layer
- `app/orders/index.jsx` (Home):
  - replaced legacy prefetch manager trigger with direct TanStack prefetch via shared `queryKeys`
  - prefetches `my requests`, `all requests`, and `calendar` after interactions
- `components/hooks/useUsers.js`:
  - migrated internals from `useQueryWithCache`/manual Supabase queries to `useEmployees`
  - realtime sync now uses shared employees query sync
- `components/hooks/useDepartments.js`:
  - migrated internals to `useDepartmentsQuery` (shared query layer)
  - preserved old hook API (`departments`, `isLoading`, `isRefreshing`, `refresh`, `error`)
- `app/company_settings/index.jsx`:
  - replaced `useQueryWithCache` with `useQuery` (`['companySettings']`)
  - kept realtime refresh via Supabase channel + `refetch`
- `app/app_settings/AppSettings.jsx`:
  - replaced `useQueryWithCache` with `useQuery` for:
    - `['appSettings', 'notifPrefs']`
    - `['appSettings', 'userPerm']`
  - added realtime refresh for notification prefs (filtered by `user_id`)
- removed legacy hooks:
  - `components/hooks/useQueryWithCache.js`
  - `components/hooks/useRealtimeSync.js`
  - active runtime code now uses TanStack Query hooks only
- removed obsolete legacy prefetch artifact:
  - `lib/prefetch.old.js`
- `app/users/new.jsx` and `app/users/[id]/edit.jsx`:
  - replaced legacy `globalCache.invalidate('users:')` calls with
    `queryClient.invalidateQueries({ queryKey: ['employees'] })`
  - employee list/detail invalidation now goes through unified query keys

