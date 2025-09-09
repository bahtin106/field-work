// components/ui/ToastProvider.jsx
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, Easing, Text, View, StyleSheet, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme";
const Ctx = createContext(null);

export default function ToastProvider({ children }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState(null);
  const timerRef = useRef(null);
  const isVisibleRef = useRef(false);
  const mountedRef = useRef(true);
  const y = useRef(new Animated.Value(12)).current;
  const op = useRef(new Animated.Value(0)).current;

  React.useEffect(() => () => { mountedRef.current = false; if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } }, []);

  const show = useCallback((text, type = "info") => {
    setMsg({ text, type });
    Animated.timing(y, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => {
      setTimeout(() => {
        Animated.timing(y, { toValue: 80, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => setMsg(null));
      }, 1800);
    });
  }, [y]);

  const value = { show, success: (t)=>show(t,"success"), error: (t)=>show(t,"error"), info: (t)=>show(t,"info") };

  const palette = (t) => ({
    info: { bg: t.colors.surface, fg: t.colors.text, border: t.colors.border },
    success: { bg: t.colors.surface, fg: t.colors.success, border: t.colors.success },
    error: { bg: t.colors.surface, fg: t.colors.danger, border: t.colors.danger },
  });

  const p = palette(theme)[msg?.type || "info"];
  return (
    <Ctx.Provider value={value}>
      {children}
      {msg ? (
        <Animated.View pointerEvents="none" style={[styles.container, { bottom: (insets?.bottom || 0) + theme.spacing.lg, transform: [{ translateY: y }] }]}>
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
  container: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 999 },
  toast: { minWidth: Math.min(560, width - 24), maxWidth: Math.min(560, width - 24), borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16 },
  text: { fontSize: 14, fontWeight: "500", textAlign: "center" },
});
