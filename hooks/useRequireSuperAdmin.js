import { useRouter } from 'expo-router';
import React from 'react';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { useSuperAdminAccess } from './useSuperAdminAccess';

export function useRequireSuperAdmin() {
  const router = useRouter();
  const { isInitializing: isAuthInitializing, isAuthenticated } = useAuthContext();
  const { isSuperAdmin, isLoading, error } = useSuperAdminAccess();

  React.useEffect(() => {
    if (isAuthInitializing || !isAuthenticated || isLoading) return;
    if (!isSuperAdmin) {
      router.replace('/orders');
    }
  }, [isAuthenticated, isAuthInitializing, isLoading, isSuperAdmin, router]);

  return {
    isAllowed: isSuperAdmin,
    isLoading: isAuthInitializing || isLoading,
    error,
  };
}
