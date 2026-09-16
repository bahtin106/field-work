import Constants from 'expo-constants';
import { Platform } from 'react-native';

let notificationsModulePromise = null;

export function canLoadNotificationsModule() {
  if (Platform.OS === 'web') return false;
  // Importing expo-notifications itself throws in Expo Go on Android since
  // remote push support was removed from that client in SDK 53.
  return !(Platform.OS === 'android' && Constants?.appOwnership === 'expo');
}

export async function loadNotificationsModule() {
  if (!canLoadNotificationsModule()) return null;
  if (!notificationsModulePromise) {
    notificationsModulePromise = import('expo-notifications').catch((error) => {
      notificationsModulePromise = null;
      throw error;
    });
  }
  return notificationsModulePromise;
}
