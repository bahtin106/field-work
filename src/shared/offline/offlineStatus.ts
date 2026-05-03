import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { getRequestById, updateRequest } from '../../features/requests/api';
import { getClientById, updateClient } from '../../features/clients/api';
import { getClientObjectById, updateClientObject } from '../../features/objects/api';
import { queryKeys } from '../query/queryKeys';

const OUTBOX_KEY = 'offline.outbox.v1';
const MAX_ATTEMPTS = 8;

export type OfflineOutboxItem = {
  id: string;
  entity: 'request' | 'client' | 'object';
  operation: 'update';
  entityId: string;
  patch: Record<string, any>;
  base: Record<string, any> | null;
  expectedUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  status: 'pending' | 'syncing' | 'conflict' | 'failed';
  error?: string | null;
  latest?: Record<string, any> | null;
};

type Listener = () => void;

let lastNetState: NetInfoState | null = null;
let isSyncing = false;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {}
  }
}

export function subscribeOfflineState(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOfflineSnapshot() {
  const isConnected = lastNetState?.isConnected !== false;
  const reachable = lastNetState?.isInternetReachable;
  const isInternetReachable = reachable !== false;
  const isExpensive = !!lastNetState?.details?.isConnectionExpensive;
  const cellularGeneration = String((lastNetState?.details as any)?.cellularGeneration || '');
  const isPoorConnection = isConnected && isInternetReachable && (isExpensive || cellularGeneration === '2g');

  return {
    isOnline: isConnected && isInternetReachable,
    isPoorConnection,
    isSyncing,
  };
}

export function setOfflineNetState(state: NetInfoState | null) {
  lastNetState = state;
  onlineManager.setOnline(Boolean(state?.isConnected) && state?.isInternetReachable !== false);
  emit();
}

export function isOfflineLikeError(error: any) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('network error') ||
    message.includes('failed to fetch') ||
    message.includes('internet') ||
    message.includes('timed out') ||
    message.includes('offline')
  );
}

function nowIso() {
  return new Date().toISOString();
}

function makeOutboxId(entity: string, operation: string, entityId: string) {
  return `${entity}:${operation}:${entityId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

async function readOutbox(): Promise<OfflineOutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeOutbox(items: OfflineOutboxItem[]) {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  emit();
}

export async function getOfflineOutboxSummary() {
  const items = await readOutbox();
  return {
    pending: items.filter((item) => item.status === 'pending' || item.status === 'syncing').length,
    conflicts: items.filter((item) => item.status === 'conflict').length,
    failed: items.filter((item) => item.status === 'failed').length,
  };
}

export async function enqueueRequestUpdate({
  id,
  patch,
  base = null,
  expectedUpdatedAt = null,
}: {
  id: string;
  patch: Record<string, any>;
  base?: Record<string, any> | null;
  expectedUpdatedAt?: string | null;
}) {
  const entityId = String(id || '').trim();
  if (!entityId) throw new Error('Request id is required');

  const items = await readOutbox();
  const existingIndex = items.findIndex(
    (item) =>
      item.entity === 'request' &&
      item.operation === 'update' &&
      item.entityId === entityId &&
      (item.status === 'pending' || item.status === 'failed' || item.status === 'conflict'),
  );

  const stamp = nowIso();
  if (existingIndex >= 0) {
    const existing = items[existingIndex];
    items[existingIndex] = {
      ...existing,
      patch: { ...(existing.patch || {}), ...(patch || {}) },
      base: existing.base || base || null,
      expectedUpdatedAt: existing.expectedUpdatedAt || expectedUpdatedAt || null,
      updatedAt: stamp,
      status: 'pending',
      error: null,
    };
    await writeOutbox(items);
    return items[existingIndex];
  }

  const item: OfflineOutboxItem = {
    id: makeOutboxId('request', 'update', entityId),
    entity: 'request',
    operation: 'update',
    entityId,
    patch: patch || {},
    base: base || null,
    expectedUpdatedAt: expectedUpdatedAt || null,
    createdAt: stamp,
    updatedAt: stamp,
    attempts: 0,
    status: 'pending',
    error: null,
    latest: null,
  };
  items.push(item);
  await writeOutbox(items);
  return item;
}

export async function enqueueClientUpdate({
  id,
  patch,
  base = null,
}: {
  id: string;
  patch: Record<string, any>;
  base?: Record<string, any> | null;
}) {
  return enqueueEntityUpdate({ entity: 'client', id, patch, base });
}

export async function enqueueObjectUpdate({
  id,
  patch,
  base = null,
}: {
  id: string;
  patch: Record<string, any>;
  base?: Record<string, any> | null;
}) {
  return enqueueEntityUpdate({ entity: 'object', id, patch, base });
}

async function enqueueEntityUpdate({
  entity,
  id,
  patch,
  base = null,
}: {
  entity: 'client' | 'object';
  id: string;
  patch: Record<string, any>;
  base?: Record<string, any> | null;
}) {
  const entityId = String(id || '').trim();
  if (!entityId) throw new Error('Entity id is required');

  const items = await readOutbox();
  const existingIndex = items.findIndex(
    (item) =>
      item.entity === entity &&
      item.operation === 'update' &&
      item.entityId === entityId &&
      (item.status === 'pending' || item.status === 'failed' || item.status === 'conflict'),
  );

  const stamp = nowIso();
  if (existingIndex >= 0) {
    const existing = items[existingIndex];
    items[existingIndex] = {
      ...existing,
      patch: { ...(existing.patch || {}), ...(patch || {}) },
      base: existing.base || base || null,
      updatedAt: stamp,
      status: 'pending',
      error: null,
    };
    await writeOutbox(items);
    return items[existingIndex];
  }

  const item: OfflineOutboxItem = {
    id: makeOutboxId(entity, 'update', entityId),
    entity,
    operation: 'update',
    entityId,
    patch: patch || {},
    base: base || null,
    expectedUpdatedAt: base?.updated_at || null,
    createdAt: stamp,
    updatedAt: stamp,
    attempts: 0,
    status: 'pending',
    error: null,
    latest: null,
  };
  items.push(item);
  await writeOutbox(items);
  return item;
}

function normalizeComparableValue(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
}

function isSemanticallyEqual(left: any, right: any) {
  const a = normalizeComparableValue(left);
  const b = normalizeComparableValue(right);
  return JSON.stringify(a) === JSON.stringify(b);
}

function hasFieldConflict(item: OfflineOutboxItem, latest: Record<string, any> | null) {
  if (!item.base || !latest) return false;
  const patchKeys = Object.keys(item.patch || {});
  return patchKeys.some((key) => {
    const before = item.base?.[key];
    const current = latest?.[key];
    const intended = item.patch?.[key];

    // latest already contains intended value -> not a conflict
    if (isSemanticallyEqual(current, intended)) return false;
    // patch does not effectively change this field relative to base
    if (isSemanticallyEqual(before, intended)) return false;
    // no remote edit on this field since base snapshot
    if (isSemanticallyEqual(before, current)) return false;
    // true concurrent edit on same field
    return true;
  });
}

function applyOptimisticRequest(queryClient: QueryClient, item: OfflineOutboxItem) {
  const detailKey = queryKeys.requests.detail(item.entityId);
  const current = queryClient.getQueryData(detailKey);
  if (current && typeof current === 'object') {
    queryClient.setQueryData(detailKey, {
      ...(current as Record<string, any>),
      ...(item.patch || {}),
      __offlinePending: true,
    });
  }
}

function setEntityQueryData(queryClient: QueryClient, item: OfflineOutboxItem, data: any) {
  if (item.entity === 'request' && data?.id) {
    queryClient.setQueryData(queryKeys.requests.detail(data.id), data);
  } else if (item.entity === 'client' && data?.id) {
    queryClient.setQueryData(queryKeys.clients.detail(data.id), data);
  } else if (item.entity === 'object' && data?.id) {
    queryClient.setQueryData(queryKeys.objects.detail(data.id), data);
  }
}

async function fetchLatestForItem(item: OfflineOutboxItem) {
  if (item.entity === 'request') return getRequestById(item.entityId);
  if (item.entity === 'client') return getClientById(item.entityId);
  if (item.entity === 'object') return getClientObjectById(item.entityId);
  return null;
}

async function updateItemOnline(item: OfflineOutboxItem, latest: any) {
  if (item.entity === 'request') {
    return updateRequest(item.entityId, item.patch, latest?.updated_at || item.expectedUpdatedAt || null);
  }
  if (item.entity === 'client') {
    return updateClient(item.entityId, item.patch);
  }
  if (item.entity === 'object') {
    return updateClientObject(item.entityId, item.patch);
  }
  return null;
}

export async function syncOfflineOutbox(queryClient: QueryClient) {
  const snapshot = getOfflineSnapshot();
  if (!snapshot.isOnline || isSyncing) return await getOfflineOutboxSummary();

  isSyncing = true;
  emit();
  try {
    let items = await readOutbox();
    let changed = false;

    for (const item of [...items]) {
      if (item.status !== 'pending' && item.status !== 'failed' && item.status !== 'conflict') continue;
      if (item.attempts >= MAX_ATTEMPTS && item.status === 'failed') continue;

      const currentIndex = items.findIndex((entry) => entry.id === item.id);
      if (currentIndex < 0) continue;

      items[currentIndex] = {
        ...items[currentIndex],
        status: 'syncing',
        attempts: Number(items[currentIndex].attempts || 0) + 1,
        updatedAt: nowIso(),
      };
      await writeOutbox(items);

      try {
        if (item.operation === 'update') {
          const latest = await fetchLatestForItem(item);
          if (hasFieldConflict(item, latest)) {
            items = await readOutbox();
            const idx = items.findIndex((entry) => entry.id === item.id);
            if (idx >= 0) {
              items[idx] = {
                ...items[idx],
                status: 'conflict',
                latest: latest || null,
                error: 'Remote row changed in the same fields while this edit was offline',
                updatedAt: nowIso(),
              };
              await writeOutbox(items);
            }
            continue;
          }

          const saved = await updateItemOnline(item, latest);
          setEntityQueryData(queryClient, item, saved);
          if (item.entity === 'request') {
            queryClient.invalidateQueries({ queryKey: ['requests'] });
          } else if (item.entity === 'client') {
            queryClient.invalidateQueries({ queryKey: ['clients'] });
            queryClient.invalidateQueries({ queryKey: ['requests'] });
          } else if (item.entity === 'object') {
            queryClient.invalidateQueries({ queryKey: ['objects'] });
            queryClient.invalidateQueries({ queryKey: ['clients'] });
            queryClient.invalidateQueries({ queryKey: ['requests'] });
          }
          changed = true;
        }

        items = await readOutbox();
        items = items.filter((entry) => entry.id !== item.id);
        await writeOutbox(items);
      } catch (error: any) {
        if (isOfflineLikeError(error)) break;
        items = await readOutbox();
        const idx = items.findIndex((entry) => entry.id === item.id);
        if (idx >= 0) {
          const attempts = Number(items[idx].attempts || 0);
          items[idx] = {
            ...items[idx],
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            error: String(error?.message || error || 'Sync failed'),
            updatedAt: nowIso(),
          };
          await writeOutbox(items);
        }
      }
    }

    if (changed) {
      queryClient.invalidateQueries({ queryKey: ['clients', 'delete-blockers'] });
    }
    return await getOfflineOutboxSummary();
  } finally {
    isSyncing = false;
    emit();
  }
}

export async function restoreOfflineOptimisticState(queryClient: QueryClient) {
  const items = await readOutbox();
  items.forEach((item) => {
    if (item.entity === 'request' && item.operation === 'update') {
      applyOptimisticRequest(queryClient, item);
      return;
    }
    if (item.operation !== 'update') return;
    const current =
      item.entity === 'client'
        ? queryClient.getQueryData(queryKeys.clients.detail(item.entityId))
        : item.entity === 'object'
          ? queryClient.getQueryData(queryKeys.objects.detail(item.entityId))
          : null;
    if (current && typeof current === 'object') {
      setEntityQueryData(queryClient, item, {
        ...(current as Record<string, any>),
        ...(item.patch || {}),
        __offlinePending: true,
      });
    }
  });
  return getOfflineOutboxSummary();
}
