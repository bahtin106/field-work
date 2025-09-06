// app/settings/_layout.jsx
import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { Platform, View, Pressable, Text } from 'react-native';
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

  const size = theme?.sizes?.icon ?? 22; // fallback if theme doesn't specify
  const color = theme?.colors?.accent ?? theme?.colors?.text ?? '#111111';

  return (
    <Pressable
      onPress={() => (canGoBack ? navigation.goBack() : router.replace('/(tabs)'))}
      android_ripple={{ color: (theme?.colors?.border ?? '#000000') + '1F', borderless: true }}
      style={({ pressed }) => ([
        {
          width: 40,
          height: 40,
          borderRadius: 20,
          marginLeft: 8,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ])}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Назад"
    >
      <Text style={{ fontSize: size, color, fontWeight: '600' }}>{'‹'}</Text>
    </Pressable>
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
