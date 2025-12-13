// app/orders/_layout.js
import { Stack } from 'expo-router';

export default function OrdersLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'card',
        animation: 'none',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="calendar" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="all-orders" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="my-orders" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="[id]" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="create-order" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="order-success" options={{ headerShown: false, presentation: 'card' }} />
    </Stack>
  );
}

