// components/layout/Screen.jsx
import React from 'react';
import { View, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import AppHeader from '../navigation/AppHeader';
import { useNavigation, usePathname } from 'expo-router';
import { useI18nVersion } from '../../src/i18n';
import { useRoute } from '@react-navigation/native';

export default function Screen({ children, style, scroll = true }) {
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

  const edges = isAuthScreen ? ['top', 'left', 'right', 'bottom'] : ['left', 'right'];

  return (
    <SafeAreaView
      edges={edges}
      style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}
    >
      {useScroll ? (
        <KeyboardAwareScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          enableOnAndroid
          enableAutomaticScroll
          keyboardOpeningTime={0}
          extraScrollHeight={-(insets?.bottom || 0)}
        >
          {showHeader && <AppHeader options={{ title }} back={nav.canGoBack()} route={route} />}
          <View style={{ flex: 1 }}>{children}</View>
        </KeyboardAwareScrollView>
      ) : (
        <>
          {showHeader && <AppHeader options={{ title }} back={nav.canGoBack()} route={route} />}
          <View style={{ flex: 1 }}>{children}</View>
        </>
      )}
    </SafeAreaView>
  );
}
