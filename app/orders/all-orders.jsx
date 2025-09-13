// app/orders/all-orders.jsx

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable, BackHandler } from 'react-native';
import { Modal } from 'react-native';


import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';
import DynamicOrderCard from '../../components/DynamicOrderCard'; 
import { supabase } from '../../lib/supabase';
import { getMyCompanyId, fetchWorkTypes } from '../../lib/workTypes';
import { useTheme } from '../../theme/ThemeProvider';
import { usePermissions } from '../../lib/permissions';


const PERM_CACHE = (globalThis.PERM_CACHE ||= { canViewAll: { value: null, ts: 0 } });
const PERM_TTL_MS = 10 * 60 * 1000;

// ===== HARD PERMISSION GUARD (independent from usePermissions) =====
async function checkCanViewAll() {
  try {
    // 1) get current user's role from profiles
    const { data: me, error: e1 } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', (await supabase.auth.getUser()).data?.user?.id || '00000000-0000-0000-0000-000000000000')
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
  return rec && (Date.now() - (rec.ts || 0) < PERM_TTL_MS) ? rec.value : null;
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
    return () => { alive = false; };
  }, []);

  const { theme } = useTheme();
    const mutedColor = theme.colors.textSecondary ?? theme.colors.muted ?? '#8E8E93';
  const { has } = usePermissions();

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
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace('/orders');
      return true;
    });
    return () => sub.remove();
  }, []));

  // Global cache with TTL
  const CACHE_TTL_MS = 45000;
  const LIST_CACHE = (globalThis.LIST_CACHE ||= {});
  LIST_CACHE.all ||= {};
  const { filter, executor, department, search, work_type, materials } = useLocalSearchParams();
  const [orders, setOrders] = useState(() => {
    const key = JSON.stringify({ status: 'feed', ex: null });
    const cached = LIST_CACHE.all[key];
    return cached?.data || [];
  });
  const [loading, setLoading] = useState(() => {
    const key = JSON.stringify({ status: 'feed', ex: null });
    return LIST_CACHE.all[key] ? false : true;
  });
  const [refreshing, setRefreshing] = useState(false);

  const [statusFilter, setStatusFilter] = useState(
    filter === 'completed'
      ? 'done'
      : filter === 'in_progress'
        ? 'in_progress'
        : filter === 'new'
          ? 'new'
          : filter || 'all',
  );
  const [executorFilter, setExecutorFilter] = useState(executor || null);
  
  const [departmentFilter, setDepartmentFilter] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [departmentFilterInit] = useState(department ? Number(department) : null);
  useEffect(() => { if (departmentFilterInit != null && !Number.isNaN(departmentFilterInit)) setDepartmentFilter(Number(departmentFilterInit)); }, []);
  const [workTypeFilter, setWorkTypeFilter] = useState(
    work_type ? String(work_type).split(',').map(s=>Number(s)).filter(n=>!Number.isNaN(n)) : []
  );
  const [materialsFilter, setMaterialsFilter] = useState(
    materials ? String(materials).split(',').map(s => s.trim()).filter(Boolean) : []
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
  return () => { alive = false; };
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
    return list.sort((a,b)=>{
      const an = [a.first_name||'', a.last_name||''].join(' ').trim();
      const bn = [b.first_name||'', b.last_name||''].join(' ').trim();
      return an.localeCompare(bn, 'ru');
    });
  }, [executors]);
  const sortedWorkTypes = useMemo(() => {
    return [...(filterOptions.work_type||[])].sort((a,b)=>String(a).localeCompare(String(b),'ru'));
  }, [filterOptions.work_type]);
  const sortedMaterials = useMemo(() => {
    return [...(filterOptions.materials||[])].sort((a,b)=>String(a).localeCompare(String(b),'ru'));
  }, [filterOptions.materials]);
  const filteredExecutors = useMemo(() => {
    let list = executors || [];
    // constrain by department when selected
    if (departmentFilter != null) {
      list = list.filter(e => Number(e.department_id) === Number(departmentFilter));
    }
    const q = (executorSearch || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(e => ([e.first_name, e.last_name].filter(Boolean).join(' ') || '').toLowerCase().includes(q));
  }, [executors, executorSearch, departmentFilter]);

  const cacheKey = useMemo(() => JSON.stringify({ status: statusFilter, ex: executorFilter || null, dept: departmentFilter || null, wt: (workTypeFilter||[]).join(',') }), [statusFilter, executorFilter, departmentFilter, workTypeFilter], );

// Ensure executor selection is consistent with selected department
  useEffect(() => {
    if (departmentFilter == null || !executorFilter) return;
    const ex = executors.find(e => e.id === executorFilter);
    if (ex && Number(ex.department_id) !== Number(departmentFilter)) {
      setExecutorFilter(null);
    }
  }, [departmentFilter, executorFilter, executors]);


  // ✅ Serve cached data immediately when filters change (fix for stale list after toggling chips)
  useEffect(() => {
    const cached = LIST_CACHE.all[cacheKey];
    if (cached) {
      setOrders(cached.data || []);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }, [cacheKey]);

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
    return (data || []).map(r => r.id).filter(Boolean);
  } catch { return []; }
};


  // Auto refresh by TTL (background, no spinner if cache exists)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const cached = LIST_CACHE.all[cacheKey];
      const freshNeeded = !cached || Date.now() - (cached.ts || 0) > CACHE_TTL_MS;
      if (!freshNeeded) {
        // Serve from cache immediately to reflect UI change
        if (cached) {
          setOrders(cached.data || []);
        }
        setLoading(false);
        return;
      }

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
          setOrders([]);
          LIST_CACHE.all[cacheKey] = { data: [], ts: Date.now() };
          setLoading(false);
          return;
        }
        query = query.in('id', ids);
      }

      const { data, error } = await query.order('datetime', { ascending: false });
      if (!alive) return;
      if (!error) {
        setOrders(data || []);
        LIST_CACHE.all[cacheKey] = { data: data || [], ts: Date.now() };
      }
      setLoading(false);
    };
    const id = setInterval(tick, 15000); // check every 15s
    tick(); // initial check
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [cacheKey]);
  
const onRefresh = async () => {
  try {
    setRefreshing(true);
    setLoading(true);
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
        LIST_CACHE.all[cacheKey] = { data: [], ts: Date.now() };
        return;
      }
      query = query.in('id', ids);
    }
    const { data, error } = await query.order('datetime', { ascending: false });
    if (!error) {
      setOrders(data || []);
      LIST_CACHE.all[cacheKey] = { data: data || [], ts: Date.now() };
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

  return (
    <Screen>
      {allowed === null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : !allowed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', paddingHorizontal: 24 }}>
            Админ вашей компании отключил доступ ко всем заявкам
          </Text>
        </View>
      ) : (
      <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          style={{ backgroundColor: theme.colors.background }}
          contentContainerStyle={styles.container}
        >
          <Text style={styles.header}>Все заявки</Text>

          <View style={styles.filterContainer}>
            {['feed', 'all', 'new', 'in_progress', 'done'].map((key) => (
              <Pressable
                key={key}
                onPress={() => {
                  setStatusFilter(key);
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

          <Button variant="secondary" onPress={() => { setTmpWorkType(workTypeFilter || []); setTmpMaterials([]); setTmpExecutor(executorFilter || null); setFilterModalVisible(true); }} style={{ marginBottom: 16 }} title={useWorkTypes && Array.isArray(workTypeFilter) && workTypeFilter.length ? `Виды работ: ${workTypeFilter.length}` : (executorFilter ? 'Сотрудник выбран' : 'Фильтры')} />


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
      <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled={true} contentContainerStyle={{paddingBottom: 12}}>
        {/* Work types block is shown only if feature enabled */}
        {useWorkTypes && (
          <View>
            <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8, color: theme.colors.text }}>Виды работ</Text>
            {Array.isArray(workTypes) && workTypes.length ? (
              workTypes.map((t) => {
                const active = (tmpWorkType || []).includes(t.id);
                return (
                  <Pressable key={String(t.id)} style={styles.executorOption}
                    onPress={() => {
                      setTmpWorkType((prev) => {
                        const set = new Set(prev || []);
                        if (set.has(t.id)) set.delete(t.id); else set.add(t.id);
                        return Array.from(set);
                      });
                    }}>
                    <View style={styles.executorRow}>
                      <Text style={styles.executorText}>{t.name}</Text>
                      {active && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  </Pressable>
                );
              })
            ) : null}

            <Button
              style={{ marginTop: 12 }}
              variant="secondary"
              onPress={() => setTmpWorkType([])}
              title="Сбросить виды работ"
            />

            <View style={{ height: 12 }} />
          </View>
        )}

        <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8, color: theme.colors.text }}>Сотрудник</Text>
        <TextField
          placeholder="Поиск сотрудника..."
          value={executorSearch}
          onChangeText={setExecutorSearch}
          style={{ marginBottom: 8 }}
        />
        {filteredExecutors.length ? (
          filteredExecutors.map((ex) => {
            const name = [ex.first_name, ex.last_name].filter(Boolean).join(' ').trim() || 'Без имени';
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
          <Text style={[styles.executorText,{opacity:0.6, textAlign:'center', paddingVertical:8}]}>Сотрудники не найдены</Text>
        )}

        <Button
          style={{ marginTop: 12 }}
          variant="secondary"
          onPress={() => { setTmpExecutor(null); }}
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
              ...(useWorkTypes && Array.isArray(tmpWorkType) && tmpWorkType.length ? { work_type: tmpWorkType.join(',') } : {}),
              executor: tmpExecutor || undefined,
            });
          }}
          title="Применить"
        />
      </ScrollView>
    </View>
  </View>
</Modal>

          {loading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 40 }} />
          ) : orders.length === 0 ? (
            <Text style={styles.emptyText}>Заявок не найдено</Text>
          ) : (
            filteredOrders.map((order) => (
              <DynamicOrderCard
                key={order.id}
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
            ))
          )}
        </ScrollView>
        )}
      </Screen>
  );
}
