// components/ui/modals/BaseModal.jsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Dimensions,
  BackHandler,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { applyAndroidNavigationBar, applyAndroidSystemBars } from '../../../lib/systemBars';
import { t as T } from '../../../src/i18n';
import { useToastOverlay } from '../ToastProvider';
import { useTheme } from '../../../theme';
import { withAlpha as withThemeAlpha } from '../../../theme/colors';
import DismissKeyboardArea from '../../layout/DismissKeyboardArea';
import {
  notifyIOSModalDismissed,
  registerIOSModal,
  releaseIOSModal,
  requestIOSModalPresentation,
  unregisterIOSModal,
} from './iosModalCoordinator';

const OPEN_SPRING = { damping: 28, stiffness: 500, mass: 0.5 };
const MIN_TOP_GAP_FROM_STATUS_BAR_DP = 38;
const EmbeddedModalHostContext = createContext(null);

function ModalWindowBottomSafeArea({ supported, enabled, children }) {
  if (!supported) return children;

  // Android Modal renders in a separate window, so its safe area must be
  // measured in that native tree instead of inherited from the activity.
  return (
    <SafeAreaView
      edges={enabled ? ['bottom'] : []}
      style={{ width: '100%', flexShrink: 1, minHeight: 0 }}
    >
      {children}
    </SafeAreaView>
  );
}

export function withAlpha(color, a) {
  const next = withThemeAlpha(color, a);
  return next === color ? `rgba(0,0,0,${Math.max(0, Math.min(1, Number(a)))})` : next;
}

const baseModalStyles = (t) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject },
    modalWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      overflow: 'hidden',
      zIndex: 1,
      elevation: 11,
    },
    cardWrap: {
      width: '100%',
      overflow: 'hidden',
      ...(Platform.OS === 'ios' ? t.shadows.card.ios : t.shadows.card.android),
    },
    handleHit: { alignItems: 'center', paddingTop: t.spacing.sm, paddingBottom: t.spacing.xs },
    handle: {
      width: 36,
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
    dialogTitleAndroid: { textAlign: 'left' },
    closeBtn: {
      position: 'absolute',
      right: t.components?.modal?.closeInset ?? t.spacing.sm,
      top: Math.max(t.spacing.xs, 6),
      borderRadius: t.radii.lg,
      width: 32,
      height: 32,
      padding: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

const BaseModalImpl = (
  {
    visible,
    onClose,
    onRequestClose,
    onShow,
    onDismiss,
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
    minTopGapFromStatusBar = null,
    fullscreenContent = null,
    onFullscreenRequestClose,
    embedded = false,
    presentation = 'sheet',
  },
  ref,
) => {
  const { theme } = useTheme();
  const parentModalHost = useContext(EmbeddedModalHostContext);
  const renderToastOverlay = useToastOverlay();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => baseModalStyles(theme), [theme]);
  const modalTokens = theme.components?.modal || {};
  const dialogTokens = theme.components?.dialog || {};
  const isSheet = presentation === 'sheet';
  const presentationRef = useRef(isSheet);
  presentationRef.current = isSheet;
  const disablePanCloseRef = useRef(disablePanClose);
  disablePanCloseRef.current = disablePanClose;

  const [rnVisible, setRnVisible] = useState(false);
  const [nativeDismissPending, setNativeDismissPending] = useState(false);
  const [modalKey, _setModalKey] = useState(0);
  const iosModalIdRef = useRef(null);
  const iosSuspendedRef = useRef(false);
  const openRef = useRef(null);
  const suspendRef = useRef(null);
  const dismissNotifiedRef = useRef(false);
  const nestedRequestCloseStackRef = useRef([]);
  const registerNestedRequestClose = useCallback((handler) => {
    if (typeof handler !== 'function') return () => {};
    const registration = { handler };
    nestedRequestCloseStackRef.current = [
      ...nestedRequestCloseStackRef.current,
      registration,
    ];
    return () => {
      nestedRequestCloseStackRef.current = nestedRequestCloseStackRef.current.filter(
        (item) => item !== registration,
      );
    };
  }, []);
  const modalHostValue = useMemo(
    () => ({ registerRequestClose: registerNestedRequestClose }),
    [registerNestedRequestClose],
  );

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

  const windowDimensions = Dimensions.get('window');
  const windowH = windowDimensions.height;
  const windowW = windowDimensions.width;
  const floatingSheet = isSheet && windowW >= 768;
  const usesModalWindowBottomInset =
    Platform.OS === 'android' && !embedded && isSheet && !floatingSheet;
  const sheetCornerRadius = Platform.OS === 'ios' ? 24 : 28;
  const minCardHeight = theme.spacing.xxxl * 3 + theme.spacing.xl;
  const topInsetAllowance = theme.components?.input?.height ?? 48;
  const androidStatusInset = Platform.OS === 'android' ? Number(StatusBar.currentHeight || 0) : 0;
  const androidTopFallbackInset = Platform.OS === 'android' ? Number(theme.spacing?.xl ?? 16) : 0;
  const topSafeInset =
    Platform.OS === 'android'
      ? Math.max(0, Number(insets.top || 0)) + Math.max(0, androidStatusInset) + androidTopFallbackInset
      : Math.max(0, Number(insets.top || 0));
  const sheetMaxH = Math.max(
    minCardHeight,
    Math.min(windowH * maxHeightRatio, windowH - (topSafeInset + topInsetAllowance)),
  );
  const overlayColor = theme.colors.overlay;
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
  const baseBottomPad = isSheet
    ? floatingSheet
      ? theme.spacing.md + (insets?.bottom || 0)
      : 0
    : theme.spacing.md + (insets?.bottom || 0);

  // Clamp to prevent the modal from moving beyond the top safe area.
  const platformTopGap =
    Platform.OS === 'android'
      ? Number(modalTokens.topOffsetAndroid ?? 56)
      : Number(modalTokens.topOffset ?? theme.spacing.lg);
  const minTopGap = Math.max(
    modalTokens.edgePadding ?? theme.spacing.md,
    theme.spacing.sm,
    Number.isFinite(platformTopGap) ? platformTopGap : 0,
  );
  const minTopGapFromStatusBarValue = Math.max(
    minTopGap,
    Number(modalTokens.minTopGapFromStatusBar ?? MIN_TOP_GAP_FROM_STATUS_BAR_DP) || MIN_TOP_GAP_FROM_STATUS_BAR_DP,
    Number.isFinite(minTopGapFromStatusBar) ? Number(minTopGapFromStatusBar) : 0,
  );
  const extraPad = Number.isFinite(keyboardExtraPadding) ? keyboardExtraPadding : 0;
  const extraBottom = kbInset > 0 ? kbInset + extraPad : 0;

  const op = useSharedValue(0);
  const cardOp = useSharedValue(0);
  const ty = useSharedValue(24);
  const sc = useSharedValue(1);
  const animatedBottomPad = useSharedValue(baseBottomPad + extraBottom);

  const maxAllowedHeight = Math.max(
    minCardHeight,
    windowH - (topSafeInset + minTopGapFromStatusBarValue) - (baseBottomPad + extraBottom),
  );
  const targetCardMaxHeight = Math.max(minCardHeight, Math.min(sheetMaxH, maxAllowedHeight));

  useEffect(() => {
    const targetPad = baseBottomPad + extraBottom;
    const duration = kbInset > 0 ? 180 : 140;
    animatedBottomPad.value = withTiming(targetPad, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [
    animatedBottomPad,
    baseBottomPad,
    extraBottom,
    kbInset,
    targetCardMaxHeight,
  ]);

  const notifyDismiss = () => {
    if (dismissNotifiedRef.current) return;
    dismissNotifiedRef.current = true;
    try {
      onDismiss?.();
    } catch {}
  };

  const doUnmount = () => {
    if (Platform.OS === 'ios' && !embedded) {
      setNativeDismissPending(true);
      setRnVisible(false);
      try {
        onClose?.();
      } catch {}
      return;
    }
    setRnVisible(false);
    try {
      onClose?.();
    } catch {}
    notifyDismiss();
  };

  // ── "Material Emerge" animation ──────────────────────────────
  // Open:  fade-in + slide-up + scale-up — card materializes from below
  // Close: fade-out + slide-down + scale-down — card dissolves downward
  // All three properties share matched spring configs for cohesion.

  const runOpenAnimation = () => {
    op.value = withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) });
    cardOp.value = presentationRef.current
      ? 1
      : withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) });
    ty.value = withSpring(0, OPEN_SPRING);
    sc.value = withSpring(1, OPEN_SPRING);
  };

  const open = () => {
    // Set invisible starting position, then mount
    dismissNotifiedRef.current = false;
    setNativeDismissPending(false);
    op.value = 0;
    cardOp.value = isSheet ? 1 : 0;
    ty.value = isSheet ? 64 : 12;
    sc.value = isSheet ? 1 : 0.96;
    if (!rnVisible) setRnVisible(true);
    // Animation triggered by <Modal onShow> — guarantees native mount is done
  };
  openRef.current = open;
  suspendRef.current = () => {
    if (!rnVisible) return;
    iosSuspendedRef.current = true;
    setNativeDismissPending(true);
    setRnVisible(false);
  };

  const close = () => {
    // Card slides down off-screen — no scale, no card fade.
    // M3 "emphasized accelerate": starts slow, accelerates away like gravity.
    const closingSheet = presentationRef.current;
    ty.value = withTiming(closingSheet ? sheetMaxH + 40 : 10, {
      duration: closingSheet ? 250 : 160,
      easing: closingSheet
        ? Easing.bezier(0.3, 0, 0.8, 0.15)
        : Easing.in(Easing.quad),
    });
    sc.value = withTiming(closingSheet ? 1 : 0.97, {
      duration: closingSheet ? 250 : 160,
      easing: Easing.in(Easing.quad),
    });
    cardOp.value = closingSheet
      ? 1
      : withTiming(0, {
        duration: 140,
        easing: Easing.in(Easing.quad),
      });
    // Backdrop fades out slightly faster — card is already moving
    op.value = withTiming(0, {
      duration: closingSheet ? 200 : 160,
      easing: Easing.out(Easing.quad),
    }, (fin) => {
      if (fin) runOnJS(doUnmount)();
    });
  };

  useImperativeHandle(ref, () => ({ close }));

  const requestClose = () => {
    if (typeof onRequestClose === 'function') {
      try {
        onRequestClose();
      } catch {}
      return;
    }
    close();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const handleContainerRequestClose = () => {
    const nestedStack = nestedRequestCloseStackRef.current;
    const topmostNested = nestedStack[nestedStack.length - 1]?.handler;
    if (typeof topmostNested === 'function') {
      topmostNested();
      return;
    }
    if (fullscreenContent && typeof onFullscreenRequestClose === 'function') {
      onFullscreenRequestClose();
      return;
    }
    requestCloseRef.current();
  };
  const handleContainerRequestCloseRef = useRef(handleContainerRequestClose);
  handleContainerRequestCloseRef.current = handleContainerRequestClose;

  const aBackdrop = useAnimatedStyle(() => ({ opacity: op.value }));
  const aWrap = useAnimatedStyle(() => ({
    paddingBottom: animatedBottomPad.value,
  }));
  const aCard = useAnimatedStyle(() => ({
    opacity: cardOp.value,
    transform: [{ translateY: ty.value }, { scale: sc.value }],
  }));

  const dragY = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        presentationRef.current && !disablePanCloseRef.current,
      onMoveShouldSetPanResponder: (_e, g) =>
        presentationRef.current &&
        !disablePanCloseRef.current &&
        Math.abs(g.dy) > Math.abs(g.dx) &&
        Math.abs(g.dy) > 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragY.current = 0;
      },
      onPanResponderMove: (_e, g) => {
        if (!presentationRef.current || disablePanCloseRef.current) return;
        const dy = Math.max(0, g.dy);
        dragY.current = dy;
        ty.value = dy * 0.85;
        sc.value = 1;
      },
      onPanResponderRelease: (_e, g) => {
        if (!presentationRef.current || disablePanCloseRef.current) return;
        const shouldClose = g.vy > 0.7 || dragY.current > sheetMaxH * 0.2;
        if (shouldClose) {
          requestCloseRef.current();
        } else {
          ty.value = withSpring(0, OPEN_SPRING);
          sc.value = withSpring(1, OPEN_SPRING);
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (Platform.OS !== 'ios' || embedded) return undefined;
    const id = registerIOSModal({
      present: () => openRef.current?.(),
      suspend: () => suspendRef.current?.(),
    });
    iosModalIdRef.current = id;
    return () => {
      unregisterIOSModal(id);
      iosModalIdRef.current = null;
    };
  }, [embedded]);

  useEffect(() => {
    if (Platform.OS === 'ios' && !embedded) {
      const id = iosModalIdRef.current;
      if (!id) return;
      if (visible) {
        requestIOSModalPresentation(id);
      } else {
        releaseIOSModal(id);
        if (rnVisible) close();
      }
      return;
    }
    if (visible) open();
    else if (rnVisible) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!embedded || !rnVisible) return;
    const frame = requestAnimationFrame(() => {
      runOpenAnimation();
      try {
        onShow?.();
      } catch {}
    });
    return () => cancelAnimationFrame(frame);
    // Opening is intentionally tied to the overlay mount, not prop rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, rnVisible]);

  useEffect(() => {
    if (!embedded || !rnVisible) return undefined;
    const handleBack = () => {
      handleContainerRequestCloseRef.current();
      return true;
    };
    if (typeof parentModalHost?.registerRequestClose === 'function') {
      return parentModalHost.registerRequestClose(handleBack);
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      return handleBack();
    });
    return () => subscription.remove();
  }, [embedded, parentModalHost, rnVisible]);

  useEffect(() => {
    if (embedded || Platform.OS !== 'android') return;

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
  }, [embedded, visible, theme]);

  if (!visible && !rnVisible && !nativeDismissPending) return null;

  const ModalContainer = embedded ? View : Modal;
  const containerProps =
    embedded
      ? {
        style: [StyleSheet.absoluteFill, { zIndex: 100, elevation: 100 }],
        accessibilityViewIsModal: true,
      }
      : {
        visible: !!rnVisible,
        transparent: true,
        presentationStyle: 'overFullScreen',
        animationType: 'none',
        onRequestClose: () => handleContainerRequestCloseRef.current(),
        onShow: () => {
          runOpenAnimation();
          try {
            onShow?.();
          } catch {}
        },
        onDismiss: () => {
          const wasSuspended = Platform.OS === 'ios' && iosSuspendedRef.current;
          iosSuspendedRef.current = false;
          setRnVisible(false);
          setNativeDismissPending(false);
          if (Platform.OS === 'ios' && iosModalIdRef.current != null) {
            notifyIOSModalDismissed(iosModalIdRef.current, { suspended: wasSuspended });
          }
          if (!wasSuspended) notifyDismiss();
        },
      };

  return (
    <EmbeddedModalHostContext.Provider value={modalHostValue}>
      <ModalContainer key={modalKey} {...containerProps}>
      <View
        collapsable={false}
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
      >
      {fullscreenContent ? (
        <View style={StyleSheet.absoluteFill}>{fullscreenContent}</View>
      ) : (
        <>
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
          if (!disableBackdropClose) requestClose();
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, aBackdrop, { backgroundColor: overlayColor }]}
        />
      </Pressable>

      {/* Platform-adaptive dialog/sheet container - above backdrop */}
      <Animated.View
        style={[
          s.modalWrap,
          aWrap,
          {
            justifyContent: isSheet ? 'flex-end' : 'center',
            paddingHorizontal: isSheet
              ? floatingSheet
                ? theme.spacing.xxl
                : 0
              : dialogTokens.edgePadding ?? theme.spacing.lg,
            paddingTop: topSafeInset + minTopGapFromStatusBarValue,
          },
        ]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            s.cardWrap,
            aCard,
            {
              alignSelf: isSheet && !floatingSheet ? 'stretch' : 'center',
              flexShrink: 1,
              minHeight: 0,
              maxWidth: isSheet
                ? floatingSheet
                  ? 640
                  : undefined
                : dialogTokens.maxWidth ?? 420,
              borderWidth: isSheet && !floatingSheet
                ? 0
                : theme.components?.card?.borderWidth ?? 1,
              borderRadius: isSheet && !floatingSheet
                ? 0
                : isSheet
                  ? Math.max(sheetCornerRadius, modalTokens.radius ?? theme.radii.xl)
                  : dialogTokens.radius ?? theme.radii.xl,
              borderTopLeftRadius: isSheet
                ? Math.max(sheetCornerRadius, modalTokens.radius ?? theme.radii.xl)
                : dialogTokens.radius ?? theme.radii.xl,
              borderTopRightRadius: isSheet
                ? Math.max(sheetCornerRadius, modalTokens.radius ?? theme.radii.xl)
                : dialogTokens.radius ?? theme.radii.xl,
              paddingBottom: isSheet
                ? kbInset > 0
                  ? 0
                  : floatingSheet
                    ? theme.spacing.sm
                    : usesModalWindowBottomInset
                      ? 0
                      : insets.bottom
                : 0,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              elevation: isSheet ? 10 : 12,
              maxHeight: targetCardMaxHeight,
              ...(Platform.OS === 'ios'
                ? theme.shadows.raised.ios
                : theme.shadows.raised.android),
            },
          ]}
        >
          <ModalWindowBottomSafeArea
            supported={usesModalWindowBottomInset}
            enabled={kbInset <= 0}
          >
            <DismissKeyboardArea
              enabled={false}
              style={{ width: '100%', flexShrink: 1, minHeight: 0 }}
            >
          {/* Drag handle */}
            {isSheet && showHandle ? (
              <View style={s.handleHit} {...(disablePanClose ? {} : pan.panHandlers)}>
                <View style={[s.handle, { backgroundColor: theme.colors.inputBorder }]} />
              </View>
            ) : null}

            {/* Header */}
            <View
              style={[
                s.header,
                !isSheet
                  ? { paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.xs }
                  : {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.colors.border,
                  },
              ]}
            >
              <View
                style={[
                  s.titleWrap,
                  !isSheet && Platform.OS === 'android' ? { paddingLeft: 0 } : null,
                ]}
              >
                <Text
                  numberOfLines={3}
                  ellipsizeMode="tail"
                  style={[
                    s.title,
                    !isSheet && Platform.OS === 'android' ? s.dialogTitleAndroid : null,
                    {
                      color: theme.colors.text,
                      fontSize: isSheet && Platform.OS === 'ios'
                        ? 17
                        : theme.typography.sizes.lg,
                      fontWeight: isSheet && Platform.OS === 'ios' ? '600' : '700',
                    },
                  ]}
                >
                  {title}
                </Text>
              </View>
              <Pressable
                hitSlop={modalTokens.closeHitSlop ?? 10}
                onPress={requestClose}
                style={[
                  s.closeBtn,
                  { backgroundColor: isSheet ? theme.colors.button.secondaryBg : 'transparent' },
                ]}
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
            </DismissKeyboardArea>
          </ModalWindowBottomSafeArea>
          </Animated.View>
        </Animated.View>
        </>
      )}
      {embedded || Platform.OS === 'ios' ? null : renderToastOverlay?.() || null}
      </View>
      </ModalContainer>
    </EmbeddedModalHostContext.Provider>
  );
};

const BaseModal = React.forwardRef(BaseModalImpl);
export default BaseModal;
