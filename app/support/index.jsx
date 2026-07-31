import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { resolveAppLocale } from '../../lib/localeFormatting';
import { supabase } from '../../lib/supabase';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import {
  listMySupportRequests,
  SUPPORT_STATUS,
} from '../../src/features/supportRequests/api';
import { useTranslation } from '../../src/i18n/useTranslation';
import { withAlpha } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeProvider';
import SupportRequestModal from '../company_settings/sections/SupportRequestModal';
import FullscreenImageViewer from '../orders/components/FullscreenImageViewer';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || ''),
  );
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '—';
  try {
    return date.toLocaleString(resolveAppLocale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

function getStatusMeta(t, theme, status) {
  const map = {
    [SUPPORT_STATUS.NEW]: { label: t('support_status_new'), color: theme.colors.primary },
    [SUPPORT_STATUS.VIEWED]: { label: t('support_status_viewed'), color: theme.colors.textSecondary },
    [SUPPORT_STATUS.IN_PROGRESS]: { label: t('support_status_in_progress'), color: theme.colors.warning || theme.colors.primary },
    [SUPPORT_STATUS.COMPLETED]: { label: t('support_status_completed'), color: theme.colors.success || theme.colors.primary },
  };
  return map[status] || map[SUPPORT_STATUS.NEW];
}

export default function SupportRequestsScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const queryClient = useQueryClient();
  const { user, profile } = useAuthContext();
  const userId = String(user?.id || profile?.id || '').trim();
  const queryKey = React.useMemo(() => ['mySupportRequests', userId], [userId]);
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [viewerImages, setViewerImages] = React.useState([]);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const viewerRequestIdRef = React.useRef('');

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('support_requests_title') });
  }, [nav, t]);

  const { data = [], isLoading, isRefetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () => listMySupportRequests({ userId, limit: 150 }),
    enabled: !!userId,
    staleTime: 30 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });

  React.useEffect(() => {
    if (!isUuid(userId)) return undefined;
    const channel = supabase
      .channel(`my-support-requests-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feedbacks', filter: `user_id=eq.${userId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, queryKey, userId]);

  const openViewer = React.useCallback((requestId, images, index) => {
    viewerRequestIdRef.current = String(requestId || '').trim();
    setViewerImages(Array.isArray(images) ? images : []);
    setViewerIndex(index);
  }, []);

  const handleRetryViewerImage = React.useCallback(async (photoIndex) => {
    const requestId = viewerRequestIdRef.current;
    if (!requestId) return '';
    const refreshedList = await listMySupportRequests({
      userId,
      limit: 150,
      forcePhotoRefresh: true,
    });
    const refreshed = refreshedList.find(
      (item) => String(item?.id || '') === requestId,
    );
    const refreshedPhotos = Array.isArray(refreshed?.photoUrls) ? refreshed.photoUrls : [];
    if (!refreshed || !refreshedPhotos.length) return '';
    queryClient.setQueryData(queryKey, refreshedList);
    setViewerImages(refreshedPhotos);
    return String(refreshedPhotos[photoIndex] || '').trim();
  }, [queryClient, queryKey, userId]);

  const renderItem = React.useCallback(
    ({ item }) => {
      const statusMeta = getStatusMeta(t, theme, item.status);
      const photos = Array.isArray(item.photoUrls) ? item.photoUrls : [];
      return (
        <Card style={styles(theme).requestCard}>
          <View style={styles(theme).cardHeader}>
            <Text style={styles(theme).dateText}>{formatDateTime(item.createdAt)}</Text>
            <View
              style={[
                styles(theme).statusPill,
                { borderColor: statusMeta.color, backgroundColor: withAlpha(statusMeta.color, 0.1) },
              ]}
            >
              <Text style={[styles(theme).statusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            </View>
          </View>
          <Text style={styles(theme).messageText}>{item.message || '—'}</Text>
          {photos.length > 0 ? (
            <View style={styles(theme).photoRow}>
              {photos.slice(0, 4).map((url, index) => (
                <Pressable
                  key={`${item.id}-${url}-${index}`}
                  onPress={() => openViewer(item.id, photos, index)}
                  style={({ pressed }) => [styles(theme).photoPressable, pressed && { opacity: 0.82 }]}
                >
                  <Image source={url} style={styles(theme).photo} contentFit="cover" cachePolicy="memory-disk" />
                  {index === 3 && photos.length > 4 ? (
                    <View style={styles(theme).photoMoreOverlay}>
                      <Text style={styles(theme).photoMoreText}>+{photos.length - 4}</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </Card>
      );
    },
    [openViewer, t, theme],
  );

  return (
    <Screen
      background="background"
      scroll={false}
      headerOptions={{
        title: t('support_requests_title'),
      }}
    >
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={refetch}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        contentContainerStyle={[
          styles(theme).content,
          !isLoading && !error && data.length === 0 ? styles(theme).emptyContent : null,
        ]}
        ListHeaderComponent={
          data.length > 0 ? (
            <View style={styles(theme).introRow}>
              <View style={styles(theme).introTextWrap}>
                <Text style={styles(theme).introTitle}>{t('support_requests_yours')}</Text>
              </View>
              <Button
                title={t('support_requests_new')}
                size="sm"
                onPress={() => setComposeOpen(true)}
                containerStyle={styles(theme).newButton}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles(theme).emptyState}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : error ? (
            <Card style={styles(theme).emptyCard}>
              <Feather name="alert-circle" size={32} color={theme.colors.danger} />
              <Text style={styles(theme).emptyTitle}>{t('support_requests_load_error')}</Text>
              <Button title={t('btn_retry')} size="sm" onPress={refetch} />
            </Card>
          ) : (
            <Card style={styles(theme).emptyCard}>
              <View style={styles(theme).emptyIcon}>
                <Feather name="message-square" size={30} color={theme.colors.primary} />
              </View>
              <Text style={styles(theme).emptyTitle}>{t('support_requests_empty')}</Text>
              <Text style={styles(theme).muted}>{t('support_requests_empty_hint')}</Text>
              <Button title={t('support_requests_new')} onPress={() => setComposeOpen(true)} />
            </Card>
          )
        }
      />

      <SupportRequestModal
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSubmitted={() => queryClient.invalidateQueries({ queryKey })}
        profile={profile}
        userId={userId}
      />
      <FullscreenImageViewer
        visible={viewerImages.length > 0}
        images={viewerImages}
        initialIndex={viewerIndex}
        onClose={() => setViewerImages([])}
        onRetryImage={handleRetryViewerImage}
        categoryLabel={t('admin_feedback_photo')}
      />
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
      gap: theme.spacing.md,
    },
    emptyContent: { flexGrow: 1, justifyContent: 'center' },
    introRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.md },
    introTextWrap: { flex: 1, gap: theme.spacing.xs },
    introTitle: { color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weight.bold },
    newButton: { flexShrink: 0 },
    requestCard: { borderColor: theme.colors.border, gap: theme.spacing.md },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    dateText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs },
    statusPill: { borderWidth: 1, borderRadius: theme.radii.pill || 999, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
    statusText: { fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weight.semibold },
    messageText: { color: theme.colors.text, fontSize: theme.typography.sizes.md, lineHeight: 22 },
    muted: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, textAlign: 'center' },
    photoRow: { flexDirection: 'row', gap: theme.spacing.sm },
    photoPressable: { flex: 1, aspectRatio: 1, maxWidth: 92, borderRadius: theme.radii.md, overflow: 'hidden', backgroundColor: theme.colors.inputBg },
    photo: { width: '100%', height: '100%' },
    photoMoreOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha('#000000', 0.55) },
    photoMoreText: { color: '#ffffff', fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weight.bold },
    emptyState: { alignItems: 'center', justifyContent: 'center', minHeight: 180 },
    emptyCard: { alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.xl },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(theme.colors.primary, 0.1) },
    emptyTitle: { color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weight.bold, textAlign: 'center' },
  });
