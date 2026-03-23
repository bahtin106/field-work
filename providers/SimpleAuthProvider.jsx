import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { cleanupSessionRuntime } from '../lib/authSessionCleanup';
import { readCurrentPushToken } from '../lib/pushAutoSetup';
import { supabase } from '../lib/supabase';
import { deletePushToken } from '../lib/supabaseHelpers';
import { inspectProfileMedia } from '../src/features/profileMedia/api';

const VALID_ROLES = new Set(['admin', 'dispatcher', 'worker']);
const PROFILE_COLUMNS = 'id, first_name, last_name, full_name, role, avatar_url, company_id';
const PROFILE_LOAD_TIMEOUT_MS = 8000;
const PROFILE_RECOVERY_ATTEMPTS = 4;
const PROFILE_RECOVERY_BASE_DELAY_MS = 1200;
const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
const INVALID_REFRESH_TOKEN_RE = /invalid refresh token|refresh token.+already used/i;

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
    avatar_display_url: metadata.avatar_url ?? null,
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
    avatar_display_url: profile.avatar_display_url ?? profile.avatar_url ?? null,
    company_id: profile.company_id ?? null,
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

const isUserIdColumnMissingError = (error) => {
  if (!error) return false;
  const message = String(error?.message || '');
  return error?.code === '42703' || /user_id/i.test(message);
};

const isDuplicateProfileError = (error) => {
  if (!error) return false;
  const message = String(error?.message || '');
  return error?.code === '23505' || /duplicate key/i.test(message);
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
  const recoveryTimerRef = useRef(null);
  const recoveryJobIdRef = useRef(0);

  useEffect(() => {
    profileRef.current = state.profile;
  }, [state.profile]);

  const debugLog = useCallback((...args) => {
    if (IS_DEV) console.debug(...args);
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

      debugLog('[SimpleAuth] Loading profile for:', userId);

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
          debugLog('[SimpleAuth] Creating new profile...');
          const insertPayloads = [
            { id: userId, user_id: userId, role: 'worker' },
            { id: userId, role: 'worker' },
          ];
          let createdProfile = null;
          let createError = null;

          for (const payload of insertPayloads) {
            const { data: created, error: createErr } = await supabase
              .from('profiles')
              .insert(payload)
              .select(PROFILE_COLUMNS)
              .maybeSingle();

            if (!createErr) {
              createdProfile = created;
              break;
            }

            if (isUserIdColumnMissingError(createErr) && 'user_id' in payload) {
              createError = createErr;
              continue;
            }

            if (isDuplicateProfileError(createErr)) {
              createError = createErr;
              break;
            }

            createError = createErr;
            break;
          }

          if (!createdProfile && isDuplicateProfileError(createError)) {
            const { data: existingProfile, error: refetchError } = await supabase
              .from('profiles')
              .select(PROFILE_COLUMNS)
              .eq('id', userId)
              .maybeSingle();

            if (refetchError) {
              throw refetchError;
            }
            createdProfile = existingProfile;
          }

          if (!createdProfile) {
            throw createError || new Error('profile-create-failed');
          }

          return normalizeProfileData(createdProfile, user, 'created');
        }

        debugLog('[SimpleAuth] Profile loaded:', data.role);
        let safeData = data;
        try {
          const avatarUrl = String(data?.avatar_url || '').trim();
          const { cleanedUrls, resolvedUrls } = await inspectProfileMedia([avatarUrl].filter(Boolean));
          safeData = cleanedUrls.includes(avatarUrl)
            ? { ...data, avatar_url: null, avatar_display_url: null }
            : {
                ...data,
                avatar_display_url: resolvedUrls[avatarUrl] || data?.avatar_url || null,
              };
        } catch (profileMediaError) {
          console.warn('[SimpleAuth] Profile media inspect skipped:', profileMediaError);
        }
        return normalizeProfileData(safeData, user, 'supabase');
      } catch (error) {
        const isTimeout = error?.message === 'profile-load-timeout' || isAbortLikeError(error);
        if (isTimeout) {
          console.warn('[SimpleAuth] Profile load timed out');
          throw new Error('profile-load-timeout');
        } else {
          console.error('[SimpleAuth] Profile error:', error);
          throw error;
        }
      }
    },
    [debugLog],
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
    [clearProfileRecovery, loadProfile],
  );

  const setSignedOutState = useCallback(() => {
    clearProfileRecovery();
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

      if (event === 'SIGNED_OUT' || !nextUserId) {
        setSignedOutState();
        if (event === 'SIGNED_OUT' || hadUser) {
          await cleanupSessionRuntime(event === 'SIGNED_OUT' ? 'signed-out' : 'session-missing');
        }
        return;
      }

      const userChanged = currentUserIdRef.current !== nextUserId;
      if (userChanged) {
        clearProfileRecovery();
        currentUserIdRef.current = nextUserId;
        await cleanupSessionRuntime('user-changed');
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

        debugLog('[SimpleAuth] Setting profile state:', {
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
        const hasExistingProfile = !!profileRef.current;

        if (!shouldBlockUi && hasExistingProfile) {
          setState((prev) => ({
            ...prev,
            isInitializing: prev.isInitializing,
            profileError: isTimeout ? 'refresh-timeout-using-current-profile' : 'refresh-error-using-current-profile',
          }));
          return;
        }

        const fallbackProfile = buildProfileFromUser(user, 'metadata-fallback');
        debugLog('[SimpleAuth] Using fallback profile:', {
          role: fallbackProfile?.role,
          source: fallbackProfile?.__source,
        });

        setState((prev) => ({
          ...prev,
          isInitializing: shouldBlockUi ? false : prev.isInitializing,
          profile: fallbackProfile,
          profileError: 'db-error-using-fallback',
        }));
        scheduleProfileRecovery(user);
      }
    },
    [clearProfileRecovery, debugLog, loadProfile, scheduleProfileRecovery, setSignedOutState],
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
          console.warn(
            'SimpleAuth: initial session load error (attempt %s/%s)',
            attempt,
            MAX_ATTEMPTS,
            error,
          );
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
          console.error('[SimpleAuth] onAuthStateChange handler failed:', error);
        });
      }, 0);
    });

    return () => {
      mounted = false;
      clearProfileRecovery();
      clearTimeout(fallbackTimeout);
      subscription?.unsubscribe?.();
    };
  }, [clearProfileRecovery, handleAuthChange, recoverFromInvalidRefreshToken, setSignedOutState]);

  const signOut = useCallback(async () => {
    const currentUserId = state.user?.id || null;
    try {
      if (currentUserId) {
        try {
          const { token } = await readCurrentPushToken();
          if (token) {
            await deletePushToken(currentUserId, { pushToken: token, disableNotifications: false });
          }
        } catch {}
      }
      await supabase.auth.signOut();
    } catch (error) {
      console.error('SimpleAuth: signOut error', error);
    } finally {
      setSignedOutState();
      await cleanupSessionRuntime('sign-out');
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
