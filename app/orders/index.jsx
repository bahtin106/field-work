// app/orders/index.jsx
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';

import UniversalHome from '../../components/UniversalHome';
import { getUserRole, subscribeAuthRole } from '../../lib/getUserRole';

export default function IndexScreen() {
  const { theme } = useTheme();
  // Текущая роль пользователя: admin, dispatcher, worker или null.
  const [role, setRole] = useState(null);
  // Признак загрузки — пока не получена роль, показываем спиннер.
  const [loading, setLoading] = useState(true);

  // Загружаем роль и подписываемся на её изменение.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await getUserRole();
        if (mounted) setRole(r);
      } catch (e) {
        console.warn('getUserRole error:', e?.message || e);
        if (mounted) setRole(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const unsub = subscribeAuthRole((r) => mounted && setRole(r));
    return () => {
      mounted = false;
      unsub && unsub();
    };
  }, []);

  // Если роль не определена (например, пользователь разлогинен), переходим
  // на экран авторизации.
  useEffect(() => {
    if (!loading && role === null) {
      router.replace('/(auth)/login');
    }
  }, [loading, role]);

  // Разрешённые роли для отображения домашнего экрана.
  const ready = ['worker', 'dispatcher', 'admin'].includes(role);

  // Пока загружается профиль или роль не поддерживается, показываем
  // индикатор загрузки.
  if (loading || !ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>Загружаем профиль…</Text>
        </View>
      </View>
    );
  }

  // Передаём роль в универсальный домашний экран. Сам компонент берёт на себя
  // получение профиля и отображение остальных данных.
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <UniversalHome role={role} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center', },
  error: {
    fontSize: 18,
  },
  loadingText: {
    marginTop: 12,
    opacity: 0.6,
  },
});