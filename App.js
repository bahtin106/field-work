import Router from 'expo-router';
import { View } from 'react-native';
import { useAppLastSeen } from './useAppLastSeen';

export default function App() {
  useAppLastSeen(); // touch profiles.last_seen_at on start/foreground

  return (
    <View style={{ flex: 1 }}>
      <Router />
    </View>
  );
}
