// app/settings/_layout.jsx
import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { HeaderBackButton } from '@react-navigation/elements';
import { Platform, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

const FALLBACK = {
  colors: { card: '#FFFFFF', border: '#E5E5EA', text: '#111111', accent: '#007AFF', bg: '#F2F2F7' },
  text: { muted: { color: '#8E8E93' } },
};

function BackButton() {
  const navigation = useNavigation();
  const router = useRouter();
  let ctx; try { ctx = useTheme(); } catch { ctx = null; }
  const theme = ctx?.theme ?? FALLBACK;
  const canGoBack = navigation.canGoBack();

  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,      // круг
        overflow: 'hidden',    // чтобы ripрle был круглый
        marginLeft: 8,         // выравнивание с карточками
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <HeaderBackButton
        labelVisible={false}
        tintColor={theme.colors.accent}
        onPress={() => (canGoBack ? navigation.goBack() : router.replace('/(tabs)'))}
        pressColor="rgba(0,0,0,0.12)"           // эффект нажатия
        style={{ marginLeft: -2 }}              // чуть левее сам chevron
      />
    </View>
  );
}

export default function Layout() {
  let ctx; try { ctx = useTheme(); } catch { ctx = null; }
  const theme = ctx?.theme ?? FALLBACK;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.bg },
        headerShadowVisible: false,
        headerTintColor: theme.colors.accent,
        headerTitleStyle: { fontSize: 18, fontWeight: '600' },
        headerBackTitleVisible: false,
        headerLargeTitle: false, // без раздутой "полосы"
        contentStyle: { backgroundColor: theme.colors.bg },
        animation: Platform.select({
          ios: 'slide_from_right',
          android: 'slide_from_right',
          default: 'slide_from_right',
        }),
        gestureEnabled: true,
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'Настройки', headerLeft: () => <BackButton /> }}
      />
    </Stack>
  );
}
