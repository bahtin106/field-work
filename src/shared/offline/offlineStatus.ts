import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { APP_RUNTIME_CONFIG } from '../../../config/appRuntime';
import { supabase } from '../../../lib/supabase';
import { detachObjectFromRequestCaches } from '../../features/requests/objectRelationCache';
import { queryKeys } from '../query/queryKeys';
import {
  assertOwnerBoundAuthorization,
  captureOwnerBoundAuthorization,
  isOwnerAuthorizationUnavailableError,
  pinOwnerBoundPostgrestRequest,
  type OwnerBoundAuthorization,
} from '../security/ownerBoundAuthorization';

const OUTBOX_KEY = 'offline.outbox.v1';
const MAX_ATTEMPTS = 8;
const OUTBOX_WRITE_DEADLINE_MS = 12_000;
const OFFLINE_CONFIRMATION_MS = 2500;
const QUALITY_PROBE_INTERVAL_MS = 45_000;
const QUALITY_CONFIRMATION_DELAY_MS = 1_500;
const QUALITY_PROBE_TIMEOUT_MS = 3_500;
const QUALITY_SLOW_RTT_MS = 2_500;
const QUALITY_RECOVERED_RTT_MS = 2_000;
const QUALITY_REQUIRED_SLOW_SAMPLES = 2;
const QUALITY_REQUIRED_GOOD_SAMPLES = 2;
const QUALITY_INITIAL_PROBE_DELAY_MS = 250;

export type OfflineOutboxItem = {
  id: string;
  entity: 'request' | 'client' | 'object' | 'employee' | 'trash';
  operation: 'update' | 'trash' | 'restore';
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

export type OfflineOwnerContext = {
  owner: OfflineOutboxOwner;
  epoch: number;
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
const syncInFlightByOwner = new Map<string, Promise<ReturnType<typeof summarizeOutbox>>>();
const syncRerunRequestedByOwner = new Set<string>();
const syncRetryTimersByOwner = new Map<string, ReturnType<typeof setTimeout>>();
const transientSyncFailures = new Map<string, number>();
let cachedOfflineSnapshot: {
  isNetworkKnown: boolean;
  isOnline: boolean;
  isPoorConnection: boolean;
  isSyncing: boolean;
} | null = null;
const listeners = new Set<Listener>();
let activeOfflineOwner: OfflineOutboxOwner | null = null;
let activeOfflineOwnerEpoch = 0;

function getConnectionIdentity(state: NetInfoState | null) {
  const type = String(state?.type || 'unknown').toLowerCase();
  const cellularGeneration = String((state?.details as any)?.cellularGeneration || '').toLowerCase();
  return `${type}:${cellularGeneration}`;
}

function isConstrainedCellularState(state: NetInfoState | null) {
  if (String(state?.type || '').toLowerCase() !== 'cellular') return false;
  return String((state?.details as any)?.cellularGeneration || '').toLowerCase() === '2g';
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
    // EDGE/GPRS is a useful immediate transport constraint even before an
    // endpoint RTT sample completes. It does not mean "offline": foreground
    // reads may still refresh, while bulk prefetch and route-wide refreshes can
    // yield to the last-known-good cache.
    isPoorConnection:
      isOnline && (confirmedPoorConnection || isConstrainedCellularState(lastNetState)),
    isSyncing,
  };
  return cachedOfflineSnapshot;
}

export function canRunDeferredNetworkWork(snapshot = getOfflineSnapshot()) {
  return snapshot.isNetworkKnown && snapshot.isOnline && !snapshot.isPoorConnection;
}

export function canRunOutboxSync(snapshot = getOfflineSnapshot()) {
  return canRunDeferredNetworkWork(snapshot);
}

export function setOfflineNetState(state: NetInfoState | null) {
  if (isOnlineNetState(state)) {
    const connectionChanged = getConnectionIdentity(lastNetState) !== getConnectionIdentity(state);
    if (connectionChanged) resetNetworkQualityState();
    clearOfflineConfirmation();
    applyNetState(state);
    if (isConstrainedCellularState(state)) {
      // EDGE/GPRS is already conclusively constrained for deferred work. A
      // health probe cannot change that decision, but it can occupy one of the
      // few usable sockets while the foreground restores cached content.
      clearNetworkQualityProbeTimer();
      qualityProbeAbortController?.abort();
      qualityProbeAbortController = null;
      return;
    }
    if (connectionChanged) {
      scheduleNetworkQualityProbe(QUALITY_INITIAL_PROBE_DELAY_MS);
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
  if (
    !qualityMonitoringStarted ||
    !qualityMonitoringActive ||
    !isOnlineNetState(lastNetState) ||
    isConstrainedCellularState(lastNetState)
  ) return;
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
    if (consecutiveSlowSamples >= QUALITY_REQUIRED_SLOW_SAMPLES) {
      setConfirmedPoorConnection(true);
    }
  } else if (sample === 'good') {
    consecutiveGoodSamples += 1;
    consecutiveSlowSamples = 0;
    if (consecutiveGoodSamples >= QUALITY_REQUIRED_GOOD_SAMPLES) {
      setConfirmedPoorConnection(false);
    }
  } else {
    consecutiveSlowSamples = 0;
    consecutiveGoodSamples = 0;
  }

  const needsConfirmation =
    (!confirmedPoorConnection &&
      consecutiveSlowSamples > 0 &&
      consecutiveSlowSamples < QUALITY_REQUIRED_SLOW_SAMPLES) ||
    (confirmedPoorConnection &&
      consecutiveGoodSamples > 0 &&
      consecutiveGoodSamples < QUALITY_REQUIRED_GOOD_SAMPLES);
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
    !isOnlineNetState(lastNetState) ||
    isConstrainedCellularState(lastNetState)
  ) {
    return;
  }

  const baseUrl = String(APP_RUNTIME_CONFIG.supabaseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) return;

  const connectionIdentity = getConnectionIdentity(lastNetState);
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
  // A cellular generation is only a rough transport hint, and an immediate
  // probe failure can be caused by the endpoint, TLS, a VPN, or a proxy. Do
  // not present either as a fact about the user's internet quality. A
  // successful slow round-trip or a real timeout is measurable evidence.
  const sample = requestSucceeded
    ? elapsedMs >= QUALITY_SLOW_RTT_MS
      ? 'slow'
      : elapsedMs <= QUALITY_RECOVERED_RTT_MS
        ? 'good'
        : 'neutral'
    : probeTimedOut
      ? 'slow'
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

export function setActiveOfflineOwner(owner: OfflineOutboxOwner | null | undefined) {
  const userId = String(owner?.userId || '').trim();
  const companyId = String(owner?.companyId || '').trim() || null;
  const next = userId ? { userId, companyId } : null;
  if (
    activeOfflineOwner?.userId === next?.userId &&
    activeOfflineOwner?.companyId === next?.companyId
  ) {
    return activeOfflineOwnerEpoch;
  }
  activeOfflineOwner = next;
  activeOfflineOwnerEpoch += 1;
  refreshActiveOwnerSyncIndicator();
  return activeOfflineOwnerEpoch;
}

export function clearActiveOfflineOwner() {
  activeOfflineOwner = null;
  activeOfflineOwnerEpoch += 1;
  refreshActiveOwnerSyncIndicator();
  return activeOfflineOwnerEpoch;
}

export function getActiveOfflineOwner(): OfflineOutboxOwner | null {
  return activeOfflineOwner ? { ...activeOfflineOwner } : null;
}

export function getActiveOfflineOwnerContext(): OfflineOwnerContext | null {
  const owner = getActiveOfflineOwner();
  if (!owner?.userId || !owner.companyId) return null;
  return { owner, epoch: activeOfflineOwnerEpoch };
}

export function isActiveOfflineOwnerContext(context: OfflineOwnerContext | null | undefined) {
  if (!context?.owner?.userId || !context.owner.companyId) return false;
  return (
    context.epoch === activeOfflineOwnerEpoch &&
    context.owner.userId === activeOfflineOwner?.userId &&
    context.owner.companyId === activeOfflineOwner?.companyId
  );
}

function getOfflineOwnerRunKey(context: OfflineOwnerContext) {
  return `${context.owner.userId}:${context.owner.companyId}:${context.epoch}`;
}

function refreshActiveOwnerSyncIndicator() {
  const activeContext = getActiveOfflineOwnerContext();
  const nextIsSyncing = activeContext
    ? syncInFlightByOwner.has(getOfflineOwnerRunKey(activeContext))
    : false;
  if (nextIsSyncing === isSyncing) return;
  isSyncing = nextIsSyncing;
  emit();
}

export function isOfflineItemOwnedBy(
  item: { ownerUserId?: string | null; ownerCompanyId?: string | null } | null | undefined,
  owner: OfflineOutboxOwner | null,
) {
  if (!owner?.userId) return false;
  if (!owner.companyId) return false;
  const itemUserId = String(item?.ownerUserId || '').trim();
  if (!itemUserId || itemUserId !== owner.userId) return false;
  const itemCompanyId = String(item?.ownerCompanyId || '').trim();
  return !!itemCompanyId && itemCompanyId === owner.companyId;
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
  const itemOwnerUserId = String(item?.ownerUserId || '').trim();
  const itemOwnerCompanyId = String(item?.ownerCompanyId || '').trim();
  if (itemOwnerCompanyId) return false;
  if (itemOwnerUserId && itemOwnerUserId !== owner.userId) return false;
  if (!owner.companyId) return false;
  const activeProfile = queryClient.getQueryData(queryKeys.profile.me()) as any;
  if (String(activeProfile?.id || '').trim() !== owner.userId) return false;
  if (String(activeProfile?.company_id || '').trim() !== owner.companyId) return false;

  const baseCompanyMatches = String(item?.base?.company_id || '').trim() === owner.companyId;
  const detailKey = getOutboxDetailQueryKey(item);
  const cachedDetail = detailKey ? queryClient.getQueryData(detailKey) as any : null;
  const pendingDetailMatches =
    String(cachedDetail?.company_id || '').trim() === owner.companyId &&
    cachedDetail?.__offlinePending === true &&
    String(cachedDetail?.__offlineOutboxId || '').trim() === String(item.id || '').trim();

  // Older builds stored the authenticated user but could miss the company.
  // Claim those rows only when company-scoped cached data proves ownership;
  // otherwise leave them quarantined instead of reintroducing a wildcard.
  return itemOwnerUserId
    ? baseCompanyMatches || pendingDetailMatches
    : pendingDetailMatches;
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

async function claimLegacyOutboxForOwner(
  ownerContext: OfflineOwnerContext,
  queryClient: QueryClient,
) {
  const { owner } = ownerContext;
  const snapshot = await readOutbox();
  if (!isActiveOfflineOwnerContext(ownerContext)) return;
  if (!snapshot.some((item) => isLegacyOutboxItemClaimable(item, owner, queryClient))) return;
  await mutateOutbox((items) => ({
    items: !isActiveOfflineOwnerContext(ownerContext)
      ? items
      : items.map((item) =>
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
  const ownerContext = getActiveOfflineOwnerContext();
  if (!ownerContext) throw new Error('Company-scoped session is required for offline changes');
  const { owner } = ownerContext;

  return mutateOutbox((items) => {
    if (!isActiveOfflineOwnerContext(ownerContext)) {
      throw new Error('Offline owner changed before request enqueue');
    }
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
  const ownerContext = getActiveOfflineOwnerContext();
  if (!ownerContext) throw new Error('Company-scoped session is required for offline changes');
  const { owner } = ownerContext;

  return mutateOutbox((items) => {
    if (!isActiveOfflineOwnerContext(ownerContext)) {
      throw new Error('Offline owner changed before entity enqueue');
    }
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

export async function enqueueTrashDelete({
  entity,
  id,
  base = null,
}: {
  entity: 'request' | 'client' | 'object';
  id: string;
  base?: Record<string, any> | null;
}) {
  return enqueueTrashOperation({ entity, operation: 'trash', id, base });
}

export async function enqueueTrashRestore(id: string) {
  return enqueueTrashOperation({ entity: 'trash', operation: 'restore', id, base: null });
}

export async function hasPendingOfflineUpdate(
  entity: 'request' | 'client' | 'object',
  id: string,
) {
  const [items, owner] = await Promise.all([readOutbox(), getActiveOfflineOwner()]);
  return items.some((item) =>
    item.entity === entity &&
    item.operation === 'update' &&
    item.entityId === String(id || '').trim() &&
    isOutboxItemOwnedBy(item, owner),
  );
}

async function enqueueTrashOperation({
  entity,
  operation,
  id,
  base,
}: {
  entity: 'request' | 'client' | 'object' | 'trash';
  operation: 'trash' | 'restore';
  id: string;
  base: Record<string, any> | null;
}) {
  const entityId = String(id || '').trim();
  if (!entityId) throw new Error('Entity id is required');
  const ownerContext = getActiveOfflineOwnerContext();
  if (!ownerContext) throw new Error('Company-scoped session is required for offline changes');
  const { owner } = ownerContext;

  return mutateOutbox((items) => {
    if (!isActiveOfflineOwnerContext(ownerContext)) {
      throw new Error('Offline owner changed before trash enqueue');
    }
    const existing = items.find(
      (item) =>
        item.entity === entity &&
        item.operation === operation &&
        item.entityId === entityId &&
        isOutboxItemOwnedBy(item, owner) &&
        item.status !== 'conflict',
    );
    if (existing) return { items, result: existing };

    const stamp = nowIso();
    const item: OfflineOutboxItem = {
      id: makeOutboxId(entity, operation, entityId),
      entity,
      operation,
      entityId,
      patch: {},
      base,
      expectedUpdatedAt: null,
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
  if (
    item.entity === 'request' &&
    Object.prototype.hasOwnProperty.call(item.patch || {}, 'status') &&
    !isSemanticallyEqual(item.base?.assigned_to, latest?.assigned_to)
  ) {
    return true;
  }
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

function isPatchAlreadyApplied(item: OfflineOutboxItem, latest: Record<string, any> | null) {
  if (!latest) return false;
  const patchKeys = Object.keys(item.patch || {});
  return patchKeys.length > 0 && patchKeys.every((key) =>
    isSemanticallyEqual(latest?.[key], item.patch?.[key]),
  );
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

function pruneEntityFromCache(value: any, entityId: string): any {
  if (Array.isArray(value)) {
    const next = value
      .filter((row) => String(row?.id || '') !== entityId)
      .map((row) => pruneEntityFromCache(row, entityId));
    return next;
  }
  if (!value || typeof value !== 'object') return value;
  const next: Record<string, any> = { ...value };
  if (Array.isArray(next.items)) next.items = pruneEntityFromCache(next.items, entityId);
  if (Array.isArray(next.pages)) next.pages = next.pages.map((page: any) => pruneEntityFromCache(page, entityId));
  if (Array.isArray(next.objects)) next.objects = pruneEntityFromCache(next.objects, entityId);
  return next;
}

function applyOptimisticTrashOperation(queryClient: QueryClient, item: OfflineOutboxItem) {
  if (item.operation === 'restore') {
    queryClient.setQueriesData({ queryKey: ['trash', 'list'] }, (old) =>
      pruneEntityFromCache(old, item.entityId),
    );
    queryClient.removeQueries({ queryKey: queryKeys.trash.detail(item.entityId), exact: true });
    return;
  }
  if (item.operation !== 'trash') return;

  const id = item.entityId;
  if (item.entity === 'request') {
    queryClient.setQueriesData({ queryKey: ['requests'] }, (old) => pruneEntityFromCache(old, id));
    queryClient.setQueriesData({ queryKey: ['orders'] }, (old) => pruneEntityFromCache(old, id));
    queryClient.removeQueries({ queryKey: queryKeys.requests.detail(id), exact: true });
  } else if (item.entity === 'client') {
    queryClient.setQueriesData({ queryKey: ['clients'] }, (old) => pruneEntityFromCache(old, id));
    queryClient.removeQueries({ queryKey: queryKeys.clients.detail(id), exact: true });
    const objectIds = Array.isArray(item.base?.objects)
      ? item.base.objects.map((row: any) => String(row?.id || '')).filter(Boolean)
      : [];
    objectIds.forEach((objectId: string) => {
      queryClient.setQueriesData({ queryKey: ['objects'] }, (old) => pruneEntityFromCache(old, objectId));
      queryClient.removeQueries({ queryKey: queryKeys.objects.detail(objectId), exact: true });
    });
  } else if (item.entity === 'object') {
    queryClient.setQueriesData({ queryKey: ['objects'] }, (old) => pruneEntityFromCache(old, id));
    queryClient.setQueriesData({ queryKey: ['clients'] }, (old) => pruneEntityFromCache(old, id));
    queryClient.removeQueries({ queryKey: queryKeys.objects.detail(id), exact: true });
    detachObjectFromRequestCaches(queryClient, id);
  }
}

async function performTrashOperationOnline(
  item: OfflineOutboxItem,
  ownerContext: OfflineOwnerContext,
  authorization: OwnerBoundAuthorization,
  signal?: AbortSignal,
) {
  assertOfflineOwnerContext(ownerContext);
  assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
  if (item.operation === 'restore') {
    let request = pinOwnerBoundPostgrestRequest(
      supabase.rpc('restore_trash_item', { p_id: item.entityId }),
      authorization,
      ownerContext.owner.userId,
    );
    if (signal) request = request.abortSignal(signal);
    const { error } = await request;
    assertOfflineOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
    if (error) throw error;
    return;
  }
  if (item.operation !== 'trash') return;

  const table = item.entity === 'request'
    ? 'orders'
    : item.entity === 'client'
      ? 'clients'
      : item.entity === 'object'
        ? 'client_objects'
        : null;
  if (!table) throw new Error(`Unsupported trash entity: ${item.entity}`);
  let query = supabase.from(table).delete().eq('id', item.entityId);
  if (item.ownerCompanyId) query = query.eq('company_id', item.ownerCompanyId);
  query = pinOwnerBoundPostgrestRequest(
    query,
    authorization,
    ownerContext.owner.userId,
  );
  if (signal) query = query.abortSignal(signal);
  const { error } = await query;
  assertOfflineOwnerContext(ownerContext);
  assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
  if (error) throw error;
}

function invalidateTrashOperationQueries(queryClient: QueryClient, item: OfflineOutboxItem) {
  queryClient.invalidateQueries({ queryKey: ['trash'] });
  if (item.operation === 'restore') {
    queryClient.invalidateQueries({ queryKey: ['requests'] });
    queryClient.invalidateQueries({ queryKey: ['clients'] });
    queryClient.invalidateQueries({ queryKey: ['objects'] });
    return;
  }
  if (item.entity === 'request') queryClient.invalidateQueries({ queryKey: ['requests'] });
  if (item.entity === 'client') queryClient.invalidateQueries({ queryKey: ['clients'] });
  if (item.entity === 'object') queryClient.invalidateQueries({ queryKey: ['objects'] });
  queryClient.invalidateQueries({ queryKey: ['clients', 'delete-blockers'] });
}

async function fetchLatestForItem(
  item: OfflineOutboxItem,
  ownerContext: OfflineOwnerContext,
  authorization: OwnerBoundAuthorization,
) {
  assertOfflineOwnerContext(ownerContext);
  assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
  const controller = new AbortController();
  const timeoutMs = 12_000;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const readWithDeadline = async <T>(
    label: string,
    reader: (signal: AbortSignal) => Promise<T>,
  ) => {
    try {
      return await Promise.race([
        reader(controller.signal),
        new Promise<T>((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            const error = new Error(`${label} timed out after ${timeoutMs}ms`) as Error & {
              code?: string;
            };
            error.name = 'ReadDeadlineError';
            error.code = 'READ_DEADLINE_EXCEEDED';
            controller.abort(error);
            reject(error);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  if (item.entity === 'request') {
    const { getRequestById } = await import('../../features/requests/api');
    assertOfflineOwnerContext(ownerContext);
    const result = await readWithDeadline('Offline request conflict check', (signal) =>
      getRequestById(item.entityId, signal, { authorization }),
    );
    assertOfflineOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
    return result;
  }
  if (item.entity === 'client') {
    const { getClientByIdForOfflineSync } = await import('../../features/clients/api');
    assertOfflineOwnerContext(ownerContext);
    const result = await readWithDeadline('Offline client conflict check', (signal) =>
      getClientByIdForOfflineSync(item.entityId, {
        authorization,
        companyId: ownerContext.owner.companyId,
        signal,
      }),
    );
    assertOfflineOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
    return result;
  }
  if (item.entity === 'object') {
    const { getClientObjectByIdForOfflineSync } = await import('../../features/objects/api');
    assertOfflineOwnerContext(ownerContext);
    const result = await readWithDeadline('Offline object conflict check', (signal) =>
      getClientObjectByIdForOfflineSync(item.entityId, {
        authorization,
        companyId: ownerContext.owner.companyId,
        signal,
      }),
    );
    assertOfflineOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
    return result;
  }
  if (item.entity === 'employee') {
    const { getEmployeeByIdForOfflineSync } = await import('../../features/employees/api');
    assertOfflineOwnerContext(ownerContext);
    const result = await readWithDeadline('Offline employee conflict check', (signal) =>
      getEmployeeByIdForOfflineSync(item.entityId, {
        authorization,
        companyId: ownerContext.owner.companyId,
        signal,
      }),
    );
    assertOfflineOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
    return result;
  }
  if (item.entity === 'trash' && item.operation === 'restore') {
    const result = await readWithDeadline('Offline trash restore verification', async (signal) => {
      let request = pinOwnerBoundPostgrestRequest(
        supabase.rpc('get_trash_item', { p_id: item.entityId }),
        authorization,
        ownerContext.owner.userId,
      );
      request = request.abortSignal(signal);
      const { data, error } = await request;
      assertOfflineOwnerContext(ownerContext);
      assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
      // A successful restore removes the trash entry, and get_trash_item
      // reports that state as P0002 rather than returning null. Treat only
      // that exact server result as confirmation; permission and transport
      // errors must remain pending/failed and must not be acknowledged.
      if (error?.code === 'P0002') return null;
      if (error) throw error;
      return data || null;
    });
    assertOfflineOwnerContext(ownerContext);
    return result;
  }
  return null;
}

async function runOutboxWriteWithDeadline<T>(
  label: string,
  writer: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timeoutError = new Error(
    `${label} timed out after ${OUTBOX_WRITE_DEADLINE_MS}ms; completion is ambiguous`,
  ) as Error & { code?: string; ambiguous?: boolean };
  timeoutError.name = 'OutboxWriteDeadlineError';
  timeoutError.code = 'OUTBOX_WRITE_AMBIGUOUS';
  timeoutError.ambiguous = true;

  const writePromise = Promise.resolve()
    .then(() => writer(controller.signal))
    .catch((error) => {
      if (timedOut) throw timeoutError;
      throw error;
    });
  try {
    return await Promise.race([
      writePromise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort(timeoutError);
          reject(timeoutError);
        }, OUTBOX_WRITE_DEADLINE_MS);
      }),
    ]);
  } catch (error) {
    if (timedOut) throw timeoutError;
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function updateItemOnline(
  item: OfflineOutboxItem,
  latest: any,
  ownerContext: OfflineOwnerContext,
  authorization: OwnerBoundAuthorization,
  signal?: AbortSignal,
) {
  assertOfflineOwnerContext(ownerContext);
  assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
  if (item.entity === 'request') {
    const { updateRequest } = await import('../../features/requests/api');
    assertOfflineOwnerContext(ownerContext);
    const result = await updateRequest(
      item.entityId,
      item.patch,
      latest?.updated_at || item.expectedUpdatedAt || null,
      signal,
      { retryOnVersionMismatch: false, authorization },
    );
    assertOfflineOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
    return result;
  }
  if (item.entity === 'client') {
    const { updateClient } = await import('../../features/clients/api');
    assertOfflineOwnerContext(ownerContext);
    const result = await updateClient(item.entityId, item.patch, signal, {
      authorization,
      companyId: ownerContext.owner.companyId,
    });
    assertOfflineOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
    return result;
  }
  if (item.entity === 'object') {
    const { updateClientObject } = await import('../../features/objects/api');
    assertOfflineOwnerContext(ownerContext);
    const result = await updateClientObject(item.entityId, item.patch, signal, {
      authorization,
      companyId: ownerContext.owner.companyId,
    });
    assertOfflineOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
    return result;
  }
  if (item.entity === 'employee') {
    const { updateEmployeeProfile } = await import('../../features/employees/api');
    assertOfflineOwnerContext(ownerContext);
    const result = await updateEmployeeProfile(item.entityId, item.patch, signal, {
      authorization,
      companyId: ownerContext.owner.companyId,
    });
    assertOfflineOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authorization, ownerContext.owner.userId);
    return result;
  }
  return null;
}

function scheduleOutboxRetry(
  queryClient: QueryClient,
  attempts: number,
  ownerContext: OfflineOwnerContext,
) {
  const ownerRunKey = getOfflineOwnerRunKey(ownerContext);
  if (syncRetryTimersByOwner.has(ownerRunKey) || attempts >= MAX_ATTEMPTS) return;
  const delay = Math.min(2_000 * 2 ** Math.max(0, attempts - 1), 30_000);
  const timer = setTimeout(() => {
    syncRetryTimersByOwner.delete(ownerRunKey);
    if (!isActiveOfflineOwnerContext(ownerContext) || !canRunOutboxSync()) return;
    syncOfflineOutbox(queryClient).catch(() => {});
  }, delay);
  syncRetryTimersByOwner.set(ownerRunKey, timer);
}

function assertOfflineOwnerContext(context: OfflineOwnerContext) {
  if (isActiveOfflineOwnerContext(context)) return;
  const error = new Error('Offline owner changed during sync') as Error & { code?: string };
  error.code = 'OFFLINE_OWNER_CHANGED';
  throw error;
}

async function runOfflineOutboxSync(
  queryClient: QueryClient,
  ownerContext: OfflineOwnerContext,
) {
  const snapshot = getOfflineSnapshot();
  if (!canRunOutboxSync(snapshot)) return await getOfflineOutboxSummary();
  if (!isActiveOfflineOwnerContext(ownerContext)) return summarizeOutbox([]);
  const ownerRunKey = getOfflineOwnerRunKey(ownerContext);
  const { owner } = ownerContext;
  await claimLegacyOutboxForOwner(ownerContext, queryClient);
  assertOfflineOwnerContext(ownerContext);

  let initialItems = (await readOutbox()).filter((item) => isOutboxItemOwnedBy(item, owner));
  assertOfflineOwnerContext(ownerContext);
  const hasInterruptedItems = initialItems.some((item) => item.status === 'syncing');
  if (hasInterruptedItems) {
    initialItems = await mutateOutbox((items) => {
      assertOfflineOwnerContext(ownerContext);
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

  let items = initialItems;
  let changed = false;

    for (const item of [...items]) {
      if (!canRunOutboxSync()) break;
      if (!isActiveOfflineOwnerContext(ownerContext)) break;
      // A conflict needs a new explicit edit (enqueue resets it to pending).
      // Retrying an unchanged conflicting patch on every launch only burns
      // network/CPU and makes the sync indicator flash without making progress.
      if (item.status !== 'pending' && item.status !== 'failed') continue;
      if (item.attempts >= MAX_ATTEMPTS && item.status === 'failed') continue;
      if (item.operation === 'trash') {
        const currentItems = await readOutbox();
        assertOfflineOwnerContext(ownerContext);
        const waitsForUpdate = currentItems.some((entry) =>
          entry.entity === item.entity &&
          entry.entityId === item.entityId &&
          entry.operation === 'update' &&
          isOutboxItemOwnedBy(entry, owner),
        );
        if (waitsForUpdate) continue;
      }

      const processingItem = await mutateOutbox((currentItems) => {
        if (!isActiveOfflineOwnerContext(ownerContext)) {
          return { items: currentItems, result: null };
        }
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
        assertOfflineOwnerContext(ownerContext);
        const authorization = await captureOwnerBoundAuthorization(owner.userId);
        assertOfflineOwnerContext(ownerContext);
        assertOwnerBoundAuthorization(authorization, owner.userId);
        if (processingItem.operation === 'update') {
          const latest = await fetchLatestForItem(
            processingItem,
            ownerContext,
            authorization,
          );
          assertOfflineOwnerContext(ownerContext);
          if (hasFieldConflict(processingItem, latest)) {
            await mutateOutbox((currentItems) => {
              assertOfflineOwnerContext(ownerContext);
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

          assertOfflineOwnerContext(ownerContext);
          const saved = isPatchAlreadyApplied(processingItem, latest)
            ? latest
            : await runOutboxWriteWithDeadline(
                `Offline ${processingItem.entity} update`,
                (signal) => updateItemOnline(
                  processingItem,
                  latest,
                  ownerContext,
                  authorization,
                  signal,
                ),
              );
          assertOfflineOwnerContext(ownerContext);
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
        } else if (processingItem.operation === 'trash' || processingItem.operation === 'restore') {
          assertOfflineOwnerContext(ownerContext);
          const restoreAlreadyApplied = processingItem.operation === 'restore'
            ? !(await fetchLatestForItem(
                processingItem,
                ownerContext,
                authorization,
              ))
            : false;
          assertOfflineOwnerContext(ownerContext);
          if (!restoreAlreadyApplied) {
            await runOutboxWriteWithDeadline(
              `Offline ${processingItem.operation} operation`,
              (signal) => performTrashOperationOnline(
                processingItem,
                ownerContext,
                authorization,
                signal,
              ),
            );
          }
          assertOfflineOwnerContext(ownerContext);
          applyOptimisticTrashOperation(queryClient, processingItem);
          invalidateTrashOperationQueries(queryClient, processingItem);
          changed = true;
        }

        assertOfflineOwnerContext(ownerContext);
        await mutateOutbox((currentItems) => ({
          items: currentItems.filter((entry) => entry.id !== processingItem.id),
          result: undefined,
        }));
        if (processingItem.operation === 'update') {
          syncRerunRequestedByOwner.add(ownerRunKey);
        }
        transientSyncFailures.delete(processingItem.id);
      } catch (error: any) {
        if (
          !isActiveOfflineOwnerContext(ownerContext) ||
          error?.code === 'OFFLINE_OWNER_CHANGED'
        ) {
          await mutateOutbox((currentItems) => {
            const idx = currentItems.findIndex(
              (entry) =>
                entry.id === processingItem.id &&
                isOutboxItemOwnedBy(entry, owner),
            );
            if (idx >= 0 && currentItems[idx].status === 'syncing') {
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
        const transientNetworkFailure =
          isOfflineLikeError(error) || isOwnerAuthorizationUnavailableError(error);
        const failure = await mutateOutbox((currentItems) => {
          const idx = currentItems.findIndex(
            (entry) =>
              entry.id === processingItem.id &&
              isOutboxItemOwnedBy(entry, owner),
          );
          if (idx < 0) return { items: currentItems, result: null };
          if (!isActiveOfflineOwnerContext(ownerContext)) {
            if (currentItems[idx].status === 'syncing') {
              currentItems[idx] = {
                ...currentItems[idx],
                status: 'pending',
                updatedAt: nowIso(),
              };
            }
            return {
              items: currentItems,
              result: { ownerChanged: true, attempts: 0, status: 'pending' as const },
            };
          }
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
          return { items: currentItems, result: { ownerChanged: false, attempts, status } };
        });
        if (failure?.ownerChanged || !isActiveOfflineOwnerContext(ownerContext)) break;
        if (failure?.status === 'pending') {
          const retryOrdinal = transientNetworkFailure
            ? (transientSyncFailures.get(processingItem.id) || 0) + 1
            : failure.attempts;
          if (transientNetworkFailure) {
            transientSyncFailures.set(processingItem.id, retryOrdinal);
          }
          scheduleOutboxRetry(queryClient, retryOrdinal, ownerContext);
        }
        if (failure?.status === 'failed' && processingItem.operation === 'trash') {
          if (processingItem.base) setEntityQueryData(queryClient, processingItem, processingItem.base);
          invalidateTrashOperationQueries(queryClient, processingItem);
        } else if (failure?.status === 'failed' && processingItem.operation === 'restore') {
          queryClient.invalidateQueries({ queryKey: ['trash'] });
        }
        if (!transientNetworkFailure) transientSyncFailures.delete(processingItem.id);
        if (transientNetworkFailure) break;
      }
    }

  if (changed) {
    queryClient.invalidateQueries({ queryKey: ['clients', 'delete-blockers'] });
  }
  return await getOfflineOutboxSummary();
}

export function syncOfflineOutbox(queryClient: QueryClient) {
  if (!canRunOutboxSync()) return getOfflineOutboxSummary();
  const ownerContext = getActiveOfflineOwnerContext();
  if (!ownerContext) return Promise.resolve(summarizeOutbox([]));
  const ownerRunKey = getOfflineOwnerRunKey(ownerContext);
  const existingRun = syncInFlightByOwner.get(ownerRunKey);
  if (existingRun) {
    syncRerunRequestedByOwner.add(ownerRunKey);
    return existingRun;
  }

  syncRerunRequestedByOwner.delete(ownerRunKey);
  const run = runOfflineOutboxSync(queryClient, ownerContext);
  const trackedRun = run.finally(() => {
    if (syncInFlightByOwner.get(ownerRunKey) === trackedRun) {
      syncInFlightByOwner.delete(ownerRunKey);
    }
    refreshActiveOwnerSyncIndicator();
    if (!syncRerunRequestedByOwner.has(ownerRunKey)) return;
    syncRerunRequestedByOwner.delete(ownerRunKey);
    if (isActiveOfflineOwnerContext(ownerContext) && canRunOutboxSync()) {
      syncOfflineOutbox(queryClient).catch(() => {});
    }
  });
  syncInFlightByOwner.set(ownerRunKey, trackedRun);
  refreshActiveOwnerSyncIndicator();
  return trackedRun;
}

export async function restoreOfflineOptimisticState(queryClient: QueryClient) {
  const ownerContext = getActiveOfflineOwnerContext();
  if (!ownerContext) return summarizeOutbox([]);
  const { owner } = ownerContext;
  await claimLegacyOutboxForOwner(ownerContext, queryClient);
  if (!isActiveOfflineOwnerContext(ownerContext)) return summarizeOutbox([]);
  const items = (await readOutbox()).filter((item) => isOutboxItemOwnedBy(item, owner));
  if (!isActiveOfflineOwnerContext(ownerContext)) return summarizeOutbox([]);
  items.forEach((item) => {
    if (!isActiveOfflineOwnerContext(ownerContext)) return;
    if (item.operation === 'trash' || item.operation === 'restore') {
      applyOptimisticTrashOperation(queryClient, item);
      return;
    }
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
