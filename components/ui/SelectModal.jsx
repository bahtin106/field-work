// components/ui/SelectModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Dimensions,
  PanResponder,
  FlatList,
  Platform,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as NavigationBar from "expo-navigation-bar";
import { useTheme } from "../../theme";
import TextField from "./TextField";

export default function SelectModal({
  visible,
  title = "Выберите",
  items = [],
  onSelect,
  onClose,
  searchable = true,
  renderItem,
  footer,
  initialSearch = "",
  maxHeightRatio = 0.75,
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(theme), [theme]);

  const overlayColor = theme.colors.overlay || "rgba(0,0,0,0.35)";
  const screen = Dimensions.get("window");
  const screenH = screen.height;

  // Максимальная высота внутреннего контента
  const sheetMaxH = Math.max(
    280,
    Math.min(screenH * maxHeightRatio, screenH - (insets.top + 48))
  );

  // Поиск/фильтр
  const [query, setQuery] = useState(initialSearch);
  useEffect(() => {
    if (!visible) setQuery(initialSearch || "");
  }, [visible, initialSearch]);

  const data = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(
      (it) =>
        String(it.label || "").toLowerCase().includes(q) ||
        String(it.subtitle || "").toLowerCase().includes(q)
    );
  }, [items, query]);

  // Анимации окна и бекдропа — компактный выезд снизу
  const op = useSharedValue(0);     // backdrop opacity
  const ty = useSharedValue(24);    // translateY для аккуратного «выезда»
  const sc = useSharedValue(1);     // без масштабирования — чтобы не было «разболтанности»

  const open = () => {
    // быстрый аккуратный вход: fade + slide-up
    op.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    ty.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
    // scale не трогаем (оставляем 1)
  };

  const close = () => {
    // Закрытие — аккуратный слайд вниз (как было раньше по ощущениям), без рывка наверх
    const offY = Math.max(260, sheetMaxH * 0.9);
    ty.value = withTiming(offY, { duration: 200, easing: Easing.in(Easing.cubic) }, () => {
      runOnJS(onClose)();
    });
    op.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) });
  };

  const aBackdrop = useAnimatedStyle(() => ({ opacity: op.value }));
  const aCard = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: sc.value }],
  }));

  // Жест «потянуть вниз» — надёжный захват на хэндле
  const dragY = useRef(0);
  const pan = useRef(
    PanResponder.create({
      // Сразу отдаём жест хэндлу — чтобы «не работает» больше не повторялось
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > Math.abs(g.dx) && Math.abs(g.dy) > 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragY.current = 0;
      },
      onPanResponderMove: (_e, g) => {
        const dy = Math.max(0, g.dy);
        dragY.current = dy;
        // Лёгкая податливость без расхлябанности
        ty.value = dy * 0.85;
      },
      onPanResponderRelease: (_e, g) => {
        const shouldClose = g.vy > 1.0 || dragY.current > sheetMaxH * 0.22;
        if (shouldClose) {
          close();
        } else {
          ty.value = withSpring(0, { damping: 22, stiffness: 420, mass: 0.6 });
        }
      },
    })
  ).current;

  // Жизненный цикл
  useEffect(() => {
    if (visible) {
      op.value = 0;
      ty.value = 24;
      sc.value = 1;
      open();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Android nav bar overlay
  useEffect(() => {
    if (Platform.OS !== "android") return;
    (async () => {
      try {
        if (visible) {
          await NavigationBar.setBehaviorAsync("overlay-swipe");
          await NavigationBar.setBackgroundColorAsync("transparent");
          await NavigationBar.setButtonStyleAsync(theme.mode === "dark" ? "light" : "dark");
        } else {
          await NavigationBar.setBehaviorAsync("inset-swipe");
          await NavigationBar.setBackgroundColorAsync("transparent");
          await NavigationBar.setButtonStyleAsync(theme.mode === "dark" ? "light" : "dark");
        }
      } catch {}
    })();
  }, [visible, theme.mode]);

  // Рендер строки по-умолчанию
  const renderDefaultItem = ({ item }) => {
    const disabled = !!item.disabled;
    return (
      <Pressable
        onPress={() => !disabled && onSelect?.(item)}
        disabled={disabled}
        android_ripple={{ color: theme.colors.ripple }}
        style={({ pressed }) => [
          s.item,
          { opacity: disabled ? 0.5 : 1 },
          pressed && Platform.OS === "ios"
            ? { backgroundColor: theme.colors.ripple }
            : null,
        ]}
      >
        <View style={s.itemLeft}>
          {item.icon ? (
            <View style={{ marginRight: theme.spacing.sm }}>{item.icon}</View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[s.itemTitle, { color: theme.colors.text }]}>
              {item.label}
            </Text>
            {item.subtitle ? (
              <Text
                numberOfLines={1}
                style={[s.itemSub, { color: theme.colors.textSecondary }]}
              >
                {item.subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={s.itemRight}>
          {item.right ? (
            item.right
          ) : (
            <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
          )}
        </View>
      </Pressable>
    );
  };

  // Равные небольшие отступы слева/справа/снизу
  const sideGap = theme.spacing.md;
  const bottomGap = theme.spacing.md;

  return (
    <Modal
      visible={!!visible}
      transparent={true}
      presentationStyle="overFullScreen"
      animationType="none"
      statusBarTranslucent={true}
      navigationBarTranslucent={true}
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable style={s.backdrop} onPress={close}>
        <Animated.View
          style={[StyleSheet.absoluteFill, aBackdrop, { backgroundColor: overlayColor }]}
        />
      </Pressable>

      {/* Container у нижнего края */}
      <View style={[s.bottomWrap, { paddingHorizontal: sideGap, paddingBottom: bottomGap }]} pointerEvents="box-none">
        <Animated.View
          style={[
            s.cardWrap,
            aCard,
            {
              alignSelf: "stretch",
              maxHeight: sheetMaxH,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
        >
          {/* Drag handle — именно на нём жест */}
          <View style={s.handleHit} {...pan.panHandlers}>
            <View style={[s.handle, { backgroundColor: theme.colors.inputBorder }]} />
          </View>

          {/* Header */}
          <View style={s.header}>
            <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>
              {title}
            </Text>
            <Pressable hitSlop={10} onPress={close} style={s.closeBtn} accessibilityLabel="Закрыть">
              <Feather name="x" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          {/* Search */}
          {searchable ? (
            <View style={{ paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.sm }}>
              <TextField
                label="Поиск"
                value={query}
                onChangeText={setQuery}
                placeholder="Начните вводить…"
                returnKeyType="search"
              />
            </View>
          ) : null}

          {/* List */}
          <FlatList
            data={data}
            keyExtractor={(it, i) => String(it.id ?? i)}
            renderItem={renderItem || renderDefaultItem}
            ItemSeparatorComponent={() => (
              <View style={[s.separator, { backgroundColor: theme.colors.border }]} />
            )}
            contentContainerStyle={{ paddingBottom: theme.spacing.md }}
            style={{ flexGrow: 0 }}
            keyboardShouldPersistTaps="handled"
          />

          {/* Footer (optional buttons) */}
          {footer ? (
            <View style={{ paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.sm }}>
              {footer}
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = (t) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject },
    // Был center, теперь у нижнего края
    bottomWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "flex-end",
      alignItems: "center",
    },
    // Окно с закруглением всех углов
    cardWrap: {
      width: "100%",
      borderRadius: t.radii.xl,
      borderWidth: 1,
      overflow: "hidden",
      ...(Platform.OS === "ios" ? t.shadows.card.ios : t.shadows.card.android),
    },
    // Увеличенная зона для удобного захвата жеста
    handleHit: {
      alignItems: "center",
      paddingVertical: t.spacing.md,
    },
    handle: { width: 48, height: 5, borderRadius: 3 },
    header: {
      minHeight: 44,
      paddingHorizontal: t.spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontSize: t.typography.sizes.lg, fontWeight: "700" },
    closeBtn: { position: "absolute", right: 8, top: 6, padding: 8, borderRadius: 16 },
    separator: { height: 1, opacity: 0.6, marginHorizontal: t.spacing.lg },
    item: {
      minHeight: 52,
      paddingHorizontal: t.spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    itemLeft: { flexDirection: "row", alignItems: "center", flex: 1, paddingRight: 8 },
    itemTitle: { fontSize: t.typography.sizes.md, fontWeight: "600" },
    itemSub: { marginTop: 2, fontSize: t.typography.sizes.sm },
    itemRight: { marginLeft: 8, alignSelf: "center" },
  });
