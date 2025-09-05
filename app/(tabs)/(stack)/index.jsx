// app/(tabs)/index.jsx
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import Screen from '../../../components/layout/Screen';
import { useTheme } from '../../../theme';

import AdminHome from '../../../components/AdminHome';
import DispatcherHome from '../../../components/DispatcherHome';
import WorkerHome from '../../../components/WorkerHome';
import { getUserRole, subscribeAuthRole } from '../../../lib/getUserRole';

export default function IndexScreen() {
  const { theme } = useTheme();
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

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

    const unsub = subscribeAuthRole((r) => setRole(r));
    return () => {
      mounted = false;
      unsub && unsub();
    };
  }, []);

  useEffect(() => {
    if (!loading && role === null) {
      router.replace('/login');
    }
  }, [loading, role]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>Загружаем профиль…</Text>
        </View>
      </Screen>
    );
  }

  if (role === null) return null;

  return (
    <Screen>
      {role === 'worker' && <WorkerHome fullName={fullName} />}
      {role === 'dispatcher' && <DispatcherHome fullName={fullName} />}
      {role === 'admin' && <AdminHome fullName={fullName} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  error: {
    fontSize: 18,
  },
  loadingText: {
    marginTop: 12,
    opacity: 0.6,
  },
});
