import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { cleanupSessionRuntime } from '../lib/authSessionCleanup';
import { createLogger } from '../lib/logger';
import { readCurrentPushToken } from '../lib/pushAutoSetup';
import { supabase } from '../lib/supabase';
import { deletePushToken } from '../lib/supabaseHelpers';
import { queryClient } from '../src/shared/query/queryClient';
import { queryKeys } from '../src/shared/query/queryKeys';

const VALID_ROLES = new Set(['admin', 'dispatcher', 'worker']);
const PROFILE_COLUMNS =
  'id, first_name, middle_name, last_name, full_name, role, avatar_url, company_id, department_id';
const PROFILE_LOAD_TIMEOUT_MS = 8000;
const PROFILE_RECOVERY_ATTEMPTS = 4;
const PROFILE_RECOVERY_BASE_DELAY_MS = 1200;
const INVALID_REFRESH_TOKEN_RE = /invalid refresh token|refresh token.+already used/i;
const log = createLogger('SimpleAuth');

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
    middle_name: null,
    last_name: lastName,
    full_name: fullName,
    role: safeRole,
    avatar_url: metadata.avatar_url ?? null,
    avatar_display_url: metadata.avatar_url ?? null,
    company_id: metadata.company_id ?? null,
    department_id: null,
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
    middle_name: profile.middle_name ?? null,
    last_name: lastName,
    full_name: fullNameCandidate,
    role: safeRole,
    avatar_url: profile.avatar_url ?? null,
    avatar_display_url: profile.avatar_display_url ?? profile.avatar_url ?? null,
    company_id: profile.company_id ?? null,
    department_id: profile.department_id ?? null,
    __source: source,
  };
};

const AuthContext = createContext();

const isAbortLikeError = (error) => {
  if (!error) return false;
  const message = String(error?.message || '');
  return error?.name === 'AbortError' || /abort/i.test(message);
};

const isInvalidRefreshTokenError = (error) =>
  INVALID_REFRESH_TOKEN_RE.test(String(error?.message || error || ''));

const isNetworkRequestError = (error) => {
  if (!error) return false;
  const message = String(error?.message || error || '');
  const name = String(error?.name || '');
  return (
    /network request failed/i.test(message) ||
    /failed to fetch/i.test(message) ||
    /network error/i.test(message) ||
    /TypeError/i.test(name)
  );
};

const getCachedProfileSnapshot = () => {
  try {
    const cached = queryClient.getQueryData(queryKeys.profile.me());
    return cached && typeof cached === 'object' ? cached : null;
  } catch {
    return null;
  }
};

const normalizeScopeId = (value) => String(value || '').trim();

const hasProfileScopeChanged = (previousProfile, nextProfile, nextUserId) => {
  if (!previousProfile || !nextProfile) return false;

  const previousUserId = normalizeScopeId(previousProfile.id);
  const resolvedNextUserId = normalizeScopeId(nextProfile.id || nextUserId);
  if (previousUserId && resolvedNextUserId && previousUserId !== resolvedNextUserId) {
    return true;
  }

  const previousCompanyId = normalizeScopeId(previousProfile.company_id);
  const nextCompanyId = normalizeScopeId(nextProfile.company_id);
  return Boolean(previousCompanyId || nextCompanyId) && previousCompanyId !== nextCompanyId;
};

const tryBootstrapMyProfileFromAuth = async () => {
  try {
    const { error } = await supabase.rpc('bootstrap_my_profile_from_auth');
    if (error) {
      log.warn('bootstrap_my_profile_from_auth failed:', error);
      return false;
    }
    return true;
  } catch (error) {
    log.warn('bootstrap_my_profile_from_auth exception:', error);
    return false;
  }
};

const isSessionExpiredLikeError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('сессия истекла') || message.includes('session expired') || message.includes('no session');
};

export function SimpleAuthProvider({ children }) {
  const [state, setState] = useState({
    isInitializing: true,
    isAuthenticated: false,
    user: null,
    profile: null,
    profileError: null,
  });

  const authRequestIdRef = useRef(0);
  const profileRef = useRef(null);
  const currentUserIdRef = useRef(null);
  const initialSessionHandledRef = useRef(false);
  const logoutInProgressRef = useRef(false);
  const recoveryTimerRef = useRef(null);
  const recoveryJobIdRef = useRef(0);
  const profileLoadInFlightRef = useRef(new Map());

  useEffect(() => {
    profileRef.current = state.profile;
  }, [state.profile]);

  const debugLog = useCallback((...args) => {
    log.debug(...args);
  }, []);

  const getCachedProfileForUser = useCallback((userId) => {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) return null;

    const cached = queryClient.getQueryData(queryKeys.profile.me());
    if (cached && typeof cached === 'object' && String(cached.id || '') === normalizedUserId) {
      return normalizeProfileData(cached, null, 'query-cache');
    }

    return null;
  }, []);

  const rememberProfileSnapshot = useCallback((profile, expectedUserId = null) => {
    if (!profile?.id) return;
    const expectedScopeUserId = normalizeScopeId(expectedUserId || currentUserIdRef.current);
    if (expectedScopeUserId && normalizeScopeId(profile.id) !== expectedScopeUserId) {
      return;
    }
    queryClient.setQueryData(queryKeys.profile.me(), profile);
    if (profile.company_id) {
      queryClient.setQueryData(queryKeys.profile.companyId(), profile.company_id);
    }
  }, []);

  const clearProfileRecovery = useCallback(() => {
    recoveryJobIdRef.current += 1;
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const loadProfile = useCallback(
    async (user) => {
      const userId = user?.id;
      if (!userId) return null;

      const inFlight = profileLoadInFlightRef.current.get(userId);
      if (inFlight) return inFlight;

      const loadPromise = (async () => {
        debugLog('Loading profile for:', userId);
        const loadStartedAt = Date.now();

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), PROFILE_LOAD_TIMEOUT_MS);

          let data;
          let error;
          try {
            ({ data, error } = await supabase
              .from('profiles')
              .select(PROFILE_COLUMNS)
              .eq('id', userId)
              .abortSignal(controller.signal)
              .maybeSingle());
          } finally {
            clearTimeout(timeoutId);
          }

          if (error) {
            throw error;
          }

          if (!data) {
            debugLog('Profile missing, requesting server bootstrap...');
            await tryBootstrapMyProfileFromAuth();

            const { data: retriedProfile, error: retryError } = await supabase
              .from('profiles')
              .select(PROFILE_COLUMNS)
              .eq('id', userId)
              .maybeSingle();

            if (retryError) throw retryError;
            if (!retriedProfile) {
              throw new Error('profile-not-found-after-bootstrap');
            }
            const profile = normalizeProfileData(retriedProfile, user, 'bootstrap-rpc');
            rememberProfileSnapshot(profile, userId);
            return profile;
          }

          debugLog('Profile loaded:', data.role);
          const profile = normalizeProfileData(data, user, 'supabase');
          rememberProfileSnapshot(profile, userId);
          return profile;
        } catch (error) {
          const isTimeout = error?.message === 'profile-load-timeout' || isAbortLikeError(error);
          const isNetworkError = isNetworkRequestError(error);
          const elapsedMs = Date.now() - loadStartedAt;
          const isTimeoutLikeNetwork = isNetworkError && elapsedMs >= PROFILE_LOAD_TIMEOUT_MS - 300;

          if (isTimeout || isTimeoutLikeNetwork) {
            const cachedProfile = getCachedProfileForUser(userId);
            if (cachedProfile) return cachedProfile;
            log.warn('Profile load timed out');
            throw new Error('profile-load-timeout');
          } else if (isNetworkError) {
            const cachedProfile = getCachedProfileForUser(userId);
            if (cachedProfile) return cachedProfile;
            log.warn('Profile network error:', error);
            throw new Error('profile-load-network-error');
          } else if (isSessionExpiredLikeError(error)) {
            const cachedProfile = getCachedProfileForUser(userId);
            if (cachedProfile) return cachedProfile;
            throw new Error('profile-load-session-expired');
          } else {
            log.error('Profile error:', error);
            throw error;
          }
        } finally {
          profileLoadInFlightRef.current.delete(userId);
        }
      })();

      profileLoadInFlightRef.current.set(userId, loadPromise);
      return loadPromise;
    },
    [debugLog, getCachedProfileForUser, rememberProfileSnapshot],
  );

  const scheduleProfileRecovery = useCallback(
    (user) => {
      const userId = user?.id;
      if (!userId) return;

      clearProfileRecovery();
      const recoveryJobId = recoveryJobIdRef.current;
      let attempt = 0;

      const run = async () => {
        if (recoveryJobId !== recoveryJobIdRef.current) return;
        if (currentUserIdRef.current !== userId) return;

        attempt += 1;
        try {
          const profile = await loadProfile(user);
          if (recoveryJobId !== recoveryJobIdRef.current) return;
          if (currentUserIdRef.current !== userId) return;
          if (!profile) return;
          rememberProfileSnapshot(profile, userId);

          setState((prev) => {
            if (prev.user?.id !== userId) return prev;
            return {
              ...prev,
              profile,
              profileError: null,
            };
          });
          clearProfileRecovery();
        } catch {
          if (recoveryJobId !== recoveryJobIdRef.current) return;
          if (currentUserIdRef.current !== userId) return;
          if (attempt >= PROFILE_RECOVERY_ATTEMPTS) return;

          const delay = PROFILE_RECOVERY_BASE_DELAY_MS * 2 ** (attempt - 1);
          recoveryTimerRef.current = setTimeout(run, delay);
        }
      };

      recoveryTimerRef.current = setTimeout(run, PROFILE_RECOVERY_BASE_DELAY_MS);
    },
    [clearProfileRecovery, loadProfile, rememberProfileSnapshot],
  );

  const setSignedOutState = useCallback(() => {
    clearProfileRecovery();
    profileLoadInFlightRef.current.clear();
    authRequestIdRef.current += 1;
    currentUserIdRef.current = null;
    initialSessionHandledRef.current = false;
    profileRef.current = null;
    setState({
      isInitializing: false,
      isAuthenticated: false,
      user: null,
      profile: null,
      profileError: null,
    });
  }, [clearProfileRecovery]);

  const recoverFromInvalidRefreshToken = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {}

    setSignedOutState();
    await cleanupSessionRuntime('invalid-refresh-token');
  }, [setSignedOutState]);

  const handleAuthChange = useCallback(
    async (event, session) => {
      const user = session?.user ?? null;
      const nextUserId = user?.id ?? null;
      const hadUser = !!currentUserIdRef.current;
      const cachedProfileBeforeAuth = getCachedProfileSnapshot();
      let cacheClearedForAuthScope = false;

      if (event === 'SIGNED_IN') {
        logoutInProgressRef.current = false;
      }

      // During explicit logout, ignore all non-login auth events to prevent transient UI jumps.
      if (logoutInProgressRef.current && event !== 'SIGNED_IN') {
        return;
      }

      if (event === 'SIGNED_OUT' || !nextUserId) {
        setSignedOutState();
        if (event === 'SIGNED_OUT' || hadUser) {
          await cleanupSessionRuntime(event === 'SIGNED_OUT' ? 'signed-out' : 'session-missing');
        }
        return;
      }

      const userChanged = currentUserIdRef.current !== nextUserId;
      const cachedUserChanged =
        !!nextUserId &&
        !!cachedProfileBeforeAuth?.id &&
        normalizeScopeId(cachedProfileBeforeAuth.id) !== normalizeScopeId(nextUserId);
      if (userChanged || cachedUserChanged) {
        clearProfileRecovery();
        profileLoadInFlightRef.current.clear();
        currentUserIdRef.current = nextUserId;
        if (hadUser || cachedUserChanged) {
          await cleanupSessionRuntime(cachedUserChanged ? 'cached-user-changed' : 'user-changed');
          cacheClearedForAuthScope = true;
        }
      }

      const isNonBlockingSameUserEvent =
        !userChanged &&
        (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'SIGNED_IN');
      const shouldBlockUi = !isNonBlockingSameUserEvent;
      const hasCurrentProfile = profileRef.current?.id === nextUserId;

      if (isNonBlockingSameUserEvent && hasCurrentProfile) {
        setState((prev) => ({
          ...prev,
          isInitializing: false,
          isAuthenticated: true,
          user,
          profileError: null,
        }));
        return;
      }

      const requestId = ++authRequestIdRef.current;
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

        if (!cacheClearedForAuthScope && hasProfileScopeChanged(cachedProfileBeforeAuth, profile, nextUserId)) {
          await cleanupSessionRuntime('profile-scope-changed');
          rememberProfileSnapshot(profile, nextUserId);
          cacheClearedForAuthScope = true;
        }

        debugLog('Setting profile state:', {
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
      } catch (error) {
        if (requestId !== authRequestIdRef.current) return;
        const isTimeout = error?.message === 'profile-load-timeout';
        const isNetworkError = error?.message === 'profile-load-network-error';
        const hasExistingProfile = !!profileRef.current;

        if (!shouldBlockUi && hasExistingProfile) {
          setState((prev) => ({
            ...prev,
            isInitializing: prev.isInitializing,
            profileError: isTimeout
              ? 'refresh-timeout-using-current-profile'
              : isNetworkError
                ? 'refresh-network-error-using-current-profile'
                : 'refresh-error-using-current-profile',
          }));
          return;
        }

        const fallbackProfile = getCachedProfileForUser(nextUserId) || buildProfileFromUser(user, 'metadata-fallback');
        debugLog('Using fallback profile:', {
          role: fallbackProfile?.role,
          source: fallbackProfile?.__source,
        });

        setState((prev) => ({
          ...prev,
          isInitializing: shouldBlockUi ? false : prev.isInitializing,
          profile: fallbackProfile,
          profileError: isNetworkError ? 'network-error-using-fallback' : 'db-error-using-fallback',
        }));
        scheduleProfileRecovery(user);
      }
    },
    [
      clearProfileRecovery,
      debugLog,
      getCachedProfileForUser,
      loadProfile,
      rememberProfileSnapshot,
      scheduleProfileRecovery,
      setSignedOutState,
    ],
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
            log.warn(`getSession error (attempt ${attempt}/${MAX_ATTEMPTS})`, error);
            if (isInvalidRefreshTokenError(error)) {
              await recoverFromInvalidRefreshToken();
              return;
            }
            if (attempt === MAX_ATTEMPTS) {
              setSignedOutState();
            } else {
              await new Promise((r) => setTimeout(r, 1200));
            }
            continue;
          }

          if (!initialSessionHandledRef.current) {
            initialSessionHandledRef.current = true;
            await handleAuthChange('INITIAL_SESSION', session);
          }
          return;
        } catch (error) {
          log.warn(`initial session load error (attempt ${attempt}/${MAX_ATTEMPTS})`, error);
          if (!mounted) return;
          if (isInvalidRefreshTokenError(error)) {
            await recoverFromInvalidRefreshToken();
            return;
          }
          if (attempt === MAX_ATTEMPTS) {
            setSignedOutState();
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
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (initialSessionHandledRef.current) return;
        initialSessionHandledRef.current = true;
      }
      // Supabase auth callbacks must stay synchronous; deferring async work
      // avoids deadlocks with methods like auth.updateUser() in React Native.
      setTimeout(() => {
        handleAuthChange(event, session).catch((error) => {
          log.error('onAuthStateChange handler failed:', error);
        });
      }, 0);
    });

    return () => {
      mounted = false;
      clearProfileRecovery();
      clearTimeout(fallbackTimeout);
      subscription?.unsubscribe?.();
    };
  }, [
    clearProfileRecovery,
    handleAuthChange,
    recoverFromInvalidRefreshToken,
    setSignedOutState,
  ]);

  const signOut = useCallback(async () => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;

    const currentUserId = state.user?.id || null;
    setSignedOutState();
    await cleanupSessionRuntime('sign-out');

    try {
      if (currentUserId) {
        try {
          const { token } = await readCurrentPushToken();
          if (token) {
            await deletePushToken(currentUserId, { pushToken: token, disableNotifications: false });
          }
        } catch {}
      }
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      log.error('signOut error', error);
    }
  }, [setSignedOutState, state.user?.id]);

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
