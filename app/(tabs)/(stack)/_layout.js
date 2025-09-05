// app/(tabs)/(stack)/_layout.js
import { Stack } from 'expo-router';

export default function TabsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'simple_push',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        animationTypeForReplace: 'push',
        gestureDirection: 'horizontal',
      }}
    />
  );
}
