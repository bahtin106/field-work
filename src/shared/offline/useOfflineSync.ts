import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  getOfflineOutboxSummary,
  getOfflineSnapshot,
  restoreOfflineOptimisticState,
  setOfflineNetState,
  subscribeOfflineState,
  syncOfflineOutbox,
} from './offlineStatus';

const EMPTY_SUMMARY = { pending: 0, conflicts: 0, failed: 0 };

export function useOfflineSync({ enabled = true } = {}) {
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState(getOfflineSnapshot);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;

    const refresh = async () => {
      setSnapshot(getOfflineSnapshot());
      const nextSummary = await getOfflineOutboxSummary();
      if (active) setSummary(nextSummary);
    };

    restoreOfflineOptimisticState(queryClient).then((nextSummary) => {
      if (active) setSummary(nextSummary);
    }).catch(() => {});

    const unsubscribeLocal = subscribeOfflineState(() => {
      refresh().catch(() => {});
    });

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      setOfflineNetState(state);
      const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
      if (online) {
        syncOfflineOutbox(queryClient)
          .then((nextSummary) => {
            if (active) setSummary(nextSummary);
          })
          .catch(() => {});
      }
    });

    NetInfo.fetch()
      .then((state) => {
        setOfflineNetState(state);
        const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
        if (online) return syncOfflineOutbox(queryClient);
        return getOfflineOutboxSummary();
      })
      .then((nextSummary) => {
        if (active) setSummary(nextSummary);
      })
      .catch(() => {});

    return () => {
      active = false;
      unsubscribeLocal();
      unsubscribeNetInfo();
    };
  }, [enabled, queryClient]);

  return {
    ...snapshot,
    outbox: summary,
  };
}
