// components/layout/Screen.jsx
import { useRoute } from '@react-navigation/native';
import { useNavigation, usePathname } from 'expo-router';
import React from 'react';
import { Platform, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18nVersion } from '../../src/i18n';
import { useTheme } from '../../theme/ThemeProvider';
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
  const isAuthScreen = pathname.startsWith('/(auth)') || route?.name === 'login';
  const showHeader = !isAuthScreen && headerOptions?.headerShown !== false;
  const insets = useSafeAreaInsets();
  const useScroll = scroll !== false && !isAuthScreen;
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
      {useScroll ? (
        <KeyboardAwareScrollView
          ref={scrollRef}
          contentContainerStyle={[
            { flexGrow: 1, paddingBottom: insets.bottom + 20 },
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          bottomOffset={40}
          onScroll={onScroll}
          scrollEventThrottle={scrollEventThrottle}
        >
          {showHeader && (
            <AppHeader back={nav.canGoBack()} route={mergedRoute} options={headerOptions} />
          )}
          <View style={{ flex: 1 }}>{children}</View>
        </KeyboardAwareScrollView>
      ) : (
        <>
          {showHeader && (
            <AppHeader back={nav.canGoBack()} route={mergedRoute} options={headerOptions} />
          )}
          <View style={{ flex: 1 }}>{children}</View>
        </>
      )}
    </SafeAreaView>
  );
}
