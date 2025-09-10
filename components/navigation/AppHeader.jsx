// components/navigation/AppHeader.jsx
import React, { useRef } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { useNavigation, usePathname, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { useCapsuleFeedback } from "../../theme/ThemeProvider";

// Человеческие заголовки для часто используемых экранов
const TITLE_MAP = {
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
  // 1) явный заголовок из options имеет приоритет
  const direct = options?.title ?? options?.headerTitle;
  if (direct) return direct;

  const name = route?.name || "";
  const pathname = pathnameRaw || "";

  // 2) по имени роута
  if (TITLE_MAP[name]) return TITLE_MAP[name];

  // 3) по пути
  if (pathname.startsWith("/orders/calendar")) return "Календарь";
  if (pathname.startsWith("/orders/all-orders")) return "Все заявки";
  if (pathname.startsWith("/orders/my-orders")) return "Мои заявки";
  if (pathname.startsWith("/orders")) return "Заявки";
  if (pathname.startsWith("/users/")) return "Пользователь";
  if (pathname.startsWith("/users")) return "Сотрудники";

  // 4) дефолт: имя роута или пусто
  return name || "";
}

export default function AppHeader({ options = {}, back, route }) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const pathname = usePathname?.() || "";

  const title = resolveTitle(options, route, pathname);
  const { onPressIn: onCtaIn, onPressOut: onCtaOut, containerStyle: capsuleAnim, overlayStyle: capsuleOverlay } = useCapsuleFeedback();

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
const onBack = () => nav.goBack();



  const bg = tint.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(0,0,0,0)", "rgba(0,0,0,0.08)"], // аккуратный тёмный кружок
  });

  return (
    <View style={[s.container]}>
      {/* Левая группа: стрелка назад + заголовок слева */}
      <View style={s.leftRow}>
        {back ? (
          <Animated.View style={{ transform: [{ scale }] }}>
            <Pressable
  hitSlop={12}
  onPressIn={onPressIn}
  onPressOut={onPressOut}
  onPress={onBack}
  style={s.backTouchable}
              accessibilityRole="button"
              accessibilityLabel="Назад"
            >
              <Animated.View style={[s.backCircle, { backgroundColor: bg }]}>
                <Feather name="chevron-left" size={22} color={theme.colors.text} />
              </Animated.View>
            </Pressable>
          </Animated.View>
        ) : null}

        <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>
          {title}
        </Text>
      </View>

      {/* Правая зона для кастомных кнопок */}
      <View style={s.right}>
        {options?.headerRight ? options.headerRight() : (route?.params?.headerButtonLabel && route?.params?.headerButtonTo ? (
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
                {route.params.headerButtonLabel}
              </Text>
            </Animated.View>
          </Pressable>
        ) : null)}
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
