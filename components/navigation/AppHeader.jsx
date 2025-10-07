// components/navigation/AppHeader.jsx
import React, { useRef } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { useNavigation, usePathname, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { useCapsuleFeedback } from "../../theme/ThemeProvider";
// alpha utility (consistent with SelectModal): supports #RRGGBB and rgb(R,G,B)
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


// Человеческие заголовки для часто используемых экранов
import { getRouteTitle } from '../../constants/routeTitles';
import { t as T } from '../../src/i18n';

function resolveTitle(options, route, pathnameRaw) {
  // 1) Явный заголовок: params -> options
  const directRaw = route?.params?.title ?? route?.params?.headerTitle ?? options?.title ?? options?.headerTitle;
  // Важно: различаем undefined и пустую строку/плейсхолдер
  if (directRaw !== undefined) {
  const v = String(directRaw ?? '');
  const noName = String(T?.('placeholder_no_name', 'Без имени'));
  if (!v || v === noName) return '';
  return v;
}

  const name = route?.name || '';
  const pathname = pathnameRaw || '';

  // Спец-случай: экран редактирования — показываем понятный заголовок
  if (typeof pathname === 'string' && pathname.includes('/edit')) {
  if (directRaw === undefined) return (globalThis?.S?.('edit_title') ?? 'Редактирование');
}

  // Для страниц сотрудника скрываем автозаголовок до прихода данных
  if (pathname.startsWith('/users/')) return '';

  // 2) по имени роута через централизованный словарь
const titleByName = getRouteTitle(name);
if (titleByName) return titleByName;

  // 3) по пути через централизованный словарь
const titleByPath = getRouteTitle(pathname.replace(/^\//, ''));
if (titleByPath) return titleByPath;

  // 4) дефолт: имя роута или пусто
  return name || '';
}

export default function AppHeader({ options = {}, back, route }) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const pathname = usePathname?.() || "";

  const title = resolveTitle(options, route, pathname);  const backLabel = options?.headerBackTitle ?? route?.params?.headerBackTitle;
  const wantCenterTitle = options?.headerTitleAlign === 'center' || route?.params?.centerTitle === true;
  const onBack = () => {
    try {
      if (route?.params?.onBackPress && typeof route.params.onBackPress === 'function') {
        route.params.onBackPress();
        return;
      }
    } catch (e) {}
    nav.goBack();
  };

  const { onPressIn: onLeftIn, onPressOut: onLeftOut, containerStyle: leftCapsuleAnim } = useCapsuleFeedback();
const { onPressIn: onRightIn, onPressOut: onRightOut, containerStyle: rightCapsuleAnim, overlayStyle: rightCapsuleOverlay } = useCapsuleFeedback();

  
  const rightLabel = options?.rightTextLabel ?? route?.params?.rightTextLabel;
const rightPress =
  options?.onRightPress ??
  route?.params?.onRightPress ??
  (route?.params?.headerButtonTo ? () => router.push(route.params.headerButtonTo) : undefined);

// ---- Анимации для кнопки "назад": масштаб + затемнённый кружок ----
  const scale = useRef(new Animated.Value(1)).current;
  const tint = useRef(new Animated.Value(0)).current; // 0 -> прозрачно, 1 -> тёмный кружок

  const onPressIn = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 0.96, useNativeDriver: true }),
      Animated.timing(tint, { toValue: 1, duration: 120, useNativeDriver: false }),
    ]).start();
  };
 const onPressOut = () => {
  Animated.parallel([
    Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: true }),
    Animated.timing(tint, { toValue: 0, duration: 120, useNativeDriver: false }),
  ]).start(); // ничего не ждём
};

// мгновенный переход по нажатию
const bg = tint.interpolate({
    inputRange: [0, 1],
    outputRange: [withAlpha(theme.colors.text, 0), withAlpha(theme.colors.text, 0.08)], // аккуратный кружок из палитры
  });

  return (
    <View style={[s.container]}>
      {/* Левая группа: стрелка назад + заголовок слева */}
      
      <View style={s.leftRow}>
        {route?.params?.headerLeftMode === 'close' ? (
          <Pressable
            hitSlop={12}
            onPress={() => nav.goBack()}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16 }}
            accessibilityRole="button"
            accessibilityLabel={String(route?.params?.headerLeftLabel || (globalThis?.S?.('close') ?? 'Закрыть'))}
          >
            <View style={[s.backCircle, { width: 32, height: 32 }]}>
              <Feather name="x" size={20} color={theme.colors.text} />
            </View>
            <Text style={[s.title, { marginLeft: 6 }]}>{String(route?.params?.headerLeftLabel || (globalThis?.S?.('close') ?? 'Закрыть'))}</Text>
          </Pressable>
        ) : (
          <>
            {route?.params?.leftTextOnly ? (
              <Pressable
                hitSlop={12}
                onPressIn={onLeftIn}
                onPressOut={onLeftOut}
                onPress={onBack}
                style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16 }}
                accessibilityRole="button"
                accessibilityLabel={String(backLabel || route?.params?.headerBackTitle || (globalThis?.S?.('cancel') ?? 'Отмена'))}
              >
                <Animated.View style={[leftCapsuleAnim]}>
                  <Text style={[s.backText, { color: theme.colors.primary }]} numberOfLines={1}>
                    {String(route?.params?.headerBackTitle ?? backLabel ?? (globalThis?.S?.('cancel') ?? 'Отмена'))}
                  </Text>
                </Animated.View>
              </Pressable>
            ) : back ? (
              <Animated.View style={{ transform: [{ scale }] }}>
                <Pressable
                  hitSlop={12}
                  onPressIn={onPressIn}
                  onPressOut={onPressOut}
                  onPress={onBack}
                  style={[s.backTouchable, { flexDirection: 'row', alignItems: 'center' }]}
                  accessibilityRole="button"
                  accessibilityLabel={String(backLabel || (globalThis?.S?.('back') ?? 'Назад'))}
                >
                  <Animated.View style={[s.backCircle, { backgroundColor: bg }]}>
                    <Feather name="chevron-left" size={22} color={theme.colors.text} />
                  </Animated.View>
                  {backLabel ? (
                    <Text style={[s.backText, { color: theme.colors.primary }]} numberOfLines={1}>
                      {String(backLabel)}
                    </Text>
                  ) : null}
                </Pressable>
              </Animated.View>
            ) : null}
            {!wantCenterTitle ? (
              <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>
                {typeof title === 'string' ? title : String(title ?? '')}
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* Правая зона для кастомных кнопок */}

      {/* Centered title overlay when requested */}
      {wantCenterTitle ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
          <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>
            {typeof title === 'string' ? title : String(title ?? '')}
          </Text>
        </View>
      ) : null}


      <View style={s.right}>

        {rightLabel && (rightPress || route?.params?.headerButtonTo) ? (
  <Pressable
    hitSlop={10}
    onPressIn={onRightIn}
    onPressOut={onRightOut}
    onPress={rightPress || (() => router.push(route.params.headerButtonTo))}
    accessibilityRole="button"
    accessibilityLabel={String(rightLabel)}
  >
            <Animated.View style={[rightCapsuleAnim]}>
              <Text numberOfLines={1} style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15 }}>
                {String(rightLabel)}
              </Text>
            </Animated.View>
          </Pressable>
        ) : options?.headerRight ? (
          options.headerRight()
        ) : route?.params?.onRightPress && route?.params?.rightActionLabel ? (
          <Pressable
            hitSlop={10}
            onPressIn={onRightIn}
            onPressOut={onRightOut}
            onPress={rightPress}
          >
            <Animated.View
              style={[
                {
                  paddingHorizontal: 12,
                  height: 32,
                  borderRadius: 16,
                  borderWidth: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  alignSelf: 'flex-end',
                },
                rightCapsuleAnim,
              ]}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  { borderRadius: 16 },
                  rightCapsuleOverlay,
                ]}
              />
              <Text numberOfLines={1} style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15 }}>
                {String(route.params.rightActionLabel ?? '')}
              </Text>
            </Animated.View>
          </Pressable>
        ) : route?.params?.headerButtonLabel && route?.params?.headerButtonTo ? (
          <Pressable
            hitSlop={10}
            onPressIn={onRightIn}
            onPressOut={onRightOut}
            onPress={() => router.push(route.params.headerButtonTo)}
            accessibilityRole="button"
            accessibilityLabel={String(route.params.headerButtonLabel)}
          >
            <Animated.View style={[rightCapsuleAnim]}>
              <Text numberOfLines={1} style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15 }}>
                {String(route.params.headerButtonLabel)}
              </Text>
            </Animated.View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    // Прозрачный фон — хедер «лежит» на странице
    backgroundColor: "transparent",
    borderBottomWidth: 0,
    position: "relative",
    paddingHorizontal: 8,
  },
  leftRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  right: { minWidth: 64, alignItems: "flex-end", paddingRight: 8 },
  title: { fontSize: 17, fontWeight: "600", marginLeft: 8 },
  backText: { fontSize: 16, fontWeight: '600', marginLeft: 2 },
  // Кнопка назад с аккуратным кружком при нажатии
  backTouchable: { padding: 4, borderRadius: 20 },
  backCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
