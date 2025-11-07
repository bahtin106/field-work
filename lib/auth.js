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
          await router.replace(redirect);
          return;
        }
        const mod = await import('expo-router');
        if (mod?.router?.replace) {
          await mod.router.replace(redirect);
          return;
        }
        if (mod?.router?.push) {
          await mod.router.push(redirect);
          return;
        }
        logger?.warn?.('No router available, cannot navigate');
      } catch (err) {
        logger?.warn?.('Navigation failed:', err?.message || err);
      }
    }, 500);
  } catch (e) {
    void e;
  }
}
