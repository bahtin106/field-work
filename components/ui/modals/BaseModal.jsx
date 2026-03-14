// components/ui/modals/BaseModal.jsx
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { applyAndroidNavigationBar, applyAndroidSystemBars } from '../../../lib/systemBars';
import { t as T } from '../../../src/i18n';
import { useTheme } from '../../../theme';
import { withAlpha as withThemeAlpha } from '../../../theme/colors';

const OPEN_SPRING = { damping: 28, stiffness: 500, mass: 0.5 };

export function withAlpha(color, a) {
  const next = withThemeAlpha(color, a);
  return next === color ? `rgba(0,0,0,${Math.max(0, Math.min(1, Number(a)))})` : next;
}

const baseSheetStyles = (t) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject },
    bottomWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
      alignItems: 'center',
      zIndex: 1,
      elevation: 11,
    },
    cardWrap: {
      width: '100%',
      borderRadius: t.components?.modal?.radius ?? t.radii.xl,
      borderWidth: t.components?.card?.borderWidth ?? 1,
      overflow: 'hidden',
      ...(Platform.OS === 'ios' ? t.shadows.card.ios : t.shadows.card.android),
    },
    handleHit: { alignItems: 'center', paddingVertical: t.spacing.md },
    handle: {
      width: t.components?.modal?.handleWidth ?? 48,
      height: t.components?.modal?.handleHeight ?? 5,
      borderRadius: t.radii.xs,
    },
    header: {
      minHeight: t.components?.input?.height ?? 44,
      paddingHorizontal: t.spacing.lg,
      alignItems: 'stretch',
      justifyContent: 'center',
      position: 'relative',
    },
    titleWrap: {
      paddingLeft: (t.components?.modal?.closeIconSize ?? 20) + (t.spacing.lg * 2),
      paddingRight: (t.components?.modal?.closeIconSize ?? 20) + (t.spacing.lg * 2),
      minWidth: 0,
    },
    title: { fontSize: t.typography.sizes.lg, fontWeight: '700', textAlign: 'center' },
    closeBtn: {
      position: 'absolute',
      right: t.components?.modal?.closeInset ?? t.spacing.sm,
      top: Math.max(t.spacing.xs, 6),
      padding: t.components?.modal?.closeInset ?? t.spacing.sm,
      borderRadius: t.radii.lg,
    },
  });

const BaseModalImpl = (
  {
    visible,
    onClose,
    onShow,
    title = '',
    children,
    footer = null,
    feedback = null,
    maxHeightRatio = 0.6,
    showHandle = true,
    disableBackdropClose = false,
    disablePanClose = false,
    keyboardExtraPadding = 0,
    disableContentShrink = false,
  },
  ref,
) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => baseSheetStyles(theme), [theme]);
  const modalTokens = theme.components?.modal || {};

  const [rnVisible, setRnVisible] = useState(false);
  const [modalKey, _setModalKey] = useState(0);

  // Track keyboard height to avoid overlap (applies to all screens using BaseModal)
  const [kbInset, setKbInset] = useState(0);

  useEffect(() => {
    if (!rnVisible) {
      setKbInset(0);
      return;
    }
    const showE = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showE, (e) => {
      try {
        const windowH = Dimensions.get('window').height;
        const screenH = Math.max(windowH, Dimensions.get('screen').height);
        const endY = Number(e?.endCoordinates?.screenY);
        const hFromEvent = Math.max(0, Number(e?.endCoordinates?.height) || 0);
        const hFromScreenY = Number.isFinite(endY) ? Math.max(0, screenH - endY) : 0;
        const metricsHeight = Math.max(0, Number(Keyboard.metrics?.()?.height) || 0);
        const nextInset = Math.max(hFromEvent, hFromScreenY, metricsHeight);
        setKbInset(nextInset);
      } catch {}
    });
    const subHide = Keyboard.addListener(hideE, () => {
      setKbInset(0);
    });
    return () => {
      try {
        subShow?.remove?.();
        subHide?.remove?.();
      } catch {}
    };
  }, [rnVisible]);

  const windowH = Dimensions.get('window').height;
  const minCardHeight = theme.spacing.xxxl * 3 + theme.spacing.xl;
  const topInsetAllowance = theme.components?.input?.height ?? 48;
  const topSafeInset = Math.max(
    insets.top || 0,
    Platform.OS === 'android' ? Number(StatusBar.currentHeight || 0) : 0,
  );
  const sheetMaxH = Math.max(
    minCardHeight,
    Math.min(windowH * maxHeightRatio, windowH - (topSafeInset + topInsetAllowance)),
  );
  const overlayColor = theme.colors.overlay || 'rgba(0,0,0,0.35)';
  const feedbackMessage =
    typeof feedback === 'string' ? feedback : String(feedback?.message || '').trim();
  const feedbackType = String(feedback?.type || 'warning');
  const feedbackTone = useMemo(() => {
    if (feedbackType === 'error') {
      return {
        border: theme.colors.danger,
        text: theme.colors.danger,
        bg: withAlpha(theme.colors.danger, 0.08),
      };
    }
    if (feedbackType === 'success') {
      return {
        border: theme.colors.success,
        text: theme.colors.success,
        bg: withAlpha(theme.colors.success, 0.08),
      };
    }
    if (feedbackType === 'info') {
      return {
        border: theme.colors.primary,
        text: theme.colors.primary,
        bg: withAlpha(theme.colors.primary, 0.08),
      };
    }
    const warningColor = theme.colors.warning || theme.colors.danger;
    return {
      border: warningColor,
      text: warningColor,
      bg: withAlpha(warningColor, 0.08),
    };
  }, [feedbackType, theme.colors.danger, theme.colors.primary, theme.colors.success, theme.colors.warning]);
  const baseBottomPad = theme.spacing.md + (insets?.bottom || 0);

  // Clamp to prevent the modal from moving beyond the top safe area.
  const minTopGap = Math.max(modalTokens.edgePadding ?? theme.spacing.md, theme.spacing.sm);
  const extraPad = Number.isFinite(keyboardExtraPadding) ? keyboardExtraPadding : 0;
  const extraBottom = kbInset > 0 ? kbInset + extraPad : 0;

  const op = useSharedValue(0);
  const cardOp = useSharedValue(0);
  const ty = useSharedValue(24);
  const sc = useSharedValue(1);
  const animatedBottomPad = useSharedValue(baseBottomPad + extraBottom);
  const animatedCardMaxHeight = useSharedValue(sheetMaxH);

  const maxAllowedHeight = Math.max(
    minCardHeight,
    windowH - (topSafeInset + minTopGap) - (baseBottomPad + extraBottom),
  );
  const targetCardMaxHeight = Math.min(sheetMaxH, maxAllowedHeight);

  useEffect(() => {
    const targetPad = baseBottomPad + extraBottom;
    const duration = kbInset > 0 ? 180 : 140;
    animatedBottomPad.value = withTiming(targetPad, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    animatedCardMaxHeight.value = withTiming(targetCardMaxHeight, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [
    animatedBottomPad,
    animatedCardMaxHeight,
    baseBottomPad,
    extraBottom,
    kbInset,
    targetCardMaxHeight,
  ]);

  const doUnmount = () => {
    setRnVisible(false);
    try {
      onClose?.();
    } catch {}
  };

  // ── "Material Emerge" animation ──────────────────────────────
  // Open:  fade-in + slide-up + scale-up — card materializes from below
  // Close: fade-out + slide-down + scale-down — card dissolves downward
  // All three properties share matched spring configs for cohesion.

  const runOpenAnimation = () => {
    op.value = withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) });
    cardOp.value = withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) });
    ty.value = withSpring(0, OPEN_SPRING);
    sc.value = withSpring(1, OPEN_SPRING);
  };

  const open = () => {
    // Set invisible starting position, then mount
    op.value = 0;
    cardOp.value = 0;
    ty.value = 64;
    sc.value = 0.93;
    if (!rnVisible) setRnVisible(true);
    // Animation triggered by <Modal onShow> — guarantees native mount is done
  };

  const close = () => {
    // Card slides down off-screen — no scale, no card fade.
    // M3 "emphasized accelerate": starts slow, accelerates away like gravity.
    const exitY = sheetMaxH + 40;
    ty.value = withTiming(exitY, {
      duration: 250,
      easing: Easing.bezier(0.3, 0, 0.8, 0.15),
    });
    // Backdrop fades out slightly faster — card is already moving
    op.value = withTiming(0, {
      duration: 200,
      easing: Easing.out(Easing.quad),
    }, (fin) => {
      if (fin) runOnJS(doUnmount)();
    });
  };
  useImperativeHandle(ref, () => ({ close }));

  const aBackdrop = useAnimatedStyle(() => ({ opacity: op.value }));
  const aWrap = useAnimatedStyle(() => ({
    paddingBottom: animatedBottomPad.value,
  }));
  const aCard = useAnimatedStyle(() => ({
    opacity: cardOp.value,
    transform: [{ translateY: ty.value }, { scale: sc.value }],
    maxHeight: animatedCardMaxHeight.value,
  }));

  const dragY = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disablePanClose,
      onMoveShouldSetPanResponder: (_e, g) =>
        !disablePanClose && Math.abs(g.dy) > Math.abs(g.dx) && Math.abs(g.dy) > 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragY.current = 0;
      },
      onPanResponderMove: (_e, g) => {
        if (disablePanClose) return;
        const dy = Math.max(0, g.dy);
        dragY.current = dy;
        ty.value = dy * 0.85;
        // Subtle scale-down while dragging for tactile feel
        const dragRatio = Math.min(dy / sheetMaxH, 1);
        sc.value = 1 - dragRatio * 0.06;
      },
      onPanResponderRelease: (_e, g) => {
        if (disablePanClose) return;
        const shouldClose = g.vy > 0.7 || dragY.current > sheetMaxH * 0.2;
        if (shouldClose) {
          close();
        } else {
          ty.value = withSpring(0, OPEN_SPRING);
          sc.value = withSpring(1, OPEN_SPRING);
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      open();
    } else if (rnVisible) {
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    (async () => {
      try {
        if (visible) {
          await applyAndroidNavigationBar(theme, {
            behavior: 'overlay-swipe',
            backgroundColor: 'transparent',
          });
        } else {
          await applyAndroidSystemBars(theme);
        }
      } catch {}
    })();

    return () => {
      if (!visible) return;
      applyAndroidSystemBars(theme).catch(() => {});
    };
  }, [visible, theme]);

  if (!visible && !rnVisible) return null;

  return (
    <Modal
      key={modalKey}
      visible={!!rnVisible}
      transparent
      presentationStyle="overFullScreen"
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
      onShow={() => {
        runOpenAnimation();
        try {
          onShow?.();
        } catch {}
      }}
      onDismiss={() => {
        // Safety-net: ensure state is reset even if native dismisses unexpectedly
        setRnVisible(false);
      }}
    >
      {/* Backdrop - handles taps outside card */}
      <Pressable
        style={[StyleSheet.absoluteFill, { zIndex: 0, elevation: 0 }]}
        pointerEvents={rnVisible ? 'box-only' : 'none'}
        onPress={() => {
          if (kbInset > 0) {
            try {
              Keyboard.dismiss();
            } catch {}
            return;
          }
          if (!disableBackdropClose) close();
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, aBackdrop, { backgroundColor: overlayColor }]}
        />
      </Pressable>

      {/* Bottom container - above backdrop */}
      <Animated.View
        style={[
          s.bottomWrap,
          aWrap,
          { paddingHorizontal: modalTokens.edgePadding ?? theme.spacing.md },
        ]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            s.cardWrap,
            aCard,
            {
              alignSelf: 'stretch',
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              elevation: 10,
            },
          ]}
        >
          {/* Drag handle */}
            {showHandle ? (
              <View style={s.handleHit} {...(disablePanClose ? {} : pan.panHandlers)}>
                <View style={[s.handle, { backgroundColor: theme.colors.inputBorder }]} />
              </View>
            ) : null}

            {/* Header */}
            <View style={s.header}>
              <View style={s.titleWrap}>
                <Text numberOfLines={3} ellipsizeMode="tail" style={[s.title, { color: theme.colors.text }]}>
                  {title}
                </Text>
              </View>
              <Pressable
                hitSlop={modalTokens.closeHitSlop ?? 10}
                onPress={close}
                style={s.closeBtn}
                accessibilityLabel={T('btn_close')}
              >
                <Feather
                  name="x"
                  size={modalTokens.closeIconSize ?? 20}
                  color={theme.colors.textSecondary}
                />
              </Pressable>
            </View>

            {/* Content */}
            <View
              style={[
                { paddingHorizontal: theme.spacing.lg },
                disableContentShrink ? null : { flexShrink: 1, minHeight: 0 },
              ]}
            >
              {children}
            </View>

            {feedbackMessage ? (
              <View
                style={{
                  marginTop: theme.spacing.xs,
                  marginHorizontal: theme.spacing.lg,
                  borderWidth: 1,
                  borderRadius: theme.radii.md,
                  borderColor: feedbackTone.border,
                  backgroundColor: feedbackTone.bg,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                <Text
                  style={{
                    color: feedbackTone.text,
                    fontSize: theme.typography.sizes.sm,
                    lineHeight: Math.round((theme.typography.sizes.sm || 14) * 1.35),
                  }}
                >
                  {feedbackMessage}
                </Text>
              </View>
            ) : null}

            {/* Footer */}
            {footer ? (
              <View
                style={{
                  paddingHorizontal: theme.spacing.lg,
                  marginTop: theme.spacing.sm,
                  marginBottom: theme.spacing.md,
                }}
              >
                {footer}
              </View>
            ) : null}
          </Animated.View>
        </Animated.View>
    </Modal>
  );
};

const BaseModal = React.forwardRef(BaseModalImpl);
export default BaseModal;
