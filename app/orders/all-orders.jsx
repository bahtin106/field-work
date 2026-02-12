// app/orders/all-orders.jsx

import { useFocusEffect, useIsFocused } from '@react-navigation/native';
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
import {
  ensureRequestPrefetch,
  useAllRequests,
  useRequestExecutors,
  useRequestFilterOptions,
  useRequestRealtimeSync,
} from '../../src/features/requests/queries';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';
import { markFirstContent, markScreenMount } from '../../src/shared/perf/devMetrics';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

const PERM_CACHE = (globalThis.PERM_CACHE ||= { canViewAll: { value: null, ts: 0 } });
const PERM_TTL_MS = 10 * 60 * 1000;
const EMPTY_ARRAY = [];

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
  const { has, loading: permLoading } = usePermissions();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const effectiveAllowed = allowed ?? (!permLoading ? has('canViewAllOrders') : null);

  useEffect(() => {
    markScreenMount('AllRequests');
  }, []);

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
    [theme, mutedColor],
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
    }, [router]),
  );
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

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [executorFilter, setExecutorFilter] = useState(executor || null);
  const [_hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [departmentFilter, setDepartmentFilter] = useState(null);
  const [departmentFilterInit] = useState(department ? Number(department) : null);
  useEffect(() => {
    if (departmentFilterInit != null && !Number.isNaN(departmentFilterInit))
      setDepartmentFilter(Number(departmentFilterInit));
  }, [departmentFilterInit]);
  const [workTypeFilter, setWorkTypeFilter] = useState(
    work_type
      ? String(work_type)
          .split(',')
          .map((s) => Number(s))
          .filter((n) => !Number.isNaN(n))
      : [],
  );
  const [materialsFilter, _setMaterialsFilter] = useState(
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
  const [_filterOptions, setFilterOptions] = useState({ work_type: [], materials: [] });
  const [tmpWorkType, setTmpWorkType] = useState(workTypeFilter || []);
  const [_tmpMaterials, setTmpMaterials] = useState(materialsFilter || []);
  const [tmpExecutor, setTmpExecutor] = useState(executorFilter || null);
  const [executorSearch, setExecutorSearch] = useState('');

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

  const { data: companyId } = useMyCompanyIdQuery();
  const allRequestsParams = useMemo(() => {
    const next = {};
    if (statusFilter && statusFilter !== 'all') next.status = statusFilter;
    if (executorFilter) next.executorId = executorFilter;
    if (departmentFilter != null) next.departmentId = departmentFilter;
    if (useWorkTypes && Array.isArray(workTypeFilter) && workTypeFilter.length) {
      next.workTypeIds = workTypeFilter;
    }
    return next;
  }, [statusFilter, executorFilter, departmentFilter, useWorkTypes, workTypeFilter]);

  const {
    items: requestItems = [],
    isLoading: requestsLoading,
    refetch: refetchRequests,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useAllRequests(
    allRequestsParams,
    {
      enabled: effectiveAllowed === true,
      refetchInterval: isFocused ? 20 * 1000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const { data: executorsData } = useRequestExecutors({ enabled: effectiveAllowed === true });
  const executors = useMemo(() => executorsData ?? EMPTY_ARRAY, [executorsData]);
  const { data: filterOptionsData } = useRequestFilterOptions({ enabled: effectiveAllowed === true });

  useRequestRealtimeSync({ enabled: effectiveAllowed === true, companyId });

  // Ensure executor selection is consistent with selected department
  useEffect(() => {
    if (departmentFilter == null || !executorFilter) return;
    const ex = executors.find((e) => e.id === executorFilter);
    if (ex && Number(ex.department_id) !== Number(departmentFilter)) {
      setExecutorFilter(null);
    }
  }, [departmentFilter, executorFilter, executors]);

  // ✅ Serve cached data immediately when filters change (fix for stale list after toggling chips)
  const lastItemsSignatureRef = useRef('');
  useEffect(() => {
    const signature = Array.isArray(requestItems)
      ? requestItems.map((item) => `${item?.id || ''}:${item?.updated_at || ''}`).join('|')
      : '';
    if (lastItemsSignatureRef.current !== signature) {
      lastItemsSignatureRef.current = signature;
      setOrders(requestItems);
    }
    setLoading(requestsLoading && requestItems.length === 0);
    setHasMore(!!hasNextPage);
    setLoadingMore(isFetchingNextPage);
  }, [hasNextPage, isFetchingNextPage, requestItems, requestsLoading]);

  useEffect(() => {
    if (filterOptionsData) {
      setFilterOptions(filterOptionsData);
    }
  }, [filterOptionsData]);

  const firstContentMarkedRef = useRef(false);
  useEffect(() => {
    if (firstContentMarkedRef.current) return;
    if (requestsLoading) return;
    firstContentMarkedRef.current = true;
    markFirstContent('AllRequests');
  }, [requestsLoading]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchRequests();
    } finally {
      setRefreshing(false);
    }
  }, [refetchRequests]);

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

  const _normalizeStatus = (raw) => {
    if (raw === 'completed') return 'done';
    if (raw === 'in_progress') return 'in_progress';
    if (raw === 'new') return 'new';
    return 'all';
  };
  // Поиск: используем phone_visible вместо phone
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (orders || []).filter((o) => {
      if (!q) return true;
      const haystack = [
        o.title,
        o.fio,
        o.customer_phone_visible,
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
  }, [orders, searchQuery]);
  // Ленивая загрузка при скролле (как в Instagram/Telegram)
  const loadMore = useCallback(async () => {
    if (isFetchingNextPage || !hasNextPage || loading) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, loading]);

  // Рендер элемента списка
  const returnParamsRef = useRef({
    filter: statusFilter,
    executor: executorFilter,
    department: departmentFilter,
    search: searchQuery,
  });
  useEffect(() => {
    returnParamsRef.current = {
      filter: statusFilter,
      executor: executorFilter,
      department: departmentFilter,
      search: searchQuery,
    };
  }, [departmentFilter, executorFilter, searchQuery, statusFilter]);
  const openOrderDetails = useCallback(
    async (orderId) => {
      await ensureRequestPrefetch(queryClient, orderId).catch(() => {});
      router.push({
        pathname: `/orders/${orderId}`,
        params: {
          returnTo: '/orders/all-orders',
          returnParams: JSON.stringify(returnParamsRef.current),
        },
      });
    },
    [queryClient, router],
  );
  const renderItem = useCallback(
    ({ item: order }) => (
      <DynamicOrderCard
        order={order}
        context="all_orders"
        onPress={() => openOrderDetails(order.id)}
      />
    ),
    [openOrderDetails],
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
  const onViewableItemsChanged = useMemo(
    () => ({ viewableItems }) => {
      viewableItems
        .map((item) => item?.item?.id)
        .filter(Boolean)
        .slice(0, 6)
        .forEach((id) => {
          ensureRequestPrefetch(queryClient, id).catch(() => {});
        });
    },
    [queryClient],
  );

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
      {loading || effectiveAllowed === null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : !effectiveAllowed ? (
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
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
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


