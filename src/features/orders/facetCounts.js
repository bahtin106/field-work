import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getStatusDbAliases, normalizeOrderStatusFilterKey } from '../../../lib/orderFilters';
import { supabase } from '../../../lib/supabase';

const EMPTY_COUNTS = Object.freeze({
  version: 0,
  total: 0,
  statuses: {},
  workTypes: {},
  clients: {},
  objects: {},
  executors: {},
  clientTags: {},
  objectTags: {},
});
const FACET_COUNTS_STALE_TIME_MS = 60 * 1000;
const FACET_FALLBACK_PAGE_SIZE = 1000;
const FACET_RELATION_CHUNK_SIZE = 100;

function normalizeCountMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [String(key || '').trim(), Number(count)])
      .filter(([key, count]) => key && Number.isFinite(count) && count >= 0),
  );
}

function normalizeFacetCounts(value) {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== 'object') return null;
  const total = Number(source.total);
  const version = Number(source.version);
  return {
    version: Number.isFinite(version) && version >= 0 ? version : 0,
    total: Number.isFinite(total) && total >= 0 ? total : 0,
    statuses: normalizeCountMap(source.statuses),
    workTypes: normalizeCountMap(source.workTypes),
    clients: normalizeCountMap(source.clients),
    objects: normalizeCountMap(source.objects),
    executors: normalizeCountMap(source.executors),
    clientTags: normalizeCountMap(source.clientTags),
    objectTags: normalizeCountMap(source.objectTags),
  };
}

function addOrderTagCounts(target, tags) {
  const uniqueValues = new Set(
    (Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag?.value ?? tag ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  uniqueValues.forEach((value) => {
    target[value] = (target[value] || 0) + 1;
  });
}

export async function fetchAccessibleFeedCount() {
  const aliases = getStatusDbAliases('feed');
  if (!aliases.length) return 0;
  const { count, error } = await supabase
    .from('orders_accessible')
    .select('id', { count: 'exact', head: true })
    .is('assigned_to', null)
    .in('status', aliases);
  if (error) throw error;
  return Number.isFinite(Number(count)) ? Number(count) : 0;
}

function excludeFeedStatuses(query) {
  const feedStatusValues = getStatusDbAliases('feed').filter(Boolean);
  if (!feedStatusValues.length) return query;
  const encoded = feedStatusValues
    .map((value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',');
  return query.or(`status.is.null,status.not.in.(${encoded})`);
}

async function fetchOrderFacetRows(scope) {
  let userId = '';
  if (scope === 'my') {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    userId = String(userData?.user?.id || '').trim();
    if (!userId) return [];
  }

  const rows = [];
  for (let from = 0; ; from += FACET_FALLBACK_PAGE_SIZE) {
    let query = supabase
      .from('orders_accessible')
      .select('id,status,work_type_id,client_id,object_id,assigned_to')
      .order('id', { ascending: true });
    if (scope === 'my') query = query.eq('assigned_to', userId);
    query = excludeFeedStatuses(query);

    const { data, error } = await query.range(from, from + FACET_FALLBACK_PAGE_SIZE - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < FACET_FALLBACK_PAGE_SIZE) break;
  }

  const fetchTagValuesByOwner = async (table, ownerColumn, ownerIds, tagType) => {
    const uniqueOwnerIds = Array.from(
      new Set((Array.isArray(ownerIds) ? ownerIds : []).map(String).filter(Boolean)),
    );
    if (!uniqueOwnerIds.length) return new Map();

    const links = [];
    for (let offset = 0; offset < uniqueOwnerIds.length; offset += FACET_RELATION_CHUNK_SIZE) {
      const chunk = uniqueOwnerIds.slice(offset, offset + FACET_RELATION_CHUNK_SIZE);
      const { data, error } = await supabase
        .from(table)
        .select(`${ownerColumn},tag_id`)
        .in(ownerColumn, chunk);
      if (error) throw error;
      links.push(...(Array.isArray(data) ? data : []));
    }

    const tagIds = Array.from(
      new Set(links.map((link) => String(link?.tag_id || '')).filter(Boolean)),
    );
    const tagValueById = new Map();
    for (let offset = 0; offset < tagIds.length; offset += FACET_RELATION_CHUNK_SIZE) {
      const chunk = tagIds.slice(offset, offset + FACET_RELATION_CHUNK_SIZE);
      const { data, error } = await supabase
        .from('company_tags')
        .select('id,value,tag_type')
        .eq('tag_type', tagType)
        .in('id', chunk);
      if (error) throw error;
      (Array.isArray(data) ? data : []).forEach((tag) => {
        const id = String(tag?.id || '').trim();
        const value = String(tag?.value || '').trim();
        if (id && value) tagValueById.set(id, value);
      });
    }

    const valuesByOwner = new Map();
    links.forEach((link) => {
      const ownerId = String(link?.[ownerColumn] || '').trim();
      const value = tagValueById.get(String(link?.tag_id || '').trim());
      if (!ownerId || !value) return;
      if (!valuesByOwner.has(ownerId)) valuesByOwner.set(ownerId, new Set());
      valuesByOwner.get(ownerId).add(value);
    });
    return new Map(
      Array.from(valuesByOwner, ([ownerId, values]) => [ownerId, Array.from(values)]),
    );
  };

  const [clientTagsByClientId, objectTagsByObjectId] = await Promise.all([
    fetchTagValuesByOwner(
      'client_tag_links',
      'client_id',
      rows.map((row) => row?.client_id),
      'client',
    ),
    fetchTagValuesByOwner(
      'object_tag_links',
      'object_id',
      rows.map((row) => row?.object_id),
      'object',
    ),
  ]);

  return rows.map((row) => ({
    ...row,
    client_tags: clientTagsByClientId.get(String(row?.client_id || '')) || [],
    object_tags: objectTagsByObjectId.get(String(row?.object_id || '')) || [],
  }));
}

export async function fetchOrderFacetCounts(
  scope = 'all',
  statusOptions = [],
  { verifyClientTags = false, verifyObjectTags = false, verifyObjects = false } = {},
) {
  const normalizedScope = scope === 'my' ? 'my' : 'all';
  const { data, error } = await supabase.rpc('get_order_filter_facet_counts', {
    p_scope: normalizedScope,
  });
  if (!error) {
    const remoteCounts = normalizeFacetCounts(data) || EMPTY_COUNTS;
    const needsTagVerification =
      remoteCounts.version < 2 &&
      remoteCounts.total > 0 &&
      ((verifyClientTags && Object.keys(remoteCounts.clientTags).length === 0) ||
        (verifyObjectTags && Object.keys(remoteCounts.objectTags).length === 0));
    const needsObjectVerification =
      verifyObjects && remoteCounts.version < 3 && remoteCounts.total > 0;
    if (!needsTagVerification && !needsObjectVerification) return remoteCounts;
  }

  // Keeps a new app release compatible while the database migration is still
  // rolling out or when an older RPC cannot expose related tags. The fallback
  // is exact and paginated, but the RPC remains the normal production path.
  const rows = await fetchOrderFacetRows(normalizedScope);
  return buildOrderFacetCounts(rows, statusOptions);
}

function addAlias(map, value, statusId) {
  const key = String(value || '').trim();
  if (!key) return;
  map.set(key, statusId);
  map.set(key.toLocaleLowerCase(), statusId);
}

/**
 * Builds filter facets from the currently available order collection.
 * Statuses in the database may be stored as legacy labels or canonical keys;
 * both are resolved to the status IDs used by the filter UI.
 */
export function buildOrderFacetCounts(orders, statusOptions) {
  if (!Array.isArray(orders) || orders.length === 0) return EMPTY_COUNTS;

  const statusAliases = new Map();
  (Array.isArray(statusOptions) ? statusOptions : []).forEach((option) => {
    const id = String(option?.id ?? option?.value ?? '').trim();
    if (!id || id === 'all') return;
    addAlias(statusAliases, id, id);
    addAlias(statusAliases, normalizeOrderStatusFilterKey(id), id);
    getStatusDbAliases(id).forEach((alias) => addAlias(statusAliases, alias, id));
  });

  const counts = {
    version: 0,
    total: orders.length,
    statuses: {},
    workTypes: {},
    clients: {},
    objects: {},
    executors: {},
    clientTags: {},
    objectTags: {},
  };
  orders.forEach((order) => {
    const rawStatus = String(order?.status || '').trim();
    const statusId =
      statusAliases.get(rawStatus) ||
      statusAliases.get(rawStatus.toLocaleLowerCase()) ||
      statusAliases.get(normalizeOrderStatusFilterKey(rawStatus));
    if (statusId) counts.statuses[statusId] = (counts.statuses[statusId] || 0) + 1;

    const workTypeId = String(order?.work_type_id || '').trim();
    if (workTypeId) counts.workTypes[workTypeId] = (counts.workTypes[workTypeId] || 0) + 1;

    const clientId = String(order?.client_id || '').trim();
    if (clientId) counts.clients[clientId] = (counts.clients[clientId] || 0) + 1;

    const objectId = String(order?.object_id || '').trim();
    if (objectId) counts.objects[objectId] = (counts.objects[objectId] || 0) + 1;

    const executorId = String(order?.assigned_to || '').trim();
    if (executorId) counts.executors[executorId] = (counts.executors[executorId] || 0) + 1;

    addOrderTagCounts(counts.clientTags, order?.client_tags);
    addOrderTagCounts(counts.objectTags, order?.object_tags);
  });

  return counts;
}

/**
 * Facets prefer exact counts for the complete accessible scope. The currently
 * loaded rows are used only until the remote aggregate or compatibility
 * fallback resolves.
 */
export function useOrderFacetCounts(
  orders,
  statusOptions,
  {
    enabled = true,
    scope = null,
    scopeKey = 'default',
    statusOverrides = null,
    verifyClientTags = false,
    verifyObjectTags = false,
    verifyObjects = false,
  } = {},
) {
  const localCounts = useMemo(
    () => buildOrderFacetCounts(orders, statusOptions),
    [orders, statusOptions],
  );
  const normalizedScope = scope === 'my' || scope === 'all' ? scope : null;
  const statusOptionsKey = useMemo(
    () =>
      (Array.isArray(statusOptions) ? statusOptions : [])
        .map((option) => String(option?.id ?? option?.value ?? '').trim())
        .filter(Boolean)
        .join('|'),
    [statusOptions],
  );
  const remoteCountsQuery = useQuery({
    queryKey: [
      'requests',
      normalizedScope || 'local',
      'facets-v3',
      String(scopeKey || 'default'),
      statusOptionsKey,
      verifyClientTags,
      verifyObjectTags,
      verifyObjects,
    ],
    queryFn: () =>
      fetchOrderFacetCounts(normalizedScope, statusOptions, {
        verifyClientTags,
        verifyObjectTags,
        verifyObjects,
      }),
    enabled: enabled && normalizedScope != null,
    staleTime: FACET_COUNTS_STALE_TIME_MS,
    retry: 1,
  });
  const current = remoteCountsQuery.data || localCounts;

  return useMemo(() => {
    const validStatusIds = new Set(
      (Array.isArray(statusOptions) ? statusOptions : [])
        .map((option) => String(option?.id ?? option?.value ?? '').trim())
        .filter((id) => id && id !== 'all'),
    );

    const nextStatuses = { ...current.statuses };

    if (statusOverrides && typeof statusOverrides === 'object') {
      Object.entries(statusOverrides).forEach(([id, value]) => {
        const count = Number(value);
        if (validStatusIds.has(id) && Number.isFinite(count)) nextStatuses[id] = count;
      });
    }

    validStatusIds.forEach((id) => {
      if (!Number.isFinite(Number(nextStatuses[id]))) nextStatuses[id] = 0;
    });

    return { ...current, statuses: nextStatuses };
  }, [current, statusOptions, statusOverrides]);
}
