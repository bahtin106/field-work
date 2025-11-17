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
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 20 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          bottomOffset={40}
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
