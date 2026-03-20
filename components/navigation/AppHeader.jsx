// components/navigation/AppHeader.jsx
import { Feather } from '@expo/vector-icons';
import { router, useNavigation, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import dismissToRoute from '../../lib/navigation/dismissToRoute';
import { useTheme } from '../../theme';
import { withAlpha } from '../../theme/colors';
import { useCapsuleFeedback } from '../ui/useCapsuleFeedback';
import { useRouteTitle } from './useRouteTitle';

const EMPTY_ROUTE_PARAMS = {};
const ENABLE_HEADER_MARQUEE = true;

const getHeaderMetrics = (theme, titleStyleOverride = {}) => {
  const header = theme?.components?.header ?? {};
  const marquee = header.marquee ?? {};

  return {
    height: header.height ?? theme?.sizes?.header ?? 56,
    sidePadding: header.sidePadding ?? theme?.spacing?.sm ?? 8,
    edgePadding: header.edgePadding ?? theme?.spacing?.md ?? 12,
    rightMinWidth: header.rightMinWidth ?? 64,
    controlHeight: header.controlHeight ?? 32,
    controlRadius: header.controlRadius ?? 16,
    controlPaddingX: header.controlPaddingX ?? theme?.spacing?.sm ?? 8,
    controlPaddingY: header.controlPaddingY ?? 6,
    iconTouchPadding: header.iconTouchPadding ?? 4,
    iconCircleSize: header.iconCircleSize ?? 36,
    iconSize: header.iconSize ?? theme?.icons?.md ?? 22,
    titleGap: header.titleGap ?? theme?.spacing?.sm ?? 8,
    closeTitleGap: header.closeTitleGap ?? 6,
    backLabelGap: header.backLabelGap ?? 2,
    actionFontSize: header.actionFontSize ?? 15,
    marqueeGap: marquee.gap ?? theme?.spacing?.lg ?? 24,
    marqueeMsPerPixel: marquee.msPerPixel ?? 12,
    marqueeStartDelay: marquee.startDelay ?? 700,
    marqueeEndPause: marquee.endPause ?? 900,
    titleFontSize:
      titleStyleOverride?.fontSize ?? marquee.titleFontSize ?? theme?.typography?.sizes?.lg ?? 17,
    titleFontWeight:
      titleStyleOverride?.fontWeight ??
      marquee.titleFontWeight ??
      theme?.typography?.weight?.semibold ??
      '600',
  };
};

const createStyles = (theme, metrics) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderBottomWidth: 0,
      position: 'relative',
      paddingHorizontal: metrics.sidePadding,
    },
    leftRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    right: {
      minWidth: metrics.rightMinWidth,
      alignItems: 'flex-end',
      paddingRight: metrics.edgePadding,
    },
    title: {
      fontSize: metrics.titleFontSize,
      fontWeight: metrics.titleFontWeight,
      marginLeft: metrics.titleGap,
    },
    backText: {
      fontSize: Math.max(metrics.actionFontSize, theme.typography?.sizes?.md ?? 16),
      fontWeight: theme.typography?.weight?.semibold ?? '600',
      marginLeft: metrics.backLabelGap,
    },
    backTouchable: {
      padding: metrics.iconTouchPadding,
      borderRadius: metrics.controlRadius + metrics.iconTouchPadding,
    },
    backCircle: {
      width: metrics.iconCircleSize,
      height: metrics.iconCircleSize,
      borderRadius: metrics.iconCircleSize / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textControl: {
      paddingHorizontal: metrics.controlPaddingX,
      paddingVertical: metrics.controlPaddingY,
      borderRadius: metrics.controlRadius,
      minHeight: metrics.controlHeight,
      justifyContent: 'center',
    },
    outlinedAction: {
      paddingHorizontal: theme.spacing?.md ?? 12,
      height: metrics.controlHeight,
      borderRadius: metrics.controlRadius,
      borderWidth: 1,
      borderColor: theme.colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'flex-end',
      backgroundColor: theme.colors.surface,
    },
    actionText: {
      color: theme.colors.primary,
      fontWeight: theme.typography?.weight?.semibold ?? '600',
      fontSize: metrics.actionFontSize,
    },
  });

export default function AppHeader({ options = {}, back, route, onBackPress: onBackPressProp }) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const routeParams = route?.params || EMPTY_ROUTE_PARAMS;
  const pathname = usePathname?.() || '';
  const title = useRouteTitle(options, route, pathname);

  // Если в options или в route.params передана функция headerTitle (рендер-функция),
  // используем её напрямую — это позволяет передавать JSX из Screen headerOptions.
  let headerTitleElement = null;
  try {
    const candidate = options?.headerTitle ?? routeParams?.headerTitle;
    if (typeof candidate === 'function') {
      headerTitleElement = candidate();
    }
  } catch {
    headerTitleElement = null;
  }

  const backLabel = options?.headerBackTitle ?? routeParams?.headerBackTitle;
  const wantCenterTitle =
    options?.headerTitleAlign === 'center' || routeParams?.centerTitle === true;

  // Универсальный текст заголовка: берём fullTitle (если есть) или обычный title
  const titleText = useMemo(() => {
    const ft = options?.fullTitle ?? routeParams.fullTitle;
    if (ft) return String(ft);
    return typeof title === 'string' ? title : String(title ?? '');
  }, [options?.fullTitle, title, routeParams.fullTitle]);
  const titleStyleOverride = useMemo(
    () => options?.headerTitleStyle ?? routeParams?.headerTitleStyle ?? {},
    [options?.headerTitleStyle, routeParams?.headerTitleStyle],
  );
  const headerMetrics = useMemo(
    () => getHeaderMetrics(theme, titleStyleOverride),
    [theme, titleStyleOverride],
  );
  const s = useMemo(() => createStyles(theme, headerMetrics), [theme, headerMetrics]);
  const backFallbackTo = useMemo(() => {
    const explicit = options?.backFallbackTo ?? routeParams?.backFallbackTo;
    if (explicit) return explicit;

    const returnTo = String(routeParams?.returnTo || '').trim();
    if (returnTo) {
      let returnParams = undefined;
      if (typeof routeParams?.returnParams === 'string' && routeParams.returnParams.trim()) {
        try {
          const parsed = JSON.parse(routeParams.returnParams);
          if (parsed && typeof parsed === 'object') returnParams = parsed;
        } catch {}
      }
      return returnParams ? { pathname: returnTo, params: returnParams } : returnTo;
    }

    return '/orders';
  }, [options?.backFallbackTo, routeParams?.backFallbackTo, routeParams?.returnParams, routeParams?.returnTo]);

  const safeGoBack = useCallback(() => {
    try {
      if (typeof nav?.canGoBack === 'function' && nav.canGoBack()) {
        nav.goBack();
        return;
      }
      if (typeof router?.canGoBack === 'function' && router.canGoBack()) {
        router.back();
        return;
      }
    } catch {}

    if (backFallbackTo && dismissToRoute(router, backFallbackTo)) return;

    try {
      dismissToRoute(router, '/orders');
    } catch {}
  }, [backFallbackTo, nav]);

  const onBack = useCallback(() => {
    try {
      // Сначала проверяем prop из EditScreenTemplate
      if (onBackPressProp && typeof onBackPressProp === 'function') {
        onBackPressProp();
        return;
      }
      // Затем route.params
      if (routeParams.onBackPress && typeof routeParams.onBackPress === 'function') {
        routeParams.onBackPress();
        return;
      }
    } catch {}
    safeGoBack();
  }, [onBackPressProp, routeParams, safeGoBack]);

  const onClose = useCallback(() => {
    safeGoBack();
  }, [safeGoBack]);

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
  const hasRightAction = useMemo(
    () =>
      Boolean(
        rightLabel ||
          options?.headerRight ||
          (route?.params?.onRightPress && route?.params?.rightActionLabel) ||
          (route?.params?.headerButtonLabel && route?.params?.headerButtonTo),
      ),
    [options?.headerRight, rightLabel, route?.params],
  );

  const rightPress = useCallback(() => {
    if (typeof options?.onRightPress === 'function') return options.onRightPress();
    if (typeof routeParams.onRightPress === 'function') return routeParams.onRightPress();
    // Global action registry by id to avoid non-serializable params
    const actionId = routeParams.onRightPressId;
    const fn =
      actionId && globalThis?.__headerActions ? globalThis.__headerActions[actionId] : null;
    if (typeof fn === 'function') return fn();
    if (routeParams.headerButtonTo) return router.push(routeParams.headerButtonTo);
  }, [
    options,
    routeParams,
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
  const headerHeight = headerMetrics.height;

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
  // gap между дубликатами текста для плавного прохода
  const MARQUEE_GAP = headerMetrics.marqueeGap;
  // дополнительный безопасный отступ слева/справа между бегущей строкой и зонами кнопок
  const EDGE_PADDING = headerMetrics.edgePadding;
  const TITLE_FONT_SIZE = headerMetrics.titleFontSize;
  const TITLE_FONT_WEIGHT = headerMetrics.titleFontWeight;
  const MS_PER_PIXEL = headerMetrics.marqueeMsPerPixel;
  const START_DELAY = headerMetrics.marqueeStartDelay;
  const END_PAUSE = headerMetrics.marqueeEndPause;

  useEffect(() => {
    if (!ENABLE_HEADER_MARQUEE) {
      marqueeAnim.stopAnimation?.();
      marqueeAnim.setValue(0);
      marqueeRunning.current = false;
      return;
    }
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
            style={[s.textControl, { flexDirection: 'row', alignItems: 'center' }]}
            accessibilityRole="button"
            accessibilityLabel={String(
              route?.params?.headerLeftLabel || (globalThis?.S?.('close') ?? 'Закрыть'),
            )}
          >
            <View
              style={[
                s.backCircle,
                {
                  width: headerMetrics.controlHeight,
                  height: headerMetrics.controlHeight,
                  borderRadius: headerMetrics.controlHeight / 2,
                },
              ]}
            >
              <Feather name="x" size={headerMetrics.iconSize} color={theme.colors.text} />
            </View>
            <Text style={[s.title, { marginLeft: headerMetrics.closeTitleGap, color: theme.colors.text }]}>
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
                style={s.textControl}
                accessibilityRole="button"
                accessibilityLabel={String(
                  backLabel ||
                    route?.params?.headerBackTitle ||
                    (globalThis?.S?.('cancel') ?? 'Отмена'),
                )}
              >
                <Animated.View style={[leftCapsuleAnim]}>
                  <Text style={s.backText} numberOfLines={1}>
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
                    <Feather name="chevron-left" size={headerMetrics.iconSize} color={theme.colors.text} />
                  </Animated.View>
                  {backLabel ? (
                    <Text style={s.backText} numberOfLines={1}>
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
                <Text
                  numberOfLines={1}
                  allowFontScaling={false}
                  style={[s.title, { color: theme.colors.text }, titleStyleOverride]}
                >
                  {titleText}
                </Text>
              ) : null
            ) : null}
          </>
        )}
      </View>

      {/* Marquee overlay — работает для любого заголовка автоматически */}
      {ENABLE_HEADER_MARQUEE && titleText ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: leftWidth + EDGE_PADDING,
            right: rightWidth + (hasRightAction ? EDGE_PADDING : 0),
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
      {ENABLE_HEADER_MARQUEE && titleText ? (
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
            <Text
              numberOfLines={1}
              allowFontScaling={false}
              style={[s.title, { color: theme.colors.text }, titleStyleOverride]}
            >
              {titleText}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Правая зона для кастомных кнопок */}
      <View
        style={[
          s.right,
          {
            paddingLeft: hasRightAction ? EDGE_PADDING : 0,
            minWidth: hasRightAction ? undefined : 0,
          },
        ]}
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
                style={s.actionText}
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
                s.outlinedAction,
                rightCapsuleAnim,
              ]}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  { borderRadius: headerMetrics.controlRadius },
                  rightCapsuleOverlay,
                ]}
              />
              <Text
                numberOfLines={1}
                style={s.actionText}
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
                style={s.actionText}
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

/* legacy static styles replaced by theme-driven factory
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
*/
