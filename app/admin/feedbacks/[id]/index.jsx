import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../../components/layout/Screen';
import Button from '../../../../components/ui/Button';
import Card from '../../../../components/ui/Card';
import { useToast } from '../../../../components/ui/ToastProvider';
import { ConfirmModal } from '../../../../components/ui/modals';
import { useRequireSuperAdmin } from '../../../../hooks/useRequireSuperAdmin';
import { useAuthContext } from '../../../../providers/SimpleAuthProvider';
import {
  deleteSupportRequest,
  getSupportRequestById,
  markSupportRequestRead,
  SUPPORT_UNREAD_QUERY_KEY,
} from '../../../../src/features/supportRequests/api';
import { useTranslation } from '../../../../src/i18n/useTranslation';
import { useTheme } from '../../../../theme/ThemeProvider';
import FullscreenImageViewer from '../../../orders/components/FullscreenImageViewer';

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

function LabelValue({ theme, label, value }) {
  const text = String(value || '').trim() || '—';
  return (
    <View style={styles(theme).row}>
      <Text style={styles(theme).rowLabel}>{label}</Text>
      <Text style={styles(theme).rowValue}>{text}</Text>
    </View>
  );
}

export default function AdminFeedbackDetailsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const nav = useNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useAuthContext();
  const { isAllowed, isLoading: guardLoading } = useRequireSuperAdmin();
  const params = useLocalSearchParams();
  const id = String(params?.id || '').trim();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/feedbacks/[id]') });
  }, [nav, t]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adminSupportRequest', id],
    queryFn: () => getSupportRequestById(id),
    enabled: isAllowed && !!id,
    staleTime: 10 * 1000,
  });

  React.useEffect(() => {
    if (!id || !data || data.isRead) return;
    const readBy = profile?.id || profile?.user_id || null;
    markSupportRequestRead(id, readBy)
      .then(async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['adminSupportRequests'] }),
          queryClient.invalidateQueries({ queryKey: ['adminSupportRequest', id] }),
          queryClient.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY }),
        ]);
      })
      .catch(() => {});
  }, [data, id, profile?.id, profile?.user_id, queryClient]);

  const handleDelete = React.useCallback(async () => {
    if (!id || isDeleting) return;
    setIsDeleting(true);
    try {
      const result = await deleteSupportRequest(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['adminSupportRequests'] }),
        queryClient.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY }),
      ]);
      if (result?.status === 'queued') {
        toast.success(t('admin_feedback_delete_queued'));
      } else {
        toast.success(t('admin_feedback_deleted'));
      }
      router.back();
    } catch (e) {
      toast.error(String(e?.message || t('admin_unknown_error')));
    } finally {
      setIsDeleting(false);
    }
  }, [id, isDeleting, queryClient, router, t, toast]);

  if (guardLoading || !isAllowed) {
    return <Screen background="background" />;
  }

  return (
    <Screen background="background">
      <ScrollView contentContainerStyle={styles(theme).content}>
        {!id ? (
          <Text style={styles(theme).muted}>{t('admin_feedback_not_found')}</Text>
        ) : null}
        {isLoading ? <Text style={styles(theme).muted}>{t('admin_loading')}</Text> : null}
        {error ? (
          <Card style={styles(theme).card}>
            <Text style={styles(theme).title}>{t('admin_error_title')}</Text>
            <Text style={styles(theme).muted}>{String(error?.message || t('admin_unknown_error'))}</Text>
            <Button title={t('btn_retry')} variant="primary" onPress={() => refetch()} />
          </Card>
        ) : null}
        {!isLoading && !error && !data ? (
          <Text style={styles(theme).muted}>{t('admin_feedback_not_found')}</Text>
        ) : null}

        {data ? (
          <>
            <Card style={styles(theme).card}>
              <LabelValue theme={theme} label={t('admin_feedback_created_at')} value={formatDateTime(data.createdAt)} />
              <View style={styles(theme).sep} />
              <LabelValue theme={theme} label={t('admin_feedback_author')} value={data.authorName} />
              <View style={styles(theme).sep} />
              <LabelValue theme={theme} label={t('admin_feedback_company')} value={data.companyName || data.companyId} />
              <View style={styles(theme).sep} />
              <LabelValue theme={theme} label={t('admin_feedback_email')} value={data.authorEmail} />
              <View style={styles(theme).sep} />
              <LabelValue theme={theme} label={t('admin_feedback_phone')} value={data.authorPhone} />
            </Card>

            <Card style={styles(theme).card}>
              <Text style={styles(theme).sectionTitle}>{t('admin_feedback_message')}</Text>
              <Text style={styles(theme).messageText}>{String(data.message || '').trim() || '—'}</Text>
            </Card>

            {Array.isArray(data.photoUrls) && data.photoUrls.length > 0 ? (
              <Card style={styles(theme).card}>
                <Text style={styles(theme).sectionTitle}>
                  {t('order_details_photos_section')}
                </Text>
                <Text style={styles(theme).muted}>
                  {t('order_photos_count').replace('{count}', String(data.photoUrls.length))}
                </Text>
                <View style={styles(theme).photoGrid}>
                  {data.photoUrls.map((url, index) => (
                    <Pressable
                      key={`${url}_${index}`}
                      onPress={() => {
                        setViewerIndex(index);
                        setViewerVisible(true);
                      }}
                      style={({ pressed }) => [styles(theme).photoPressable, pressed && styles(theme).photoPressed]}
                    >
                      <Image
                        source={{ uri: url }}
                        style={styles(theme).photo}
                        resizeMode="cover"
                      />
                    </Pressable>
                  ))}
                </View>
              </Card>
            ) : null}

            <Button
              variant="danger"
              title={isDeleting ? t('btn_deleting') : t('admin_feedback_delete_action')}
              onPress={() => setDeleteConfirmOpen(true)}
              disabled={isDeleting}
            />
          </>
        ) : null}
      </ScrollView>

      <ConfirmModal
        visible={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title={t('admin_feedback_delete_title')}
        message={t('admin_feedback_delete_message')}
        confirmLabel={isDeleting ? t('btn_deleting') : t('btn_delete')}
        cancelLabel={t('btn_cancel')}
        confirmVariant="destructive"
        onConfirm={handleDelete}
      />

      <FullscreenImageViewer
        visible={viewerVisible}
        images={Array.isArray(data?.photoUrls) ? data.photoUrls : []}
        initialIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
        categoryLabel={t('admin_feedback_photo')}
      />
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
    },
    card: {
      borderRadius: theme.radii.md,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
      marginBottom: theme.spacing.xs,
    },
    muted: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    row: {
      minHeight: theme.components.row.minHeight,
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    rowLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    rowValue: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.medium,
    },
    sep: {
      height: theme.components.listItem.dividerWidth,
      backgroundColor: theme.colors.border,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      marginBottom: theme.spacing.xs,
    },
    messageText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      lineHeight: 22,
    },
    photo: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: theme.radii.md,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.inputBg,
    },
    photoPressable: {
      width: '32%',
      borderRadius: theme.radii.md,
      overflow: 'hidden',
    },
    photoPressed: {
      opacity: 0.85,
    },
    photoGrid: {
      marginTop: theme.spacing.sm,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      justifyContent: 'flex-start',
      alignItems: 'flex-start',
      alignContent: 'flex-start',
      rowGap: theme.spacing.sm,
      columnGap: theme.spacing.sm,
    },
    photoHint: {
      marginTop: theme.spacing.xs,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
    },
  });
