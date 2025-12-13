import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { globalCache } from '../lib/cache/DataCache';
import logger from '../lib/logger';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(undefined);

export function AuthProvider({ children, queryClient, persister }) {
  const [state, setState] = useState({
    isInitializing: true,
    isAuthenticated: false,
    user: null,
    profile: null,
    sessionVersion: 0,
  });

  const clearClientCaches = useCallback(async () => {
    try {
      queryClient?.clear?.();
    } catch (e) {
      logger?.warn?.('AuthProvider: queryClient.clear failed', e?.message || e);
    }
    try {
      persister?.removeClient?.();
    } catch (e) {
      logger?.warn?.('AuthProvider: persister.removeClient failed', e?.message || e);
    }
    try {
      globalCache.clear();
    } catch (e) {
      logger?.warn?.('AuthProvider: globalCache.clear failed', e?.message || e);
    }
  }, [queryClient, persister]);

  const fetchProfileRecord = useCallback(async (userId, opts = { ensure: true }) => {
    if (!userId) return { profile: null, lookupColumn: null };
    const selectColumns =
      'id, user_id, first_name, last_name, full_name, role, avatar_url, company_id';
    const lookupColumns = ['id', 'user_id'];

    for (const column of lookupColumns) {
      const { data, error } = await supabase
        .from('profiles')
        .select(selectColumns)
        .eq(column, userId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (data) {
        return { profile: data, lookupColumn: column };
      }
    }

    if (!opts.ensure) {
      return { profile: null, lookupColumn: null };
    }

    const { data: created, error: upsertErr } = await supabase
      .from('profiles')
      .upsert(
        {
          id: userId,
          user_id: userId,
          role: 'worker',
          full_name: null,
        },
        { onConflict: 'id', ignoreDuplicates: false },
      )
      .select(selectColumns)
      .maybeSingle();
    if (upsertErr) throw upsertErr;
    return { profile: created || null, lookupColumn: created ? 'upsert' : null };
  }, []);

  const bootstrapSession = useCallback(
    async (session) => {
      console.log('AuthProvider: bootstrapSession called', { hasSession: !!session });
      setState((prev) => ({
        ...prev,
        isInitializing: true,
      }));

      const hasSession = !!session?.access_token;
      if (!hasSession) {
        console.log('AuthProvider: no session, clearing state');
        await clearClientCaches();
        setState((prev) => ({
          ...prev,
          isInitializing: false,
          isAuthenticated: false,
          user: null,
          profile: null,
          sessionVersion: prev.sessionVersion + 1,
        }));
        return;
      }

      await clearClientCaches();

      try {
        const { data: userRes } = await supabase.auth.getUser();
        const nextUser = userRes?.user || session.user || null;
        logger.debug('AuthProvider: resolved auth user', {
          nextUserId: nextUser?.id,
          nextUserEmail: nextUser?.email,
        });
        const { profile, lookupColumn } = await fetchProfileRecord(nextUser?.id);
        logger.debug('AuthProvider: profile lookup result', {
          userId: nextUser?.id,
          profileId: profile?.id,
          lookupColumn,
        });
        const isValidUser = !!nextUser && !!profile;
        console.log('AuthProvider: bootstrapSession decision', {
          userId: nextUser?.id,
          isValidUser,
          profileId: profile?.id,
          hasUser: !!nextUser,
          hasProfile: !!profile,
        });
        setState((prev) => ({
          ...prev,
          isInitializing: false,
          isAuthenticated: isValidUser,
          user: isValidUser ? nextUser : null,
          profile: isValidUser ? profile : null,
          sessionVersion: prev.sessionVersion + 1,
        }));
        logger.info('AuthProvider: bootstrapSession decision', {
          userId: nextUser?.id,
          isValidUser,
          profileId: profile?.id,
        });
        if (isValidUser) {
          queryClient?.resetQueries?.();
          queryClient?.invalidateQueries?.();
        }
      } catch (error) {
        console.error('AuthProvider: bootstrapSession error', error);
        logger?.warn?.('AuthProvider: bootstrapSession error', error?.message || error);
        setState((prev) => ({
          ...prev,
          isInitializing: false,
          isAuthenticated: false,
          user: null,
          profile: null,
          sessionVersion: prev.sessionVersion + 1,
        }));
      }
    },
    [clearClientCaches, fetchProfileRecord, queryClient],
  );

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      console.log('AuthProvider: loadSession started');
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        console.log('AuthProvider: getSession result', { hasSession: !!session, error });
        if (!active) return;

        if (error) {
          console.error('AuthProvider: getSession error', error);
          throw error;
        }

        await bootstrapSession(session);
      } catch (error) {
        console.error('AuthProvider: failed to load session', error);
        logger?.warn?.('AuthProvider: failed to load session', error?.message || error);
        if (active) {
          await clearClientCaches();
          setState((prev) => ({
            ...prev,
            isInitializing: false,
            isAuthenticated: false,
            user: null,
            profile: null,
            sessionVersion: prev.sessionVersion + 1,
          }));
        }
      }
    };

    loadSession();

    const { data: authSub } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('AuthProvider: onAuthStateChange', {
        event,
        hasSession: !!session,
        userId: session?.user?.id,
      });
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        console.log('AuthProvider: handling SIGNED_OUT');
        await bootstrapSession(null);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        console.log('AuthProvider: handling SIGNED_IN/TOKEN_REFRESHED');
        await bootstrapSession(session);
      }
    });

    return () => {
      active = false;
      authSub?.subscription?.unsubscribe?.();
    };
  }, [bootstrapSession, clearClientCaches]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      logger?.warn?.('AuthProvider: signOut error', error?.message || error);
    } finally {
      await bootstrapSession(null);
    }
  }, [bootstrapSession]);

  const value = useMemo(
    () => ({
      ...state,
      signOut,
    }),
    [state, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return ctx;
}
