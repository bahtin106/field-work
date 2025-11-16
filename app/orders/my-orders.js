/* global __DEV__ */
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import DynamicOrderCard from '../../components/DynamicOrderCard';
import Screen from '../../components/layout/Screen';
import TextField from '../../components/ui/TextField';
import { usePermissions } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';

export default function MyOrdersScreen() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  const mutedColor =
    theme?.text?.muted?.color ??
    theme?.colors?.muted ??
    theme?.colors?.textSecondary ??
    theme?.colors?.text;

  const { has } = usePermissions();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        filterContainer: {
          flexDirection: 'row',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
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
        container: {
          padding: 16,
          paddingBottom: 40,
        },
        searchInput: {
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: Platform.OS === 'ios' ? 12 : 10,
          fontSize: 15,
          backgroundColor: theme.colors.inputBg || theme.colors.surface,
          marginBottom: 12,
          color: theme.colors.text,
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

  // Инициализируем orders из prefetch кэша если есть
  const [orders, setOrders] = useState(() => {
    // Проверяем prefetch кэш для "Моих заказов"
    const prefetchData = queryClient.getQueryData(['orders', 'my', 'recent']);
    if (prefetchData && Array.isArray(prefetchData) && prefetchData.length > 0) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(`[MyOrders] 🚀 Found ${prefetchData.length} orders in prefetch cache!`);
      }
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
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(`[MyOrders] MOUNT: loading=false (prefetch cache hit)`);
      }
      return false;
    }
    const key = 'feed';
    return LIST_CACHE.my[key] ? false : true;
  });
  const [userId, setUserId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const hydratedRef = useRef(false);

  // Пагинация (как в Instagram/Telegram)
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 10;
  // Если мы стартуем на фильтре 'all' и уже есть prefetch данные – считаем экран гидратированным
  useEffect(() => {
    if (filter === 'all' && !hydratedRef.current) {
      const prefetchData = queryClient.getQueryData(['orders', 'my', 'recent']);
      if (prefetchData && prefetchData.length) {
        hydratedRef.current = true;
        if (orders.length === 0) setOrders(prefetchData);
        setLoading(false);
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[MyOrders] ✅ Instant hydrate from prefetch');
        }
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
    if (LIST_CACHE.my[k]) {
      setOrders(LIST_CACHE.my[k]);
      hydratedRef.current = true;
    }
    if (typeof seedFilter === 'string' && seedFilter.length) setFilter(seedFilter);
    if (typeof seedSearch === 'string') setSearchQuery(seedSearch);
  }, [seedFilter, seedSearch]);

  useEffect(() => {
    try {
      router.setParams({ seedFilter: filter, seedSearch: searchQuery });
    } catch (e) {}
  }, [filter, searchQuery]);

  useEffect(() => {
    const fetchUserAndOrders = async (isBackground = false, pageNum = 1) => {
      const key = (typeof filter === 'string' ? filter : 'all') || 'all';

      // Первая страница - проверяем кэш
      if (pageNum === 1) {
        const cached = LIST_CACHE.my[key];
        if (cached && cached.length) {
          setOrders(cached);
          hydratedRef.current = true;
          if (isBackground) {
            setBgRefreshing(true);
          } else {
            setLoading(false);
            setBgRefreshing(true);
          }
        } else {
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

      let query = supabase.from('orders_secure').select('*');
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

      // ПАГИНАЦИЯ: грузим только нужную порцию
      const from = (pageNum - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await query.order('datetime', { ascending: false }).range(from, to);

      if (!error && Array.isArray(data)) {
        if (pageNum === 1) {
          setOrders(data);
          LIST_CACHE.my[key] = data;
        } else {
          // Добавляем к существующим (пагинация)
          setOrders((prev) => [...prev, ...data]);
        }
        hydratedRef.current = true;

        // Проверяем, есть ли ещё данные
        setHasMore(data.length === PAGE_SIZE);
      }

      setBgRefreshing(false);
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
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(
          '[MyOrders] ⏭ Skip immediate fetch (prefetch satisfied), schedule background refresh',
        );
      }
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
  }, [filter]);

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

    let query = supabase.from('orders_secure').select('*');
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

    const { data, error } = await query.order('datetime', { ascending: false }).range(from, to);

    if (!error && Array.isArray(data)) {
      setOrders((prev) => [...prev, ...data]);
      setHasMore(data.length === PAGE_SIZE);

      // Loaded successfully
    }

    setLoadingMore(false);
  }, [loadingMore, hasMore, loading, page, filter]);

  const filteredOrders = (orders || []).filter((o) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      o.title,
      o.fio,
      o.customer_phone_visible, // ⬅️ телефон из view/secure
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
  const ListHeaderComponent = useCallback(
    () => (
      <View>
        <View style={styles.filterContainer}>
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
              <Text style={[styles.chipText, filter === key && styles.chipTextActive]}>
                {key === 'feed'
                  ? 'Лента'
                  : key === 'all'
                    ? 'Все'
                    : key === 'new'
                      ? 'Новые'
                      : key === 'progress'
                        ? 'В работе'
                        : 'Завершённые'}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextField
          placeholder="Поиск по названию, городу, телефону..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          style={styles.searchInput}
        />
      </View>
    ),
    [filter, searchQuery, styles],
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
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) {
      setBgRefreshing(false);
      return;
    }

    let query = supabase.from('orders_secure').select('*');
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
      .order('datetime', { ascending: false })
      .range(0, PAGE_SIZE - 1);

    if (!error && Array.isArray(data)) {
      setOrders(data);
      LIST_CACHE.my[key] = data;
      setHasMore(data.length === PAGE_SIZE);
    }

    setBgRefreshing(false);
  }, [filter]);

  return (
    <Screen scroll={false}>
      <FlatList
        data={filteredOrders}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeaderComponent}
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
    </Screen>
  );
}
