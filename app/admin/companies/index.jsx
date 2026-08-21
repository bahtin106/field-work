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
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { hasDisplayValue } from '../../../src/shared/display/value';
import { TEXT_INPUT_LIMITS } from '../../../src/shared/input/limits';
import { withReadDeadline } from '../../../src/shared/network/readDeadline';
import {
  canRunDeferredNetworkWork,
  useOfflineSnapshot,
} from '../../../src/shared/offline/offlineStatus';
import { useTheme } from '../../../theme/ThemeProvider';

async function fetchCompanies(search, signal) {
  const { data, error } = await supabase
    .rpc('admin_list_companies', {
      p_search: search || null,
      p_limit: ADMIN_PAGE_SIZE,
      p_offset: 0,
    })
    .abortSignal(signal);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function resolveDateLocale(locale) {
  return String(locale || '').trim().toLowerCase().startsWith('en') ? 'en-US' : 'ru-RU';
}

function formatSubscriptionDate(value, locale) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(resolveDateLocale(locale), {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function getSubscriptionLabel(row, locale, t) {
  const date = formatSubscriptionDate(row?.current_period_end, locale);
  if (!date) return t('admin_companies_subscription_not_configured');

  const key =
    String(row?.subscription_status || '').toLowerCase() === 'active'
      ? 'admin_companies_subscription_active_until'
      : 'admin_companies_subscription_expired_on';

  return t(key).replace('{date}', date);
}

function getSubscriptionColor(row, theme) {
  const date = row?.current_period_end ? new Date(row.current_period_end) : null;
  if (!date || Number.isNaN(date.getTime())) return theme.colors.textSecondary;

  return String(row?.subscription_status || '').toLowerCase() === 'active'
    ? theme.colors.success
    : theme.colors.danger;
}

function resolveThemeSpacing(theme, value, fallback) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return theme.spacing[value] ?? fallback;
  return fallback;
}

export default function AdminCompaniesScreen() {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const nav = useNavigation();
  const router = useRouter();
  const { isAllowed, isLoading: guardLoading } = useRequireSuperAdmin();
  const offlineSnapshot = useOfflineSnapshot();
  const canUseAdminNetwork = canRunDeferredNetworkWork(offlineSnapshot);
  const [search, setSearch] = React.useState('');

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/companies') });
  }, [nav, t]);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ['adminCompanies', search],
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) => fetchCompanies(search.trim(), readSignal),
        { label: 'Admin companies', signal },
      ),
    enabled: isAllowed && canUseAdminNetwork,
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
  });
  const refreshCompanies = React.useCallback(
    () => (canUseAdminNetwork ? refetch() : Promise.resolve()),
    [canUseAdminNetwork, refetch],
  );

  const openCompany = React.useCallback(
    (companyId) => {
      router.push({
        pathname: '/admin/companies/details',
        params: { companyId },
      });
    },
    [router],
  );

  const renderCompany = React.useCallback(
    ({ item: row }) => (
      <Card padded={false}>
        <Pressable
          style={({ pressed }) => [
            styles.companyRow,
            pressed ? styles.companyRowPressed : null,
          ]}
          onPress={() => openCompany(row.company_id)}
          android_ripple={{ color: theme.colors.ripple, borderless: false }}
          pressRetentionOffset={theme.components.interactive.pressRetentionOffset}
          accessibilityRole="button"
          accessibilityLabel={row.name || row.company_id}
        >
          <View style={styles.companyInfo}>
            <Text style={styles.companyName} numberOfLines={2}>
              {row.name || row.company_id}
            </Text>
            <Text style={styles.companyMeta}>
              {t('admin_companies_employees')}: {row.employees_count ?? 0}
            </Text>
            <Text style={styles.companyMeta} numberOfLines={2}>
              {hasDisplayValue(row.admin_name)
                ? `${t('admin_companies_admin')}: ${row.admin_name}`
                : t('admin_companies_admin_unassigned')}
            </Text>
            {hasDisplayValue(row.admin_email) ? (
              <Text style={styles.companyMeta} numberOfLines={1}>
                {row.admin_email}
              </Text>
            ) : null}
            <Text
              style={[
                styles.subscription,
                { color: getSubscriptionColor(row, theme) },
              ]}
              numberOfLines={2}
            >
              {getSubscriptionLabel(row, locale, t)}
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
    ),
    [locale, openCompany, styles, t, theme],
  );

  const keyExtractor = React.useCallback((row) => String(row.company_id), []);
  const companies = Array.isArray(data) ? data : [];
  const refreshing = isRefetching && !isLoading;

  const errorCard = error ? (
    <Card style={styles.stateCard}>
      <Text style={styles.errorTitle}>{t('admin_error_title')}</Text>
      <Text style={styles.errorText}>{String(error?.message || t('admin_unknown_error'))}</Text>
      <Button
        title={t('btn_retry')}
        size="sm"
        onPress={refreshCompanies}
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
            onClear={() => setSearch('')}
            placeholder={t('admin_companies_search_placeholder')}
            searchProps={{ maxLength: TEXT_INPUT_LIMITS.search }}
          />
        </View>

        <FlatList
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            companies.length === 0 ? styles.emptyListContent : null,
          ]}
          data={companies}
          keyExtractor={keyExtractor}
          renderItem={renderCompany}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <ThemedRefreshControl refreshing={refreshing} onRefresh={refreshCompanies} />
          }
          ListHeaderComponent={error && companies.length > 0 ? errorCard : null}
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
              <EmptyListState
                style={styles.state}
                message={t('admin_companies_empty')}
              />
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
    companyRow: {
      minHeight: theme.components.listItem.height,
      paddingHorizontal: cardPaddingX,
      paddingVertical: cardPaddingY,
      borderRadius: theme.components.card.radius,
      flexDirection: 'row',
      alignItems: 'center',
    },
    companyRowPressed: {
      opacity: theme.components.button.pressedOpacity,
    },
    companyInfo: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing.xs,
    },
    companyName: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    companyMeta: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    subscription: {
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
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
