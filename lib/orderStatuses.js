import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  applyCompanySettingsCachePatch,
  broadcastCompanySettingsChanged,
} from './companySettingsQuery';
import { supabase } from './supabase';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { useAuthContext } from '../providers/SimpleAuthProvider';

export const ORDER_STATUS_LIMIT = 10;
export const ORDER_STATUS_FEED_KEY = 'feed';

const STATUS_SELECT = 'id, company_id, status_key, name, is_feed, sort_order, created_at, updated_at';
const BUILTIN_STATUS_LABEL_KEYS = Object.freeze({
  feed: 'order_status_in_feed',
  new: 'order_status_new',
  in_progress: 'order_status_in_progress',
  done: 'order_status_completed',
  waiting: 'order_status_waiting',
});

// Default rows are created once in the database and keep their original name.
// Localize only those canonical names; a name changed by an administrator must
// remain exactly as they entered it.
const BUILTIN_STATUS_DEFAULT_NAMES = Object.freeze({
  feed: ['feed', 'in feed', '\u0432 \u043b\u0435\u043d\u0442\u0435', '\u043b\u0435\u043d\u0442\u0430'],
  new: ['new', '\u043d\u043e\u0432\u044b\u0439', '\u043d\u043e\u0432\u0430\u044f'],
  in_progress: ['in progress', '\u0432 \u0440\u0430\u0431\u043e\u0442\u0435'],
  done: ['completed', '\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u0430\u044f'],
  waiting: ['waiting', '\u0432 \u043e\u0436\u0438\u0434\u0430\u043d\u0438\u0438'],
});

function normalizeStatusKey(value) {
  const raw = String(value || '').trim();
  if (raw === 'progress') return 'in_progress';
  if (raw === 'completed' || raw === 'complete') return 'done';
  if (raw === 'in_feed') return 'feed';
  return raw;
}

function normalizeStatusRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  const companyId = String(row.company_id || '').trim();
  const statusKey = normalizeStatusKey(row.status_key);
  const name = String(row.name || '').trim();
  if (!id || !companyId || !statusKey || !name) return null;
  return {
    ...row,
    id,
    company_id: companyId,
    status_key: statusKey,
    name,
    is_feed: row.is_feed === true || statusKey === ORDER_STATUS_FEED_KEY,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 10,
  };
}

function sortStatusRows(left, right) {
  if (left.is_feed !== right.is_feed) return left.is_feed ? -1 : 1;
  const orderDelta = Number(left.sort_order || 0) - Number(right.sort_order || 0);
  if (orderDelta) return orderDelta;
  return String(left.name || '').localeCompare(String(right.name || ''));
}

export function getOrderStatusesQueryKey(companyId) {
  return ['company-order-statuses', String(companyId || '').trim() || 'no-company'];
}

export async function fetchCompanyOrderStatuses(companyId) {
  const id = String(companyId || '').trim();
  if (!id) return [];
  const { data, error } = await supabase
    .from('company_order_statuses')
    .select(STATUS_SELECT)
    .eq('company_id', id)
    .order('is_feed', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(normalizeStatusRow).filter(Boolean).sort(sortStatusRows);
}

export function getBuiltinOrderStatusLabel(statusKey, t) {
  const key = BUILTIN_STATUS_LABEL_KEYS[normalizeStatusKey(statusKey)];
  return key ? t(key) : '';
}

function isBuiltinDefaultStatusName(statusKey, name) {
  const normalizedName = String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return (BUILTIN_STATUS_DEFAULT_NAMES[normalizeStatusKey(statusKey)] || []).includes(normalizedName);
}

export function getOrderStatusLabel(status, statuses, t) {
  const key = normalizeStatusKey(status);
  const found = (Array.isArray(statuses) ? statuses : []).find(
    (item) => normalizeStatusKey(item?.status_key) === key,
  );
  if (found?.name) {
    const builtinLabel = getBuiltinOrderStatusLabel(key, t);
    return isBuiltinDefaultStatusName(key, found.name) ? (builtinLabel || found.name) : found.name;
  }
  return getBuiltinOrderStatusLabel(key, t) || String(status || '').trim();
}

export function getDefaultOrderStatusKey(statuses, { toFeed = false } = {}) {
  const rows = Array.isArray(statuses) ? statuses : [];
  if (toFeed) {
    return rows.some((item) => item?.is_feed === true || item?.status_key === ORDER_STATUS_FEED_KEY)
      ? ORDER_STATUS_FEED_KEY
      : null;
  }
  if (rows.some((item) => item?.status_key === 'new')) return 'new';
  return null;
}

export function invalidateCompanyOrderStatuses(queryClient, companyId) {
  if (!queryClient) return;
  queryClient.invalidateQueries({ queryKey: getOrderStatusesQueryKey(companyId) }).catch(() => {});
}

export async function setCompanyOrderStatusesEnabled(companyId, enabled, queryClient = null) {
  const id = String(companyId || '').trim();
  if (!id) throw new Error('company_id_required');
  const patch = { use_order_statuses: enabled === true };
  const { error } = await supabase.from('companies').update(patch).eq('id', id);
  if (error) throw error;
  applyCompanySettingsCachePatch(queryClient, id, patch);
  invalidateCompanyOrderStatuses(queryClient, id);
  broadcastCompanySettingsChanged(id, Object.keys(patch)).catch(() => {});
}

export async function setCompanyFeedStatusEnabled(companyId, enabled, queryClient = null) {
  const id = String(companyId || '').trim();
  if (!id) throw new Error('company_id_required');
  const patch = { feed_status_enabled: enabled === true };
  const { error } = await supabase.rpc('set_company_feed_status_enabled', {
    p_company_id: id,
    p_enabled: enabled === true,
  });
  if (error) throw error;
  applyCompanySettingsCachePatch(queryClient, id, patch);
  broadcastCompanySettingsChanged(id, Object.keys(patch)).catch(() => {});
}

export async function createCompanyOrderStatus(companyId, { name, sortOrder }) {
  const id = String(companyId || '').trim();
  const normalizedName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!id) throw new Error('company_id_required');
  if (!normalizedName) throw new Error('order_status_name_required');
  const payload = {
    company_id: id,
    name: normalizedName,
    is_feed: false,
    ...(Number.isFinite(Number(sortOrder)) ? { sort_order: Number(sortOrder) } : {}),
  };
  const { data, error } = await supabase
    .from('company_order_statuses')
    .insert(payload)
    .select(STATUS_SELECT)
    .single();
  if (error) throw error;
  return normalizeStatusRow(data);
}

export async function renameCompanyOrderStatus(companyId, statusId, name) {
  const id = String(companyId || '').trim();
  const targetId = String(statusId || '').trim();
  const normalizedName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!id || !targetId) throw new Error('order_status_not_found');
  if (!normalizedName) throw new Error('order_status_name_required');
  const { data, error } = await supabase
    .from('company_order_statuses')
    .update({ name: normalizedName })
    .eq('company_id', id)
    .eq('id', targetId)
    .select(STATUS_SELECT)
    .single();
  if (error) throw error;
  return normalizeStatusRow(data);
}

export async function getCompanyOrderStatusUsage(statusId) {
  const id = String(statusId || '').trim();
  if (!id) return 0;
  const { data, error } = await supabase.rpc('get_company_order_status_usage', { p_status_id: id });
  if (error) throw error;
  return Math.max(0, Number(data || 0) || 0);
}

export async function deleteCompanyOrderStatus(statusId, replacementStatusKey = null) {
  const id = String(statusId || '').trim();
  if (!id) throw new Error('order_status_not_found');
  const replacement = String(replacementStatusKey || '').trim() || null;
  const { error } = await supabase.rpc('delete_company_order_status', {
    p_status_id: id,
    p_replacement_status_key: replacement,
  });
  if (error) throw error;
}

export function useCompanyOrderStatuses(companyIdOverride = null, options = {}) {
  const { enabled = true, includeWhenDisabled = false } = options;
  const { profile } = useAuthContext();
  const queryClient = useQueryClient();
  const companyId = String(companyIdOverride || profile?.company_id || '').trim() || null;
  const { settings, isLoading: settingsLoading } = useCompanySettings(companyId, { enabled: enabled !== false });
  const isEnabled = settings?.use_order_statuses === true;
  const queryEnabled = enabled !== false && !!companyId && (includeWhenDisabled || isEnabled);

  const query = useQuery({
    queryKey: getOrderStatusesQueryKey(companyId),
    queryFn: () => fetchCompanyOrderStatuses(companyId),
    enabled: queryEnabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 14 * 24 * 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (!companyId || !queryEnabled) return undefined;
    const channel = supabase
      .channel(`company-order-statuses-${companyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'company_order_statuses',
          filter: `company_id=eq.${companyId}`,
        },
        () => invalidateCompanyOrderStatuses(queryClient, companyId),
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [companyId, queryClient, queryEnabled]);

  const statuses = useMemo(
    () => (Array.isArray(query.data) ? query.data : []).slice().sort(sortStatusRows),
    [query.data],
  );
  const feedStatus = useMemo(
    () => statuses.find((item) => item.is_feed || item.status_key === ORDER_STATUS_FEED_KEY) || null,
    [statuses],
  );
  const regularStatuses = useMemo(() => statuses.filter((item) => !item.is_feed), [statuses]);
  const feedEnabled = isEnabled && settings?.feed_status_enabled === true && !!feedStatus;
  const selectableStatuses = useMemo(
    () => (feedEnabled && feedStatus ? [feedStatus, ...regularStatuses] : regularStatuses),
    [feedEnabled, feedStatus, regularStatuses],
  );

  return {
    companyId,
    settings,
    isLoading: settingsLoading || (queryEnabled && query.isLoading),
    isEnabled,
    feedEnabled,
    statuses,
    feedStatus,
    regularStatuses,
    selectableStatuses,
    refetch: query.refetch,
    getLabel: (status, t) => getOrderStatusLabel(status, statuses, t || (() => '')),
  };
}
