// app/(auth)/_layout.js
import React, { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

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
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <Stack
        initialRouteName="login"
        screenOptions={{
          headerShown: false, // убираем хедер чтобы исключить лишний текст
        }}
      >
        <Stack.Screen name="login" />
      </Stack>
    </View>
  );
}
