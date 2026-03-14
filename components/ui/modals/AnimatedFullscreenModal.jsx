// components/ui/modals/AnimatedFullscreenModal.jsx
// Drop-in replacement for <Modal animationType="slide"|"fade"> that runs
// animations on the UI thread via react-native-reanimated.
//
// Props: same as RN Modal + `animation` ("slide" | "fade", default "slide").
// Eliminates JS-bridge lag from native animationType.

import { useCallback, useEffect, useState } from 'react';
import { Dimensions, Modal, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../../theme';

// M3 emphasized-decelerate (enter) / emphasized-accelerate (exit)
const EASE_IN = Easing.bezier(0.05, 0.7, 0.1, 1.0);
const EASE_OUT = Easing.bezier(0.3, 0.0, 0.8, 0.15);

export default function AnimatedFullscreenModal({
  visible,
  children,
  animation = 'slide',
  onRequestClose,
  onDismiss,
  ...rest
}) {
  const { theme } = useTheme();
  const exitDuration = theme.timings?.panelToggleMs ?? 220;
  const [mounted, setMounted] = useState(false);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(0);

  const doUnmount = useCallback(() => {
    setMounted(false);
    onDismiss?.();
  }, [onDismiss]);

  const runOpenAnimation = useCallback(() => {
    opacity.value = withTiming(1, { duration: 130, easing: EASE_IN });
    if (animation === 'slide') {
      translateY.value = withTiming(0, { duration: 130, easing: EASE_IN });
    }
  }, [animation, opacity, translateY]);

  useEffect(() => {
    if (visible) {
      // Set invisible starting position before mount
      opacity.value = 0;
      if (animation === 'slide') translateY.value = 60;
      setMounted(true);
      // Animation triggered by <Modal onShow>
    } else if (mounted) {
      // Animate out: accelerate away
      const screenH = Dimensions.get('window').height;
      opacity.value = withTiming(0, { duration: exitDuration, easing: EASE_OUT }, (fin) => {
        if (fin) runOnJS(doUnmount)();
      });
      if (animation === 'slide') {
        translateY.value = withTiming(screenH * 0.4, { duration: 250, easing: EASE_OUT });
      }
    }
  }, [animation, doUnmount, exitDuration, mounted, opacity, translateY, visible]);

  const animStyle = useAnimatedStyle(() => {
    if (animation === 'fade') {
      return { flex: 1, opacity: opacity.value };
    }
    return {
      flex: 1,
      opacity: opacity.value,
      transform: [{ translateY: translateY.value }],
    };
  });

  if (!visible && !mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onRequestClose}
      onShow={runOpenAnimation}
      {...rest}
    >
      <Animated.View style={[styles.fill, animStyle]}>
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
