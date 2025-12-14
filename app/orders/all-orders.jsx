/* global __DEV__ */
// app/orders/all-orders.jsx

import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import DynamicOrderCard from '../../components/DynamicOrderCard';
import Screen from '../../components/layout/Screen';
import AppHeader from '../../components/navigation/AppHeader';
import Button from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';
import { usePermissions } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../lib/workTypes';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

const PERM_CACHE = (globalThis.PERM_CACHE ||= { canViewAll: { value: null, ts: 0 } });
const PERM_TTL_MS = 10 * 60 * 1000;
const DEBUG_ALL_ORDERS = false;
const logAllOrders = (...args) => {
  if (DEBUG_ALL_ORDERS && __DEV__) console.warn(...args);
};

// ===== HARD PERMISSION GUARD (independent from usePermissions) =====
async function checkCanViewAll() {
  try {
    // 1) get current user's role from profiles
    const { data: me, error: e1 } = await supabase
      .from('profiles')
      .select('role')
      .eq(
        'id',
        (await supabase.auth.getUser()).data?.user?.id || '00000000-0000-0000-0000-000000000000',
      )
      .single();
    if (e1 || !me?.role) return false;
    // 2) check role permission
    const { data: perm, error: e2 } = await supabase
      .from('app_role_permissions')
      .select('value')
      .eq('role', me.role)
      .eq('key', 'canViewAllOrders')
      .eq('value', true)
      .maybeSingle();
    if (e2) return false;
    return !!perm?.value === true;
  } catch {
    return false;
  }
}

function mapStatusToDB(key) {
  switch (key) {
    case 'new':
      return 'Новый';
    case 'in_progress':
      return 'В работе';
    case 'done':
      return 'Завершённая';
    default:
      return null;
  }
}

export default function AllOrdersScreen() {
  // local, definitive permission flag
  const [allowed, setAllowed] = useState(() => {
    const rec = PERM_CACHE.canViewAll;
    return rec && Date.now() - (rec.ts || 0) < PERM_TTL_MS ? rec.value : null;
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ok = await checkCanViewAll();
        if (!alive) return;
        setAllowed(ok);
        PERM_CACHE.canViewAll = { value: ok, ts: Date.now() };
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  const { theme } = useTheme();
  const { t } = useTranslation();
  const mutedColor = theme.colors.textSecondary ?? theme.colors.muted ?? '#8E8E93';
  const { has } = usePermissions();
  const queryClient = useQueryClient();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // ВНИМАНИЕ: стили карточки из старой реализации остаются, но карточку теперь рендерит DynamicOrderCard
        titleRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        },

        urgentDot: {
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: theme.colors.danger,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 6,
        },
        urgentDotText: {
          color: theme.colors.onPrimary,
          fontSize: 12,
          fontWeight: '700',
          lineHeight: 12,
        },

        statusBadge: {
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 10,
        },
        statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
        statusPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

        statusText: {
          fontSize: 12,
          fontWeight: '600',
          color: theme.colors.onPrimary,
        },

        executorRowSelected: {
          backgroundColor: theme.colors.surface,
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 12,
        },

        searchInput: {
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          marginBottom: 12,
          fontSize: 15,
          backgroundColor: theme.colors.inputBg,
        },
        executorOption: {
          paddingVertical: 10,
          paddingHorizontal: 6,
        },
        executorText: {
          fontSize: 15,
          color: theme.colors.text,
        },

        executorRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        checkmark: {
          fontSize: 16,
          color: theme.colors.primary,
          fontWeight: '600',
        },
        separator: {
          height: 1,
          backgroundColor: theme.colors.border,
          marginVertical: 4,
        },

        dropdownButton: {
          backgroundColor: theme.colors.surface,
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 14,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        dropdownButtonText: {
          color: theme.colors.text,
          fontSize: 14,
        },
        modalOverlay: {
          flex: 1,
          backgroundColor: theme.colors.overlay,
          justifyContent: 'flex-end',
        },
        modalContent: {
          backgroundColor: theme.colors.surface,
          padding: 16,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: '70%',
        },
        clearButton: {
          marginTop: 12,
          backgroundColor: theme.colors.border,
          paddingVertical: 10,
          borderRadius: 10,
          alignItems: 'center',
        },
        clearButtonText: {
          color: theme.colors.primary,
          fontWeight: '500',
        },

        container: { padding: 16, paddingBottom: 40, backgroundColor: theme.colors.background },
        header: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: theme.colors.text },

        filterContainer: {
          flexDirection: 'row',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        },
        chip: {
          paddingVertical: 8,
          paddingHorizontal: 14,
          backgroundColor: theme.colors.inputBg,
          borderRadius: 20,
        },
        chipActive: {
          backgroundColor: theme.colors.primary,
        },
        chipText: {
          fontSize: 14,
          color: theme.colors.text,
        },
        chipTextActive: {
          color: theme.colors.onPrimary,
          fontWeight: '600',
        },
        executorScroll: {
          marginBottom: 20,
        },
        chipSmall: {
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 16,
          backgroundColor: theme.colors.inputBg,
          marginRight: 8,
        },
        chipSmallActive: {
          backgroundColor: theme.colors.primary,
        },
        chipSmallText: {
          fontSize: 13,
          color: theme.colors.text,
        },
        chipSmallTextActive: {
          color: theme.colors.onPrimary,
          fontWeight: '500',
        },

        card: {
          backgroundColor: theme.colors.surface,
          borderRadius: 14,
          padding: 16,
          marginBottom: 12,
          ...(theme.shadows?.card?.[Platform.OS] || {}),
        },
        cardTitle: {
          fontSize: 16,
          fontWeight: '600',
          marginBottom: 6,
          color: theme.colors.text,
        },
        cardSubtitle: {
          fontSize: 14,
          color: mutedColor,
          marginBottom: 2,
        },

        bottomRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
        },
        dateRow: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        cardDate: {
          fontSize: 13,
          color: mutedColor,
        },
        cardExecutor: { fontSize: 13, color: mutedColor },
        emptyText: {
          textAlign: 'center',
          marginTop: 32,
          fontSize: 16,
          color: mutedColor,
        },
      }),
    [theme],
  );

  const router = useRouter();

  // Из вкладки «Все» аппаратная Назад ведёт на Главную
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        router.replace('/orders');
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  // Global cache with TTL
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут (совпадает с React Query staleTime)
  const LIST_CACHE = (globalThis.LIST_CACHE ||= {});
  LIST_CACHE.all ||= {};
  const { filter, executor, department, search, work_type, materials } = useLocalSearchParams();

  const [statusFilter, setStatusFilter] = useState(
    filter === 'completed'
      ? 'done'
      : filter === 'in_progress'
        ? 'in_progress'
        : filter === 'new'
          ? 'new'
          : filter || 'all',
  );

  // Вычисляем начальный cacheKey на основе реального statusFilter
  const cacheKeyInitial = useMemo(() => {
    const initialStatus =
      filter === 'completed'
        ? 'done'
        : filter === 'in_progress'
          ? 'in_progress'
          : filter === 'new'
            ? 'new'
            : filter || 'all';
    return JSON.stringify({ status: initialStatus, ex: null, dept: null, wt: '' });
  }, [filter]);

  const hydratedRef = useRef(false);

  const [orders, setOrders] = useState(() => {
    // 1. Проверяем prefetch кэш для быстрого старта
    const prefetchData = queryClient.getQueryData(['orders', 'all', 'recent']);
    if (prefetchData && Array.isArray(prefetchData) && prefetchData.length > 0) {
      hydratedRef.current = true; // Сразу помечаем как гидратированный!
      logAllOrders(`[AllOrders] 🚀 MOUNT: Found ${prefetchData.length} items in prefetch cache!`);
      return prefetchData;
    }

    // 2. Проверяем React Query кэш с фильтрами
    const queryKey = ['orders', 'all', cacheKeyInitial];
    const cachedQueryData = queryClient.getQueryData(queryKey);
    if (cachedQueryData) {
      logAllOrders(
        `[AllOrders] 🚀 MOUNT: Found ${cachedQueryData.length} items in React Query cache!`,
      );
      return cachedQueryData;
    }

    // 3. Fallback на globalThis
    const cached = LIST_CACHE.all[cacheKeyInitial];
    if (cached?.data) {
      logAllOrders(`[AllOrders] MOUNT: Found ${cached.data.length} items in globalThis cache`);
      return cached.data;
    }

    return [];
  });

  const [loading, setLoading] = useState(() => {
    // Если есть prefetch данные - не показываем лоадер
    const prefetchData = queryClient.getQueryData(['orders', 'all', 'recent']);
    if (prefetchData && Array.isArray(prefetchData) && prefetchData.length > 0) {
      logAllOrders(`[AllOrders] MOUNT: loading=false (prefetch cache hit)`);
      return false;
    }

    // Если есть данные в кэше - не показываем лоадер
    const queryKey = ['orders', 'all', cacheKeyInitial];
    const cachedQueryData = queryClient.getQueryData(queryKey);
    if (cachedQueryData) {
      logAllOrders(`[AllOrders] MOUNT: loading=false (React Query cache hit)`);
      return false;
    }

    const cached = LIST_CACHE.all[cacheKeyInitial];
    if (cached?.data) {
      logAllOrders(`[AllOrders] MOUNT: loading=false (globalThis cache hit)`);
      return false;
    }

    return true;
  });

  const [refreshing, setRefreshing] = useState(false);
  const [executorFilter, setExecutorFilter] = useState(executor || null);

  // Пагинация (как в Instagram/Telegram)
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 10;

  const [departmentFilter, setDepartmentFilter] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [departmentFilterInit] = useState(department ? Number(department) : null);
  useEffect(() => {
    if (departmentFilterInit != null && !Number.isNaN(departmentFilterInit))
      setDepartmentFilter(Number(departmentFilterInit));
  }, []);
  const [workTypeFilter, setWorkTypeFilter] = useState(
    work_type
      ? String(work_type)
          .split(',')
          .map((s) => Number(s))
          .filter((n) => !Number.isNaN(n))
      : [],
  );
  const [materialsFilter, setMaterialsFilter] = useState(
    materials
      ? String(materials)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );
  const [searchQuery, setSearchQuery] = useState(String(search || '').trim());

  // Work types bootstrap
  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cid = await getMyCompanyId();
        if (!alive) return;
        if (cid) {
          const { useWorkTypes: flag, types } = await fetchWorkTypes(cid);
          if (!alive) return;
          setUseWorkTypesFlag(!!flag);
          setWorkTypes(types || []);
        } else {
          setUseWorkTypesFlag(false);
          setWorkTypes([]);
        }
      } catch {
        setUseWorkTypesFlag(false);
        setWorkTypes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ✅ FIX: missing states causing ReferenceError
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ work_type: [], materials: [] });
  const [tmpWorkType, setTmpWorkType] = useState(workTypeFilter || []);
  const [tmpMaterials, setTmpMaterials] = useState(materialsFilter || []);
  const [tmpExecutor, setTmpExecutor] = useState(executorFilter || null);
  const [executors, setExecutors] = useState([]);
  const [executorSearch, setExecutorSearch] = useState('');

  const sortedExecutors = useMemo(() => {
    const list = executors ? [...executors] : [];
    return list.sort((a, b) => {
      const an = [a.first_name || '', a.last_name || ''].join(' ').trim();
      const bn = [b.first_name || '', b.last_name || ''].join(' ').trim();
      return an.localeCompare(bn, 'ru');
    });
  }, [executors]);
  const sortedWorkTypes = useMemo(() => {
    return [...(filterOptions.work_type || [])].sort((a, b) =>
      String(a).localeCompare(String(b), 'ru'),
    );
  }, [filterOptions.work_type]);
  const sortedMaterials = useMemo(() => {
    return [...(filterOptions.materials || [])].sort((a, b) =>
      String(a).localeCompare(String(b), 'ru'),
    );
  }, [filterOptions.materials]);
  const filteredExecutors = useMemo(() => {
    let list = executors || [];
    // constrain by department when selected
    if (departmentFilter != null) {
      list = list.filter((e) => Number(e.department_id) === Number(departmentFilter));
    }
    const q = (executorSearch || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) =>
      ([e.first_name, e.last_name].filter(Boolean).join(' ') || '').toLowerCase().includes(q),
    );
  }, [executors, executorSearch, departmentFilter]);

  const cacheKey = useMemo(
    () =>
      JSON.stringify({
        status: statusFilter,
        ex: executorFilter || null,
        dept: departmentFilter || null,
        wt: (workTypeFilter || []).join(','),
      }),
    [statusFilter, executorFilter, departmentFilter, workTypeFilter],
  );

  // Ensure executor selection is consistent with selected department
  useEffect(() => {
    if (departmentFilter == null || !executorFilter) return;
    const ex = executors.find((e) => e.id === executorFilter);
    if (ex && Number(ex.department_id) !== Number(departmentFilter)) {
      setExecutorFilter(null);
    }
  }, [departmentFilter, executorFilter, executors]);

  // ✅ Serve cached data immediately when filters change (fix for stale list after toggling chips)
  useEffect(() => {
    // Проверяем React Query кэш ПЕРВЫМ
    const queryKey = ['orders', 'all', cacheKey];
    const cachedQueryData = queryClient.getQueryData(queryKey);

    if (cachedQueryData) {
      if (__DEV__)
        console.warn(
          `[Orders] Filter changed - loaded from React Query cache (${cachedQueryData.length} items)`,
        );
      setOrders(cachedQueryData);
      setLoading(false);
      return;
    }

    // Fallback на globalThis
    const cached = LIST_CACHE.all[cacheKey];
    if (cached) {
      if (__DEV__)
        console.warn(
          `[Orders] Filter changed - loaded from globalThis cache (${cached.data?.length || 0} items)`,
        );
      setOrders(cached.data || []);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }, [cacheKey, queryClient]);

  useEffect(() => {
    const fetchExecutors = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, department_id')
        .neq('role', 'client');

      if (!error) setExecutors(data || []);
    };
    fetchExecutors();
  }, []);

  useEffect(() => {
    const fetchDepartments = async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name', { ascending: true });
      if (!error) setDepartments(data || []);
    };
    fetchDepartments();
  }, []);

  useEffect(() => {
    const loadFilterOptions = async () => {
      const { data, error } = await supabase.rpc('get_order_filter_options');
      if (!error && data) {
        setFilterOptions({
          work_type: Array.isArray(data.work_type) ? data.work_type : [],
          materials: Array.isArray(data.materials) ? data.materials : [],
        });
      }
    };
    loadFilterOptions();
  }, []);

  // Helper: resolve order IDs by work types from base table if secure view lacks work_type_id
  const getOrderIdsByWorkTypes = async (types) => {
    try {
      if (!Array.isArray(types) || types.length === 0) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('id')
        .in('work_type_id', types)
        .limit(2000);
      if (error) return [];
      return (data || []).map((r) => r.id).filter(Boolean);
    } catch {
      return [];
    }
  };

  // Auto refresh by TTL (background, no spinner if cache exists)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      // Проверяем React Query кэш ПЕРВЫМ
      const queryKey = ['orders', 'all', cacheKey];
      const cachedQueryData = queryClient.getQueryData(queryKey);
      const queryState = queryClient.getQueryState(queryKey);

      // Если данные есть в React Query И они свежие (< 5 минут) - НЕ ЗАГРУЖАЕМ!
      if (cachedQueryData && queryState?.dataUpdatedAt) {
        const age = Date.now() - queryState.dataUpdatedAt;
        const staleTime = 5 * 60 * 1000; // 5 минут (совпадает с prefetch!)

        if (age < staleTime) {
          logAllOrders(
            `[AllOrders] ✓ Using React Query cache (${cachedQueryData.length} items, age: ${Math.round(age / 1000)}s)`,
          );
          setOrders(cachedQueryData);
          setLoading(false);
          return; // НЕ загружаем с сервера!
        }
      }

      // Fallback: проверяем globalThis cache
      const cached = LIST_CACHE.all[cacheKey];
      const freshNeeded = !cached || Date.now() - (cached.ts || 0) > CACHE_TTL_MS;

      if (!freshNeeded && cached) {
        logAllOrders(
          `[AllOrders] ✓ Loaded from globalThis cache (${cached.data?.length || 0} items)`,
        );
        setOrders(cached.data || []);
        setLoading(false);
        return;
      }

      // Если дошли сюда - нужно загрузить с сервера
      // Если есть prefetch данные и это первая загрузка - используем их
      if (hydratedRef.current && orders.length > 0 && !cached) {
        logAllOrders('[AllOrders] ⏭ Skip network load (using prefetch data)');
        setLoading(false);
        return;
      }

      logAllOrders(`[AllOrders] Loading from network...`);

      // Build base query
      let query = supabase.from('orders_secure').select('*');
      if (statusFilter === 'feed') {
        query = query.is('assigned_to', null);
      } else {
        const statusValue = mapStatusToDB(statusFilter);
        if (statusValue) query = query.eq('status', statusValue);
        if (executorFilter) query = query.eq('assigned_to', executorFilter);
      }
      if (departmentFilter != null) query = query.eq('department_id', Number(departmentFilter));

      // Work types: secure view may not expose work_type_id -> filter by ids from base table
      if (useWorkTypes && Array.isArray(workTypeFilter) && workTypeFilter.length) {
        const ids = await getOrderIdsByWorkTypes(workTypeFilter);
        if (!ids.length) {
          if (!alive) return;
          const emptyResult = [];
          setOrders(emptyResult);
          LIST_CACHE.all[cacheKey] = { data: emptyResult, ts: Date.now() };
          queryClient.setQueryData(queryKey, emptyResult); // Сохраняем в React Query
          setLoading(false);
          return;
        }
        query = query.in('id', ids);
      }

      const { data, error } = await query
        .order('datetime', { ascending: false })
        .range(0, PAGE_SIZE - 1); // ПАГИНАЦИЯ: только первые 10!
      if (!alive) return;
      if (!error) {
        const result = data || [];
        logAllOrders(`[AllOrders] 🌐 Loaded from network (${result.length} items)`);
        setOrders(result);
        setHasMore(result.length === PAGE_SIZE); // Есть ли ещё данные?
        LIST_CACHE.all[cacheKey] = { data: result, ts: Date.now() };
        queryClient.setQueryData(queryKey, result); // Сохраняем в React Query кэш!
      }
      setLoading(false);
    };

    // ВСЕГДА проверяем prefetch СНАЧАЛА и откладываем загрузку
    const prefetchData = queryClient.getQueryData(['orders', 'all', 'recent']);
    if (
      hydratedRef.current &&
      orders.length > 0 &&
      Array.isArray(prefetchData) &&
      prefetchData.length > 0
    ) {
      logAllOrders(
        '[AllOrders] ⏭ Skip immediate fetch (prefetch satisfied), schedule background refresh',
      );
      // Фоновое обновление через задержку (как в my-orders)
      const timer = setTimeout(() => {
        logAllOrders('[AllOrders] 🔄 Background refresh start');
        tick();
      }, 1200);

      // Периодическая проверка каждые 5 минут
      const id = setInterval(tick, 5 * 60 * 1000);

      return () => {
        alive = false;
        clearTimeout(timer);
        clearInterval(id);
      };
    }

    // Если нет prefetch - тоже откладываем на 1200ms (даем время для кэша)
    const timer = setTimeout(() => {
      tick();
    }, 1200);
    const id = setInterval(tick, 5 * 60 * 1000);

    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(id);
    };
  }, [
    cacheKey,
    statusFilter,
    executorFilter,
    departmentFilter,
    workTypeFilter,
    useWorkTypes,
    queryClient,
    orders.length,
  ]);

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      setLoading(true);
      setPage(1); // Сброс пагинации
      setHasMore(true);

      let query = supabase.from('orders_secure').select('*');
      if (statusFilter === 'feed') {
        query = query.is('assigned_to', null);
      } else {
        const statusValue = mapStatusToDB(statusFilter);
        if (statusValue) query = query.eq('status', statusValue);
        if (executorFilter) query = query.eq('assigned_to', executorFilter);
      }
      if (departmentFilter != null) query = query.eq('department_id', Number(departmentFilter));

      if (useWorkTypes && Array.isArray(workTypeFilter) && workTypeFilter.length) {
        const ids = await getOrderIdsByWorkTypes(workTypeFilter);
        if (!ids.length) {
          setOrders([]);
          setHasMore(false);
          LIST_CACHE.all[cacheKey] = { data: [], ts: Date.now() };
          return;
        }
        query = query.in('id', ids);
      }
      const { data, error } = await query
        .order('datetime', { ascending: false })
        .range(0, PAGE_SIZE - 1); // ПАГИНАЦИЯ
      if (!error) {
        const result = data || [];
        setOrders(result);
        setHasMore(result.length === PAGE_SIZE);
        LIST_CACHE.all[cacheKey] = { data: result, ts: Date.now() };
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  const getStatusLabel = (key) => {
    switch (key) {
      case 'feed':
        return 'Лента';
      case 'all':
        return 'Все';
      case 'new':
        return 'Новые';
      case 'in_progress':
        return 'В работе';
      case 'done':
        return 'Завершённые';
      default:
        return '';
    }
  };

  const normalizeStatus = (raw) => {
    if (raw === 'completed') return 'done';
    if (raw === 'in_progress') return 'in_progress';
    if (raw === 'new') return 'new';
    return 'all';
  };

  const formatAddress = (o) => {
    const parts = [o.region, o.city, o.street, o.house]
      .filter(Boolean)
      .map((s) => String(s).trim())
      .filter(Boolean);
    return parts.length ? parts.join(', ') : '—';
  };

  const getExecutorName = (executorId) => {
    if (!executorId) return 'Не назначен';
    const ex = executors.find((e) => e.id === executorId);
    const name = [ex?.first_name, ex?.last_name].filter(Boolean).join(' ').trim();
    return name || 'Не назначен';
  };

  // Поиск: используем phone_visible вместо phone
  const filteredOrders = (orders || []).filter((o) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      o.title,
      o.fio,
      o.customer_phone_visible, // ⬅️ телефон из orders_secure
      o.region,
      o.city,
      o.street,
      o.house,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  // Ленивая загрузка при скролле (как в Instagram/Telegram)
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;

    // Loading next page

    setLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);

    try {
      let query = supabase.from('orders_secure').select('*');
      if (statusFilter === 'feed') {
        query = query.is('assigned_to', null);
      } else {
        const statusValue = mapStatusToDB(statusFilter);
        if (statusValue) query = query.eq('status', statusValue);
        if (executorFilter) query = query.eq('assigned_to', executorFilter);
      }
      if (departmentFilter != null) query = query.eq('department_id', Number(departmentFilter));

      if (useWorkTypes && Array.isArray(workTypeFilter) && workTypeFilter.length) {
        const ids = await getOrderIdsByWorkTypes(workTypeFilter);
        if (!ids.length) {
          setHasMore(false);
          setLoadingMore(false);
          return;
        }
        query = query.in('id', ids);
      }

      const from = (nextPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await query.order('datetime', { ascending: false }).range(from, to);

      if (!error && Array.isArray(data)) {
        setOrders((prev) => [...prev, ...data]);
        setHasMore(data.length === PAGE_SIZE);

        // Loaded successfully
      }
    } finally {
      setLoadingMore(false);
    }
  }, [
    loadingMore,
    hasMore,
    loading,
    page,
    statusFilter,
    executorFilter,
    departmentFilter,
    workTypeFilter,
    useWorkTypes,
  ]);

  // Рендер элемента списка
  const renderItem = useCallback(
    ({ item: order }) => (
      <DynamicOrderCard
        order={order}
        context="all_orders"
        onPress={() =>
          router.push({
            pathname: `/orders/${order.id}`,
            params: {
              returnTo: '/orders/all-orders',
              returnParams: JSON.stringify({
                filter: statusFilter,
                executor: executorFilter,
                department: departmentFilter,
                search: searchQuery,
              }),
            },
          })
        }
      />
    ),
    [router, statusFilter, executorFilter, departmentFilter, searchQuery],
  );

  // Футер со спиннером при загрузке
  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;
    return (
      <View style={{ paddingVertical: 20 }}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }, [loadingMore, theme.colors.primary]);

  const keyExtractor = useCallback((item) => String(item.id), []);

  // Заголовок списка с фильтрами
  const ListHeaderComponent = useCallback(
    () => (
      <View style={{ padding: 16 }}>
        <Text style={styles.header}>Все заявки</Text>

        <View style={styles.filterContainer}>
          {['feed', 'all', 'new', 'in_progress', 'done'].map((key) => (
            <Pressable
              key={key}
              onPress={() => {
                setStatusFilter(key);
                setPage(1);
                setHasMore(true);
                router.setParams({ filter: key });
              }}
              style={[styles.chip, statusFilter === key && styles.chipActive]}
            >
              <Text style={[styles.chipText, statusFilter === key && styles.chipTextActive]}>
                {getStatusLabel(key)}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextField
          placeholder="Поиск по названию, городу, телефону..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={{ marginBottom: 12 }}
        />

        <Button
          variant="secondary"
          onPress={() => {
            setTmpWorkType(workTypeFilter || []);
            setTmpMaterials([]);
            setTmpExecutor(executorFilter || null);
            setFilterModalVisible(true);
          }}
          style={{ marginBottom: 16 }}
          title={
            useWorkTypes && Array.isArray(workTypeFilter) && workTypeFilter.length
              ? `Виды работ: ${workTypeFilter.length}`
              : executorFilter
                ? 'Сотрудник выбран'
                : 'Фильтры'
          }
        />
      </View>
    ),
    [styles, statusFilter, searchQuery, workTypeFilter, executorFilter, useWorkTypes, router],
  );

  return (
    <Screen scroll={false} headerOptions={{ headerShown: false }}>
      <AppHeader
        back
        options={{
          headerTitleAlign: 'left',
          title: t('routes.orders/all-orders'),
        }}
      />
      {allowed === null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : !allowed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text
            style={{
              fontSize: 16,
              color: theme.colors.textSecondary,
              textAlign: 'center',
              paddingHorizontal: 24,
            }}
          >
            Админ вашей компании отключил доступ ко всем заявкам
          </Text>
        </View>
      ) : (
        <>
          <FlatList
            data={filteredOrders}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            ListHeaderComponent={ListHeaderComponent}
            ListFooterComponent={renderFooter}
            ListEmptyComponent={
              loading ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                </View>
              ) : (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <Text style={styles.emptyText}>Заявок не найдено</Text>
                </View>
              )
            }
            contentContainerStyle={[styles.container, filteredOrders.length === 0 && { flex: 1 }]}
            style={{ flex: 1, backgroundColor: theme.colors.background }}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.primary}
                colors={Platform.OS === 'android' ? [theme.colors.primary] : undefined}
              />
            }
          />

          <Modal
            visible={filterModalVisible}
            animationType="slide"
            transparent={true}
            presentationStyle="overFullScreen"
            statusBarTranslucent={true}
            navigationBarTranslucent={true}
            hardwareAccelerated={true}
            onRequestClose={() => setFilterModalVisible(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled={true}
                  contentContainerStyle={{ paddingBottom: 12 }}
                >
                  {/* Work types block is shown only if feature enabled */}
                  {useWorkTypes && (
                    <View>
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: '600',
                          marginBottom: 8,
                          color: theme.colors.text,
                        }}
                      >
                        Виды работ
                      </Text>
                      {Array.isArray(workTypes) && workTypes.length
                        ? workTypes.map((t) => {
                            const active = (tmpWorkType || []).includes(t.id);
                            return (
                              <Pressable
                                key={String(t.id)}
                                style={styles.executorOption}
                                onPress={() => {
                                  setTmpWorkType((prev) => {
                                    const set = new Set(prev || []);
                                    if (set.has(t.id)) set.delete(t.id);
                                    else set.add(t.id);
                                    return Array.from(set);
                                  });
                                }}
                              >
                                <View style={styles.executorRow}>
                                  <Text style={styles.executorText}>{t.name}</Text>
                                  {active && <Text style={styles.checkmark}>✓</Text>}
                                </View>
                              </Pressable>
                            );
                          })
                        : null}

                      <Button
                        style={{ marginTop: 12 }}
                        variant="secondary"
                        onPress={() => setTmpWorkType([])}
                        title="Сбросить виды работ"
                      />

                      <View style={{ height: 12 }} />
                    </View>
                  )}

                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '600',
                      marginBottom: 8,
                      color: theme.colors.text,
                    }}
                  >
                    Сотрудник
                  </Text>
                  <TextField
                    placeholder="Поиск сотрудника..."
                    value={executorSearch}
                    onChangeText={setExecutorSearch}
                    style={{ marginBottom: 8 }}
                  />
                  {filteredExecutors.length ? (
                    filteredExecutors.map((ex) => {
                      const name =
                        [ex.first_name, ex.last_name].filter(Boolean).join(' ').trim() ||
                        'Без имени';
                      const active = tmpExecutor === ex.id;
                      return (
                        <Pressable
                          key={String(ex.id)}
                          style={styles.executorOption}
                          onPress={() => setTmpExecutor(active ? null : ex.id)}
                        >
                          <View style={styles.executorRow}>
                            <Text style={styles.executorText}>{name}</Text>
                            {active && <Text style={styles.checkmark}>✓</Text>}
                          </View>
                        </Pressable>
                      );
                    })
                  ) : (
                    <Text
                      style={[
                        styles.executorText,
                        { opacity: 0.6, textAlign: 'center', paddingVertical: 8 },
                      ]}
                    >
                      Сотрудники не найдены
                    </Text>
                  )}

                  <Button
                    style={{ marginTop: 12 }}
                    variant="secondary"
                    onPress={() => {
                      setTmpExecutor(null);
                    }}
                    title="Сбросить сотрудника"
                  />

                  <Button
                    style={{ marginTop: 10 }}
                    onPress={() => {
                      setWorkTypeFilter(Array.isArray(tmpWorkType) ? tmpWorkType : []);
                      setExecutorFilter(tmpExecutor || null);
                      setFilterModalVisible(false);
                      // Only pass work_type param when feature enabled
                      router.setParams({
                        ...(useWorkTypes && Array.isArray(tmpWorkType) && tmpWorkType.length
                          ? { work_type: tmpWorkType.join(',') }
                          : {}),
                        executor: tmpExecutor || undefined,
                      });
                    }}
                    title="Применить"
                  />
                </ScrollView>
              </View>
            </View>
          </Modal>
        </>
      )}
    </Screen>
  );
}
