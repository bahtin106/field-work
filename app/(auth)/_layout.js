// app/(auth)/_layout.js
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect } from 'react';

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
    <Stack
      screenOptions={{ headerShown: false }}
      initialRouteName="login"
      onLayout={onLayoutRootView}
    >
      <Stack.Screen name="login" />
    </Stack>
  );
}
