// app/orders/_layout.js
import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function OrdersLayout() {
  const [checking, setChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    checkAuth();

    // Подписка на изменения авторизации
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session?.access_token);
      setChecking(false);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  async function checkAuth() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setIsAuthenticated(!!session?.access_token);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setChecking(false);
    }
  }

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Если не авторизован - редирект на логин
  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  // Авторизован - показываем контент
  return <Stack screenOptions={{ headerShown: false }} />;
}
