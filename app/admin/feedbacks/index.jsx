import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { resolveAppLocale } from '../../../lib/localeFormatting';
import { supabase } from '../../../lib/supabase';
import {
  listSupportRequests,
  SUPPORT_STATUS,
  SUPPORT_UNREAD_REFETCH_MS,
} from '../../../src/features/supportRequests/api';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import { withAlpha } from '../../../theme/colors';

function getStatusMeta(t, theme, status) {
  const map = {
    [SUPPORT_STATUS.NEW]: { label: t('support_status_new'), color: theme.colors.primary },
    [SUPPORT_STATUS.VIEWED]: { label: t('support_status_viewed'), color: theme.colors.textSecondary },
    [SUPPORT_STATUS.IN_PROGRESS]: { label: t('support_status_in_progress'), color: theme.colors.warning || theme.colors.primary },
    [SUPPORT_STATUS.COMPLETED]: { label: t('support_status_completed'), color: theme.colors.success || theme.colors.primary },
  };
  return map[status] || map[SUPPORT_STATUS.NEW];
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  try {
    return d.toLocaleString(resolveAppLocale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

export default function AdminFeedbacksScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const router = useRouter();
  const { isAllowed, isLoading: guardLoading } = useRequireSuperAdmin();
  const [includeCompleted, setIncludeCompleted] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState('active');

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/feedbacks') });
  }, [nav, t]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adminSupportRequests', { includeCompleted }],
    queryFn: () => listSupportRequests({ limit: 300, includeCompleted }),
    enabled: isAllowed,
    staleTime: 10 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: SUPPORT_UNREAD_REFETCH_MS,
    refetchIntervalInBackground: true,
    placeholderData: (previous) => previous,
  });

  React.useEffect(() => {
    if (!isAllowed) return undefined;
    const channel = supabase
      .channel('admin-feedbacks-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, () => {
        refetch?.();
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [isAllowed, refetch]);

  if (guardLoading || !isAllowed) {
    return <Screen background="background" />;
  }

  const statusCounts = (data || []).reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  const statusOrder = {
    [SUPPORT_STATUS.NEW]: 0,
    [SUPPORT_STATUS.IN_PROGRESS]: 1,
    [SUPPORT_STATUS.VIEWED]: 2,
    [SUPPORT_STATUS.COMPLETED]: 3,
  };
  const visibleData = (statusFilter === 'active'
    ? (data || []).filter((item) => item.status !== SUPPORT_STATUS.COMPLETED)
    : (data || []).filter((item) => item.status === statusFilter))
    .slice()
    .sort((left, right) => {
      const statusDelta = (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9);
      if (statusDelta !== 0) return statusDelta;
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    });
  const filterItems = [
    { id: 'active', label: t('support_filter_active'), count: (data || []).filter((item) => item.status !== SUPPORT_STATUS.COMPLETED).length },
    { id: SUPPORT_STATUS.NEW, label: t('support_status_new'), count: statusCounts[SUPPORT_STATUS.NEW] || 0 },
    { id: SUPPORT_STATUS.VIEWED, label: t('support_status_viewed'), count: statusCounts[SUPPORT_STATUS.VIEWED] || 0 },
    { id: SUPPORT_STATUS.IN_PROGRESS, label: t('support_status_in_progress'), count: statusCounts[SUPPORT_STATUS.IN_PROGRESS] || 0 },
    ...(includeCompleted
      ? [{ id: SUPPORT_STATUS.COMPLETED, label: t('support_status_completed'), count: statusCounts[SUPPORT_STATUS.COMPLETED] || 0 }]
      : []),
  ];

  return (
    <Screen background="background" scroll={false}>
      <ScrollView contentContainerStyle={styles(theme).content}>
        <View style={styles(theme).toolbar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles(theme).filters}>
            {filterItems.map((filter) => {
              const selected = statusFilter === filter.id;
              return (
                <Pressable
                  key={filter.id}
                  onPress={() => setStatusFilter(filter.id)}
                  style={[
                    styles(theme).filterChip,
                    selected && styles(theme).filterChipSelected,
                  ]}
                >
                  <Text style={[styles(theme).filterText, selected && styles(theme).filterTextSelected]}>
                    {filter.label} · {filter.count}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Button
            title={includeCompleted ? t('support_hide_completed') : t('support_show_completed')}
            variant="secondary"
            size="sm"
            onPress={() => {
              setIncludeCompleted((value) => !value);
              if (includeCompleted && statusFilter === SUPPORT_STATUS.COMPLETED) setStatusFilter('active');
            }}
          />
        </View>
        {isLoading ? <Text style={styles(theme).muted}>{t('admin_loading')}</Text> : null}
        {error ? (
          <Card style={styles(theme).card}>
            <Text style={styles(theme).title}>{t('admin_error_title')}</Text>
            <Text style={styles(theme).muted}>{String(error?.message || t('admin_unknown_error'))}</Text>
            <Button
              title={t('btn_retry')}
              size="sm"
              onPress={() => refetch()}
              containerStyle={styles(theme).retryButtonContainer}
            />
          </Card>
        ) : null}

        {!isLoading && !error && visibleData.length === 0 ? (
          <Text style={styles(theme).muted}>{t('admin_feedbacks_empty')}</Text>
        ) : null}

        {visibleData.map((item) => {
          const statusMeta = getStatusMeta(t, theme, item.status);
          return (
          <Card
            key={item.id}
            style={[
              styles(theme).card,
              item.status !== SUPPORT_STATUS.NEW ? null : styles(theme).cardUnread,
            ]}
            padded={false}
          >
            <Pressable
              style={styles(theme).row}
              onPress={() =>
                router.push({
                  pathname: '/admin/feedbacks/[id]',
                  params: { id: item.id },
                })
              }
            >
              <View style={styles(theme).rowLeft}>
                <View style={styles(theme).metaTopRow}>
                  <Text style={styles(theme).metaDate}>{formatDateTime(item.createdAt)}</Text>
                  {item.deletionState === 'cleanup_failed' ? (
                    <View style={[styles(theme).badge, styles(theme).badgeDanger]}>
                      <Text style={[styles(theme).badgeText, styles(theme).badgeDangerText]}>
                        {t('admin_feedbacks_cleanup_failed_badge')}
                      </Text>
                    </View>
                  ) : (
                    <View style={[styles(theme).badge, { borderColor: statusMeta.color, backgroundColor: withAlpha(statusMeta.color, 0.1) }]}>
                      <Text style={[styles(theme).badgeText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles(theme).name} numberOfLines={1}>
                  {item.authorName || '—'}
                </Text>
                <Text style={styles(theme).meta} numberOfLines={1}>
                  {item.companyName || item.companyId || '—'}
                </Text>
                <Text style={styles(theme).message} numberOfLines={2}>
                  {item.shortMessage || item.message || '—'}
                </Text>
                {item.deletionState === 'cleanup_failed' && item.deleteError ? (
                  <Text style={styles(theme).errorLine} numberOfLines={2}>
                    {item.deleteError}
                  </Text>
                ) : null}
              </View>
              <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
            </Pressable>
          </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
      gap: theme.spacing.md,
    },
    card: {
      borderRadius: theme.components.card.radius,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    cardUnread: {
      borderColor: theme.colors.primary,
      borderWidth: 1.5,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
    },
    muted: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    retryButtonContainer: {
      marginTop: theme.spacing.sm,
      alignSelf: 'flex-start',
    },
    toolbar: { gap: theme.spacing.sm, marginBottom: theme.spacing.xs },
    filters: { gap: theme.spacing.sm, paddingRight: theme.spacing.md },
    filterChip: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.pill || 999,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
    },
    filterChipSelected: { borderColor: theme.colors.primary, backgroundColor: withAlpha(theme.colors.primary, 0.1) },
    filterText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.medium },
    filterTextSelected: { color: theme.colors.primary, fontWeight: theme.typography.weight.semibold },
    row: {
      minHeight: theme.components.row.minHeight + theme.spacing.xl,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    rowLeft: {
      flex: 1,
      gap: theme.spacing.xs,
      paddingRight: theme.spacing.sm,
    },
    metaTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    metaDate: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
    },
    badge: {
      borderRadius: theme.radii.pill || 999,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.primary,
      paddingHorizontal: theme.spacing.xs,
      paddingVertical: 2,
    },
    badgeText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.semibold,
    },
    badgeDanger: {
      borderColor: theme.colors.danger,
    },
    badgeDangerText: {
      color: theme.colors.danger,
    },
    name: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    meta: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    message: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
    },
    errorLine: {
      color: theme.colors.danger,
      fontSize: theme.typography.sizes.xs,
    },
  });
