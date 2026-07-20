import { supabase } from '../../../lib/supabase';
import {
  enqueueTrashRestore,
  getOfflineSnapshot,
  isOfflineLikeError,
} from '../../shared/offline/offlineStatus';

export type TrashEntityType = 'order' | 'client' | 'client_object' | 'media';

export type TrashListItem = {
  id: string;
  entity_type: TrashEntityType;
  entity_id: string;
  title: string;
  subtitle?: string | null;
  thumbnail_url?: string | null;
  deleted_at: string;
  purge_at: string;
  deleted_by?: string | null;
  deleted_by_name?: string | null;
  child_count?: number;
  total_count?: number;
};

export async function listTrashItems({ search = '', entityType = '', sort = 'purge_at', limit = 100, offset = 0 }: {
  search?: string;
  entityType?: TrashEntityType | '';
  sort?: 'purge_at' | 'deleted_desc' | 'title';
  limit?: number;
  offset?: number;
} = {}) {
  const { data, error } = await supabase.rpc('list_trash_items', {
    p_search: String(search || '').trim() || null,
    p_entity_type: entityType || null,
    p_sort: sort,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as TrashListItem[];
}

export async function getTrashItem(id: string) {
  const { data, error } = await supabase.rpc('get_trash_item', { p_id: id });
  if (error) throw error;
  return data as TrashListItem & { data: Record<string, unknown> };
}

export async function restoreTrashItem(id: string) {
  if (!getOfflineSnapshot().isOnline) {
    await enqueueTrashRestore(id);
    return { queued: true };
  }
  const { error } = await supabase.rpc('restore_trash_item', { p_id: id });
  if (!error) return { queued: false };
  if (!isOfflineLikeError(error)) throw error;
  await enqueueTrashRestore(id);
  return { queued: true };
}

export async function purgeTrashItem(id: string) {
  if (!getOfflineSnapshot().isOnline) {
    throw new Error('TRASH_PURGE_REQUIRES_ONLINE');
  }
  const { error } = await supabase.rpc('purge_trash_item', { p_id: id });
  if (error) throw error;
  return true;
}
