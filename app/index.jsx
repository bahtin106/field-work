import { Redirect } from 'expo-router';

import { useAuthContext } from '../providers/SimpleAuthProvider';

export default function Index() {
  const { isInitializing, isAuthenticated } = useAuthContext();

  if (isInitializing) return null;
  return <Redirect href={isAuthenticated ? '/orders' : '/(auth)/login'} />;
}
