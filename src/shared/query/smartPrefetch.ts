import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { fetchWorkTypes } from '../../../lib/workTypes';
import { supabase } from '../../../lib/supabase';
import { getMyCompanyId } from '../../features/profile/api';
import { getOfflineSnapshot } from '../offline/offlineStatus';
import { queryKeys } from './queryKeys';
import { getRequestById, listCalendarRequests, listRequests, listRequestExecutors } from '../../features/requests/api';
import { prefetchExecutorNames, seedExecutorNames } from '../../features/requests/executorNameCache';
import { markRequestDetailLoaded } from '../../features/requests/queries';
import { scheduleUiIdleTask } from '../perf/uiIdleTask';

const SMART_PREFETCH_PAGE_SIZE = 30;
const SMART_PREFETCH_PROFILE_KEY = 'app.smartPrefetch.profile.v1';
const SMART_PREFETCH_RECENT_CACHE_MAX_AGE_MS = 60 * 1000;

type SmartPrefetchProfile = 'lite' | 'balanced' | 'aggressive';

const PROFILE_CONFIG: Record<
  SmartPrefetchProfile,
  {
    cooldownMs: number;
    includeAllRequests: boolean;
    includeExecutors: boolean;
    includeCalendar: boolean;
    allRequestsDelayMs: number;
    executorsDelayMs: number;
    detailCount: number;
  }
> = {
  lite: {
    cooldownMs: 8 * 60 * 1000,
    includeAllRequests: false,
    includeExecutors: false,
    includeCalendar: false,
    allRequestsDelayMs: 0,
    executorsDelayMs: 0,
    detailCount: 0,
  },
  balanced: {
    cooldownMs: 5 * 60 * 1000,
    includeAllRequests: true,
    includeExecutors: true,
    includeCalendar: true,
    allRequestsDelayMs: 180,
    executorsDelayMs: 180,
    detailCount: 2,
  },
  aggressive: {
    cooldownMs: 2 * 60 * 1000,
    includeAllRequests: true,
    includeExecutors: true,
    includeCalendar: true,
    allRequestsDelayMs: 100,
    executorsDelayMs: 100,
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
  if (!getOfflineSnapshot().isOnline) return false;
  const now = Date.now();
  if (now - lastRunAt < cooldownMs) return false;
  return true;
}

async function getCurrentAuthScopeKey(queryClient: QueryClient) {
  const cachedProfile: any = queryClient.getQueryData(queryKeys.profile.me());
  const cachedUserId = String(cachedProfile?.id || '').trim();
  const cachedCompanyId = String(cachedProfile?.company_id || cachedProfile?.companyId || '').trim();
  if (cachedUserId) {
    return `${cachedUserId}:${cachedCompanyId || 'no-company'}`;
  }

  const { data } = await supabase.auth.getUser();
  const userId = String(data?.user?.id || '').trim();
  if (!userId) return '';

  let companyId = '';
  try {
    const cachedCompanyId = queryClient.getQueryData(queryKeys.profile.companyId());
    companyId = String(cachedCompanyId || '').trim();
  } catch {}
  if (!companyId) {
    try {
      companyId = String((await getMyCompanyId()) || '').trim();
    } catch {}
  }
  return `${userId}:${companyId || 'no-company'}`;
}

function assertPrefetchScopeActive(runGeneration: number, expectedScopeKey: string, currentScopeKey: string) {
  if (runGeneration !== activeRunGeneration || !expectedScopeKey || expectedScopeKey !== currentScopeKey) {
    throw new Error('smart-prefetch-scope-changed');
  }
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
  const cached = readFreshRecentCache(queryClient, scope, authScopeKey);
  if (cached) {
    seedExecutorNames(cached);
    const executorIds = Array.from(
      new Set(cached.map((row: any) => String(row?.assigned_to || '').trim()).filter(Boolean)),
    ).slice(0, 80);
    prefetchExecutorNames(executorIds).catch(() => {});
    return cached;
  }

  const params = { scope, page: 1, pageSize: SMART_PREFETCH_PAGE_SIZE };
  const key = scope === 'my' ? queryKeys.requests.my({}) : queryKeys.requests.all({});
  const rows = await listRequests(params);
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
  const executorIds = Array.from(
    new Set(page.map((row: any) => String(row?.assigned_to || '').trim()).filter(Boolean)),
  ).slice(0, 80);
  prefetchExecutorNames(executorIds).catch(() => {});
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
    queryFn: async () => {
      assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
      return listCalendarRequests({ userId, role, scope, startDate, endDate });
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
  lastRunAt = Date.now();
  try {
    const runGeneration = activeRunGeneration;
    const authScopeKey = await getCurrentAuthScopeKey(queryClient);
    if (!authScopeKey) return false;

    const myRows = await prefetchRequestList(queryClient, 'my', authScopeKey, runGeneration);
    await Promise.allSettled([
      ...myRows.slice(0, cfg.detailCount).map((row: any) =>
        row?.id
          ? queryClient.prefetchQuery({
              queryKey: queryKeys.requests.detail(row.id),
              queryFn: async () => {
                assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
                const detail = await getRequestById(row.id);
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
    if (cfg.includeExecutors) {
      await new Promise((resolve) => setTimeout(resolve, cfg.executorsDelayMs));
      assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
      const companyId = await queryClient.fetchQuery({
        queryKey: queryKeys.profile.companyId(),
        queryFn: getMyCompanyId,
        staleTime: 5 * 60 * 1000,
      });
      assertPrefetchScopeActive(runGeneration, authScopeKey, await getCurrentAuthScopeKey(queryClient));
      if (companyId) {
        await Promise.allSettled([
          queryClient.prefetchQuery({
            queryKey: queryKeys.requests.executors(companyId),
            queryFn: () => listRequestExecutors({ companyId }),
            staleTime: 60 * 1000,
          }),
          fetchWorkTypes(companyId, { includeDisabled: true }),
        ]);
      }
    }
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
