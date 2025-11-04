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

    // 2) Fallback UPDATE без .select(...) (чтобы не требовать select-политики)
    try {
      log(`${src}: UPDATE fallback try (no select)`);
      const { error } = await supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', uid);

      if (error) {
        warn(`${src}: UPDATE error:`, error);
        return false;
      }
      log(`${src}: UPDATE OK (no select)`);
      return true;
    } catch (e) {
      warn(`${src}: UPDATE exception:`, e);
      return false;
    }
  }

  async function ping(src = 'unknown') {
    if (inFlightRef.current) {
      log(`${src}: skip (in flight)`);
      return;
    }
    inFlightRef.current = true;

    try {
      const { data: { user } = {}, error: userErr } = await supabase.auth.getUser();
      if (userErr) { warn(`${src}: getUser error:`, userErr); return; }
      if (!user?.id) { log(`${src}: no user session, skip`); return; }

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
      warn(`${src}: ping exception:`, e);
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

    // возврат на передний план
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      log('AppState change:', prev, '→', next);
      if (next === 'active' && prev !== 'active') {
        ping('foreground');
      }
    });

    // на событие аутентификации
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      log('auth event:', event, !!session?.user?.id ? 'has user' : 'no user');
      // сбрасываем троттлинг, чтобы сразу отправить свежий last_seen после логина
      lastSentAtRef.current = 0;
      if (session?.user?.id) ping('auth');
    });

    return () => {
      log('cleanup');
      try { sub?.remove?.(); } catch {}
      try { authSub?.subscription?.unsubscribe?.(); } catch {}
      clearInterval(timer);
      mountedRef.current = false;
    };
  }, [minIntervalMs]);
}
