import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import {
  fetchCompanySettingsByCompanyId,
  getCompanySettingsQueryKey,
} from '../../../lib/companySettingsQuery';
import {
  fetchCompanyOrderStatuses,
  getOrderStatusesQueryKey,
} from '../../../lib/orderStatuses';
import { supabase } from '../../../lib/supabase';
import { fetchWorkTypes } from '../../../lib/workTypes';
import { listClients } from '../../features/clients/api';
import { listDepartments } from '../../features/employees/api';
import { listEntityFieldSettings } from '../../features/fieldSettings/api';
import { ENTITY_FIELD_TYPES } from '../../features/fieldSettings/catalog';
import { listClientObjectsByCompany } from '../../features/objects/api';
import { listCompanyTags } from '../../features/tags/api';
import { getRequestById, listCalendarRequests, listRequests, listRequestExecutors } from '../../features/requests/api';
import { seedExecutorNames } from '../../features/requests/executorNameCache';
import { markRequestDetailLoaded } from '../../features/requests/queries';
import { getOfflineSnapshot } from '../offline/offlineStatus';
import { withReadDeadline } from '../network/readDeadline';
import { scheduleUiIdleTask } from '../perf/uiIdleTask';
import { queryKeys } from './queryKeys';

const SMART_PREFETCH_PAGE_SIZE = 30;
const SMART_PREFETCH_PROFILE_KEY = 'app.smartPrefetch.profile.v1';
const SMART_PREFETCH_RECENT_CACHE_MAX_AGE_MS = 60 * 1000;
const SMART_PREFETCH_REFERENCE_CONCURRENCY = 2;
const SMART_PREFETCH_COMPANY_SETTINGS_STALE_MS = 5 * 60 * 1000;
const SMART_PREFETCH_FIELD_SETTINGS_STALE_MS = 5 * 60 * 1000;
const SMART_PREFETCH_DEPARTMENTS_STALE_MS = 10 * 60 * 1000;
const SMART_PREFETCH_EXECUTORS_STALE_MS = 60 * 1000;
const SMART_PREFETCH_ORDER_STATUSES_STALE_MS = 5 * 60 * 1000;
const SMART_PREFETCH_ENTITY_LIST_STALE_MS = 30 * 1000;

type SmartPrefetchProfile = 'lite' | 'balanced' | 'aggressive';

const PROFILE_CONFIG: Record<
  SmartPrefetchProfile,
  {
    cooldownMs: number;
    includeAllRequests: boolean;
    includeEntityLists: boolean;
    includeCalendar: boolean;
    allRequestsDelayMs: number;
    entityListsDelayMs: number;
    detailCount: number;
  }
> = {
  lite: {
    cooldownMs: 8 * 60 * 1000,
    includeAllRequests: false,
    includeEntityLists: false,
    includeCalendar: false,
    allRequestsDelayMs: 0,
    entityListsDelayMs: 0,
    detailCount: 0,
  },
  balanced: {
    cooldownMs: 5 * 60 * 1000,
    includeAllRequests: true,
    includeEntityLists: true,
    includeCalendar: true,
    allRequestsDelayMs: 180,
    entityListsDelayMs: 180,
    detailCount: 2,
  },
  aggressive: {
    cooldownMs: 2 * 60 * 1000,
    includeAllRequests: true,
    includeEntityLists: true,
    includeCalendar: true,
    allRequestsDelayMs: 100,
    entityListsDelayMs: 100,
    detailCount: 4,
  },
};

let lastRunAt = 0;
let inFlight = false;
let resolvedProfile: SmartPrefetchProfile | null = null;
let activeRunGeneration = 0;

function isSmartPrefetchProfile(value: string): value is SmartPrefetchProfile {
  return value === 'lite' || value === 'balanced' || value === 'aggressive';
}

async function readProfilePreference(): Promise<SmartPrefetchProfile> {
  try {
    const raw = String((await AsyncStorage.getItem(SMART_PREFETCH_PROFILE_KEY)) || '').trim().toLowerCase();
    if (isSmartPrefetchProfile(raw)) return raw;
  } catch {}
  return 'balanced';
}

export async function setSmartPrefetchProfile(profile: SmartPrefetchProfile) {
  resolvedProfile = profile;
  await AsyncStorage.setItem(SMART_PREFETCH_PROFILE_KEY, profile);
}

async function resolveEffectiveProfile(): Promise<SmartPrefetchProfile> {
  if (!resolvedProfile) {
    resolvedProfile = await readProfilePreference();
  }
  const snap = getOfflineSnapshot();
  if (snap.isPoorConnection) return 'lite';
  return resolvedProfile || 'balanced';
}

function canRun(cooldownMs: number) {
  if (inFlight) return false;
  const network = getOfflineSnapshot();
  if (!network.isOnline || network.isPoorConnection) return false;
  const now = Date.now();
  if (now - lastRunAt < cooldownMs) return false;
  return true;
}

async function getCurrentAuthScopeKey(queryClient: QueryClient) {
  const cachedProfile: any = queryClient.getQueryData(queryKeys.profile.me());
  const cachedUserId = String(cachedProfile?.id || '').trim();
  const cachedProfileCompanyId = String(cachedProfile?.company_id || cachedProfile?.companyId || '').trim();
  if (cachedUserId) {
    return `${cachedUserId}:${cachedProfileCompanyId || 'no-company'}`;
  }

  const { data } = await withReadDeadline(supabase.auth.getUser(), {
    label: 'Smart prefetch auth scope',
  });
  const userId = String(data?.user?.id || '').trim();
  if (!userId) return '';
  return `${userId}:no-company`;
}

function assertPrefetchScopeActive(runGeneration: number, expectedScopeKey: string, currentScopeKey: string) {
  const network = getOfflineSnapshot();
  if (!network.isOnline || network.isPoorConnection) {
    throw new Error('smart-prefetch-network-constrained');
  }
  if (runGeneration !== activeRunGeneration || !expectedScopeKey || expectedScopeKey !== currentScopeKey) {
    throw new Error('smart-prefetch-scope-changed');
  }
}

type SmartPrefetchTask = () => Promise<unknown>;

async function runScopedPrefetchStage({
  queryClient,
  authScopeKey,
  runGeneration,
  tasks,
}: {
  queryClient: QueryClient;
  authScopeKey: string;
  runGeneration: number;
  tasks: SmartPrefetchTask[];
}) {
  assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
  for (let index = 0; index < tasks.length; index += SMART_PREFETCH_REFERENCE_CONCURRENCY) {
    const batch = tasks.slice(index, index + SMART_PREFETCH_REFERENCE_CONCURRENCY);
    await Promise.allSettled(batch.map((task) => task()));
    assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
  }
}

async function runInActivePrefetchScope<T>({
  queryClient,
  authScopeKey,
  runGeneration,
  task,
  signal,
}: {
  queryClient: QueryClient;
  authScopeKey: string;
  runGeneration: number;
  task: (signal: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
}) {
  assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
  const result = await withReadDeadline(task, {
    label: 'Smart prefetch reference',
    signal,
  });
  assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
  return result;
}

async function resolveAuthScopedCompany({
  queryClient,
  initialAuthScopeKey,
  runGeneration,
}: {
  queryClient: QueryClient;
  initialAuthScopeKey: string;
  runGeneration: number;
}) {
  const userId = String(initialAuthScopeKey.split(':')[0] || '').trim();
  if (!userId) return null;

  const cachedProfile: any = queryClient.getQueryData(queryKeys.profile.me());
  const profileUserId = String(cachedProfile?.id || '').trim();
  const companyId = String(cachedProfile?.company_id || cachedProfile?.companyId || '').trim();
  // The standalone company-id query key is intentionally not trusted here:
  // unlike the profile snapshot it does not encode the authenticated user.
  if (profileUserId !== userId || !companyId) return null;

  const authScopeKey = `${userId}:${companyId}`;
  assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
  return { authScopeKey, companyId };
}

async function prefetchCriticalReferences({
  queryClient,
  companyId,
  authScopeKey,
  runGeneration,
}: {
  queryClient: QueryClient;
  companyId: string;
  authScopeKey: string;
  runGeneration: number;
}) {
  const scoped = <T,>(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) =>
    runInActivePrefetchScope({ queryClient, authScopeKey, runGeneration, task, signal });

  await runScopedPrefetchStage({
    queryClient,
    authScopeKey,
    runGeneration,
    tasks: [
      () =>
        queryClient.prefetchQuery({
          queryKey: getCompanySettingsQueryKey(companyId),
          queryFn: ({ signal }) =>
            scoped(
              (readSignal) => fetchCompanySettingsByCompanyId(companyId, readSignal),
              signal,
            ),
          staleTime: SMART_PREFETCH_COMPANY_SETTINGS_STALE_MS,
        }),
      ...[ENTITY_FIELD_TYPES.ORDER, ENTITY_FIELD_TYPES.OBJECT].map(
        (entityType): SmartPrefetchTask =>
          () =>
            queryClient.prefetchQuery({
              queryKey: queryKeys.fieldSettings.detail(entityType),
              queryFn: ({ signal }) =>
                scoped(
                  (readSignal) => listEntityFieldSettings(entityType, readSignal),
                  signal,
                ),
              staleTime: SMART_PREFETCH_FIELD_SETTINGS_STALE_MS,
            }),
      ),
      () =>
        queryClient.prefetchQuery({
          queryKey: queryKeys.employees.departments(companyId, true),
          queryFn: ({ signal }) =>
            scoped(
              (readSignal) =>
                listDepartments({ companyId, onlyEnabled: true }, readSignal),
              signal,
            ),
          staleTime: SMART_PREFETCH_DEPARTMENTS_STALE_MS,
        }),
      () =>
        queryClient.prefetchQuery({
          queryKey: queryKeys.requests.executors(companyId),
          queryFn: ({ signal }) =>
            scoped(async (readSignal) => {
              const rows = await listRequestExecutors({ companyId }, readSignal);
              assertPrefetchScopeActive(
                runGeneration,
                authScopeKey,
                await getCurrentAuthScopeKey(queryClient),
              );
              seedExecutorNames(rows);
              return rows;
            }, signal),
          staleTime: SMART_PREFETCH_EXECUTORS_STALE_MS,
        }),
      () =>
        scoped((readSignal) =>
          fetchWorkTypes(companyId, { includeDisabled: true, signal: readSignal }),
        ),
      () =>
        queryClient.prefetchQuery({
          queryKey: getOrderStatusesQueryKey(companyId),
          queryFn: ({ signal }) =>
            scoped(
              (readSignal) => fetchCompanyOrderStatuses(companyId, readSignal),
              signal,
            ),
          staleTime: SMART_PREFETCH_ORDER_STATUSES_STALE_MS,
        }),
    ],
  });
}

async function prefetchEntityLists({
  queryClient,
  companyId,
  authScopeKey,
  runGeneration,
}: {
  queryClient: QueryClient;
  companyId: string;
  authScopeKey: string;
  runGeneration: number;
}) {
  const scoped = <T,>(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) =>
    runInActivePrefetchScope({ queryClient, authScopeKey, runGeneration, task, signal });
  const clientsParams = { companyId, search: '' };

  await runScopedPrefetchStage({
    queryClient,
    authScopeKey,
    runGeneration,
    tasks: [
      () =>
        queryClient.prefetchQuery({
          queryKey: queryKeys.clients.list(clientsParams),
          queryFn: ({ signal }) =>
            scoped((readSignal) => listClients(clientsParams, readSignal), signal),
          staleTime: SMART_PREFETCH_ENTITY_LIST_STALE_MS,
        }),
      () =>
        queryClient.prefetchQuery({
          queryKey: queryKeys.objects.byCompany(companyId),
          queryFn: ({ signal }) =>
            scoped(
              (readSignal) => listClientObjectsByCompany(companyId, readSignal),
              signal,
            ),
          staleTime: SMART_PREFETCH_ENTITY_LIST_STALE_MS,
        }),
      ...(['client', 'object'] as const).map(
        (tagType): SmartPrefetchTask =>
          () =>
            queryClient.prefetchQuery({
              queryKey: queryKeys.tags.list({ companyId, tagType }),
              queryFn: ({ signal }) =>
                scoped(
                  (readSignal) => listCompanyTags({ companyId, tagType }, readSignal),
                  signal,
                ),
              staleTime: SMART_PREFETCH_ENTITY_LIST_STALE_MS,
            }),
      ),
    ],
  });
}

function buildOrdersRecentQueryKey(scope: 'my' | 'all', authScopeKey: string) {
  return ['orders', scope, 'recent', String(authScopeKey || 'anonymous')];
}

function readFreshRecentCache(queryClient: QueryClient, scope: 'my' | 'all', authScopeKey: string) {
  const key = buildOrdersRecentQueryKey(scope, authScopeKey);
  const state: any = queryClient.getQueryState(key);
  const data = queryClient.getQueryData(key);
  if (!Array.isArray(data)) return null;
  const updatedAt = Number(state?.dataUpdatedAt || 0);
  if (updatedAt > 0 && Date.now() - updatedAt > SMART_PREFETCH_RECENT_CACHE_MAX_AGE_MS) return null;
  return data;
}

async function prefetchRequestList(
  queryClient: QueryClient,
  scope: 'my' | 'all',
  authScopeKey: string,
  runGeneration: number,
) {
  assertPrefetchScopeActive(
    runGeneration,
    authScopeKey,
    await getCurrentAuthScopeKey(queryClient),
  );
  const cached = readFreshRecentCache(queryClient, scope, authScopeKey);
  if (cached) {
    seedExecutorNames(cached);
    return cached;
  }

  const userId = String(authScopeKey.split(':')[0] || '').trim();
  const params = {
    scope,
    page: 1,
    pageSize: SMART_PREFETCH_PAGE_SIZE,
    ...(scope === 'my' && userId ? { userId } : {}),
  };
  const key = scope === 'my' ? queryKeys.requests.my({}) : queryKeys.requests.all({});
  const rows = await withReadDeadline(
    (signal) => listRequests(params, signal),
    { label: `Smart prefetch ${scope} requests` },
  );
  assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
  const page = Array.isArray(rows) ? rows : [];
  queryClient.setQueryData(key, {
    pages: [page],
    pageParams: [1],
  });
  if (scope === 'my') {
    queryClient.setQueryData(buildOrdersRecentQueryKey('my', authScopeKey), page);
  } else {
    queryClient.setQueryData(buildOrdersRecentQueryKey('all', authScopeKey), page);
  }
  seedExecutorNames(page);
  return page;
}

function getCurrentCalendarRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));

  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const end = new Date(last);
  end.setDate(last.getDate() + ((7 - last.getDay()) % 7));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

async function prefetchCurrentCalendar(queryClient: QueryClient, authScopeKey: string, runGeneration: number) {
  const profile: any = queryClient.getQueryData(queryKeys.profile.me());
  const userId = String(profile?.id || authScopeKey.split(':')[0] || '').trim();
  if (!userId) return [];
  const role = String(profile?.role || '').trim();
  const scope = 'my';
  const { startDate, endDate } = getCurrentCalendarRange();
  return queryClient.prefetchQuery({
    queryKey: queryKeys.requests.calendar({ userId, role, scope, startDate, endDate }),
    queryFn: async ({ signal }) => {
      assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
      const rows = await withReadDeadline(
        (readSignal) =>
          listCalendarRequests({ userId, role, scope, startDate, endDate }, readSignal),
        { label: 'Smart prefetch calendar', signal },
      );
      assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
      return rows;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function resetSmartPrefetchRuntime() {
  activeRunGeneration += 1;
  lastRunAt = 0;
  inFlight = false;
}

export async function runSmartPrefetch(queryClient: QueryClient) {
  const profile = await resolveEffectiveProfile();
  const cfg = PROFILE_CONFIG[profile];
  if (!canRun(cfg.cooldownMs)) return false;
  inFlight = true;
  try {
    const runGeneration = activeRunGeneration;
    const initialAuthScopeKey = await getCurrentAuthScopeKey(queryClient);
    if (!initialAuthScopeKey) return false;
    const companyScope = await resolveAuthScopedCompany({
      queryClient,
      initialAuthScopeKey,
      runGeneration,
    });
    if (!companyScope) return false;
    const { authScopeKey, companyId } = companyScope;

    await prefetchCriticalReferences({ queryClient, companyId, authScopeKey, runGeneration });

    const myRows = await prefetchRequestList(queryClient, 'my', authScopeKey, runGeneration);
    await Promise.allSettled([
      ...myRows.slice(0, cfg.detailCount).map((row: any) =>
        row?.id
          ? queryClient.prefetchQuery({
              queryKey: queryKeys.requests.detail(row.id),
              queryFn: async ({ signal }) => {
                assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
                const detail = await withReadDeadline(
                  (readSignal) => getRequestById(row.id, readSignal),
                  { label: 'Smart prefetch request detail', signal },
                );
                assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
                return markRequestDetailLoaded(detail);
              },
              staleTime: 45 * 1000,
            })
          : Promise.resolve(null),
      ),
      ...(cfg.includeCalendar
        ? [prefetchCurrentCalendar(queryClient, authScopeKey, runGeneration)]
        : []),
    ]);
    if (cfg.includeAllRequests) {
      await new Promise((resolve) => setTimeout(resolve, cfg.allRequestsDelayMs));
      assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
      await prefetchRequestList(queryClient, 'all', authScopeKey, runGeneration);
    }
    if (cfg.includeEntityLists) {
      await new Promise((resolve) => setTimeout(resolve, cfg.entityListsDelayMs));
      assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
      await prefetchEntityLists({ queryClient, companyId, authScopeKey, runGeneration });
    }
    lastRunAt = Date.now();
    return true;
  } catch {
    return false;
  } finally {
    inFlight = false;
  }
}

export function scheduleSmartPrefetch(queryClient: QueryClient) {
  return scheduleUiIdleTask(() => {
    runSmartPrefetch(queryClient).catch(() => {});
  }, { idleTimeoutMs: 2000 });
}
