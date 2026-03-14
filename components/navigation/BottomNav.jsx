// components/navigation/BottomNav.jsx
import { router, usePathname } from 'expo-router';
import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import appReadyState from '../../lib/appReadyState';
import { useTheme } from '../../theme/ThemeProvider';
import { useUserPermissions } from '../hooks/useUserPermissions';
import { useToast } from '../ui/ToastProvider';
// --- i18n labels (safe runtime require) ---
let __labels = null;
try {
  __labels = require('../../i18n/labels');
} catch {}
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
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
      onPress={onPress}
      android_ripple={{ color: colors.ripple, borderless: false }}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accLabel}
    >
      <Text
        style={[
          styles.label,
          {
            color: active ? colors.active : colors.inactive,
            fontSize: metrics.labelSize,
          },
        ]}
      >
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
  const { role, canAll, roleLoading, canAllLoading } = useUserPermissions();

  // Синхронизация с глобальным состоянием готовности главной страницы
  const [appReady, setAppReady] = React.useState(() => appReadyState.isReady());

  // Подписываемся на изменения глобального состояния
  React.useEffect(() => {
    const unsubscribe = appReadyState.subscribe((state) => {
      setAppReady(state === 'ready');
    });
    return unsubscribe;
  }, []);

  // Локальная видимость бара (для плавной анимации появления)
  const [navVisible, setNavVisible] = React.useState(false);
  const appear = useRef(new Animated.Value(0)).current;

  // При изменении appReady на false (логаут/новый логин) - скрываем бар
  React.useEffect(() => {
    if (!appReady && navVisible) {
      setNavVisible(false);
      appear.setValue(0);
    }
  }, [appReady, navVisible, appear]);

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

  const colors = useMemo(() => {
    const bg = theme.colors.navigationBarBg ?? theme.colors.surface;
    const border = theme.colors.border;
    const active = theme.colors.primary;
    const inactive = theme.colors.textSecondary ?? theme.colors.text;
    const ripple = theme.colors.ripple;
    return { bg, border, active, inactive, ripple };
  }, [theme]);

  const metrics = React.useMemo(() => {
    const itemHeight = theme?.components?.listItem?.height ?? theme.spacing.xxl;
    const ph = theme?.spacing?.sm ?? 10;
    const indicatorH = theme?.components?.tab?.indicatorHeight ?? StyleSheet.hairlineWidth * 3;
    const indicatorW = theme?.components?.tab?.indicatorWidth ?? Math.round(itemHeight * 0.43);
    const indicatorRadius = theme?.radii?.xs ?? 6;
    const bottomOffset = theme?.spacing?.xs ?? 6;
    const labelSize = theme?.typography?.sizes?.sm ?? 13;
    return { itemHeight, ph, indicatorH, indicatorW, indicatorRadius, bottomOffset, labelSize };
  }, [theme]);

  // Показываем бар синхронно с главной страницей
  // Ждём: 1) готовность данных (роль, пермишены) 2) глобальное состояние 'ready'
  useEffect(() => {
    if (navVisible) return; // уже показали

    const dataReady = !roleLoading && !canAllLoading && !!role;

    // Показываем строго когда главная страница тоже готова
    if (dataReady && appReady) {
      // Небольшая задержка для плавности (синхронно с анимацией главной)
      const t = setTimeout(() => setNavVisible(true), 0);
      return () => clearTimeout(t);
    }
  }, [navVisible, roleLoading, canAllLoading, role, appReady]);

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
          paddingBottom: Math.max(insets.bottom, theme.spacing.sm),
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
          if (setAnchorOffset) setAnchorOffset(h + theme.spacing.xl);
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
  btnPressed: {
    opacity: 0.9,
  },
  label: {
    fontWeight: '600',
  },
  indicator: {
    position: 'absolute',
  },
});
