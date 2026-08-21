// /useAppLastSeen.js
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from './lib/supabase';
import {
  getOfflineSnapshot,
  subscribeOfflineState,
} from './src/shared/offline/offlineStatus';

function canUseLastSeenNetwork() {
  const network = getOfflineSnapshot();
  return network.isNetworkKnown && network.isOnline && !network.isPoorConnection;
}

export function useAppLastSeen(minIntervalMs = 60_000, userId = null) {
  const lastSentAtRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const updateLastSeen = useCallback(async () => {
    if (!canUseLastSeenNetwork()) return false;

    // 1) RPC (предпочтительно)
    try {
      const { error } = await supabase.rpc('touch_last_seen');
      if (!error) {
        return true;
      }
    } catch {
      // silent catch
    }

    // 2) Больше НЕ делаем UPDATE в profiles — это и даёт "permission denied" при RLS.
    return false;
  }, []);

  const ping = useCallback(async (_src = 'unknown') => {
    // Не шевелимся, если приложение не активно — убираем сетевые ошибки в фоне
    if (appStateRef.current !== 'active') {
      return;
    }

    if (!canUseLastSeenNetwork()) {
      return;
    }

    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;

    try {
      // безопасный вызов без крашей при отсутствии сессии
      if (!userId) return;

      const now = Date.now();
      if (now - lastSentAtRef.current < minIntervalMs) {
        return;
      }

      const ok = await updateLastSeen();
      if (ok) {
        lastSentAtRef.current = now;
      }
    } catch (_e) {
      // подавляем сетевые ошибки, чтобы не сыпались красные логи
      if (!_e?.message?.includes?.('Network request failed')) {
        // silent catch
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [minIntervalMs, updateLastSeen, userId]);

  useEffect(() => {
    mountedRef.current = true;

    // первый пинг после маунта
    ping('mount');

    // реакция на смену состояния приложения
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === 'active' && prev !== 'active') {
        // сразу пингуем при возвращении
        ping('foreground');
      }
    });

    // события аутентификации
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      // сбрасываем троттлинг, чтобы сразу отправить свежий last_seen после логина
      lastSentAtRef.current = 0;
      if (session?.user?.id) ping('auth');
    });

    // периодический пинг каждые minIntervalMs миллисекунд (например, 30 секунд)
    const intervalId = setInterval(() => {
      ping('interval');
    }, minIntervalMs);
    const unsubscribeNetwork = subscribeOfflineState(() => {
      if (canUseLastSeenNetwork()) ping('network');
    });

    return () => {
      try {
        sub?.remove?.();
      } catch {}
      try {
        authSub?.subscription?.unsubscribe?.();
      } catch {}
      clearInterval(intervalId);
      unsubscribeNetwork();
      mountedRef.current = false;
    };
  }, [minIntervalMs, ping]);
}
