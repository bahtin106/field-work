import Router from 'expo-router';
import * as Notifications from 'expo-notifications';
import { View } from 'react-native';
import { useAppLastSeen } from './useAppLastSeen';
import { shouldSuppressForegroundOrderNotification } from './lib/notificationForegroundState';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const suppress = shouldSuppressForegroundOrderNotification(notification);
    return {
      shouldShowBanner: !suppress,
      shouldShowList: !suppress,
      shouldPlaySound: !suppress,
      shouldSetBadge: false,
    };
  },
});

export default function App() {
  useAppLastSeen(); // touch profiles.last_seen_at on start/foreground

  return (
    <View style={{ flex: 1 }}>
      <Router />
    </View>
  );
}
