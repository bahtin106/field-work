import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  deleteOrderCustomerPayment,
  listOrderCustomerPayments,
  upsertOrderCustomerPayment,
} from './api';

export const paymentQueryKeys = {
  order: (orderId) => ['payments', 'order', String(orderId || '')],
};

function invalidateOrderPaymentState(queryClient, orderId) {
  const normalizedOrderId = String(orderId || '');
  queryClient.invalidateQueries({ queryKey: paymentQueryKeys.order(normalizedOrderId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.requests.detail(normalizedOrderId) });
  queryClient.invalidateQueries({ queryKey: ['finance', 'order-snapshot', normalizedOrderId] });
  queryClient.invalidateQueries({ queryKey: ['finance', 'order-entries', normalizedOrderId] });
  queryClient.invalidateQueries({ queryKey: ['requests'] });
}

export function useOrderCustomerPayments(orderId, options = {}) {
  return useQuery({
    queryKey: paymentQueryKeys.order(orderId),
    queryFn: () => listOrderCustomerPayments(orderId),
    enabled: !!orderId,
    staleTime: 15 * 1000,
    placeholderData: () => undefined,
    ...options,
  });
}

export function useUpsertOrderCustomerPaymentMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertOrderCustomerPayment,
    onSuccess: (_result, payload) => {
      invalidateOrderPaymentState(queryClient, payload?.order_id || orderId);
    },
  });
}
export function useDeleteOrderCustomerPaymentMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteOrderCustomerPayment,
    onSuccess: () => {
      invalidateOrderPaymentState(queryClient, orderId);
    },
  });
}
