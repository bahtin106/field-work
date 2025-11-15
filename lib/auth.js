import logger from './logger';
import { emitLogout } from './logoutBus';
import { supabase } from './supabase';

// helper logout: performs signOut, clears provided react-query client
// Navigation is handled by _layout.js onAuthStateChange (SIGNED_OUT event)
export async function logout({ qc } = {}) {
  logger?.warn?.('🚪 logout: Starting logout process...');

  try {
    // Notify listeners immediately that we initiated logout
    try {
      emitLogout();
      logger?.warn?.('✅ logout: Logout event emitted');
    } catch (e) {
      logger?.warn?.('emitLogout error:', e?.message || e);
    }
  } catch (e) {
    void e;
  }

  try {
    // Clear query client cache first
    if (qc && typeof qc.clear === 'function') {
      try {
        await qc.clear();
        logger?.warn?.('✅ logout: Query client cleared');
      } catch (e) {
        logger?.warn?.('qc.clear error in logout helper:', e?.message || e);
      }
    }
  } catch (e) {
    void e;
  }

  try {
    // Sign out from Supabase - this will trigger SIGNED_OUT event
    await supabase.auth.signOut();
    logger?.warn?.('✅ logout: Supabase signOut completed');
  } catch (e) {
    logger?.warn?.('⚠️ supabase.signOut error:', e?.message || e);
  }

  logger?.warn?.('✅ logout: Logout process completed');
  // Navigation after logout is now handled by _layout.js onAuthStateChange (SIGNED_OUT event)
}
