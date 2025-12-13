import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { bumpSessionEpoch } from '../lib/sessionEpoch';
import { supabase } from '../lib/supabase';
const VALID_ROLES = new Set(['admin', 'dispatcher', 'worker']);
const PROFILE_COLUMNS = 'id, first_name, last_name, full_name, role, avatar_url, company_id';

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

  const loadProfile = useCallback(async (user) => {
    const userId = user?.id;
    if (!userId) return null;

    const fallbackProfile = buildProfileFromUser(user, 'fallback');

    const tryFetchProfile = async () => {
      try {
        const baseQuery = supabase
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .or(`id.eq.${userId},user_id.eq.${userId}`)
          .maybeSingle();
        let { data, error } = await baseQuery;

        if (error && (error.code === '42703' || /user_id/i.test(error.message || ''))) {
          const fallbackQuery = supabase
            .from('profiles')
            .select(PROFILE_COLUMNS)
            .eq('id', userId)
            .maybeSingle();
          const res = await fallbackQuery;
          data = res.data;
          error = res.error;
        }

        if (error) {
          if (error.code === 'PGRST116') {
            return null;
          }
          if (error.code === '42703' || /column .* does not exist/i.test(error.message || '')) {
            return null;
          }
          console.error('SimpleAuth: profile query error', error);
          return null;
        }

        if (!data) return null;
        return normalizeProfileData(data, user, 'supabase');
      } catch (err) {
        return null;
      }
    };

    try {
      const profileById = await tryFetchProfile();
      if (profileById) return profileById;
      const metadataProfile = buildProfileFromUser(user, 'pre-create');
      const basePayload = {
        id: userId,
        user_id: userId,
        role: metadataProfile?.role ?? 'worker',
      };
      if (metadataProfile?.first_name) basePayload.first_name = metadataProfile.first_name;
      if (metadataProfile?.last_name) basePayload.last_name = metadataProfile.last_name;
      if (metadataProfile?.full_name) basePayload.full_name = metadataProfile.full_name;
      if (metadataProfile?.avatar_url) basePayload.avatar_url = metadataProfile.avatar_url;
      if (metadataProfile?.company_id) basePayload.company_id = metadataProfile.company_id;

      const attemptCreate = async (payload) => {
        return supabase
          .from('profiles')
          .insert(payload, { defaultToNull: true })
          .select(PROFILE_COLUMNS)
          .single();
      };

      let createPayload = { ...basePayload };
      let createResult;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        createResult = await attemptCreate(createPayload);
        const creationError = createResult.error;

        if (!creationError) {
          break;
        }

        const message = creationError.message || '';
        const missingColumnMatch = message.match(/column "?([a-zA-Z0-9_]+)"?/i);
        const missingColumn = missingColumnMatch?.[1];
        const isUnsupportedColumn =
          creationError.code === '42703' ||
          creationError.code === 'PGRST204' ||
          /column .* does not exist/i.test(message);

        if (isUnsupportedColumn && missingColumn && missingColumn in createPayload) {
          delete createPayload[missingColumn];
          continue;
        }

        break;
      }

      const { data: createdProfile, error: createError } = createResult || {
        data: null,
        error: null,
      };

      if (createError) {
        if (createError.code === '23505') {
          const retryProfile = await tryFetchProfile('id');
          return retryProfile || fallbackProfile;
        }
        return fallbackProfile;
      }

      if (createdProfile) {
        return normalizeProfileData(createdProfile, user, 'created');
      }

      return fallbackProfile;
    } catch (error) {
      return fallbackProfile;
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

      const delay = Math.min(3000 * attempt, 12000);
      profileRetryRef.current = setTimeout(() => {
        loadProfile(user)
          .then((profile) => {
            if (!profile) {
              setState((prev) =>
                prev.user?.id === user.id
                  ? { ...prev, profileError: 'profile-load-failed', profile: prev.profile }
                  : prev,
              );
              scheduleProfileRetry(user, attempt + 1);
              return;
            }

            setState((prev) => {
              if (!prev.isAuthenticated || prev.user?.id !== user.id) return prev;
              const prevSource = prev.profile?.__source;
              const nextSource = profile.__source;
              if (nextSource === 'fallback' && prevSource && prevSource !== 'fallback') {
                return prev;
              }
              return {
                ...prev,
                profile,
                profileError: null,
              };
            });

            if (profile.__source === 'fallback') {
              scheduleProfileRetry(user, attempt + 1);
            } else {
              clearProfileRetry();
            }
          })
          .catch((error) => {
            console.error('SimpleAuth: profile retry error', error);
            scheduleProfileRetry(user, attempt + 1);
          });
      }, delay);
    },
    [loadProfile, clearProfileRetry],
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

        const optimisticProfile = buildProfileFromUser(user, 'optimistic');
        clearProfileRetry();
        setState({
          isInitializing: false,
          isAuthenticated: true,
          user: user,
          profile: optimisticProfile,
          profileError: null,
        });
        bumpSessionEpoch();

        loadProfile(user)
          .then((profile) => {
            const resolvedProfile = profile || optimisticProfile;
            setState((prev) => {
              if (!prev.isAuthenticated || prev.user?.id !== user.id) return prev;
              const prevSource = prev.profile?.__source;
              const nextSource = resolvedProfile.__source;
              if (nextSource === 'fallback' && prevSource && prevSource !== 'fallback') {
                return prev;
              }
              return {
                ...prev,
                profile: resolvedProfile,
                profileError: profile ? null : 'profile-load-failed',
              };
            });

            if (!profile) {
              scheduleProfileRetry(user, 1);
            } else if (profile.__source === 'fallback') {
              scheduleProfileRetry(user, 1);
            } else {
              clearProfileRetry();
            }
          })
          .catch((error) => {
            console.error('SimpleAuth: background profile load failed', error);
            setState((prev) => ({
              ...prev,
              profileError: 'profile-load-failed',
            }));
            scheduleProfileRetry(user, 1);
          });
        return;
      }

      setState((prev) => ({
        ...prev,
        isInitializing: false,
      }));
    },
    [loadProfile, clearProfileRetry, scheduleProfileRetry],
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
            console.warn(
              'SimpleAuth: getSession error (attempt %s/%s)',
              attempt,
              MAX_ATTEMPTS,
              error,
            );
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
