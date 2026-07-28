import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import SearchFiltersBar from '../../../components/filters/SearchFiltersBar';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import EmptyListState from '../../../components/ui/EmptyListState';
import { ThemedRefreshControl } from '../../../components/ui/PullToRefreshFeedback';
import { ADMIN_PAGE_SIZE } from '../../../constants/admin';
import { ROLE, getRoleLabel } from '../../../constants/roles';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { resolveAppLocale } from '../../../lib/localeFormatting';
import { formatPersonName } from '../../../lib/personName';
import { pluralizeRu } from '../../../lib/pluralize';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { hasDisplayValue } from '../../../src/shared/display/value';
import { TEXT_INPUT_LIMITS } from '../../../src/shared/input/limits';
import { useOfflineSnapshot } from '../../../src/shared/offline/offlineStatus';
import { useTheme } from '../../../theme/ThemeProvider';

async function fetchUsers(search) {
  const { data, error } = await supabase.rpc('admin_list_users_v2', {
    p_search: search || null,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: 0,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function parsePostgresTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  try {
    let normalized = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(normalized)) {
      normalized = normalized.replace(' ', 'T');
    }
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
      normalized += 'Z';
    }

    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function resolveThemeSpacing(theme, value, fallback) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return theme.spacing[value] ?? fallback;
  return fallback;
}

function getAdminRoleLabel(row, t) {
  if (row?.is_super_admin) return t('role_super_admin');
  return getRoleLabel(row?.role, t);
}

function getRoleColor(row, theme) {
  if (row?.is_super_admin || row?.role === ROLE.ADMIN) return theme.colors.primary;
  if (row?.role === ROLE.DISPATCHER) return theme.colors.success;
  if (row?.role === ROLE.WORKER) return theme.colors.worker || theme.colors.primary;
  return theme.colors.textSecondary;
}

export default function AdminUsersScreen() {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { isOnline } = useOfflineSnapshot();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const nav = useNavigation();
  const router = useRouter();
  const { isAllowed, isLoading: guardLoading } = useRequireSuperAdmin();
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/users') });
  }, [nav, t]);

  React.useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(search.trim()),
      Number(theme.timings?.backDelayMs ?? 300),
    );
    return () => clearTimeout(timer);
  }, [search, theme.timings?.backDelayMs]);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ['adminUsersV2', debouncedSearch],
    queryFn: () => fetchUsers(debouncedSearch),
    enabled: isAllowed,
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
  });

  const isOnlineNow = React.useCallback(
    (value) => {
      const date = parsePostgresTimestamp(value);
      if (!isOnline || !date) return false;

      const difference = Date.now() - date.getTime();
      const onlineWindowMs = Number(theme.timings?.presenceOnlineWindowMs ?? 120000);
      const futureSkewMs = Number(theme.timings?.presenceFutureSkewMs ?? 300000);
      return difference <= onlineWindowMs && difference >= -futureSkewMs;
    },
    [
      isOnline,
      theme.timings?.presenceFutureSkewMs,
      theme.timings?.presenceOnlineWindowMs,
    ],
  );

  const formatRelativeTime = React.useCallback(
    (date) => {
      const differenceMs = Math.max(0, Date.now() - date.getTime());
      const minutes = Math.floor(differenceMs / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (minutes < 1) return t('users_relativeTime_now');
      if (minutes < 60) {
        const unit = pluralizeRu(
          minutes,
          t('users_relativeTime_min_1'),
          t('users_relativeTime_min_2_4'),
          t('users_relativeTime_min_5'),
        );
        return `${minutes} ${unit} ${t('users_relativeTime_ago')}`;
      }
      if (hours < 24) {
        const unit = pluralizeRu(
          hours,
          t('users_relativeTime_hour_1'),
          t('users_relativeTime_hour_2_4'),
          t('users_relativeTime_hour_5'),
        );
        return `${hours} ${unit} ${t('users_relativeTime_ago')}`;
      }
      if (days <= 3) {
        const unit = pluralizeRu(
          days,
          t('users_relativeTime_day_1'),
          t('users_relativeTime_day_2_4'),
          t('users_relativeTime_day_5'),
        );
        return `${days} ${unit} ${t('users_relativeTime_ago')}`;
      }
      return null;
    },
    [t],
  );

  const formatPresence = React.useCallback(
    (value) => {
      if (isOnlineNow(value)) return t('users_online');

      const date = parsePostgresTimestamp(value);
      if (!date) return `${t('users_lastSeen_prefix')} ${t('users_lastLogin_never')}`;

      const relativeTime = formatRelativeTime(date);
      const lastSeen = relativeTime || new Intl.DateTimeFormat(resolveAppLocale(locale), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date);

      return `${t('users_lastSeen_prefix')} ${lastSeen}`;
    },
    [formatRelativeTime, isOnlineNow, locale, t],
  );

  const openUser = React.useCallback(
    (profileId) => {
      router.push(`/users/${profileId}`);
    },
    [router],
  );

  const clearSearch = React.useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
  }, []);

  const renderUser = React.useCallback(
    ({ item: row }) => {
      const name = formatPersonName(row, row.email || row.profile_id);
      const roleLabel = getAdminRoleLabel(row, t);
      const roleColor = getRoleColor(row, theme);
      const online = isOnlineNow(row.last_seen_at);

      return (
        <Card padded={false}>
          <Pressable
            style={({ pressed }) => [styles.userRow, pressed ? styles.userRowPressed : null]}
            onPress={() => openUser(row.profile_id)}
            android_ripple={{ color: theme.colors.ripple, borderless: false }}
            pressRetentionOffset={theme.components.interactive.pressRetentionOffset}
            accessibilityRole="button"
            accessibilityLabel={name}
          >
            <View style={styles.userInfo}>
              <View style={styles.titleRow}>
                <Text style={styles.userName} numberOfLines={2}>
                  {name}
                </Text>
                {hasDisplayValue(roleLabel) ? (
                  <View style={[styles.roleBadge, { borderColor: roleColor }]}>
                    <Text style={[styles.roleBadgeText, { color: roleColor }]} numberOfLines={1}>
                      {roleLabel}
                    </Text>
                  </View>
                ) : null}
              </View>

              {hasDisplayValue(row.email) ? (
                <Text style={styles.userMeta} numberOfLines={1}>
                  {row.email}
                </Text>
              ) : null}
              {hasDisplayValue(row.phone) ? (
                <Text style={styles.userMeta} numberOfLines={1}>
                  {t('view_label_phone')}: {row.phone}
                </Text>
              ) : null}
              {hasDisplayValue(row.company_name || row.company_id) ? (
                <Text style={styles.userMeta} numberOfLines={2}>
                  {t('admin_users_company')}: {row.company_name || row.company_id}
                </Text>
              ) : null}
              <Text
                style={[styles.userMeta, online ? styles.online : null]}
                numberOfLines={1}
              >
                {formatPresence(row.last_seen_at)}
              </Text>
            </View>

            <View style={styles.chevron}>
              <Feather
                name="chevron-right"
                size={theme.components.listItem.chevronSize}
                color={theme.colors.textSecondary}
              />
            </View>
          </Pressable>
        </Card>
      );
    },
    [formatPresence, isOnlineNow, openUser, styles, t, theme],
  );

  const keyExtractor = React.useCallback((row) => String(row.profile_id), []);
  const users = Array.isArray(data) ? data : [];
  const refreshing = isRefetching && !isLoading && debouncedSearch === search.trim();

  const errorCard = error ? (
    <Card style={styles.stateCard}>
      <Text style={styles.errorTitle}>{t('admin_error_title')}</Text>
      <Text style={styles.errorText}>{String(error?.message || t('admin_unknown_error'))}</Text>
      <Button
        title={t('btn_retry')}
        size="sm"
        onPress={() => refetch()}
        containerStyle={styles.retryButton}
      />
    </Card>
  ) : null;

  if (guardLoading || !isAllowed) {
    return <Screen scroll={false} />;
  }

  return (
    <Screen scroll={false}>
      <View style={styles.screen}>
        <View style={styles.search}>
          <SearchFiltersBar
            value={search}
            onChangeText={setSearch}
            onClear={clearSearch}
            placeholder={t('admin_users_search_placeholder')}
            searchProps={{ maxLength: TEXT_INPUT_LIMITS.search }}
          />
        </View>

        <FlatList
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            users.length === 0 ? styles.emptyListContent : null,
          ]}
          data={users}
          keyExtractor={keyExtractor}
          renderItem={renderUser}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <ThemedRefreshControl refreshing={refreshing} onRefresh={refetch} />
          }
          ListHeaderComponent={error && users.length > 0 ? errorCard : null}
          ListEmptyComponent={
            isLoading ? (
              <View style={styles.state}>
                <ActivityIndicator
                  size={theme.components.activityIndicator.size}
                  color={theme.colors.primary}
                />
              </View>
            ) : error ? (
              errorCard
            ) : (
              <EmptyListState style={styles.state} message={t('admin_users_empty')} />
            )
          }
        />
      </View>
    </Screen>
  );
}

const createStyles = (theme) => {
  const cardPaddingX = resolveThemeSpacing(
    theme,
    theme.components.card.padX,
    theme.spacing.lg,
  );
  const cardPaddingY = resolveThemeSpacing(
    theme,
    theme.components.card.padY,
    theme.spacing.lg,
  );

  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    search: {
      paddingTop: theme.spacing.sm,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
      gap: theme.spacing.sm,
    },
    emptyListContent: {
      flexGrow: 1,
    },
    userRow: {
      minHeight: theme.components.listItem.height,
      paddingHorizontal: cardPaddingX,
      paddingVertical: cardPaddingY,
      borderRadius: theme.components.card.radius,
      flexDirection: 'row',
      alignItems: 'center',
    },
    userRowPressed: {
      opacity: theme.components.button.pressedOpacity,
    },
    userInfo: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing.xs,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
    },
    userName: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    userMeta: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    online: {
      color: theme.colors.success,
      fontWeight: theme.typography.weight.semibold,
    },
    roleBadge: {
      flexShrink: 1,
      maxWidth: '48%',
      borderRadius: theme.radii.pill,
      borderWidth: theme.components.card.borderWidth,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      backgroundColor: theme.colors.surface,
    },
    roleBadgeText: {
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.bold,
    },
    chevron: {
      flexShrink: 0,
      marginLeft: theme.components.listItem.chevronGap,
      alignItems: 'center',
      justifyContent: 'center',
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingVertical: theme.spacing.xl,
    },
    stateCard: {
      gap: theme.spacing.sm,
    },
    errorTitle: {
      color: theme.colors.danger,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
    },
    errorText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    retryButton: {
      alignSelf: 'flex-start',
    },
  });
};
