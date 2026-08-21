import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useIsRestoring } from '@tanstack/react-query';
import { cleanupSessionRuntime } from '../lib/authSessionCleanup';
import { createLogger } from '../lib/logger';
import { formatPersonNameParts } from '../lib/personName';
import { readCurrentPushToken } from '../lib/pushAutoSetup';
import {
  clearPersistedAuthSession,
  readPersistedAuthSession,
  supabase,
} from '../lib/supabase';
import { deletePushToken } from '../lib/supabaseHelpers';
import {
  clearActiveQueryCacheOwner,
  getActiveQueryCacheOwner,
  queryClient,
  setActiveQueryCacheOwner,
} from '../src/shared/query/queryClient';
import { queryKeys } from '../src/shared/query/queryKeys';
import {
  clearActiveOfflineOwner,
  getOfflineSnapshot,
  setActiveOfflineOwner,
  setOfflineNetState,
} from '../src/shared/offline/offlineStatus';

const VALID_ROLES = new Set(['admin', 'dispatcher', 'worker']);
const PROFILE_COLUMNS =
  'id, first_name, middle_name, last_name, full_name, role, avatar_url, company_id, department_id';
const PROFILE_UI_WAIT_TIMEOUT_MS = 4000;
const PROFILE_REQUEST_TIMEOUT_MS = 12000;
const PROFILE_RECOVERY_ATTEMPTS = 4;
const PROFILE_RECOVERY_BASE_DELAY_MS = 1200;
const PROFILE_RECOVERY_NETWORK_POLL_MS = 5000;
const LOCAL_SESSION_READ_WAIT_MS = 1500;
const AUTH_SDK_SESSION_WAIT_MS = 8000;
const SIGN_OUT_SESSION_TIMEOUT_MS = 1000;
const SIGN_OUT_PUSH_TIMEOUT_MS = 1200;
const SIGN_OUT_AUTH_TIMEOUT_MS = 2000;
const INVALID_REFRESH_TOKEN_RE = /invalid refresh token|refresh token.+already used/i;
const log = createLogger('SimpleAuth');

const settleWithin = async (promise, timeoutMs) => {
  let timeoutId;
  const timeoutResult = Symbol('timeout');
  try {
    const result = await Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(timeoutResult), timeoutMs);
      }),
    ]);
    return result === timeoutResult ? { timedOut: true, value: null } : { timedOut: false, value: result };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const buildProfileFromUser = (user, source = 'user-metadata') => {
  if (!user?.id) return null;
  const metadata = user.user_metadata || {};
  const firstName = metadata.first_name ?? null;
  const middleName = metadata.middle_name ?? null;
  const lastName = metadata.last_name ?? null;
  const fullNameFromMeta = formatPersonNameParts({ firstName, middleName, lastName }) || metadata.full_name;
  const fullName = fullNameFromMeta || user.email || '';
  // user_metadata is user-editable identity metadata, not an authorization
  // source. Until the authoritative profiles row is available, fail closed to
  // the least-privileged role while still allowing cached UI to paint.
  const safeRole = 'worker';

  return {
    id: user.id,
    first_name: firstName,
    middle_name: middleName,
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
  const middleName = profile.middle_name ?? null;
  const lastName = profile.last_name ?? null;
  const fullNameCandidate =
    formatPersonNameParts({ firstName, middleName, lastName }) ||
    profile.full_name ||
    fallbackUser?.email ||
    '';

  return {
    id: profile.id ?? fallbackUser?.id ?? null,
    first_name: firstName,
    middle_name: middleName,
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

const isAuthSessionMissingError = (error) => {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  return name.includes('authsessionmissingerror') || message.includes('auth session missing');
};

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
  const companyChanged =
    Boolean(previousCompanyId || nextCompanyId) && previousCompanyId !== nextCompanyId;
  const previousRole = VALID_ROLES.has(previousProfile.role) ? previousProfile.role : '';
  const nextRole = VALID_ROLES.has(nextProfile.role) ? nextProfile.role : '';
  const roleChanged =
    Boolean(previousRole || nextRole) && previousRole !== nextRole;
  return companyChanged || roleChanged;
};

const hasQueryCacheOwnerScopeChanged = (cacheOwner, nextProfile, nextUserId) => {
  if (!cacheOwner || !nextProfile) return false;
  const resolvedNextUserId = normalizeScopeId(nextProfile.id || nextUserId);
  if (normalizeScopeId(cacheOwner.userId) !== resolvedNextUserId) return true;

  const previousCompanyId = normalizeScopeId(cacheOwner.companyId);
  const nextCompanyId = normalizeScopeId(nextProfile.company_id);
  return Boolean(previousCompanyId || nextCompanyId) && previousCompanyId !== nextCompanyId;
};

const hasAuthMetadataCompanyScopeChanged = ({
  cacheOwner,
  cachedProfile,
  currentProfile,
  nextUserId,
  metadataCompanyId,
}) => {
  const resolvedUserId = normalizeScopeId(nextUserId);
  const resolvedMetadataCompanyId = normalizeScopeId(metadataCompanyId);
  if (!resolvedUserId || !resolvedMetadataCompanyId) return false;

  const previousCompanyScopes = [];
  if (normalizeScopeId(cacheOwner?.userId) === resolvedUserId) {
    previousCompanyScopes.push(normalizeScopeId(cacheOwner?.companyId));
  }
  if (normalizeScopeId(cachedProfile?.id) === resolvedUserId) {
    previousCompanyScopes.push(normalizeScopeId(cachedProfile?.company_id));
  }
  if (normalizeScopeId(currentProfile?.id) === resolvedUserId) {
    previousCompanyScopes.push(normalizeScopeId(currentProfile?.company_id));
  }

  return previousCompanyScopes.some(
    (previousCompanyId) => previousCompanyId !== resolvedMetadataCompanyId,
  );
};

const mergeProfileForCache = (previous, next) => {
  if (!previous || typeof previous !== 'object') return next;
  if (!next || typeof next !== 'object') return next;
  if (normalizeScopeId(previous.id) !== normalizeScopeId(next.id)) return next;

  const previousAvatarUrl = normalizeScopeId(previous.avatar_url);
  const nextAvatarUrl = normalizeScopeId(next.avatar_url);
  const previousDisplayUrl = normalizeScopeId(previous.avatar_display_url || previous.avatarDisplayUrl);
  const nextDisplayUrl = normalizeScopeId(next.avatar_display_url || next.avatarDisplayUrl);
  const shouldKeepResolvedAvatar =
    previousAvatarUrl &&
    previousAvatarUrl === nextAvatarUrl &&
    previousDisplayUrl &&
    (!nextDisplayUrl || nextDisplayUrl === nextAvatarUrl);

  return {
    ...previous,
    ...next,
    ...(shouldKeepResolvedAvatar ? { avatar_display_url: previousDisplayUrl } : null),
  };
};

const PROFILE_STATE_FIELDS = [
  'id',
  'first_name',
  'middle_name',
  'last_name',
  'full_name',
  'role',
  'avatar_url',
  'avatar_display_url',
  'company_id',
  'department_id',
  '__source',
];

const areProfileSnapshotsEqual = (left, right) =>
  Boolean(
    left &&
      right &&
      PROFILE_STATE_FIELDS.every(
        (key) => String(left?.[key] ?? '') === String(right?.[key] ?? ''),
      ),
  );

const tryBootstrapMyProfileFromAuth = async (signal) => {
  try {
    const request = supabase.rpc('bootstrap_my_profile_from_auth');
    const { error } = await (signal ? request.abortSignal(signal) : request);
    if (error) {
      if (isAbortLikeError(error)) throw error;
      if (isAuthSessionMissingError(error)) return false;
      log.warn('bootstrap_my_profile_from_auth failed:', error);
      return false;
    }
    return true;
  } catch (error) {
    if (isAbortLikeError(error)) throw error;
    if (isAuthSessionMissingError(error)) return false;
    log.warn('bootstrap_my_profile_from_auth exception:', error);
    return false;
  }
};

const isSessionExpiredLikeError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    isAuthSessionMissingError(error) ||
    message.includes('сессия истекла') ||
    message.includes('session expired') ||
    message.includes('no session')
  );
};

export function SimpleAuthProvider({ children }) {
  const isRestoringQueryCache = useIsRestoring();
  const [queryCacheBootstrapReady, setQueryCacheBootstrapReady] = useState(false);
  const [state, setState] = useState({
    isInitializing: true,
    isSigningOut: false,
    isAuthenticated: false,
    user: null,
    profile: null,
    profileError: null,
  });

  const authRequestIdRef = useRef(0);
  const authEventGenerationRef = useRef(0);
  const profileRef = useRef(null);
  const currentUserIdRef = useRef(null);
  const initialSessionHandledRef = useRef(false);
  const logoutInProgressRef = useRef(false);
  const signedOutSettledRef = useRef(false);
  const explicitlySignedOutUserIdRef = useRef(null);
  const recoveryTimerRef = useRef(null);
  const recoveryJobIdRef = useRef(0);
  const profileLoadInFlightRef = useRef(new Map());
  const profileAbortControllersRef = useRef(new Map());

  useEffect(() => {
    const marker = '__MONITOR_AUTH_PROVIDER_MOUNT_COUNT__';
    globalThis[marker] = Number(globalThis[marker] || 0) + 1;
    return () => {
      globalThis[marker] = Math.max(0, Number(globalThis[marker] || 1) - 1);
    };
  }, []);

  useEffect(() => {
    if (queryCacheBootstrapReady) return undefined;
    if (!isRestoringQueryCache) {
      setQueryCacheBootstrapReady(true);
    }
    return undefined;
  }, [isRestoringQueryCache, queryCacheBootstrapReady]);

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
    setActiveQueryCacheOwner({
      userId: profile.id,
      companyId: profile.company_id || null,
    });
    if (profile.company_id) {
      setActiveOfflineOwner({ userId: profile.id, companyId: profile.company_id });
    } else {
      clearActiveOfflineOwner();
    }
    queryClient.setQueryData(queryKeys.profile.me(), (previous) => mergeProfileForCache(previous, profile));
    queryClient.setQueryData(['profile', profile.id], (previous) => mergeProfileForCache(previous, profile));
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), PROFILE_REQUEST_TIMEOUT_MS);
        profileAbortControllersRef.current.set(userId, controller);

        try {
          const { data, error } = await supabase
            .from('profiles')
            .select(PROFILE_COLUMNS)
            .eq('id', userId)
            .abortSignal(controller.signal)
            .maybeSingle();

          if (error) {
            throw error;
          }

          if (!data) {
            if (logoutInProgressRef.current || currentUserIdRef.current !== userId) return null;
            debugLog('Profile missing, requesting server bootstrap...');
            await tryBootstrapMyProfileFromAuth(controller.signal);
            if (logoutInProgressRef.current || currentUserIdRef.current !== userId) return null;

            const { data: retriedProfile, error: retryError } = await supabase
              .from('profiles')
              .select(PROFILE_COLUMNS)
              .eq('id', userId)
              .abortSignal(controller.signal)
              .maybeSingle();

            if (retryError) throw retryError;
            if (!retriedProfile) {
              throw new Error('profile-not-found-after-bootstrap');
            }
            return normalizeProfileData(retriedProfile, user, 'bootstrap-rpc');
          }

          debugLog('Profile loaded:', data.role);
          return normalizeProfileData(data, user, 'supabase');
        } catch (error) {
          const isTimeout = error?.message === 'profile-load-timeout' || isAbortLikeError(error);
          const isNetworkError = isNetworkRequestError(error);
          const elapsedMs = Date.now() - loadStartedAt;
          const isTimeoutLikeNetwork = isNetworkError && elapsedMs >= PROFILE_REQUEST_TIMEOUT_MS - 300;

          if (isTimeout || isTimeoutLikeNetwork) {
            debugLog('Profile request timed out; recovery will retry', { elapsedMs });
            throw new Error('profile-load-timeout');
          } else if (isNetworkError) {
            log.warn('Profile network error:', error);
            throw new Error('profile-load-network-error');
          } else if (isSessionExpiredLikeError(error)) {
            throw new Error('profile-load-session-expired');
          } else {
            log.error('Profile error:', error);
            throw error;
          }
        } finally {
          clearTimeout(timeoutId);
          if (profileAbortControllersRef.current.get(userId) === controller) {
            profileLoadInFlightRef.current.delete(userId);
            profileAbortControllersRef.current.delete(userId);
          }
        }
      })();

      profileLoadInFlightRef.current.set(userId, loadPromise);
      return loadPromise;
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

        const networkSnapshot = getOfflineSnapshot();
        const canRecoverFromNetwork =
          networkSnapshot.isNetworkKnown &&
          networkSnapshot.isOnline &&
          !networkSnapshot.isPoorConnection;
        if (!canRecoverFromNetwork) {
          recoveryTimerRef.current = setTimeout(run, PROFILE_RECOVERY_NETWORK_POLL_MS);
          return;
        }

        attempt += 1;
        try {
          const profile = await loadProfile(user);
          if (recoveryJobId !== recoveryJobIdRef.current) return;
          if (currentUserIdRef.current !== userId) return;
          if (!profile) return;
          const previousProfile = profileRef.current || getCachedProfileSnapshot();
          if (
            hasProfileScopeChanged(previousProfile, profile, userId) ||
            hasQueryCacheOwnerScopeChanged(getActiveQueryCacheOwner(), profile, userId)
          ) {
            await cleanupSessionRuntime('profile-recovery-scope-changed');
            if (recoveryJobId !== recoveryJobIdRef.current) return;
            if (currentUserIdRef.current !== userId) return;
          }
          rememberProfileSnapshot(profile, userId);

          setState((prev) => {
            if (prev.user?.id !== userId) return prev;
            return {
              ...prev,
              isInitializing: false,
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

  const refreshProfile = useCallback(
    async ({ reason = 'manual-profile-refresh' } = {}) => {
      const user = state.user;
      const userId = normalizeScopeId(user?.id || currentUserIdRef.current);
      if (!user?.id || !userId || logoutInProgressRef.current) return null;
      const authEventGeneration = authEventGenerationRef.current;

      const profile = await loadProfile(user);
      if (!profile) return null;
      if (
        logoutInProgressRef.current ||
        authEventGeneration !== authEventGenerationRef.current ||
        normalizeScopeId(currentUserIdRef.current) !== userId
      ) {
        return null;
      }

      const previousProfile = profileRef.current || getCachedProfileSnapshot();
      if (
        hasProfileScopeChanged(previousProfile, profile, userId) ||
        hasQueryCacheOwnerScopeChanged(getActiveQueryCacheOwner(), profile, userId)
      ) {
        await cleanupSessionRuntime(`${reason}-scope-changed`);
        if (
          logoutInProgressRef.current ||
          authEventGeneration !== authEventGenerationRef.current ||
          normalizeScopeId(currentUserIdRef.current) !== userId
        ) {
          return null;
        }
      }

      rememberProfileSnapshot(profile, userId);
      const appliedProfile = mergeProfileForCache(profileRef.current, profile);
      profileRef.current = appliedProfile;
      setState((prev) => {
        if (normalizeScopeId(prev.user?.id) !== userId) return prev;
        if (areProfileSnapshotsEqual(prev.profile, appliedProfile) && !prev.profileError) {
          return prev;
        }
        return {
          ...prev,
          isInitializing: false,
          profile: appliedProfile,
          profileError: null,
        };
      });
      return appliedProfile;
    },
    [loadProfile, rememberProfileSnapshot, state.user],
  );

  const setSignedOutState = useCallback((options = {}) => {
    authEventGenerationRef.current += 1;
    const signedOutUserId = normalizeScopeId(options?.signedOutUserId);
    if (signedOutUserId) {
      explicitlySignedOutUserIdRef.current = signedOutUserId;
    }

    clearProfileRecovery();
    profileAbortControllersRef.current.forEach((controller) => {
      try {
        controller.abort();
      } catch {}
    });
    profileAbortControllersRef.current.clear();
    profileLoadInFlightRef.current.clear();
    authRequestIdRef.current += 1;
    currentUserIdRef.current = null;
    clearActiveQueryCacheOwner();
    clearActiveOfflineOwner();
    signedOutSettledRef.current = true;
    profileRef.current = null;
    setState((prev) => {
      const alreadySignedOut =
        !prev.isInitializing &&
        !prev.isAuthenticated &&
        !prev.user &&
        !prev.profile &&
        !prev.profileError;
      if (alreadySignedOut) return prev;

      return {
        isInitializing: false,
        isSigningOut: false,
        isAuthenticated: false,
        user: null,
        profile: null,
        profileError: null,
      };
    });
  }, [clearProfileRecovery]);

  const recoverFromInvalidRefreshToken = useCallback(async () => {
    try {
      await settleWithin(supabase.auth.signOut({ scope: 'local' }), SIGN_OUT_AUTH_TIMEOUT_MS);
    } catch {}

    try {
      await settleWithin(clearPersistedAuthSession(), SIGN_OUT_SESSION_TIMEOUT_MS);
    } catch {}

    setSignedOutState();
    await cleanupSessionRuntime('invalid-refresh-token');
  }, [setSignedOutState]);

  const handleAuthChange = useCallback(
    async (event, session) => {
      const authEventGeneration = ++authEventGenerationRef.current;
      const user = session?.user ?? null;
      const nextUserId = user?.id ?? null;
      const hadUser = !!currentUserIdRef.current;
      const cachedProfileBeforeAuth = getCachedProfileSnapshot();
      const cacheOwnerBeforeAuth = getActiveQueryCacheOwner();
      let cacheClearedForAuthScope = false;
      const explicitlySignedOutUserId = normalizeScopeId(explicitlySignedOutUserIdRef.current);
      const nextScopeUserId = normalizeScopeId(nextUserId);

      if (logoutInProgressRef.current) return;

      if (
        explicitlySignedOutUserId &&
        nextScopeUserId === explicitlySignedOutUserId &&
        event !== 'SIGNED_IN'
      ) {
        return;
      }

      if (
        explicitlySignedOutUserId &&
        nextScopeUserId === explicitlySignedOutUserId &&
        event === 'SIGNED_IN'
      ) {
        const sessionResult = await supabase.auth.getSession().catch(() => null);
        if (authEventGeneration !== authEventGenerationRef.current) return;
        const activeUserId = normalizeScopeId(sessionResult?.data?.session?.user?.id);
        if (activeUserId !== nextScopeUserId) return;
      }

      if (explicitlySignedOutUserId && nextScopeUserId && nextScopeUserId !== explicitlySignedOutUserId) {
        explicitlySignedOutUserIdRef.current = null;
      }

      if (event === 'SIGNED_IN') {
        explicitlySignedOutUserIdRef.current = null;
        signedOutSettledRef.current = false;
      }

      if (event === 'SIGNED_OUT' || !nextUserId) {
        if (signedOutSettledRef.current && !hadUser) {
          return;
        }
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
        profileAbortControllersRef.current.forEach((controller) => {
          try {
            controller.abort();
          } catch {}
        });
        profileAbortControllersRef.current.clear();
        profileLoadInFlightRef.current.clear();
        currentUserIdRef.current = nextUserId;
        signedOutSettledRef.current = false;
        if (hadUser || cachedUserChanged) {
          await cleanupSessionRuntime(cachedUserChanged ? 'cached-user-changed' : 'user-changed');
          if (
            authEventGeneration !== authEventGenerationRef.current ||
            normalizeScopeId(currentUserIdRef.current) !== nextScopeUserId ||
            logoutInProgressRef.current
          ) {
            return;
          }
          cacheClearedForAuthScope = true;
        }
      }

      const metadataCompanyId = normalizeScopeId(user?.user_metadata?.company_id);
      const metadataScopeChanged =
        !cacheClearedForAuthScope &&
        hasAuthMetadataCompanyScopeChanged({
          cacheOwner: cacheOwnerBeforeAuth,
          cachedProfile: cachedProfileBeforeAuth,
          currentProfile: profileRef.current,
          nextUserId,
          metadataCompanyId,
        });

      if (metadataScopeChanged) {
        // Auth metadata can change company without changing the user id (for
        // example on TOKEN_REFRESHED). Never relabel the previous company's
        // cache. Role metadata is deliberately ignored for authorization.
        clearProfileRecovery();
        profileAbortControllersRef.current.forEach((controller) => {
          try {
            controller.abort();
          } catch {}
        });
        profileAbortControllersRef.current.clear();
        profileLoadInFlightRef.current.clear();
        authRequestIdRef.current += 1;
        profileRef.current = null;
        setState((prev) => ({
          ...prev,
          isInitializing: true,
          profile: null,
          profileError: null,
        }));
        await cleanupSessionRuntime('auth-metadata-company-changed');
        if (
          authEventGeneration !== authEventGenerationRef.current ||
          normalizeScopeId(currentUserIdRef.current) !== nextScopeUserId ||
          logoutInProgressRef.current
        ) {
          return;
        }
        cacheClearedForAuthScope = true;
      }

      setActiveQueryCacheOwner(
        metadataCompanyId
          ? { userId: nextUserId, companyId: metadataCompanyId }
          : { userId: nextUserId },
      );

      const isNonBlockingSameUserEvent =
        !userChanged &&
        (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'SIGNED_IN');
      const hasCurrentProfile =
        !metadataScopeChanged && profileRef.current?.id === nextUserId;
      const cachedProfileForCurrentUser = metadataScopeChanged
        ? null
        : getCachedProfileForUser(nextUserId);
      if (cachedProfileForCurrentUser?.company_id) {
        setActiveOfflineOwner({
          userId: nextUserId,
          companyId: cachedProfileForCurrentUser.company_id,
        });
      }
      const metadataProfileForCurrentUser = buildProfileFromUser(user, 'metadata-bootstrap');
      const networkSnapshot = getOfflineSnapshot();
      const shouldPreferLocalBootstrap =
        !networkSnapshot.isNetworkKnown ||
        !networkSnapshot.isOnline ||
        networkSnapshot.isPoorConnection;
      const isPersistedSessionRecovery = event === 'PERSISTED_SESSION';
      // A same-user cache may paint immediately only for a cold session restore,
      // when the device is confirmed offline, or when auth is being recovered
      // from encrypted storage while the network refresh is still pending.
      const canUseColdCachedProfile =
        (event === 'INITIAL_SESSION' || isPersistedSessionRecovery) &&
        !!cachedProfileForCurrentUser &&
        (shouldPreferLocalBootstrap || isPersistedSessionRecovery);
      const canUsePersistedMetadataProfile =
        (isPersistedSessionRecovery || shouldPreferLocalBootstrap) &&
        !!metadataProfileForCurrentUser;
      const shouldBlockUi =
        !hasCurrentProfile &&
        !canUseColdCachedProfile &&
        !canUsePersistedMetadataProfile &&
        (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || userChanged);
      const bootstrapProfile =
        shouldBlockUi
          ? null
          : cachedProfileForCurrentUser ||
            (hasCurrentProfile ? profileRef.current : null) ||
            metadataProfileForCurrentUser;

      if (!metadataScopeChanged && isNonBlockingSameUserEvent && hasCurrentProfile) {
        setState((prev) => ({
          ...prev,
          isInitializing: false,
          isAuthenticated: true,
          user,
          profileError: null,
        }));
        // Role changes are authoritative in profiles and are not guaranteed to
        // be mirrored into JWT metadata. Refresh without blocking the UI; the
        // recovery path clears privileged caches before applying a new role.
        scheduleProfileRecovery(user);
        return;
      }

      const requestId = ++authRequestIdRef.current;
      setState((prev) => ({
        isInitializing: shouldBlockUi,
        isSigningOut: false,
        isAuthenticated: true,
        user,
        profile: bootstrapProfile || (metadataScopeChanged ? null : prev.profile) || null,
        profileError: null,
      }));

      if (shouldPreferLocalBootstrap && bootstrapProfile) {
        scheduleProfileRecovery(user);
        return;
      }

      try {
        const profileAttempt = await settleWithin(loadProfile(user), PROFILE_UI_WAIT_TIMEOUT_MS);
        if (profileAttempt.timedOut) {
          debugLog('Profile request exceeded UI wait; continuing in background');
          throw new Error('profile-load-wait-timeout');
        }
        const profile = profileAttempt.value;
        if (
          requestId !== authRequestIdRef.current ||
          authEventGeneration !== authEventGenerationRef.current
        ) return;

        if (
          !cacheClearedForAuthScope &&
          (hasProfileScopeChanged(cachedProfileBeforeAuth, profile, nextUserId) ||
            hasQueryCacheOwnerScopeChanged(cacheOwnerBeforeAuth, profile, nextUserId))
        ) {
          await cleanupSessionRuntime('profile-scope-changed');
          if (
            requestId !== authRequestIdRef.current ||
            authEventGeneration !== authEventGenerationRef.current ||
            normalizeScopeId(currentUserIdRef.current) !== nextScopeUserId ||
            logoutInProgressRef.current
          ) {
            return;
          }
          cacheClearedForAuthScope = true;
        }
        rememberProfileSnapshot(profile, nextUserId);

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
        if (
          requestId !== authRequestIdRef.current ||
          authEventGeneration !== authEventGenerationRef.current
        ) return;
        const isTimeout =
          error?.message === 'profile-load-timeout' ||
          error?.message === 'profile-load-wait-timeout';
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
          scheduleProfileRecovery(user);
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
    if (!queryCacheBootstrapReady) return undefined;

    let mounted = true;
    const initialNetworkStatePromise = Promise.race([
      NetInfo.fetch()
        .then((networkState) => {
          if (mounted) setOfflineNetState(networkState);
        })
        .catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);

    const commitInitialSession = async (candidateSession, { allowSignedOut = false } = {}) => {
      if (!mounted) return true;
      if (initialSessionHandledRef.current) {
        if (
          candidateSession?.user?.id &&
          !currentUserIdRef.current &&
          !logoutInProgressRef.current
        ) {
          await handleAuthChange('SIGNED_IN', candidateSession);
        }
        return true;
      }

      let session = candidateSession;
      let recoveredFromStorage = false;
      if (!session?.user?.id) {
        try {
          const persistedSessionPromise = readPersistedAuthSession();
          const persistedAttempt = await settleWithin(
            persistedSessionPromise,
            LOCAL_SESSION_READ_WAIT_MS,
          );
          if (persistedAttempt.timedOut) {
            // Keep listening to the original local read. A slow Android
            // keystore migration must not become either a false logout or a
            // permanent startup gate.
            persistedSessionPromise
              .then((lateSession) => {
                if (lateSession?.user?.id) {
                  commitInitialSession(lateSession).catch(() => {});
                }
              })
              .catch(() => {});
            if (!allowSignedOut) return false;
            // Reveal the signed-out recovery shell without deleting either
            // the session or cached data. A later SDK SIGNED_IN event can
            // still recover this account.
            session = null;
          } else {
            session = persistedAttempt.value;
            recoveredFromStorage = !!session?.user?.id;
          }
        } catch (error) {
          log.warn('persisted session read failed during startup', error);
        }
      }

      if (!mounted || initialSessionHandledRef.current) return true;
      if (!session?.user?.id && !allowSignedOut) return false;

      initialSessionHandledRef.current = true;
      await initialNetworkStatePromise;
      if (!mounted) return true;
      await handleAuthChange(
        recoveredFromStorage ? 'PERSISTED_SESSION' : 'INITIAL_SESSION',
        session || null,
      );
      return true;
    };

    const loadInitialSession = async () => {
      const MAX_ATTEMPTS = 3;

      // SecureStore is local and encrypted. Restore its user immediately so an
      // expired access token cannot turn a slow refresh request into a false logout.
      if (await commitInitialSession(null)) return;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const sessionAttempt = await settleWithin(
            supabase.auth.getSession(),
            AUTH_SDK_SESSION_WAIT_MS,
          );
          if (sessionAttempt.timedOut) {
            throw new Error('auth-session-load-timeout');
          }
          const {
            data: { session },
            error,
          } = sessionAttempt.value;

          if (!mounted) return;

          if (error) {
            log.warn(`getSession error (attempt ${attempt}/${MAX_ATTEMPTS})`, error);
            if (isInvalidRefreshTokenError(error)) {
              await recoverFromInvalidRefreshToken();
              return;
            }
            if (attempt === MAX_ATTEMPTS) {
              await commitInitialSession(null, { allowSignedOut: true });
            } else {
              await new Promise((r) => setTimeout(r, 1200));
            }
            continue;
          }

          await commitInitialSession(session, { allowSignedOut: true });
          return;
        } catch (error) {
          log.warn(`initial session load error (attempt ${attempt}/${MAX_ATTEMPTS})`, error);
          if (!mounted) return;
          if (isInvalidRefreshTokenError(error)) {
            await recoverFromInvalidRefreshToken();
            return;
          }
          if (attempt === MAX_ATTEMPTS) {
            await commitInitialSession(null, { allowSignedOut: true });
          } else {
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
      }
    };

    loadInitialSession();

    const fallbackTimeout = setTimeout(() => {
      // Do not route to login merely because SDK initialization/refresh is slow.
      // Re-check encrypted storage first; only a conclusively empty snapshot may
      // resolve to the signed-out state.
      commitInitialSession(null, { allowSignedOut: true }).catch((error) => {
        log.warn('initial session fallback failed', error);
      });
    }, 8000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (initialSessionHandledRef.current) return;
      }
      // Supabase auth callbacks must stay synchronous; deferring async work
      // avoids deadlocks with methods like auth.updateUser() in React Native.
      setTimeout(async () => {
        if (event === 'INITIAL_SESSION') {
          await commitInitialSession(session, { allowSignedOut: true });
          return;
        }
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
    queryCacheBootstrapReady,
    recoverFromInvalidRefreshToken,
    setSignedOutState,
  ]);

  const signOut = useCallback(async () => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;

    const currentUserId = state.user?.id || null;
    setState((prev) => ({ ...prev, isInitializing: true, isSigningOut: true }));

    let currentAccessToken = '';
    let hadSession = false;
    let sessionWasChecked = false;
    try {
      const sessionAttempt = await settleWithin(
        supabase.auth.getSession(),
        SIGN_OUT_SESSION_TIMEOUT_MS,
      );
      const sessionResult = sessionAttempt.value;
      if (sessionAttempt.timedOut) {
        log.warn('getSession timed out during sign-out');
      }
      sessionWasChecked = !sessionAttempt.timedOut && !sessionResult?.error;
      hadSession = !!sessionResult?.data?.session;
      currentAccessToken = sessionResult?.data?.session?.access_token
        ? String(sessionResult.data.session.access_token)
        : '';
    } catch {}

    // Detach this physical installation while the old access token is still
    // unquestionably valid. Doing it after local sign-out made cleanup a
    // best-effort background race with the next account login.
    if (currentUserId && currentAccessToken) {
      try {
        const pushAttempt = await settleWithin(
          (async () => {
            const { token } = await readCurrentPushToken();
            if (!token) return;
            await deletePushToken(currentUserId, {
              pushToken: token,
              disableNotifications: false,
              accessToken: currentAccessToken,
            });
          })(),
          SIGN_OUT_PUSH_TIMEOUT_MS,
        );
        if (pushAttempt.timedOut) {
          log.warn('push installation detach timed out during sign-out');
        }
      } catch (error) {
        log.warn('push installation detach failed during sign-out', error);
      }
    }

    let signOutError = null;
    let signOutTimedOut = false;
    try {
      const signOutAttempt = await settleWithin(
        supabase.auth.signOut({ scope: 'local' }),
        SIGN_OUT_AUTH_TIMEOUT_MS,
      );
      signOutTimedOut = signOutAttempt.timedOut;
      const result = signOutAttempt.value;
      signOutError = result?.error || null;
    } catch (error) {
      signOutError = error;
    }

    const sessionIsGone =
      (sessionWasChecked && !hadSession) || isAuthSessionMissingError(signOutError);
    if (signOutTimedOut) {
      log.warn('Supabase signOut timed out; completing local sign-out');
    } else if (signOutError && !sessionIsGone) {
      log.warn('Supabase signOut failed; completing local sign-out', signOutError);
    }

    try {
      await settleWithin(clearPersistedAuthSession(), SIGN_OUT_SESSION_TIMEOUT_MS);
    } catch (error) {
      log.warn('persisted auth session cleanup failed during sign-out', error);
    }
    const cleanupPromise = cleanupSessionRuntime('sign-out').catch(() => {});
    setSignedOutState({ signedOutUserId: currentUserId });
    logoutInProgressRef.current = false;

    await cleanupPromise;
  }, [setSignedOutState, state.user?.id]);

  const mergeAuthUserMetadata = useCallback((metadataPatch = {}) => {
    if (!metadataPatch || typeof metadataPatch !== 'object') return;
    setState((prev) => {
      if (!prev.user?.id) return prev;
      const nextUser = {
        ...prev.user,
        user_metadata: {
          ...(prev.user.user_metadata || {}),
          ...metadataPatch,
        },
      };
      return {
        ...prev,
        user: nextUser,
      };
    });
  }, []);

  const value = {
    ...state,
    mergeAuthUserMetadata,
    refreshProfile,
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
