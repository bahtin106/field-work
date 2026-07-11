// components/ui/ToastProvider.jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { useTheme } from '../../theme';
import { logClientError } from '../../lib/errorLogsClient';
import { t as i18nT } from '../../src/i18n';

import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const Ctx = createContext(null);
const OverlayCtx = createContext(() => null);
const TOAST_SHADOW_PAD = 12;
const TOAST_ENTER_DURATION = 180;
const TOAST_EXIT_DURATION = 140;
const NOOP_TOAST_API = {
  show: () => {},
  hide: () => {},
  setAnchorOffset: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
  loading: () => {},
  promise: async (p) => (typeof p === 'function' ? p() : p),
  renderOverlay: () => null,
};

export default function ToastProvider({ children }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [msg, setMsg] = useState(null); // { text, type }
  const [anchorOffset, setAnchorOffset] = useState(theme.components?.toast?.anchorOffset ?? 120);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const timerRef = useRef(null);
  const mounted = useSharedValue(true);
  const visibleRef = useRef(false);

  // Reanimated shared values
  const ty = useSharedValue(20); // translateY
  const op = useSharedValue(0); // opacity
  const scale = useSharedValue(0.985);
  const bottom = useSharedValue((insets?.bottom || 0) + anchorOffset);

  useEffect(() => {
    const calcHeight = (event) => {
      const raw = Number(event?.endCoordinates?.height || 0);
      if (!Number.isFinite(raw) || raw <= 0) return 0;
      const safeBottom = Number(insets?.bottom || 0);
      return Math.max(0, raw - safeBottom);
    };

    const onKeyboardShow = (event) => {
      setKeyboardHeight(calcHeight(event));
    };

    const onKeyboardHide = () => {
      setKeyboardHeight(0);
    };

    const subscriptions = [];
    if (Platform.OS === 'ios') {
      subscriptions.push(Keyboard.addListener('keyboardWillChangeFrame', onKeyboardShow));
      subscriptions.push(Keyboard.addListener('keyboardWillHide', onKeyboardHide));
    } else {
      subscriptions.push(Keyboard.addListener('keyboardDidShow', onKeyboardShow));
      subscriptions.push(Keyboard.addListener('keyboardDidHide', onKeyboardHide));
    }

    return () => {
      subscriptions.forEach((sub) => sub?.remove?.());
    };
  }, [insets?.bottom]);

  useEffect(() => {
    const keyboardLift = keyboardHeight > 0 ? keyboardHeight + (theme.spacing?.sm ?? 8) : 0;
    const targetBottom = (insets?.bottom || 0) + anchorOffset + keyboardLift;
    bottom.value = withTiming(targetBottom, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [anchorOffset, bottom, insets?.bottom, keyboardHeight, theme.spacing?.sm]);

  useEffect(() => {
    return () => {
      mounted.value = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [mounted]);

  const endHide = () => {
    visibleRef.current = false;
    setMsg(null);
  };

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // плавное скрытие вниз + фейд
    ty.value = withTiming(22, { duration: TOAST_EXIT_DURATION, easing: Easing.in(Easing.cubic) }, () => {
      if (!mounted.value) return;
      runOnJS(endHide)();
    });
    op.value = withTiming(0, { duration: TOAST_EXIT_DURATION, easing: Easing.in(Easing.quad) });
    scale.value = withTiming(0.985, { duration: TOAST_EXIT_DURATION, easing: Easing.in(Easing.quad) });
  }, [ty, op, scale, mounted]);

  const show = useCallback(
    (text, type = 'info', opts = {}) => {
      const { sticky = false, duration = 1800 } = opts || {};
      const normalizedText = String(text ?? '');
      if ((type === 'error' || type === 'warning') && normalizedText.trim()) {
        logClientError(normalizedText, {
          source: 'ui_toast',
          severity: type,
          sticky: !!sticky,
        });
      }
      // If already visible: update text/type and (re)arm timer depending on sticky
      if (visibleRef.current) {
        setMsg({ text: normalizedText, type });
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (!sticky) timerRef.current = setTimeout(hide, duration);
        return;
      }
      // First show: set visible and play enter animation
      visibleRef.current = true;
      setMsg({ text: normalizedText, type });
      ty.value = 18;
      op.value = 0;
      scale.value = 0.985;
      ty.value = withTiming(0, { duration: TOAST_ENTER_DURATION, easing: Easing.out(Easing.cubic) });
      op.value = withTiming(1, { duration: TOAST_ENTER_DURATION, easing: Easing.out(Easing.quad) });
      scale.value = withTiming(1, { duration: TOAST_ENTER_DURATION, easing: Easing.out(Easing.cubic) });
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!sticky) timerRef.current = setTimeout(hide, duration);
    },
    [ty, op, scale, hide],
  );

  const success = useCallback((text) => show(text, 'success'), [show]);
  const error = useCallback((text) => show(text, 'error'), [show]);
  const warning = useCallback((text) => show(text, 'warning'), [show]);
  const info = useCallback((text) => show(text, 'info'), [show]);
  const loading = useCallback(
    (text) => show(text ?? i18nT('toast.loading'), 'info', { sticky: true }),
    [show],
  );
  const promise = useCallback(
    (p, m = {}) => {
      const {
        loading = i18nT('toast.loading'),
        success = i18nT('toast.success'),
        error = i18nT('toast.error'),
      } = m || {};
      show(loading, 'info', { sticky: true });
      const run = typeof p === 'function' ? p() : p;
      return Promise.resolve(run)
        .then((res) => {
          show(typeof success === 'function' ? success(res) : success, 'success');
          return res;
        })
        .catch((e) => {
          show(typeof error === 'function' ? error(e) : e?.message || error, 'error');
          throw e;
        });
    },
    [show],
  );
  const value = useMemo(
    () => ({
      show,
      hide,
      setAnchorOffset,
      success,
      error,
      warning,
      info,
      loading,
      promise,
    }),
    [error, hide, info, loading, promise, show, success, warning],
  );

  const palette = (t) => ({
    info: { bg: t.colors.surface, fg: t.colors.text, border: t.colors.border },
    success: { bg: t.colors.surface, fg: t.colors.success, border: t.colors.success },
    warning: {
      bg: t.colors.surface,
      fg: t.colors.warning,
      border: t.colors.warning,
    },
    error: { bg: t.colors.surface, fg: t.colors.danger, border: t.colors.danger },
  });
  const p = palette(theme)[msg?.type || 'info'];

  // styles driven by reanimated
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: scale.value }],
    opacity: op.value,
    bottom: bottom.value - TOAST_SHADOW_PAD,
  }));

  const renderOverlay = useCallback(
    () => {
      if (!msg) return null;
      return (
        <View pointerEvents="none" style={styles.overlayRoot}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.portalContainer,
              aStyle,
            ]}
          >
            <View pointerEvents="none" style={styles.toastSurface}>
              <View pointerEvents="none" style={styles.toastShadow} />
              <View pointerEvents="none" style={[styles.toast, { backgroundColor: p.bg, borderColor: p.border }]}>
                <Text style={[styles.text, { color: p.fg }]}>{msg.text}</Text>
              </View>
            </View>
          </Animated.View>
        </View>
      );
    },
    [aStyle, msg, p.bg, p.border, p.fg],
  );

  return (
    <Ctx.Provider value={value}>
      <OverlayCtx.Provider value={renderOverlay}>
        {children}

        {msg ? (
          Platform.OS === 'ios' ? (
            <FullWindowOverlay>
              {renderOverlay()}
            </FullWindowOverlay>
          ) : (
            renderOverlay()
          )
        ) : null}
      </OverlayCtx.Provider>
    </Ctx.Provider>
  );
}

export function useToastOverlay() {
  return useContext(OverlayCtx);
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) return NOOP_TOAST_API;
  return c;
}

const { width } = Dimensions.get('window');
const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2147483647,
    elevation: 2147483647,
  },
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  portalContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    padding: TOAST_SHADOW_PAD,
    overflow: 'visible',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
  },
  toast: {
    width: '100%',
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  toastSurface: {
    width: Math.min(560, width - 24),
    overflow: 'visible',
  },
  toastShadow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.09)',
    transform: [{ translateY: 5 }, { scaleX: 0.97 }, { scaleY: 0.96 }],
  },
  text: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
});
