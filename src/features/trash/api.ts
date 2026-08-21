import { supabase } from '../../../lib/supabase';
import { APP_RUNTIME_CONFIG } from '../../../config/appRuntime';
import {
  canRunOutboxSync,
  enqueueTrashRestore,
  isOfflineLikeError,
} from '../../shared/offline/offlineStatus';
import {
  assertMutationAuthCarrier,
  isActiveMutationAuthCarrier,
  pinMutationAuthorization,
  type MutationAuthCarrier,
} from '../../shared/security/mutationAuthCarrier';

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

export type TrashFilters = {
  entityTypes?: TrashEntityType[];
  deletedByIds?: string[];
  deletedDateFrom?: string | null;
  deletedDateTo?: string | null;
  statuses?: string[];
  workTypes?: string[];
  clientIds?: string[];
  executorIds?: string[];
  clientTags?: string[];
  objectTags?: string[];
  cities?: string[];
  streets?: string[];
  mediaOwnerTypes?: string[];
  departureDateFrom?: string | null;
  departureDateTo?: string | null;
  departureTimeFrom?: string | null;
  departureTimeTo?: string | null;
  createdDateFrom?: string | null;
  createdDateTo?: string | null;
  createdTimeFrom?: string | null;
  createdTimeTo?: string | null;
  sumMin?: string;
  sumMax?: string;
};

export type TrashFilterOption = { id: string; label?: string; count?: number };
export type TrashFilterOptions = {
  entityTypes?: TrashFilterOption[];
  deletedBy?: TrashFilterOption[];
  statuses?: TrashFilterOption[];
  workTypes?: TrashFilterOption[];
  clients?: TrashFilterOption[];
  executors?: TrashFilterOption[];
  cities?: TrashFilterOption[];
  streets?: TrashFilterOption[];
  clientTags?: TrashFilterOption[];
  objectTags?: TrashFilterOption[];
  mediaOwnerTypes?: TrashFilterOption[];
};

export type TrashMediaOrigin = {
  owner_type: 'order' | 'object' | 'finance_entry' | string;
  owner_id: string | null;
  title: string;
  status: 'active' | 'trash' | 'missing';
  route_entity_id: string | null;
  finance_entry_id: string | null;
  trash_entry_id: string | null;
};

export type TrashMutationOwnerContext = MutationAuthCarrier;

export function isActiveTrashMutationOwnerContext(
  context: TrashMutationOwnerContext | null | undefined,
) {
  return isActiveMutationAuthCarrier(context, { requireOfflineOwner: true });
}

function assertTrashMutationOwnerContext(
  context: TrashMutationOwnerContext | null | undefined,
) {
  return assertMutationAuthCarrier(context, { requireOfflineOwner: true });
}

function resolveTrashMutationOwnerContext(context: TrashMutationOwnerContext) {
  return assertTrashMutationOwnerContext(context);
}

export function buildTrashMediaUrl(item: Pick<TrashListItem, 'id' | 'entity_type'> | null | undefined, {
  raw = false,
  width = 512,
  height = 512,
} = {}) {
  const id = String(item?.id || '').trim();
  if (!id || item?.entity_type !== 'media' || !APP_RUNTIME_CONFIG.supabaseUrl) return '';
  const params = new URLSearchParams({
    trash_id: id,
    w: String(width),
    h: String(height),
    fit: 'fill',
  });
  if (raw) params.set('raw', '1');
  return `${APP_RUNTIME_CONFIG.supabaseUrl}/functions/v1/media-thumbnail?${params.toString()}`;
}

const compactFilters = (filters: TrashFilters = {}) => Object.fromEntries(
  Object.entries(filters).filter(([, value]) => (
    Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== ''
  )),
);

export async function listTrashItems({ search = '', filters = {}, sort = 'purge_at', limit = 100, offset = 0 }: {
  search?: string;
  filters?: TrashFilters;
  sort?: 'purge_at' | 'deleted_desc' | 'title';
  limit?: number;
  offset?: number;
} = {}, signal?: AbortSignal) {
  let request = supabase.rpc('list_trash_items_v2', {
    p_search: String(search || '').trim() || null,
    p_filters: compactFilters(filters),
    p_sort: sort,
    p_limit: limit,
    p_offset: offset,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as TrashListItem[];
}

export async function listTrashItemIds({ search = '', filters = {} }: {
  search?: string;
  filters?: TrashFilters;
} = {}, signal?: AbortSignal) {
  let request = supabase.rpc('list_trash_item_ids_v2', {
    p_search: String(search || '').trim() || null,
    p_filters: compactFilters(filters),
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(String).filter(Boolean);
}

export async function getTrashFilterOptions(signal?: AbortSignal) {
  let request = supabase.rpc('get_trash_filter_options');
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return (data && typeof data === 'object' ? data : {}) as TrashFilterOptions;
}

export async function getTrashItem(id: string, signal?: AbortSignal) {
  let request = supabase.rpc('get_trash_item', { p_id: id });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return data as TrashListItem & { data: Record<string, unknown> };
}

export async function getTrashMediaOrigin(id: string, signal?: AbortSignal) {
  let request = supabase.rpc('get_trash_media_origin', { p_id: id });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return data as TrashMediaOrigin;
}

export async function restoreTrashItem(id: string, context: TrashMutationOwnerContext) {
  const ownerContext = resolveTrashMutationOwnerContext(context);
  const assertOwnerContext = () => assertTrashMutationOwnerContext(ownerContext);
  assertOwnerContext();
  if (!canRunOutboxSync()) {
    await enqueueTrashRestore(id);
    assertOwnerContext();
    return { queued: true };
  }
  const request = pinMutationAuthorization(
    supabase.rpc('restore_trash_item', { p_id: id }),
    ownerContext,
    { requireOfflineOwner: true },
  );
  const { error } = await request;
  assertOwnerContext();
  if (!error) return { queued: false };
  if (!isOfflineLikeError(error)) throw error;
  await enqueueTrashRestore(id);
  assertOwnerContext();
  return { queued: true };
}

export async function purgeTrashItem(id: string, context: TrashMutationOwnerContext) {
  const ownerContext = resolveTrashMutationOwnerContext(context);
  assertTrashMutationOwnerContext(ownerContext);
  if (!canRunOutboxSync()) {
    throw new Error('TRASH_PURGE_REQUIRES_ONLINE');
  }
  const request = pinMutationAuthorization(
    supabase.rpc('purge_trash_item', { p_id: id }),
    ownerContext,
    { requireOfflineOwner: true },
  );
  const { error } = await request;
  assertTrashMutationOwnerContext(ownerContext);
  if (error) throw error;
  return true;
}

export async function restoreTrashItems(
  ids: string[],
  context: TrashMutationOwnerContext,
) {
  const normalizedIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean)));
  if (!normalizedIds.length) return { queued: false, count: 0 };
  const ownerContext = resolveTrashMutationOwnerContext(context);
  const assertOwnerContext = () => assertTrashMutationOwnerContext(ownerContext);
  assertOwnerContext();
  if (!canRunOutboxSync()) {
    await Promise.all(normalizedIds.map((id) => enqueueTrashRestore(id)));
    assertOwnerContext();
    return { queued: true, count: normalizedIds.length };
  }
  const request = pinMutationAuthorization(
    supabase.rpc('restore_trash_items', { p_ids: normalizedIds }),
    ownerContext,
    { requireOfflineOwner: true },
  );
  const { data, error } = await request;
  assertOwnerContext();
  if (!error) return { queued: false, count: Number(data || normalizedIds.length) };
  if (!isOfflineLikeError(error)) throw error;
  await Promise.all(normalizedIds.map((id) => enqueueTrashRestore(id)));
  assertOwnerContext();
  return { queued: true, count: normalizedIds.length };
}

export async function purgeTrashItems(
  ids: string[],
  context: TrashMutationOwnerContext,
) {
  const normalizedIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean)));
  if (!normalizedIds.length) return 0;
  const ownerContext = resolveTrashMutationOwnerContext(context);
  assertTrashMutationOwnerContext(ownerContext);
  if (!canRunOutboxSync()) throw new Error('TRASH_PURGE_REQUIRES_ONLINE');
  const request = pinMutationAuthorization(
    supabase.rpc('purge_trash_items', { p_ids: normalizedIds }),
    ownerContext,
    { requireOfflineOwner: true },
  );
  const { data, error } = await request;
  assertTrashMutationOwnerContext(ownerContext);
  if (error) throw error;
  return Number(data || normalizedIds.length);
}

export async function purgeAllTrashItems(context: TrashMutationOwnerContext) {
  const ownerContext = resolveTrashMutationOwnerContext(context);
  assertTrashMutationOwnerContext(ownerContext);
  if (!canRunOutboxSync()) throw new Error('TRASH_PURGE_REQUIRES_ONLINE');
  const request = pinMutationAuthorization(
    supabase.rpc('purge_all_trash_items'),
    ownerContext,
    { requireOfflineOwner: true },
  );
  const { data, error } = await request;
  assertTrashMutationOwnerContext(ownerContext);
  if (error) throw error;
  return Number(data || 0);
}
