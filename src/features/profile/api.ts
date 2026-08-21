import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';
import { queryClient } from '../../shared/query/queryClient';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  getCachedProfileMediaResolution,
  inspectProfileMedia,
  isRenderableProfileMediaUrl,
} from '../profileMedia/api';

function isAuthSessionMissing(error: any) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('authsessionmissingerror') || message.includes('auth session missing');
}

function throwIfReadAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('Profile read was aborted');
  error.name = 'AbortError';
  throw error;
}

export async function getCurrentUser(signal?: AbortSignal) {
  return measureNetwork('profile.getCurrentUser', async () => {
    const cachedProfile: any = queryClient.getQueryData(queryKeys.profile.me());
    if (cachedProfile?.id) return { id: cachedProfile.id };
    const { data, error } = await supabase.auth.getUser();
    throwIfReadAborted(signal);
    if (error) {
      if (isAuthSessionMissing(error)) return null;
      throw error;
    }
    return data?.user || null;
  });
}

export async function getMyProfile(signal?: AbortSignal) {
  return measureNetwork('profile.getMyProfile', async () => {
    const user = await getCurrentUser(signal);
    if (!user?.id) return null;

    let query = supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.maybeSingle();
    throwIfReadAborted(signal);

    if (error) throw error;
    if (!data) return null;
    const avatarUrl = String(data?.avatar_url || '').trim();
    const cachedAvatar = getCachedProfileMediaResolution(avatarUrl);

    if (avatarUrl && !cachedAvatar) {
      inspectProfileMedia([avatarUrl])
        .then(({ cleanedUrls, resolvedUrls }) => {
          const cleaned = cleanedUrls.includes(avatarUrl);
          const resolvedAvatarUrl = isRenderableProfileMediaUrl(String(resolvedUrls[avatarUrl] || '').trim())
            ? String(resolvedUrls[avatarUrl] || '').trim()
            : '';
          if (!cleaned && !resolvedAvatarUrl) return;
          queryClient.setQueryData(queryKeys.profile.me(), (prev: any) => ({
            ...(prev || data),
            avatar_url: cleaned ? null : avatarUrl,
            avatar_display_url: cleaned ? null : resolvedAvatarUrl,
          }));
          queryClient.setQueryData(['profile', user.id], (prev: any) => ({
            ...(prev || data),
            avatar_url: cleaned ? null : avatarUrl,
            avatar_display_url: cleaned ? null : resolvedAvatarUrl,
          }));
        })
        .catch(() => {});
    }

    if (cachedAvatar?.cleaned) {
      return { ...data, avatar_url: null, avatar_display_url: null };
    }

    const storedAvatarDisplayUrl = String(data?.avatar_display_url || '').trim();
    const directAvatarDisplayUrl = isRenderableProfileMediaUrl(storedAvatarDisplayUrl)
      ? storedAvatarDisplayUrl
      : isRenderableProfileMediaUrl(avatarUrl)
        ? avatarUrl
        : null;

    return {
      ...data,
      avatar_display_url: cachedAvatar?.resolvedUrl || directAvatarDisplayUrl,
    };
  });
}

export async function getMyCompanyId(signal?: AbortSignal) {
  return measureNetwork('profile.getMyCompanyId', async () => {
    const cachedCompanyId = String(queryClient.getQueryData(queryKeys.profile.companyId()) || '').trim();
    if (cachedCompanyId) return cachedCompanyId;
    const cachedProfile: any = queryClient.getQueryData(queryKeys.profile.me());
    const cachedProfileCompanyId = String(cachedProfile?.company_id || cachedProfile?.companyId || '').trim();
    if (cachedProfileCompanyId) {
      queryClient.setQueryData(queryKeys.profile.companyId(), cachedProfileCompanyId);
      return cachedProfileCompanyId;
    }

    const user = await getCurrentUser(signal);
    if (!user?.id) return null;

    let query = supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.maybeSingle();
    throwIfReadAborted(signal);

    if (error) throw error;
    return data?.company_id || null;
  });
}
