// lib/push.js
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// 1) Запрос разрешений + получение Expo push token
export async function registerForPushTokensAsync() {
  if (!Device.isDevice) throw new Error('Тестировать нужно на реальном устройстве');

  // Android: канал
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  // Разрешения
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') throw new Error('Разрешения на уведомления не даны');

  // Токен
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ||
    Constants?.easConfig?.projectId;
  if (!projectId) throw new Error('Нет projectId (app.json -> expo.extra.eas.projectId)');

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  return token; // "ExponentPushToken[xxxxx]"
}

// 2) Сохранить токен в БД (public.push_tokens)
export async function savePushTokenToSupabase(token) {
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) throw new Error('Нет авторизованного пользователя');

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, token, platform },
      { onConflict: 'token' } // в таблице есть unique(token)
    );

  if (error) throw error;
}

// 3) Удобный комбинированный вызов
export async function registerAndSavePushToken() {
  const token = await registerForPushTokensAsync();
  await savePushTokenToSupabase(token);
  return token;
}

// 4) Логи получения/клика по пушам (для отладки)
export function attachNotificationLogs() {
  const sub1 = Notifications.addNotificationReceivedListener((n) => {
    console.log('🔔 Foreground:', n);
  });
  const sub2 = Notifications.addNotificationResponseReceivedListener((r) => {
    console.log('👉 Clicked:', r);
  });
  return () => { sub1.remove(); sub2.remove(); };
}
