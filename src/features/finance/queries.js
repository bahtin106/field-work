import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getOfflineSnapshot, isOfflineLikeError } from '../../shared/offline/offlineStatus';
import {
  deleteCompanyFinanceRule,
  deleteOrderFinanceEntry,
  listCompanyFinanceRules,
  listOrderFinanceEntries,
  upsertCompanyFinanceRule,
  upsertOrderFinanceEntry,
} from './api';

const FINANCE_OUTBOX_KEY = 'offline.finance.outbox.v1';

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

async function readFinanceOutbox() {
  try {
    const raw = await AsyncStorage.getItem(FINANCE_OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFinanceOutbox(items) {
  await AsyncStorage.setItem(FINANCE_OUTBOX_KEY, JSON.stringify(Array.isArray(items) ? items : []));
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

function mergeOutboxEntries(baseEntries, outbox, orderId) {
  let next = Array.isArray(baseEntries) ? [...baseEntries] : [];
  const mine = (outbox || []).filter((item) => String(item?.order_id || '') === String(orderId || ''));
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

export async function syncOfflineFinanceOutbox(queryClient, orderId = null) {
  if (!getOfflineSnapshot().isOnline) return;
  let outbox = await readFinanceOutbox();
  if (!outbox.length) return;
  for (const item of [...outbox]) {
    if (!getOfflineSnapshot().isOnline) break;
    if (orderId && String(item?.order_id || '') !== String(orderId || '')) continue;
    try {
      if (item.operation === 'delete') {
        await deleteOrderFinanceEntry(item.entry_id);
      } else if (item.operation === 'upsert') {
        await upsertOrderFinanceEntry(item.entry);
      }
      outbox = (await readFinanceOutbox()).filter((row) => String(row?.id || '') !== String(item?.id || ''));
      await writeFinanceOutbox(outbox);
      if (item?.order_id) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(item.order_id) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', String(item.order_id)] });
      }
    } catch (error) {
      if (isOfflineLikeError(error)) break;
    }
  }
}

export function useOrderFinanceEntries(orderId, options = {}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: financeQueryKeys.orderEntries(orderId),
    queryFn: async () => {
      try {
        const rows = await listOrderFinanceEntries(orderId);
        const outbox = await readFinanceOutbox();
        return mergeOutboxEntries(rows, outbox, orderId);
      } catch (error) {
        if (!isOfflineLikeError(error)) throw error;
        const cached = queryClient.getQueryData(financeQueryKeys.orderEntries(orderId));
        const outbox = await readFinanceOutbox();
        return mergeOutboxEntries(Array.isArray(cached) ? cached : [], outbox, orderId);
      }
    },
    enabled: !!orderId,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useUpsertOrderFinanceEntryMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const online = onlineManager.isOnline() && getOfflineSnapshot().isOnline;
      if (online) {
        try {
          return await upsertOrderFinanceEntry(payload);
        } catch (error) {
          if (!isOfflineLikeError(error)) throw error;
        }
      }
      const item = {
        id: `finance:upsert:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        operation: 'upsert',
        order_id: String(payload?.order_id || orderId || ''),
        entry: payload,
        created_at: nowIso(),
      };
      const outbox = await readFinanceOutbox();
      outbox.push(item);
      await writeFinanceOutbox(outbox);
      return { ...(payload || {}), id: payload?.id || `offline:${Date.now()}`, __offlinePending: true };
    },
    onMutate: async (payload) => {
      const targetOrderId = String(payload?.order_id || orderId || '');
      const key = financeQueryKeys.orderEntries(targetOrderId);
      const prev = queryClient.getQueryData(key);
      const orderDetail = queryClient.getQueryData(['requests', 'detail', targetOrderId]);
      const startPrice = Number(orderDetail?.start_price ?? 0) || 0;
      const current = Array.isArray(prev) ? [...prev] : [];
      const optimisticId = payload?.id || `offline:${Date.now()}`;
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

export function useDeleteOrderFinanceEntryMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entryId) => {
      const online = onlineManager.isOnline() && getOfflineSnapshot().isOnline;
      if (online) {
        try {
          return await deleteOrderFinanceEntry(entryId);
        } catch (error) {
          if (!isOfflineLikeError(error)) throw error;
        }
      }
      const item = {
        id: `finance:delete:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        operation: 'delete',
        order_id: String(orderId || ''),
        entry_id: String(entryId || ''),
        created_at: nowIso(),
      };
      const outbox = await readFinanceOutbox();
      outbox.push(item);
      await writeFinanceOutbox(outbox);
      return true;
    },
    onMutate: async (entryId) => {
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
