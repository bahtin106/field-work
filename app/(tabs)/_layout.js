// app/(tabs)/_layout.js
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
  let ctx;
  try {
    ctx = useTheme();
  } catch {
    ctx = null;
  }
  const theme = ctx?.theme ?? DEFAULT_THEME;

  return (
    <Tabs
      // ВАЖНО: здесь только tab-вещи. Никаких stack-анимаций.
      screenOptions={{
        headerShown: false,
        sceneContainerStyle: { backgroundColor: theme.colors.background },
        tabBarStyle: { backgroundColor: theme.colors.card, borderTopColor: theme.colors.border },
        tabBarActiveTintColor: theme.colors.text,
        tabBarInactiveTintColor: theme.text?.muted?.color ?? '#6B7280',
        tabBarLabelStyle: { fontSize: 14, fontWeight: '600' },
        tabBarItemStyle: { justifyContent: 'center' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Главная',
          // заглушка иконки, чтобы не падало, если иконки ещё нет
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
      {/* экран-утилита без вкладки */}
      <Tabs.Screen name="all-orders" options={{ href: null, title: 'Все заявки' }} />
    </Tabs>
  );
}
