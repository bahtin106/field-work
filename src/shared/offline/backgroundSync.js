import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { syncOfflineFinanceOutbox } from '../../features/finance/queries';
import {
  flushOrderPhotoQueue,
  recoverInterruptedOrderPhotoQueue,
} from '../media/orderPhotoQueue';
import { syncOfflineOutbox } from './offlineStatus';
import { queryClient } from '../query/queryClient';

export const OFFLINE_BACKGROUND_SYNC_TASK = 'monitor-offline-background-sync-v1';

async function runBackgroundSync() {
  const results = await Promise.allSettled([
    flushOrderPhotoQueue(),
    syncOfflineFinanceOutbox(queryClient),
    syncOfflineOutbox(queryClient),
  ]);
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
