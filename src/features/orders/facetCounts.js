import { useMemo, useRef } from 'react';
import { getStatusDbAliases, normalizeOrderStatusFilterKey } from '../../../lib/orderFilters';
import { supabase } from '../../../lib/supabase';

const EMPTY_COUNTS = Object.freeze({ total: 0, statuses: {}, workTypes: {}, clients: {} });

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

  const counts = { total: orders.length, statuses: {}, workTypes: {}, clients: {} };
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
  });

  return counts;
}

/**
 * Keeps known status facets when the visible request collection is narrowed
 * by a status. Other facets still follow the current collection.
 */
export function useOrderFacetCounts(
  orders,
  statusOptions,
  { isStatusNarrowed = false, scopeKey = 'default', statusOverrides = null } = {},
) {
  const current = useMemo(
    () => buildOrderFacetCounts(orders, statusOptions),
    [orders, statusOptions],
  );
  const retainedRef = useRef({ scopeKey: '', statuses: {} });

  return useMemo(() => {
    const normalizedScopeKey = String(scopeKey || 'default');
    const validStatusIds = new Set(
      (Array.isArray(statusOptions) ? statusOptions : [])
        .map((option) => String(option?.id ?? option?.value ?? '').trim())
        .filter((id) => id && id !== 'all'),
    );

    if (retainedRef.current.scopeKey !== normalizedScopeKey) {
      retainedRef.current = { scopeKey: normalizedScopeKey, statuses: {} };
    }

    const retainedStatuses = Object.fromEntries(
      Object.entries(retainedRef.current.statuses).filter(([id]) => validStatusIds.has(id)),
    );
    const nextStatuses = isStatusNarrowed
      ? { ...retainedStatuses, ...current.statuses }
      : { ...current.statuses };

    if (statusOverrides && typeof statusOverrides === 'object') {
      Object.entries(statusOverrides).forEach(([id, value]) => {
        const count = Number(value);
        if (validStatusIds.has(id) && Number.isFinite(count)) nextStatuses[id] = count;
      });
    }

    validStatusIds.forEach((id) => {
      if (!Number.isFinite(Number(nextStatuses[id]))) nextStatuses[id] = 0;
    });

    retainedRef.current = { scopeKey: normalizedScopeKey, statuses: nextStatuses };
    const total = Object.values(nextStatuses).reduce(
      (sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0),
      0,
    );
    return { ...current, total, statuses: nextStatuses };
  }, [current, isStatusNarrowed, scopeKey, statusOptions, statusOverrides]);
}
