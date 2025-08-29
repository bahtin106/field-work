import { Tabs } from 'expo-router';
import { useTheme } from '../../theme/ThemeProvider';

export default function TabLayout() {
  const { theme } = useTheme();
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
        tabBarLabelPosition: 'beside-icon', // ⬅ важно для центрирования текста
        sceneContainerStyle: { backgroundColor: theme.colors.background },}}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Главная',
          tabBarIcon: () => null, // ⬅ чтобы не было сдвига влево
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Мои заявки',
          tabBarIcon: () => null,
        }}
      />
    
<Tabs.Screen
  name="calendar"
  options={{ title: 'Календарь', tabBarIcon: () => null }}
/>
<Tabs.Screen
  name="all-orders"
  options={{ href: null }}
/>
    </Tabs>
  );
}
