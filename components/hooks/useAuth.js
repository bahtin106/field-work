/**
 * useAuth - Хук для проверки статуса аутентификации
 * Обеспечивает надежную проверку наличия сессии перед операциями, требующими auth
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);

  // Проверяем аутентификацию при монтировании
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        setIsAuthenticated(!!session);
        setUser(session?.user || null);
      } catch {
        // Failed to check auth session
        setIsAuthenticated(false);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();

    // Подписываемся на изменения аутентификации
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      setUser(session?.user || null);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  return {
    isAuthenticated,
    isLoading,
    user,
  };
}
