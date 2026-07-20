// components/ui/modals/AnimatedFullscreenModal.jsx
// Drop-in replacement for <Modal animationType="slide"|"fade"> that runs
// animations on the UI thread via react-native-reanimated.
//
// Props: same as RN Modal + `animation` ("slide" | "fade", default "slide").
// Eliminates JS-bridge lag from native animationType.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Modal, Platform, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../../theme';
import { useToastOverlay } from '../ToastProvider';
import {
  notifyIOSModalDismissed,
  registerIOSModal,
  releaseIOSModal,
  requestIOSModalPresentation,
  unregisterIOSModal,
} from './iosModalCoordinator';

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
  const renderToastOverlay = useToastOverlay();
  const exitDuration = theme.timings?.panelToggleMs ?? 220;
  const [mounted, setMounted] = useState(false);
  const [nativeDismissPending, setNativeDismissPending] = useState(false);
  const dismissNotifiedRef = useRef(false);
  const iosModalIdRef = useRef(null);
  const iosSuspendedRef = useRef(false);
  const openRef = useRef(null);
  const suspendRef = useRef(null);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(0);

  const notifyDismiss = useCallback(() => {
    if (dismissNotifiedRef.current) return;
    dismissNotifiedRef.current = true;
    onDismiss?.();
  }, [onDismiss]);

  const doUnmount = useCallback(() => {
    if (Platform.OS === 'ios') {
      setNativeDismissPending(true);
    }
    setMounted(false);
    if (Platform.OS !== 'ios') notifyDismiss();
  }, [notifyDismiss]);

  const runOpenAnimation = useCallback(() => {
    opacity.value = withTiming(1, { duration: 130, easing: EASE_IN });
    if (animation === 'slide') {
      translateY.value = withTiming(0, { duration: 130, easing: EASE_IN });
    }
  }, [animation, opacity, translateY]);

  const open = useCallback(() => {
    dismissNotifiedRef.current = false;
    setNativeDismissPending(false);
    opacity.value = 0;
    if (animation === 'slide') translateY.value = 60;
    setMounted(true);
  }, [animation, opacity, translateY]);

  const close = useCallback(() => {
    const screenH = Dimensions.get('window').height;
    opacity.value = withTiming(0, { duration: exitDuration, easing: EASE_OUT }, (fin) => {
      if (fin) runOnJS(doUnmount)();
    });
    if (animation === 'slide') {
      translateY.value = withTiming(screenH * 0.4, { duration: 250, easing: EASE_OUT });
    }
  }, [animation, doUnmount, exitDuration, opacity, translateY]);

  openRef.current = open;
  suspendRef.current = () => {
    if (!mounted) return;
    iosSuspendedRef.current = true;
    setNativeDismissPending(true);
    setMounted(false);
  };

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const id = registerIOSModal({
      present: () => openRef.current?.(),
      suspend: () => suspendRef.current?.(),
    });
    iosModalIdRef.current = id;
    return () => {
      unregisterIOSModal(id);
      iosModalIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      const id = iosModalIdRef.current;
      if (!id) return;
      if (visible) requestIOSModalPresentation(id);
      else {
        releaseIOSModal(id);
        if (mounted) close();
      }
      return;
    }
    if (visible) open();
    else if (mounted) close();
  }, [close, mounted, open, visible]);

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

  if (!visible && !mounted && !nativeDismissPending) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={onRequestClose}
      onShow={runOpenAnimation}
      onDismiss={() => {
        const wasSuspended = iosSuspendedRef.current;
        iosSuspendedRef.current = false;
        setNativeDismissPending(false);
        if (Platform.OS === 'ios' && iosModalIdRef.current != null) {
          notifyIOSModalDismissed(iosModalIdRef.current, { suspended: wasSuspended });
        }
        if (!wasSuspended) notifyDismiss();
      }}
      {...rest}
    >
      <Animated.View style={[styles.fill, animStyle]}>
        {children}
      </Animated.View>
      {Platform.OS === 'ios' ? null : renderToastOverlay?.() || null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
