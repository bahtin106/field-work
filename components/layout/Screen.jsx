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
  const showHeader = !isAuthScreen;
  const insets = useSafeAreaInsets();
  const useScroll = scroll !== false && !isAuthScreen;
  const title = route?.name ?? '';
  useI18nVersion(); // subscribe to i18n changes to re-render screen

  // Объединяем route params с переданными headerOptions (приоритет у headerOptions)
  // Безопасно обрабатываем случай когда route или route.params могут быть undefined
  const mergedRoute = React.useMemo(() => {
    if (!headerOptions) return route;
    return {
      ...route,
      params: { ...(route?.params || {}), ...headerOptions },
    };
  }, [route, headerOptions]);

  const edges = isAuthScreen ? ['top', 'left', 'right', 'bottom'] : ['left', 'right'];

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
            <AppHeader options={{ title }} back={nav.canGoBack()} route={mergedRoute} />
          )}
          <View style={{ flex: 1 }}>{children}</View>
        </KeyboardAwareScrollView>
      ) : (
        <>
          {showHeader && (
            <AppHeader options={{ title }} back={nav.canGoBack()} route={mergedRoute} />
          )}
          <View style={{ flex: 1 }}>{children}</View>
        </>
      )}
    </SafeAreaView>
  );
}
