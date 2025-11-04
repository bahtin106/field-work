import Router from 'expo-router';
import { useAppLastSeen } from './useAppLastSeen';

export default function App() {
  useAppLastSeen(); // touch profiles.last_seen_at on start/foreground
  return <Router />;
}
