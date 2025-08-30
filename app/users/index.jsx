import { useRouter, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Keyboard,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';

const ROLE_LABELS = {
  admin: 'Администратор',
  dispatcher: 'Диспетчер',
  worker: 'Рабочий',
};

const COLORS = {
  bg: '#F2F2F7',
  card: '#FFFFFF',
  text: '#111111',
  secondary: '#8E8E93',
  border: '#ECECEC',
  primary: '#007AFF',
  shadow: 'rgba(0,0,0,0.06)',
  admin: '#007AFF',
  dispatcher: '#34C759',
  worker: '#5856D6',
};

const CONTROL_HEIGHT = 44; // Единая высота для поля поиска и кнопки "Создать"

export default function UsersIndex() {
  const { theme } = useTheme();
  const router = useRouter();

  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // --- Debounce for search (200ms): smooth, iOS-like
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const fetchUsers = useCallback(async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .order('full_name', { ascending: true, nullsFirst: false });

      if (error) {
        setList([]);
        setErrorMsg('Не удалось загрузить список сотрудников.');
      } else {
        setList(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      setList([]);
      setErrorMsg('Ошибка сети при загрузке сотрудников.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    let mounted = true;
    (async () => {
      await fetchUsers();
    })();
    return () => {
      mounted = false;
    };
  }, [fetchUsers]);

  // Refresh when screen regains focus (e.g., after creating a user)
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await fetchUsers();
      })();
      return () => {
        active = false;
      };
    }, [fetchUsers]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUsers();
    setRefreshing(false);
  }, [fetchUsers]);

  const filtered = useMemo(() => {
    if (!debouncedQ) return list;
    return list.filter((u) => {
      const name = (u.full_name || '').toLowerCase();
      const roleCode = (u.role || '').toLowerCase();
      const roleRu = (ROLE_LABELS[u.role] || '').toLowerCase();
      // Ищем только по имени и роли (по-русски тоже), ID исключен
      return (
        name.includes(debouncedQ) || roleCode.includes(debouncedQ) || roleRu.includes(debouncedQ)
      );
    });
  }, [debouncedQ, list]);

  const goToUser = useCallback(
    (id) => {
      router.push(`/users/${id}`);
    },
    [router],
  );

  const rolePillStyle = (role) => {
    const color =
      role === 'admin' ? COLORS.admin : role === 'dispatcher' ? COLORS.dispatcher : COLORS.worker;
    return {
      container: [
        styles.rolePill,
        {
          backgroundColor: `${color}22`,
          borderColor: `${color}33`,
        },
      ],
      text: [styles.rolePillText, { color }],
    };
  };

  const renderItem = useCallback(
    ({ item }) => {
      const stylesPill = rolePillStyle(item.role);
      return (
        <TouchableOpacity
          onPress={() => goToUser(item.id)}
          activeOpacity={0.7}
          style={styles.card}
          accessibilityRole="button"
          accessibilityLabel={`Открыть сотрудника ${item.full_name || 'Без имени'}`}
        >
          <View style={styles.cardRow}>
            <View style={styles.cardTextWrap}>
              <Text numberOfLines={1} style={styles.cardTitle}>
                {(item.full_name ?? '').trim() || 'Без имени'}
              </Text>
            </View>
            <View style={stylesPill.container}>
              <Text style={stylesPill.text}>{ROLE_LABELS[item.role] || '—'}</Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [goToUser],
  );

  const keyExtractor = useCallback((item) => item.id, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const EmptyState = () => (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyText}>
        {list.length === 0 ? 'Пока пусто' : 'Ничего не найдено по запросу'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Сотрудники</Text>

            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <TextInput
                  placeholder="Поиск по имени/роли"
                  placeholderTextColor={COLORS.secondary}
                  value={q}
                  onChangeText={setQ}
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={Keyboard.dismiss}
                  style={styles.searchInput}
                />
                {!!q && (
                  <TouchableOpacity
                    onPress={() => setQ('')}
                    activeOpacity={0.8}
                    style={styles.clearBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Очистить поиск"
                  >
                    <Text style={styles.clearBtnText}>×</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                onPress={() => router.push('/users/new')}
                activeOpacity={0.7}
                style={styles.primaryBtn}
                accessibilityRole="button"
                accessibilityLabel="Создать сотрудника"
              >
                <Text style={styles.primaryBtnText}>Создать</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {debouncedQ ? `Найдено: ${filtered.length}` : `Всего: ${list.length}`}
              </Text>
            </View>

            {!!errorMsg && (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}
          </View>

          <FlatList
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            data={filtered}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={COLORS.primary}
                colors={Platform.OS === 'android' ? [COLORS.primary] : undefined}
              />
            }
            ListEmptyComponent={<EmptyState />}
          />
        </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
  },
  loaderWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchBox: {
    flex: 1,
    position: 'relative',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    height: CONTROL_HEIGHT,
    paddingLeft: 12,
    paddingRight: 40, // оставляем место под крестик
    justifyContent: 'center',
  },
  searchInput: {
    fontSize: 15,
    color: COLORS.text,
    height: CONTROL_HEIGHT,
    paddingVertical: 0,
  },
  clearBtn: {
    position: 'absolute',
    right: 8,
    top: (CONTROL_HEIGHT - 28) / 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: {
    fontSize: 20,
    lineHeight: 20,
    color: '#6B7280',
    fontWeight: '600',
    marginTop: -2,
  },
  primaryBtn: {
    height: CONTROL_HEIGHT,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  metaRow: {
    marginTop: 8,
  },
  metaText: {
    fontSize: 12,
    color: COLORS.secondary,
  },
  errorCard: {
    marginTop: 8,
    backgroundColor: '#FF3B3022',
    borderColor: '#FF3B3033',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTextWrap: {
    flexShrink: 1,
    paddingRight: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: COLORS.secondary,
  },
});
