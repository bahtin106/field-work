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
  Switch,
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
import { Feather, AntDesign } from "@expo/vector-icons";
import * as NavigationBar from "expo-navigation-bar";
import { useTheme } from "../../theme";
import TextField, { SelectField } from "./TextField";
import UIButton from "./Button";

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

//
// Additional modal utilities and components
//

/*
 * Utility to apply alpha transparency to a color string. Supports hex and rgb formats.
 * This helper replicates the same logic used in edit.jsx to fade theme colors.
 */
function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

/*
 * Base styles generator for bottom‑sheet style modals. It mirrors the design
 * used in the existing SelectModal component: rounded corners, a drag handle,
 * consistent spacing and optional shadows depending on the platform.
 */
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

/*
 * A reusable bottom‑sheet modal component. It exposes a header with a title,
 * optional drag handle, a content area for arbitrary children and an optional
 * footer slot for action buttons. Tapping the backdrop or dragging the sheet
 * down will close it unless explicitly disabled via props. Animations use
 * react‑native‑reanimated for smooth appearance and dismissal.
 */
export function BaseModal({
  visible,
  onClose,
  title = '',
  children,
  footer = null,
  maxHeightRatio = 0.6,
  showHandle = true,
  disableBackdropClose = false,
  disablePanClose = false,
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => baseSheetStyles(theme), [theme]);
  const screenH = Dimensions.get('window').height;
  // Limit the sheet height to leave breathing room above
  const sheetMaxH = Math.max(
    220,
    Math.min(screenH * maxHeightRatio, screenH - (insets.top + 48)),
  );
  const overlayColor = theme.colors.overlay || 'rgba(0,0,0,0.35)';

  // Animation values for opacity and translationY
  const op = useSharedValue(0);
  const ty = useSharedValue(24);
  const sc = useSharedValue(1);

  // Open animation: fade in + slide up
  const open = () => {
    op.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    ty.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
  };

  // Close animation: slide down then invoke onClose via runOnJS
  const close = () => {
    const offY = Math.max(260, sheetMaxH * 0.9);
    ty.value = withTiming(offY, { duration: 200, easing: Easing.in(Easing.cubic) }, () => {
      if (typeof onClose === 'function') runOnJS(onClose)();
    });
    op.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) });
  };

  // Animated styles
  const aBackdrop = useAnimatedStyle(() => ({ opacity: op.value }));
  const aCard = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: sc.value }],
  }));

  // Pan responder for dragging to close
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
        if (shouldClose) {
          close();
        } else {
          ty.value = withSpring(0, { damping: 22, stiffness: 420, mass: 0.6 });
        }
      },
    }),
  ).current;

  // Lifecycle: when visible changes, reset animations and open
  useEffect(() => {
    if (visible) {
      op.value = 0;
      ty.value = 24;
      sc.value = 1;
      open();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // On Android, adjust navigation bar behaviour to avoid overlay issues
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
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

  return (
    <Modal
      visible={!!visible}
      transparent
      presentationStyle="overFullScreen"
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable
        style={s.backdrop}
        onPress={() => {
          if (!disableBackdropClose) close();
        }}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, aBackdrop, { backgroundColor: overlayColor }]}
        />
      </Pressable>

      {/* Bottom container */}
      <View
        style={[s.bottomWrap, { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md }]}
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
          {/* Header */}
          <View style={s.header}>
            <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>
              {title}
            </Text>
            <Pressable
              hitSlop={10}
              onPress={close}
              style={s.closeBtn}
              accessibilityLabel="Закрыть"
            >
              <Feather name="x" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          {/* Content */}
          <View style={{ paddingHorizontal: theme.spacing.lg }}>{children}</View>
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
}

/*
 * ConfirmModal displays a title, a message and two buttons: one for confirming
 * the action and one for cancelling/closing the modal. The confirm button
 * supports primary or destructive styling via the `confirmVariant` prop. The
 * loading flag allows caller to change the text while performing async work.
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Отмена',
  confirmVariant = 'primary',
  loading = false,
  onConfirm,
  onClose,
}) {
  const { theme } = useTheme();
  // Secondary (cancel) button uses a border and transparent background
  const cancelButton = (
    <Pressable
      onPress={onClose}
      style={({ pressed }) => [
        {
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 10,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: 'transparent',
          flex: 1,
        },
        pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
      ]}
    >
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>{cancelLabel}</Text>
    </Pressable>
  );
  // Confirm button delegates styling to UIButton for consistency
  const confirmButton = (
    <UIButton
      variant={confirmVariant}
      size="md"
      onPress={onConfirm}
      title={loading ? confirmLabel : confirmLabel}
    />
  );
  const footer = (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.md }}>
      {cancelButton}
      {confirmButton}
    </View>
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      maxHeightRatio={0.5}
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
          {message}
        </Text>
      </View>
    </BaseModal>
  );
}

/*
 * AlertModal is a simplified variant of ConfirmModal with a single primary
 * acknowledgment button. Use it for informational messages that require only
 * closing the modal.
 */
export function AlertModal({ visible, title, message, buttonLabel = 'Ок', onClose }) {
  const { theme } = useTheme();
  const footer = (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
      <UIButton variant="primary" size="md" onPress={onClose} title={buttonLabel} />
    </View>
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      maxHeightRatio={0.45}
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
          {message}
        </Text>
      </View>
    </BaseModal>
  );
}

/*
 * ActionSheetModal presents a list of actions and a cancel button. Each action
 * item can specify its visual variant: primary, secondary or destructive. When
 * an action is tapped the sheet closes and the action callback is invoked.
 */
export function ActionSheetModal({
  visible,
  title,
  actions = [],
  cancelLabel = 'Отмена',
  onClose,
}) {
  const { theme } = useTheme();
  const handleActionPress = (act) => {
    if (onClose) onClose();
    act.onPress?.();
  };
  // Render each action using appropriate styling; fallback to primary
  const content = (
    <View style={{ gap: theme.spacing.sm }}>
      {actions.map((act, idx) => {
        const variant = act.variant || 'primary';
        if (variant === 'primary' || variant === 'destructive') {
          return (
            <UIButton
              key={idx}
              variant={variant}
              size="md"
              onPress={() => handleActionPress(act)}
              title={act.label}
            />
          );
        }
        // Secondary: border and transparent background
        return (
          <Pressable
            key={idx}
            onPress={() => handleActionPress(act)}
            style={({ pressed }) => [
              {
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 10,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: 'transparent',
              },
              pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
            ]}
          >
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>{act.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const footer = (
    <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [
          {
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: 'transparent',
            flex: 1,
          },
          pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
        ]}
      >
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>{cancelLabel}</Text>
      </Pressable>
    </View>
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      maxHeightRatio={0.6}
      footer={footer}
    >
      {content}
    </BaseModal>
  );
}

/*
 * Wheel component used in the DatePickerModal. It renders a scrollable list of
 * values that snaps to discrete items, highlighting the selected item. The
 * implementation mirrors the wheel used in edit.jsx with subtle fixes.
 */
const ITEM_HEIGHT_DP = 44;
const VISIBLE_COUNT_DP = 5;
function Wheel({ data, index, onIndexChange, width, enabled = true, activeColor, inactiveColor }) {
  const { theme } = useTheme();
  const _activeColor = activeColor || theme.colors.primary;
  const listRef = useRef(null);
  const isSyncingRef = useRef(false);
  const [selIndex, setSelIndex] = useState(index ?? 0);
  useEffect(() => {
    const next = Math.max(0, Math.min(data.length - 1, index ?? 0));
    if (next !== selIndex) {
      setSelIndex(next);
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: next * ITEM_HEIGHT_DP, animated: false });
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 0);
    }
  }, [index, data.length]);
  useEffect(() => {
    if (selIndex > data.length - 1) {
      const next = data.length - 1;
      setSelIndex(next);
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: next * ITEM_HEIGHT_DP, animated: false });
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 0);
      onIndexChange?.(next);
    }
  }, [data.length]);
  const snapOffsets = useMemo(() => data.map((_, i) => i * ITEM_HEIGHT_DP), [data]);
  const onMomentumEnd = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const i = Math.round(y / ITEM_HEIGHT_DP);
    const clamped = Math.max(0, Math.min(data.length - 1, i));
    const target = clamped * ITEM_HEIGHT_DP;
    if (!isSyncingRef.current && Math.abs(target - y) > 0.5) {
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: target, animated: false });
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 0);
    }
    if (clamped !== selIndex) {
      setSelIndex(clamped);
      onIndexChange?.(clamped);
    }
  };
  return (
    <FlatList
      ref={listRef}
      data={data}
      keyExtractor={(_, i) => String(i)}
      renderItem={({ item, index: i }) => (
        <View style={[{ height: ITEM_HEIGHT_DP, justifyContent: 'center', alignItems: 'center' }, !enabled && { opacity: 0.35 }]}> 
          <Text
            style={[{ fontSize: 18, color: inactiveColor || theme.colors.textSecondary }, i === selIndex && { fontSize: 20, fontWeight: '700', color: _activeColor }]}
          >
            {item}
          </Text>
        </View>
      )}
      showsVerticalScrollIndicator={false}
      getItemLayout={(_, i) => ({ length: ITEM_HEIGHT_DP, offset: ITEM_HEIGHT_DP * i, index: i })}
      snapToOffsets={snapOffsets}
      snapToAlignment="center"
      decelerationRate={Platform.OS === 'ios' ? 0.995 : 0.985}
      bounces={false}
      overScrollMode="never"
      onMomentumScrollEnd={onMomentumEnd}
      initialNumToRender={VISIBLE_COUNT_DP + 2}
      scrollEventThrottle={16}
      style={{ width }}
      contentContainerStyle={{ paddingVertical: (ITEM_HEIGHT_DP * (VISIBLE_COUNT_DP - 1)) / 2 }}
      scrollEnabled={enabled}
      initialScrollIndex={Math.max(0, Math.min(data.length - 1, selIndex))}
      onScrollToIndexFailed={(info) => {
        const offset = Math.min(
          info.highestMeasuredFrameIndex * ITEM_HEIGHT_DP,
          info.averageItemLength * info.index,
        );
        listRef.current?.scrollToOffset({ offset, animated: false });
        setTimeout(() =>
          listRef.current?.scrollToIndex({
            index: info.index,
            animated: false,
            viewPosition: 0.5,
          }),
          0,
        );
      }}
    />
  );
}

/*
 * DatePickerModal displays three wheels for selecting day, month and year. A
 * toggle lets the user omit the year entirely. When the user confirms the
 * selection the onApply callback receives an object with day, month (1‑indexed)
 * and year (or null if omitted). The header automatically updates to show
 * the selected date in a short Russian format.
 */
export function DatePickerModal({
  visible,
  initialDate = null,
  onApply,
  onClose,
}) {
  const { theme } = useTheme();
  // Local state for the selected indices and whether to include the year
  const [withYear, setWithYear] = useState(true);
  const [dayIdx, setDayIdx] = useState(0);
  const [monthIdx, setMonthIdx] = useState(0);
  const [yearIdx, setYearIdx] = useState(0);

  // Helper functions to generate ranges and compute days per month
  const range = (a, b) => {
    const arr = [];
    for (let i = a; i <= b; i++) arr.push(i);
    return arr;
  };
  const daysInMonth = (month, yearNullable) => {
    if (month === 1 && yearNullable == null) return 29;
    const y = yearNullable ?? 2024;
    return new Date(y, month + 1, 0).getDate();
  };
  // Month abbreviations in Russian (nominative)
  const MONTHS_ABBR = [
    'янв.',
    'февр.',
    'март',
    'апр.',
    'май',
    'июн.',
    'июл.',
    'авг.',
    'сент.',
    'окт.',
    'нояб.',
    'дек.',
  ];
  const MONTHS_GEN = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];
  // Build the years list from 1900 to the current year, descending
  const years = useMemo(() => {
    const nowY = new Date().getFullYear();
    return range(1900, nowY).reverse();
  }, []);
  // Recompute days when month/year selection changes
  const days = useMemo(
    () => range(1, daysInMonth(monthIdx, withYear ? years[yearIdx] : null)),
    [monthIdx, yearIdx, withYear, years],
  );
  // When the picker becomes visible, initialize indices based on initialDate or current date
  useEffect(() => {
    if (visible) {
      const base = initialDate instanceof Date
        ? initialDate
        : initialDate
        ? new Date(initialDate)
        : new Date();
      const y = base.getFullYear();
      const m = base.getMonth();
      const d = base.getDate();
      const yIndex = years.indexOf(y);
      setYearIdx(yIndex >= 0 ? yIndex : 0);
      setMonthIdx(m);
      // default withYear to true if initialDate provided, false otherwise
      setWithYear(initialDate != null);
      const maxD = daysInMonth(m, years[yIndex >= 0 ? yIndex : 0]);
      setDayIdx(Math.max(0, Math.min(d - 1, maxD - 1)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialDate, years]);
  // Compute a nicely formatted header: e.g. "10 марта 1990" or "10 марта" if year omitted
  const headerTitle = useMemo(() => {
    const d = (dayIdx + 1).toString();
    const m = MONTHS_GEN[monthIdx] || '';
    if (!withYear) return `${d} ${m}`;
    return `${d} ${m} ${years[yearIdx]}`;
  }, [dayIdx, monthIdx, withYear, yearIdx, years]);
  // Width of each wheel based on the dialog width; match edit.jsx calculation
  const SCREEN_W = Dimensions.get('window').width;
  const DIALOG_W = Math.min(SCREEN_W * 0.85, 360);
  const WHEEL_W = (DIALOG_W - 32) / 3;

  // Handler when user confirms selection
  const handleApply = () => {
    const day = dayIdx + 1;
    const month = monthIdx + 1;
    const year = withYear ? years[yearIdx] : null;
    onApply?.({ day, month, year });
    onClose?.();
  };

  // Footer with Cancel and OK buttons
  const footer = (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [
          {
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: 'transparent',
            flex: 1,
          },
          pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
        ]}
      >
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>Отмена</Text>
      </Pressable>
      <UIButton variant="primary" size="md" onPress={handleApply} title="ОК" />
    </View>
  );

  // Styles specific to picker (selection lines and shading)
  const pickerStyles = {
    wheelsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
      height: ITEM_HEIGHT_DP * VISIBLE_COUNT_DP,
    },
    selectionLines: {
      position: 'absolute',
      left: 10,
      right: 10,
      top: (ITEM_HEIGHT_DP * (VISIBLE_COUNT_DP - 1)) / 2,
      height: ITEM_HEIGHT_DP,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: theme.colors.border,
    },
    dimTop: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      height: ITEM_HEIGHT_DP,
      backgroundColor: withAlpha(theme.colors.text, 0.06),
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    },
    dimBottom: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: ITEM_HEIGHT_DP,
      backgroundColor: withAlpha(theme.colors.text, 0.06),
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
    },
    yearSwitchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
      marginBottom: theme.spacing.sm,
    },
    yearSwitchLabel: { color: theme.colors.text, fontSize: 14 },
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={headerTitle}
      maxHeightRatio={0.65}
      footer={footer}
    >
      <View style={{ position: 'relative' }}>
        <View style={pickerStyles.wheelsRow}>
          <Wheel
            data={days.map(String)}
            activeColor={theme.colors.primary}
            inactiveColor={theme.colors.textSecondary}
            index={dayIdx}
            onIndexChange={setDayIdx}
            width={WHEEL_W}
          />
          <Wheel
            data={MONTHS_ABBR}
            activeColor={theme.colors.primary}
            inactiveColor={theme.colors.textSecondary}
            index={monthIdx}
            onIndexChange={(i) => {
              setMonthIdx(i);
              setDayIdx((d) => Math.min(d, daysInMonth(i, withYear ? years[yearIdx] : null) - 1));
            }}
            width={WHEEL_W}
          />
          <Wheel
            data={years.map(String)}
            activeColor={theme.colors.primary}
            inactiveColor={theme.colors.textSecondary}
            index={yearIdx}
            onIndexChange={setYearIdx}
            width={WHEEL_W}
            enabled={withYear}
          />
        </View>
        {/* Overlay lines and shading for selection indication */}
        <View pointerEvents="none" style={pickerStyles.selectionLines} />
        <View pointerEvents="none" style={pickerStyles.dimTop} />
        <View pointerEvents="none" style={pickerStyles.dimBottom} />
      </View>
      {/* Toggle for including year */}
      <View style={pickerStyles.yearSwitchRow}>
        <Text style={pickerStyles.yearSwitchLabel}>Указать год</Text>
        <Switch value={withYear} onValueChange={setWithYear} />
      </View>
    </BaseModal>
  );
}

/*
 * SuspendModal handles the workflow for suspending a user. It asks whether to
 * keep existing orders or reassign them to another employee. When reassign is
 * selected, a successor can be chosen via a SelectField. Validation errors
 * can be displayed by providing `successorError` and updating it via
 * setSuccessorError. The caller should manage `ordersAction` state.
 */
export function SuspendModal({
  visible,
  ordersAction,
  setOrdersAction,
  successor,
  successorError,
  setSuccessorError,
  openSuccessorPicker,
  onConfirm,
  saving = false,
  onClose,
}) {
  const { theme } = useTheme();
  // Radio control for selecting action
  const radioOption = (value, label) => {
    const selected = ordersAction === value;
    return (
      <Pressable
        onPress={() => {
          setOrdersAction(value);
          if (value === 'keep') setSuccessorError('');
        }}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 6,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            borderWidth: 2,
            borderColor: selected ? theme.colors.primary : theme.colors.border,
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 8,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: selected ? theme.colors.primary : 'transparent',
            }}
          />
        </View>
        <Text style={{ fontSize: 15, color: theme.colors.text }}>{label}</Text>
      </Pressable>
    );
  };
  // Footer with Cancel and Confirm buttons
  const footer = (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [
          {
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: 'transparent',
            flex: 1,
          },
          pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
        ]}
      >
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>Отмена</Text>
      </Pressable>
      <UIButton
        variant="primary"
        size="md"
        onPress={onConfirm}
        title={saving ? 'Применяю…' : 'Отстранить'}
      />
    </View>
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Отстранить сотрудника?"
      maxHeightRatio={0.7}
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
          Выберите, что сделать с его заявками.
        </Text>
      </View>
      <View style={{ gap: 10 }}>{radioOption('keep', 'Оставить как есть')}{radioOption('reassign', 'Переназначить на сотрудника')}</View>
      {ordersAction === 'reassign' ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '500', marginBottom: 4, color: theme.colors.textSecondary }}>
            Правопреемник
          </Text>
          <SelectField
            label="Правопреемник"
            value={successor?.name || 'Выберите сотрудника'}
            onPress={() => {
              openSuccessorPicker?.();
            }}
            right={<AntDesign name="search1" size={16} color={theme.colors.textSecondary} />}
            showValue
            style={successorError ? { borderColor: theme.colors.danger } : null}
          />
          {successorError ? (
            <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 4, marginLeft: 12 }}>
              {successorError}
            </Text>
          ) : null}
        </View>
      ) : null}
    </BaseModal>
  );
}

/*
 * DeleteEmployeeModal is similar to SuspendModal but always requires selecting a
 * successor. It highlights the destructive nature of the action and uses a
 * destructive styled confirm button.
 */
export function DeleteEmployeeModal({
  visible,
  successor,
  successorError,
  setSuccessorError,
  openSuccessorPicker,
  onConfirm,
  saving = false,
  onClose,
}) {
  const { theme } = useTheme();
  const footer = (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [
          {
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: 'transparent',
            flex: 1,
          },
          pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
        ]}
      >
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>Отмена</Text>
      </Pressable>
      <UIButton
        variant="primary"
        size="md"
        onPress={onConfirm}
        title={saving ? 'Удаляю…' : 'Удалить'}
      />
    </View>
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Удалить сотрудника?"
      maxHeightRatio={0.7}
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.danger, fontWeight: '600', marginBottom: 4 }}>
          Удалить сотрудника?
        </Text>
        <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
          Необходимо выбрать правопреемника, чтобы переназначить все его заявки.
        </Text>
      </View>
      <Text style={{ fontWeight: '500', marginTop: 8, marginBottom: 4, color: theme.colors.textSecondary }}>
        Правопреемник *
      </Text>
      <SelectField
        label="Правопреемник"
        value={successor?.name || 'Выберите сотрудника'}
        onPress={() => {
          openSuccessorPicker?.();
        }}
        right={<AntDesign name="search1" size={16} color={theme.colors.textSecondary} />}
        showValue
        style={successorError ? { borderColor: theme.colors.danger } : null}
      />
      {successorError ? (
        <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 4, marginLeft: 12 }}>
          {successorError}
        </Text>
      ) : null}
    </BaseModal>
  );
}

/*
 * AvatarSheetModal wraps ActionSheetModal for photo actions: take a photo,
 * pick from the library and optionally delete the existing avatar. A cancel
 * button is included automatically.
 */
export function AvatarSheetModal({
  visible,
  avatarUrl,
  onTakePhoto,
  onPickFromLibrary,
  onDeletePhoto,
  onClose,
}) {
  const actions = [
    { label: 'Сделать фото', onPress: onTakePhoto, variant: 'primary' },
    { label: 'Выбрать из галереи', onPress: onPickFromLibrary, variant: 'secondary' },
  ];
  if (avatarUrl) {
    actions.push({ label: 'Удалить фото', onPress: onDeletePhoto, variant: 'destructive' });
  }
  return (
    <ActionSheetModal
      visible={visible}
      title="Фото профиля"
      actions={actions}
      cancelLabel="Отмена"
      onClose={onClose}
    />
  );
}

/*
 * DepartmentSelectModal wraps the generic SelectModal to provide a list of
 * departments along with a "Без отдела" option. The selected item is shown
 * with a checkmark. Searching is disabled as departments are usually short.
 */
export function DepartmentSelectModal({
  visible,
  departmentId,
  departments = [],
  onSelect,
  onClose,
}) {
  const { theme } = useTheme();
  // Build items array with a null option first
  const items = useMemo(() => {
    const list = [];
    list.push({ id: null, label: 'Без отдела' });
    (departments || []).forEach((d) => {
      list.push({ id: d.id, label: d.name });
    });
    return list;
  }, [departments]);
  // Custom renderer to show check icons
  const renderItem = ({ item }) => {
    const selected = String(departmentId) === String(item.id);
    return (
      <Pressable
        onPress={() => {
          onSelect?.(item.id);
        }}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          },
          selected && {
            borderColor: theme.colors.primary,
            backgroundColor: withAlpha(theme.colors.primary, 0.12),
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text }}>{item.label}</Text>
        </View>
        <AntDesign
          name={selected ? 'checkcircle' : 'checkcircleo'}
          size={20}
          color={selected ? theme.colors.primary : theme.colors.border}
        />
      </Pressable>
    );
  };
  return (
    <SelectModal
      visible={visible}
      title="Выбор отдела"
      items={items}
      onSelect={(it) => {
        onSelect?.(it.id);
      }}
      onClose={onClose}
      searchable={false}
      maxHeightRatio={0.8}
      renderItem={renderItem}
    />
  );
}

/*
 * RoleSelectModal wraps SelectModal to provide a list of roles with descriptions
 * and a checkmark for the currently selected role. Both label and description
 * are supplied via props to keep the component generic.
 */
export function RoleSelectModal({
  visible,
  role,
  roles = [],
  roleLabels = {},
  roleDescriptions = {},
  onSelect,
  onClose,
}) {
  const { theme } = useTheme();
  const items = useMemo(() => {
    return roles.map((r) => ({ id: r, label: roleLabels[r] || r, subtitle: roleDescriptions[r] || '' }));
  }, [roles, roleLabels, roleDescriptions]);
  const renderItem = ({ item }) => {
    const selected = role === item.id;
    return (
      <Pressable
        onPress={() => {
          onSelect?.(item.id);
        }}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          },
          selected && {
            borderColor: theme.colors.primary,
            backgroundColor: withAlpha(theme.colors.primary, 0.12),
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text }}>{item.label}</Text>
          {item.subtitle ? (
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 }}>{item.subtitle}</Text>
          ) : null}
        </View>
        <AntDesign
          name={selected ? 'checkcircle' : 'checkcircleo'}
          size={20}
          color={selected ? theme.colors.primary : theme.colors.border}
        />
      </Pressable>
    );
  };
  return (
    <SelectModal
      visible={visible}
      title="Выбор роли"
      items={items}
      onSelect={(it) => {
        onSelect?.(it.id);
      }}
      onClose={onClose}
      searchable={false}
      maxHeightRatio={0.8}
      renderItem={renderItem}
    />
  );
}
