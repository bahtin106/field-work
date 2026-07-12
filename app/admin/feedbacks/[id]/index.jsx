import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../../../components/layout/Screen';
import Button from '../../../../components/ui/Button';
import Card from '../../../../components/ui/Card';
import { useToast } from '../../../../components/ui/ToastProvider';
import { ConfirmModal } from '../../../../components/ui/modals';
import SelectModal from '../../../../components/ui/modals/SelectModal';
import { useRequireSuperAdmin } from '../../../../hooks/useRequireSuperAdmin';
import { resolveAppLocale } from '../../../../lib/localeFormatting';
import { useAuthContext } from '../../../../providers/SimpleAuthProvider';
import {
  deleteSupportRequest,
  getSupportRequestById,
  SUPPORT_UNREAD_QUERY_KEY,
  SUPPORT_STATUS,
  SUPPORT_STATUS_VALUES,
  updateSupportRequestStatus,
} from '../../../../src/features/supportRequests/api';
import { useTranslation } from '../../../../src/i18n/useTranslation';
import { useTheme } from '../../../../theme/ThemeProvider';
import FullscreenImageViewer from '../../../orders/components/FullscreenImageViewer';
import { withAlpha } from '../../../../theme/colors';

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

function LabelValue({ theme, label, value }) {
  const text = String(value || '').trim() || '—';
  return (
    <View style={styles(theme).row}>
      <Text style={styles(theme).rowLabel}>{label}</Text>
      <Text style={styles(theme).rowValue}>{text}</Text>
    </View>
  );
}

function formatDevice(context) {
  if (!context) return null;
  const manufacturer = String(context.manufacturer || '').trim();
  const model = String(context.model || '').trim();
  const deviceName = String(context.deviceName || '').trim();
  const technicalName = [manufacturer, model].filter(Boolean).join(' ');
  if (deviceName && technicalName && !technicalName.toLowerCase().includes(deviceName.toLowerCase())) {
    return `${deviceName} · ${technicalName}`;
  }
  return deviceName || technicalName || null;
}

function formatVersion(version, build) {
  const normalizedVersion = String(version || '').trim();
  const normalizedBuild = String(build || '').trim();
  if (!normalizedVersion) return normalizedBuild || null;
  return normalizedBuild ? `${normalizedVersion} (${normalizedBuild})` : normalizedVersion;
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
  const [statusPickerOpen, setStatusPickerOpen] = React.useState(false);
  const [isChangingStatus, setIsChangingStatus] = React.useState(false);

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/feedbacks/[id]') });
  }, [nav, t]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adminSupportRequest', id],
    queryFn: () => getSupportRequestById(id),
    enabled: isAllowed && !!id,
    staleTime: 10 * 1000,
  });

  const statusItems = React.useMemo(
    () => SUPPORT_STATUS_VALUES.map((status) => ({
      id: status,
      label: getStatusMeta(t, theme, status).label,
    })),
    [t, theme],
  );

  const handleStatusChange = React.useCallback(async (item) => {
    const nextStatus = String(item?.id || '').trim();
    if (!id || nextStatus === data?.status || isChangingStatus) {
      setStatusPickerOpen(false);
      return;
    }
    setIsChangingStatus(true);
    setStatusPickerOpen(false);
    try {
      const actorId = profile?.id || profile?.user_id || null;
      await updateSupportRequestStatus(id, nextStatus, actorId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['adminSupportRequests'] }),
        queryClient.invalidateQueries({ queryKey: ['adminSupportRequest', id] }),
        queryClient.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY }),
      ]);
      toast.success(t('support_status_changed'));
    } catch (statusError) {
      toast.error(String(statusError?.message || t('admin_unknown_error')));
    } finally {
      setIsChangingStatus(false);
    }
  }, [data?.status, id, isChangingStatus, profile?.id, profile?.user_id, queryClient, t, toast]);

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
    <Screen background="background" scroll={false}>
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
              <Text style={styles(theme).sectionTitle}>{t('support_status_label')}</Text>
              <Pressable
                onPress={() => setStatusPickerOpen(true)}
                disabled={isChangingStatus}
                style={({ pressed }) => [styles(theme).statusSelector, pressed && styles(theme).statusSelectorPressed]}
              >
                {(() => {
                  const meta = getStatusMeta(t, theme, data.status);
                  return (
                    <View style={[styles(theme).statusPill, { borderColor: meta.color, backgroundColor: withAlpha(meta.color, 0.1) }]}>
                      <Text style={[styles(theme).statusText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  );
                })()}
                <View style={styles(theme).statusAction}>
                  <Text style={styles(theme).statusActionText}>
                    {isChangingStatus ? t('support_status_changing') : t('support_status_change')}
                  </Text>
                  <Text style={styles(theme).statusChevron}>›</Text>
                </View>
              </Pressable>
            </Card>

            <Card style={styles(theme).card} separated>
              <LabelValue theme={theme} label={t('admin_feedback_created_at')} value={formatDateTime(data.createdAt)} />
              <LabelValue theme={theme} label={t('admin_feedback_author')} value={data.authorName} />
              <LabelValue theme={theme} label={t('admin_feedback_company')} value={data.companyName || data.companyId} />
              <LabelValue theme={theme} label={t('admin_feedback_email')} value={data.authorEmail} />
              <LabelValue theme={theme} label={t('admin_feedback_phone')} value={data.authorPhone} />
            </Card>

            <Card style={styles(theme).card} separated>
              <Text style={styles(theme).sectionTitle}>{t('admin_feedback_client_context')}</Text>
              {data.clientContext ? (
                <>
                  <LabelValue
                    theme={theme}
                    label={t('admin_feedback_device')}
                    value={formatDevice(data.clientContext)}
                  />
                  <LabelValue
                    theme={theme}
                    label={t('admin_feedback_os')}
                    value={[data.clientContext.osName, data.clientContext.osVersion].filter(Boolean).join(' ')}
                  />
                  <LabelValue
                    theme={theme}
                    label={t('admin_feedback_app_version')}
                    value={formatVersion(data.clientContext.appVersion, data.clientContext.appBuild)}
                  />
                  <LabelValue
                    theme={theme}
                    label={t('admin_feedback_runtime_version')}
                    value={data.clientContext.runtimeVersion}
                  />
                  <LabelValue
                    theme={theme}
                    label={t('admin_feedback_environment')}
                    value={
                      data.clientContext.executionEnvironment === 'expo_go'
                        ? [
                            'Expo Go',
                            data.clientContext.metadata?.native_app_version,
                          ].filter(Boolean).join(' ')
                        : data.clientContext.executionEnvironment
                    }
                  />
                </>
              ) : (
                <Text style={styles(theme).muted}>{t('admin_feedback_client_context_unavailable')}</Text>
              )}
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

      <SelectModal
        visible={statusPickerOpen}
        onClose={() => setStatusPickerOpen(false)}
        title={t('support_status_select_title')}
        items={statusItems}
        selectedId={data?.status || SUPPORT_STATUS.NEW}
        searchable={false}
        onSelect={handleStatusChange}
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
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.components.sectionTitle.fontSize,
      fontWeight: theme.components.sectionTitle.fontWeight,
      marginBottom:
        typeof theme.components.sectionHeader.bottom === 'number'
          ? theme.components.sectionHeader.bottom
          : theme.spacing[theme.components.sectionHeader.bottom],
    },
    statusSelector: {
      minHeight: theme.components.row.minHeight,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    statusSelectorPressed: { opacity: 0.82 },
    statusPill: {
      borderWidth: 1,
      borderRadius: theme.radii.pill || 999,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    statusText: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold },
    statusAction: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
    statusActionText: { color: theme.colors.primary, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold },
    statusChevron: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xl },
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
