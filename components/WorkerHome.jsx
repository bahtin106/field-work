import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
  Platform,
} from 'react-native';
import Modal from 'react-native-modal';

import { getUserRole } from '../lib/getUserRole';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';

export default function WorkerHome() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);

  // Плейсхолдеры статистики
  const [stats, setStats] = useState({
    totalOrders: 0,
    pendingOrders: 0,
    completedOrders: 0,
    earnings: 0,
    earningsForecast: 0,
  });

  useEffect(() => {
    const fetchProfileAndStats = async () => {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }

      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('first_name, last_name, is_suspended, suspended_at')
        .eq('id', session.user.id)
        .single();
      if (error) {
        console.error('Ошибка загрузки профиля', error);
      } else {
        setProfile({ first_name: profileData.first_name, last_name: profileData.last_name });
        setBlocked(!!(profileData.is_suspended || profileData.suspended_at));
      }

      // Здесь позже будет запрос статистики из таблицы заказов
      // Пока ставим заглушки
      setStats({
        totalOrders: 25,
        pendingOrders: 5,
        completedOrders: 20,
        earnings: 12345,
        earningsForecast: 15000,
      });

      setLoading(false);
    };
    fetchProfileAndStats();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const handleOpenCalendar = () => {
    // Пока заглушка, потом реализуем календарь
    alert('Календарь пока не готов');
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
        <Text style={styles.blockedTitle}>Ваш аккаунт заблокирован</Text>
        <Text style={styles.blockedText}>Обратитесь к администратору.</Text>
        <View style={{ height: 12 }} />
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.appButton,
            styles.btnDanger,
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
        >
          <Text style={styles.appButtonText}>Выйти</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>
        Привет, {profile ? `${profile.first_name} ${profile.last_name}` : 'работник'}!
      </Text>

      <View style={styles.statsBlock}>
        <Text style={styles.statsTitle}>Статистика по заказам:</Text>
        <Text>Всего заказов: {stats.totalOrders}</Text>
        <Text>Невыполненных: {stats.pendingOrders}</Text>
        <Text>Выполненных: {stats.completedOrders}</Text>
      </View>

      <View style={styles.statsBlock}>
        <Text style={styles.statsTitle}>Заработок:</Text>
        <Text>Уже заработано: {stats.earnings} ₽</Text>
        <Text>Прогноз на период: {stats.earningsForecast} ₽</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleOpenCalendar}>
        <Text style={styles.buttonText}>Открыть календарь</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={handleLogout}>
        <Text style={[styles.buttonText, styles.logoutButtonText]}>Выйти</Text>
      </TouchableOpacity>

      {/* Модалка на будущее, если понадобится показывать блокировку поверх 
экрана */}
      <Modal isVisible={blocked} useNativeDriver backdropOpacity={0.4} onBackdropPress={() => {}}>
        <View style={styles.blockedCard}>
          <Text style={styles.blockedTitle}>Ваш аккаунт заблокирован</Text>
          <Text style={styles.blockedText}>Обратитесь к администратору.</Text>
          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [
              styles.appButton,
              styles.btnDanger,
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
          >
            <Text style={styles.appButtonText}>Выйти</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface,
      padding: 20,
      justifyContent: 'center',
    },
    greeting: {
      fontSize: 28,
      fontWeight: '600',
      marginBottom: 24,
      color: theme.colors.text,
      textAlign: 'center',
    },
    statsBlock: {
      backgroundColor: theme.colors.surface,
      padding: 16,
      borderRadius: 14,
      marginBottom: 20,
      ...(theme.shadows?.level1?.[Platform.OS] || theme.shadows?.level1 || {}),
    },
    statsTitle: {
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 12,
      color: theme.colors.primary,
    },
    button: {
      backgroundColor: theme.colors.primary,
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: 'center',
      marginBottom: 12,
    },
    logoutButton: {
      backgroundColor: theme.colors.danger,
    },
    buttonText: {
      color: theme.colors.onPrimary,
      fontSize: 17,
      fontWeight: '600',
    },
    logoutButtonText: {
      fontWeight: '700',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    blocked: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    blockedTitle: { fontSize: 20, fontWeight: '700', marginBottom: 6, color: theme.colors.text },
    blockedText: { fontSize: 16, color: theme.colors.textSecondary },

    // Доп. стили для кнопок/модалки
    appButton: {
      paddingVertical: 14,
      paddingHorizontal: 18,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnDanger: {
      backgroundColor: theme.colors.danger,
    },
    appButtonText: {
      color: theme.colors.onPrimary,
      fontSize: 17,
      fontWeight: '600',
    },
    blockedCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 20,
    },
  });
