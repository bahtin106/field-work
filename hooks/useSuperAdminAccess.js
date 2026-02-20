import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

async function fetchSuperAdminAccess() {
  const { data, error } = await supabase.rpc('is_super_admin');
  if (error) throw error;
  return data === true;
}

export function useSuperAdminAccess() {
  const query = useQuery({
    queryKey: ['superAdminAccess'],
    queryFn: fetchSuperAdminAccess,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    isSuperAdmin: query.data === true,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
