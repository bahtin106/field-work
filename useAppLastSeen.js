// /useAppLastSeen.js
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from './lib/supabase';

export function useAppLastSeen(minIntervalMs = 60_000) {
  const lastSentAtRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const updateLastSeen = useCallback(async (_uid, _src) => {
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

  const ping = useCallback(async (src = 'unknown') => {
    // Не шевелимся, если приложение не активно — убираем сетевые ошибки в фоне
    if (appStateRef.current !== 'active') {
      return;
    }

    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;

    try {
      // безопасный вызов без крашей при отсутствии сессии
      const { data: { user } = {}, error: userErr } = await supabase.auth
        .getUser()
        .catch((_e) => ({ error: _e }));

      if (userErr?.message?.includes?.('Auth session missing')) {
        return;
      }
      if (!user?.id) {
        return;
      }

      const now = Date.now();
      if (now - lastSentAtRef.current < minIntervalMs) {
        return;
      }

      const ok = await updateLastSeen(user.id, src);
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
  }, [minIntervalMs, updateLastSeen]);

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

    return () => {
      try {
        sub?.remove?.();
      } catch {}
      try {
        authSub?.subscription?.unsubscribe?.();
      } catch {}
      clearInterval(intervalId);
      mountedRef.current = false;
    };
  }, [minIntervalMs, ping]);
}
