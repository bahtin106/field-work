import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';

const OPEN_EASING = Easing.bezier(0.2, 0, 0, 1);

export default function Dialog({
  visible,
  onClose,
  children,
  dismissOnBackdrop = true,
  maxWidth = 420,
  contentStyle,
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const dialogTokens = theme.components?.dialog || {};
  const dialogMaxWidth = maxWidth ?? dialogTokens.maxWidth ?? 420;
  const dialogPad = dialogTokens.pad ?? theme.spacing.xl;
  const dialogRadius = dialogTokens.radius ?? theme.radii.xl;
  const dialogEdgePadding = dialogTokens.edgePadding ?? theme.spacing.lg;
  const backdropOpacity =
    Platform.OS === 'ios'
      ? dialogTokens.backdropOpacity?.ios ?? 0.38
      : dialogTokens.backdropOpacity?.android ?? 0.42;

  // локальный mount, чтобы плавно убирать из дерева после анимации скрытия
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);  // opacity / backdrop
  const scale = useSharedValue(0.96);
  const translateY = useSharedValue(16);

  // ── "Material Emerge" — fade + slide-up + scale-up ──────────
  useEffect(() => {
    if (visible) {
      // Reset to invisible starting position
      progress.value = 0;
      scale.value = 0.96;
      translateY.value = 16;
      setMounted(true);
      // Start animation on next frame — after View has committed
      requestAnimationFrame(() => {
        progress.value = withTiming(1, { duration: 180, easing: OPEN_EASING });
        scale.value = withTiming(1, { duration: 200, easing: OPEN_EASING });
        translateY.value = withTiming(0, { duration: 220, easing: OPEN_EASING });
      });
    } else if (mounted) {
      // Dialog shrinks + fades: M3 emphasized-accelerate easing
      const dur = 160;
      const ease = Easing.bezier(0.3, 0, 0.8, 0.15);
      progress.value = withTiming(0, { duration: dur, easing: ease }, (f) => {
        if (f) runOnJS(setMounted)(false);
      });
      scale.value = withTiming(0.97, { duration: dur, easing: ease });
      translateY.value = withTiming(10, { duration: dur, easing: ease });
    }
  }, [mounted, progress, scale, translateY, visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: progress.value * backdropOpacity,
    backgroundColor: theme.colors.overlay,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: progress.value,
  }));

  const handleBackdrop = () => {
    if (!dismissOnBackdrop) return;
    if (typeof onClose === 'function') onClose();
  };

  if (!mounted) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents="auto" style={[styles.overlay, overlayStyle]}>
        {/* перехватываем тап по фону */}
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackdrop} />
      </Animated.View>

      <View
        pointerEvents="box-none"
        style={[
          styles.centerWrap,
          {
            paddingHorizontal: dialogEdgePadding,
            paddingBottom: Math.max(dialogEdgePadding, insets?.bottom || 0),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              maxWidth: dialogMaxWidth,
              borderRadius: dialogRadius,
              padding: dialogPad,
            },
            theme.shadows?.md || {},
            contentStyle,
            cardStyle,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    borderWidth: 1,
  },
});
