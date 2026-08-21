import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import NetInfo from '@react-native-community/netinfo';
import { hydrate } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { syncOfflineFinanceOutbox } from '../../features/finance/queries';
import {
  flushOrderPhotoQueue,
  recoverInterruptedOrderPhotoQueue,
} from '../media/orderPhotoQueue';
import {
  canRunOutboxSync,
  getActiveOfflineOwnerContext,
  setActiveOfflineOwner,
  setOfflineNetState,
  syncOfflineOutbox,
} from './offlineStatus';
import {
  queryClient,
  persistActiveQueryClientSnapshotNow,
  restoreVerifiedBackgroundQueryContext,
  setActiveQueryCacheOwner,
} from '../query/queryClient';

export const OFFLINE_BACKGROUND_SYNC_TASK = 'monitor-offline-background-sync-v1';
const BACKGROUND_BOOTSTRAP_TIMEOUT_MS = 2_500;
const BACKGROUND_SESSION_TIMEOUT_MS = 8_000;

async function refreshBackgroundNetworkState() {
  let timeoutId = null;
  const timedOut = Symbol('background-netinfo-timeout');
  try {
    const state = await Promise.race([
      NetInfo.fetch(),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(timedOut), BACKGROUND_BOOTSTRAP_TIMEOUT_MS);
      }),
    ]);
    if (state === timedOut) return false;
    setOfflineNetState(state);
    return true;
  } catch {
    return false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function ensureBackgroundOfflineOwner() {
  if (getActiveOfflineOwnerContext()) return { ready: true, bootstrapped: false };
  // In a mounted app, AuthProvider owns all session transitions. Never race a
  // foreground logout by rebuilding identity from a soon-to-be-deleted file.
  if (Number(globalThis.__MONITOR_AUTH_PROVIDER_MOUNT_COUNT__ || 0) > 0) {
    return { ready: false, bootstrapped: false };
  }

  const restored = await restoreVerifiedBackgroundQueryContext(
    BACKGROUND_BOOTSTRAP_TIMEOUT_MS,
  );
  if (!restored?.owner?.userId || !restored.owner.companyId) {
    return { ready: false, bootstrapped: false };
  }

  let sessionTimeoutId = null;
  const sessionTimedOut = Symbol('background-session-timeout');
  const sessionAttempt = await Promise.race([
    supabase.auth.getSession(),
    new Promise((resolve) => {
      sessionTimeoutId = setTimeout(
        () => resolve(sessionTimedOut),
        BACKGROUND_SESSION_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    if (sessionTimeoutId) clearTimeout(sessionTimeoutId);
  });
  if (sessionAttempt === sessionTimedOut || sessionAttempt?.error) {
    return { ready: false, bootstrapped: false };
  }
  if (
    String(sessionAttempt?.data?.session?.user?.id || '').trim() !==
    String(restored.owner.userId || '').trim()
  ) {
    return { ready: false, bootstrapped: false };
  }

  hydrate(queryClient, restored.client);
  setActiveQueryCacheOwner(restored.owner);
  setActiveOfflineOwner(restored.owner);
  return {
    ready: !!getActiveOfflineOwnerContext(),
    bootstrapped: true,
  };
}

async function runBackgroundSync() {
  const networkReady = await refreshBackgroundNetworkState();
  if (!networkReady) return true;
  if (!canRunOutboxSync()) return true;
  const ownerState = await ensureBackgroundOfflineOwner();
  if (!ownerState.ready) return true;
  const results = await Promise.allSettled([
    flushOrderPhotoQueue(),
    syncOfflineFinanceOutbox(queryClient),
    syncOfflineOutbox(queryClient),
  ]);
  if (ownerState.bootstrapped) {
    try {
      await persistActiveQueryClientSnapshotNow();
    } catch {
      return false;
    }
  }
  return results.every((result) => result.status === 'fulfilled');
}

if (!TaskManager.isTaskDefined(OFFLINE_BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(OFFLINE_BACKGROUND_SYNC_TASK, async () => {
    try {
      await runBackgroundSync();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerOfflineBackgroundSync() {
  if (!(await TaskManager.isAvailableAsync())) return false;
  if (!(await TaskManager.isTaskRegisteredAsync(OFFLINE_BACKGROUND_SYNC_TASK))) {
    await BackgroundTask.registerTaskAsync(OFFLINE_BACKGROUND_SYNC_TASK, {
      minimumInterval: 15,
    });
  }
  return true;
}

export async function unregisterOfflineBackgroundSync() {
  if (!(await TaskManager.isAvailableAsync())) return;
  if (await TaskManager.isTaskRegisteredAsync(OFFLINE_BACKGROUND_SYNC_TASK)) {
    await BackgroundTask.unregisterTaskAsync(OFFLINE_BACKGROUND_SYNC_TASK);
  }
}

export { runBackgroundSync };
export { recoverInterruptedOrderPhotoQueue };
