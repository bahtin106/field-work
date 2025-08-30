import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Используем надёжный хелпер: роль берём из public.profiles (а не из JWT)
import AdminHome from '../../components/AdminHome';
import DispatcherHome from '../../components/DispatcherHome';
import WorkerHome from '../../components/WorkerHome';
import { getUserRole, subscribeAuthRole } from '../../lib/getUserRole';

// Подключаем ролевые компоненты

export default function IndexScreen() {
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

    const unsub = subscribeAuthRole(async (r) => {
      setRole(r);
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!loading && role === null) {
      router.replace('/login');
    }
  }, [loading, role]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 12, opacity: 0.6 }}>Загружаем профиль…</Text>
      </View>
    );
  }

  if (role === null) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {role === 'worker' && <WorkerHome fullName={fullName} />}
        {role === 'dispatcher' && <DispatcherHome fullName={fullName} />}
        {role === 'admin' && <AdminHome fullName={fullName} />}
      </SafeAreaView>
    </KeyboardAvoidingView>
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
    color: 'red',
  },
});
