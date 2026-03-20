// app/(auth)/_layout.js
import { Stack } from 'expo-router';
import { View } from 'react-native';

export default function AuthLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack
        initialRouteName="login"
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
      </Stack>
    </View>
  );
}
