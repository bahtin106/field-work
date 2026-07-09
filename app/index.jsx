import { useEffect } from 'react';
import { usePathname, useRouter } from 'expo-router';

import { useAuthContext } from '../providers/SimpleAuthProvider';

export default function Index() {
  const { isInitializing, isAuthenticated } = useAuthContext();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isInitializing) return;
    const normalizedPathname = String(pathname || '').trim().replace(/\/+$/, '') || '/';
    if (normalizedPathname !== '/') return;
    router.replace(isAuthenticated ? '/orders' : '/(auth)/login');
  }, [isAuthenticated, isInitializing, pathname, router]);

  return null;
}
