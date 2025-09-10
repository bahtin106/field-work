// lib/push.js
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function registerForPushTokensAsync() {
  if (!Device.isDevice) {
    throw new Error('Тестировать нужно на реальном устройстве');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    throw new Error('Разрешения на уведомления не даны');
  }

  const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Нет projectId в app.json');

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  return token; // строка вида ExponentPushToken[xxxxx]
}

export function attachNotificationLogs() {
  const sub1 = Notifications.addNotificationReceivedListener((n) => {
    console.log('🔔 Foreground:', n);
  });
  const sub2 = Notifications.addNotificationResponseReceivedListener((r) => {
    console.log('👉 Clicked:', r);
  });
  return () => { sub1.remove(); sub2.remove(); };
}
