import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
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
  const wasOnlineRef = useRef(snapshot.isOnline);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;

    const refresh = async ({ syncOnReconnect = false } = {}) => {
      const nextSnapshot = getOfflineSnapshot();
      const becameOnline = !wasOnlineRef.current && nextSnapshot.isOnline;
      wasOnlineRef.current = nextSnapshot.isOnline;
      setSnapshot(nextSnapshot);
      if (syncOnReconnect && becameOnline) {
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
      if (getOfflineSnapshot().isOnline) {
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
