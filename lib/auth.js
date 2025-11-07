import logger from './logger';
import { supabase } from './supabase';

// helper logout: performs signOut, clears provided react-query client and triggers router replace
export async function logout({ qc, router, redirect = '/(auth)/login' } = {}) {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    logger?.warn?.('supabase.signOut error:', e?.message || e);
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
    globalThis?.setTimeout?.(() => {
      try {
        router?.replace?.(redirect);
      } catch (err) {
        logger?.warn?.('router.replace failed in logout helper:', err?.message || err);
      }
    }, 60);
  } catch (e) {
    void e;
  }
}
