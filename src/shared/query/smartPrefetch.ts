import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { getMyCompanyId } from '../../features/profile/api';
import { getOfflineSnapshot } from '../offline/offlineStatus';
import { queryKeys } from './queryKeys';
import { listRequests, listRequestExecutors } from '../../features/requests/api';

const SMART_PREFETCH_PAGE_SIZE = 20;
const SMART_PREFETCH_PROFILE_KEY = 'app.smartPrefetch.profile.v1';

type SmartPrefetchProfile = 'lite' | 'balanced' | 'aggressive';

const PROFILE_CONFIG: Record<
  SmartPrefetchProfile,
  {
    cooldownMs: number;
    includeAllRequests: boolean;
    includeExecutors: boolean;
    allRequestsDelayMs: number;
    executorsDelayMs: number;
  }
> = {
  lite: {
    cooldownMs: 8 * 60 * 1000,
    includeAllRequests: false,
    includeExecutors: false,
    allRequestsDelayMs: 0,
    executorsDelayMs: 0,
  },
  balanced: {
    cooldownMs: 5 * 60 * 1000,
    includeAllRequests: true,
    includeExecutors: true,
    allRequestsDelayMs: 180,
    executorsDelayMs: 180,
  },
  aggressive: {
    cooldownMs: 2 * 60 * 1000,
    includeAllRequests: true,
    includeExecutors: true,
    allRequestsDelayMs: 100,
    executorsDelayMs: 100,
  },
};

let lastRunAt = 0;
let inFlight = false;
let resolvedProfile: SmartPrefetchProfile | null = null;

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

async function prefetchRequestList(queryClient: QueryClient, scope: 'my' | 'all') {
  const params = { scope, page: 1, pageSize: SMART_PREFETCH_PAGE_SIZE };
  const key = scope === 'my' ? queryKeys.requests.my({}) : queryKeys.requests.all({});
  const rows = await listRequests(params);
  const page = Array.isArray(rows) ? rows : [];
  queryClient.setQueryData(key, {
    pages: [page],
    pageParams: [1],
  });
}

export async function runSmartPrefetch(queryClient: QueryClient) {
  const profile = await resolveEffectiveProfile();
  const cfg = PROFILE_CONFIG[profile];
  if (!canRun(cfg.cooldownMs)) return false;
  inFlight = true;
  lastRunAt = Date.now();
  try {
    await prefetchRequestList(queryClient, 'my');
    if (cfg.includeAllRequests) {
      await new Promise((resolve) => setTimeout(resolve, cfg.allRequestsDelayMs));
      await prefetchRequestList(queryClient, 'all');
    }
    if (cfg.includeExecutors) {
      await new Promise((resolve) => setTimeout(resolve, cfg.executorsDelayMs));
      const companyId = await queryClient.fetchQuery({
        queryKey: queryKeys.profile.companyId(),
        queryFn: getMyCompanyId,
        staleTime: 5 * 60 * 1000,
      });
      if (companyId) {
        await queryClient.prefetchQuery({
          queryKey: queryKeys.requests.executors(companyId),
          queryFn: () => listRequestExecutors({ companyId }),
          staleTime: 60 * 1000,
        });
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
  const task = InteractionManager.runAfterInteractions(() => {
    runSmartPrefetch(queryClient).catch(() => {});
  });
  return () => {
    try {
      task?.cancel?.();
    } catch {}
  };
}
