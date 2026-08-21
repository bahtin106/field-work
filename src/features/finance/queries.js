import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canRunOutboxSync,
  getActiveOfflineOwnerContext,
  getOfflineSnapshot,
  isActiveOfflineOwnerContext,
  isOfflineItemOwnedBy,
  isOfflineLikeError,
} from '../../shared/offline/offlineStatus';
import { withReadDeadline } from '../../shared/network/readDeadline';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  assertActiveQueryCacheOwnerContext,
  captureActiveQueryCacheOwnerContext,
  isActiveQueryCacheOwnerContext,
} from '../../shared/query/queryClient';
import {
  attachMutationAuthCarrier,
  assertMutationPayloadCompany,
  clearMutationAuthCarrier,
  requireMutationAuthCarrier,
} from '../../shared/security/mutationAuthCarrier';
import {
  archiveCompanyFinanceScheme,
  deleteCompanyFinanceRule,
  deleteOrderFinanceEntry,
  excludeOrderFinanceRule,
  getOrderFinanceSchemeRule,
  getOrderFinanceSnapshot,
  listCompanyFinanceRules,
  listCompanyFinanceSchemes,
  listOrderFinanceEntries,
  setOrderFinanceSchemeDisabled,
  setCompanyFinanceSchemeEnabled,
  setOrderFinanceMoneyHolder,
  upsertCompanyFinanceRule,
  upsertCompanyFinanceScheme,
  upsertOrderFinanceEntry,
} from './api';

const FINANCE_OUTBOX_KEY = 'offline.finance.outbox.v1';
let financeOutboxMutation = Promise.resolve();
let financeSyncInFlight = null;
let financeSyncEpoch = null;
const FINANCE_MUTATION_OWNER_CONTEXT = Symbol('finance-mutation-owner-context');

export const financeQueryKeys = {
  orderEntries: (orderId) => ['finance', 'order-entries', String(orderId || '')],
  orderSnapshot: (orderId) => ['finance', 'order-snapshot', String(orderId || '')],
  orderSchemeRule: (orderId) => ['finance', 'order-scheme-rule', String(orderId || '')],
  companyRules: (companyId) => ['finance', 'company-rules', String(companyId || '')],
  companySchemes: (companyId) => ['finance', 'company-schemes', String(companyId || '')],
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
  // Unknown/EDGE links use the durable optimistic outbox immediately. This
  // keeps user writes responsive and avoids competing with foreground reads.
  return onlineManager.isOnline() && canRunOutboxSync(snapshot);
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

function requireFinanceOwnerContext() {
  const context = getActiveOfflineOwnerContext();
  if (!context) {
    throw new Error('Company-scoped session is required for offline finance changes');
  }
  return context;
}

function beginFinanceMutation(payload) {
  const ownerContext = captureActiveQueryCacheOwnerContext();
  assertActiveQueryCacheOwnerContext(ownerContext);
  if (payload && typeof payload === 'object') {
    Object.defineProperty(payload, FINANCE_MUTATION_OWNER_CONTEXT, {
      value: ownerContext,
      configurable: true,
      enumerable: false,
    });
  }
  return { ownerContext };
}

function finishFinanceMutation(payload) {
  if (payload && typeof payload === 'object') {
    clearMutationAuthCarrier(payload);
    delete payload[FINANCE_MUTATION_OWNER_CONTEXT];
  }
}

async function beginSecuredFinanceMutation(payload, { requireOfflineOwner = false } = {}) {
  const context = beginFinanceMutation(payload);
  try {
    await attachMutationAuthCarrier(payload, { requireOfflineOwner });
    return context;
  } catch (error) {
    finishFinanceMutation(payload);
    throw error;
  }
}

function assertFinanceMutationQueryOwner(payload) {
  assertActiveQueryCacheOwnerContext(payload?.[FINANCE_MUTATION_OWNER_CONTEXT]);
}

function assertFinanceOwnerContext(context) {
  if (isActiveOfflineOwnerContext(context)) return;
  const error = new Error('Offline owner changed during finance sync');
  error.code = 'OFFLINE_OWNER_CHANGED';
  throw error;
}

function isLegacyFinanceItemClaimable(item, owner, queryClient) {
  const itemUserId = String(item?.ownerUserId || '').trim();
  const itemCompanyId = String(item?.ownerCompanyId || '').trim();
  if (itemCompanyId || itemUserId !== owner.userId) return false;
  const activeProfile = queryClient.getQueryData(queryKeys.profile.me());
  if (String(activeProfile?.id || '').trim() !== owner.userId) return false;
  if (String(activeProfile?.company_id || '').trim() !== owner.companyId) return false;
  const orderId = String(item?.order_id || '').trim();
  if (!orderId) return false;
  const cachedOrder = queryClient.getQueryData(queryKeys.requests.detail(orderId));
  return String(cachedOrder?.company_id || '').trim() === owner.companyId;
}

async function claimLegacyFinanceOutbox(context, queryClient) {
  const { owner } = context;
  const snapshot = await readFinanceOutbox();
  if (!isActiveOfflineOwnerContext(context)) return;
  if (!snapshot.some((item) => isLegacyFinanceItemClaimable(item, owner, queryClient))) return;
  await mutateFinanceOutbox((items) => ({
    items: !isActiveOfflineOwnerContext(context)
      ? items
      : items.map((item) =>
          isLegacyFinanceItemClaimable(item, owner, queryClient)
            ? { ...item, ownerUserId: owner.userId, ownerCompanyId: owner.companyId }
            : item,
        ),
  }));
}

async function readFinanceOutboxForActiveOwner(queryClient) {
  const context = getActiveOfflineOwnerContext();
  if (!context) return { outbox: [], owner: null };
  await claimLegacyFinanceOutbox(context, queryClient);
  if (!isActiveOfflineOwnerContext(context)) return { outbox: [], owner: null };
  const outbox = await readFinanceOutbox();
  if (!isActiveOfflineOwnerContext(context)) return { outbox: [], owner: null };
  return { outbox, owner: context.owner };
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
  if (!canRunOutboxSync()) return;
  const ownerContext = getActiveOfflineOwnerContext();
  if (!ownerContext) return;
  const { owner } = ownerContext;
  await claimLegacyFinanceOutbox(ownerContext, queryClient);
  if (!isActiveOfflineOwnerContext(ownerContext)) return;
  const snapshot = await readFinanceOutbox();
  if (!isActiveOfflineOwnerContext(ownerContext)) return;
  const mine = snapshot.filter((item) => isOfflineItemOwnedBy(item, owner));
  for (const item of mine) {
    if (!canRunOutboxSync()) break;
    if (!isActiveOfflineOwnerContext(ownerContext)) break;
    if (!isOfflineItemOwnedBy(item, owner)) break;
    try {
      assertFinanceOwnerContext(ownerContext);
      let savedEntry = null;
      if (item.operation === 'delete') {
        const authVariables = {};
        const authCarrier = await attachMutationAuthCarrier(authVariables, {
          requireOfflineOwner: true,
        });
        try {
          await deleteOrderFinanceEntry(
            {
              entryId: item.entry_id,
              companyId: item.ownerCompanyId,
              orderId: item.order_id,
            },
            authCarrier,
          );
        } finally {
          clearMutationAuthCarrier(authVariables);
        }
      } else if (item.operation === 'upsert') {
        const authVariables = {};
        const authCarrier = await attachMutationAuthCarrier(authVariables, {
          requireOfflineOwner: true,
        });
        try {
          savedEntry = await upsertOrderFinanceEntry(item.entry, authCarrier);
        } finally {
          clearMutationAuthCarrier(authVariables);
        }
      }
      assertFinanceOwnerContext(ownerContext);
      if (item?.order_id) {
        queryClient.setQueryData(financeQueryKeys.orderEntries(item.order_id), (current) => {
          if (!Array.isArray(current)) return current;
          if (item.operation === 'delete') {
            return current.filter(
              (entry) => String(entry?.id || '') !== String(item?.entry_id || ''),
            );
          }
          const nextEntry = { ...(item.entry || {}), ...(savedEntry || {}) };
          delete nextEntry.__offlinePending;
          const index = current.findIndex(
            (entry) => String(entry?.id || '') === String(nextEntry?.id || ''),
          );
          if (index < 0) return [...current, nextEntry];
          const next = [...current];
          next[index] = { ...current[index], ...nextEntry };
          delete next[index].__offlinePending;
          return next;
        });
      }
      await mutateFinanceOutbox((items) => ({
        items: !isActiveOfflineOwnerContext(ownerContext)
          ? items
          : items.filter(
              (row) =>
                String(row?.id || '') !== String(item?.id || '') ||
                !isOfflineItemOwnedBy(row, owner),
            ),
      }));
      assertFinanceOwnerContext(ownerContext);
      if (item?.order_id) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(item.order_id) });
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderSnapshot(item.order_id) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', String(item.order_id)] });
      }
    } catch (error) {
      if (error?.code === 'OFFLINE_OWNER_CHANGED' || !isActiveOfflineOwnerContext(ownerContext)) {
        break;
      }
      if (isOfflineLikeError(error)) break;
      await mutateFinanceOutbox((items) => ({
        items: !isActiveOfflineOwnerContext(ownerContext)
          ? items
          : items.map((row) =>
              String(row?.id || '') === String(item?.id || '') && isOfflineItemOwnedBy(row, owner)
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
  const ownerContext = getActiveOfflineOwnerContext();
  if (!ownerContext) return;
  if (financeSyncInFlight && financeSyncEpoch === ownerContext.epoch) return financeSyncInFlight;
  const run = runFinanceOutboxSync(queryClient).finally(() => {
    if (financeSyncInFlight !== run) return;
    financeSyncInFlight = null;
    financeSyncEpoch = null;
  });
  financeSyncEpoch = ownerContext.epoch;
  financeSyncInFlight = run;
  return run;
}

export function useOrderFinanceEntries(orderId, options = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: financeQueryKeys.orderEntries(orderId),
    queryFn: async ({ signal }) => {
      try {
        const rows = await withReadDeadline(
          (deadlineSignal) => listOrderFinanceEntries(orderId, deadlineSignal),
          {
            label: 'Order finance entries',
            signal,
          },
        );
        const { outbox, owner } = await readFinanceOutboxForActiveOwner(queryClient);
        return mergeOutboxEntries(rows, outbox, orderId, owner);
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(financeQueryKeys.orderEntries(orderId));
        const { outbox, owner } = await readFinanceOutboxForActiveOwner(queryClient);
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

export function useOrderFinanceSnapshot(orderId, options = {}) {
  return useQuery({
    queryKey: financeQueryKeys.orderSnapshot(orderId),
    queryFn: ({ signal }) =>
      withReadDeadline(
        (deadlineSignal) => getOrderFinanceSnapshot(orderId, deadlineSignal),
        {
          label: 'Order finance snapshot',
          signal,
        },
      ),
    enabled: !!orderId,
    staleTime: 30 * 1000,
    ...options,
    placeholderData: () => undefined,
  });
}

export function useOrderFinanceSchemeRule(orderId, options = {}) {
  return useQuery({
    queryKey: financeQueryKeys.orderSchemeRule(orderId),
    queryFn: ({ signal }) =>
      withReadDeadline(
        (deadlineSignal) => getOrderFinanceSchemeRule(orderId, deadlineSignal),
        {
          label: 'Order finance rule',
          signal,
        },
      ),
    enabled: !!orderId,
    staleTime: 30 * 1000,
    ...options,
    placeholderData: () => undefined,
  });
}

export function useUpsertOrderFinanceEntryMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      assertFinanceMutationQueryOwner(payload);
      const authCarrier = requireMutationAuthCarrier(payload, { requireOfflineOwner: true });
      const stablePayload = { ...(payload || {}), id: payload?.id || makeUuid() };
      const ownerContext = requireFinanceOwnerContext();
      const { owner } = ownerContext;
      if (shouldAttemptOnlineWrite()) {
        try {
          assertFinanceOwnerContext(ownerContext);
          return await upsertOrderFinanceEntry(stablePayload, authCarrier);
        } catch (error) {
          if (!isOfflineLikeError(error)) throw error;
          assertFinanceOwnerContext(ownerContext);
        }
      }
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
      await mutateFinanceOutbox((items) => {
        assertFinanceOwnerContext(ownerContext);
        return { items: [...items, item] };
      });
      return { ...stablePayload, __offlinePending: true };
    },
    onMutate: async (payload) => {
      const { ownerContext } = await beginSecuredFinanceMutation(payload, {
        requireOfflineOwner: true,
      });
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
      return { key, prev, ownerContext };
    },
    onError: (_error, _payload, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (ctx?.key) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSuccess: (_savedEntry, payload, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      const targetOrderId = String(payload?.order_id || orderId || '');
      if (targetOrderId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(targetOrderId) });
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderSnapshot(targetOrderId) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', targetOrderId] });
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      syncOfflineFinanceOutbox(queryClient, targetOrderId).catch(() => {});
    },
    onSettled: (_data, _error, payload) => {
      finishFinanceMutation(payload);
    },
  });
}

export function useDeleteOrderFinanceEntryMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      assertFinanceMutationQueryOwner(payload);
      const authCarrier = requireMutationAuthCarrier(payload, { requireOfflineOwner: true });
      const ownerContext = requireFinanceOwnerContext();
      const { owner } = ownerContext;
      const isSystemRule = payload && typeof payload === 'object' && payload.isSystem === true;
      const entryId = payload?.entryId;
      if (isSystemRule) {
        if (!shouldAttemptOnlineWrite()) {
          throw new Error('A stable internet connection is required to exclude a finance rule');
        }
        assertFinanceOwnerContext(ownerContext);
        return excludeOrderFinanceRule({
          orderId: payload.orderId || orderId,
          ruleId: payload.ruleId,
          companyId: owner.companyId,
        }, authCarrier);
      }
      if (shouldAttemptOnlineWrite()) {
        try {
          assertFinanceOwnerContext(ownerContext);
          return await deleteOrderFinanceEntry(
            {
              entryId,
              companyId: owner.companyId,
              orderId: payload?.orderId || orderId,
            },
            authCarrier,
          );
        } catch (error) {
          if (!isOfflineLikeError(error)) throw error;
          assertFinanceOwnerContext(ownerContext);
        }
      }
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
      await mutateFinanceOutbox((items) => {
        assertFinanceOwnerContext(ownerContext);
        return { items: [...items, item] };
      });
      return true;
    },
    onMutate: async (payload) => {
      const { ownerContext } = await beginSecuredFinanceMutation(payload, {
        requireOfflineOwner: true,
      });
      const entryId = payload && typeof payload === 'object' ? payload.entryId : payload;
      const key = financeQueryKeys.orderEntries(orderId);
      const prev = queryClient.getQueryData(key);
      const current = Array.isArray(prev) ? prev : [];
      queryClient.setQueryData(
        key,
        current.filter((row) => String(row?.id || '') !== String(entryId || '')),
      );
      return { key, prev, ownerContext };
    },
    onError: (_error, _entryId, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (ctx?.key) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSuccess: (_result, _payload, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (orderId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(orderId) });
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderSnapshot(orderId) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', String(orderId)] });
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      syncOfflineFinanceOutbox(queryClient, orderId).catch(() => {});
    },
    onSettled: (_data, _error, payload) => finishFinanceMutation(payload),
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
    mutationFn: (payload) => {
      assertFinanceMutationQueryOwner(payload);
      const authCarrier = requireMutationAuthCarrier(payload);
      assertMutationPayloadCompany(authCarrier, companyId);
      assertMutationPayloadCompany(authCarrier, payload?.company_id);
      return upsertCompanyFinanceRule(payload, authCarrier);
    },
    onMutate: (payload) => beginSecuredFinanceMutation(payload),
    onSuccess: (_data, _variables, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.companyRules(companyId) });
      }
    },
    onSettled: (_data, _error, payload) => finishFinanceMutation(payload),
  });
}

export function useDeleteCompanyFinanceRuleMutation(companyId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => {
      assertFinanceMutationQueryOwner(payload);
      const authCarrier = requireMutationAuthCarrier(payload);
      assertMutationPayloadCompany(authCarrier, companyId);
      return deleteCompanyFinanceRule(
        {
          ruleId: payload?.id,
          companyId,
          deleteExistingEntries: payload?.deleteExistingEntries === true,
        },
        authCarrier,
      );
    },
    onMutate: (payload) => beginSecuredFinanceMutation(payload),
    onSuccess: (_data, _variables, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.companyRules(companyId) });
      }
    },
    onSettled: (_data, _error, payload) => finishFinanceMutation(payload),
  });
}

export function useSetOrderFinanceMoneyHolderMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => {
      assertFinanceMutationQueryOwner(payload);
      const authCarrier = requireMutationAuthCarrier(payload, { requireOfflineOwner: true });
      return setOrderFinanceMoneyHolder(payload, authCarrier);
    },
    onMutate: (payload) =>
      beginSecuredFinanceMutation(payload, { requireOfflineOwner: true }),
    onSuccess: (_data, _variables, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (orderId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderSnapshot(orderId) });
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(orderId) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', String(orderId)] });
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
    onSettled: (_data, _error, payload) => finishFinanceMutation(payload),
  });
}

export function useSetOrderFinanceSchemeDisabledMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => {
      assertFinanceMutationQueryOwner(payload);
      const authCarrier = requireMutationAuthCarrier(payload, { requireOfflineOwner: true });
      return setOrderFinanceSchemeDisabled(payload, authCarrier);
    },
    onMutate: (payload) =>
      beginSecuredFinanceMutation(payload, { requireOfflineOwner: true }),
    onSuccess: (_data, _variables, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (orderId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderSnapshot(orderId) });
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderSchemeRule(orderId) });
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(orderId) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', String(orderId)] });
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
    onSettled: (_data, _error, payload) => finishFinanceMutation(payload),
  });
}

export function useCompanyFinanceSchemes(companyId, options = {}) {
  return useQuery({
    queryKey: financeQueryKeys.companySchemes(companyId),
    queryFn: () => listCompanyFinanceSchemes(companyId),
    enabled: !!companyId,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useUpsertCompanyFinanceSchemeMutation(companyId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => {
      assertFinanceMutationQueryOwner(payload);
      const authCarrier = requireMutationAuthCarrier(payload);
      assertMutationPayloadCompany(authCarrier, companyId);
      assertMutationPayloadCompany(authCarrier, payload?.company_id);
      return upsertCompanyFinanceScheme(payload, authCarrier);
    },
    onMutate: (payload) => beginSecuredFinanceMutation(payload),
    onSuccess: (_data, _variables, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.companySchemes(companyId) });
      }
      queryClient.invalidateQueries({ queryKey: ['finance', 'order-snapshot'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
    onSettled: (_data, _error, payload) => finishFinanceMutation(payload),
  });
}

export function useArchiveCompanyFinanceSchemeMutation(companyId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => {
      assertFinanceMutationQueryOwner(payload);
      const authCarrier = requireMutationAuthCarrier(payload);
      assertMutationPayloadCompany(authCarrier, companyId);
      return archiveCompanyFinanceScheme({ ...payload, companyId }, authCarrier);
    },
    onMutate: (payload) => beginSecuredFinanceMutation(payload),
    onSuccess: (_data, _variables, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.companySchemes(companyId) });
      }
      queryClient.invalidateQueries({ queryKey: ['finance', 'order-snapshot'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
    onSettled: (_data, _error, payload) => finishFinanceMutation(payload),
  });
}

export function useSetCompanyFinanceSchemeEnabledMutation(companyId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => {
      assertFinanceMutationQueryOwner(payload);
      const authCarrier = requireMutationAuthCarrier(payload);
      assertMutationPayloadCompany(authCarrier, companyId);
      return setCompanyFinanceSchemeEnabled({ ...payload, companyId }, authCarrier);
    },
    onMutate: (payload) => beginSecuredFinanceMutation(payload),
    onSuccess: (_data, _variables, ctx) => {
      if (!isActiveQueryCacheOwnerContext(ctx?.ownerContext)) return;
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.companySchemes(companyId) });
      }
      queryClient.invalidateQueries({ queryKey: ['finance', 'order-snapshot'] });
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
    onSettled: (_data, _error, payload) => finishFinanceMutation(payload),
  });
}
