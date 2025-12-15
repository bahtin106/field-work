// components/ui/modals/BaseModal.jsx
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// NavigationBar: dynamically imported on Android to avoid Expo Go iOS native-module error
import { Feather } from '@expo/vector-icons';
import { t as T } from '../../../src/i18n';
import { useTheme } from '../../../theme';

export function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

const baseSheetStyles = (t) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject },
    bottomWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    cardWrap: {
      width: '100%',
      borderRadius: t.radii.xl,
      borderWidth: 1,
      overflow: 'hidden',
      ...(Platform.OS === 'ios' ? t.shadows.card.ios : t.shadows.card.android),
    },
    handleHit: { alignItems: 'center', paddingVertical: t.spacing.md },
    handle: { width: 48, height: 5, borderRadius: 3 },
    header: {
      minHeight: 44,
      paddingHorizontal: t.spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontSize: t.typography.sizes.lg, fontWeight: '700' },
    closeBtn: { position: 'absolute', right: 8, top: 6, padding: 8, borderRadius: 16 },
  });

const BaseModalImpl = (
  {
    visible,
    onClose,
    title = '',
    children,
    footer = null,
    maxHeightRatio = 0.6,
    showHandle = true,
    disableBackdropClose = false,
    disablePanClose = false,
  },
  ref,
) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => baseSheetStyles(theme), [theme]);

  const [rnVisible, setRnVisible] = useState(false);
  const [modalKey, setModalKey] = useState(0);

  // Track keyboard height to avoid overlap (applies to all screens using BaseModal)
  const [kbInset, setKbInset] = useState(0);
  const [kbTop, setKbTop] = useState(Dimensions.get('window').height);

  useEffect(() => {
    if (!rnVisible) {
      setKbInset(0);
      return;
    }
    const showE = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showE, (e) => {
      try {
        const screenH = Dimensions.get('window').height;
        const isIOS = Platform.OS === 'ios';
        let h = 0;
        let top = screenH;
        if (isIOS) {
          const endY = e.endCoordinates?.screenY ?? screenH;
          h = Math.max(0, endY < screenH ? screenH - endY : 0);
          top = endY;
        } else {
          h = Math.max(0, e.endCoordinates?.height ?? 0);
          top = screenH - h;
        }
        setKbInset(h);
        setKbTop(top);
      } catch (_) {}
    });
    const subHide = Keyboard.addListener(hideE, () => {
      setKbInset(0);
      setKbTop(Dimensions.get('window').height);
    });
    return () => {
      try {
        subShow?.remove?.();
        subHide?.remove?.();
      } catch (_) {}
    };
  }, [rnVisible]);

  const screenH = Dimensions.get('window').height;
  const sheetMaxH = Math.max(220, Math.min(screenH * maxHeightRatio, screenH - (insets.top + 48)));
  const overlayColor = theme.colors.overlay || 'rgba(0,0,0,0.35)';
  // Only push modal if keyboard overlaps the card's bottom edge.
  const baseBottomPad = theme.spacing.md + (insets?.bottom || 0);

  // Clamp to prevent the modal from moving beyond the top safe area.
  const minTopGap = Math.max(12, theme.spacing.sm);
  const maxExtraBottom = Math.max(
    0,
    screenH - sheetMaxH - (insets.top + minTopGap) - baseBottomPad,
  );

  const extraBottom = useMemo(() => {
    // Baseline bottom edge without extra padding
    const cardBottom = screenH - baseBottomPad;
    const overlap = Math.max(0, cardBottom - kbTop);
    const need = overlap > 0 ? overlap + 8 : 0;
    return Math.min(need, maxExtraBottom);
  }, [kbTop, screenH, baseBottomPad, maxExtraBottom]);

  const op = useSharedValue(0);
  const ty = useSharedValue(24);
  const sc = useSharedValue(1);

  const open = () => {
    if (!rnVisible) setRnVisible(true);
    op.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    ty.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
  };

  const close = () => {
    const offY = Math.max(260, sheetMaxH * 0.9);
    ty.value = withTiming(offY, { duration: 200, easing: Easing.in(Easing.cubic) });
    op.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) });
    setTimeout(() => {
      setRnVisible(false);
      try {
        onClose?.();
      } catch (_) {}
    }, 250);
  };
  useImperativeHandle(ref, () => ({ close }));

  const aBackdrop = useAnimatedStyle(() => ({ opacity: op.value }));
  const aCard = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: sc.value }],
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
      },
      onPanResponderRelease: (_e, g) => {
        if (disablePanClose) return;
        const shouldClose = g.vy > 1.0 || dragY.current > sheetMaxH * 0.22;
        if (shouldClose) close();
        else ty.value = withSpring(0, { damping: 22, stiffness: 420, mass: 0.6 });
      },
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      op.value = 0;
      ty.value = 24;
      sc.value = 1;
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
        const NavigationBar = await import('expo-navigation-bar');
        if (visible) {
          await NavigationBar.setBehaviorAsync('overlay-swipe');
          await NavigationBar.setBackgroundColorAsync('transparent');
          await NavigationBar.setButtonStyleAsync(theme.mode === 'dark' ? 'light' : 'dark');
        } else {
          await NavigationBar.setBehaviorAsync('inset-swipe');
          await NavigationBar.setBackgroundColorAsync('transparent');
          await NavigationBar.setButtonStyleAsync(theme.mode === 'dark' ? 'light' : 'dark');
        }
      } catch {}
    })();
  }, [visible, theme.mode]);

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
      onDismiss={() => {
        setRnVisible(false);
        try {
          onClose?.();
        } catch (_) {}
      }}
    >
      {/* Backdrop: if keyboard visible, dismiss it first; otherwise close modal */}
      <Pressable
        style={s.backdrop}
        onPress={() => {
          if (kbInset > 0) {
            try {
              Keyboard.dismiss();
            } catch (_) {}
            return;
          }
          if (!disableBackdropClose) close();
        }}
        pointerEvents={rnVisible ? 'auto' : 'none'}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, aBackdrop, { backgroundColor: overlayColor }]}
        />
      </Pressable>

      {/* Bottom container */}
      <View
        style={[
          s.bottomWrap,
          { paddingHorizontal: theme.spacing.md, paddingBottom: baseBottomPad + extraBottom },
        ]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            s.cardWrap,
            aCard,
            {
              alignSelf: 'stretch',
              maxHeight: sheetMaxH,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
        >
          {/* Drag handle */}
          {showHandle ? (
            <View style={s.handleHit} {...(disablePanClose ? {} : pan.panHandlers)}>
              <View style={[s.handle, { backgroundColor: theme.colors.inputBorder }]} />
            </View>
          ) : null}

          {/* Header: tap on header will dismiss keyboard (if open) */}
          <Pressable
            accessible={false}
            style={s.header}
            onPress={() => {
              try {
                if (kbInset > 0) Keyboard.dismiss();
              } catch (_) {}
            }}
          >
            <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>
              {title}
            </Text>
            <Pressable
              hitSlop={10}
              onPress={close}
              style={s.closeBtn}
              accessibilityLabel={T('btn_close')}
            >
              <Feather name="x" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          </Pressable>

          {/* Content: tap inside modal dismisses keyboard */}
          <TouchableWithoutFeedback
            accessible={false}
            onPress={() => {
              try {
                Keyboard.dismiss();
              } catch (_) {}
            }}
          >
            <View style={{ paddingHorizontal: theme.spacing.lg }}>{children}</View>
          </TouchableWithoutFeedback>

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
      </View>
    </Modal>
  );
};

const BaseModal = React.forwardRef(BaseModalImpl);
export default BaseModal;
