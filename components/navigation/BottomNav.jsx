// components/navigation/BottomNav.jsx
import { router, usePathname } from 'expo-router';
import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { usePermissions } from '../../lib/permissions';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';
import { preloadOrderDetailScreen, preloadRouteScreen } from '../../src/shared/navigation/routePreload';
import { scheduleUiIdleTask } from '../../src/shared/perf/uiIdleTask';
import { useToast } from '../ui/ToastProvider';

// -------- helpers --------

const PATHS = {
  home: '/orders',
  orders: '/orders/my-orders',
  all: '/orders/all-orders',
  calendar: '/orders/calendar',
};

function TabButton({ label, active, onPress, onPressIn, colors, metrics }) {
  const accLabel = typeof label === 'string' ? label : String(label || 'Tab');
  return (
    <Pressable
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
      onPress={onPress}
      onPressIn={onPressIn}
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
  const { t } = useTranslation();
  const { user } = useAuthContext();
  const { setAnchorOffset } = useToast();
  const { role, has, loading: roleLoading } = usePermissions();
  const canAll = !roleLoading && has('canViewAllOrders');
  const accountType = String(user?.user_metadata?.account_type || '').toLowerCase();
  const isSoloAdmin = String(role || '').toLowerCase() === 'admin' && accountType === 'solo';
  const showAllTab = canAll && !isSoloAdmin;

  useEffect(() => {
    if (roleLoading || !role) return undefined;
    const likelyRoutes = [
      PATHS.orders,
      PATHS.calendar,
      ...(showAllTab ? [PATHS.all] : []),
    ].filter((route) => !pathname.startsWith(route));
    const cancellations = likelyRoutes.map((route, index) =>
      scheduleUiIdleTask(() => {
        preloadRouteScreen(route);
      }, { delayMs: 300 + index * 650, idleTimeoutMs: 1600 }),
    );
    cancellations.push(
      scheduleUiIdleTask(() => {
        preloadOrderDetailScreen();
      }, { delayMs: 1500, idleTimeoutMs: 2200 }),
    );
    return () => cancellations.forEach((cancel) => cancel());
  }, [pathname, role, roleLoading, showAllTab]);

  // Синхронизация с глобальным состоянием готовности главной страницы

  // Подписываемся на изменения глобального состояния
  // Локальная видимость бара (для плавной анимации появления)
  const [navVisible, setNavVisible] = React.useState(false);
  const appear = useRef(new Animated.Value(0)).current;
  const tabNavInFlightRef = useRef(false);
  const navigateTab = React.useCallback((target) => {
    if (!target || tabNavInFlightRef.current) return;
    tabNavInFlightRef.current = true;

    try {
      if (target === PATHS.home && typeof router.dismissTo === 'function') {
        // Pop precisely to the home route. Unlike dismissAll(), this cannot
        // restore a previously mounted child route such as Calendar.
        router.dismissTo(PATHS.home);
      } else {
        router.navigate(target);
      }
    } catch {
      // A failed stack operation must not leave the user on a child route.
      if (target === PATHS.home) {
        try {
          router.replace(PATHS.home);
        } catch {}
      }
    } finally {
      tabNavInFlightRef.current = false;
    }
  }, []);
  // При изменении appReady на false (логаут/новый логин) - скрываем бар
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
  const bottomInset = Platform.OS === 'ios' ? Math.max(insets.bottom, 0) : 0;
  const bottomPadding = Math.max(bottomInset, theme.spacing.sm);
  const toastGap = theme.spacing.xl;

  // Показываем бар синхронно с главной страницей
  // Ждём: 1) готовность данных (роль, пермишены) 2) глобальное состояние 'ready'
  useEffect(() => {
    if (navVisible) return; // уже показали

    const dataReady = !roleLoading && !!role;

    // Показываем строго когда главная страница тоже готова
    if (dataReady) {
      // Небольшая задержка для плавности (синхронно с анимацией главной)
      const timer = setTimeout(() => setNavVisible(true), 0);
      return () => clearTimeout(timer);
    }
  }, [navVisible, roleLoading, role]);

  // скрываем бар на экранах авторизации
  if (pathname.startsWith('/(auth)')) return null;

  // до первой готовности — не рендерим вообще (чтобы не появлялся раньше главной)
  if (!navVisible) return null;

  const activeKey =
    pathname === PATHS.home || pathname === `${PATHS.home}/`
      ? 'home'
      : pathname.startsWith(PATHS.calendar)
        ? 'calendar'
        : pathname.startsWith(PATHS.all) && showAllTab
          ? 'all'
          : pathname.startsWith(PATHS.orders)
            ? 'orders'
            : pathname.startsWith(PATHS.all)
              ? 'orders'
            : null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          paddingBottom: bottomPadding,
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
      ]}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (setAnchorOffset) setAnchorOffset(h + toastGap);
      }}
    >
      {/* гарантированный ремоунт при смене canAll */}
      <View
        key={`variant-${Number(!!showAllTab)}`}
        style={[styles.bar, { height: metrics.itemHeight, paddingHorizontal: metrics.ph }]}
      >
        <TabButton
          key="tab-home"
          label={t('bottomNav.home')}
          active={activeKey === 'home'}
          onPress={() => {
            if (activeKey !== 'home') navigateTab(PATHS.home);
          }}
          colors={colors}
          metrics={metrics}
        />

        {showAllTab ? (
          <>
            <TabButton
              key="tab-orders"
              label={t('bottomNav.my')}
              active={activeKey === 'orders'}
              onPress={() => {
                if (activeKey !== 'orders') navigateTab(PATHS.orders);
              }}
              onPressIn={() => preloadRouteScreen(PATHS.orders)}
              colors={colors}
              metrics={metrics}
            />
            <TabButton
              key="tab-all"
              label={t('bottomNav.all')}
              active={activeKey === 'all'}
              onPress={() => {
                if (activeKey !== 'all') navigateTab(PATHS.all);
              }}
              onPressIn={() => preloadRouteScreen(PATHS.all)}
              colors={colors}
              metrics={metrics}
            />
          </>
        ) : (
          <TabButton
            key="tab-orders-only"
            label={t('bottomNav.myOrders')}
            active={activeKey === 'orders'}
            onPress={() => {
              if (activeKey !== 'orders') navigateTab(PATHS.orders);
            }}
            onPressIn={() => preloadRouteScreen(PATHS.orders)}
            colors={colors}
            metrics={metrics}
          />
        )}

        <TabButton
          key="tab-calendar"
          label={t('bottomNav.calendar')}
          active={activeKey === 'calendar'}
          onPress={() => {
            if (activeKey !== 'calendar') navigateTab(PATHS.calendar);
          }}
          onPressIn={() => preloadRouteScreen(PATHS.calendar)}
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


