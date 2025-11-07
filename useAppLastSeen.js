// /useAppLastSeen.js
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from './lib/supabase';

export function useAppLastSeen(minIntervalMs = 60_000) {
  const lastSentAtRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const log = (...args) => console.log('[last_seen]', ...args);
  const warn = (...args) => console.warn('[last_seen]', ...args);

  async function updateLastSeen(uid, src) {
    // 1) RPC (предпочтительно)
    try {
      log(`${src}: RPC try`);
      const { data, error } = await supabase.rpc('touch_last_seen');
      if (!error) {
        log(`${src}: RPC OK`, data);
        return true;
      }
      warn(`${src}: RPC error:`, error);
    } catch (e) {
      warn(`${src}: RPC exception:`, e);
    }

    // 2) Больше НЕ делаем UPDATE в profiles — это и даёт "permission denied" при RLS.
    log(`${src}: skip UPDATE fallback (RLS-safe)`);
    return false;
  }

  async function ping(src = 'unknown') {
    // Не шевелимся, если приложение не активно — убираем сетевые ошибки в фоне
    if (appStateRef.current !== 'active') {
      log(`${src}: skip (appState=${appStateRef.current})`);
      return;
    }

    if (inFlightRef.current) {
      log(`${src}: skip (in flight)`);
      return;
    }
    inFlightRef.current = true;

    try {
      // безопасный вызов без крашей при отсутствии сессии
      const { data: { user } = {}, error: userErr } = await supabase.auth
        .getUser()
        .catch((e) => ({ error: e }));

      if (userErr?.message?.includes?.('Auth session missing')) {
        log(`${src}: no valid session (AuthSessionMissingError), skip`);
        return;
      }
      if (!user?.id) {
        log(`${src}: no user session, skip`);
        return;
      }

      const now = Date.now();
      if (now - lastSentAtRef.current < minIntervalMs) {
        log(`${src}: throttled (${now - lastSentAtRef.current}ms < ${minIntervalMs}ms)`);
        return;
      }

      const ok = await updateLastSeen(user.id, src);
      if (ok) {
        lastSentAtRef.current = now;
        log(`${src}: done, next after >= ${minIntervalMs}ms`);
      }
    } catch (e) {
      // подавляем сетевые ошибки, чтобы не сыпались красные логи
      if (e?.message?.includes?.('Network request failed')) {
        log(`${src}: network down, skip`);
      } else {
        warn(`${src}: ping exception:`, e);
      }
    } finally {
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    log('hook init, appState =', appStateRef.current);

    // первый пинг после маунта
    ping('mount');

    // диагностический пинг каждые 15 сек (виден в терминале/Expo)
    const timer = setInterval(() => {
      ping('interval');
    }, 15_000);

    // реакция на смену состояния приложения
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      log('AppState change:', prev, '→', next);
      if (next === 'active' && prev !== 'active') {
        // сразу пингуем при возвращении
        ping('foreground');
      }
    });

    // события аутентификации
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      log('auth event:', event, session?.user?.id ? 'has user' : 'no user');
      // сбрасываем троттлинг, чтобы сразу отправить свежий last_seen после логина
      lastSentAtRef.current = 0;
      if (session?.user?.id) ping('auth');
    });

    return () => {
      log('cleanup');
      try {
        sub?.remove?.();
      } catch {}
      try {
        authSub?.subscription?.unsubscribe?.();
      } catch {}
      clearInterval(timer);
      mountedRef.current = false;
    };
  }, [minIntervalMs]);
}
