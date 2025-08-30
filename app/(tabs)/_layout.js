import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

const DEFAULT_THEME = {
  colors: {
    card: '#FFFFFF',
    border: '#E5E5EA',
    text: '#111111',
    background: '#FFFFFF',
  },
  text: { muted: { color: '#8E8E93' } },
};

export default function TabLayout() {
  // Защита от падения, если ThemeProvider ещё не смонтирован
  let theme = DEFAULT_THEME;
  try {
    const ctx = useTheme?.();
    if (ctx?.theme) theme = ctx.theme;
  } catch {
    // ignore, используем DEFAULT_THEME
  }

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: theme.colors.card, borderTopColor: theme.colors.border },
        tabBarActiveTintColor: theme.colors.text,
        tabBarInactiveTintColor: theme.text.muted.color,
        headerShown: false,
        tabBarLabelStyle: {
          fontSize: 14,
          fontWeight: '600',
        },
        tabBarItemStyle: {
          justifyContent: 'center',
        },
        sceneContainerStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Главная',
          tabBarIcon: () => <View style={{ width: 0, height: 0 }} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Мои заявки',
          tabBarIcon: () => <View style={{ width: 0, height: 0 }} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Календарь',
          tabBarIcon: () => <View style={{ width: 0, height: 0 }} />,
        }}
      />
      <Tabs.Screen name="all-orders" options={{ href: null }} />
    </Tabs>
  );
}
