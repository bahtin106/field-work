import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { supabase } from '../../../lib/supabase';
import { listSupportRequests, SUPPORT_UNREAD_REFETCH_MS } from '../../../src/features/supportRequests/api';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  try {
    return d.toLocaleString('ru-RU', {
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

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/feedbacks') });
  }, [nav, t]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adminSupportRequests'],
    queryFn: () => listSupportRequests({ limit: 300 }),
    enabled: isAllowed,
    staleTime: 10 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: SUPPORT_UNREAD_REFETCH_MS,
    refetchIntervalInBackground: true,
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

  return (
    <Screen background="background">
      <ScrollView contentContainerStyle={styles(theme).content}>
        {isLoading ? <Text style={styles(theme).muted}>{t('admin_loading')}</Text> : null}
        {error ? (
          <Card style={styles(theme).card}>
            <Text style={styles(theme).title}>{t('admin_error_title')}</Text>
            <Text style={styles(theme).muted}>{String(error?.message || t('admin_unknown_error'))}</Text>
            <Pressable onPress={() => refetch()} style={styles(theme).retryBtn}>
              <Text style={styles(theme).retryText}>{t('btn_retry')}</Text>
            </Pressable>
          </Card>
        ) : null}

        {!isLoading && !error && (!data || data.length === 0) ? (
          <Text style={styles(theme).muted}>{t('admin_feedbacks_empty')}</Text>
        ) : null}

        {data?.map((item) => (
          <Card
            key={item.id}
            style={[
              styles(theme).card,
              item.isRead ? null : styles(theme).cardUnread,
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
                  ) : !item.isRead ? (
                    <View style={styles(theme).badge}>
                      <Text style={styles(theme).badgeText}>{t('admin_feedbacks_unread_badge')}</Text>
                    </View>
                  ) : null}
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
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    card: {
      borderRadius: theme.radii.md,
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
    retryBtn: {
      marginTop: theme.spacing.sm,
      alignSelf: 'flex-start',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.radii.sm,
      backgroundColor: theme.colors.primary,
    },
    retryText: {
      color: theme.colors.onPrimary,
      fontWeight: theme.typography.weight.medium,
    },
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
