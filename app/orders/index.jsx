// app/orders/index.jsx
import React from 'react';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, Animated, Easing, Platform, ActivityIndicator, BackHandler } from 'react-native';
import { ToastAndroid } from 'react-native';
import { useTheme } from '../../theme';
import UniversalHome from '../../components/UniversalHome';
import { getUserRole, subscribeAuthRole } from '../../lib/getUserRole';
import { supabase } from '../../lib/supabase';
import { useQuery, useQueryClient, useIsFetching } from '@tanstack/react-query';

// Показывать полноэкранный сплэш только на самом первом заходе на Home
let _HOME_BOOT_DONE = false;

/**
 * Цели этого патча:
 * 1) Убрать "двойные" спиннеры и дерганья роли.
 * 2) Показать единый красивый полноэкранный лоадер до тех пор,
 *    пока роль получена и сеть "успокоилась" (нет активных запросов React Query).
 * 3) Не ломать существующий код и навигацию.
 */

// --- PremiumLoader: минималистичный «дорогой» экран загрузки (без мерцаний) ---
function PremiumLoader({ text = 'Подготавливаем рабочее пространство' }) {
  const dot1 = React.useRef(new Animated.Value(0.4)).current;
  const dot2 = React.useRef(new Animated.Value(0.4)).current;
  const dot3 = React.useRef(new Animated.Value(0.4)).current;

  React.useEffect(() => {
    const seq = Animated.stagger(160, [
      Animated.loop(Animated.sequence([
        Animated.timing(dot1, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(dot1, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(dot2, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(dot2, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(dot3, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(dot3, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ])),
    ]);
    seq.start();
    return () => { dot1.stopAnimation(); dot2.stopAnimation(); dot3.stopAnimation(); };
  }, [dot1, dot2, dot3]);

  // На главной аппаратная кнопка "назад" ничего не делает
  useFocusEffect(
  React.useCallback(() => {
    const onBack = () => true;
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [])
);

  // На главной «назад» ничего не делает (Android)
  useFocusEffect(React.useCallback(() => {
    const onBack = () => true;
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, []));

  return (
    <View style={styles.loaderRoot} pointerEvents="none">
      <ActivityIndicator size="large" color="#6A6A6A" />
      <View style={{ height: 16 }} />
      <View style={styles.loaderTextRow}>
        <Text style={styles.loaderText}>{text}</Text>
        <Animated.Text style={[styles.loaderDots, { opacity: dot1 }]}>.</Animated.Text>
        <Animated.Text style={[styles.loaderDots, { opacity: dot2 }]}>.</Animated.Text>
        <Animated.Text style={[styles.loaderDots, { opacity: dot3 }]}>.</Animated.Text>
      </View>
    </View>
  );
}



// --- Shared helpers to resolve permission "canViewAllOrders" ---
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

async function fetchMyProfile() {
  const { data: ures } = await supabase.auth.getUser();
  const uid = ures?.user?.id;
  if (!uid) return null;
  const { data: prof } = await supabase
    .from('profiles')
    .select('role, company_id')
    .eq('id', uid)
    .maybeSingle();
  return prof || null;
}

async function fetchCanViewAll() {
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
    const parsed = toBool(perm?.value);
    // по умолчанию разрешаем, если записи нет
    return parsed === null ? true : parsed;
  } catch {
    return false;
  }
}

export default function IndexScreen() {
  const { theme } = useTheme();
  const qc = useQueryClient();

  // Параллельно тянем разрешение на просмотр всех заявок (кэш общий через React Query)
  const { data: canViewAll, isLoading: isPermLoading } = useQuery({
    queryKey: ['perm-canViewAll'],
    queryFn: fetchCanViewAll,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });
  const isFetching = useIsFetching(); // все активные запросы react-query

  // Роль пользователя из кэша с SWR
  const { data: role, isLoading } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });

  // Лайв-обновление роли без спиннера
  React.useEffect(() => {
    const unsub = subscribeAuthRole((r) => {
      qc.setQueryData(['userRole'], r);
    });
    return () => unsub && unsub();
  }, [qc]);

  const readyByRole = React.useMemo(
    () => ['worker', 'dispatcher', 'admin'].includes((role || '').toString()),
    [role]
  );

  // Редирект в логин, если роли нет (и загрузки роли уже нет)
  React.useEffect(() => {
    if (!isLoading && (role === null || role === undefined)) {
      router.replace('/(auth)/login');
    }
  }, [isLoading, role]);

  // Управление единым оверлеем загрузки
  const initialSplash = React.useRef(!_HOME_BOOT_DONE).current;
  const [splashVisible, setSplashVisible] = React.useState(initialSplash);
  const splashStart = React.useRef(Date.now());
  const MIN_SPLASH_MS = 600;     // минимум 600мс, чтобы анимация выглядела «дорогой»
  const NET_IDLE_GRACE_MS = 280; // небольшой «люфт» после окончания запросов

  React.useEffect(() => {
    // После первого успешного показа не держим сплэш на последующих заходах
    if (!initialSplash) { if (splashVisible) setSplashVisible(false); return; }
    let t1 = null;
    if (!readyByRole || isLoading) {
      setSplashVisible(true);
      return () => { if (t1) clearTimeout(t1); };
    }
    if (isFetching === 0) {
      const elapsed = Date.now() - splashStart.current;
      const waitMin = Math.max(0, MIN_SPLASH_MS - elapsed);
      t1 = setTimeout(() => { setSplashVisible(false); _HOME_BOOT_DONE = true; }, Math.max(waitMin, NET_IDLE_GRACE_MS));
    }
    return () => { if (t1) clearTimeout(t1); };
  }, [readyByRole, isLoading, isFetching, splashVisible, initialSplash]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Рендерим контент только когда роль валидна, но под оверлеем */}
      {readyByRole ? <UniversalHome role={role} /> : null}

      {/* Единый «премиум» оверлей загрузки */}
      {splashVisible && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' }]}>
          <PremiumLoader />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loaderRoot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#00000020',
    borderTopColor: '#00000070',
    ...(Platform.OS === 'ios' ? { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6 } : { elevation: 2 }),
  },
  loaderTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
  },
  loaderDots: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8E8E93',
    width: 8,
    textAlign: 'center',
  },
});
