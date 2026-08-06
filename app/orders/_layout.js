// app/orders/_layout.js
import { Stack } from 'expo-router';
import { renderNavigationScreen } from '../../components/navigation/NavigationCommitBoundary';
import { useTheme } from '../../theme/ThemeProvider';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function OrdersLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenLayout={renderNavigationScreen}
      screenOptions={{
        headerShown: false,
        presentation: 'card',
        animation: 'none',
        animationTypeForReplace: 'push',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        freezeOnBlur: true,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="calendar" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="all-orders" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="my-orders" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="[id]" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="create-order" options={{ headerShown: false, presentation: 'card' }} />
    </Stack>
  );
}

