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

    console.log('[SimpleAuth] Loading profile for:', userId);
    
    try {
      // ПРЯМОЙ ПРОСТОЙ ЗАПРОС
      const { data, error } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Профиля нет - создаем
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
      console.error('[SimpleAuth] Profile error:', error);
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
      
      // После fallback не переретраим - фоновая загрузка сама обновит при успехе
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

        console.log('[SimpleAuth] Auth event:', event);
        
        // ВАЖНО: НЕ используем оптимистичный профиль, ЖДЕМ реальный из БД
        setState({
          isInitializing: true,
          isAuthenticated: true,
          user: user,
          profile: null, // Профиль будет загружен
          profileError: null,
        });

        try {
          const profile = await loadProfile(user);
          console.log('[SimpleAuth] Setting profile state:', {
            hasProfile: !!profile,
            role: profile?.role,
            source: profile?.__source,
          });
          setState((prev) => ({
            ...prev,
            isInitializing: false,
            profile: profile,
            profileError: profile ? null : 'load-failed',
          }));
          if (profile) {
            console.log('[SimpleAuth] Profile loaded, role:', profile.role);
          }
        } catch (error) {
          console.error('[SimpleAuth] Profile load failed:', error);
          setState((prev) => ({
            ...prev,
            isInitializing: false,
            profileError: 'load-failed',
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
    [loadProfile, clearProfileRetry],
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
