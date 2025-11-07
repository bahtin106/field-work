// components/navigation/BottomNav.jsx
import React, { memo, useMemo, useEffect, useState, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, AppState } from 'react-native';
import { usePathname, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { useUserPermissions } from '../hooks/useUserPermissions';
import { useToast } from '../ui/ToastProvider';
// --- i18n labels (safe runtime require) ---
let __labels = null;
try {
  __labels = require('../../i18n/labels');
} catch (_) {}
const t = (key, fallback) => {
  const mod = __labels || {};
  if (typeof mod.t === 'function') return mod.t(key, fallback);
  if (typeof mod.getLabel === 'function') return mod.getLabel(key, fallback);
  const dict = mod.labels || mod.default || mod || {};
  const val = String(key)
    .split('.')
    .reduce((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), dict);
  return val == null || val === '' ? (fallback ?? key) : String(val);
};

// -------- helpers --------

const PATHS = {
  home: '/orders',
  orders: '/orders/my-orders',
  all: '/orders/all-orders',
  calendar: '/orders/calendar',
};

function TabButton({ label, active, onPress, colors, metrics }) {
  const accLabel = typeof label === 'string' ? label : String(label || 'Tab');
  return (
    <Pressable
      style={styles.btn}
      onPress={onPress}
      android_ripple={{ borderless: false }}
      accessibilityRole="tab"
      accessibilityLabel={accLabel}
    >
      <Text style={[styles.label, { color: active ? colors.active : colors.inactive }]}>
        {typeof label === 'string' ? label : String(label || '')}
      </Text>
      {active ? (
        <View
          style={[
            styles.indicator,
            {
              backgroundColor: colors.active,
              bottom: metrics.bottomOffset,
              height: metrics.indicatorH,
              width: metrics.indicatorW,
              borderRadius: metrics.indicatorRadius,
            },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

function BottomNavInner() {
  const pathname = usePathname() || '';
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { setAnchorOffset } = useToast();
  const { role, canAll, roleLoading, canAllLoading, isFetching } = useUserPermissions();
  const [navVisible, setNavVisible] = React.useState(false);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (navVisible) {
      Animated.timing(appear, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    } else {
      appear.setValue(0);
    }
  }, [navVisible, appear]);
  // Тайминги в унисон с главным экраном
  const navStartRef = useRef(Date.now());
  const MIN_SPLASH_MS = 600;
  const NET_IDLE_GRACE_MS = 280;

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

  const metrics = React.useMemo(() => {
    const itemHeight = theme?.components?.listItem?.height ?? 56;
    const ph = theme?.spacing?.sm ?? 10;
    const indicatorH = theme?.components?.tab?.indicatorHeight ?? 3;
    const indicatorW = theme?.components?.tab?.indicatorWidth ?? Math.round(itemHeight * 0.43);
    const indicatorRadius = theme?.radii?.xs ?? 2;
    const bottomOffset = theme?.spacing?.xs ?? 6;
    return { itemHeight, ph, indicatorH, indicatorW, indicatorRadius, bottomOffset };
  }, [theme]);
  // «страховочный» короткий пуллинг после события (5 раз по 2с)
  // Показать нижний бар строго синхронно с главным экраном (с тем же grace):
  useEffect(() => {
    if (navVisible) return; // показали — больше не прячем
    const ready = !roleLoading && !canAllLoading;
    let t;
    if (ready && isFetching === 0) {
      const elapsed = Date.now() - navStartRef.current;
      const waitMin = Math.max(0, MIN_SPLASH_MS - elapsed);
      const delay = Math.max(waitMin, NET_IDLE_GRACE_MS);
      t = setTimeout(() => setNavVisible(true), delay);
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [navVisible, roleLoading, canAllLoading, isFetching]);

  // скрываем бар на экранах авторизации
  if (pathname.startsWith('/(auth)')) return null;

  // до первой готовности — не рендерим вообще (чтобы не появлялся раньше главной)
  if (!navVisible) return null;

  const activeKey =
    pathname === PATHS.home || pathname === `${PATHS.home}/`
      ? 'home'
      : pathname.startsWith(PATHS.calendar)
        ? 'calendar'
        : pathname.startsWith(PATHS.all)
          ? 'all'
          : pathname.startsWith(PATHS.orders)
            ? 'orders'
            : null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, theme?.spacing?.sm ?? 10),
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
      ]}
    >
      {/* гарантированный ремоунт при смене canAll */}
      <View
        key={`variant-${Number(!!canAll)}`}
        style={[styles.bar, { height: metrics.itemHeight, paddingHorizontal: metrics.ph }]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (setAnchorOffset) setAnchorOffset(h + (theme?.spacing?.xl ?? 24));
        }}
      >
        <TabButton
          key="tab-home"
          label={t('bottomNav.home', 'Главная')}
          active={activeKey === 'home'}
          onPress={() => {
            if (activeKey !== 'home') router.replace(PATHS.home);
          }}
          colors={colors}
          metrics={metrics}
        />

        {canAll ? (
          <>
            <TabButton
              key="tab-orders"
              label={t('bottomNav.my', 'Мои')}
              active={activeKey === 'orders'}
              onPress={() => {
                if (activeKey !== 'orders') router.replace(PATHS.orders);
              }}
              colors={colors}
              metrics={metrics}
            />
            <TabButton
              key="tab-all"
              label={t('bottomNav.all', 'Все')}
              active={activeKey === 'all'}
              onPress={() => {
                if (activeKey !== 'all') router.replace(PATHS.all);
              }}
              colors={colors}
              metrics={metrics}
            />
          </>
        ) : (
          <TabButton
            key="tab-orders-only"
            label={t('bottomNav.myOrders', 'Мои заявки')}
            active={activeKey === 'orders'}
            onPress={() => {
              if (activeKey !== 'orders') router.replace(PATHS.orders);
            }}
            colors={colors}
            metrics={metrics}
          />
        )}

        <TabButton
          key="tab-calendar"
          label={t('bottomNav.calendar', 'Календарь')}
          active={activeKey === 'calendar'}
          onPress={() => {
            if (activeKey !== 'calendar') router.replace(PATHS.calendar);
          }}
          colors={colors}
          metrics={metrics}
        />
      </View>
    </Animated.View>
  );
}

export default memo(BottomNavInner);

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
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
  },
});
