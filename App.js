import Router from 'expo-router';
import * as Notifications from 'expo-notifications';
import { View } from 'react-native';
import { useAppLastSeen } from './useAppLastSeen';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  useAppLastSeen(); // touch profiles.last_seen_at on start/foreground

  return (
    <View style={{ flex: 1 }}>
      <Router />
    </View>
  );
}
