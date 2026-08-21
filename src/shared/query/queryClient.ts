import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, dehydrate, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { COMPANY_SETTINGS_QUERY_KEY } from '../../../lib/companySettingsQuery';
import { logClientError } from '../../../lib/errorLogsClient';
import { readPersistedAuthSession } from '../../../lib/supabase';
import {
  getOfflineSnapshot,
  setNetworkQualityMonitoringActive,
  setOfflineNetState,
  startNetworkQualityMonitoring,
} from '../offline/offlineStatus';

const DEFAULT_REFOCUS_ENABLED = false;
const QUERY_CACHE_MAX_ENTRIES = 350;
const INACTIVE_QUERY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAINTENANCE_INTERVAL_MS = 3 * 60 * 1000;
const PERSIST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const HOT_REQUEST_PERSIST_QUERY_SIZE_LIMIT_BYTES = 900 * 1024;
const HOT_ENTITY_LIST_PERSIST_QUERY_SIZE_LIMIT_BYTES = 600 * 1024;
const AUXILIARY_ENTITY_PERSIST_QUERY_SIZE_LIMIT_BYTES = 400 * 1024;
const DEFAULT_QUERY_STALE_MS = 60 * 1000;
const HOT_REQUEST_LIST_STALE_MS = 60 * 1000;
const PRIVILEGED_ADMIN_QUERY_GC_MS = 30 * 60 * 1000;
const DEFAULT_QUERY_GC_MS = PERSIST_MAX_AGE_MS;
const DEFAULT_MAX_RETRIES = 2;
const PERSIST_THROTTLE_MS = 12_000;
const PERSIST_RESTORE_TIMEOUT_MS = 1_800;
// Keep hydration bounded on low-memory Android devices. This is a soft budget:
// paused mutations and optimistic offline data are never removed from disk.
const PERSIST_TARGET_SERIALIZED_CHARS = 3 * 1024 * 1024;
const PERSIST_HARD_SERIALIZED_CHARS = 4 * 1024 * 1024;
const PERSISTED_QUERY_OVERHEAD_CHARS = 512;
const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUERY_CACHE_ENVELOPE_SCHEMA = 1;
const QUERY_CACHE_WRITE_CONTEXT_KEY = '__fieldWorkQueryCacheWriteContext';
const QUERY_CACHE_BUSTER = 'offline-v2-auth-scoped-2026-06-03';
const QUERY_CACHE_STORAGE_KEY = 'REACT_QUERY_OFFLINE_CACHE';

type QueryCacheOwner = {
  userId: string;
  companyId: string | null;
};

type QueryCacheWriteContext = {
  epoch: number;
  owner: QueryCacheOwner;
};

export type QueryCacheOwnerContext = {
  epoch: number;
  owner: QueryCacheOwner;
};

let activeQueryCacheOwner: QueryCacheOwner | null = null;
let queryCacheOwnerEpoch = 0;

function normalizeCanonicalId(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return CANONICAL_UUID_RE.test(normalized) ? normalized : null;
}

function areQueryCacheOwnersEqual(left: QueryCacheOwner | null, right: QueryCacheOwner | null) {
  return (
    !!left &&
    !!right &&
    left.userId === right.userId &&
    left.companyId === right.companyId
  );
}

function normalizeStoredQueryCacheOwner(value: any): QueryCacheOwner | null {
  const userId = normalizeCanonicalId(value?.userId);
  if (!userId) return null;

  const rawCompanyId = String(value?.companyId || '').trim();
  const companyId = rawCompanyId ? normalizeCanonicalId(rawCompanyId) : null;
  if (rawCompanyId && !companyId) return null;
  return { userId, companyId };
}

function getPersistedSessionOwner(session: any): QueryCacheOwner | null {
  const userId = normalizeCanonicalId(session?.user?.id);
  if (!userId) return null;
  return {
    userId,
    companyId: normalizeCanonicalId(session?.user?.user_metadata?.company_id),
  };
}

export function setActiveQueryCacheOwner(owner: { userId?: unknown; companyId?: unknown }) {
  const userId = normalizeCanonicalId(owner?.userId);
  if (!userId) return false;

  const companyWasProvided = Object.prototype.hasOwnProperty.call(owner || {}, 'companyId');
  const companyId = companyWasProvided
    ? normalizeCanonicalId(owner?.companyId)
    : activeQueryCacheOwner?.userId === userId
      ? activeQueryCacheOwner.companyId
      : null;
  const nextOwner = { userId, companyId };
  if (areQueryCacheOwnersEqual(activeQueryCacheOwner, nextOwner)) return true;

  queryCacheOwnerEpoch += 1;
  activeQueryCacheOwner = nextOwner;
  return true;
}

export function clearActiveQueryCacheOwner() {
  // Increment even when already clear: a throttled write may still carry an
  // older null-to-user transition and must never resurrect a signed-out cache.
  queryCacheOwnerEpoch += 1;
  activeQueryCacheOwner = null;
}

export function getActiveQueryCacheOwner(): QueryCacheOwner | null {
  return activeQueryCacheOwner ? { ...activeQueryCacheOwner } : null;
}

export function captureActiveQueryCacheOwnerContext(): QueryCacheOwnerContext | null {
  if (!activeQueryCacheOwner?.userId || !activeQueryCacheOwner.companyId) return null;
  return {
    epoch: queryCacheOwnerEpoch,
    owner: { ...activeQueryCacheOwner },
  };
}

export function isActiveQueryCacheOwnerContext(
  context: QueryCacheOwnerContext | null | undefined,
) {
  return (
    !!context &&
    context.epoch === queryCacheOwnerEpoch &&
    areQueryCacheOwnersEqual(context.owner, activeQueryCacheOwner)
  );
}

export function assertActiveQueryCacheOwnerContext(
  context: QueryCacheOwnerContext | null | undefined,
) {
  if (isActiveQueryCacheOwnerContext(context)) return;
  const error = new Error('Query cache owner changed during mutation') as Error & {
    code?: string;
  };
  error.code = 'QUERY_CACHE_OWNER_CHANGED';
  throw error;
}

export function isPrivilegedAdminQueryKey(queryKey: unknown) {
  const key0 = Array.isArray(queryKey) ? queryKey[0] : null;
  return typeof key0 === 'string' && key0.startsWith('admin');
}

function isLegacyPrivilegedEmployeeDetailQuery(query: any) {
  const queryKey = Array.isArray(query?.queryKey) ? query.queryKey : [];
  const data = query?.state?.data;
  return Boolean(
    queryKey[0] === 'employees' &&
      queryKey[1] === 'detail' &&
      data &&
      typeof data === 'object' &&
      data.meIsSuperAdmin === true,
  );
}

export function isPrivilegedAdminQuery(query: any) {
  return Boolean(
    isPrivilegedAdminQueryKey(query?.queryKey) ||
      isLegacyPrivilegedEmployeeDetailQuery(query),
  );
}

export async function purgePrivilegedAdminQueryCache() {
  const predicate = (query: any) => isPrivilegedAdminQuery(query);
  try {
    await queryClient.cancelQueries({ predicate });
  } catch {}
  queryClient.removeQueries({ predicate });

  // Removing an elevated result must also replace the on-disk envelope now;
  // the normal persister throttle is too wide for an authorization revocation.
  try {
    await persistActiveQueryClientSnapshotNow();
  } catch {}
}

function isPersistedClientShape(value: any) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isFinite(Number(value.timestamp)) &&
    typeof value.buster === 'string' &&
    !!value.clientState &&
    typeof value.clientState === 'object'
  );
}

function stripPrivilegedAdminQueriesFromPersistedClient(persistedClient: any) {
  const queries = Array.isArray(persistedClient?.clientState?.queries)
    ? persistedClient.clientState.queries
    : [];
  const safeQueries = queries.filter(
    (query: any) => !isPrivilegedAdminQuery(query),
  );
  if (safeQueries.length === queries.length) {
    return { client: persistedClient, stripped: false };
  }
  return {
    client: {
      ...persistedClient,
      clientState: {
        ...(persistedClient.clientState || {}),
        queries: safeQueries,
      },
    },
    stripped: true,
  };
}

function getEmbeddedProfileOwner(persistedClient: any): QueryCacheOwner | null {
  const queries = Array.isArray(persistedClient?.clientState?.queries)
    ? persistedClient.clientState.queries
    : [];
  const profileQuery = queries.find(
    (query: any) =>
      Array.isArray(query?.queryKey) &&
      query.queryKey[0] === 'profile' &&
      query.queryKey[1] === 'me',
  );
  const profile = profileQuery?.state?.data;
  const userId = normalizeCanonicalId(profile?.id);
  if (!userId) return null;
  return {
    userId,
    companyId: normalizeCanonicalId(profile?.company_id),
  };
}

function persistedClientContainsCompanyScopedData(
  persistedClient: any,
  owner: QueryCacheOwner,
) {
  const mutations = Array.isArray(persistedClient?.clientState?.mutations)
    ? persistedClient.clientState.mutations
    : [];
  if (mutations.length > 0) return true;

  const queries = Array.isArray(persistedClient?.clientState?.queries)
    ? persistedClient.clientState.queries
    : [];
  return queries.some((query: any) => {
    const key = Array.isArray(query?.queryKey) ? query.queryKey : [];
    if (key[0] === 'superAdminAccess' && normalizeCanonicalId(key[1]) === owner.userId) {
      return false;
    }
    if (
      key[0] === 'profile' &&
      (key[1] === 'me' || normalizeCanonicalId(key[1]) === owner.userId)
    ) {
      return false;
    }
    return true;
  });
}

function resolvePersistedClientForOwner(storedValue: any, sessionOwner: QueryCacheOwner) {
  if (storedValue?.schema === QUERY_CACHE_ENVELOPE_SCHEMA) {
    const storedOwner = normalizeStoredQueryCacheOwner(storedValue.owner);
    const storedClient = storedValue.client;
    if (!storedOwner || !isPersistedClientShape(storedClient)) return null;
    const { client, stripped } = stripPrivilegedAdminQueriesFromPersistedClient(storedClient);
    if (storedOwner.userId !== sessionOwner.userId) return null;

    const embeddedOwner = getEmbeddedProfileOwner(client);
    if (embeddedOwner?.userId && embeddedOwner.userId !== storedOwner.userId) return null;
    if (
      sessionOwner.companyId &&
      embeddedOwner?.companyId &&
      sessionOwner.companyId !== embeddedOwner.companyId
    ) {
      return null;
    }
    if (
      storedOwner.companyId &&
      ((sessionOwner.companyId && sessionOwner.companyId !== storedOwner.companyId) ||
        (embeddedOwner?.companyId && embeddedOwner.companyId !== storedOwner.companyId))
    ) {
      return null;
    }

    const hasCompanyScopedData = persistedClientContainsCompanyScopedData(client, storedOwner);
    const verifiedCompanyId = sessionOwner.companyId || embeddedOwner?.companyId || null;
    if (hasCompanyScopedData && (!storedOwner.companyId || !verifiedCompanyId)) return null;

    return {
      client,
      owner: {
        userId: storedOwner.userId,
        companyId: storedOwner.companyId || sessionOwner.companyId || embeddedOwner?.companyId || null,
      },
      shouldRewriteEnvelope: stripped,
    };
  }

  // One guarded migration from the former raw TanStack payload. A missing or
  // partial profile sentinel is deliberately rejected: offline availability
  // must never come at the cost of cross-account data exposure.
  if (!isPersistedClientShape(storedValue)) return null;
  const { client: migratedClient } = stripPrivilegedAdminQueriesFromPersistedClient(storedValue);
  const embeddedOwner = getEmbeddedProfileOwner(migratedClient);
  if (!embeddedOwner || embeddedOwner.userId !== sessionOwner.userId) return null;
  if (
    embeddedOwner.companyId &&
    sessionOwner.companyId &&
    embeddedOwner.companyId !== sessionOwner.companyId
  ) {
    return null;
  }
  if (
    persistedClientContainsCompanyScopedData(migratedClient, embeddedOwner) &&
    !embeddedOwner.companyId
  ) {
    return null;
  }
  return {
    client: migratedClient,
    owner: {
      userId: embeddedOwner.userId,
      companyId: embeddedOwner.companyId || sessionOwner.companyId || null,
    },
    shouldRewriteEnvelope: true,
  };
}

function getErrorStatus(error: any): number | null {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  return Number.isFinite(status) ? status : null;
}

function isAuthLikeError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('jwt') ||
    message.includes('session expired') ||
    message.includes('access denied')
  );
}

function isOfflineLikeError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('network error') ||
    message.includes('failed to fetch') ||
    message.includes('internet') ||
    message.includes('timed out')
  );
}

function shouldRetryQuery(failureCount: number, error: any) {
  if (!onlineManager.isOnline()) return false;
  // On constrained links the cached snapshot is already usable. Starting a
  // second remote read after our deadline would compete with the first socket
  // (which React Native fetch cannot always cancel reliably) and make EDGE/2G
  // startup worse. A later focus/reconnect refresh remains available.
  if (getOfflineSnapshot().isPoorConnection) return false;
  if (String(error?.code || '') === 'READ_DEADLINE_EXCEEDED') return false;
  if (failureCount >= DEFAULT_MAX_RETRIES) return false;
  if (isAuthLikeError(error)) return false;

  const status = getErrorStatus(error);
  if (status && status < 500 && status !== 408 && status !== 429) {
    return false;
  }

  return isOfflineLikeError(error) || !status || status >= 500 || status === 408 || status === 429;
}

function retryDelay(attemptIndex: number) {
  const attempt = Math.max(1, Number(attemptIndex) || 1);
  return Math.min(1000 * 2 ** (attempt - 1), 15_000);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      placeholderData: (prev) => prev,
      staleTime: DEFAULT_QUERY_STALE_MS,
      gcTime: DEFAULT_QUERY_GC_MS,
      retry: shouldRetryQuery,
      retryDelay,
      refetchOnMount: false,
      refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
      refetchOnReconnect: false,
      networkMode: 'offlineFirst',
    },
    mutations: {
      // A lost response after a committed create/RPC is ambiguous. Automatic
      // replay can duplicate non-idempotent writes; durable outboxes own their
      // explicit retry policy instead.
      retry: 0,
      networkMode: 'offlineFirst',
      onError: (error) => {
        logClientError(error, {
          source: 'react_query_mutation',
          mutationKey: null,
        });
      },
    },
  },
});

queryClient.setQueryDefaults(['requests', 'all'], {
  staleTime: HOT_REQUEST_LIST_STALE_MS,
  gcTime: PERSIST_MAX_AGE_MS,
  // RouteFreshnessBoundary performs one quality-gated refresh after a real
  // poor/offline -> good transition. TanStack's raw reconnect event cannot
  // distinguish EDGE and would otherwise fan out every active request query.
  refetchOnReconnect: false,
});
queryClient.setQueryDefaults(['requests', 'my'], {
  staleTime: HOT_REQUEST_LIST_STALE_MS,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnReconnect: false,
});
queryClient.setQueryDefaults(['requests', 'calendar'], {
  staleTime: HOT_REQUEST_LIST_STALE_MS,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnReconnect: false,
});
queryClient.setQueryDefaults(['requests', 'detail'], {
  staleTime: 45 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnReconnect: false,
});
queryClient.setQueryDefaults(['employees', 'list'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
});
queryClient.setQueryDefaults(['employees', 'detail'], {
  staleTime: 120 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
});
queryClient.setQueryDefaults(['employees', 'departments'], {
  staleTime: 10 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
});
queryClient.setQueryDefaults(['clients'], {
  staleTime: 45 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['company'], {
  staleTime: 10 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['department'], {
  staleTime: 10 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['objects'], {
  staleTime: 45 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['finance'], {
  staleTime: 30 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['appSettings'], {
  staleTime: 2 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyEntitlements'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyStorageUsage'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyAccessState'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['companyPaidSeatsTotal'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['billingMemberStats'], {
  staleTime: 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminCompanies'], {
  staleTime: 60 * 1000,
  gcTime: PRIVILEGED_ADMIN_QUERY_GC_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminCompany'], {
  staleTime: 60 * 1000,
  gcTime: PRIVILEGED_ADMIN_QUERY_GC_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminCompanySubscriptionMeta'], {
  staleTime: 60 * 1000,
  gcTime: PRIVILEGED_ADMIN_QUERY_GC_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['adminUsers'], {
  staleTime: 60 * 1000,
  gcTime: PRIVILEGED_ADMIN_QUERY_GC_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
for (const adminQueryKey of [
  'adminUsersV2',
  'adminEmployeeDetail',
  'adminCompanyAccessState',
  'adminPromoCodesV2',
  'adminSupportRequest',
  'adminSupportRequests',
  'adminSupportRequestsUnreadCount',
  'adminStorageOverview',
]) {
  queryClient.setQueryDefaults([adminQueryKey], {
    staleTime: 60 * 1000,
    gcTime: PRIVILEGED_ADMIN_QUERY_GC_MS,
    refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
    refetchOnReconnect: false,
  });
}
queryClient.setQueryDefaults(['tags'], {
  staleTime: 30 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});
queryClient.setQueryDefaults(['field-settings'], {
  staleTime: 5 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: false,
});
queryClient.setQueryDefaults(COMPANY_SETTINGS_QUERY_KEY, {
  staleTime: 5 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
  refetchOnWindowFocus: DEFAULT_REFOCUS_ENABLED,
});

queryClient.setQueryDefaults(['session'], { retry: 0, gcTime: 0 });
queryClient.setQueryDefaults(['profile'], { retry: 1, gcTime: PERSIST_MAX_AGE_MS });
queryClient.setQueryDefaults(['permissions'], {
  staleTime: 5 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
});
queryClient.setQueryDefaults(['superAdminAccess'], {
  staleTime: 5 * 60 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
});
queryClient.setQueryDefaults(['payments'], {
  staleTime: 30 * 1000,
  gcTime: PERSIST_MAX_AGE_MS,
});

const queryCacheStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
  async setItem(key: string, value: string) {
    const envelope = JSON.parse(value);
    const writeOwner = normalizeStoredQueryCacheOwner(envelope?.owner);
    const writeEpoch = Number(envelope?.writeEpoch);
    if (
      envelope?.schema !== QUERY_CACHE_ENVELOPE_SCHEMA ||
      !writeOwner ||
      !Number.isSafeInteger(writeEpoch) ||
      writeEpoch !== queryCacheOwnerEpoch ||
      !areQueryCacheOwnersEqual(writeOwner, activeQueryCacheOwner)
    ) {
      throw new Error('query-cache-owner-changed-before-write');
    }

    await AsyncStorage.setItem(key, value);

    // AsyncStorage writes are asynchronous. If logout/account switching won
    // the race after setItem started, remove only this stale value so a
    // throttled write cannot resurrect the previous account after cleanup.
    if (
      writeEpoch !== queryCacheOwnerEpoch ||
      !areQueryCacheOwnersEqual(writeOwner, activeQueryCacheOwner)
    ) {
      try {
        const currentValue = await AsyncStorage.getItem(key);
        if (currentValue === value) await AsyncStorage.removeItem(key);
      } catch {}
    }
  },
};

// Cache dehydration serializes on the JS thread. Batch bursts of updates so
// offline durability cannot interrupt taps and navigation every second.
const asyncStoragePersister = createAsyncStoragePersister({
  storage: queryCacheStorage,
  key: QUERY_CACHE_STORAGE_KEY,
  throttleTime: PERSIST_THROTTLE_MS,
  serialize: serializePersistedClient,
  deserialize: JSON.parse,
});

function persistForActiveQueryCacheOwner(persistedClient: any) {
  const owner = activeQueryCacheOwner;
  if (!owner) return Promise.resolve();

  const writeContext: QueryCacheWriteContext = {
    epoch: queryCacheOwnerEpoch,
    owner: { ...owner },
  };
  return Promise.resolve(
    asyncStoragePersister.persistClient({
      ...persistedClient,
      [QUERY_CACHE_WRITE_CONTEXT_KEY]: writeContext,
    } as any),
  );
}

function discardPersistedQueryCache() {
  void Promise.resolve(asyncStoragePersister.removeClient()).catch(() => {});
}

export async function restoreVerifiedBackgroundQueryContext(
  timeoutMs = PERSIST_RESTORE_TIMEOUT_MS,
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timedOut = Symbol('background-query-context-timeout');
  try {
    const result = await Promise.race([
      Promise.allSettled([
        Promise.resolve(asyncStoragePersister.restoreClient()),
        Promise.resolve(readPersistedAuthSession()),
      ]),
      new Promise<typeof timedOut>((resolve) => {
        timeoutId = setTimeout(() => resolve(timedOut), Math.max(250, Number(timeoutMs) || 0));
      }),
    ]);
    if (result === timedOut) return null;

    const [cacheAttempt, sessionAttempt] = result;
    if (cacheAttempt.status !== 'fulfilled' || sessionAttempt.status !== 'fulfilled') return null;
    const storedValue = cacheAttempt.value as any;
    const sessionOwner = getPersistedSessionOwner(sessionAttempt.value);
    if (!storedValue || !sessionOwner) return null;

    const resolved = resolvePersistedClientForOwner(storedValue, sessionOwner);
    if (!resolved?.owner?.companyId) return null;
    const embeddedOwner = getEmbeddedProfileOwner(resolved.client);
    if (
      !embeddedOwner ||
      embeddedOwner.userId !== resolved.owner.userId ||
      embeddedOwner.companyId !== resolved.owner.companyId
    ) {
      return null;
    }
    const persistedAt = Number(resolved.client?.timestamp || 0);
    if (!Number.isFinite(persistedAt) || Date.now() - persistedAt > PERSIST_MAX_AGE_MS) return null;
    if (String(resolved.client?.buster || '') !== QUERY_CACHE_BUSTER) return null;

    return {
      owner: { ...resolved.owner },
      client: resolved.client,
    };
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// The provider must never hydrate an old account after auth bootstrap has
// already continued. Bound the persister itself (instead of bypassing
// useIsRestoring in the auth layer): a late AsyncStorage result is ignored by
// PersistQueryClientProvider and therefore cannot be injected out of order.
export const persister = {
  persistClient: persistForActiveQueryCacheOwner,
  removeClient: asyncStoragePersister.removeClient,
  restoreClient: async () => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timedOut = Symbol('persist-restore-timeout');
    try {
      const result = await Promise.race([
        Promise.allSettled([
          Promise.resolve(asyncStoragePersister.restoreClient()),
          Promise.resolve(readPersistedAuthSession()),
        ]),
        new Promise<typeof timedOut>((resolve) => {
          timeoutId = setTimeout(() => resolve(timedOut), PERSIST_RESTORE_TIMEOUT_MS);
        }),
      ]);

      if (result === timedOut) {
        clearActiveQueryCacheOwner();
        return undefined;
      }

      const [cacheAttempt, sessionAttempt] = result;
      if (sessionAttempt.status !== 'fulfilled') {
        clearActiveQueryCacheOwner();
        return undefined;
      }

      const sessionOwner = getPersistedSessionOwner(sessionAttempt.value);
      if (cacheAttempt.status !== 'fulfilled') {
        clearActiveQueryCacheOwner();
        if (sessionOwner) setActiveQueryCacheOwner(sessionOwner);
        discardPersistedQueryCache();
        return undefined;
      }

      const storedValue = cacheAttempt.value as any;
      if (!storedValue) {
        clearActiveQueryCacheOwner();
        if (sessionOwner) setActiveQueryCacheOwner(sessionOwner);
        return undefined;
      }
      if (!sessionOwner) {
        clearActiveQueryCacheOwner();
        discardPersistedQueryCache();
        return undefined;
      }

      const resolved = resolvePersistedClientForOwner(storedValue, sessionOwner);
      if (!resolved) {
        clearActiveQueryCacheOwner();
        setActiveQueryCacheOwner(sessionOwner);
        discardPersistedQueryCache();
        return undefined;
      }

      clearActiveQueryCacheOwner();
      setActiveQueryCacheOwner(resolved.owner);
      if (resolved.shouldRewriteEnvelope) {
        void persistForActiveQueryCacheOwner(resolved.client);
      }
      return resolved.client;
    } catch {
      clearActiveQueryCacheOwner();
      return undefined;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },
};

let listenersConfigured = false;
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

function getObserverCount(query: any): number {
  try {
    if (typeof query?.getObserversCount === 'function') {
      return Number(query.getObserversCount()) || 0;
    }
  } catch {}
  return 0;
}

function isDurableOfflineQuery(queryKey: any): boolean {
  const key0 = Array.isArray(queryKey) ? queryKey[0] : null;
  const key1 = Array.isArray(queryKey) ? queryKey[1] : null;
  if (key0 === 'requests' && (key1 === 'all' || key1 === 'my' || key1 === 'calendar' || key1 === 'detail')) {
    return true;
  }
  if (
    key0 === 'requests' &&
    (key1 === 'filter-options' || key1 === 'activity' || key1 === 'assignee-name')
  ) {
    return true;
  }
  if (
    key0 === 'requests' &&
    key1 === 'executors' &&
    CANONICAL_UUID_RE.test(String(Array.isArray(queryKey) ? queryKey[2] || '' : ''))
  ) {
    return true;
  }
  if (key0 === 'orders' && (key1 === 'my' || key1 === 'all') && Array.isArray(queryKey) && queryKey[2] === 'recent') {
    return true;
  }
  if (key0 === 'employees' && (key1 === 'list' || key1 === 'detail' || key1 === 'departments')) {
    return true;
  }
  if (key0 === 'clients' || key0 === 'objects' || key0 === 'tags' || key0 === 'field-settings') {
    return true;
  }
  if (key0 === 'company-order-statuses') {
    return true;
  }
  if (
    key0 === 'permissions' &&
    key1 === 'matrix' &&
    CANONICAL_UUID_RE.test(String(Array.isArray(queryKey) ? queryKey[2] || '' : ''))
  ) {
    return true;
  }
  if (
    key0 === 'superAdminAccess' &&
    CANONICAL_UUID_RE.test(String(Array.isArray(queryKey) ? queryKey[1] || '' : ''))
  ) {
    return true;
  }
  if (key0 === 'finance' || key0 === 'payments') {
    return true;
  }
  if (
    key0 === 'company' ||
    key0 === 'department' ||
    (key0 === 'profile' &&
      (key1 === 'me' ||
        key1 === 'company-id' ||
        CANONICAL_UUID_RE.test(String(key1 || '')) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(key1 || ''))))
  ) {
    return true;
  }
  if (
    key0 === 'appSettings' ||
    key0 === 'companyEntitlements' ||
    key0 === 'companyStorageUsage' ||
    key0 === 'companyAccessState' ||
    key0 === 'companyPaidSeatsTotal' ||
    key0 === 'billingMemberStats'
  ) {
    return true;
  }
  if (Array.isArray(queryKey) && Array.isArray(COMPANY_SETTINGS_QUERY_KEY)) {
    return COMPANY_SETTINGS_QUERY_KEY.every((part, index) => queryKey[index] === part);
  }
  return false;
}

function trimQueryCount(maxEntries = QUERY_CACHE_MAX_ENTRIES) {
  const all = queryClient.getQueryCache().getAll();
  if (all.length <= maxEntries) return 0;

  const needToRemove = all.length - maxEntries;
  const removable = all
    .filter((q) => getObserverCount(q) === 0)
    .sort((a, b) => {
      const durableOrder =
        Number(!isPrivilegedAdminQuery(a) && isDurableOfflineQuery(a.queryKey)) -
        Number(!isPrivilegedAdminQuery(b) && isDurableOfflineQuery(b.queryKey));
      if (durableOrder !== 0) return durableOrder;
      return (a?.state?.dataUpdatedAt || 0) - (b?.state?.dataUpdatedAt || 0);
    });

  const candidates = removable.slice(0, needToRemove);
  for (const q of candidates) {
    queryClient.removeQueries({ queryKey: q.queryKey, exact: true });
  }
  return candidates.length;
}

function pruneInactiveOldQueries(maxAgeMs = INACTIVE_QUERY_MAX_AGE_MS) {
  const cutoff = Date.now() - maxAgeMs;
  const all = queryClient.getQueryCache().getAll();
  let removed = 0;

  for (const q of all) {
    const isActive = getObserverCount(q) > 0;
    if (!isPrivilegedAdminQuery(q) && isDurableOfflineQuery(q.queryKey)) continue;
    const updatedAt = q?.state?.dataUpdatedAt || 0;
    if (!isActive && updatedAt > 0 && updatedAt < cutoff) {
      queryClient.removeQueries({ queryKey: q.queryKey, exact: true });
      removed += 1;
    }
  }

  return removed;
}

export function runQueryCacheMaintenance() {
  pruneInactiveOldQueries();
  trimQueryCount();
}

function startCacheMaintenance() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    runQueryCacheMaintenance();
  }, CACHE_MAINTENANCE_INTERVAL_MS);
}

function stopCacheMaintenance() {
  if (!maintenanceTimer) return;
  clearInterval(maintenanceTimer);
  maintenanceTimer = null;
}

export function configureQueryEnvironment() {
  if (listenersConfigured) return;
  listenersConfigured = true;
  startNetworkQualityMonitoring(AppState.currentState === 'active');

  onlineManager.setEventListener((_setOnline) =>
    NetInfo.addEventListener((state) => {
      setOfflineNetState(state);
    }),
  );

  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (s) => {
      const isActive = s === 'active';
      handleFocus(isActive);
      setNetworkQualityMonitoringActive(isActive);
      if (isActive) {
        runQueryCacheMaintenance();
        startCacheMaintenance();
      } else {
        stopCacheMaintenance();
      }
    });
    return () => sub.remove();
  });

  runQueryCacheMaintenance();
  startCacheMaintenance();
}

type SerializedDataStats = {
  chars: number;
  hasOfflinePending: boolean;
};

const serializedDataStatsCache = new WeakMap<object, SerializedDataStats>();

function getSerializedDataStats(data: unknown): SerializedDataStats {
  if (data && typeof data === 'object') {
    const cached = serializedDataStatsCache.get(data as object);
    if (cached) return cached;
    try {
      const serialized = JSON.stringify(data);
      const stats = {
        chars: serialized?.length || 0,
        hasOfflinePending: serialized?.includes('"__offlinePending":true') || false,
      };
      serializedDataStatsCache.set(data as object, stats);
      return stats;
    } catch {
      return { chars: Number.POSITIVE_INFINITY, hasOfflinePending: false };
    }
  }
  try {
    return { chars: JSON.stringify(data)?.length || 0, hasOfflinePending: false };
  } catch {
    return { chars: Number.POSITIVE_INFINITY, hasOfflinePending: false };
  }
}

function isPersistableSize(data: unknown, maxBytes: number) {
  return getSerializedDataStats(data).chars <= maxBytes;
}

function getPersistedQueryPriority(query: any) {
  const dataStats = getSerializedDataStats(query?.state?.data);
  if (dataStats.hasOfflinePending) return 0;

  const key = Array.isArray(query?.queryKey) ? query.queryKey : [];
  const key0 = key[0];
  const key1 = key[1];
  if (
    key0 === 'profile' ||
    key0 === 'company' ||
    key0 === 'department' ||
    key0 === 'appSettings' ||
    key0 === 'companyEntitlements' ||
    key0 === 'companyAccessState' ||
    key0 === 'companyPaidSeatsTotal' ||
    key0 === 'billingMemberStats' ||
    key0 === 'company-order-statuses' ||
    key0 === 'permissions' ||
    key0 === 'superAdminAccess' ||
    key0 === 'field-settings' ||
    key0 === 'tags' ||
    (Array.isArray(COMPANY_SETTINGS_QUERY_KEY) &&
      COMPANY_SETTINGS_QUERY_KEY.every((part, index) => key[index] === part))
  ) {
    return 1;
  }
  if (
    (key0 === 'requests' && (key1 === 'all' || key1 === 'my' || key1 === 'calendar')) ||
    (key0 === 'orders' && (key1 === 'all' || key1 === 'my') && key[2] === 'recent') ||
    (key0 === 'employees' && (key1 === 'list' || key1 === 'departments')) ||
    (key0 === 'requests' && (key1 === 'executors' || key1 === 'filter-options')) ||
    (key0 === 'clients' && key1 === 'list') ||
    (key0 === 'objects' && (key1 === 'by-company' || key1 === 'by-client'))
  ) {
    return 2;
  }
  if (
    (key0 === 'requests' && (key1 === 'detail' || key1 === 'activity' || key1 === 'assignee-name')) ||
    key0 === 'finance' ||
    key0 === 'payments'
  ) {
    return 3;
  }
  if (key1 === 'detail') return 3;
  return 4;
}

function estimatePersistedQueryChars(query: any) {
  const dataChars = getSerializedDataStats(query?.state?.data).chars;
  if (!Number.isFinite(dataChars)) return Number.POSITIVE_INFINITY;
  let keyChars = 0;
  try {
    keyChars = JSON.stringify(query?.queryKey)?.length || 0;
  } catch {}
  return dataChars + keyChars + String(query?.queryHash || '').length + PERSISTED_QUERY_OVERHEAD_CHARS;
}

function sortPersistedQueriesByValue(queries: any[]) {
  return [...queries].sort((left, right) => {
    const priorityDelta = getPersistedQueryPriority(left) - getPersistedQueryPriority(right);
    if (priorityDelta !== 0) return priorityDelta;
    return Number(right?.state?.dataUpdatedAt || 0) - Number(left?.state?.dataUpdatedAt || 0);
  });
}

function compactPersistedClient(persistedClient: any) {
  const queries = Array.isArray(persistedClient?.clientState?.queries)
    ? persistedClient.clientState.queries
    : [];
  if (!queries.length) return persistedClient;

  let fixedChars = 0;
  try {
    fixedChars = JSON.stringify({
      ...persistedClient,
      clientState: {
        ...(persistedClient.clientState || {}),
        queries: [],
      },
    }).length;
  } catch {
    return persistedClient;
  }

  let remainingChars = Math.max(0, PERSIST_TARGET_SERIALIZED_CHARS - fixedChars);
  const selected: any[] = [];
  for (const query of sortPersistedQueriesByValue(queries)) {
    const estimate = estimatePersistedQueryChars(query);
    const isOfflinePending = getSerializedDataStats(query?.state?.data).hasOfflinePending;
    if (isOfflinePending || estimate <= remainingChars) {
      selected.push(query);
      if (Number.isFinite(estimate)) remainingChars = Math.max(0, remainingChars - estimate);
    }
  }

  if (selected.length === queries.length) return persistedClient;
  return {
    ...persistedClient,
    clientState: {
      ...(persistedClient.clientState || {}),
      queries: selected,
    },
  };
}

function serializePersistedClient(persistedClient: any) {
  const writeContext = persistedClient?.[QUERY_CACHE_WRITE_CONTEXT_KEY] as
    | QueryCacheWriteContext
    | undefined;
  const writeOwner = normalizeStoredQueryCacheOwner(writeContext?.owner);
  const writeEpoch = Number(writeContext?.epoch);
  if (
    !writeOwner ||
    !Number.isSafeInteger(writeEpoch) ||
    writeEpoch !== queryCacheOwnerEpoch ||
    !areQueryCacheOwnersEqual(writeOwner, activeQueryCacheOwner)
  ) {
    throw new Error('query-cache-owner-changed-during-serialize');
  }

  const { [QUERY_CACHE_WRITE_CONTEXT_KEY]: _writeContext, ...unownedClient } = persistedClient;
  if (
    !writeOwner.companyId &&
    persistedClientContainsCompanyScopedData(unownedClient, writeOwner)
  ) {
    throw new Error('query-cache-company-owner-required');
  }
  let compacted = compactPersistedClient(unownedClient);
  const stringifyEnvelope = (client: any) =>
    JSON.stringify({
      schema: QUERY_CACHE_ENVELOPE_SCHEMA,
      owner: writeOwner,
      writeEpoch,
      client,
    });
  let serialized = stringifyEnvelope(compacted);
  if (serialized.length <= PERSIST_HARD_SERIALIZED_CHARS) return serialized;

  // The estimate intentionally leaves headroom, but unusually large query
  // metadata can still cross the hard bound. Remove the least valuable cached
  // rows in one more pass while retaining optimistic offline state.
  const queries = Array.isArray(compacted?.clientState?.queries)
    ? compacted.clientState.queries
    : [];
  const required = queries.filter(
    (query: any) => getSerializedDataStats(query?.state?.data).hasOfflinePending,
  );
  const optional = sortPersistedQueriesByValue(
    queries.filter((query: any) => !getSerializedDataStats(query?.state?.data).hasOfflinePending),
  );
  let overflow = serialized.length - PERSIST_HARD_SERIALIZED_CHARS;
  while (overflow > 0 && optional.length) {
    const removed = optional.pop();
    try {
      overflow -= Math.max(1, JSON.stringify(removed)?.length || 0);
    } catch {
      overflow = 0;
    }
  }
  compacted = {
    ...compacted,
    clientState: {
      ...(compacted.clientState || {}),
      queries: [...required, ...optional],
    },
  };
  serialized = stringifyEnvelope(compacted);
  return serialized;
}

export const persistOptions = {
  persister,
  buster: QUERY_CACHE_BUSTER,
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => {
      const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
      const key1 = Array.isArray(q.queryKey) ? q.queryKey[1] : null;
      if (q.state.status !== 'success') return false;
      // Global administration payloads are authorization-sensitive and may
      // outlive a server-side demotion. Keep them in memory only; a cached
      // super-admin boolean remains merely a navigation hint.
      if (isPrivilegedAdminQuery(q)) return false;
      if (key0 === 'session' || key0 === 'userRole' || key0 === 'perm-canViewAll') {
        return false;
      }
      if (
        key0 === 'superAdminAccess' &&
        !CANONICAL_UUID_RE.test(String(Array.isArray(q.queryKey) ? q.queryKey[1] || '' : ''))
      ) {
        return false;
      }
      if (
        key0 === 'requests' &&
        key1 === 'executors' &&
        !CANONICAL_UUID_RE.test(String(Array.isArray(q.queryKey) ? q.queryKey[2] || '' : ''))
      ) {
        return false;
      }
      if (getSerializedDataStats(q.state.data).hasOfflinePending) return true;
      if (
        key0 === 'profile' &&
        key1 !== 'me' &&
        key1 !== 'company-id' &&
        !CANONICAL_UUID_RE.test(String(key1 || '')) &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(key1 || ''))
      ) {
        return false;
      }
      if (key0 === 'requests' && (key1 === 'all' || key1 === 'my' || key1 === 'calendar')) {
        return isPersistableSize(q.state.data, HOT_REQUEST_PERSIST_QUERY_SIZE_LIMIT_BYTES);
      }
      if (key0 === 'orders' && (key1 === 'my' || key1 === 'all') && Array.isArray(q.queryKey) && q.queryKey[2] === 'recent') {
        return isPersistableSize(q.state.data, HOT_REQUEST_PERSIST_QUERY_SIZE_LIMIT_BYTES);
      }
      if (
        (key0 === 'clients' && key1 === 'list') ||
        (key0 === 'objects' && (key1 === 'by-company' || key1 === 'by-client')) ||
        (key0 === 'employees' && key1 === 'list')
      ) {
        return isPersistableSize(q.state.data, HOT_ENTITY_LIST_PERSIST_QUERY_SIZE_LIMIT_BYTES);
      }
      if (
        (key0 === 'requests' &&
          (key1 === 'executors' ||
            key1 === 'filter-options' ||
            key1 === 'activity' ||
            key1 === 'assignee-name')) ||
        key0 === 'finance' ||
        key0 === 'payments'
      ) {
        return isPersistableSize(
          q.state.data,
          AUXILIARY_ENTITY_PERSIST_QUERY_SIZE_LIMIT_BYTES,
        );
      }
      return isDurableOfflineQuery(q.queryKey);
    },
  },
};

export async function persistActiveQueryClientSnapshotNow() {
  const owner = activeQueryCacheOwner;
  if (!owner?.userId || !owner.companyId) return false;
  const writeContext: QueryCacheWriteContext = {
    epoch: queryCacheOwnerEpoch,
    owner: { ...owner },
  };
  const persistedClient = {
    buster: QUERY_CACHE_BUSTER,
    timestamp: Date.now(),
    clientState: dehydrate(queryClient, persistOptions.dehydrateOptions),
    [QUERY_CACHE_WRITE_CONTEXT_KEY]: writeContext,
  };
  const serialized = serializePersistedClient(persistedClient);
  await queryCacheStorage.setItem(QUERY_CACHE_STORAGE_KEY, serialized);
  return true;
}
