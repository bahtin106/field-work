import Constants from 'expo-constants';

export function getAppVersion() {
  const expoConfigVersion = Constants?.expoConfig?.version;
  const isExpoGo = Constants?.appOwnership === 'expo';

  if (isExpoGo) return expoConfigVersion || '';

  return Constants?.nativeAppVersion || expoConfigVersion || '';
}
