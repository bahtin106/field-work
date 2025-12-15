// components/navigation/AppHeader.jsx
import { Feather } from '@expo/vector-icons';
import { router, useNavigation, usePathname } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { useCapsuleFeedback } from '../ui/useCapsuleFeedback';
import { useRouteTitle } from './useRouteTitle';

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

export default function AppHeader({ options = {}, back, route }) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const pathname = usePathname?.() || '';
  const title = useRouteTitle(options, route, pathname);

  // Если в options или в route.params передана функция headerTitle (рендер-функция),
  // используем её напрямую — это позволяет передавать JSX из Screen headerOptions.
  let headerTitleElement = null;
  try {
    const candidate = options?.headerTitle ?? route?.params?.headerTitle;
    if (typeof candidate === 'function') {
      headerTitleElement = candidate();
    }
  } catch (e) {
    headerTitleElement = null;
  }

  const backLabel = options?.headerBackTitle ?? route?.params?.headerBackTitle;
  const wantCenterTitle =
    options?.headerTitleAlign === 'center' || route?.params?.centerTitle === true;

  // Универсальный текст заголовка: берём fullTitle (если есть) или обычный title
  const titleText = useMemo(() => {
    const ft = options?.fullTitle ?? route?.params?.fullTitle;
    if (ft) return String(ft);
    return typeof title === 'string' ? title : String(title ?? '');
  }, [options?.fullTitle, route?.params?.fullTitle, title]);

  const onBack = useCallback(() => {
    try {
      if (route?.params?.onBackPress && typeof route.params.onBackPress === 'function') {
        route.params.onBackPress();
        return;
      }
    } catch (e) {}
    nav.goBack();
  }, [route?.params?.onBackPress, nav]);

  const onClose = useCallback(() => {
    nav.goBack();
  }, [nav]);

  const {
    onPressIn: onLeftIn,
    onPressOut: onLeftOut,
    containerStyle: leftCapsuleAnim,
  } = useCapsuleFeedback();
  const {
    onPressIn: onRightIn,
    onPressOut: onRightOut,
    containerStyle: rightCapsuleAnim,
    overlayStyle: rightCapsuleOverlay,
  } = useCapsuleFeedback();

  const rightLabel = useMemo(
    () => options?.rightTextLabel ?? route?.params?.rightTextLabel,
    [options?.rightTextLabel, route?.params?.rightTextLabel],
  );

  const rightPress = useCallback(() => {
    if (typeof options?.onRightPress === 'function') return options.onRightPress();
    if (typeof route?.params?.onRightPress === 'function') return route.params.onRightPress();
    // Global action registry by id to avoid non-serializable params
    const actionId = route?.params?.onRightPressId;
    const fn =
      actionId && globalThis?.__headerActions ? globalThis.__headerActions[actionId] : null;
    if (typeof fn === 'function') return fn();
    if (route?.params?.headerButtonTo) return router.push(route.params.headerButtonTo);
  }, [
    options?.onRightPress,
    route?.params?.onRightPress,
    route?.params?.onRightPressId,
    route?.params?.headerButtonTo,
  ]);

  // ---- Анимации для кнопки "назад": масштаб + затемнённый кружок ----
  const scale = useRef(new Animated.Value(1)).current;
  const tint = useRef(new Animated.Value(0)).current; // 0 -> прозрачно, 1 -> тёмный кружок

  const onBackPressIn = useCallback(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 0.96, useNativeDriver: true }),
      Animated.timing(tint, { toValue: 1, duration: 120, useNativeDriver: false }),
    ]).start();
  }, [scale, tint]);

  const onBackPressOut = useCallback(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: true }),
      Animated.timing(tint, { toValue: 0, duration: 120, useNativeDriver: false }),
    ]).start(); // ничего не ждём
  }, [scale, tint]);

  // мгновенный переход по нажатию
  const bg = tint.interpolate({
    inputRange: [0, 1],
    outputRange: [withAlpha(theme.colors.text, 0), withAlpha(theme.colors.text, 0.08)], // аккуратный кружок из палитры
  });

  // Используем фиксированную высоту хедера для стабильности
  const headerHeight = React.useMemo(() => {
    return theme?.components?.header?.height ?? theme?.sizes?.header ?? 56;
  }, [theme?.components?.header?.height, theme?.sizes?.header]);

  // Измерения лев/прав зон, чтобы marquee не заходил на кнопки
  const leftControlsRef = useRef(null);
  const rightRef = useRef(null);
  const [leftWidth, setLeftWidth] = useState(0);
  const [rightWidth, setRightWidth] = useState(0);

  // Маркировка анимации marquee
  const marqueeAnim = useRef(new Animated.Value(0)).current;
  const marqueeRunning = useRef(false);
  const [textWidth, setTextWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // Включаем marquee для любого заголовка (автоматически)

  // Глобальные настройки marquee и отступов из темы
  const headerTheme = theme?.components?.header ?? {};
  const marqueeTheme = headerTheme?.marquee ?? {};
  // gap между дубликатами текста для плавного прохода
  const MARQUEE_GAP = useMemo(
    () => marqueeTheme.gap ?? theme?.spacing?.lg ?? 24,
    [marqueeTheme.gap, theme?.spacing?.lg],
  );
  // дополнительный безопасный отступ слева/справа между бегущей строкой и зонами кнопок
  const EDGE_PADDING = useMemo(
    () => headerTheme.edgePadding ?? theme?.spacing?.md ?? 12,
    [headerTheme.edgePadding, theme?.spacing?.md],
  );
  const TITLE_FONT_SIZE = useMemo(
    () => marqueeTheme.titleFontSize ?? 17,
    [marqueeTheme.titleFontSize],
  );
  const TITLE_FONT_WEIGHT = useMemo(
    () => marqueeTheme.titleFontWeight ?? '600',
    [marqueeTheme.titleFontWeight],
  );
  const MS_PER_PIXEL = useMemo(() => marqueeTheme.msPerPixel ?? 12, [marqueeTheme.msPerPixel]);
  const START_DELAY = useMemo(() => marqueeTheme.startDelay ?? 700, [marqueeTheme.startDelay]);
  const END_PAUSE = useMemo(() => marqueeTheme.endPause ?? 900, [marqueeTheme.endPause]);

  useEffect(() => {
    // start/stop marquee based on measured widths
    if (!textWidth || !containerWidth) {
      marqueeAnim.stopAnimation?.();
      marqueeAnim.setValue(0);
      marqueeRunning.current = false;
      return;
    }

    const overflow = textWidth - containerWidth;
    if (overflow <= 2) {
      // no need to animate
      Animated.timing(marqueeAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
      marqueeRunning.current = false;
      return;
    }

    // continuous loop using duplicated texts: animate from 0 to -textWidth with linear easing
    marqueeRunning.current = true;
    marqueeAnim.setValue(0);
    const fullShift = textWidth + MARQUEE_GAP;
    const baseDuration = Math.max(3000, Math.round(fullShift * MS_PER_PIXEL));

    const loopAnim = Animated.loop(
      Animated.sequence([
        Animated.delay(START_DELAY),
        Animated.timing(marqueeAnim, {
          toValue: -fullShift,
          duration: baseDuration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(END_PAUSE),
        Animated.timing(marqueeAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );

    loopAnim.start();

    return () => {
      marqueeRunning.current = false;
      loopAnim.stop();
      marqueeAnim.stopAnimation?.();
      marqueeAnim.setValue(0);
    };
  }, [
    textWidth,
    containerWidth,
    marqueeAnim,
    titleText,
    MARQUEE_GAP,
    MS_PER_PIXEL,
    START_DELAY,
    END_PAUSE,
  ]);

  return (
    <View style={[s.container, { height: headerHeight }]}>
      {/* Левая группа: стрелка назад + заголовок слева */}
      <View style={s.leftRow}>
        {route?.params?.headerLeftMode === 'close' ? (
          <Pressable
            ref={leftControlsRef}
            onLayout={(e) => setLeftWidth(e.nativeEvent.layout.width || 0)}
            hitSlop={12}
            onPress={onClose}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 8,
              paddingVertical: 6,
              borderRadius: 16,
            }}
            accessibilityRole="button"
            accessibilityLabel={String(
              route?.params?.headerLeftLabel || (globalThis?.S?.('close') ?? 'Закрыть'),
            )}
          >
            <View style={[s.backCircle, { width: 32, height: 32 }]}>
              <Feather name="x" size={20} color={theme.colors.text} />
            </View>
            <Text style={[s.title, { marginLeft: 6 }]}>
              {String(route?.params?.headerLeftLabel || (globalThis?.S?.('close') ?? 'Закрыть'))}
            </Text>
          </Pressable>
        ) : (
          <>
            {route?.params?.leftTextOnly ? (
              <Pressable
                ref={leftControlsRef}
                onLayout={(e) => setLeftWidth(e.nativeEvent.layout.width || 0)}
                hitSlop={12}
                onPressIn={onLeftIn}
                onPressOut={onLeftOut}
                onPress={onBack}
                style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16 }}
                accessibilityRole="button"
                accessibilityLabel={String(
                  backLabel ||
                    route?.params?.headerBackTitle ||
                    (globalThis?.S?.('cancel') ?? 'Отмена'),
                )}
              >
                <Animated.View style={[leftCapsuleAnim]}>
                  <Text style={[s.backText, { color: theme.colors.primary }]} numberOfLines={1}>
                    {String(
                      route?.params?.headerBackTitle ??
                        backLabel ??
                        globalThis?.S?.('cancel') ??
                        'Отмена',
                    )}
                  </Text>
                </Animated.View>
              </Pressable>
            ) : back ? (
              <Animated.View style={{ transform: [{ scale }] }}>
                <Pressable
                  ref={leftControlsRef}
                  onLayout={(e) => setLeftWidth(e.nativeEvent.layout.width || 0)}
                  hitSlop={12}
                  onPressIn={onBackPressIn}
                  onPressOut={onBackPressOut}
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
            {/* Статичный заголовок скрываем, когда marquee активен */}
            {!wantCenterTitle && textWidth <= containerWidth ? (
              headerTitleElement ? (
                headerTitleElement
              ) : titleText ? (
                <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>
                  {titleText}
                </Text>
              ) : null
            ) : null}
          </>
        )}
      </View>

      {/* Marquee overlay — работает для любого заголовка автоматически */}
      {titleText ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: leftWidth + EDGE_PADDING,
            right: rightWidth + EDGE_PADDING,
            justifyContent: 'center',
            overflow: 'hidden',
          }}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width || 0)}
        >
          {textWidth > 0 && containerWidth > 0 && textWidth > containerWidth ? (
            <Animated.View
              // key ensures React recreates the view when measurements change
              key={`${textWidth}-${containerWidth}`}
              style={{
                flexDirection: 'row',
                width: textWidth * 2 + MARQUEE_GAP,
                transform: [{ translateX: marqueeAnim }],
              }}
            >
              <Text
                numberOfLines={1}
                ellipsizeMode="clip"
                allowFontScaling={false}
                style={{
                  width: textWidth,
                  color: theme.colors.text,
                  fontSize: TITLE_FONT_SIZE,
                  fontWeight: TITLE_FONT_WEIGHT,
                }}
              >
                {titleText}
              </Text>
              <View style={{ width: MARQUEE_GAP }} />
              <Text
                numberOfLines={1}
                ellipsizeMode="clip"
                allowFontScaling={false}
                style={{
                  width: textWidth,
                  color: theme.colors.text,
                  fontSize: TITLE_FONT_SIZE,
                  fontWeight: TITLE_FONT_WEIGHT,
                }}
              >
                {titleText}
              </Text>
            </Animated.View>
          ) : null}
        </View>
      ) : null}

      {/* Invisible measuring text placed outside the clipped marquee container so it measures full natural width */}
      {titleText ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            left: -10000,
            top: -10000,
            opacity: 0,
            fontSize: TITLE_FONT_SIZE,
            fontWeight: TITLE_FONT_WEIGHT,
          }}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width || 0;
            setTextWidth(Math.ceil(w + 2));
          }}
          numberOfLines={1}
        >
          {titleText}
        </Text>
      ) : null}

      {/* Centered title overlay when requested */}
      {wantCenterTitle && textWidth <= containerWidth ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}
        >
          {headerTitleElement ? (
            headerTitleElement
          ) : titleText ? (
            <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>
              {titleText}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Правая зона для кастомных кнопок */}
      <View
        style={[s.right, { paddingLeft: EDGE_PADDING }]}
        ref={rightRef}
        onLayout={(e) => setRightWidth(e.nativeEvent.layout.width || 0)}
      >
        {rightLabel ? (
          <Pressable
            hitSlop={10}
            onPressIn={onRightIn}
            onPressOut={onRightOut}
            onPress={rightPress}
            accessibilityRole="button"
            accessibilityLabel={String(rightLabel)}
          >
            <Animated.View style={[rightCapsuleAnim]}>
              <Text
                numberOfLines={1}
                style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15 }}
              >
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
                style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }, rightCapsuleOverlay]}
              />
              <Text
                numberOfLines={1}
                style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15 }}
              >
                {String(route.params.rightActionLabel ?? '')}
              </Text>
            </Animated.View>
          </Pressable>
        ) : route?.params?.headerButtonLabel && route?.params?.headerButtonTo ? (
          <Pressable
            hitSlop={10}
            onPressIn={onRightIn}
            onPressOut={onRightOut}
            onPress={rightPress}
            accessibilityRole="button"
            accessibilityLabel={String(route.params.headerButtonLabel)}
          >
            <Animated.View style={[rightCapsuleAnim]}>
              <Text
                numberOfLines={1}
                style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15 }}
              >
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
    // height задаётся из темы через inline-override
    flexDirection: 'row',
    alignItems: 'center',
    // Прозрачный фон — хедер «лежит» на странице
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
    position: 'relative',
    paddingHorizontal: 8,
  },
  leftRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  right: { minWidth: 64, alignItems: 'flex-end', paddingRight: 16 },
  title: { fontSize: 17, fontWeight: '600', marginLeft: 8 },
  backText: { fontSize: 16, fontWeight: '600', marginLeft: 2 },
  // Кнопка назад с аккуратным кружком при нажатии
  backTouchable: { padding: 4, borderRadius: 20 },
  backCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
