// AdminHome.jsx
import { router, useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Эта версия экрана принципиально НЕ делает никаких сетевых запросов
 * ни на mount, ни на focus. Только мгновенный рендер.
 * Если где-то ещё вспыхивает «Загружаем профиль» — это не из этого файла.
 */

// ---- Модульный кэш на процесс ----
let __ADMIN_HOME_CACHE__ = {
  stats: { total: 0, inWork: 0, done: 0, free: 0 },
  ts: 0,
};

export default function AdminHome({ fullName }) {
  const { theme, setMode, mode } = useTheme();
  const params = useLocalSearchParams();

  // 1) Мгновенный рендер из кэша (или из параметров навигации, если передали)
  const initial = (() => {
    if (params?.stats) {
      try {
        const parsed = JSON.parse(params.stats);
        if (parsed && typeof parsed === 'object') {
          __ADMIN_HOME_CACHE__ = { stats: parsed, ts: Date.now() };
        }
      } catch {}
    }
    return __ADMIN_HOME_CACHE__.stats;
  })();

  const [stats] = useState(initial);
  const renderedOnce = useRef(true); // просто флаг, на будущее

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.bg }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.header, { color: theme.colors.text }]}>Здравствуйте, {fullName}</Text>

      {/* Переключатель темы */}
      <View style={[theme.cardStyle, theme.shadow, { padding: 16, marginBottom: 16 }]}>
        <Text style={[theme.text.title, { marginBottom: 8 }]}>Тема</Text>
        <Text style={theme.text.muted}>Выберите оформление приложения</Text>
        <View style={{ height: 12 }} />
        <View style={{ flexDirection: 'row' }}>
          {['light', 'dark', 'system'].map((opt) => (
            <TouchableOpacity
              key={opt}
              onPress={() => setMode(opt)}
              style={[
                styles.modeBtn,
                {
                  borderColor: mode === opt ? theme.colors.accent : theme.colors.border,
                  backgroundColor: mode === opt ? theme.colors.tint : 'transparent',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Тема: ${opt}`}
            >
              <Text
                style={[
                  theme.text.body,
                  { color: mode === opt ? theme.colors.accent : theme.colors.text },
                ]}
              >
                {opt === 'light' ? 'Светлая' : opt === 'dark' ? 'Тёмная' : 'Системная'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Статистика (только из кэша/параметров, без сети) */}
      <View style={styles.statsContainer}>
        <StatCard
          theme={theme}
          label="Всего заявок"
          value={stats.total}
          onPress={() => router.push({ pathname: '/all-orders', params: { filter: 'all' } })}
        />
        <StatCard
          theme={theme}
          label="В работе"
          value={stats.inWork}
          onPress={() =>
            router.push({ pathname: '/all-orders', params: { filter: 'in_progress' } })
          }
        />
        <StatCard
          theme={theme}
          label="Завершено"
          value={stats.done}
          onPress={() => router.push({ pathname: '/all-orders', params: { filter: 'done' } })}
        />
        <StatCard
          theme={theme}
          label="Свободные"
          value={stats.free}
          onPress={() => router.push({ pathname: '/all-orders', params: { filter: 'free' } })}
        />
      </View>

      <PrimaryButton
        title="Все заявки"
        style={styles.buttonAllOrders}
        onPress={() => router.push('/all-orders')}
      />
      <PrimaryButton
        title="Статистика"
        style={styles.buttonStats}
        onPress={() => router.push('/stats')}
      />
      <PrimaryButton
        title="Сотрудники"
        style={styles.buttonUsers}
        onPress={() => router.push('/users')}
      />
      <PrimaryButton
        title="Настройка форм"
        style={styles.buttonSettings}
        onPress={() => router.push('/admin/form-builder')}
      />
      <PrimaryButton
        title="Создать заявку"
        style={styles.buttonPrimary}
        onPress={() => router.push('/create-order')}
      />
      <PrimaryButton title="Выйти из профиля" style={styles.buttonLogout} onPress={logout} />
    </ScrollView>
  );
}

function StatCard({ theme, label, value, onPress }) {
  return (
    <TouchableOpacity style={[styles.statBox, theme.cardStyle, theme.shadow]} onPress={onPress}>
      <Text style={[styles.statLabel, { color: theme.text.muted.color }]}>{label}</Text>
      <Text style={[styles.statValue, { color: theme.colors.text }]}>{value}</Text>
    </TouchableOpacity>
  );
}

function PrimaryButton({ title, onPress, style }) {
  return (
    <TouchableOpacity style={[styles.button, style]} onPress={onPress}>
      <Text style={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 54,
    paddingBottom: 40,
  },
  header: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 30,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statBox: {
    width: '48%',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 14,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 8,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 16,
    alignItems: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#28a745',
  },
  buttonLogout: {
    backgroundColor: '#dc3545',
  },
  buttonAllOrders: {
    backgroundColor: '#4DA6FF',
  },
  buttonUsers: {
    backgroundColor: '#007AFF',
  },
  buttonStats: {
    backgroundColor: '#6f42c1',
  },
  buttonSettings: {
    backgroundColor: '#007AFF',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  modeBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginRight: 8,
  },
});
