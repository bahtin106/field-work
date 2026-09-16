import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import SearchFiltersBar from '../../../components/filters/SearchFiltersBar';
import SortSelectModal from '../../../components/filters/SortSelectModal';
import { useFilters } from '../../../components/hooks/useFilters';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import EmptyListState from '../../../components/ui/EmptyListState';
import MultiSelectModal from '../../../components/ui/modals/MultiSelectModal';
import { ThemedRefreshControl } from '../../../components/ui/PullToRefreshFeedback';
import { ADMIN_PAGE_SIZE } from '../../../constants/admin';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { hasDisplayValue } from '../../../src/shared/display/value';
import { joinFilterSummary, summarizeFilterPart } from '../../../src/shared/filters/summary';
import { TEXT_INPUT_LIMITS } from '../../../src/shared/input/limits';
import { withReadDeadline } from '../../../src/shared/network/readDeadline';
import {
  canRunDeferredNetworkWork,
  useOfflineSnapshot,
} from '../../../src/shared/offline/offlineStatus';
import {
  ADMIN_COMPANY_FILTER,
  ADMIN_COMPANY_SORT,
  filterAdminCompanies,
  sortAdminCompanies,
} from '../../../src/features/admin/directoryLists.mjs';
import { useTheme } from '../../../theme/ThemeProvider';

const ADMIN_COMPANY_FILTER_DEFAULTS = Object.freeze({ selections: [] });

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
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [sortVisible, setSortVisible] = React.useState(false);
  const [sortKey, setSortKey] = React.useState(ADMIN_COMPANY_SORT.NAME_ASC);
  const filters = useFilters({
    screenKey: 'admin-companies',
    defaults: ADMIN_COMPANY_FILTER_DEFAULTS,
  });

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/companies') });
  }, [nav, t]);

  React.useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(search.trim()),
      Number(theme.timings?.backDelayMs ?? 300),
    );
    return () => clearTimeout(timer);
  }, [search, theme.timings?.backDelayMs]);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ['adminCompanies', debouncedSearch],
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) => fetchCompanies(debouncedSearch, readSignal),
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
  const allCompanies = React.useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const filterSelections = React.useMemo(
    () => (Array.isArray(filters.values.selections) ? filters.values.selections : []),
    [filters.values.selections],
  );
  const companyFilterOptions = React.useMemo(
    () => [
      {
        id: `${ADMIN_COMPANY_FILTER.SUBSCRIPTION_PREFIX}${ADMIN_COMPANY_FILTER.SUBSCRIPTION_ACTIVE}`,
        value: `${ADMIN_COMPANY_FILTER.SUBSCRIPTION_PREFIX}${ADMIN_COMPANY_FILTER.SUBSCRIPTION_ACTIVE}`,
        label: t('admin_companies_filter_subscription_active'),
        subtitle: t('admin_companies_filter_subscription'),
      },
      {
        id: `${ADMIN_COMPANY_FILTER.SUBSCRIPTION_PREFIX}${ADMIN_COMPANY_FILTER.SUBSCRIPTION_EXPIRED}`,
        value: `${ADMIN_COMPANY_FILTER.SUBSCRIPTION_PREFIX}${ADMIN_COMPANY_FILTER.SUBSCRIPTION_EXPIRED}`,
        label: t('admin_companies_filter_subscription_expired'),
        subtitle: t('admin_companies_filter_subscription'),
      },
      {
        id: `${ADMIN_COMPANY_FILTER.SUBSCRIPTION_PREFIX}${ADMIN_COMPANY_FILTER.SUBSCRIPTION_NOT_CONFIGURED}`,
        value: `${ADMIN_COMPANY_FILTER.SUBSCRIPTION_PREFIX}${ADMIN_COMPANY_FILTER.SUBSCRIPTION_NOT_CONFIGURED}`,
        label: t('admin_companies_filter_subscription_not_configured'),
        subtitle: t('admin_companies_filter_subscription'),
      },
      {
        id: `${ADMIN_COMPANY_FILTER.ADMIN_PREFIX}${ADMIN_COMPANY_FILTER.ADMIN_ASSIGNED}`,
        value: `${ADMIN_COMPANY_FILTER.ADMIN_PREFIX}${ADMIN_COMPANY_FILTER.ADMIN_ASSIGNED}`,
        label: t('admin_companies_filter_admin_assigned'),
        subtitle: t('admin_companies_filter_admin'),
      },
      {
        id: `${ADMIN_COMPANY_FILTER.ADMIN_PREFIX}${ADMIN_COMPANY_FILTER.ADMIN_UNASSIGNED}`,
        value: `${ADMIN_COMPANY_FILTER.ADMIN_PREFIX}${ADMIN_COMPANY_FILTER.ADMIN_UNASSIGNED}`,
        label: t('admin_companies_filter_admin_unassigned'),
        subtitle: t('admin_companies_filter_admin'),
      },
    ],
    [t],
  );
  const filterSummaryData = React.useMemo(() => {
    const labelsByValue = new Map(companyFilterOptions.map((option) => [option.value, option.label]));
    const subscriptionLabels = filterSelections
      .filter((value) => String(value).startsWith(ADMIN_COMPANY_FILTER.SUBSCRIPTION_PREFIX))
      .map((value) => labelsByValue.get(value));
    const adminLabels = filterSelections
      .filter((value) => String(value).startsWith(ADMIN_COMPANY_FILTER.ADMIN_PREFIX))
      .map((value) => labelsByValue.get(value));
    const build = (countWhenMany) =>
      joinFilterSummary(
        [
          summarizeFilterPart({
            label: t('admin_companies_filter_subscription'),
            values: subscriptionLabels,
            countWhenMany,
          }),
          summarizeFilterPart({
            label: t('admin_companies_filter_admin'),
            values: adminLabels,
            countWhenMany,
          }),
        ],
        t('common_bullet'),
      );
    return { full: build(false), compact: build(true) };
  }, [companyFilterOptions, filterSelections, t]);
  const sortOptions = React.useMemo(
    () => [
      { id: ADMIN_COMPANY_SORT.NAME_ASC, label: t('sort_name_asc') },
      { id: ADMIN_COMPANY_SORT.NAME_DESC, label: t('sort_name_desc') },
      { id: ADMIN_COMPANY_SORT.EMPLOYEES_MANY_FEW, label: t('admin_sort_employees_many_few') },
      { id: ADMIN_COMPANY_SORT.EMPLOYEES_FEW_MANY, label: t('admin_sort_employees_few_many') },
      {
        id: ADMIN_COMPANY_SORT.SUBSCRIPTION_END_SOON_LATE,
        label: t('admin_sort_subscription_end_soon_late'),
      },
      {
        id: ADMIN_COMPANY_SORT.SUBSCRIPTION_END_LATE_SOON,
        label: t('admin_sort_subscription_end_late_soon'),
      },
      { id: ADMIN_COMPANY_SORT.UPDATED_NEW_OLD, label: t('admin_sort_updated_new_old') },
      { id: ADMIN_COMPANY_SORT.UPDATED_OLD_NEW, label: t('admin_sort_updated_old_new') },
    ],
    [t],
  );
  const companies = React.useMemo(
    () =>
      sortAdminCompanies(filterAdminCompanies(allCompanies, filterSelections), {
        sortKey,
        locale: resolveDateLocale(locale),
      }),
    [allCompanies, filterSelections, locale, sortKey],
  );
  const refreshing = isRefetching && !isLoading && debouncedSearch === search.trim();

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
            onClear={() => {
              setSearch('');
              setDebouncedSearch('');
            }}
            placeholder={t('admin_companies_search_placeholder')}
            onOpenFilters={filters.open}
            onOpenSort={() => setSortVisible(true)}
            filterSummary={filterSummaryData.full}
            filterSummaryCompact={filterSummaryData.compact}
            onResetFilters={async () => {
              const resetValues = filters.reset();
              await filters.apply(resetValues);
            }}
            metaText={`${t('common_total')}: ${companies.length}`}
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

      <MultiSelectModal
        visible={filters.visible}
        onClose={filters.close}
        title={t('common_filter')}
        items={companyFilterOptions}
        value={filterSelections}
        searchable={false}
        onChange={(nextSelections) => {
          const nextValues = { selections: nextSelections };
          filters.setValue('selections', nextSelections);
          void filters.apply(nextValues);
        }}
      />

      <SortSelectModal
        visible={sortVisible}
        onClose={() => setSortVisible(false)}
        options={sortOptions}
        value={sortKey}
        onChange={(nextSort) => {
          if (nextSort) setSortKey(nextSort);
        }}
      />
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
