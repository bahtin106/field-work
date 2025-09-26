// components/navigation/AppHeader.jsx
import React, { useRef } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { useNavigation, usePathname, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { useCapsuleFeedback } from "../../theme/ThemeProvider";

// Человеческие заголовки для часто используемых экранов
const TITLE_MAP = {
  "settings": "Настройки компании",
  "settings/index": "Настройки компании",
  "orders": "Заявки",
  "orders/index": "Заявки",
  "orders/my-orders": "Мои заявки",
  "orders/all-orders": "Все заявки",
  "orders/calendar": "Календарь",
  "users/[id]": "Пользователь",
  "users": "Сотрудники",
  "(auth)/sign-in": "Вход",
};

function resolveTitle(options, route, pathnameRaw) {
  // 1) Явный заголовок: params -> options
  const directRaw = route?.params?.title ?? route?.params?.headerTitle ?? options?.title ?? options?.headerTitle;
  // Важно: различаем undefined и пустую строку/плейсхолдер
  if (directRaw !== undefined) {
    const v = String(directRaw ?? '');
    if (!v || v === 'Без имени') return '';
    return v;
  }

  const name = route?.name || '';
  const pathname = pathnameRaw || '';

  // Спец-случай: экран редактирования — показываем понятный заголовок
  if (typeof pathname === 'string' && pathname.includes('/edit')) {
    // если заголовок явно не задан через options/params, используем «Редактирование»
    if (directRaw === undefined) return 'Редактирование';
  }

  // Для страниц сотрудника скрываем автозаголовок до прихода данных
  if (pathname.startsWith('/users/')) return '';

  // 2) по имени роута
  if (TITLE_MAP[name]) return TITLE_MAP[name];

  // 3) по пути
  if (pathname.startsWith('/orders/calendar')) return 'Календарь';
  if (pathname.startsWith('/orders/all-orders')) return 'Все заявки';
  if (pathname.startsWith('/orders/my-orders')) return 'Мои заявки';
  if (pathname.startsWith('/orders')) return 'Заявки';
  if (pathname.startsWith('/users')) return 'Сотрудники';
  if (pathname.startsWith('/settings')) return 'Настройки компании';

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

  const { onPressIn: onCtaIn, onPressOut: onCtaOut, containerStyle: capsuleAnim, overlayStyle: capsuleOverlay } = useCapsuleFeedback();

  
  const rightLabel = route?.params?.rightTextLabel ?? options?.rightTextLabel;
  const rightPress = route?.params?.onRightPress ?? options?.onRightPress;
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
    outputRange: ["rgba(0,0,0,0)", "rgba(0,0,0,0.08)"], // аккуратный тёмный кружок
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
            accessibilityLabel={String(route?.params?.headerLeftLabel || 'Закрыть')}
          >
            <View style={[s.backCircle, { width: 32, height: 32 }]}>
              <Feather name="x" size={20} color={theme.colors.text} />
            </View>
            <Text style={[s.title, { marginLeft: 6 }]}>{String(route?.params?.headerLeftLabel || 'Закрыть')}</Text>
          </Pressable>
        ) : (
          <>
            {route?.params?.leftTextOnly ? (
              <Pressable
                hitSlop={12}
                onPressIn={onCtaIn}
                onPressOut={onCtaOut}
                onPress={onBack}
                style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16 }}
                accessibilityRole="button"
                accessibilityLabel={String(backLabel || route?.params?.headerBackTitle || 'Отмена')}
              >
                <Animated.View style={[capsuleAnim]}>
                  <Text style={[s.backText, { color: theme.colors.primary }]} numberOfLines={1}>
                    {String(route?.params?.headerBackTitle ?? backLabel ?? 'Отмена')}
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
                  accessibilityLabel={String(backLabel || 'Назад')}
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

{route?.params?.editLabel && route?.params?.onEditPress ? (
  <Pressable
    hitSlop={10}
    onPressIn={onCtaIn}
    onPressOut={onCtaOut}
    onPress={route.params.onEditPress}
    accessibilityRole="button"
    accessibilityLabel={String(route.params.editLabel)}
  >
    <Animated.View style={[capsuleAnim]}>
      <Text numberOfLines={1} style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15 }}>
        {String(route.params.editLabel)}
      </Text>
    </Animated.View>
  </Pressable>
) : null}
        {rightLabel && rightPress ? (
          <Pressable
            hitSlop={10}
            onPressIn={onCtaIn}
            onPressOut={onCtaOut}
            onPress={rightPress}
            accessibilityRole="button"
            accessibilityLabel={String(rightLabel)}
          >
            <Animated.View style={[capsuleAnim]}>
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
            onPressIn={onCtaIn}
            onPressOut={onCtaOut}
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
                capsuleAnim,
              ]}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  { borderRadius: 16 },
                  capsuleOverlay,
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
            onPressIn={onCtaIn}
            onPressOut={onCtaOut}
            onPress={() => router.push(route.params.headerButtonTo)}
          >
            <Animated.View
              style={[
                {
                  paddingHorizontal: 12,
                  height: 32,
                  borderRadius: 16,
                  borderWidth: 1,
                  justifyContent: "center",
                  alignItems: "center",
                  alignSelf: "flex-end",
                },
                capsuleAnim,
              ]}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  { borderRadius: 16 },
                  capsuleOverlay,
                ]}
              />
              <Text numberOfLines={1} style={{ color: theme.colors.primary, fontWeight: "600", fontSize: 15 }}>
                {String(route.params.headerButtonLabel ?? '')}
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
