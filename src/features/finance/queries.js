import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getActiveOfflineOwner,
  getOfflineSnapshot,
  isOfflineItemOwnedBy,
  isOfflineLikeError,
} from '../../shared/offline/offlineStatus';
import {
  deleteCompanyFinanceRule,
  deleteOrderFinanceEntry,
  excludeOrderFinanceRule,
  listCompanyFinanceRules,
  listOrderFinanceEntries,
  upsertCompanyFinanceRule,
  upsertOrderFinanceEntry,
} from './api';

const FINANCE_OUTBOX_KEY = 'offline.finance.outbox.v1';
let financeOutboxMutation = Promise.resolve();
let financeSyncInFlight = null;

export const financeQueryKeys = {
  orderEntries: (orderId) => ['finance', 'order-entries', String(orderId || '')],
  companyRules: (companyId) => ['finance', 'company-rules', String(companyId || '')],
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function shouldAttemptOnlineWrite() {
  const snapshot = getOfflineSnapshot();
  // NetInfo is briefly unknown during a cold start. Try the server first in
  // that state and fall back to the durable outbox only on a network error.
  if (!snapshot.isNetworkKnown) return true;
  return onlineManager.isOnline() && snapshot.isOnline;
}

async function readFinanceOutboxStorage() {
  try {
    const raw = await AsyncStorage.getItem(FINANCE_OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFinanceOutboxStorage(items) {
  await AsyncStorage.setItem(FINANCE_OUTBOX_KEY, JSON.stringify(Array.isArray(items) ? items : []));
}

async function readFinanceOutbox() {
  await financeOutboxMutation.catch(() => {});
  return readFinanceOutboxStorage();
}

function mutateFinanceOutbox(mutator) {
  const operation = financeOutboxMutation.then(async () => {
    const current = await readFinanceOutboxStorage();
    const result = await mutator([...current]);
    await writeFinanceOutboxStorage(result?.items ?? current);
    return result?.value;
  });
  financeOutboxMutation = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function makeUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function calculateEntryAmount(entry, allEntries = [], startPrice = 0) {
  const mode = String(entry?.calc_mode || 'fixed');
  if (mode === 'fixed') return normalizeMoney(entry?.input_amount);
  const percent = normalizeMoney(entry?.input_percent);
  const p = percent / 100;
  const basePrice = normalizeMoney(startPrice);
  const incomeTotal = allEntries
    .filter((row) => row?.kind === 'income' && String(row?.id || '') !== String(entry?.id || ''))
    .reduce((sum, row) => sum + normalizeMoney(row?.calculated_amount), 0);
  const discountTotal = allEntries
    .filter((row) => row?.kind === 'discount' && String(row?.id || '') !== String(entry?.id || ''))
    .reduce((sum, row) => sum + normalizeMoney(row?.calculated_amount), 0);
  const grossBeforeDiscount = basePrice + incomeTotal;
  const grossAfterDiscount = grossBeforeDiscount - discountTotal;
  const base = String(entry?.percent_base || 'base_price');
  const baseAmount =
    base === 'gross_before_discount'
      ? grossBeforeDiscount
      : base === 'gross_after_discount'
        ? grossAfterDiscount
        : base === 'income_total'
          ? incomeTotal
          : basePrice;
  return normalizeMoney(baseAmount * p);
}

function mergeOutboxEntries(baseEntries, outbox, orderId, owner) {
  let next = Array.isArray(baseEntries) ? [...baseEntries] : [];
  const mine = (outbox || []).filter(
    (item) =>
      isOfflineItemOwnedBy(item, owner) &&
      String(item?.order_id || '') === String(orderId || ''),
  );
  for (const item of mine) {
    if (item?.operation === 'delete') {
      next = next.filter((row) => String(row?.id || '') !== String(item?.entry_id || ''));
      continue;
    }
    if (item?.operation === 'upsert' && item?.entry) {
      const idx = next.findIndex((row) => String(row?.id || '') === String(item.entry.id || ''));
      if (idx >= 0) next[idx] = { ...next[idx], ...item.entry, __offlinePending: true };
      else next.push({ ...item.entry, __offlinePending: true });
    }
  }
  return next;
}

async function runFinanceOutboxSync(queryClient) {
  const initialNetwork = getOfflineSnapshot();
  if (initialNetwork.isNetworkKnown && !initialNetwork.isOnline) return;
  const owner = await getActiveOfflineOwner();
  if (!owner) return;
  const snapshot = await readFinanceOutbox();
  const mine = snapshot.filter((item) => isOfflineItemOwnedBy(item, owner));
  for (const item of mine) {
    const network = getOfflineSnapshot();
    if (network.isNetworkKnown && !network.isOnline) break;
    const activeOwner = await getActiveOfflineOwner();
    if (!isOfflineItemOwnedBy(item, activeOwner)) break;
    try {
      if (item.operation === 'delete') {
        await deleteOrderFinanceEntry(item.entry_id);
      } else if (item.operation === 'upsert') {
        await upsertOrderFinanceEntry(item.entry);
      }
      await mutateFinanceOutbox((items) => ({
        items: items.filter(
          (row) =>
            String(row?.id || '') !== String(item?.id || '') ||
            !isOfflineItemOwnedBy(row, activeOwner),
        ),
      }));
      if (item?.order_id) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(item.order_id) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', String(item.order_id)] });
      }
    } catch (error) {
      if (isOfflineLikeError(error)) break;
      await mutateFinanceOutbox((items) => ({
        items: items.map((row) =>
          String(row?.id || '') === String(item?.id || '') && isOfflineItemOwnedBy(row, activeOwner)
            ? {
                ...row,
                status: 'failed',
                attempts: Number(row?.attempts || 0) + 1,
                updated_at: nowIso(),
              }
            : row,
        ),
      }));
    }
  }
}

export async function syncOfflineFinanceOutbox(queryClient, _orderId = null) {
  if (financeSyncInFlight) return financeSyncInFlight;
  financeSyncInFlight = runFinanceOutboxSync(queryClient).finally(() => {
    financeSyncInFlight = null;
  });
  return financeSyncInFlight;
}

export function useOrderFinanceEntries(orderId, options = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: financeQueryKeys.orderEntries(orderId),
    queryFn: async () => {
      try {
        const rows = await listOrderFinanceEntries(orderId);
        const [outbox, owner] = await Promise.all([readFinanceOutbox(), getActiveOfflineOwner()]);
        return mergeOutboxEntries(rows, outbox, orderId, owner);
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(financeQueryKeys.orderEntries(orderId));
        const [outbox, owner] = await Promise.all([readFinanceOutbox(), getActiveOfflineOwner()]);
        return mergeOutboxEntries(Array.isArray(cached) ? cached : [], outbox, orderId, owner);
      }
    },
    enabled: !!orderId,
    staleTime: 30 * 1000,
    ...options,
    // Never carry finance rows across identity keys. Showing the previous
    // order's entries while a new order loads can lead to editing the wrong row.
    placeholderData: () => undefined,
  });
}

export function useUpsertOrderFinanceEntryMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const stablePayload = { ...(payload || {}), id: payload?.id || makeUuid() };
      if (shouldAttemptOnlineWrite()) {
        try {
          return await upsertOrderFinanceEntry(stablePayload);
        } catch (error) {
          if (!isOfflineLikeError(error)) throw error;
        }
      }
      const owner = await getActiveOfflineOwner();
      if (!owner) throw new Error('Authenticated session is required for offline finance changes');
      const item = {
        id: `finance:upsert:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        operation: 'upsert',
        order_id: String(stablePayload?.order_id || orderId || ''),
        entry: stablePayload,
        created_at: nowIso(),
        status: 'pending',
        attempts: 0,
        ownerUserId: owner.userId,
        ownerCompanyId: owner.companyId,
      };
      await mutateFinanceOutbox((items) => ({ items: [...items, item] }));
      return { ...stablePayload, __offlinePending: true };
    },
    onMutate: async (payload) => {
      if (!payload.id) payload.id = makeUuid();
      const targetOrderId = String(payload?.order_id || orderId || '');
      const key = financeQueryKeys.orderEntries(targetOrderId);
      const prev = queryClient.getQueryData(key);
      const orderDetail = queryClient.getQueryData(['requests', 'detail', targetOrderId]);
      const startPrice = Number(orderDetail?.start_price ?? 0) || 0;
      const current = Array.isArray(prev) ? [...prev] : [];
      const optimisticId = payload.id;
      const optimistic = {
        ...payload,
        id: optimisticId,
        calculated_amount: calculateEntryAmount({ ...payload, id: optimisticId }, current, startPrice),
        __offlinePending: true,
      };
      const idx = current.findIndex((row) => String(row?.id || '') === String(optimisticId));
      if (idx >= 0) current[idx] = { ...current[idx], ...optimistic };
      else current.push(optimistic);
      queryClient.setQueryData(key, current);
      return { key, prev };
    },
    onError: (_error, _payload, ctx) => {
      if (ctx?.key) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSuccess: (_savedEntry, payload) => {
      const targetOrderId = String(payload?.order_id || orderId || '');
      if (targetOrderId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(targetOrderId) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', targetOrderId] });
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      syncOfflineFinanceOutbox(queryClient, targetOrderId).catch(() => {});
    },
  });
}

export function useDeleteOrderFinanceEntryMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const isSystemRule = payload && typeof payload === 'object' && payload.isSystem === true;
      const entryId = isSystemRule ? payload.entryId : payload;
      if (isSystemRule) {
        return excludeOrderFinanceRule({
          orderId: payload.orderId || orderId,
          ruleId: payload.ruleId,
        });
      }
      if (shouldAttemptOnlineWrite()) {
        try {
          return await deleteOrderFinanceEntry(entryId);
        } catch (error) {
          if (!isOfflineLikeError(error)) throw error;
        }
      }
      const owner = await getActiveOfflineOwner();
      if (!owner) throw new Error('Authenticated session is required for offline finance changes');
      const item = {
        id: `finance:delete:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        operation: 'delete',
        order_id: String(orderId || ''),
        entry_id: String(entryId || ''),
        created_at: nowIso(),
        status: 'pending',
        attempts: 0,
        ownerUserId: owner.userId,
        ownerCompanyId: owner.companyId,
      };
      await mutateFinanceOutbox((items) => ({ items: [...items, item] }));
      return true;
    },
    onMutate: async (payload) => {
      const entryId = payload && typeof payload === 'object' ? payload.entryId : payload;
      const key = financeQueryKeys.orderEntries(orderId);
      const prev = queryClient.getQueryData(key);
      const current = Array.isArray(prev) ? prev : [];
      queryClient.setQueryData(
        key,
        current.filter((row) => String(row?.id || '') !== String(entryId || '')),
      );
      return { key, prev };
    },
    onError: (_error, _entryId, ctx) => {
      if (ctx?.key) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSuccess: () => {
      if (orderId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(orderId) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', String(orderId)] });
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      syncOfflineFinanceOutbox(queryClient, orderId).catch(() => {});
    },
  });
}

export function useCompanyFinanceRules(companyId, options = {}) {
  return useQuery({
    queryKey: financeQueryKeys.companyRules(companyId),
    queryFn: () => listCompanyFinanceRules(companyId),
    enabled: !!companyId,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useUpsertCompanyFinanceRuleMutation(companyId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertCompanyFinanceRule,
    onSuccess: () => {
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.companyRules(companyId) });
      }
    },
  });
}

export function useDeleteCompanyFinanceRuleMutation(companyId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCompanyFinanceRule,
    onSuccess: () => {
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.companyRules(companyId) });
      }
    },
  });
}
