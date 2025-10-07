// components/ui/SelectModal.jsx
import React, { useEffect, useMemo, useRef, useState, useImperativeHandle } from "react";
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
import { t as T } from '../../src/i18n';

export default function SelectModal({
  visible,
  title = T('modal_select_title'),
  items = [],
  onSelect,
  onClose,
  searchable = true,
  renderItem,
  footer,
  initialSearch = "",
  maxHeightRatio = 0.75,
}, ref) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => styles(theme), [theme]);

  // Local RN Modal visibility to avoid unmount-while-visible race on Android
  const [rnVisible, setRnVisible] = useState(false);
  const [modalKey, setModalKey] = useState(0);
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

  // Анимации окна и бекдропа
  const op = useSharedValue(0);     // backdrop opacity
  const ty = useSharedValue(24);    // translateY для аккуратного «выезда»
  const sc = useSharedValue(1);     // без масштабирования

  const open = () => {
    if (!rnVisible) setRnVisible(true);
    op.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    ty.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
  };

  const close = () => {
    const offY = Math.max(260, sheetMaxH * 0.9);
    ty.value = withTiming(offY, { duration: 200, easing: Easing.in(Easing.cubic) });
    op.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) });
    
    // Используем setTimeout вместо runOnJS для гарантированного закрытия
    setTimeout(() => {
      setRnVisible(false);
      if (onClose) onClose();
    }, 250);
  };

  // expose imperative close() for external callers (e.g., Cancel button)
  useImperativeHandle(ref, () => ({ close }));


  const aBackdrop = useAnimatedStyle(() => ({ opacity: op.value }));
  const aCard = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: sc.value }],
  }));

  // Жест «потянуть вниз»
  const dragY = useRef(0);
  const pan = useRef(
    PanResponder.create({
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

  // Жизненный цикл - ОБНОВЛЕНО: обрабатываем как открытие, так и закрытие
  useEffect(() => {
    if (visible) {
      op.value = 0;
      ty.value = 24;
      sc.value = 1;
      open();
    } else {
      if (rnVisible) {
        close();
      }
    }
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

  // Равные небольшие отступы
  const sideGap = theme.spacing.md;
  const bottomGap = theme.spacing.md;

  // ОБНОВЛЕНО: упрощенная логика рендеринга
  if (!visible && !rnVisible) {
    return null;
  }

  return (
    <Modal
      key={modalKey}
      visible={!!rnVisible}
      transparent={true}
      presentationStyle="overFullScreen"
      animationType="none"
      statusBarTranslucent={true}
      navigationBarTranslucent={true}
      onRequestClose={close}
      onDismiss={() => {
        setRnVisible(false);
        try { onClose?.(); } catch (_) {}
      }}
    >
      {/* Backdrop */}
      <Pressable
        style={s.backdrop}
        onPress={close}
        pointerEvents={rnVisible ? "auto" : "none"}
      >
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
          {/* Drag handle */}
          <View style={s.handleHit} {...pan.panHandlers}>
            <View style={[s.handle, { backgroundColor: theme.colors.inputBorder }]} />
          </View>

          {/* Header */}
          <View style={s.header}>
            <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>
              {title}
            </Text>
            <Pressable hitSlop={10} onPress={close} style={s.closeBtn} accessibilityLabel={T('btn_close')}>
              <Feather name="x" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          {/* Search */}
          {searchable ? (
            <View style={{ paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.sm }}>
              <TextField
                label={T('common_search')}
                value={query}
                onChangeText={setQuery}
                placeholder={T('common_start_typing')}
                returnKeyType="search"
              />
            </View>
          ) : null}

          {/* List */}
          <FlatList
            data={data}
            keyExtractor={(it, i) => String(it.id ?? i)}
            renderItem={renderItem || renderDefaultItem}
            ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
            contentContainerStyle={{
  paddingHorizontal: theme.spacing.lg,
  paddingTop: theme.spacing.sm,
  paddingBottom: theme.spacing.lg,
}}
            style={{ flexGrow: 0 }}
            keyboardShouldPersistTaps="handled"
          />

          {/* Footer */}
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
    bottomWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "flex-end",
      alignItems: "center",
    },
    cardWrap: {
      width: "100%",
      borderRadius: t.radii.xl,
      borderWidth: 1,
      overflow: "hidden",
      ...(Platform.OS === "ios" ? t.shadows.card.ios : t.shadows.card.android),
    },
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
  paddingVertical: 10,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  borderWidth: 1,
  borderColor: t.colors.border,
  backgroundColor: t.colors.surface,
  borderRadius: 12,
},
    itemLeft: { flexDirection: "row", alignItems: "center", flex: 1, paddingRight: 8 },
    itemTitle: { fontSize: t.typography.sizes.md, fontWeight: "600" },
    itemSub: { marginTop: 2, fontSize: t.typography.sizes.sm },
    itemRight: { marginLeft: 8, alignSelf: "center" },
  });

function withAlpha(color, a) {
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
    handle: { width: 40, height: 5, borderRadius: 3 },
    header: {
      minHeight: 44,
      paddingHorizontal: t.spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontSize: t.typography.sizes.lg, fontWeight: '700' },
    closeBtn: { position: 'absolute', right: 8, top: 6, padding: 8, borderRadius: 16 },
  });

export const BaseModal = React.forwardRef(function BaseModal(
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
}, ref) {
  const modalRef = React.useRef(null);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => baseSheetStyles(theme), [theme]);
  // Local RN Modal visibility to prevent unmount-while-visible
  const [rnVisible, setRnVisible] = useState(false);
  const [modalKey, setModalKey] = useState(0);
const screenH = Dimensions.get('window').height;
  // Limit the sheet height to leave breathing room above
  const sheetMaxH = Math.max(
    220,
    Math.min(screenH * maxHeightRatio, screenH - (insets.top + 48)),
  );
  const overlayColor = theme.colors.overlay || 'rgba(0,0,0,0.35)';

   const op = useSharedValue(0);
  const ty = useSharedValue(24);
  const sc = useSharedValue(1);

  const open = () => {
    if (!rnVisible) setRnVisible(true);op.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    ty.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
  };

   const close = () => {
    const offY = Math.max(260, sheetMaxH * 0.9);
    ty.value = withTiming(offY, { duration: 200, easing: Easing.in(Easing.cubic) });
    op.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) });
    
    setTimeout(() => {
      setRnVisible(false);
      if (typeof onClose === 'function') onClose();
    }, 250);
  };
useImperativeHandle(ref, () => ({ close }));

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
  } else {
    if (rnVisible) {
      close();
    }
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
  // Unmount fully when closed to avoid ghost touch blocker on Android
if (!visible && !rnVisible) {
  return null;
}

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
  try { onClose?.(); } catch (_) {}
}}
    >
      {/* Backdrop */}
      <Pressable
  style={s.backdrop}
  onPress={() => {
    if (!disableBackdropClose) close();
  }}
  pointerEvents={rnVisible ? "auto" : "none"}
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
              accessibilityLabel={T('btn_close')}
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
);


export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = T('btn_ok'),
  cancelLabel = T('btn_cancel'),
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
   const confirmButton = (
    <UIButton
      variant={confirmVariant}
      size="md"
      onPress={() => {
        try { onClose?.(); } finally {
          setTimeout(() => { try { onConfirm?.(); } catch(_) {} }, 360);
        }
      }}
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

export function AlertModal({ visible, title, message, buttonLabel = T('btn_ok'), onClose }) {
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
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>{T('btn_cancel')}</Text>
      </Pressable>
      <UIButton
        variant="primary"
        size="md"
        onPress={onConfirm}
        title={saving ? T('btn_applying') : T('btn_suspend')}
      />
    </View>
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={T('dlg_suspend_title')}
      maxHeightRatio={0.7}
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
          {T('dlg_suspend_message')}
        </Text>
      </View>
      <View style={{ gap: 10 }}>{radioOption('keep', T('dlg_suspend_keep'))}{radioOption('reassign', T('dlg_suspend_reassign'))}</View>
      {ordersAction === 'reassign' ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '500', marginBottom: 4, color: theme.colors.textSecondary }}>{T('field_successor')}</Text>
          <SelectField
            label={T('field_successor')}
            value={successor?.name || T('placeholder_pick_employee')}
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
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>{T('btn_cancel')}</Text>
      </Pressable>
      <UIButton
        variant="primary"
        size="md"
        onPress={onConfirm}
        title={saving ? T('btn_deleting') : T('btn_delete')}
      />
    </View>
  );
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={T('dlg_delete_title')}
      maxHeightRatio={0.7}
      footer={footer}
    >
      <View style={{ marginBottom: theme.spacing.md }}>
        <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.danger, fontWeight: '600', marginBottom: 4 }}>
          Удалить сотрудника?
        </Text>
        <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
          {T('dlg_delete_msg')}
        </Text>
      </View>
      <Text style={{ fontWeight: '500', marginTop: 8, marginBottom: 4, color: theme.colors.textSecondary }}>{T('field_successor')} *</Text>
      <SelectField
        label={T('field_successor')}
        value={successor?.name || T('placeholder_pick_employee')}
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

/*
 * ActionSheetModal — простой Action Sheet на базе BaseModal.
 * Пропсы:
 *  - visible, title, actions: [{ label, onPress, variant: 'primary'|'secondary'|'destructive' }]
 *  - cancelLabel, onClose
 */
export function ActionSheetModal({
  visible,
  title = '',
  actions = [],
  cancelLabel = T('btn_cancel'),
  onClose,
}) {
  const { theme } = useTheme();
  const handleAction = (fn) => {
    try { onClose?.(); } finally {
      // Даем анимации закрытия завершиться, затем вызываем колбэк
      setTimeout(() => { try { fn?.(); } catch(_) {} }, 280);
    }
  };
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      maxHeightRatio={0.5}
    >
      <View style={{ gap: 10, marginBottom: theme.spacing.sm }}>
        {actions.map((a, idx) => (
          <UIButton
            key={idx}
            variant={a.variant || 'secondary'}
            size="md"
            title={a.label}
            onPress={() => handleAction(a.onPress)}
          />
        ))}
      </View>
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
          },
          pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
        ]}
      >
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>{cancelLabel}</Text>
      </Pressable>
    </BaseModal>
  );
}
export function AvatarSheetModal({
  visible,
  avatarUrl,
  onTakePhoto,
  onPickFromLibrary,
  onDeletePhoto,
  onClose,
}) {
  const actions = [
    { label: T('action_take_photo'), onPress: onTakePhoto, variant: 'primary' },
    { label: T('action_pick_photo'), onPress: onPickFromLibrary, variant: 'secondary' },
  ];
  if (avatarUrl) {
    actions.push({ label: T('action_delete_photo'), onPress: onDeletePhoto, variant: 'destructive' });
  }
  return (
    <ActionSheetModal
      visible={visible}
      title={T('title_profile_photo')}
      actions={actions}
      cancelLabel={T('btn_cancel')}
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
    list.push({ id: null, label: T('placeholder_department') });
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
            minHeight: 52,
            paddingVertical: 10,
            paddingHorizontal: 16,
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
          <Text style={{ fontSize: 16, color: theme.colors.text }}>{item.label}</Text>
        </View>
        {selected ? (
  <Feather name="check-circle" size={20} color={theme.colors.primary} />
) : (
  <Feather name="circle" size={20} color={theme.colors.border} />
)}
      </Pressable>
    );
  };
  return (
    <SelectModal
      visible={visible}
      title={T('picker_department_title')}
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
            minHeight: 52,
            paddingVertical: 10,
            paddingHorizontal: 16,
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
          <Text style={{ fontSize: 16, color: theme.colors.text }}>{item.label}</Text>
          {item.subtitle ? (
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 }}>{item.subtitle}</Text>
          ) : null}
        </View>
        {selected ? (
  <Feather name="check-circle" size={20} color={theme.colors.primary} />
) : (
  <Feather name="circle" size={20} color={theme.colors.border} />
)}
      </Pressable>
    );
  };
  return (
    <SelectModal
      visible={visible}
      title={T('picker_role_title')}
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
 * SingleSelectModal — универсальный список с чек‑маркером.
 * Пропсы: visible, title, options: [{id,label,subtitle,disabled}], selectedId, onSelect(id), onClose
 */
export function SingleSelectModal({ visible, title, options = [], selectedId, onSelect, onClose }) {
  const { theme } = useTheme();
  const renderItem = ({ item }) => {
    const selected = String(selectedId) === String(item.id);
    return (
      <Pressable
        onPress={() => onSelect?.(item.id)}
        disabled={!!item.disabled}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 52,
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            opacity: item.disabled ? 0.5 : 1,
          },
          selected && {
            borderColor: theme.colors.primary,
            backgroundColor: withAlpha(theme.colors.primary, 0.12),
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, color: theme.colors.text }}>{item.label}</Text>
          {item.subtitle ? (
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 }}>{item.subtitle}</Text>
          ) : null}
        </View>
        {selected ? (
  <Feather name="check-circle" size={20} color={theme.colors.primary} />
) : (
  <Feather name="circle" size={20} color={theme.colors.border} />
)}
      </Pressable>
    );
  };
  return (
    <SelectModal
      visible={visible}
      title={title}
      items={options}
      onSelect={(it) => onSelect?.(it.id)}
      onClose={onClose}
      searchable={false}
      maxHeightRatio={0.8}
      renderItem={renderItem}
    />
  );
}

/*
 * SwitchListModal — список переключателей в унифицированном стиле.
 * Пропсы: visible, title, toggles: [{id,label,value,onChange,disabled}], footer, onClose
 */
export function SwitchListModal({ visible, title, toggles = [], footer, onClose }) {
  const { theme } = useTheme();
  return (
    <BaseModal visible={visible} onClose={onClose} title={title} maxHeightRatio={0.8} footer={footer}>
      <View style={{ gap: 8, marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
        {toggles.map((t) => (
          <View
            key={String(t.id)}
            style={{
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: 52,
  paddingVertical: 1,
  paddingHorizontal: 12,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surface,
  opacity: t.disabled ? 0.5 : 1,
}}
          >
            <Text style={{ fontSize: 16, color: theme.colors.text, flex: 1, paddingRight: 8 }}>
              {t.label}
            </Text>
            <Switch
              value={!!t.value}
              onValueChange={t.onChange}
              disabled={!!t.disabled}
            />
          </View>
        ))}
      </View>
    </BaseModal>
  );
}


/*
 * DateTimeModal — универсальный выбор даты/времени.
 * Режимы: mode="date" | "time" | "datetime"
 * Пропсы:
 *  - visible, onClose, onApply(Date)
 *  - initial: Date | string | number (по умолчанию — сейчас)
 *  - mode: 'date' | 'time' | 'datetime'
 *  - minuteStep: 1..30 (по умолчанию 5)
 *
 * Ничего из старых модалок не трогаем — это новый самостоятельный компонент.
 * Стилистика и поведение соответствуют остальным модалкам (BaseModal).
 */
export function DateTimeModal({
  visible,
  onClose,
  onApply,
  initial = null,
  mode = 'datetime',
  minuteStep = 5,
  allowOmitYear = false,
  omitYearDefault = true,
  omitYearLabel = T('datetime_omit_year'),
}) {
  const modalRef = React.useRef(null);

  const { theme } = useTheme();
  const [contentW, setContentW] = React.useState(0);

  // --- helpers ---
  const clampStep = (n, step) => Math.max(1, Math.min(30, Math.floor(step || 5)));
  const step = clampStep(minuteStep, minuteStep);
  const range = (a,b) => { const r=[]; for(let i=a;i<=b;i++) r.push(i); return r; };
  const pad2 = (n) => String(n).padStart(2,'0');

  const parseInitial = (v) => {
    if (v instanceof Date && !isNaN(v)) return new Date(v.getTime());
    if (typeof v === 'string' || typeof v === 'number') {
      const d = new Date(v);
      if (!isNaN(d)) return d;
    }
    return new Date();
  };
  const baseDate = parseInitial(initial);

  // --- state for DATE ---
  const MONTHS_ABBR = ['янв.','февр.','март','апр.','май','июн.','июл.','авг.','сент.','окт.','нояб.','дек.'];
  const MONTHS_GEN  = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const daysInMonth = (m, yNullable) => {
    if (m === 1 && (yNullable == null)) return 29;
    const y = yNullable ?? baseDate.getFullYear();
    return new Date(y, m + 1, 0).getDate();
  };
  const years = React.useMemo(() => { const y = new Date().getFullYear(); return range(1900, y+10); }, []);
  const [dYearIdx, setDYearIdx] = React.useState(0);
  const [dMonthIdx, setDMonthIdx] = React.useState(0);
  const [dDayIdx, setDDayIdx] = React.useState(0);
  // возможность отключить год (для ДР)
  const [withYear, setWithYear] = React.useState(omitYearDefault);
  const days = React.useMemo(() => range(1, daysInMonth(dMonthIdx, withYear ? (years[dYearIdx] || baseDate.getFullYear()) : null)), [dMonthIdx, dYearIdx, years, withYear]);

  // --- state for TIME ---
  const minutesData = React.useMemo(() => range(0, 59).filter(m => m % step === 0), [step]);
  const [tHourIdx, setTHourIdx] = React.useState(0);
  const [tMinuteIdx, setTMinuteIdx] = React.useState(0);

  // tab for datetime mode
  const [tab, setTab] = React.useState('date'); // 'date' | 'time'

  // init on open
  React.useEffect(() => {
    if (!visible) return;
    const y = years.indexOf(baseDate.getFullYear()); setDYearIdx(y >= 0 ? y : 0);
    setWithYear(allowOmitYear ? omitYearDefault : true);
    setDMonthIdx(baseDate.getMonth());
    const maxD = daysInMonth(baseDate.getMonth(), baseDate.getFullYear());
    setDDayIdx(Math.max(0, Math.min(baseDate.getDate()-1, maxD-1)));
    setTHourIdx(baseDate.getHours());
    const mi = Math.round(baseDate.getMinutes() / step);
    const minuteVal = Math.min(59, mi*step);
    const mIdx = minutesData.indexOf(minuteVal);
    setTMinuteIdx(mIdx >= 0 ? mIdx : 0);
    setTab('date');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // header text
  const header = React.useMemo(() => {
    const d = (dDayIdx+1), mName = MONTHS_GEN[dMonthIdx] || '', y = years[dYearIdx] || baseDate.getFullYear();
    const hh = pad2(tHourIdx), mm = pad2(minutesData[tMinuteIdx] ?? 0);
    if (mode === 'date') return withYear ? `${d} ${mName} ${y}` : `${d} ${mName}`;
    if (mode === 'time') return `${hh}:${mm}`;
    // datetime
    return withYear ? `${d} ${mName} ${y}, ${hh}:${mm}` : `${d} ${mName}, ${hh}:${mm}`;
  }, [mode, dDayIdx, dMonthIdx, dYearIdx, years, tHourIdx, tMinuteIdx, minutesData]);

  // calc wheel width
  const innerGap = 8;
  const W3 = Math.max(64, contentW > 0 ? (contentW - innerGap * 2) / 3 : 0);
  const W2 = Math.max(64, contentW > 0 ? (contentW - innerGap) / 2 : 0);

  // apply
  const handleApply = () => {
    const year  = years[dYearIdx] || baseDate.getFullYear();
    const month = dMonthIdx; // 0-index
    const day   = dDayIdx + 1;
    const hour  = tHourIdx;
    const min   = minutesData[tMinuteIdx] ?? 0;
    let out;
    if (mode === 'date') out = new Date(year, month, day, 0, 0, 0, 0);
    else if (mode === 'time') {
      const now = new Date();
      out = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, 0, 0);
    } else {
      out = new Date(year, month, day, hour, min, 0, 0);
    }
    onApply?.(out, { withYear, day: dDayIdx + 1, month: dMonthIdx + 1, year: withYear ? (years[dYearIdx] || baseDate.getFullYear()) : null });
    onClose?.();
  };

  // footer
  const footer = (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      <Pressable
        onPress={() => modalRef.current?.close()}
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
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>{T('btn_cancel')}</Text>
      </Pressable>
      <UIButton variant="primary" size="md" onPress={handleApply} title={T('btn_ok')} />
    </View>
  );

  // segmented for datetime
  const Segmented = () => (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, overflow: 'hidden', marginBottom: theme.spacing.sm }}>
      {['date','time'].map((k) => {
        const active = tab === k;
        return (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            style={({ pressed }) => [
              { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: active ? withAlpha(theme.colors.primary, 0.12) : theme.colors.surface },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={{ color: active ? theme.colors.primary : theme.colors.textSecondary, fontWeight: active ? '700' : '500' }}>
              {k === 'date' ? T('datetime_tab_date') : T('datetime_tab_time')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <BaseModal ref={modalRef} visible={visible} onClose={onClose} title={header} maxHeightRatio={0.65} footer={footer}>
      <View onLayout={(e)=>setContentW(e.nativeEvent.layout.width)}>
        {mode === 'datetime' ? <Segmented /> : null}

        {(mode === 'date' || (mode === 'datetime' && tab === 'date')) ? (
          <>

          <View style={{ position:'relative', marginBottom: 10 }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', gap: innerGap, height: ITEM_HEIGHT_DP * VISIBLE_COUNT_DP }}>
              <Wheel
                data={range(1, daysInMonth(dMonthIdx, withYear ? (years[dYearIdx] || baseDate.getFullYear()) : null)).map(String)}
                activeColor={theme.colors.primary}
                inactiveColor={theme.colors.textSecondary}
                index={dDayIdx}
                onIndexChange={setDDayIdx}
                width={W3}
              />
              <Wheel
                data={MONTHS_ABBR}
                activeColor={theme.colors.primary}
                inactiveColor={theme.colors.textSecondary}
                index={dMonthIdx}
                onIndexChange={(i) => {
                  setDMonthIdx(i);
                  setDDayIdx((d) => Math.min(d, daysInMonth(i, withYear ? (years[dYearIdx] || baseDate.getFullYear()) : null) - 1));
                }}
                width={W3}
              />
              <Wheel
                data={years.map(String)}
                activeColor={theme.colors.primary}
                inactiveColor={theme.colors.textSecondary}
                index={dYearIdx}
                onIndexChange={setDYearIdx}
                width={W3}
                enabled={withYear}
              />
            </View>
            <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, top:(ITEM_HEIGHT_DP*(VISIBLE_COUNT_DP-1))/2, height:ITEM_HEIGHT_DP, backgroundColor: withAlpha(theme.colors.primary, 0.06), borderWidth:1, borderColor: withAlpha(theme.colors.primary, 0.22), borderRadius:12 }} />
          </View>

          {(allowOmitYear && (mode === 'date' || (mode === 'datetime' && tab === 'date'))) ? (
            <View style={{
              flexDirection:'row',
              alignItems:'center',
              justifyContent:'space-between',
              marginTop: theme.spacing.sm,
              paddingHorizontal: 4,
              paddingLeft: 12,  // nudge text right for nicer alignment
              paddingVertical: 6,
            }}>
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>
                {omitYearLabel}
              </Text>
              <View style={{ width: 12 }} />
              <Switch value={withYear} onValueChange={setWithYear} />
            </View>
          ) : null}

        </>
        ) : null}

        {(mode === 'time' || (mode === 'datetime' && tab === 'time')) ? (
          <>

          <View style={{ position:'relative', marginBottom: 10 }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', gap: innerGap, height: ITEM_HEIGHT_DP * VISIBLE_COUNT_DP }}>
              <Wheel
                data={range(0,23).map((n)=>pad2(n))}
                activeColor={theme.colors.primary}
                inactiveColor={theme.colors.textSecondary}
                index={tHourIdx}
                onIndexChange={setTHourIdx}
                width={W2}
              />
              <Wheel
                data={minutesData.map((n)=>pad2(n))}
                activeColor={theme.colors.primary}
                inactiveColor={theme.colors.textSecondary}
                index={tMinuteIdx}
                onIndexChange={setTMinuteIdx}
                width={W2}
              />
            </View>
            <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, top:(ITEM_HEIGHT_DP*(VISIBLE_COUNT_DP-1))/2, height:ITEM_HEIGHT_DP, backgroundColor: withAlpha(theme.colors.primary, 0.06), borderWidth:1, borderColor: withAlpha(theme.colors.primary, 0.22), borderRadius:12 }} />
          </View>

          {(allowOmitYear && (mode === 'date' || (mode === 'datetime' && tab === 'date'))) ? (
            <View style={{
              flexDirection:'row',
              alignItems:'center',
              justifyContent:'space-between',
              marginTop: theme.spacing.sm,
              paddingHorizontal: 4,
              paddingLeft: 12,  // nudge text right for nicer alignment
              paddingVertical: 6,
            }}>
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>
                {omitYearLabel}
              </Text>
              <View style={{ width: 12 }} />
              <Switch value={withYear} onValueChange={setWithYear} />
            </View>
          ) : null}

        </>
          ) : null}
      </View>
    </BaseModal>
  );
}
