import { useRouter, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';

import DynamicOrderCard from '../../../components/DynamicOrderCard'; 
import { supabase } from '../../../lib/supabase';
import { useTheme } from '../../../theme/ThemeProvider';
import { usePermissions } from '../../../lib/permissions';
import Screen from '../../../components/layout/Screen';
import TextField from '../../../components/ui/TextField';

export default function MyOrdersScreen() {
  const { theme } = useTheme();

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
  const EXECUTOR_NAME_CACHE =
    (globalThis.EXECUTOR_NAME_CACHE ||= new Map());

  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('feed');
  const [loading, setLoading] = useState(() => {
    const key = 'feed';
    return LIST_CACHE.my[key] ? false : true;
  });
  const [userId, setUserId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { seedFilter, seedSearch } = useLocalSearchParams();
  const seedOnceRef = useRef(false);
  useEffect(() => {
    if (seedOnceRef.current) return;
    seedOnceRef.current = true;
    /* seed from cache */
    const k =
      typeof seedFilter === 'string' && seedFilter.length
        ? seedFilter
        : filter || 'all';
    if (LIST_CACHE.my[k]) {
      setOrders(LIST_CACHE.my[k]);
    }
    if (typeof seedFilter === 'string' && seedFilter.length)
      setFilter(seedFilter);
    if (typeof seedSearch === 'string') setSearchQuery(seedSearch);
  }, [seedFilter, seedSearch]);

  useEffect(() => {
    try {
      router.setParams({ seedFilter: filter, seedSearch: searchQuery });
    } catch (e) {}
  }, [filter, searchQuery]);

  useEffect(() => {
    const fetchUserAndOrders = async () => {
      const key = (typeof filter === 'string' ? filter : 'all') || 'all';
      // If cache exists, show it immediately and refresh silently
      if (LIST_CACHE.my[key]) {
        setOrders(LIST_CACHE.my[key]);
        setLoading(false);
      } else {
        setLoading(true);
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

      const { data, error } = await query.order('datetime', { ascending: false });
      if (!error && Array.isArray(data)) {
        setOrders(data);
        LIST_CACHE.my[key] = data; // update cache
      }
      setLoading(false);
    };

    fetchUserAndOrders();
  }, [filter]);

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

  return (
    <Screen>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
                <Text
                  style={[
                    styles.chipText,
                    filter === key && styles.chipTextActive,
                  ]}
                >
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

          {loading ? (
            <ActivityIndicator
              size="large"
              color={theme.colors.primary}
              style={{ marginTop: 40 }}
            />
          ) : filteredOrders.length === 0 ? (
            <Text style={styles.emptyText}>У вас пока нет заказов</Text>
          ) : (
            filteredOrders.map((order) => (
              <DynamicOrderCard
                key={order.id}
                order={order}
                context="my_orders"
                onPress={() =>
                  router.push({
                    pathname: `/order-details/${order.id}`,
                    params: {
                      returnTo: '/(tabs)/orders',
                      returnParams: JSON.stringify({
                        seedFilter: filter,
                        seedSearch: searchQuery,
                      }),
                    },
                  })
                }
              />
            ))
          )}
        </ScrollView>
      </TouchableWithoutFeedback>
    </Screen>
  );
}
