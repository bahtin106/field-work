// components/navigation/BottomNav.jsx
import React, { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { usePathname, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider'; // ← из вашей темы

// ПРАВЬТЕ пути под ваши экраны при необходимости
const PATHS = {
  home: '/orders/',
  orders: '/orders/orders',
  calendar: '/orders/calendar',
};

function TabButton({ label, active, onPress, colors }) {
  return (
    <Pressable style={styles.btn} onPress={onPress} android_ripple={{ borderless: false }}>
      <Text style={[styles.label, { color: active ? colors.active : colors.inactive }]}>
        {label}
      </Text>
      {active ? <View style={[styles.indicator, { backgroundColor: colors.active }]} /> : null}
    </Pressable>
  );
}

function BottomNavInner() {
  const pathname = usePathname() || '';
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  // скрываем бар на экранах авторизации
  if (pathname.startsWith('/(auth)')) return null;

  const activeKey =
    pathname === PATHS.home
      ? 'home'
      : pathname.startsWith(PATHS.calendar)
      ? 'calendar'
      : pathname.startsWith(PATHS.orders)
      ? 'orders'
      : null;

  const colors = useMemo(() => {
    const bg =
      theme?.colors?.backgroundSecondary ??
      theme?.colors?.card ??
      theme?.colors?.background ??
      '#121212';
    const border = theme?.colors?.border ?? 'rgba(0,0,0,0.12)';
    const active = theme?.colors?.primary ?? '#4F8EF7';
    const inactive =
      theme?.colors?.textSecondary ?? (theme?.mode === 'dark' ? '#A0A0A0' : '#606060');
    return { bg, border, active, inactive };
  }, [theme]);

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8), backgroundColor: colors.bg, borderTopColor: colors.border }]}>
      <View style={styles.bar}>
        <TabButton
          label="Главная"
          active={activeKey === 'home'}
          onPress={() => router.push(PATHS.home)}
          colors={colors}
        />
        <TabButton
          label="Мои заявки"
          active={activeKey === 'orders'}
          onPress={() => router.push(PATHS.orders)}
          colors={colors}
        />
        <TabButton
          label="Календарь"
          active={activeKey === 'calendar'}
          onPress={() => router.push(PATHS.calendar)}
          colors={colors}
        />
      </View>
    </View>
  );
}

export default memo(BottomNavInner);

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    height: 56,                 // фикс. высота, как у таббара
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  btn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '600',
  },
  indicator: {
    position: 'absolute',
    bottom: 6,
    height: 3,
    width: 24,
    borderRadius: 2,
  },
});
