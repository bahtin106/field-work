import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Modal, TextInput, FlatList } from 'react-native';

import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import DynamicOrderCard from '../../components/DynamicOrderCard'; // ✅ новая карточка
import { useTheme } from '../../theme/ThemeProvider';

function mapStatusToDB(key) {
  switch (key) {
    case 'new': return 'Новый';
    case 'in_progress': return 'В работе';
    case 'done': return 'Завершённая';
    default: return null;
  }
}

export default function AllOrdersScreen() {
  const { theme } = useTheme();
  
  
  const styles = useMemo(() => StyleSheet.create({
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
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  urgentDotText: {
    color: '#fff',
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
    color: '#fff',
  },

  executorRowSelected: {
    backgroundColor: '#f0f8ff',
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
    backgroundColor: '#f9f9f9',
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
    backgroundColor: '#eee',
    marginVertical: 4,
  },

  dropdownButton: {
    backgroundColor: theme.colors.card,
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
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.card,
    padding: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  clearButton: {
    marginTop: 12,
    backgroundColor: '#eee',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  clearButtonText: {
    color: theme.colors.primary,
    fontWeight: '500',
  },

  container: { padding: 16, paddingBottom: 40, backgroundColor: theme.colors.bg },
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
    backgroundColor: '#e0e0e0',
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
    color: '#fff',
    fontWeight: '600',
  },
  executorScroll: {
    marginBottom: 20,
  },
  chipSmall: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#ddd',
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
    color: '#fff',
    fontWeight: '500',
  },

  card: {
    backgroundColor: theme.colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
    color: theme.colors.text,
  },
  cardSubtitle: {
    fontSize: 14,
    color: theme.text.muted.color,
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
    color: theme.text.muted.color,
  },
  cardExecutor: { fontSize: 13, color: theme.text.muted.color },
  emptyText: {
    textAlign: 'center',
    marginTop: 32,
    fontSize: 16,
    color: theme.text.muted.color,
  },
}), [theme]);

const router = useRouter();

  // Global cache with TTL
  const CACHE_TTL_MS = 45000;
  const LIST_CACHE = (globalThis.LIST_CACHE ||= {});
  LIST_CACHE.all ||= {};
  const { filter, executor, search } = useLocalSearchParams();
  const [orders, setOrders] = useState(() => {
    const key = JSON.stringify({ status: 'feed', ex: null });
    const cached = LIST_CACHE.all[key];
    return cached?.data || [];
  });
  const [loading, setLoading] = useState(() => {
    const key = JSON.stringify({ status: 'feed', ex: null });
    return LIST_CACHE.all[key] ? false : true;
  });
  const [statusFilter, setStatusFilter] = useState(
    filter === 'completed' ? 'done'
      : filter === 'in_progress' ? 'in_progress'
      : filter === 'new' ? 'new'
      : filter || 'all'
  );
  const [executorFilter, setExecutorFilter] = useState(executor || null);
  const cacheKey = useMemo(() => JSON.stringify({ status: statusFilter, ex: executorFilter || null }), [statusFilter, executorFilter]);
  const [executors, setExecutors] = useState([]);
  const [searchQuery, setSearchQuery] = useState(search || '');
  const [refreshing, setRefreshing] = useState(false);
  
  const [executorModalVisible, setExecutorModalVisible] = useState(false);
  const [executorSearch, setExecutorSearch] = useState('');

  const sortedExecutors = [...executors].sort((a, b) =>
    ([a.first_name, a.last_name].filter(Boolean).join(' ') || '').localeCompare(
      [b.first_name, b.last_name].filter(Boolean).join(' ') || ''
    )
  );

  const filteredExecutors = executorSearch.trim() === ''
    ? sortedExecutors
    : sortedExecutors.filter((user) => {
        const name = [user.first_name, user.last_name].filter(Boolean).join(' ').toLowerCase();
        return name.includes(executorSearch.toLowerCase());
      });

  useEffect(() => {

    const fetchOrders = async () => {
      const cached = LIST_CACHE.all[cacheKey];
      if (cached) {
        setOrders(cached.data);
        setLoading(false); // show cache instantly
      } else {
        setLoading(true);
      }
      // ⬇️ читаем защищённое представление с маской телефона
      let query = supabase.from('orders_read_masked').select('*');

      if (statusFilter === 'feed') {
        // Свободные заявки (в ленте)
        query = query.is('assigned_to', null);
      } else {
        const statusValue = mapStatusToDB(statusFilter);
        if (statusValue) query = query.eq('status', statusValue);
        if (executorFilter) {
          query = query.eq('assigned_to', executorFilter);
        }
      }

      const { data, error } = await query.order('datetime', { ascending: false });
      if (!error) {
        setOrders(data || []);
        LIST_CACHE.all[cacheKey] = { data: data || [], ts: Date.now() };
      }
      setLoading(false);
    };

    fetchOrders();
  }, [statusFilter, executorFilter]);

  useEffect(() => {
    const fetchExecutors = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .neq('role', 'client');

      if (!error) setExecutors(data || []);
    };
    fetchExecutors();
  }, []);

  
  // Auto refresh by TTL (background, no spinner if cache exists)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const cached = LIST_CACHE.all[cacheKey];
      const freshNeeded = !cached || (Date.now() - (cached.ts || 0) > CACHE_TTL_MS);
      if (!freshNeeded) return;
      // refresh silently
      let query = supabase.from('orders_read_masked').select('*');
      if (statusFilter === 'feed') {
        query = query.is('assigned_to', null);
      } else {
        const statusValue = mapStatusToDB(statusFilter);
        if (statusValue) query = query.eq('status', statusValue);
        if (executorFilter) query = query.eq('assigned_to', executorFilter);
      }
      const { data, error } = await query.order('datetime', { ascending: false });
      if (!alive) return;
      if (!error) {
        setOrders(data || []);
        LIST_CACHE.all[cacheKey] = { data: data || [], ts: Date.now() };
      }
    };
    const id = setInterval(tick, 15000); // check every 15s
    tick(); // initial check
    return () => { alive = false; clearInterval(id); };
  }, [cacheKey, statusFilter, executorFilter]);
const onRefresh = async () => {
    try {
      setRefreshing(true);
      let query = supabase.from('orders_read_masked').select('*');
      if (statusFilter === 'feed') {
        query = query.is('assigned_to', null);
      } else {
        const statusValue = mapStatusToDB(statusFilter);
        if (statusValue) query = query.eq('status', statusValue);
        if (executorFilter) query = query.eq('assigned_to', executorFilter);
      }
      const { data, error } = await query.order('datetime', { ascending: false });
      if (!error) {
        setOrders(data || []);
        LIST_CACHE.all[cacheKey] = { data: data || [], ts: Date.now() };
      }
    } finally {
      setRefreshing(false);
    }
  };

  const getStatusLabel = (key) => {
    switch (key) {
      case 'feed': return 'Лента';
      case 'all': return 'Все';
      case 'new': return 'Новые';
      case 'in_progress': return 'В работе';
      case 'done': return 'Завершённые';
      default: return '';
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
      .map(s => String(s).trim())
      .filter(Boolean);
    return parts.length ? parts.join(', ') : '—';
  };

  const getExecutorName = (executorId) => {
    if (!executorId) return 'Не назначен';
    const ex = executors.find(e => e.id === executorId);
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
      o.phone_visible, // ⬅️ защищённый номер
      o.region,
      o.city,
      o.street,
      o.house
    ].filter(Boolean).map(String).join(' ').toLowerCase();
    return haystack.includes(q);
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} style={{ backgroundColor: theme.colors.bg }} contentContainerStyle={styles.container}>
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

          <TextInput
            placeholder="Поиск по названию, городу, телефону..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />

          <Pressable onPress={() => setExecutorModalVisible(true)} style={styles.dropdownButton}>
            <Text style={styles.dropdownButtonText}>
              {executorFilter
                ? [executors.find((e) => e.id === executorFilter)?.first_name, executors.find((e) => e.id === executorFilter)?.last_name].filter(Boolean).join(' ')
                : 'Выбрать исполнителя'}
            </Text>
          </Pressable>

          <Modal
            visible={executorModalVisible}
            animationType="slide"
            transparent={true}
            onRequestClose={() => setExecutorModalVisible(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <TextInput
                  placeholder="Поиск исполнителя..."
                  value={executorSearch}
                  onChangeText={setExecutorSearch}
                  style={styles.searchInput}
                />
                <FlatList
                  data={filteredExecutors}
                  keyExtractor={(item) => item.id}
                  ItemSeparatorComponent={() => <View style={styles.separator} />}
                  renderItem={({ item }) => (
                    <Pressable
                      style={styles.executorOption}
                      onPress={() => {
                        setExecutorFilter(item.id);
                        setExecutorModalVisible(false);
                        router.setParams({ executor: item.id });
                      }}
                    >
                      <View style={[styles.executorRow, executorFilter === item.id && styles.executorRowSelected]}>
                        <Text style={styles.executorText}>
                          {[item.first_name, item.last_name].filter(Boolean).join(' ')}
                        </Text>
                        {executorFilter === item.id && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                    </Pressable>
                  )}
                />
                <Pressable
                  style={styles.clearButton}
                  onPress={() => {
                    setExecutorFilter(null);
                    setExecutorModalVisible(false);
                    router.setParams({ executor: null });
                  }}
                >
                  <Text style={styles.clearButtonText}>Сбросить</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {loading ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
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
                    pathname: `/order-details/${order.id}`,
                    params: {
                      returnTo: '/(tabs)/all-orders',
                      returnParams: JSON.stringify({
                        filter: statusFilter,
                        executor: executorFilter,
                        search: searchQuery,
                      }),
                    },
                  })
                }
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

