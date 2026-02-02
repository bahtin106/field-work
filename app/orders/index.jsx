/* global console, __DEV__ */

// app/orders/index.jsx
import { useFocusEffect } from '@react-navigation/native';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../../components/hooks/useAuth';
import UniversalHome from '../../components/UniversalHome';
import appReadyState from '../../lib/appReadyState';
import { getUserRole, subscribeAuthRole } from '../../lib/getUserRole';
import { prefetchManager } from '../../lib/prefetch';
import { onSessionEpoch } from '../../lib/sessionEpoch';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';

// Убираем глобальный «одноразовый» флаг и делаем состояние загрузки привязанным к сессии
// Это предотвращает белый экран при повторном логине: каждый логин имеет собственный bootstrap.

// --- PremiumLoader: минималистичный «дорогой» экран загрузки (без мерцаний) ---
function PremiumLoader({ text = 'Подготавливаем рабочее пространство' }) {
  const dot1 = React.useRef(new Animated.Value(0.4)).current;
  const dot2 = React.useRef(new Animated.Value(0.4)).current;
  const dot3 = React.useRef(new Animated.Value(0.4)).current;

  React.useEffect(() => {
    const seq = Animated.stagger(160, [
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot1, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(dot1, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot2, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot3, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        ]),
      ),
    ]);
    seq.start();
    return () => {
      dot1.stopAnimation();
      dot2.stopAnimation();
      dot3.stopAnimation();
    };
  }, [dot1, dot2, dot3]);

  // На главной аппаратная кнопка "назад" ничего не делает
  useFocusEffect(
    React.useCallback(() => {
      const onBack = () => true;
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, []),
  );

  return (
    <View style={styles.loaderRoot} pointerEvents="none">
      <ActivityIndicator size="large" color="#6A6A6A" />
      <View style={{ height: 16 }} />
      <Text style={styles.loaderText}>{text}</Text>
      <View style={styles.loaderDotsRow}>
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
  const { user: authUser, profile: authProfile } = useAuth();

  // Параллельно тянем разрешение на просмотр всех заявок (кэш общий через React Query)
  const { data: canViewAll, isLoading: isPermLoading } = useQuery({
    queryKey: ['perm-canViewAll'],
    queryFn: fetchCanViewAll,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
    enabled: !!authUser,
  });

  // КРИТИЧНО: Таймаут для isPermLoading
  React.useEffect(() => {
    if (!isPermLoading) return;

    const timeout = setTimeout(() => {
      qc.setQueryData(['perm-canViewAll'], true); // fallback: даём разрешение по умолчанию
    }, 3000); // сокращаем до 3 секунд

    return () => clearTimeout(timeout);
  }, [isPermLoading, qc]);

  // учитываем только критические запросы (роль, права), чтобы не блокировать загрузку из-за фоновых префетчей
  const criticalFetching = useIsFetching({
    predicate: (q) => {
      const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
      return key0 === 'userRole' || key0 === 'perm-canViewAll';
    },
  });
  const [forceReadyReason, setForceReadyReason] = React.useState(null);

  // Роль пользователя из кэша с SWR
  const profileRole = authProfile?.role ?? null;
  const profileSource = authProfile?.__source ?? null;
  const profileRoleIsFallback = profileSource === 'fallback' || profileSource === 'optimistic';
  const hasTrustedProfileRole = !!profileRole && !profileRoleIsFallback;

  const { data: roleFromQuery, isLoading: roleQueryLoading } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
    enabled: !hasTrustedProfileRole,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'stale',
    placeholderData: (prev) => prev,
  });
  const role = hasTrustedProfileRole ? profileRole : roleFromQuery || profileRole || 'worker';
  const isRoleLoading = hasTrustedProfileRole ? false : roleQueryLoading;

  // КРИТИЧНО: Гарантируем что isLoading сбросится через 8 секунд максимум
  React.useEffect(() => {
    if (!isRoleLoading) return;

    const timeout = setTimeout(() => {
      // Принудительно устанавливаем роль worker если загрузка застряла
      qc.setQueryData(['userRole'], 'worker');
    }, 4000); // сокращаем до 4 секунд

    return () => clearTimeout(timeout);
  }, [isRoleLoading, qc]);

  // Лайв-обновление роли без спиннера
  React.useEffect(() => {
    const unsub = subscribeAuthRole((r) => {
      qc.setQueryData(['userRole'], r);
    });
    return () => unsub && unsub();
  }, [qc]);

  // Гарантированно прячем Expo Splash при заходе на экран (после логина)
  useFocusEffect(
    React.useCallback(() => {
      let done = false;
      (async () => {
        try {
          await SplashScreen.hideAsync();
        } catch {}
        // страховка: повторно через тик
        setTimeout(() => {
          if (!done) {
            try {
              SplashScreen.hideAsync();
            } catch {}
          }
        }, 120);
      })();
      return () => {
        done = true;
      };
    }, []),
  );

  // Запуск фоновой предзагрузки данных (профессиональный подход)
  React.useEffect(() => {
    // Инициализируем prefetch с QueryClient
    prefetchManager.init(qc);

    // Запускаем через 500ms - данные должны быть готовы до открытия страниц
    const timer = setTimeout(() => {
      prefetchManager.start();
    }, 500);

    return () => {
      clearTimeout(timer);
      prefetchManager.stop();
    };
  }, [qc]);

  // Новая логика bootstrap: независимая от глобального флага, действует на каждую сессию
  // Состояния:
  //  - 'boot': начальное после навигации на экран
  //  - 'fetching': активные сетевые запросы / роль ещё не определена
  //  - 'ready': основное содержимое доступно
  // Используем централизованное состояние для синхронизации с bottom bar
  const [bootState, setBootState] = React.useState(() => {
    // При инициализации проверяем: если есть кэшированные данные - сразу ready
    const cachedRole = qc.getQueryData(['userRole']);
    const globalState = appReadyState.getBootState();
    if (cachedRole && globalState === 'ready') {
      return 'ready';
    }
    return 'boot';
  });

  // Подписываемся на изменения глобального состояния для синхронизации
  React.useEffect(() => {
    const unsubscribe = appReadyState.subscribe((newState) => {
      setBootState(newState);
    });
    return unsubscribe;
  }, []);

  const MIN_BOOT_MS = 200; // Уменьшено с 600 до 200ms - быстрый старт благодаря кэшу!
  const MAX_BOOT_MS = 6000; // Снижено с 15000 до 6000ms - дополнительный таймаут в SimpleAuthProvider гарантирует fallback за 5 сек

  // activeFetching НЕ включает !role, т.к. роль может быть в кэше мгновенно
  // КРИТИЧНО: Используем timestamp для принудительного завершения через MAX_BOOT_MS
  const [fetchStartTime] = React.useState(Date.now());
  const activeFetching = React.useMemo(() => {
    if (forceReadyReason) return true;
    return criticalFetching > 0 || isRoleLoading || isPermLoading;
  }, [criticalFetching, isRoleLoading, isPermLoading, forceReadyReason]);

  // Сброс bootstrap при смене session epoch (повторный логин / логаут)
  React.useEffect(() => {
    const unsub = onSessionEpoch(() => {
      // Очищаем весь кэш при смене сессии
      qc.clear();
      appReadyState.reset();
      setBootState('boot');
    });
    return unsub;
  }, [qc]);

  // Страховка: при первом монтировании проверяем состояние
  React.useEffect(() => {
    const currentState = appReadyState.getBootState();
    if (currentState !== bootState) {
      setBootState(currentState);
    }
  }, []);

  // Основной эффект: переход в ready когда загрузки завершены + минимальное время прошло
  React.useEffect(() => {
    if (bootState === 'ready') {
      setForceReadyReason(null);
      appReadyState.setBootState('ready');
      return;
    }

    if (!activeFetching) {
      const elapsed = Date.now() - appReadyState.getMountTs();
      const wait = Math.max(0, MIN_BOOT_MS - elapsed);
      const t = setTimeout(() => {
        appReadyState.setBootState('ready');
      }, wait);
      return () => clearTimeout(t);
    } else if (bootState !== 'fetching') {
      appReadyState.setBootState('fetching');
    }
  }, [activeFetching, bootState, MIN_BOOT_MS]);

  React.useEffect(() => {
    if (bootState === 'ready') {
      setForceReadyReason(null);
      return;
    }
    const elapsed = Date.now() - fetchStartTime;
    if (elapsed > MAX_BOOT_MS && (criticalFetching > 0 || isRoleLoading || isPermLoading)) {
      setForceReadyReason((prev) => prev || 'timeout');
      appReadyState.setBootState('ready');
      setBootState('ready');
    }
    const timer = setTimeout(() => {
      if (bootState !== 'ready' && (criticalFetching > 0 || isRoleLoading || isPermLoading)) {
        setForceReadyReason((prev) => prev || 'timeout');
        appReadyState.setBootState('ready');
        setBootState('ready');
      }
    }, MAX_BOOT_MS);
    return () => clearTimeout(timer);
  }, [bootState, fetchStartTime, MAX_BOOT_MS, criticalFetching, isRoleLoading, isPermLoading]);

  // Независимый таймаут принудительного снятия лоадера (защита от зависания)

  const showLoader = bootState !== 'ready';
  const loaderText = forceReadyReason
    ? 'Не удалось загрузить профиль. Проверьте сеть и попробуйте еще раз.'
    : 'Загружаем профиль...';

  // ДИАГНОСТИКА: Логируем состояние загрузки для отладки
  React.useEffect(() => {
    if (showLoader) {
      console.log('[Orders] Spinner visible:', {
        bootState,
        hasTrustedRole: hasTrustedProfileRole,
        profileRole,
        profileSource,
        isRoleLoading,
        isPermLoading,
        criticalFetching,
        forceReadyReason,
        elapsed: Date.now() - fetchStartTime,
      });
    } else if (bootState === 'ready') {
      console.log('[Orders] Spinner hidden, showing content');
    }
  }, [showLoader, bootState]);

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      onLayout={() => {
        try {
          SplashScreen.hideAsync();
        } catch (e) {}
      }}
    >
      {forceReadyReason && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>
            Не удалось загрузить профиль. Проверьте сеть и попробуйте еще раз.
          </Text>
        </View>
      )}
      {/* Рендерим контент только когда роль валидна, но под оверлеем */}
      {/* При холодном запуске показываем сплэш, пока не загрузится роль и не завершится fetch */}
      {/* Показываем рабочий интерфейс сразу, роль может быть fallback пока не уточнена */}
      <UniversalHome role={role || 'worker'} user={authUser} profile={authProfile} />

      {/* Единый «премиум» оверлей загрузки */}
      {showLoader && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: theme.colors.background,
              justifyContent: 'center',
              alignItems: 'center',
            },
          ]}
        >
          <PremiumLoader text={loaderText} />
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
    ...(Platform.OS === 'ios'
      ? { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6 }
      : { elevation: 2 }),
  },
  loaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
    textAlign: 'center',
    maxWidth: 280,
    paddingHorizontal: 12,
  },
  loaderDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderDots: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8E8E93',
    width: 8,
    textAlign: 'center',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#FDECEA',
    borderWidth: 1,
    borderColor: '#F5C2C0',
  },
  errorBannerText: {
    color: '#8A1C1C',
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 14,
  },
});
