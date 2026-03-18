// app/orders/components/OrderPhotoRow.jsx
// Professional order photo row – horizontal scrollable thumbnails with add/remove.
// Uses expo-image (CachedImage) for instant caching, shimmer placeholders and smooth transitions.
// Fully themed – no hardcoded colors or dimensions.

import { memo, useCallback, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme';
import CachedImage from '../../../components/ui/CachedImage';
import SectionHeader from '../../../components/ui/SectionHeader';
import Card from '../../../components/ui/Card';

// ─── Pending upload tile with pulse animation ─────────────────
const PendingPhotoTile = memo(function PendingPhotoTile({ uri, thumbSize, borderRadius, theme }) {
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
    <View style={[tileStyles.wrap, { marginRight: theme.spacing?.md || 10 }]}> 
      <View style={{ width: thumbSize, height: thumbSize, borderRadius, overflow: 'hidden' }}>
        <CachedImage
          uri={uri}
          width={thumbSize}
          height={thumbSize}
          style={{ borderRadius }}
          contentFit="cover"
          cachePolicy="memory"
          transition={0}
        />
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: '#000', borderRadius },
            animStyle,
          ]}
        />
        <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}>
          <Feather name="upload-cloud" size={theme.icons?.md || 22} color={theme.colors.onPrimary} />
        </View>
      </View>
    </View>
  );
});

// ─── Single thumbnail tile ─────────────────────────────────────────
const PhotoTile = memo(function PhotoTile({
  url: _url,
  displayUrl,
  issueMessage,
  index,
  thumbSize,
  borderRadius,
  canRemove,
  onPress,
  onRemove,
  theme,
}) {
  const handlePress = useCallback(() => {
    if (!issueMessage) onPress?.(index);
  }, [index, issueMessage, onPress]);

  const handleRemove = useCallback(() => {
    onRemove?.(index);
  }, [index, onRemove]);

  if (issueMessage) {
    return (
      <View style={[tileStyles.wrap, { marginRight: theme.spacing?.md || 10 }]}>
        <View
          style={[
            tileStyles.unavailable,
            {
              width: thumbSize,
              height: thumbSize,
              borderRadius,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <Ionicons name="alert-circle-outline" size={22} color={theme.colors.warning} />
          <Text
            style={[tileStyles.unavailableText, { color: theme.colors.textSecondary }]}
            numberOfLines={2}
          >
            {issueMessage}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[tileStyles.wrap, { marginRight: theme.spacing?.md || 10 }]}>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [pressed && tileStyles.pressed]}
      >
        <CachedImage
          uri={displayUrl}
          width={thumbSize}
          height={thumbSize}
          style={{ borderRadius }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={180}
        />
      </Pressable>
      {canRemove && (
        <Pressable
          onPress={handleRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[
            tileStyles.removeBtn,
            {
              top: theme.spacing?.xs || 4,
              right: theme.spacing?.xs || 4,
              backgroundColor: theme.colors.danger,
              borderRadius: borderRadius / 2,
            },
          ]}
        >
          <Feather name="x" size={14} color={theme.colors.onPrimary} />
        </Pressable>
      )}
    </View>
  );
});

// ─── Main row component ────────────────────────────────────────────
function OrderPhotoRow({
  title,
  category,
  photos,
  pending,
  getDisplayUrl,
  getIssue,
  canAdd,
  onAdd,
  onRemove,
  onPhotoPress,
}) {
  const { theme } = useTheme();
  const thumbSize = theme.components?.media?.thumbSize || 116;
  const borderRadius = theme.radii?.lg || 12;
  const s = useMemo(() => makeStyles(theme, thumbSize, borderRadius), [theme, thumbSize, borderRadius]);

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    onAdd?.(category);
  }, [canAdd, category, onAdd]);

  const handleRemove = useCallback(
    (index) => onRemove?.(category, index),
    [category, onRemove],
  );

  const handlePhotoPress = useCallback(
    (index) => onPhotoPress?.(photos, index),
    [photos, onPhotoPress],
  );

  return (
    <View>
      <SectionHeader topSpacing="lg">{title}</SectionHeader>
      <Card>
        <View style={s.row}>
          {/* Add button */}
          <View style={s.addWrap}>
            <Pressable
              onPress={handleAdd}
              hitSlop={theme.components?.interactive?.hitSlop}
              style={({ pressed }) => [s.addTile, pressed && s.addTilePressed]}
              accessibilityRole={canAdd ? 'button' : 'text'}
              accessibilityLabel="Добавить фото"
            >
              <Feather
                name="plus"
                size={theme.typography?.sizes?.lg || 18}
                color={canAdd ? theme.colors.primary : theme.colors.textSecondary}
              />
            </Pressable>
          </View>

          {/* Scrollable thumbnails */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
          >
            {(photos || []).map((url, index) => (
              <PhotoTile
                key={`${category}:${String(url)}`}
                url={url}
                displayUrl={getDisplayUrl(url)}
                issueMessage={getIssue(url)}
                index={index}
                thumbSize={thumbSize}
                borderRadius={borderRadius}
                canRemove={canAdd}
                onPress={handlePhotoPress}
                onRemove={handleRemove}
                theme={theme}
              />
            ))}
            {(pending || []).map((p) => (
              <PendingPhotoTile
                key={p.id || `pending:${p.uri}`}
                uri={p.uri}
                thumbSize={thumbSize}
                borderRadius={borderRadius}
                theme={theme}
              />
            ))}
          </ScrollView>
        </View>
      </Card>
    </View>
  );
}

export default memo(OrderPhotoRow);

// ─── Styles ────────────────────────────────────────────────────────
const tileStyles = StyleSheet.create({
  wrap: { position: 'relative' },
  pressed: { transform: [{ scale: 0.97 }] },
  unavailable: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 6,
  },
  unavailableText: { fontSize: 10, textAlign: 'center', marginTop: 4 },
  removeBtn: {
    position: 'absolute',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
});

function makeStyles(theme, thumbSize, borderRadius) {
  const sp = theme.spacing || {};
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp.sm || 12,
    },
    addWrap: { marginRight: sp.sm || 12 },
    addTile: {
      width: thumbSize,
      height: thumbSize,
      borderRadius,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    addTilePressed: { opacity: 0.85 },
    scrollContent: {
      paddingBottom: sp.sm || 8,
      alignItems: 'center',
    },
  });
}
