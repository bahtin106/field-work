/* global __DEV__ */
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import DynamicOrderCard from '../../components/DynamicOrderCard';
import OrdersFiltersPanel from '../../components/filters/OrdersFiltersPanel';
import SearchFiltersBar from '../../components/filters/SearchFiltersBar';
import { useFilters } from '../../components/hooks/useFilters';
import Screen from '../../components/layout/Screen';
import AppHeader from '../../components/navigation/AppHeader';
import { useMyCompanyId } from '../../hooks/useMyCompanyId';
import { getOrderIdsByWorkTypes, mapStatusToDb } from '../../lib/orderFilters';
import { usePermissions } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes } from '../../lib/workTypes';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

export default function MyOrdersScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const mutedColor =
    theme?.text?.muted?.color ??
    theme?.colors?.muted ??
    theme?.colors?.textSecondary ??
    theme?.colors?.text;

  const { has, loading: permLoading } = usePermissions();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        filterBar: {
          marginBottom: 16,
        },
        filterScrollContent: {
          flexDirection: 'row',
          gap: 8,
          paddingRight: 4,
        },
        chip: {
          paddingVertical: 8,
          paddingHorizontal: 14,
          backgroundColor: theme.colors.inputBg || theme.colors.surface,
          borderRadius: 20,
        },
        chipActive: { backgroundColor: theme.colors.primary },
        chipText: { fontSize: 14, color: theme.colors.text },
        chipTextActive: {
          color: theme.colors.onPrimary || theme.colors.primaryTextOn,
          fontWeight: '600',
        },
        chipContent: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        feedDotBase: {
          width: 6,
          height: 6,
          borderRadius: 3,
          marginRight: 6,
        },
        feedDotNew: {
          backgroundColor: '#FF3B30',
        },
        feedDotSeen: {
          backgroundColor: 'rgba(255,59,48,0.22)',
          borderWidth: 1,
          borderColor: 'rgba(255,59,48,0.55)',
        },
        container: {
          padding: 16,
          paddingBottom: 40,
        },
        emptyText: {
          textAlign: 'center',
          marginTop: 32,
          fontSize: 16,
          color: mutedColor,
        },
      }),
    [theme],
  );

  const ORDER_FILTER_DEFAULTS = {
    workTypes: [],
    statuses: [],
    departureDateFrom: null,
    departureDateTo: null,
    departureTimeFrom: null,
    departureTimeTo: null,
    sumMin: '',
    sumMax: '',
    fuelMin: '',
    fuelMax: '',
  };

  function normalizeForFingerprint(values = {}) {
    const keys = Object.keys(values).sort();
    const normalized = {};
    keys.forEach((key) => {
      const value = values[key];
      normalized[key] = Array.isArray(value) ? [...value].sort() : value;
    });
    return normalized;
  }

  const parseTimeToMinutes = (value) => {
    if (!value) return null;
    const [hours, minutes] = value.split(':');
    const h = Number(hours);
    const m = Number(minutes);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };

  const filters = useFilters({
    screenKey: 'orders-my',
    defaults: ORDER_FILTER_DEFAULTS,
    ttl: 1000 * 60 * 30,
  });

  const filtersFingerprint = useMemo(
    () => JSON.stringify(normalizeForFingerprint(filters.values)),
    [filters.values],
  );

  const orderStatusOptions = useMemo(
    () => [
      { id: 'new', label: t('order_status_new') },
      { id: 'in_progress', label: t('order_status_in_progress') },
      { id: 'done', label: t('order_status_completed') },
    ],
    [t],
  );

  const router = useRouter();

  // Из вкладки «Мои» кнопка Назад ведёт на Главную
  useFocusEffect(
    React.useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        router.replace('/orders');
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  const { companyId } = useMyCompanyId();
  const [useWorkTypesFlag, setUseWorkTypesFlag] = useState(false);
  const [workTypeOptions, setWorkTypeOptions] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!companyId) {
      setUseWorkTypesFlag(false);
      setWorkTypeOptions([]);
      return undefined;
    }
    (async () => {
      try {
        const { useWorkTypes, types } = await fetchWorkTypes(companyId);
        if (!alive) return;
        setUseWorkTypesFlag(!!useWorkTypes);
        setWorkTypeOptions(types || []);
      } catch {
        if (!alive) return;
        setUseWorkTypesFlag(false);
        setWorkTypeOptions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyId]);

  const filterSummary = useMemo(() => {
    const parts = [];
    const {
      workTypes: selectedWorkTypes,
      statuses,
      departureDateFrom,
      departureDateTo,
      departureTimeFrom,
      departureTimeTo,
      sumMin,
      sumMax,
      fuelMin,
      fuelMax,
    } = filters.values;

    if (selectedWorkTypes?.length) {
      const names = selectedWorkTypes
        .map((id) => workTypeOptions.find((wt) => String(wt.id) === String(id))?.name)
        .filter(Boolean);
      if (names.length) {
        parts.push(`${t('order_field_work_type')}: ${names.join(', ')}`);
      }
    }

    if (statuses?.length) {
      const labels = statuses
        .map((code) => orderStatusOptions.find((opt) => opt.id === code)?.label || code)
        .filter(Boolean);
      if (labels.length) {
        parts.push(`${t('orders_filter_status')}: ${labels.join(', ')}`);
      }
    }

    const formatDate = (value) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    };

    if (departureDateFrom || departureDateTo) {
      const fromLabel = formatDate(departureDateFrom) || '—';
      const toLabel = formatDate(departureDateTo) || '—';
      parts.push(`${t('order_field_departure_date')}: ${fromLabel} — ${toLabel}`);
    }

    const formatTime = (value) => {
      if (!value) return null;
      const [hours, minutes] = value.split(':');
      const h = Number(hours);
      const m = Number(minutes);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      const base = new Date();
      base.setHours(h, m, 0, 0);
      return base.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    };

    if (departureTimeFrom || departureTimeTo) {
      const fromLabel = formatTime(departureTimeFrom) || '—';
      const toLabel = formatTime(departureTimeTo) || '—';
      parts.push(`${t('order_field_departure_time')}: ${fromLabel} — ${toLabel}`);
    }

    const formatRange = (min, max) => {
      if (min && max) return `${min} — ${max}`;
      if (min) return `≥ ${min}`;
      if (max) return `≤ ${max}`;
      return null;
    };

    const amountRange = formatRange(sumMin, sumMax);
    if (amountRange) {
      parts.push(`${t('order_details_amount')}: ${amountRange}`);
    }

    const fuelRange = formatRange(fuelMin, fuelMax);
    if (fuelRange) {
      parts.push(`${t('order_details_fuel')}: ${fuelRange}`);
    }

    return parts.join(t('common_bullet'));
  }, [filters.values, orderStatusOptions, workTypeOptions, t]);

  function __canSeePhone(o) {
    try {
      return Boolean(o && o.customer_phone_visible);
    } catch {
      return false;
    }
  }

  // Shared caches
  const LIST_CACHE = (globalThis.LIST_CACHE ||= {});
  LIST_CACHE.my ||= {};
  const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());
  const seenFilterRef = useRef(new Set());
  const makeCacheKey = useCallback(
    (key, fp) => `${(typeof key === 'string' ? key : 'all') || 'all'}:${fp || ''}`,
    [],
  );

  // Инициализируем orders из prefetch кэша если есть
  const [orders, setOrders] = useState(() => {
    // Проверяем prefetch кэш для "Моих заказов"
    const prefetchData = queryClient.getQueryData(['orders', 'my', 'recent']);
    if (prefetchData && Array.isArray(prefetchData) && prefetchData.length > 0) {
      return prefetchData;
    }
    return [];
  });
  // Начальный фильтр ставим 'all' (мои заказы), чтобы совпадал с предзагруженными первыми 10
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(() => {
    // Если есть данные в prefetch - не показываем loader
    const prefetchData = queryClient.getQueryData(['orders', 'my', 'recent']);
    if (prefetchData && Array.isArray(prefetchData) && prefetchData.length > 0) {
      return false;
    }
    const key = 'feed';
    const cacheKey = makeCacheKey(key, filtersFingerprint);
    return LIST_CACHE.my[cacheKey] ? false : true;
  });
  const [userId, setUserId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const hydratedRef = useRef(false);

  // Пагинация (как в Instagram/Telegram)
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 10;

  // Feed indicator state (cached preview of "Лента")
  const FEED_SEEN_STORAGE_KEY = 'myorders_feed_seen_fp';
  const FEED_LAST_FP_STORAGE_KEY = 'myorders_feed_last_fp';
  const [feedFingerprint, setFeedFingerprint] = useState(() => globalThis.__MYORDERS_FEED_FP || '');
  const [feedSeenFingerprint, setFeedSeenFingerprint] = useState(
    () => globalThis.__MYORDERS_FEED_SEEN_FP || '',
  );
  const [feedHasAny, setFeedHasAny] = useState(() => Boolean(globalThis.__MYORDERS_FEED_HAS_ANY));
  const feedPulse = useRef(new Animated.Value(0)).current;

  // Load persisted feed seen state (keeps "seen/new" across app restarts)
  useEffect(() => {
    const run = async () => {
      try {
        const [seenFp, lastFp] = await Promise.all([
          AsyncStorage.getItem(FEED_SEEN_STORAGE_KEY),
          AsyncStorage.getItem(FEED_LAST_FP_STORAGE_KEY),
        ]);

        if (typeof seenFp === 'string' && seenFp.length) {
          setFeedSeenFingerprint(seenFp);
          globalThis.__MYORDERS_FEED_SEEN_FP = seenFp;
        }
        if (typeof lastFp === 'string' && lastFp.length) {
          globalThis.__MYORDERS_FEED_FP = lastFp;
          setFeedFingerprint(lastFp);
        }
      } catch {}
    };
    run();
  }, []);

  useEffect(() => {
    // Pulse for "new in feed" state
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(feedPulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(feedPulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
    };
  }, [feedPulse]);

  const updateFeedMeta = useCallback((arr) => {
    const fp = Array.isArray(arr)
      ? arr
          .map((o) => o?.id)
          .filter(Boolean)
          .join(',')
      : '';
    const hasAny = Boolean(arr && arr.length);

    globalThis.__MYORDERS_FEED_FP = fp;
    globalThis.__MYORDERS_FEED_HAS_ANY = hasAny;

    setFeedFingerprint(fp);
    setFeedHasAny(hasAny);

    // Persist last known feed fingerprint (no UI spinners, best-effort)
    try {
      if (fp) AsyncStorage.setItem(FEED_LAST_FP_STORAGE_KEY, fp);
      else AsyncStorage.removeItem(FEED_LAST_FP_STORAGE_KEY);
    } catch {}
  }, []);

  // Prefetch «Лента» на входе, чтобы индикатор был виден сразу на вкладке «Все»
  useEffect(() => {
    const prefetchFeed = async () => {
      const cached = LIST_CACHE.my.feed;
      if (Array.isArray(cached) && cached.length) {
        updateFeedMeta(cached);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (!uid) return;

      const { data, error } = await supabase
        .from('orders_secure_v2')
        .select('*')
        .is('assigned_to', null)
        .order('time_window_start', { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (!error && Array.isArray(data)) {
        LIST_CACHE.my.feed = data;
        updateFeedMeta(data);
      }
    };

    prefetchFeed();
  }, [updateFeedMeta]);

  // Если пользователь зашёл в «Ленту» — считаем, что он увидел текущие заявки
  useEffect(() => {
    if (filter !== 'feed') return;
    if (!feedHasAny || !feedFingerprint) return;
    if (feedSeenFingerprint === feedFingerprint) return;

    setFeedSeenFingerprint(feedFingerprint);
    globalThis.__MYORDERS_FEED_SEEN_FP = feedFingerprint;

    try {
      AsyncStorage.setItem(FEED_SEEN_STORAGE_KEY, feedFingerprint);
    } catch {}
  }, [filter, feedHasAny, feedFingerprint, feedSeenFingerprint]);
  // Если мы стартуем на фильтре 'all' и уже есть prefetch данные – считаем экран гидратированным
  useEffect(() => {
    if (filter === 'all' && !hydratedRef.current) {
      const prefetchData = queryClient.getQueryData(['orders', 'my', 'recent']);
      if (prefetchData && prefetchData.length) {
        hydratedRef.current = true;
        if (orders.length === 0) setOrders(prefetchData);
        setLoading(false);
      }
    }
  }, [filter, orders.length, queryClient]);
  const [bgRefreshing, setBgRefreshing] = useState(false);

  const { seedFilter, seedSearch } = useLocalSearchParams();
  const seedOnceRef = useRef(false);
  useEffect(() => {
    if (seedOnceRef.current) return;
    seedOnceRef.current = true;
    /* seed from cache */
    const k = typeof seedFilter === 'string' && seedFilter.length ? seedFilter : filter || 'all';
    const listKey = `${k}:${filtersFingerprint}`;
    if (LIST_CACHE.my[listKey]) {
      setOrders(LIST_CACHE.my[listKey]);
      hydratedRef.current = true;
    }
    if (typeof seedFilter === 'string' && seedFilter.length) setFilter(seedFilter);
    if (typeof seedSearch === 'string') setSearchQuery(seedSearch);
  }, [seedFilter, seedSearch]);

  useEffect(() => {
    const fetchUserAndOrders = async (isBackground = false, pageNum = 1) => {
      const key = (typeof filter === 'string' ? filter : 'all') || 'all';
      const cacheKey = `${key}:${filtersFingerprint}`;

      // Первая страница - проверяем кэш
      if (pageNum === 1) {
        const cached = LIST_CACHE.my[cacheKey];
        if (cached && cached.length) {
          setOrders(cached);
          hydratedRef.current = true;
          seenFilterRef.current.add(cacheKey);
          if (isBackground) {
          } else {
            setLoading(false);
          }
        } else if (!seenFilterRef.current.has(cacheKey)) {
          setLoading(true);
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (!uid) {
        setOrders([]);
        setLoading(false);
        return;
      }
      setUserId(uid);

      let query = supabase.from('orders_secure_v2').select('*');
      if (key === 'feed') {
        query = query.is('assigned_to', null);
      } else {
        query = query.eq('assigned_to', uid);
        if (key !== 'all') {
          const statusValue = mapStatusToDb(key);
          if (statusValue) {
            query = query.eq('status', statusValue);
          }
        }
      }

      const filterValues = filters.values;
      const statusFilters = Array.isArray(filterValues.statuses)
        ? filterValues.statuses.map(mapStatusToDb).filter(Boolean)
        : [];
      if (statusFilters.length) {
        query = query.in('status', statusFilters);
      }

      const sumMin = parseFloat(filterValues.sumMin);
      if (!Number.isNaN(sumMin)) {
        query = query.gte('price', sumMin);
      }
      const sumMax = parseFloat(filterValues.sumMax);
      if (!Number.isNaN(sumMax)) {
        query = query.lte('price', sumMax);
      }
      const fuelMin = parseFloat(filterValues.fuelMin);
      if (!Number.isNaN(fuelMin)) {
        query = query.gte('fuel_cost', fuelMin);
      }
      const fuelMax = parseFloat(filterValues.fuelMax);
      if (!Number.isNaN(fuelMax)) {
        query = query.lte('fuel_cost', fuelMax);
      }

      const toIsoDate = (value, startVal) => {
        if (!value) return null;
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        if (startVal) {
          d.setHours(0, 0, 0, 0);
        } else {
          d.setHours(23, 59, 59, 999);
        }
        return d.toISOString();
      };

      const dateFrom = toIsoDate(filterValues.departureDateFrom, true);
      const dateTo = toIsoDate(filterValues.departureDateTo, false);
      if (dateFrom) query = query.gte('time_window_start', dateFrom);
      if (dateTo) query = query.lte('time_window_start', dateTo);

      const selectedWorkTypes = Array.isArray(filterValues.workTypes) ? filterValues.workTypes : [];
      if (useWorkTypesFlag && selectedWorkTypes.length) {
        const ids = await getOrderIdsByWorkTypes(selectedWorkTypes);
        if (!ids.length) {
          if (!alive) return;
          const emptyResult = [];
          setOrders(emptyResult);
          LIST_CACHE.my[cacheKey] = emptyResult;
          queryClient.setQueryData(['orders', 'my', 'recent'], emptyResult);
          setHasMore(false);
          setLoading(false);
          return;
        }
        query = query.in('id', ids);
      }
      // ПАГИНАЦИЯ: грузим только нужную порцию
      const from = (pageNum - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await query
        .order('time_window_start', { ascending: false })
        .range(from, to);

      const normalized = Array.isArray(data)
        ? data.map((o) => ({ ...o, time_window_start: o.time_window_start ?? null }))
        : data;

      if (!error && Array.isArray(normalized)) {
        if (pageNum === 1) {
          setOrders(normalized);
          LIST_CACHE.my[cacheKey] = normalized;
          seenFilterRef.current.add(cacheKey);
          if (key === 'feed') updateFeedMeta(normalized);
        } else {
          // Добавляем к существующим (пагинация)
          setOrders((prev) => [...prev, ...normalized]);
        }
        hydratedRef.current = true;

        // Проверяем, есть ли ещё данные
        setHasMore(data.length === PAGE_SIZE);
      }
      setLoading(false);
      setLoadingMore(false);
    };

    // Гард: если уже гидратировано из prefetch и выбран 'all', пропускаем мгновенный сетевой вызов
    if (
      filter === 'all' &&
      hydratedRef.current &&
      orders.length > 0 &&
      Array.isArray(queryClient.getQueryData(['orders', 'my', 'recent']))
    ) {
      // Фоновое обновление полного списка через небольшую задержку
      const timer = setTimeout(() => {
        // Background refresh
        fetchUserAndOrders(true);
      }, 1200);
      return () => clearTimeout(timer);
    }

    // Сбрасываем пагинацию при смене фильтра
    setPage(1);
    setHasMore(true);
    fetchUserAndOrders();
  }, [filter, filtersFingerprint]);

  // Загрузка следующей страницы при достижении конца списка
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;

    // Loading next page silently

    setLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);

    const key = (typeof filter === 'string' ? filter : 'all') || 'all';
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) return;

    let query = supabase.from('orders_secure_v2').select('*');
    if (key === 'feed') {
      query = query.is('assigned_to', null);
    } else if (key === 'all') {
      query = query.eq('assigned_to', uid);
    } else {
      query = query.eq('assigned_to', uid);
      if (key === 'new') {
        query = query.or('status.is.null,status.eq.Новый');
      } else if (key === 'progress') {
        query = query.eq('status', 'В работе');
      } else if (key === 'done') {
        query = query.eq('status', 'Завершённая');
      }
    }

    const from = (nextPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await query
      .order('time_window_start', { ascending: false })
      .range(from, to);

    if (!error && Array.isArray(data)) {
      const normalized = data.map((o) => ({
        ...o,
        time_window_start: o.time_window_start ?? null,
      }));
      setOrders((prev) => [...prev, ...normalized]);
      setHasMore(normalized.length === PAGE_SIZE);

      // Loaded successfully
    }

    setLoadingMore(false);
  }, [loadingMore, hasMore, loading, page, filter]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const timeFrom = parseTimeToMinutes(filters.values.departureTimeFrom);
    const timeTo = parseTimeToMinutes(filters.values.departureTimeTo);
    return (orders || []).filter((o) => {
      if (timeFrom != null || timeTo != null) {
        const dt = o?.time_window_start ? new Date(o.time_window_start) : null;
        if (dt && !Number.isNaN(dt.getTime())) {
          const minutes = dt.getHours() * 60 + dt.getMinutes();
          if (timeFrom != null && minutes < timeFrom) return false;
          if (timeTo != null && minutes > timeTo) return false;
        }
      }
      if (!q) return true;
      const haystack = [
        o.title,
        o.fio,
        o.customer_phone_visible, // ??:?n? �'?c?>?c�"???? ?n?u view/secure
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
  }, [orders, searchQuery, filters.values.departureTimeFrom, filters.values.departureTimeTo]);
  // Рендер элемента списка
  const renderItem = useCallback(
    ({ item: order }) => (
      <DynamicOrderCard
        order={order}
        context="my_orders"
        onPress={() =>
          router.push({
            pathname: `/orders/${order.id}`,
            params: {
              returnTo: '/orders/my-orders',
              returnParams: JSON.stringify({
                seedFilter: filter,
                seedSearch: searchQuery,
              }),
            },
          })
        }
      />
    ),
    [router, filter, searchQuery],
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

  // Заголовок с фильтрами и поиском
  const feedState = !feedHasAny
    ? 'none'
    : feedFingerprint && feedFingerprint === feedSeenFingerprint
      ? 'seen'
      : 'new';

  const listHeader = useMemo(
    () => (
      <View>
        <View style={styles.filterBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScrollContent}
          >
            {['feed', 'all', 'new', 'progress', 'done'].map((key) => (
              <Pressable
                key={key}
                onPress={() => setFilter(key)}
                style={({ pressed }) => [
                  styles.chip,
                  filter === key && styles.chipActive,
                  pressed && { opacity: 0.9 },
                ]}
                accessibilityRole="button"
              >
                <View style={styles.chipContent}>
                  {key === 'feed' &&
                    feedState !== 'none' &&
                    (feedState === 'new' ? (
                      <Animated.View
                        style={[
                          styles.feedDotBase,
                          styles.feedDotNew,
                          {
                            transform: [
                              {
                                scale: feedPulse.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [1, 1.7],
                                }),
                              },
                            ],
                            opacity: feedPulse.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.55, 1],
                            }),
                          },
                        ]}
                      />
                    ) : (
                      <View style={[styles.feedDotBase, styles.feedDotSeen]} />
                    ))}
                  <Text style={[styles.chipText, filter === key && styles.chipTextActive]}>
                    {
                      {
                        feed: 'Лента',
                        all: 'Все',
                        new: 'Новые',
                        progress: 'В работе',
                        done: 'Готово',
                      }[key]
                    }
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <SearchFiltersBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => setSearchQuery('')}
          placeholder={t('common_search')}
          onOpenFilters={filters.open}
          filterSummary={filterSummary}
          onResetFilters={async () => {
            const resetValues = filters.reset();
            await filters.apply(resetValues);
          }}
          metaText={
            searchQuery
              ? t('orders_found') + ': ' + filteredOrders.length
              : t('orders_total') + ': ' + orders.length
          }
        />
      </View>
    ),
    [
      filter,
      searchQuery,
      styles,
      feedState,
      feedPulse,
      filters.open,
      filterSummary,
      filteredOrders.length,
      orders.length,
      t,
    ],
  );

  // Пустой список
  const ListEmptyComponent = useCallback(
    () => (
      <View style={{ paddingVertical: 40, alignItems: 'center' }}>
        {loading && !hydratedRef.current ? (
          <ActivityIndicator size="large" color={theme.colors.primary} />
        ) : (
          <Text style={styles.emptyText}>У вас пока нет заказов</Text>
        )}
      </View>
    ),
    [loading, styles.emptyText, theme.colors.primary],
  );

  const keyExtractor = useCallback((item) => String(item.id), []);

  // Pull-to-refresh
  const onRefresh = useCallback(async () => {
    setBgRefreshing(true);
    setPage(1);
    setHasMore(true);

    const key = (typeof filter === 'string' ? filter : 'all') || 'all';
    const cacheKey = makeCacheKey(key, filtersFingerprint);
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) {
      return;
    }

    let query = supabase.from('orders_secure_v2').select('*');
    if (key === 'feed') {
      query = query.is('assigned_to', null);
    } else if (key === 'all') {
      query = query.eq('assigned_to', uid);
    } else {
      query = query.eq('assigned_to', uid);
      if (key === 'new') {
        query = query.or('status.is.null,status.eq.Новый');
      } else if (key === 'progress') {
        query = query.eq('status', 'В работе');
      } else if (key === 'done') {
        query = query.eq('status', 'Завершённая');
      }
    }

    const { data, error } = await query
      .order('time_window_start', { ascending: false })
      .range(0, PAGE_SIZE - 1);

    if (!error && Array.isArray(data)) {
      const normalized = data.map((o) => ({
        ...o,
        time_window_start: o.time_window_start ?? null,
      }));
      setOrders(normalized);
      LIST_CACHE.my[cacheKey] = normalized;
      if (key === 'feed') updateFeedMeta(normalized);
      setHasMore(normalized.length === PAGE_SIZE);
    }
    setBgRefreshing(false);
  }, [filter, makeCacheKey, filtersFingerprint]);

  if (loading) {
    return (
      <Screen scroll={false} headerOptions={{ headerShown: false }}>
        <AppHeader
          back
          options={{
            headerTitleAlign: 'left',
            title: t('routes.orders/my-orders'),
          }}
        />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} headerOptions={{ headerShown: false }}>
      <AppHeader
        back
        options={{
          headerTitleAlign: 'left',
          title: t('routes.orders/my-orders'),
        }}
      />
      <FlatList
        data={filteredOrders}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={bgRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={Platform.OS === 'android' ? [theme.colors.primary] : undefined}
          />
        }
      />
      <OrdersFiltersPanel
        visible={filters.visible}
        onClose={filters.close}
        values={filters.values}
        setValue={filters.setValue}
        defaults={ORDER_FILTER_DEFAULTS}
        workTypes={workTypeOptions}
        useWorkTypes={useWorkTypesFlag}
        statusOptions={orderStatusOptions}
        onReset={() => filters.reset()}
        onApply={() => filters.apply()}
      />
    </Screen>
  );
}
