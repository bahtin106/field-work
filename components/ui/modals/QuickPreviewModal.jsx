import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../../theme/ThemeProvider';
import { useToast } from '../ToastProvider';
import { withAlpha } from './BaseModal';

const ANCHOR_GAP = 8;
const EMERGE_SPRING = { damping: 22, stiffness: 280, mass: 0.65 };

export default function QuickPreviewModal({
  visible,
  anchor = null,
  title,
  rows = [],
  tags = [],
  tagsTitle = '',
  footerActionLabel,
  onFooterAction,
  onClose,
}) {
  const { theme } = useTheme();
  const toast = useToast();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const horizontalMargin = Number(theme.spacing?.sm ?? 10);
  const tagsGap = Math.max(4, Number(theme.spacing?.xxs ?? 4));
  const tagPadX = Math.max(6, Number(theme.spacing?.xs ?? 6));
  const tagFontSize = Math.max(10, (theme.typography.sizes.xs ?? 12) - 1);

  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.88);
  const slideY = useSharedValue(20);
  const [rendered, setRendered] = React.useState(visible);
  const [cardSize, setCardSize] = React.useState({ width: 0, height: 0 });
  const [tagsColumnWidth, setTagsColumnWidth] = React.useState(0);
  const [measuredTagWidths, setMeasuredTagWidths] = React.useState({});

  const setNotRendered = React.useCallback(() => setRendered(false), []);

  // ── "Material Emerge" — fade + slide-up + scale-up ──────────
  React.useEffect(() => {
    if (visible) {
      setRendered(true);
      opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });
      scale.value = withSpring(1, EMERGE_SPRING);
      slideY.value = withSpring(0, EMERGE_SPRING);
      return;
    }

    const dur = 180;
    const ease = Easing.bezier(0.3, 0, 0.8, 0.15);
    opacity.value = withTiming(0, { duration: dur, easing: ease }, (finished) => {
      if (finished) runOnJS(setNotRendered)();
    });
    scale.value = withTiming(0.88, { duration: dur, easing: ease });
    slideY.value = withTiming(16, { duration: dur, easing: ease });
  }, [opacity, scale, slideY, visible, setNotRendered]);

  const aBackdrop = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const aCard = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: slideY.value }, { scale: scale.value }],
  }));

  const maxWidth = Math.min(520, screenWidth - horizontalMargin * 2);
  const preferredWidth = Math.min(maxWidth, Math.max(340, Math.round(screenWidth * 0.84)));
  const anchorY = Number(anchor?.y) || screenHeight / 2;

  const measuredWidth = cardSize.width || preferredWidth;
  const centeredLeft = Math.max(horizontalMargin, (screenWidth - measuredWidth) / 2);

  const shouldPlaceAbove =
    cardSize.height > 0 &&
    anchorY + ANCHOR_GAP + cardSize.height > screenHeight - horizontalMargin;

  const desiredTop = shouldPlaceAbove
    ? anchorY - cardSize.height - ANCHOR_GAP
    : anchorY + ANCHOR_GAP;
  const clampedTop = Math.min(
    Math.max(desiredTop, horizontalMargin),
    screenHeight - cardSize.height - horizontalMargin,
  );

  if (!rendered) return null;

  const safeTitle = String(title || '').trim();
  const safeTags = Array.isArray(tags)
    ? tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  const showTagsSection = safeTags.length > 0;

  const estimateTagWidth = (tag) => {
    const textLen = String(tag || '').length;
    return Math.round(textLen * tagFontSize * 0.58 + tagPadX * 2 + 2);
  };

  const tagLayout = (() => {
    if (!showTagsSection || !tagsColumnWidth) {
      return { visible: [], hiddenCount: showTagsSection ? safeTags.length : 0 };
    }

    const maxLines = 2;
    let linesUsed = 1;
    let currentLineWidth = 0;
    const visibleTags = [];
    let hiddenCount = 0;

    for (const tag of safeTags) {
      const rawWidth = measuredTagWidths[tag] || estimateTagWidth(tag);
      if (rawWidth >= tagsColumnWidth) {
        hiddenCount += 1;
        continue;
      }

      const requiredWidth = currentLineWidth === 0 ? rawWidth : rawWidth + tagsGap;
      if (currentLineWidth + requiredWidth <= tagsColumnWidth) {
        visibleTags.push(tag);
        currentLineWidth += requiredWidth;
        continue;
      }

      if (linesUsed < maxLines) {
        linesUsed += 1;
        currentLineWidth = rawWidth;
        visibleTags.push(tag);
      } else {
        hiddenCount += 1;
      }
    }

    return { visible: visibleTags, hiddenCount };
  })();

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, aBackdrop]}>
        <Pressable
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: withAlpha(theme.colors.overlay || '#000000', 0.28) },
          ]}
          onPress={onClose}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.card,
          {
            width: preferredWidth,
            maxWidth,
            left: centeredLeft,
            top: clampedTop,
          },
          aCard,
        ]}
        onLayout={(event) => {
          const nextWidth = event?.nativeEvent?.layout?.width || 0;
          const nextHeight = event?.nativeEvent?.layout?.height || 0;
          if (!nextWidth || !nextHeight) return;
          setCardSize((prev) => {
            if (Math.abs(prev.width - nextWidth) < 1 && Math.abs(prev.height - nextHeight) < 1) {
              return prev;
            }
            return { width: nextWidth, height: nextHeight };
          });
        }}
      >
        <Text style={styles.title}>{safeTitle}</Text>

        <View style={styles.contentRow}>
          <View style={styles.mainCol}>
            {rows
              .filter((row) => row && (row.value || row.valueComponent))
              .map((row) => (
                <View key={String(row.key || row.label)} style={styles.row}>
                  <Text style={styles.label}>{row.label}</Text>
                  {row.valueComponent ? (
                    row.valueComponent
                  ) : (
                    <Text style={styles.value}>{String(row.value || '')}</Text>
                  )}
                </View>
              ))}
          </View>

          <View style={styles.sideCol}>
            <View style={styles.sideTop}>
              {showTagsSection ? (
                <>
                {tagsTitle ? <Text style={styles.label}>{tagsTitle}</Text> : null}
                <View
                  style={styles.tagsWrap}
                  onLayout={(event) => {
                    const width = Number(event?.nativeEvent?.layout?.width || 0);
                    if (!width) return;
                    setTagsColumnWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
                  }}
                >
                  {tagLayout.visible.map((tag) => (
                    <View key={`popover-tag-${tag}`} style={styles.tagPill}>
                      <Text style={styles.tagText} numberOfLines={1}>
                        {tag}
                      </Text>
                    </View>
                  ))}
                  {tagLayout.hiddenCount > 0 ? (
                    <View style={styles.tagPillOverflow}>
                      <Text style={styles.tagOverflowText}>{`+${tagLayout.hiddenCount}`}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.measureWrap} pointerEvents="none">
                  {safeTags.map((tag, index) => (
                    <View
                      key={`measure-tag-${index}-${tag}`}
                      style={styles.measureTag}
                      onLayout={(event) => {
                        const width = Number(event?.nativeEvent?.layout?.width || 0);
                        if (!width) return;
                        setMeasuredTagWidths((prev) => {
                          if (Math.abs((prev[tag] || 0) - width) < 1) return prev;
                          return { ...prev, [tag]: width };
                        });
                      }}
                    >
                      <Text style={styles.tagText} numberOfLines={1}>
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
                </>
              ) : null}
            </View>

            {footerActionLabel ? (
              <Pressable
                onPress={onFooterAction}
                style={({ pressed }) => [styles.footerAction, pressed ? styles.footerActionPressed : null]}
              >
                <Text style={styles.footerActionText}>{footerActionLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Animated.View>
      {toast?.renderOverlay?.() || null}
    </Modal>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    card: {
      position: 'absolute',
      width: 'auto',
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.lg,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      ...(theme.shadows?.card?.ios || {}),
      elevation: theme.shadows?.card?.android?.elevation ?? 8,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.bold,
      marginBottom: theme.spacing.xs,
    },
    contentRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: theme.spacing.md,
    },
    mainCol: {
      flex: 1,
      minWidth: 0,
    },
    sideCol: {
      width: '42%',
      minWidth: 120,
      alignItems: 'stretch',
      justifyContent: 'space-between',
    },
    sideTop: {
      flexGrow: 1,
    },
    row: {
      marginTop: Math.max(2, theme.spacing.xxs ?? 2),
    },
    label: {
      color: theme.colors.textSecondary,
      fontSize: Math.max(11, (theme.typography.sizes.xs ?? 12) - 1),
      marginBottom: 2,
    },
    value: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round((theme.typography.sizes.sm || 14) * 1.28),
    },
    tagsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Math.max(4, Number(theme.spacing?.xxs ?? 4)),
      marginTop: 2,
      minHeight: 22,
    },
    tagPill: {
      borderRadius: theme.radii.pill ?? 999,
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.primary, 0.22),
      backgroundColor: withAlpha(theme.colors.primary, 0.08),
      paddingHorizontal: Math.max(6, Number(theme.spacing?.xs ?? 6)),
      paddingVertical: 2,
      maxWidth: '100%',
    },
    tagText: {
      color: theme.colors.text,
      fontSize: Math.max(10, (theme.typography.sizes.xs ?? 12) - 1),
    },
    tagPillOverflow: {
      borderRadius: theme.radii.pill ?? 999,
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.textSecondary, 0.24),
      backgroundColor: withAlpha(theme.colors.textSecondary, 0.08),
      paddingHorizontal: Math.max(6, Number(theme.spacing?.xs ?? 6)),
      paddingVertical: 2,
    },
    tagOverflowText: {
      color: theme.colors.textSecondary,
      fontSize: Math.max(10, (theme.typography.sizes.xs ?? 12) - 1),
      fontWeight: theme.typography.weight.semibold,
    },
    measureWrap: {
      position: 'absolute',
      opacity: 0,
      zIndex: -1,
      top: -10000,
      left: -10000,
      flexDirection: 'row',
      flexWrap: 'nowrap',
      gap: Math.max(4, Number(theme.spacing?.xxs ?? 4)),
    },
    measureTag: {
      borderRadius: theme.radii.pill ?? 999,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingHorizontal: Math.max(6, Number(theme.spacing?.xs ?? 6)),
      paddingVertical: 2,
    },
    footerAction: {
      marginTop: theme.spacing.sm,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.primary,
      paddingVertical: theme.spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-end',
      minWidth: '72%',
    },
    footerActionPressed: {
      backgroundColor: withAlpha(theme.colors.primary, 0.08),
    },
    footerActionText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
  });
}
