// components/ui/ToastProvider.jsx
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Text, View, StyleSheet, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme";
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
  const [anchorOffset, setAnchorOffset] = useState(120);

  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  const visibleRef = useRef(false);

  // Reanimated shared values
  const ty = useSharedValue(20);    // translateY
  const op = useSharedValue(0);     // opacity

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const endHide = () => { visibleRef.current = false; setMsg(null); };

  const hide = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    // плавное скрытие вниз + фейд
    ty.value = withTiming(20, { duration: 200, easing: Easing.in(Easing.quad) });
    op.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (finished) => { if (!mountedRef.current) return; runOnJS(endHide)(); });
  }, [ty, op]);

  const show = useCallback((text, type = "info") => {
    // если уже показан — обновим текст и продлим таймер без повторного "въезда"
    if (visibleRef.current) {
      setMsg({ text, type });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(hide, 1800);
      return;
    }

    visibleRef.current = true;
    setMsg({ text, type });

    // стартовые значения
    ty.value = 20;
    op.value = 0;

    // въезд: чуть подпрыгивает, как в iOS
    ty.value = withSpring(0, { mass: 0.7, damping: 16, stiffness: 180 });
    op.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(hide, 1800);
  }, [ty, op, hide]);

  const value = {
    show,
    hide,
    setAnchorOffset,
    success: (t) => show(t, "success"),
    error:   (t) => show(t, "error"),
    info:    (t) => show(t, "info"),
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
        <Animated.View
  pointerEvents="box-none"
  style={[
    styles.container,
    aStyle,
    { bottom: (insets?.bottom || 0) + anchorOffset },
  ]}
>
          <View style={[styles.toast, { backgroundColor: p.bg, borderColor: p.border }]}>
            <Text style={[styles.text, { color: p.fg }]}>{msg.text}</Text>
          </View>
        </Animated.View>
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
