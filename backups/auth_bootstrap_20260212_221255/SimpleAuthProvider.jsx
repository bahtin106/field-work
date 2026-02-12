import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { bumpSessionEpoch } from '../lib/sessionEpoch';
import { supabase } from '../lib/supabase';

const VALID_ROLES = new Set(['admin', 'dispatcher', 'worker']);
const PROFILE_COLUMNS = 'id, first_name, last_name, full_name, role, avatar_url, company_id';
const PROFILE_LOAD_TIMEOUT_MS = 8000;

const buildProfileFromUser = (user, source = 'user-metadata') => {
  if (!user?.id) return null;
  const metadata = user.user_metadata || {};
  const firstName = metadata.first_name ?? null;
  const lastName = metadata.last_name ?? null;
  const fullNameFromMeta = metadata.full_name || [firstName, lastName].filter(Boolean).join(' ');
  const fullName = fullNameFromMeta || user.email || '';
  const rawRole = typeof metadata.role === 'string' ? metadata.role : null;
  const safeRole = VALID_ROLES.has(rawRole) ? rawRole : 'worker';

  return {
    id: user.id,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    role: safeRole,
    avatar_url: metadata.avatar_url ?? null,
    company_id: metadata.company_id ?? null,
    __source: source,
  };
};

const normalizeProfileData = (profile, fallbackUser, source = 'supabase') => {
  if (!profile && !fallbackUser) return null;
  if (!profile) return buildProfileFromUser(fallbackUser, source);

  const safeRole = VALID_ROLES.has(profile.role) ? profile.role : 'worker';
  const firstName = profile.first_name ?? null;
  const lastName = profile.last_name ?? null;
  const fullNameCandidate =
    profile.full_name ||
    [firstName, lastName].filter(Boolean).join(' ') ||
    fallbackUser?.email ||
    '';

  return {
    id: profile.id ?? fallbackUser?.id ?? null,
    first_name: firstName,
    last_name: lastName,
    full_name: fullNameCandidate,
    role: safeRole,
    avatar_url: profile.avatar_url ?? null,
    company_id: profile.company_id ?? null,
    __source: source,
  };
};

const AuthContext = createContext();

export function SimpleAuthProvider({ children }) {
  const [state, setState] = useState({
    isInitializing: true,
    isAuthenticated: false,
    user: null,
    profile: null,
    profileError: null,
  });

  const profileRetryRef = useRef(null);
  const authRequestIdRef = useRef(0);
  const lastInitialSessionUserIdRef = useRef(null);

  const loadProfile = useCallback(async (user) => {
    const userId = user?.id;
    if (!userId) return null;

    console.log('[SimpleAuth] Loading profile for:', userId);

    try {
      const profileQuery = supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('profile-load-timeout')), PROFILE_LOAD_TIMEOUT_MS),
      );
      const { data, error } = await Promise.race([profileQuery, timeoutPromise]);

      if (error) {
        if (error.code === 'PGRST116') {
          console.log('[SimpleAuth] Creating new profile...');
          const { data: created, error: createErr } = await supabase
            .from('profiles')
            .insert({ id: userId, user_id: userId, role: 'worker' })
            .select(PROFILE_COLUMNS)
            .single();

          if (createErr) {
            console.error('[SimpleAuth] Create error:', createErr);
            throw createErr;
          }
          return normalizeProfileData(created, user, 'created');
        }
        throw error;
      }

      console.log('[SimpleAuth] Profile loaded:', data.role);
      return normalizeProfileData(data, user, 'supabase');
    } catch (error) {
      const isTimeout = error?.message === 'profile-load-timeout';
      if (isTimeout) {
        console.warn('[SimpleAuth] Profile load timed out');
      } else {
        console.error('[SimpleAuth] Profile error:', error);
      }
      throw error;
    }
  }, []);

  const clearProfileRetry = useCallback(() => {
    if (profileRetryRef.current) {
      clearTimeout(profileRetryRef.current);
      profileRetryRef.current = null;
    }
  }, []);

  const scheduleProfileRetry = useCallback(
    (user, attempt = 1) => {
      if (!user?.id) return;
      clearProfileRetry();
      return;
    },
    [clearProfileRetry],
  );

  const handleAuthChange = useCallback(
    async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        clearProfileRetry();
        setState({
          isInitializing: false,
          isAuthenticated: false,
          user: null,
          profile: null,
          profileError: null,
        });
        bumpSessionEpoch();
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        const user = session.user;
        if (!user?.id) {
          setState({
            isInitializing: false,
            isAuthenticated: false,
            user: null,
            profile: null,
            profileError: null,
          });
          return;
        }

        if (event === 'INITIAL_SESSION' && lastInitialSessionUserIdRef.current === user.id) {
          return;
        }
        if (event === 'INITIAL_SESSION') {
          lastInitialSessionUserIdRef.current = user.id;
        }

        console.log('[SimpleAuth] Auth event:', event);

        const requestId = ++authRequestIdRef.current;
        const shouldBlockUi = event !== 'TOKEN_REFRESHED';

        setState((prev) => ({
          isInitializing: shouldBlockUi ? true : prev.isInitializing,
          isAuthenticated: true,
          user,
          profile: shouldBlockUi ? null : prev.profile,
          profileError: null,
        }));

        try {
          const profile = await loadProfile(user);
          if (requestId !== authRequestIdRef.current) return;

          console.log('[SimpleAuth] Setting profile state:', {
            hasProfile: !!profile,
            role: profile?.role,
            source: profile?.__source,
          });

          setState((prev) => ({
            ...prev,
            isInitializing: shouldBlockUi ? false : prev.isInitializing,
            profile,
            profileError: profile ? null : 'load-failed',
          }));

          if (profile) {
            console.log('[SimpleAuth] Profile loaded, role:', profile.role);
          }
        } catch (error) {
          if (requestId !== authRequestIdRef.current) return;
          const isTimeout = error?.message === 'profile-load-timeout';
          const hasExistingProfile = !!state.profile;

          if (isTimeout) {
            console.warn('[SimpleAuth] Profile load timeout during auth sync');
          } else {
            console.error('[SimpleAuth] Profile load failed, using fallback from metadata:', error?.message);
          }

          if (!shouldBlockUi && hasExistingProfile) {
            setState((prev) => ({
              ...prev,
              isInitializing: prev.isInitializing,
              profileError: isTimeout ? 'refresh-timeout-using-current-profile' : 'refresh-error-using-current-profile',
            }));
            bumpSessionEpoch();
            return;
          }

          const fallbackProfile = buildProfileFromUser(user, 'metadata-fallback');
          console.log('[SimpleAuth] Using fallback profile:', {
            role: fallbackProfile?.role,
            source: fallbackProfile?.__source,
          });

          setState((prev) => ({
            ...prev,
            isInitializing: shouldBlockUi ? false : prev.isInitializing,
            profile: fallbackProfile,
            profileError: 'db-error-using-fallback',
          }));
        }

        bumpSessionEpoch();
        return;
      }

      setState((prev) => ({
        ...prev,
        isInitializing: false,
      }));
    },
    [loadProfile, clearProfileRetry, state.profile],
  );

  useEffect(() => {
    let mounted = true;

    const loadInitialSession = async () => {
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const {
            data: { session },
            error,
          } = await supabase.auth.getSession();

          if (!mounted) return;

          if (error) {
            console.warn('SimpleAuth: getSession error (attempt %s/%s)', attempt, MAX_ATTEMPTS, error);
            if (attempt === MAX_ATTEMPTS) {
              setState({
                isInitializing: false,
                isAuthenticated: false,
                user: null,
                profile: null,
                profileError: null,
              });
            } else {
              await new Promise((r) => setTimeout(r, 1200));
            }
            continue;
          }

          await handleAuthChange('INITIAL_SESSION', session);
          return;
        } catch (error) {
          console.warn(
            'SimpleAuth: initial session load error (attempt %s/%s)',
            attempt,
            MAX_ATTEMPTS,
            error,
          );
          if (!mounted) return;
          if (attempt === MAX_ATTEMPTS) {
            setState({
              isInitializing: false,
              isAuthenticated: false,
              user: null,
              profile: null,
              profileError: null,
            });
          } else {
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
      }
    };

    loadInitialSession();

    const fallbackTimeout = setTimeout(() => {
      if (mounted) {
        setState((prev) => ({
          ...prev,
          isInitializing: false,
        }));
      }
    }, 3000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(handleAuthChange);

    return () => {
      mounted = false;
      clearTimeout(fallbackTimeout);
      clearProfileRetry();
      subscription?.unsubscribe();
    };
  }, [handleAuthChange, clearProfileRetry]);

  const signOut = useCallback(async () => {
    try {
      clearProfileRetry();
      await supabase.auth.signOut();
    } catch (error) {
      console.error('SimpleAuth: signOut error', error);
      setState({
        isInitializing: false,
        isAuthenticated: false,
        user: null,
        profile: null,
        profileError: null,
      });
    }
  }, [clearProfileRetry]);

  const value = {
    ...state,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within SimpleAuthProvider');
  }
  return context;
}
