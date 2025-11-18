// app/index.jsx
import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function Index() {
  const navigationState = useRootNavigationState();
  const router = useRouter();

  useEffect(() => {
    // Ждём пока навигация инициализируется
    if (!navigationState?.key) return;

    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        // Залогинен - на главную
        router.replace('/orders');
      } else {
        // Не залогинен - на логин
        router.replace('/(auth)/login');
      }
    };

    checkAuth();
  }, [navigationState?.key]);

  // Показываем пустой экран пока проверяем
  return null;
}
