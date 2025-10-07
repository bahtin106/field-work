// components/ui/ToastProvider.jsx
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Text, View, StyleSheet, Dimensions, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme";
// --- i18n labels (safe runtime require) ---
let __labels = null;
try { __labels = require('../../i18n/labels'); } catch (_) {}
const i18nT = (key, fallback) => {
  const mod = __labels || {};
  if (typeof mod.t === 'function') return mod.t(key, fallback);
  if (typeof mod.getLabel === 'function') return mod.getLabel(key, fallback);
  const dict = mod.labels || mod.default || mod || {};
  const val = String(key).split('.').reduce((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), dict);
  return (val == null || val === '') ? (fallback ?? key) : String(val);
};

import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from "react-native-reanimated";

const Ctx = createContext(null);

export default function ToastProvider({ children }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [msg, setMsg] = useState(null);         // { text, type }
  const [anchorOffset, setAnchorOffset] = useState(theme.components?.toast?.anchorOffset ?? 120);

  const timerRef = useRef(null);
  const mounted = useSharedValue(true);
  const visibleRef = useRef(false);

  // Reanimated shared values
  const ty = useSharedValue(20);    // translateY
  const op = useSharedValue(0);     // opacity

  useEffect(() => {
    return () => {
      mounted.value = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const endHide = () => { visibleRef.current = false; setMsg(null); };

  const hide = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    // плавное скрытие вниз + фейд
    ty.value = withTiming(20, { duration: 200, easing: Easing.in(Easing.quad) });
    op.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (finished) => { if (!mounted.value) return; runOnJS(endHide)(); });
  }, [ty, op]);

  const show = useCallback((text, type = "info", opts = {}) => {
    const { sticky = false, duration = 1800 } = opts || {};
    // If already visible: update text/type and (re)arm timer depending on sticky
    if (visibleRef.current) {
      setMsg({ text, type });
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (!sticky) timerRef.current = setTimeout(hide, duration);
      return;
    }
    // First show: set visible and play enter animation
    visibleRef.current = true;
    setMsg({ text, type });
    ty.value = 20;
    op.value = 0;
    ty.value = withSpring(0, { mass: 0.7, damping: 16, stiffness: 180 });
    op.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!sticky) timerRef.current = setTimeout(hide, duration);
  }, [ty, op, hide]);

  const value = {
    show,
    hide,
    setAnchorOffset,
    success: (t) => show(t, "success"),
    error:   (t) => show(t, "error"),
    info:    (t) => show(t, "info"),
    loading: (text) => show(text ?? i18nT('toast.loading', 'Сохраняю…'), 'info', { sticky: true }),
    promise: (p, m = {}) => {
      const { loading = i18nT('toast.loading', 'Сохраняю…'), success = i18nT('toast.success', 'Сохранено'), error = i18nT('toast.error', 'Не удалось выполнить действие') } = m || {};
      show(loading, 'info', { sticky: true });
      const run = typeof p === 'function' ? p() : p;
      return Promise.resolve(run)
        .then((res) => { show(typeof success === 'function' ? success(res) : success, 'success'); return res; })
        .catch((e) => { show(typeof error === 'function' ? error(e) : (e?.message || error), 'error'); throw e; });
    },
  };

  const palette = (t) => ({
    info:    { bg: t.colors.surface, fg: t.colors.text,    border: t.colors.border },
    success: { bg: t.colors.surface, fg: t.colors.success, border: t.colors.success },
    error:   { bg: t.colors.surface, fg: t.colors.danger,  border: t.colors.danger },
  });
  const p = palette(theme)[msg?.type || "info"];

  // styles driven by reanimated
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
    opacity: op.value,
  }));

  return (
    <Ctx.Provider value={value}>
      {children}
      

{msg ? (
  <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.portalContainer,
        aStyle,
        { bottom: (insets?.bottom || 0) + anchorOffset },
      ]}
    >
      <View style={[styles.toast, { backgroundColor: p.bg, borderColor: p.border }]}>
        <Text style={[styles.text, { color: p.fg }]}>{msg?.text}</Text>
      </View>
    </Animated.View>
  </View>
) : null}

    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used within ToastProvider");
  return c;
}

const { width } = Dimensions.get("window");
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0, right: 0,
    alignItems: "center",
    zIndex: 999,
  },
  portalContainer: {
    position: "absolute",
    left: 0, right: 0,
    alignItems: "center",
    zIndex: 1000,
  },
  modalContainer: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
    zIndex: 1000,

  },
  toast: {
    minWidth: Math.min(560, width - 24),
    maxWidth: Math.min(560, width - 24),
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  text: { fontSize: 14, fontWeight: "500", textAlign: "center" },
});
