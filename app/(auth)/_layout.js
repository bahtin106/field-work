// app/(auth)/_layout.js
import { Stack } from 'expo-router';
import { useRef } from 'react';
import { View } from 'react-native';
import { getLastPublicAuthScreen } from '../../lib/authFlowNavigationState';

export default function AuthLayout() {
  const initialAuthScreenRef = useRef(getLastPublicAuthScreen('login'));

  return (
    <View style={{ flex: 1 }}>
      <Stack
        initialRouteName={initialAuthScreenRef.current}
        screenOptions={{
          headerShown: false,
          animation: 'none',
          animationTypeForReplace: 'push',
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          freezeOnBlur: true,
        }}
      >
        <Stack.Screen name="login" />
        <Stack.Screen name="blocked" />
        <Stack.Screen name="register" />
        <Stack.Screen name="register-code" />
        <Stack.Screen name="verify-email" />
        <Stack.Screen name="set-password" />
      </Stack>
    </View>
  );
}
