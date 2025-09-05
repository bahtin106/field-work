import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Modal from 'react-native-modal';
import { useTheme } from '../theme/ThemeProvider';
import { supabase } from '../lib/supabase';

export default function DispatcherHome({ fullName }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);

  const { theme } = useTheme();

  useEffect(() => {
    const checkSuspended = async () => {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const { data: prof, error } = await supabase
        .from('profiles')
        .select('is_suspended, suspended_at')
        .eq('id', session.user.id)
        .single();
      if (!error && prof) {
        setBlocked(!!(prof.is_suspended || prof.suspended_at));
      }
      setLoading(false);
    };
    checkSuspended();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (blocked) {
    return (
      <View style={styles.blocked}>
        <Text style={[styles.blockedTitle, { color: theme.colors.text } ]}>Ваш аккаунт заблокирован</Text>
        <Text style={[styles.blockedText, { color: theme.colors.textSecondary }]}>Обратитесь к администратору.</Text>
        <View style={{ height: 12 }} />
        <Pressable
          onPress={logout}
          style={({ pressed }) => [
            styles.appButton,
            styles.btnDanger,
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
        >
          <Text style={[styles.appButtonText, { color: theme.colors.onPrimary }]}>Выйти</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.header, { color: theme.colors.text }]}>Здравствуйте, {fullName}</Text>
      <Text style={[styles.text, { color: theme.colors.textSecondary }]}>Вы можете управлять заявками и назначать исполнителей.</Text>

      <Pressable
        onPress={logout}
        style={({ pressed }) => [
          styles.appButton,
          styles.btnDanger,
          { backgroundColor: theme.colors.danger },
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
      >
        <Text style={[styles.appButtonText, { color: theme.colors.onPrimary }]}>Выйти из профиля</Text>
      </Pressable>

      {/* Модалка на будущее, если понадобится показывать блокировку поверх
экрана */}
      <Modal isVisible={blocked} useNativeDriver backdropOpacity={0.4} onBackdropPress={() => {}}>
        <View style={[styles.blockedCard, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.blockedTitle, { color: theme.colors.text } ]}>Ваш аккаунт заблокирован</Text>
          <Text style={[styles.blockedText, { color: theme.colors.textSecondary }]}>Обратитесь к администратору.</Text>
          <Pressable
            onPress={logout}
            style={({ pressed }) => [
              styles.appButton,
              styles.btnDanger,
              { backgroundColor: theme.colors.danger },
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
          >
            <Text style={[styles.appButtonText, { color: theme.colors.onPrimary }]}>Выйти</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#F5F7FA',
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#1a2741',
  },
  text: {
    fontSize: 16,
    marginBottom: 24,
    color: '#333',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  blockedTitle: { fontSize: 20, fontWeight: '700', marginBottom: 6, color: '#1a2741' },
  blockedText: { fontSize: 16, color: '#333' },

  // Кнопки/модалка
  appButton: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDanger: {
    backgroundColor: '#ff3b30',
  },
  appButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  blockedCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
});