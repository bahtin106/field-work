import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  applyCompanySettingsCachePatch,
  broadcastCompanySettingsChanged,
} from './companySettingsQuery';
import { supabase } from './supabase';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { useAuthContext } from '../providers/SimpleAuthProvider';
import { withReadDeadline } from '../src/shared/network/readDeadline';
import { getOfflineSnapshot, useOfflineSnapshot } from '../src/shared/offline/offlineStatus';

export const ORDER_STATUS_LIMIT = 10;
export const ORDER_STATUS_FEED_KEY = 'feed';

const STATUS_SELECT = 'id, company_id, status_key, name, color, is_feed, sort_order, created_at, updated_at';
export const ORDER_STATUS_COLOR_PALETTE = Object.freeze([
  '#0A84FF', '#5856D6', '#AF52DE', '#E5484D', '#D97706', '#8A6D1F',
  '#34C759', '#0F9D8A', '#168AAD', '#4F6BED', '#8B5CF6', '#64748B',
  '#BE123C', '#DB2777', '#C026D3', '#7C3AED', '#0284C7', '#059669',
  '#65A30D', '#EA580C', '#475569',
]);
export const DEFAULT_ORDER_STATUS_COLORS = Object.freeze({
  feed: '#8A6D1F',
  new: '#0A84FF',
  in_progress: '#34C759',
  done: '#6B7280',
  waiting: '#D97706',
});
const BUILTIN_STATUS_LABEL_KEYS = Object.freeze({
  feed: 'order_status_in_feed',
  new: 'order_status_new',
  in_progress: 'order_status_in_progress',
  done: 'order_status_completed',
  waiting: 'order_status_waiting',
});
const statusSubscriptions = new Map();

function acquireStatusSubscription(queryClient, companyId) {
  const key = String(companyId || '').trim();
  if (!key) return () => {};
  const existing = statusSubscriptions.get(key);
  if (existing) {
    existing.refs += 1;
    return () => releaseStatusSubscription(key);
  }
  const channel = supabase
    .channel(`company-order-statuses-${key}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'company_order_statuses',
        filter: `company_id=eq.${key}`,
      },
      () => {
        const network = getOfflineSnapshot();
        if (!network.isNetworkKnown || !network.isOnline || network.isPoorConnection) return;
        invalidateCompanyOrderStatuses(queryClient, key);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') invalidateCompanyOrderStatuses(queryClient, key);
    });
  statusSubscriptions.set(key, { refs: 1, channel });
  return () => releaseStatusSubscription(key);
}

function releaseStatusSubscription(key) {
  const entry = statusSubscriptions.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  statusSubscriptions.delete(key);
  try {
    supabase.removeChannel(entry.channel);
  } catch {}
}

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
  const color = normalizeOrderStatusColor(row.color);
  if (!id || !companyId || !statusKey || !name) return null;
  return {
    ...row,
    id,
    company_id: companyId,
    status_key: statusKey,
    name,
    color: color || getDefaultOrderStatusColor(statusKey) || '#64748B',
    is_feed: row.is_feed === true || statusKey === ORDER_STATUS_FEED_KEY,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 10,
  };
}

export function normalizeOrderStatusColor(value) {
  const color = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : null;
}

export function getDefaultOrderStatusColor(statusKey) {
  return DEFAULT_ORDER_STATUS_COLORS[normalizeStatusKey(statusKey)] || null;
}

export function getRandomOrderStatusColor(excludedColors = []) {
  const excluded = new Set(
    (Array.isArray(excludedColors) ? excludedColors : []).map(normalizeOrderStatusColor).filter(Boolean),
  );
  const available = ORDER_STATUS_COLOR_PALETTE.filter((color) => !excluded.has(color));
  const source = available.length ? available : ORDER_STATUS_COLOR_PALETTE;
  return source[Math.floor(Math.random() * source.length)];
}

export function getOrderStatusColor(status, statuses) {
  const value = String(status || '').trim();
  const key = normalizeStatusKey(value);
  const row = (Array.isArray(statuses) ? statuses : []).find((item) => (
    normalizeStatusKey(item?.status_key) === key || String(item?.name || '').trim() === value
  ));
  return normalizeOrderStatusColor(row?.color) || getDefaultOrderStatusColor(key) || null;
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

export async function fetchCompanyOrderStatuses(companyId, signal = undefined) {
  const id = String(companyId || '').trim();
  if (!id) return [];
  let query = supabase
    .from('company_order_statuses')
    .select(STATUS_SELECT)
    .eq('company_id', id)
    .order('is_feed', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
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

export async function createCompanyOrderStatus(companyId, { name, sortOrder, color }) {
  const id = String(companyId || '').trim();
  const normalizedName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!id) throw new Error('company_id_required');
  if (!normalizedName) throw new Error('order_status_name_required');
  const payload = {
    company_id: id,
    name: normalizedName,
    is_feed: false,
    ...(normalizeOrderStatusColor(color) ? { color: normalizeOrderStatusColor(color) } : {}),
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

export async function updateCompanyOrderStatus(companyId, statusId, patch = {}) {
  const id = String(companyId || '').trim();
  const targetId = String(statusId || '').trim();
  if (!id || !targetId) throw new Error('order_status_not_found');

  const update = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    const name = String(patch.name || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('order_status_name_required');
    update.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'color')) {
    const color = normalizeOrderStatusColor(patch.color);
    if (!color) throw new Error('company_order_status_color_invalid');
    update.color = color;
  }
  if (!Object.keys(update).length) throw new Error('order_status_update_required');

  const { data, error } = await supabase
    .from('company_order_statuses')
    .update(update)
    .eq('company_id', id)
    .eq('id', targetId)
    .select(STATUS_SELECT)
    .single();
  if (error) throw error;
  return normalizeStatusRow(data);
}

export async function renameCompanyOrderStatus(companyId, statusId, name) {
  return updateCompanyOrderStatus(companyId, statusId, { name });
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
  const { enabled = true } = options;
  const { profile } = useAuthContext();
  const queryClient = useQueryClient();
  const network = useOfflineSnapshot();
  const companyId = String(companyIdOverride || profile?.company_id || '').trim() || null;
  const { settings, isLoading: settingsLoading } = useCompanySettings(companyId, { enabled: enabled !== false });
  const queryEnabled = enabled !== false && !!companyId;
  const canUseLiveNetwork =
    network.isNetworkKnown && network.isOnline && !network.isPoorConnection;

  const query = useQuery({
    queryKey: getOrderStatusesQueryKey(companyId),
    queryFn: ({ signal }) =>
      withReadDeadline(
        (readSignal) => fetchCompanyOrderStatuses(companyId, readSignal),
        { label: 'Company order statuses', signal },
      ),
    enabled: queryEnabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 14 * 24 * 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (!companyId || !queryEnabled || !canUseLiveNetwork) return undefined;
    return acquireStatusSubscription(queryClient, companyId);
  }, [canUseLiveNetwork, companyId, queryClient, queryEnabled]);

  const statuses = useMemo(
    () => (Array.isArray(query.data) ? query.data : []).slice().sort(sortStatusRows),
    [query.data],
  );
  const feedStatus = useMemo(
    () => statuses.find((item) => item.is_feed || item.status_key === ORDER_STATUS_FEED_KEY) || null,
    [statuses],
  );
  const regularStatuses = useMemo(() => statuses.filter((item) => !item.is_feed), [statuses]);
  const feedEnabled = settings?.feed_status_enabled === true && !!feedStatus;
  const selectableStatuses = useMemo(
    () => (feedEnabled && feedStatus ? [feedStatus, ...regularStatuses] : regularStatuses),
    [feedEnabled, feedStatus, regularStatuses],
  );

  return {
    companyId,
    settings,
    isLoading: settingsLoading || (queryEnabled && query.isLoading),
    isEnabled: true,
    feedEnabled,
    statuses,
    feedStatus,
    regularStatuses,
    selectableStatuses,
    refetch: query.refetch,
    getLabel: (status, t) => getOrderStatusLabel(status, statuses, t || (() => '')),
  };
}
