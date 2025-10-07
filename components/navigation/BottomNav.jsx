// components/navigation/BottomNav.jsx
import React, { memo, useMemo, useEffect, useState, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, AppState, Animated, Easing } from 'react-native';
import { usePathname, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { supabase } from '../../lib/supabase';
import { getUserRole } from '../../lib/getUserRole';
import { useToast } from '../ui/ToastProvider';
// --- i18n labels (safe runtime require) ---
let __labels = null;
try { __labels = require('../../i18n/labels'); } catch (_) {}
const t = (key, fallback) => {
  const mod = __labels || {};
  if (typeof mod.t === 'function') return mod.t(key, fallback);
  if (typeof mod.getLabel === 'function') return mod.getLabel(key, fallback);
  const dict = mod.labels || mod.default || mod || {};
  const val = String(key).split('.').reduce((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), dict);
  return (val == null || val === '') ? (fallback ?? key) : String(val);
};

import { useQuery, useQueryClient, useIsFetching } from '@tanstack/react-query';

// -------- helpers --------
async function fetchMyProfile() {
  const { data: ures } = await supabase.auth.getUser();
  const uid = ures?.user?.id;
  if (!uid) return null; // <--- добавлена проверка: не трогаем profiles без юзера
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('role, company_id')
      .eq('id', uid)
      .maybeSingle();
    return prof || null;
  } catch {
    return null;
  }
}

function toBool(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 't' || s === 'yes' || s === 'y';
  }
  return false;
}

async function __fetchCanViewAll() {
  try {
    const prof = await fetchMyProfile();
    if (!prof?.role || !prof?.company_id) return false;
    const { data: perm } = await supabase
      .from('app_role_permissions')
      .select('value')
      .eq('company_id', prof.company_id)
      .eq('role', prof.role)
      .eq('key', 'canViewAllOrders')
      .maybeSingle();

    // по умолчанию разрешаем, если записи нет
    const val = perm?.value;
    const parsed = toBool(val);
    return parsed === null ? true : parsed;
  } catch {
    return false;
  }
}

const PATHS = {
  home: '/orders',
  orders: '/orders/my-orders',
  all: '/orders/all-orders',
  calendar: '/orders/calendar',
};

function TabButton({ label, active, onPress, colors }) {
  return (
    <Pressable style={styles.btn} onPress={onPress} android_ripple={{ borderless: false }}>
      <Text style={[styles.label, { color: active ? colors.active : colors.inactive }]}>
        {typeof label === 'string' ? label : String(label || '')}
      </Text>
      {active ? <View style={[styles.indicator, { backgroundColor: colors.active }]} /> : null}
    </Pressable>
  );
}

function BottomNavInner() {
  const pathname = usePathname() || '';
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { setAnchorOffset } = useToast();
  const qc = useQueryClient();
  const { data: role, isLoading: roleLoading } = useQuery({ queryKey: ['userRole'], queryFn: getUserRole,staleTime: 5 * 60 * 1000, refetchOnMount: false, placeholderData: (p) => p });
  const { data: canAll, isLoading: canAllLoading } = useQuery({ queryKey: ['perm-canViewAll'], queryFn: __fetchCanViewAll, staleTime: 5 * 60 * 1000, refetchOnMount: false, placeholderData: (p) => p, enabled: !!role });
  const isFetching = useIsFetching();
  const [navVisible, setNavVisible] = React.useState(false);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (navVisible) {
      Animated.timing(appear, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    } else {
      appear.setValue(0);
    }
  }, [navVisible, appear]);
  const pollTimer = useRef(null);
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

  const appStateRef = useRef(AppState.currentState);

  const doRefresh = async () => { try { await qc.invalidateQueries({ queryKey: ['perm-canViewAll'] }); } catch {} };

  // «страховочный» короткий пуллинг после события (5 раз по 2с)
  const kickoffSafetyPoll = () => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    let ticks = 0;
    pollTimer.current = setInterval(async () => {
      ticks += 1;
      await doRefresh();
      if (ticks >= 5) { clearInterval(pollTimer.current); pollTimer.current = null; }
    }, 1200);
  };

  useEffect(() => {
    let alive = true;
    let ch, chDb;

    (async () => {
      if (!alive) return;
      await doRefresh();

      // Broadcast от RoleAccessSettings
      ch = supabase.channel('permissions', { config: { broadcast: { self: true } } });
      ch.on('broadcast', { event: 'perm_changed' }, () => {
        doRefresh();
        kickoffSafetyPoll();
      });
      ch.subscribe();

      // Realtime по конкретной записи
      const prof = await fetchMyProfile();
      chDb = supabase.channel('perm-db');
      if (prof?.company_id && prof?.role) {
        const filter = [
          `company_id=eq.${prof.company_id}`,
          `role=eq.${prof.role}`,
          `key=eq.canViewAllOrders`,
        ].join(',');
        ['INSERT', 'UPDATE', 'DELETE'].forEach((evt) => {
          chDb.on(
            'postgres_changes',
            { event: evt, schema: 'public', table: 'app_role_permissions', filter },
            () => {
              doRefresh();
              kickoffSafetyPoll();
            }
          );
        });
      }
      chDb.subscribe();
    })();

    // рефреш при возврате приложения на передний план
    const onAppStateChange = (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        doRefresh();
      }
      appStateRef.current = nextState;
    };
    const sub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      alive = false;
      sub.remove();
      try {
        if (ch) supabase.removeChannel(ch);
        if (chDb) supabase.removeChannel(chDb);
      } catch {}
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, []);

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
    return () => { if (t) clearTimeout(t); };
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
          paddingBottom: Math.max(insets.bottom, 8),
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
      ]}
    >
      {/* гарантированный ремоунт при смене canAll */}
      <View key={`variant-${Number(!!canAll)}`} style={styles.bar} onLayout={(e) => { const h = e.nativeEvent.layout.height; if (setAnchorOffset) setAnchorOffset(h + 24); }}>
        <TabButton
          key="tab-home"
          label={t("bottomNav.home", "Главная")}
          active={activeKey === 'home'}
          onPress={() => { if (activeKey !== 'home') router.replace(PATHS.home); }}
          colors={colors}
        />

        {canAll ? (
          <>
            <TabButton
              key="tab-orders"
              label={t("bottomNav.my", "Мои")}
              active={activeKey === 'orders'}
              onPress={() => { if (activeKey !== 'orders') router.replace(PATHS.orders); }}
              colors={colors}
            />
            <TabButton
              key="tab-all"
              label={t("bottomNav.all", "Все")}
              active={activeKey === 'all'}
              onPress={() => { if (activeKey !== 'all') router.replace(PATHS.all); }}
              colors={colors}
            />
          </>
        ) : (
          <TabButton
            key="tab-orders-only"
            label={t("bottomNav.myOrders", "Мои заявки")}
            active={activeKey === 'orders'}
            onPress={() => { if (activeKey !== 'orders') router.replace(PATHS.orders); }}
            colors={colors}
          />
        )}

        <TabButton
          key="tab-calendar"
          label={t("bottomNav.calendar", "Календарь")}
          active={activeKey === 'calendar'}
          onPress={() => { if (activeKey !== 'calendar') router.replace(PATHS.calendar); }}
          colors={colors}
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
    height: 56,
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
