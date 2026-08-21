import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  canRunOutboxSync,
  getOfflineOutboxSummary,
  getOfflineSnapshot,
  restoreOfflineOptimisticState,
  subscribeOfflineState,
  syncOfflineOutbox,
} from './offlineStatus';

const EMPTY_SUMMARY = { pending: 0, conflicts: 0, failed: 0 };

export function useOfflineSync({ enabled = true } = {}) {
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState(getOfflineSnapshot);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const wasSyncableRef = useRef(canRunOutboxSync(snapshot));

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;

    const refresh = async ({ syncOnReconnect = false } = {}) => {
      const nextSnapshot = getOfflineSnapshot();
      const isSyncable = canRunOutboxSync(nextSnapshot);
      const becameSyncable = !wasSyncableRef.current && isSyncable;
      wasSyncableRef.current = isSyncable;
      setSnapshot(nextSnapshot);
      if (syncOnReconnect && becameSyncable) {
        const nextSummary = await syncOfflineOutbox(queryClient);
        if (active) setSummary(nextSummary);
        return;
      }
      const nextSummary = await getOfflineOutboxSummary();
      if (active) setSummary(nextSummary);
    };

    restoreOfflineOptimisticState(queryClient).then((nextSummary) => {
      if (!active) return;
      setSummary(nextSummary);
      if (canRunOutboxSync()) {
        syncOfflineOutbox(queryClient)
          .then((syncedSummary) => {
            if (active) setSummary(syncedSummary);
          })
          .catch(() => {});
      }
    }).catch(() => {});

    const unsubscribeLocal = subscribeOfflineState(() => {
      refresh({ syncOnReconnect: true }).catch(() => {});
    });

    return () => {
      active = false;
      unsubscribeLocal();
    };
  }, [enabled, queryClient]);

  return {
    ...snapshot,
    outbox: summary,
  };
}
