// components/layout/Screen.jsx
import { useRoute } from '@react-navigation/native';
import { useNavigation, usePathname, useSegments } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from '../../lib/keyboardControllerCompat';
import { useI18nVersion } from '../../src/i18n';
import { FormAutoScrollProvider } from '../../src/shared/forms/FormAutoScrollContext';
import { useTheme } from '../../theme/ThemeProvider';
import DismissKeyboardArea from './DismissKeyboardArea';
import GlobalCurrencyRecalcBanner from '../GlobalCurrencyRecalcBanner';
import AppHeader from '../navigation/AppHeader';

export default function Screen({
  children,
  style,
  scroll = true,
  scrollRef,
  contentContainerStyle,
  onScroll,
  scrollEventThrottle,
  headerOptions, // Новый prop для прямой передачи опций header
}) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const pathname = usePathname() || '';
  const segments = useSegments();
  const inAuthGroup = Array.isArray(segments) && segments[0] === '(auth)';
  const isAuthScreen = inAuthGroup || pathname.startsWith('/(auth)') || route?.name === 'login';
  const showHeader = !isAuthScreen && headerOptions?.headerShown !== false;
  const insets = useSafeAreaInsets();
  const useScroll = scroll !== false && !isAuthScreen;
  const keyboardBottomOffset = theme.components?.keyboardAware?.bottomOffset ?? 40;
  const extraKeyboardSpace = theme.components?.keyboardAware?.extraKeyboardSpace ?? 0;
  const internalScrollRef = React.useRef(null);
  const internalScrollYRef = React.useRef(0);
  const resolvedScrollRef = scrollRef || internalScrollRef;
  const headerHeight = theme.components?.header?.height ?? theme.sizes?.header ?? 56;
  useI18nVersion(); // subscribe to i18n changes to re-render screen

  // Объединяем route params с переданными headerOptions, но не копируем
  // функциональные значения из headerOptions в route.params — это важно,
  // потому что части UI (например, заголовок) могут приводить функции к строкам.
  // Вместо этого передаём headerOptions как отдельный `options` проп в AppHeader,
  // а в route.params копируем только примитивные / сериализуемые значения.
  const mergedRoute = React.useMemo(() => {
    if (!headerOptions) return route;
    const baseParams = { ...(route?.params || {}) };
    for (const [k, v] of Object.entries(headerOptions)) {
      const t = typeof v;
      if (t === 'string' || t === 'number' || t === 'boolean' || v == null) {
        baseParams[k] = v;
      }
    }
    return {
      ...route,
      params: baseParams,
    };
  }, [route, headerOptions]);

  // Используем стабильные edges для предотвращения изменений отступов при навигации
  const edges = React.useMemo(() => {
    return isAuthScreen ? ['top', 'left', 'right', 'bottom'] : ['left', 'right'];
  }, [isAuthScreen]);

  return (
    <SafeAreaView
      edges={edges}
      style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}
    >
      <FormAutoScrollProvider
        enabled={useScroll}
        scrollRef={resolvedScrollRef}
        scrollYRef={internalScrollYRef}
        insetsBottom={insets.bottom}
        headerHeight={showHeader ? headerHeight : 0}
      >
        {showHeader && <AppHeader back={nav.canGoBack()} route={mergedRoute} options={headerOptions} />}
        {useScroll ? (
          <KeyboardAwareScrollView
            ref={resolvedScrollRef}
            contentContainerStyle={[
              { flexGrow: 1, paddingBottom: insets.bottom + 20 },
              contentContainerStyle,
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
            bottomOffset={keyboardBottomOffset}
            extraKeyboardSpace={extraKeyboardSpace}
            onScroll={(event) => {
              internalScrollYRef.current = event?.nativeEvent?.contentOffset?.y || 0;
              onScroll?.(event);
            }}
            scrollEventThrottle={scrollEventThrottle}
          >
            {showHeader && <GlobalCurrencyRecalcBanner />}
            <DismissKeyboardArea style={{ flex: 1 }}>{children}</DismissKeyboardArea>
          </KeyboardAwareScrollView>
        ) : (
          <>
            {showHeader && <GlobalCurrencyRecalcBanner />}
            <View style={{ flex: 1 }}>{children}</View>
          </>
        )}
      </FormAutoScrollProvider>
    </SafeAreaView>
  );
}
