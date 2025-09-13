// app/(auth)/_layout.js
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect } from 'react';
import { View } from 'react-native'; // ← добавили

// Держим сплэш, пока не отрисуется первый экран логина
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function AuthLayout() {
  const onLayoutRootView = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    // На случай, если onLayout не отработает
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}> {/* ← перенесли onLayout сюда */}
      <Stack screenOptions={{ headerShown: false }} initialRouteName="login">
        <Stack.Screen name="login" />
      </Stack>
    </View>
  );
}
