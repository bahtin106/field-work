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
    const { forceNavigate } = await import('./navigation');
    await forceNavigate(redirect);
  } catch (e) {
    logger?.warn?.('Navigation failed:', e?.message || e);
  }
}
