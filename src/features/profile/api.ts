import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';

export async function getCurrentUser() {
  return measureNetwork('profile.getCurrentUser', async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data?.user || null;
  });
}

export async function getMyProfile() {
  return measureNetwork('profile.getMyProfile', async () => {
    const user = await getCurrentUser();
    if (!user?.id) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  });
}

export async function getMyCompanyId() {
  const profile = await getMyProfile();
  return profile?.company_id || null;
}
