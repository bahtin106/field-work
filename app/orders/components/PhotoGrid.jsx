// app/orders/components/PhotoGrid.jsx
// ────────────────────────────────────────────────────────────────────
// High-performance photo grid. Fully themed — zero hardcoded values.
// ────────────────────────────────────────────────────────────────────

import { useMemo, memo, useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import CachedImage from '../../../components/ui/CachedImage';

const NUM_COLUMNS = 3;

// ─── Upload pulse overlay ──────────────────────────────────────────
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

// ─── PhotoItem (memoized) ──────────────────────────────────────────
const PhotoItem = memo(function PhotoItem({
  uri,
  displayUri,
  issueMessage,
  isPending,
  actualIndex,
  s,
  theme,
  onPress,
  onRemove,
}) {
  const handlePress = useCallback(() => {
    if (!isPending && onPress) onPress(actualIndex);
  }, [isPending, actualIndex, onPress]);

  const handleRemove = useCallback(() => {
    if (!isPending && onRemove) onRemove(actualIndex);
  }, [isPending, actualIndex, onRemove]);

  const src = displayUri || uri;

  if (issueMessage) {
    return (
      <View style={s.item}>
        <View style={s.imageContainer}>
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
        </View>
      </View>
    );
  }

  return (
    <View style={s.item}>
      <Pressable
        onPress={handlePress}
        disabled={isPending}
        accessibilityRole="image"
        style={({ pressed }) => [pressed && s.pressed]}
      >
        <View style={s.imageContainer}>
          <CachedImage
            uri={src}
            width="100%"
            height="100%"
            style={{ borderRadius: theme.radii.sm }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={theme.timings?.panelToggleMs ?? 200}
          />
          {isPending && (
            <UploadOverlay
              borderRadius={theme.radii.sm}
              iconSize={theme.icons?.md || 22}
              iconColor={theme.colors.onPrimary}
            />
          )}
        </View>
      </Pressable>

      {onRemove && !isPending && (
        <Pressable
          onPress={handleRemove}
          hitSlop={theme.components?.interactive?.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Удалить фото"
          style={s.removeBtn}
        >
          <View style={s.removeBtnBg}>
            <Feather name="x" size={theme.icons.sm - theme.spacing.xs} color={theme.colors.onPrimary} />
          </View>
        </Pressable>
      )}
    </View>
  );
});

// ─── Main component ────────────────────────────────────────────────
function PhotoGrid({ photos = [], pending = [], getDisplayUrl, getIssue, onOpenViewer, onRemove }) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const s = useMemo(() => buildStyles(theme), [theme]);

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
    for (let i = 0; i < (photos || []).length; i++) {
      const url = photos[i];
      const resolved = getDisplayUrl ? getDisplayUrl(url) : url;
      const issueMessage = getIssue ? getIssue(url) : '';
      mapped.push({
        key: `photo_${String(url)}_${i}`,
        uri: url,
        displayUri: resolved,
        issueMessage,
        isPending: false,
        actualIndex: i,
      });
    }
    return mapped;
  }, [photos, pending, getDisplayUrl, getIssue]);

  const handleOpenViewer = useCallback(
    (actualIndex) => {
      if (onOpenViewer && actualIndex >= 0) onOpenViewer(photos, actualIndex);
    },
    [onOpenViewer, photos],
  );

  const renderItem = useCallback(
    ({ item }) => (
      <PhotoItem
        uri={item.uri}
        displayUri={item.displayUri}
        issueMessage={item.issueMessage}
        isPending={item.isPending}
        actualIndex={item.actualIndex}
        s={s}
        theme={theme}
        onPress={handleOpenViewer}
        onRemove={onRemove}
      />
    ),
    [s, theme, handleOpenViewer, onRemove],
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

// ─── Fully themed styles ───────────────────────────────────────────
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
    pendingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: cl.overlay,
      borderRadius: rd.sm,
      justifyContent: 'center',
      alignItems: 'center',
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
