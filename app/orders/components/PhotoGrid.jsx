import { memo, useCallback, useEffect, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import CachedImage from '../../../components/ui/CachedImage';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const NUM_COLUMNS = 3;
const PHOTO_ACTION_HIT_SLOP = { top: 10, right: 10, bottom: 10, left: 10 };

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

const PhotoItem = memo(function PhotoItem({
  uri,
  displayUri,
  issueMessage,
  isPending,
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
}) {
  const handlePress = useCallback(() => {
    if (!isPending && onPress) onPress(actualIndex);
  }, [actualIndex, isPending, onPress]);

  const handleRemove = useCallback(() => {
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
        disabled={isPending}
        accessibilityRole="image"
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
              width="100%"
              height="100%"
              style={{ borderRadius: theme.radii.sm }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={theme.timings?.panelToggleMs ?? 200}
            />
          )}
          {isPending ? (
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
          accessibilityLabel={isSelected ? 'Снять выделение' : 'Выбрать фото'}
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
          accessibilityLabel={t('order_photos_delete_single_confirm', 'Удалить')}
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
  getDisplayUrl,
  getIssue,
  onOpenViewer,
  onRemove,
  selectionMode = false,
  selectedUris = [],
  onEnterSelectionMode,
  onToggleSelect,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => buildStyles(theme), [theme]);
  const selectedUrlsSet = useMemo(() => new Set((selectedUris || []).map((value) => String(value))), [selectedUris]);

  const data = useMemo(() => {
    const mapped = [];
    for (const p of pending || []) {
      mapped.push({
        key: p.id || `pending_${p.uri}`,
        uri: p.uri,
        displayUri: p.uri,
        isPending: true,
        actualIndex: -1,
      });
    }
    for (let i = 0; i < (photos || []).length; i += 1) {
      const url = photos[i];
      mapped.push({
        key: `photo_${String(url)}_${i}`,
        uri: url,
        displayUri: getDisplayUrl ? getDisplayUrl(url) : url,
        issueMessage: getIssue ? getIssue(url) : '',
        isPending: false,
        actualIndex: i,
      });
    }
    return mapped;
  }, [getDisplayUrl, getIssue, pending, photos]);

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
        issueMessage={item.issueMessage}
        isPending={item.isPending}
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
      />
    ),
    [handleEnterSelectionMode, handleOpenViewer, handleToggleSelect, onRemove, s, selectedUrlsSet, selectionMode, t, theme],
  );

  const keyExtractor = useCallback((item) => item.key, []);

  if (!data.length) {
    return (
      <View style={s.emptyState}>
        <Feather name="image" size={theme.icons.lg * 2} color={theme.colors.border} />
        <Text style={s.emptyTitle}>
          {t('order_photos_empty_title', 'Нет фотографий')}
        </Text>
        <Text style={s.emptyHint}>
          {t('order_photos_empty_hint', 'Нажмите кнопку ниже, чтобы добавить')}
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
      removeClippedSubviews
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
  });
}
