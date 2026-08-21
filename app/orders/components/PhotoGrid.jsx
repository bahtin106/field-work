import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';

import CachedImage from '../../../components/ui/CachedImage';
import { useTranslation } from '../../../src/i18n/useTranslation';
import {
  canRunDeferredNetworkWork,
  useOfflineSnapshot,
} from '../../../src/shared/offline/offlineStatus';
import { useTheme } from '../../../theme/ThemeProvider';

const NUM_COLUMNS = 3;
const PHOTO_ACTION_HIT_SLOP = { top: 10, right: 10, bottom: 10, left: 10 };
const PHOTO_PRESS_RETENTION_OFFSET = { top: 14, right: 14, bottom: 14, left: 14 };
const LOCAL_FILE_URI_RE = /^file:\/\//i;

function normalizePhotoKeySource(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${decodeURIComponent(parsed.pathname || '')}`;
  } catch {
    return raw.split('?')[0].split('#')[0];
  }
}

function buildPhotoKey(url, displayUri, fallbackIndex, occurrenceIndex = 0) {
  const visibleLocalUri = String(displayUri || '').trim();
  const stableSource = LOCAL_FILE_URI_RE.test(visibleLocalUri)
    ? visibleLocalUri
    : normalizePhotoKeySource(url) || normalizePhotoKeySource(visibleLocalUri);
  if (!stableSource) return `photo_empty_${fallbackIndex}`;
  return occurrenceIndex > 0 ? `photo_${stableSource}_${occurrenceIndex}` : `photo_${stableSource}`;
}

const UploadOverlay = memo(function UploadOverlay({ borderRadius, iconSize, iconColor }) {
  const opacity = useSharedValue(0.18);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.48, { duration: 900 }),
        withTiming(0.18, { duration: 900 }),
      ),
      -1,
    );
  }, [opacity]);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: '#000', borderRadius },
          animStyle,
        ]}
      />
      <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}>
        <Feather name="upload-cloud" size={iconSize} color={iconColor} />
      </View>
    </View>
  );
});

const RetryOverlay = memo(function RetryOverlay({ borderRadius, iconSize, iconColor }) {
  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        { backgroundColor: 'rgba(0,0,0,0.62)', borderRadius, justifyContent: 'center', alignItems: 'center' },
      ]}
    >
      <Feather name="refresh-cw" size={iconSize} color={iconColor} />
    </View>
  );
});

const PhotoItem = memo(function PhotoItem({
  uri,
  displayUri,
  fallbackUri,
  issueMessage,
  isPending,
  isFailed,
  pendingPhoto,
  actualIndex,
  isSelectionMode,
  isSelected,
  s,
  theme,
  t,
  onPress,
  onRemove,
  onLongPress,
  onToggleSelect,
  onRetryPending,
}) {
  const handlePress = useCallback(() => {
    if (isPending && isFailed) {
      onRetryPending?.(pendingPhoto);
      return;
    }
    if (!isPending && onPress) onPress(actualIndex);
  }, [actualIndex, isFailed, isPending, onPress, onRetryPending, pendingPhoto]);

  const handleRemove = useCallback((event) => {
    event?.stopPropagation?.();
    if (!isPending && onRemove) onRemove(actualIndex);
  }, [actualIndex, isPending, onRemove]);

  const handleLongPress = useCallback(() => {
    if (!isPending && onLongPress) onLongPress(actualIndex);
  }, [actualIndex, isPending, onLongPress]);

  const handleToggleSelect = useCallback(() => {
    if (!isPending && onToggleSelect) onToggleSelect(actualIndex);
  }, [actualIndex, isPending, onToggleSelect]);

  const src = displayUri || uri;

  return (
    <View style={s.item}>
      <Pressable
        onPress={handlePress}
        onLongPress={handleLongPress}
        pressRetentionOffset={PHOTO_PRESS_RETENTION_OFFSET}
        disabled={isPending && !isFailed}
        accessibilityRole={isFailed ? 'button' : 'image'}
        accessibilityLabel={isFailed ? t('btn_retry') : undefined}
        style={({ pressed }) => [pressed && s.pressed]}
      >
        <View style={s.imageContainer}>
          {issueMessage ? (
            <View style={s.unavailable}>
              <Feather
                name="alert-circle"
                size={theme.icons?.md || 22}
                color={theme.colors.warning || theme.colors.primary}
              />
              <Text style={s.unavailableText} numberOfLines={3}>
                {issueMessage}
              </Text>
            </View>
          ) : (
            <CachedImage
              uri={src}
              fallbackUri={fallbackUri && fallbackUri !== src ? fallbackUri : undefined}
              width="100%"
              height="100%"
              style={{ borderRadius: theme.radii.sm }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={theme.timings?.panelToggleMs ?? 200}
            />
          )}
          {isPending && isFailed ? (
            <RetryOverlay
              borderRadius={theme.radii.sm}
              iconSize={theme.icons?.md || 22}
              iconColor={theme.colors.onPrimary}
            />
          ) : isPending ? (
            <UploadOverlay
              borderRadius={theme.radii.sm}
              iconSize={theme.icons?.md || 22}
              iconColor={theme.colors.onPrimary}
            />
          ) : null}
        </View>
      </Pressable>

      {!isPending && isSelectionMode ? (
        <Pressable
          onPress={handleToggleSelect}
          hitSlop={PHOTO_ACTION_HIT_SLOP}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={isSelected ? t('photos_unselect') : t('photos_select')}
          style={s.selectionBtn}
        >
          <View style={[s.selectionBtnBg, isSelected && s.selectionBtnBgActive]}>
            {isSelected ? (
              <Feather
                name="check"
                size={theme.icons.sm - theme.spacing.xs}
                color={theme.colors.onPrimary}
              />
            ) : null}
          </View>
        </Pressable>
      ) : null}

      {!isPending && !isSelectionMode && onRemove ? (
        <Pressable
          onPress={handleRemove}
          hitSlop={PHOTO_ACTION_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={t('order_photos_delete_single_confirm')}
          style={s.removeBtn}
        >
          <View style={s.removeBtnBg}>
            <Feather
              name="x"
              size={theme.icons.sm - theme.spacing.xs}
              color={theme.colors.onPrimary}
            />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
});

function PhotoGrid({
  photos = [],
  pending = [],
  onRetryPending,
  getDisplayUrl,
  getThumbnailUrl,
  getFallbackUrl,
  getIssue,
  onOpenViewer,
  onRemove,
  canAddPhotos = true,
  selectionMode = false,
  selectedUris = [],
  onEnterSelectionMode,
  onToggleSelect,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const offlineSnapshot = useOfflineSnapshot();
  const canPrefetchMedia = canRunDeferredNetworkWork(offlineSnapshot);
  const s = useMemo(() => buildStyles(theme), [theme]);
  const selectedUrlsSet = useMemo(() => new Set((selectedUris || []).map((value) => String(value))), [selectedUris]);
  const stableDisplayBySourceRef = useRef(new Map());

  const data = useMemo(() => {
    const mapped = [];
    const completedUrls = new Set();
    const occurrenceBySource = new Map();
    for (let i = 0; i < (pending || []).length; i += 1) {
      const p = pending[i];
      const uploadedUrl = String(p?.uploadedUrl || '').trim();
      if (uploadedUrl) completedUrls.add(uploadedUrl);
      const completedIndex = uploadedUrl
        ? (photos || []).findIndex((url) => String(url || '') === uploadedUrl)
        : -1;
      const visibleUri = String(p?.uri || '').trim();
      const uploadedSourceKey = normalizePhotoKeySource(uploadedUrl);
      if (uploadedSourceKey && visibleUri) {
        stableDisplayBySourceRef.current.set(uploadedSourceKey, visibleUri);
      }
      const keySource = normalizePhotoKeySource(visibleUri) || normalizePhotoKeySource(uploadedUrl);
      const occurrenceIndex = Number(occurrenceBySource.get(keySource) || 0);
      if (keySource) occurrenceBySource.set(keySource, occurrenceIndex + 1);
      mapped.push({
        key: buildPhotoKey(uploadedUrl || visibleUri, visibleUri, i, occurrenceIndex),
        uri: uploadedUrl || visibleUri,
        displayUri: visibleUri,
        fallbackUri: uploadedUrl && uploadedUrl !== visibleUri ? uploadedUrl : '',
        isPending: p.pending !== false && !uploadedUrl,
        isFailed: p.failed === true,
        pendingPhoto: p,
        actualIndex: completedIndex,
      });
    }
    for (let i = 0; i < (photos || []).length; i += 1) {
      const url = photos[i];
      if (completedUrls.has(String(url || ''))) continue;
      const thumbUri = getThumbnailUrl ? getThumbnailUrl(url) : '';
      const displayUri = getDisplayUrl ? getDisplayUrl(url) : url;
      const sourceKey = normalizePhotoKeySource(url) || normalizePhotoKeySource(displayUri);
      const candidates = [thumbUri, displayUri]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      const retainedUri = String(stableDisplayBySourceRef.current.get(sourceKey) || '').trim();
      // Choose the best source available on first render, then retain it. A thumbnail
      // arriving later must not reload every tile that is already visible.
      const visibleUri = retainedUri && candidates.includes(retainedUri)
        ? retainedUri
        : candidates[0] || '';
      if (sourceKey && visibleUri) stableDisplayBySourceRef.current.set(sourceKey, visibleUri);
      const remoteFallbackUri = getFallbackUrl ? getFallbackUrl(url) : '';
      const fallbackUri = [remoteFallbackUri, thumbUri, displayUri]
        .map((value) => String(value || '').trim())
        .find((value) => value && value !== visibleUri);
      const keySource = normalizePhotoKeySource(url) || normalizePhotoKeySource(visibleUri);
      const occurrenceIndex = Number(occurrenceBySource.get(keySource) || 0);
      if (keySource) occurrenceBySource.set(keySource, occurrenceIndex + 1);
      mapped.push({
        key: buildPhotoKey(url, visibleUri, i, occurrenceIndex),
        uri: url,
        displayUri: visibleUri,
        fallbackUri: fallbackUri && fallbackUri !== visibleUri ? fallbackUri : '',
        issueMessage: getIssue ? getIssue(url) : '',
        isPending: false,
        isFailed: false,
        pendingPhoto: null,
        actualIndex: i,
      });
    }
    return mapped;
  }, [getDisplayUrl, getFallbackUrl, getIssue, getThumbnailUrl, pending, photos]);

  useEffect(() => {
    const activeSources = new Set(
      [
        ...(photos || []),
        ...(pending || []).map((item) => item?.uploadedUrl),
      ]
        .map(normalizePhotoKeySource)
        .filter(Boolean),
    );
    for (const sourceKey of stableDisplayBySourceRef.current.keys()) {
      if (!activeSources.has(sourceKey)) stableDisplayBySourceRef.current.delete(sourceKey);
    }
  }, [pending, photos]);

  useEffect(() => {
    if (!canPrefetchMedia) return;
    const displayUrls = data
      .filter((item) => !item.isPending && !item.issueMessage)
      .slice(0, 12)
      .map((item) => item.displayUri || item.uri)
      .filter(Boolean);
    if (displayUrls.length) {
      ExpoImage.prefetch(displayUrls, 'memory-disk').catch(() => {});
    }
  }, [canPrefetchMedia, data]);

  const handleOpenViewer = useCallback(
    (actualIndex) => {
      if (onOpenViewer && actualIndex >= 0) onOpenViewer(photos, actualIndex);
    },
    [onOpenViewer, photos],
  );

  const handleEnterSelectionMode = useCallback(
    (actualIndex) => {
      if (actualIndex < 0) return;
      if (onEnterSelectionMode) onEnterSelectionMode(actualIndex);
    },
    [onEnterSelectionMode],
  );

  const handleToggleSelect = useCallback(
    (actualIndex) => {
      if (actualIndex < 0 || !onToggleSelect) return;
      onToggleSelect(actualIndex);
    },
    [onToggleSelect],
  );

  const renderItem = useCallback(
    ({ item }) => (
      <PhotoItem
        uri={item.uri}
        displayUri={item.displayUri}
        fallbackUri={item.fallbackUri}
        issueMessage={item.issueMessage}
        isPending={item.isPending}
        isFailed={item.isFailed}
        pendingPhoto={item.pendingPhoto}
        actualIndex={item.actualIndex}
        isSelectionMode={selectionMode}
        isSelected={!item.isPending && selectedUrlsSet.has(String(item.uri))}
        s={s}
        theme={theme}
        t={t}
        onPress={handleOpenViewer}
        onRemove={onRemove}
        onLongPress={handleEnterSelectionMode}
        onToggleSelect={handleToggleSelect}
        onRetryPending={onRetryPending}
      />
    ),
    [handleEnterSelectionMode, handleOpenViewer, handleToggleSelect, onRemove, onRetryPending, s, selectedUrlsSet, selectionMode, t, theme],
  );

  const keyExtractor = useCallback((item) => item.key, []);

  if (!data.length) {
    return (
      <View style={s.emptyState}>
        <Feather name="image" size={theme.icons.lg * 2} color={theme.colors.border} />
        <Text style={s.emptyTitle}>
          {t('order_photos_empty_title')}
        </Text>
        <Text style={[s.emptyHint, !canAddPhotos && s.hidden]}>
          {t('order_photos_empty_hint')}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={NUM_COLUMNS}
      contentContainerStyle={s.list}
      showsVerticalScrollIndicator={false}
      initialNumToRender={9}
      maxToRenderPerBatch={12}
      windowSize={5}
      removeClippedSubviews={false}
      updateCellsBatchingPeriod={40}
    />
  );
}

export default memo(PhotoGrid);

function buildStyles(theme) {
  const sp = theme.spacing;
  const ty = theme.typography;
  const cl = theme.colors;
  const rd = theme.radii;
  const gridGap = sp.xs - 2 > 0 ? sp.xs - 2 : 2;
  const removeBtnSize = sp.xl;

  return StyleSheet.create({
    list: {
      flexGrow: 1,
      padding: gridGap / 2,
    },
    item: {
      flex: 1 / NUM_COLUMNS,
      aspectRatio: 1,
      padding: gridGap / 2,
      position: 'relative',
    },
    pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
    imageContainer: {
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      borderRadius: rd.sm,
      backgroundColor: cl.border,
    },
    unavailable: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: sp.xs,
      backgroundColor: cl.surface,
      borderRadius: rd.sm,
      borderWidth: 1,
      borderColor: cl.border,
    },
    unavailableText: {
      marginTop: sp.xs,
      fontSize: ty.sizes.xs,
      color: cl.textSecondary,
      textAlign: 'center',
    },
    removeBtn: {
      position: 'absolute',
      zIndex: 10,
      elevation: 10,
      top: sp.xs,
      right: sp.xs,
    },
    removeBtnBg: {
      width: removeBtnSize,
      height: removeBtnSize,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: cl.danger,
      borderRadius: rd.pill,
    },
    selectionBtn: {
      position: 'absolute',
      zIndex: 10,
      elevation: 10,
      top: sp.xs,
      right: sp.xs,
    },
    selectionBtnBg: {
      width: removeBtnSize,
      height: removeBtnSize,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: cl.overlay,
      borderRadius: rd.pill,
      borderWidth: 2,
      borderColor: cl.surface,
    },
    selectionBtnBgActive: {
      backgroundColor: cl.primary,
      borderColor: cl.primary,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: sp.xxl + sp.lg,
      paddingHorizontal: sp.xl,
    },
    emptyTitle: {
      marginTop: sp.lg,
      color: cl.text,
      fontSize: ty.sizes.md,
      fontWeight: ty.weight.semibold,
    },
    emptyHint: {
      marginTop: sp.sm,
      textAlign: 'center',
      color: cl.textSecondary,
      fontSize: ty.sizes.sm,
    },
    hidden: {
      display: 'none',
    },
  });
}
