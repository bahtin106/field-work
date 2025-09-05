// app/settings/index.jsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme/ThemeProvider';
import Screen from '../../components/layout/Screen';


export default function SettingsIndex() {
  const { theme } = useTheme();
  const router = useRouter();
  const items = [
    { title: 'Профиль', route: '/settings/sections/ProfileSettings' },
    { title: 'Уведомления', route: '/settings/sections/NotificationSettings' },
    { title: 'Доступы и роли', route: '/settings/sections/RoleAccessSettings' },
    { title: 'Подписка', route: '/settings/sections/SubscriptionSettings' },
    { title: 'Расширенные', route: '/settings/sections/AdvancedSettings' },
  ];

  return (
    <Screen background="background" edges={['top','bottom']}>
      <View style={{ flex: 1, justifyContent: 'flex-start', paddingHorizontal: theme?.spacing?.md ?? 16 }}>
        <View style={{ backgroundColor: theme?.colors?.surface, borderRadius: theme?.radius?.xl ?? 16, overflow: 'hidden', marginTop: theme?.spacing?.xs ?? 8, borderWidth: 1, borderColor: theme?.colors?.border }}>
          {items.map((item, idx) => (
            <TouchableOpacity
              key={item.route}
              onPress={() => router.push(item.route)}
              style={{
                paddingVertical: 16,
                paddingHorizontal: 16,
                borderBottomWidth: idx === items.length - 1 ? 0 : 1,
                borderBottomColor: theme?.colors?.border,
              }}
            >
              <Text style={{ ...(theme?.typography?.body ?? {}), fontSize: (theme?.typography?.body?.fontSize ?? 16) }}>{item.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Screen>
  );
}
