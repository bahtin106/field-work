import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { APP_RUNTIME_CONFIG } from '../../../config/appRuntime';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../query/queryKeys';

const OUTBOX_KEY = 'offline.outbox.v1';
const MAX_ATTEMPTS = 8;
const OFFLINE_CONFIRMATION_MS = 2500;
const QUALITY_PROBE_INTERVAL_MS = 45_000;
const QUALITY_CONFIRMATION_DELAY_MS = 5_000;
const QUALITY_PROBE_TIMEOUT_MS = 6_000;
const QUALITY_SLOW_RTT_MS = 2_500;
const QUALITY_RECOVERED_RTT_MS = 1_500;
const QUALITY_REQUIRED_SAMPLES = 2;

export type OfflineOutboxItem = {
  id: string;
  entity: 'request' | 'client' | 'object' | 'employee';
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
  ownerUserId?: string | null;
  ownerCompanyId?: string | null;
};

export type OfflineOutboxOwner = {
  userId: string;
  companyId: string | null;
};

type Listener = () => void;

let lastNetState: NetInfoState | null = null;
let pendingOfflineState: NetInfoState | null = null;
let offlineConfirmationTimer: ReturnType<typeof setTimeout> | null = null;
let qualityMonitoringStarted = false;
let qualityMonitoringActive = true;
let qualityProbeTimer: ReturnType<typeof setTimeout> | null = null;
let qualityProbeAbortController: AbortController | null = null;
let qualityProbeInFlight = false;
let confirmedPoorConnection = false;
let consecutiveSlowSamples = 0;
let consecutiveGoodSamples = 0;
let isSyncing = false;
let syncInFlight: Promise<ReturnType<typeof summarizeOutbox>> | null = null;
let syncRerunRequested = false;
let syncRetryTimer: ReturnType<typeof setTimeout> | null = null;
const transientSyncFailures = new Map<string, number>();
let cachedOfflineSnapshot: {
  isNetworkKnown: boolean;
  isOnline: boolean;
  isPoorConnection: boolean;
  isSyncing: boolean;
} | null = null;
const listeners = new Set<Listener>();

function hasPoorTransportHint(state: NetInfoState | null) {
  const connectionType = String(state?.type || '').toLowerCase();
  const cellularGeneration = String((state?.details as any)?.cellularGeneration || '').toLowerCase();

  // NetInfo documents cellular generation as an indication, not a speed guarantee.
  // It is only one sample in the confirmation algorithm below.
  return connectionType === 'cellular' && cellularGeneration === '2g';
}

function getConnectionIdentity(state: NetInfoState | null) {
  const type = String(state?.type || 'unknown').toLowerCase();
  const cellularGeneration = String((state?.details as any)?.cellularGeneration || '').toLowerCase();
  return `${type}:${cellularGeneration}`;
}

function emit() {
  cachedOfflineSnapshot = null;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {}
  }
}

function isOnlineNetState(state: NetInfoState | null) {
  return Boolean(state?.isConnected) && state?.isInternetReachable !== false;
}

function applyNetState(state: NetInfoState | null) {
  const previous = getOfflineSnapshot();
  lastNetState = state;
  onlineManager.setOnline(isOnlineNetState(state));
  cachedOfflineSnapshot = null;
  const next = getOfflineSnapshot();
  if (
    previous.isNetworkKnown === next.isNetworkKnown &&
    previous.isOnline === next.isOnline &&
    previous.isPoorConnection === next.isPoorConnection
  ) {
    return;
  }
  emit();
}

function clearOfflineConfirmation() {
  if (offlineConfirmationTimer) {
    clearTimeout(offlineConfirmationTimer);
    offlineConfirmationTimer = null;
  }
  pendingOfflineState = null;
}

export function subscribeOfflineState(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOfflineSnapshot() {
  if (cachedOfflineSnapshot) return cachedOfflineSnapshot;

  const isNetworkKnown = lastNetState !== null;
  const isConnected = lastNetState?.isConnected === true;
  const reachable = lastNetState?.isInternetReachable;
  const isInternetReachable = reachable === true || (reachable == null && isConnected);
  const isOnline = isNetworkKnown && isConnected && isInternetReachable;

  cachedOfflineSnapshot = {
    isNetworkKnown,
    isOnline,
    isPoorConnection: isOnline && confirmedPoorConnection,
    isSyncing,
  };
  return cachedOfflineSnapshot;
}

export function setOfflineNetState(state: NetInfoState | null) {
  if (isOnlineNetState(state)) {
    const connectionChanged = getConnectionIdentity(lastNetState) !== getConnectionIdentity(state);
    if (connectionChanged) resetNetworkQualityState();
    clearOfflineConfirmation();
    applyNetState(state);
    if (connectionChanged) {
      scheduleNetworkQualityProbe(1_200);
    } else if (!qualityProbeTimer && !qualityProbeInFlight) {
      scheduleNetworkQualityProbe(QUALITY_PROBE_INTERVAL_MS);
    }
    return;
  }

  clearNetworkQualityProbeTimer();
  qualityProbeAbortController?.abort();
  qualityProbeAbortController = null;

  // Mobile OSes can briefly report a disconnected network while switching
  // Wi-Fi/cellular routes. Keep the last confirmed online state until the
  // signal has remained offline for a short period.
  if (!isOnlineNetState(lastNetState)) {
    clearOfflineConfirmation();
    applyNetState(state);
    return;
  }

  pendingOfflineState = state;
  if (offlineConfirmationTimer) return;
  offlineConfirmationTimer = setTimeout(() => {
    offlineConfirmationTimer = null;
    const confirmedState = pendingOfflineState;
    pendingOfflineState = null;
    resetNetworkQualityState();
    applyNetState(confirmedState);
  }, OFFLINE_CONFIRMATION_MS);
}

function clearNetworkQualityProbeTimer() {
  if (qualityProbeTimer) {
    clearTimeout(qualityProbeTimer);
    qualityProbeTimer = null;
  }
}

function resetNetworkQualityState() {
  clearNetworkQualityProbeTimer();
  consecutiveSlowSamples = 0;
  consecutiveGoodSamples = 0;
  if (confirmedPoorConnection) {
    confirmedPoorConnection = false;
    emit();
  }
}

function setConfirmedPoorConnection(nextValue: boolean) {
  if (confirmedPoorConnection === nextValue) return;
  confirmedPoorConnection = nextValue;
  emit();
}

function scheduleNetworkQualityProbe(delayMs: number) {
  if (!qualityMonitoringStarted || !qualityMonitoringActive || !isOnlineNetState(lastNetState)) return;
  clearNetworkQualityProbeTimer();
  qualityProbeTimer = setTimeout(() => {
    qualityProbeTimer = null;
    runNetworkQualityProbe().catch(() => {});
  }, Math.max(0, delayMs));
}

function recordNetworkQualitySample(sample: 'slow' | 'good' | 'neutral') {
  if (sample === 'slow') {
    consecutiveSlowSamples += 1;
    consecutiveGoodSamples = 0;
    if (consecutiveSlowSamples >= QUALITY_REQUIRED_SAMPLES) {
      setConfirmedPoorConnection(true);
    }
  } else if (sample === 'good') {
    consecutiveGoodSamples += 1;
    consecutiveSlowSamples = 0;
    if (consecutiveGoodSamples >= QUALITY_REQUIRED_SAMPLES) {
      setConfirmedPoorConnection(false);
    }
  } else {
    consecutiveSlowSamples = 0;
    consecutiveGoodSamples = 0;
  }

  const needsConfirmation =
    (!confirmedPoorConnection && consecutiveSlowSamples === 1) ||
    (confirmedPoorConnection && consecutiveGoodSamples === 1);
  scheduleNetworkQualityProbe(
    needsConfirmation ? QUALITY_CONFIRMATION_DELAY_MS : QUALITY_PROBE_INTERVAL_MS,
  );
}

async function runNetworkQualityProbe() {
  if (qualityProbeInFlight) {
    scheduleNetworkQualityProbe(QUALITY_CONFIRMATION_DELAY_MS);
    return;
  }
  if (
    !qualityMonitoringStarted ||
    !qualityMonitoringActive ||
    !isOnlineNetState(lastNetState)
  ) {
    return;
  }

  const baseUrl = String(APP_RUNTIME_CONFIG.supabaseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) return;

  const connectionIdentity = getConnectionIdentity(lastNetState);
  const transportHintWasPoor = hasPoorTransportHint(lastNetState);
  const startedAt = Date.now();
  const controller = new AbortController();
  qualityProbeAbortController = controller;
  qualityProbeInFlight = true;
  let probeTimedOut = false;
  const timeoutId = setTimeout(() => {
    probeTimedOut = true;
    controller.abort();
  }, QUALITY_PROBE_TIMEOUT_MS);

  let requestSucceeded = false;
  try {
    const response = await fetch(`${baseUrl}/auth/v1/health`, {
      method: 'GET',
      headers: APP_RUNTIME_CONFIG.supabaseAnonKey
        ? { apikey: APP_RUNTIME_CONFIG.supabaseAnonKey }
        : undefined,
      signal: controller.signal,
    });
    await response.text();
    requestSucceeded = true;
  } catch {
    requestSucceeded = false;
  } finally {
    clearTimeout(timeoutId);
    if (qualityProbeAbortController === controller) qualityProbeAbortController = null;
    qualityProbeInFlight = false;
  }

  // Aborts caused by backgrounding or a route switch are lifecycle events,
  // not evidence of a slow connection. A timeout remains a valid slow sample.
  if (controller.signal.aborted && !probeTimedOut) {
    if (qualityMonitoringActive && isOnlineNetState(lastNetState)) {
      scheduleNetworkQualityProbe(1_200);
    }
    return;
  }

  if (
    !qualityMonitoringActive ||
    !isOnlineNetState(lastNetState) ||
    connectionIdentity !== getConnectionIdentity(lastNetState)
  ) {
    return;
  }

  const elapsedMs = Date.now() - startedAt;
  const sample =
    !requestSucceeded || transportHintWasPoor || elapsedMs >= QUALITY_SLOW_RTT_MS
      ? 'slow'
      : elapsedMs <= QUALITY_RECOVERED_RTT_MS
        ? 'good'
        : 'neutral';
  recordNetworkQualitySample(sample);
}

export function startNetworkQualityMonitoring(isActive = true) {
  qualityMonitoringStarted = true;
  setNetworkQualityMonitoringActive(isActive);
}

export function setNetworkQualityMonitoringActive(isActive: boolean) {
  qualityMonitoringActive = isActive;
  if (!isActive) {
    clearNetworkQualityProbeTimer();
    qualityProbeAbortController?.abort();
    qualityProbeAbortController = null;
    return;
  }
  scheduleNetworkQualityProbe(1_200);
}

export function useOfflineSnapshot() {
  return useSyncExternalStore(subscribeOfflineState, getOfflineSnapshot, getOfflineSnapshot);
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

export async function getActiveOfflineOwner(): Promise<OfflineOutboxOwner | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    const userId = String(user?.id || '').trim();
    if (!userId) return null;
    const companyId = String(user?.user_metadata?.company_id || '').trim() || null;
    return { userId, companyId };
  } catch {
    return null;
  }
}

export function isOfflineItemOwnedBy(
  item: { ownerUserId?: string | null; ownerCompanyId?: string | null } | null | undefined,
  owner: OfflineOutboxOwner | null,
) {
  if (!owner?.userId) return false;
  const itemUserId = String(item?.ownerUserId || '').trim();
  if (!itemUserId || itemUserId !== owner.userId) return false;
  const itemCompanyId = String(item?.ownerCompanyId || '').trim();
  if (itemCompanyId && owner.companyId && itemCompanyId !== owner.companyId) return false;
  return true;
}

function getOutboxDetailQueryKey(item: OfflineOutboxItem) {
  if (item.entity === 'request') return queryKeys.requests.detail(item.entityId);
  if (item.entity === 'client') return queryKeys.clients.detail(item.entityId);
  if (item.entity === 'object') return queryKeys.objects.detail(item.entityId);
  if (item.entity === 'employee') return queryKeys.employees.detail(item.entityId);
  return null;
}

function isLegacyOutboxItemClaimable(
  item: OfflineOutboxItem,
  owner: OfflineOutboxOwner,
  queryClient: QueryClient,
) {
  if (String(item?.ownerUserId || '').trim()) return false;
  const itemCompanyId = String(item?.base?.company_id || '').trim();
  if (itemCompanyId && owner.companyId && itemCompanyId !== owner.companyId) return false;
  const activeProfile = queryClient.getQueryData(queryKeys.profile.me()) as any;
  if (String(activeProfile?.id || '').trim() !== owner.userId) return false;
  const detailKey = getOutboxDetailQueryKey(item);
  if (!detailKey) return false;
  const cachedDetail = queryClient.getQueryData(detailKey) as any;
  return (
    cachedDetail?.__offlinePending === true &&
    String(cachedDetail?.__offlineOutboxId || '').trim() === String(item.id || '').trim()
  );
}

function isOutboxItemOwnedBy(item: OfflineOutboxItem, owner: OfflineOutboxOwner | null) {
  return isOfflineItemOwnedBy(item, owner);
}

let outboxMutationQueue: Promise<void> = Promise.resolve();

async function readOutboxStorage(): Promise<OfflineOutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeOutboxStorage(items: OfflineOutboxItem[]) {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  emit();
}

async function readOutbox(): Promise<OfflineOutboxItem[]> {
  await outboxMutationQueue;
  return readOutboxStorage();
}

function mutateOutbox<T>(
  mutator: (items: OfflineOutboxItem[]) => {
    items: OfflineOutboxItem[];
    result: T;
  },
): Promise<T> {
  const operation = outboxMutationQueue.then(async () => {
    const current = await readOutboxStorage();
    const outcome = mutator([...current]);
    await writeOutboxStorage(outcome.items);
    return outcome.result;
  });
  outboxMutationQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function claimLegacyOutboxForOwner(owner: OfflineOutboxOwner, queryClient: QueryClient) {
  const snapshot = await readOutbox();
  if (!snapshot.some((item) => isLegacyOutboxItemClaimable(item, owner, queryClient))) return;
  await mutateOutbox((items) => ({
    items: items.map((item) =>
      isLegacyOutboxItemClaimable(item, owner, queryClient)
        ? {
            ...item,
            ownerUserId: owner.userId,
            ownerCompanyId: owner.companyId,
          }
        : item,
    ),
    result: undefined,
  }));
}

export async function getOfflineOutboxSummary() {
  const [items, owner] = await Promise.all([readOutbox(), getActiveOfflineOwner()]);
  return summarizeOutbox(items.filter((item) => isOutboxItemOwnedBy(item, owner)));
}

function summarizeOutbox(items: OfflineOutboxItem[]) {
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
  const owner = await getActiveOfflineOwner();
  if (!owner) throw new Error('Authenticated session is required for offline changes');

  return mutateOutbox((items) => {
    const existingIndex = items.findIndex(
      (item) =>
        item.entity === 'request' &&
        item.operation === 'update' &&
        item.entityId === entityId &&
        isOutboxItemOwnedBy(item, owner) &&
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
        attempts: 0,
        error: null,
      };
      transientSyncFailures.delete(existing.id);
      return { items, result: items[existingIndex] };
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
      ownerUserId: owner.userId,
      ownerCompanyId: owner.companyId,
    };
    items.push(item);
    return { items, result: item };
  });
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

export async function enqueueEmployeeUpdate({
  id,
  patch,
  base = null,
}: {
  id: string;
  patch: Record<string, any>;
  base?: Record<string, any> | null;
}) {
  return enqueueEntityUpdate({ entity: 'employee', id, patch, base });
}

async function enqueueEntityUpdate({
  entity,
  id,
  patch,
  base = null,
}: {
  entity: 'client' | 'object' | 'employee';
  id: string;
  patch: Record<string, any>;
  base?: Record<string, any> | null;
}) {
  const entityId = String(id || '').trim();
  if (!entityId) throw new Error('Entity id is required');
  const owner = await getActiveOfflineOwner();
  if (!owner) throw new Error('Authenticated session is required for offline changes');

  return mutateOutbox((items) => {
    const existingIndex = items.findIndex(
      (item) =>
        item.entity === entity &&
        item.operation === 'update' &&
        item.entityId === entityId &&
        isOutboxItemOwnedBy(item, owner) &&
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
        attempts: 0,
        error: null,
      };
      transientSyncFailures.delete(existing.id);
      return { items, result: items[existingIndex] };
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
      ownerUserId: owner.userId,
      ownerCompanyId: owner.companyId,
    };
    items.push(item);
    return { items, result: item };
  });
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
      __offlineOutboxId: item.id,
    });
  }
}

function mergeRowIntoArray(value: any, id: string, patchOrRow: any) {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const next = value.map((row) => {
    if (String(row?.id || '') !== id) return row;
    changed = true;
    return {
      ...(row || {}),
      ...(patchOrRow || {}),
      id: patchOrRow?.id || row?.id || id,
    };
  });
  return changed ? next : value;
}

function updateListQueries(queryClient: QueryClient, queryKey: unknown[], id: string, patchOrRow: any) {
  const lists = queryClient.getQueriesData({ queryKey }) || [];
  lists.forEach(([key, value]) => {
    const next = mergeRowIntoArray(value, id, patchOrRow);
    if (next !== value) {
      queryClient.setQueryData(key, next);
    }
  });
}

function updateObjectInsideClientCaches(queryClient: QueryClient, objectId: string, patchOrRow: any) {
  const updateClient = (client: any) => {
    if (!client || typeof client !== 'object' || !Array.isArray(client.objects)) return client;
    let changed = false;
    const nextObjects = client.objects.map((objectItem: any) => {
      if (String(objectItem?.id || '') !== objectId) return objectItem;
      changed = true;
      return {
        ...(objectItem || {}),
        ...(patchOrRow || {}),
        id: patchOrRow?.id || objectItem?.id || objectId,
      };
    });
    if (!changed) return client;
    return {
      ...client,
      objects: nextObjects,
    };
  };

  const clientLists = queryClient.getQueriesData({ queryKey: ['clients', 'list'] }) || [];
  clientLists.forEach(([key, value]) => {
    if (!Array.isArray(value)) return;
    let changed = false;
    const nextList = value.map((client) => {
      const nextClient = updateClient(client);
      if (nextClient !== client) changed = true;
      return nextClient;
    });
    if (changed) queryClient.setQueryData(key, nextList);
  });

  const clientDetails = queryClient.getQueriesData({ queryKey: ['clients', 'detail'] }) || [];
  clientDetails.forEach(([key, value]) => {
    const nextClient = updateClient(value);
    if (nextClient !== value) queryClient.setQueryData(key, nextClient);
  });
}

function setEntityQueryData(queryClient: QueryClient, item: OfflineOutboxItem, data: any) {
  if (item.entity === 'request' && data?.id) {
    queryClient.setQueryData(queryKeys.requests.detail(data.id), data);
  } else if (item.entity === 'client' && data?.id) {
    queryClient.setQueryData(queryKeys.clients.detail(data.id), data);
    updateListQueries(queryClient, ['clients', 'list'], String(data.id), data);
  } else if (item.entity === 'object' && data?.id) {
    queryClient.setQueryData(queryKeys.objects.detail(data.id), data);
    updateListQueries(queryClient, ['objects'], String(data.id), data);
    updateObjectInsideClientCaches(queryClient, String(data.id), data);
  } else if (item.entity === 'employee' && data?.id) {
    queryClient.setQueryData(queryKeys.employees.detail(data.id), data);
    updateListQueries(queryClient, ['employees', 'list'], String(data.id), data);
  }
}

async function fetchLatestForItem(item: OfflineOutboxItem) {
  if (item.entity === 'request') {
    const { getRequestById } = await import('../../features/requests/api');
    return getRequestById(item.entityId);
  }
  if (item.entity === 'client') {
    const { getClientById } = await import('../../features/clients/api');
    return getClientById(item.entityId);
  }
  if (item.entity === 'object') {
    const { getClientObjectById } = await import('../../features/objects/api');
    return getClientObjectById(item.entityId);
  }
  if (item.entity === 'employee') {
    const { getEmployeeById } = await import('../../features/employees/api');
    return getEmployeeById(item.entityId);
  }
  return null;
}

async function updateItemOnline(item: OfflineOutboxItem, latest: any) {
  if (item.entity === 'request') {
    const { updateRequest } = await import('../../features/requests/api');
    return updateRequest(item.entityId, item.patch, latest?.updated_at || item.expectedUpdatedAt || null);
  }
  if (item.entity === 'client') {
    const { updateClient } = await import('../../features/clients/api');
    return updateClient(item.entityId, item.patch);
  }
  if (item.entity === 'object') {
    const { updateClientObject } = await import('../../features/objects/api');
    return updateClientObject(item.entityId, item.patch);
  }
  if (item.entity === 'employee') {
    const { updateEmployeeProfile } = await import('../../features/employees/api');
    return updateEmployeeProfile(item.entityId, item.patch);
  }
  return null;
}

function scheduleOutboxRetry(queryClient: QueryClient, attempts: number) {
  if (syncRetryTimer || attempts >= MAX_ATTEMPTS) return;
  const delay = Math.min(2_000 * 2 ** Math.max(0, attempts - 1), 30_000);
  syncRetryTimer = setTimeout(() => {
    syncRetryTimer = null;
    if (!getOfflineSnapshot().isOnline) return;
    syncOfflineOutbox(queryClient).catch(() => {});
  }, delay);
}

async function runOfflineOutboxSync(queryClient: QueryClient) {
  const snapshot = getOfflineSnapshot();
  if (!snapshot.isOnline) return await getOfflineOutboxSummary();
  const owner = await getActiveOfflineOwner();
  if (!owner) return summarizeOutbox([]);
  await claimLegacyOutboxForOwner(owner, queryClient);

  let initialItems = (await readOutbox()).filter((item) => isOutboxItemOwnedBy(item, owner));
  const hasInterruptedItems = initialItems.some((item) => item.status === 'syncing');
  if (hasInterruptedItems) {
    initialItems = await mutateOutbox((items) => {
      const next = items.map((item) =>
        item.status === 'syncing' && isOutboxItemOwnedBy(item, owner)
          ? { ...item, status: 'pending' as const, updatedAt: nowIso() }
          : item,
      );
      return {
        items: next,
        result: next.filter((item) => isOutboxItemOwnedBy(item, owner)),
      };
    });
  }
  const hasSyncableItems = initialItems.some(
    (item) =>
      (item.status === 'pending' || item.status === 'failed') &&
      !(item.status === 'failed' && item.attempts >= MAX_ATTEMPTS),
  );
  if (!hasSyncableItems) return summarizeOutbox(initialItems);

  isSyncing = true;
  emit();
  try {
    let items = initialItems;
    let changed = false;

    for (const item of [...items]) {
      // A conflict needs a new explicit edit (enqueue resets it to pending).
      // Retrying an unchanged conflicting patch on every launch only burns
      // network/CPU and makes the sync indicator flash without making progress.
      if (item.status !== 'pending' && item.status !== 'failed') continue;
      if (item.attempts >= MAX_ATTEMPTS && item.status === 'failed') continue;

      const processingItem = await mutateOutbox((currentItems) => {
        const currentIndex = currentItems.findIndex((entry) => entry.id === item.id);
        if (currentIndex < 0) return { items: currentItems, result: null };
        const current = currentItems[currentIndex];
        if (!isOutboxItemOwnedBy(current, owner)) {
          return { items: currentItems, result: null };
        }
        if (current.status !== 'pending' && current.status !== 'failed') {
          return { items: currentItems, result: null };
        }
        currentItems[currentIndex] = {
          ...current,
          status: 'syncing',
          attempts: Number(current.attempts || 0) + 1,
          updatedAt: nowIso(),
        };
        return { items: currentItems, result: currentItems[currentIndex] };
      });
      if (!processingItem) continue;

      try {
        const activeOwner = await getActiveOfflineOwner();
        if (!isOutboxItemOwnedBy(processingItem, activeOwner)) {
          await mutateOutbox((currentItems) => {
            const idx = currentItems.findIndex((entry) => entry.id === processingItem.id);
            if (idx >= 0) {
              currentItems[idx] = {
                ...currentItems[idx],
                status: 'pending',
                updatedAt: nowIso(),
              };
            }
            return { items: currentItems, result: undefined };
          });
          break;
        }
        if (processingItem.operation === 'update') {
          const latest = await fetchLatestForItem(processingItem);
          if (hasFieldConflict(processingItem, latest)) {
            await mutateOutbox((currentItems) => {
              const idx = currentItems.findIndex((entry) => entry.id === processingItem.id);
              if (idx >= 0) {
                currentItems[idx] = {
                  ...currentItems[idx],
                  status: 'conflict',
                  latest: latest || null,
                  error: 'Remote row changed in the same fields while this edit was offline',
                  updatedAt: nowIso(),
                };
              }
              return { items: currentItems, result: undefined };
            });
            transientSyncFailures.delete(processingItem.id);
            continue;
          }

          const saved = await updateItemOnline(processingItem, latest);
          const ownerAfterSave = await getActiveOfflineOwner();
          if (isOutboxItemOwnedBy(processingItem, ownerAfterSave)) {
            setEntityQueryData(queryClient, processingItem, saved);
            if (processingItem.entity === 'request') {
              queryClient.invalidateQueries({ queryKey: ['requests'] });
            } else if (processingItem.entity === 'client') {
              queryClient.invalidateQueries({ queryKey: ['clients'] });
              queryClient.invalidateQueries({ queryKey: ['requests'] });
            } else if (processingItem.entity === 'object') {
              queryClient.invalidateQueries({ queryKey: ['objects'] });
              queryClient.invalidateQueries({ queryKey: ['clients'] });
              queryClient.invalidateQueries({ queryKey: ['requests'] });
            } else if (processingItem.entity === 'employee') {
              queryClient.invalidateQueries({ queryKey: ['employees'] });
              queryClient.invalidateQueries({ queryKey: ['requests'] });
            }
            changed = true;
          }
        }

        await mutateOutbox((currentItems) => ({
          items: currentItems.filter((entry) => entry.id !== processingItem.id),
          result: undefined,
        }));
        transientSyncFailures.delete(processingItem.id);
      } catch (error: any) {
        const transientNetworkFailure = isOfflineLikeError(error);
        const failure = await mutateOutbox((currentItems) => {
          const idx = currentItems.findIndex((entry) => entry.id === processingItem.id);
          if (idx < 0) return { items: currentItems, result: null };
          const recordedAttempts = Number(currentItems[idx].attempts || 0);
          const attempts = transientNetworkFailure
            ? Math.max(0, recordedAttempts - 1)
            : recordedAttempts;
          const status = !transientNetworkFailure && attempts >= MAX_ATTEMPTS
            ? 'failed' as const
            : 'pending' as const;
          currentItems[idx] = {
            ...currentItems[idx],
            status,
            attempts,
            error: String(error?.message || error || 'Sync failed'),
            updatedAt: nowIso(),
          };
          return { items: currentItems, result: { attempts, status } };
        });
        if (failure?.status === 'pending') {
          const retryOrdinal = transientNetworkFailure
            ? (transientSyncFailures.get(processingItem.id) || 0) + 1
            : failure.attempts;
          if (transientNetworkFailure) {
            transientSyncFailures.set(processingItem.id, retryOrdinal);
          }
          scheduleOutboxRetry(queryClient, retryOrdinal);
        }
        if (!transientNetworkFailure) transientSyncFailures.delete(processingItem.id);
        if (transientNetworkFailure) break;
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

export function syncOfflineOutbox(queryClient: QueryClient) {
  if (!getOfflineSnapshot().isOnline) return getOfflineOutboxSummary();
  if (syncInFlight) {
    syncRerunRequested = true;
    return syncInFlight;
  }

  syncRerunRequested = false;
  const run = runOfflineOutboxSync(queryClient);
  syncInFlight = run.finally(() => {
    syncInFlight = null;
    if (!syncRerunRequested) return;
    syncRerunRequested = false;
    if (getOfflineSnapshot().isOnline) {
      syncOfflineOutbox(queryClient).catch(() => {});
    }
  });
  return syncInFlight;
}

export async function restoreOfflineOptimisticState(queryClient: QueryClient) {
  const owner = await getActiveOfflineOwner();
  if (!owner) return summarizeOutbox([]);
  await claimLegacyOutboxForOwner(owner, queryClient);
  const items = (await readOutbox()).filter((item) => isOutboxItemOwnedBy(item, owner));
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
          : item.entity === 'employee'
            ? queryClient.getQueryData(queryKeys.employees.detail(item.entityId))
          : null;
    const snapshot = current && typeof current === 'object' ? current : item.base;
    if (snapshot && typeof snapshot === 'object') {
      setEntityQueryData(queryClient, item, {
        ...(snapshot as Record<string, any>),
        ...(item.patch || {}),
        id: item.entityId,
        __offlinePending: true,
        __offlineOutboxId: item.id,
      });
    }
  });
  return summarizeOutbox(items);
}
