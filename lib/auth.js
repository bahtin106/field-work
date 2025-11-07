import logger from './logger';
import { emitLogout } from './logoutBus';
import { supabase } from './supabase';

// helper logout: performs signOut, clears provided react-query client and triggers router replace
export async function logout({ qc, router, redirect = '/(auth)/login' } = {}) {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    logger?.warn?.('supabase.signOut error:', e?.message || e);
  }

  try {
    // notify listeners immediately that we initiated logout
    try {
      emitLogout();
    } catch (e) {
      void e;
    }
  } catch (e) {
    void e;
  }

  try {
    // qc is optional (useQueryClient result). clear may be synchronous.
    if (qc && typeof qc.clear === 'function') {
      try {
        await qc.clear();
      } catch (e) {
        logger?.warn?.('qc.clear error in logout helper:', e?.message || e);
      }
    }
  } catch (e) {
    void e;
  }

  try {
    // schedule navigation slightly later to avoid race with navigation readiness
    globalThis?.setTimeout?.(async () => {
      try {
        if (router && typeof router.replace === 'function') {
          router.replace(redirect);
          return;
        }
        // fallback to importing global router from expo-router
        try {
          const mod = await import('expo-router');
          const grouter = mod?.router;
          if (grouter && typeof grouter.replace === 'function') {
            grouter.replace(redirect);
            return;
          }
        } catch (err) {
          logger?.warn?.('failed to import global router in logout helper:', err?.message || err);
        }
        logger?.warn?.('logout helper: no router available to replace to', redirect);
      } catch (err) {
        logger?.warn?.('router.replace failed in logout helper:', err?.message || err);
      }
    }, 60);
  } catch (e) {
    void e;
  }
}
