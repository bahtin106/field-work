import { useCallback, useEffect, useMemo } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Держим сплэш, пока не отрисуется первый экран логина (без «вспышки»)
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
    <Stack screenOptions={{ headerShown: false }} onLayout={onLayoutRootView}>
      <Stack.Screen name="login" />
    </Stack>
  );
}