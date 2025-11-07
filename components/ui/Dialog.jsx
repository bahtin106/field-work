import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';

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

  // локальный mount, чтобы плавно убирать из дерева после анимации скрытия
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0); // 0..1 — для прозрачности оверлея
  const scale = useSharedValue(0.96); // лёгкий zoom-in

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) });
      scale.value = withSpring(1, { mass: 0.6, damping: 14, stiffness: 180 });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: 140, easing: Easing.in(Easing.quad) }, (f) => {
        if (f) runOnJS(setMounted)(false);
      });
      scale.value = withTiming(0.96, { duration: 140, easing: Easing.inOut(Easing.quad) });
    }
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (Platform.OS === 'ios' ? 0.38 : 0.42),
    backgroundColor: theme.colors.overlay,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
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
        style={[styles.centerWrap, { paddingBottom: Math.max(16, insets?.bottom || 0) }]}
      >
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, maxWidth },
            ,
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
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
});
