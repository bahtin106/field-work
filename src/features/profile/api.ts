import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';
import { inspectProfileMedia } from '../profileMedia/api';

function isAuthSessionMissing(error: unknown) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('authsessionmissingerror') || message.includes('auth session missing');
}

export async function getCurrentUser() {
  return measureNetwork('profile.getCurrentUser', async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if (isAuthSessionMissing(error)) return null;
      throw error;
    }
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
    if (!data) return null;
    const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(
      [String(data?.avatar_url || '').trim()].filter(Boolean),
    );
    if (cleanedUrls.includes(String(data?.avatar_url || '').trim())) {
      return { ...data, avatar_url: null, avatar_display_url: null };
    }
    return {
      ...data,
      avatar_display_url: resolvedUrls[String(data?.avatar_url || '').trim()] || data?.avatar_url || null,
    };
  });
}

export async function getMyCompanyId() {
  const profile = await getMyProfile();
  return profile?.company_id || null;
}
