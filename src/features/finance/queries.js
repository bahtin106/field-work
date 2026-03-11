import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteCompanyFinanceRule,
  deleteOrderFinanceEntry,
  listCompanyFinanceRules,
  listOrderFinanceEntries,
  upsertCompanyFinanceRule,
  upsertOrderFinanceEntry,
} from './api';

export const financeQueryKeys = {
  orderEntries: (orderId) => ['finance', 'order-entries', String(orderId || '')],
  companyRules: (companyId) => ['finance', 'company-rules', String(companyId || '')],
};

export function useOrderFinanceEntries(orderId, options = {}) {
  return useQuery({
    queryKey: financeQueryKeys.orderEntries(orderId),
    queryFn: () => listOrderFinanceEntries(orderId),
    enabled: !!orderId,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useUpsertOrderFinanceEntryMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertOrderFinanceEntry,
    onSuccess: () => {
      if (orderId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(orderId) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', String(orderId)] });
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });
}

export function useDeleteOrderFinanceEntryMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteOrderFinanceEntry,
    onSuccess: () => {
      if (orderId) {
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(orderId) });
        queryClient.invalidateQueries({ queryKey: ['requests', 'detail', String(orderId)] });
      }
      queryClient.invalidateQueries({ queryKey: ['requests'] });
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
