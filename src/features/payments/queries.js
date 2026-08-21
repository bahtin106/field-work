import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../shared/query/queryKeys';
import {
  attachMutationAuthCarrier,
  clearMutationAuthCarrier,
  getMutationAuthCarrier,
  isActiveMutationAuthCarrier,
  requireMutationAuthCarrier,
} from '../../shared/security/mutationAuthCarrier';
import { withReadDeadline } from '../../shared/network/readDeadline';
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
    queryFn: ({ signal }) =>
      withReadDeadline(
        (deadlineSignal) => listOrderCustomerPayments(orderId, deadlineSignal),
        {
          label: 'Order payments',
          signal,
        },
      ),
    enabled: !!orderId,
    staleTime: 15 * 1000,
    placeholderData: () => undefined,
    ...options,
  });
}

export function useUpsertOrderCustomerPaymentMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => {
      const authCarrier = requireMutationAuthCarrier(payload);
      return upsertOrderCustomerPayment(payload, authCarrier);
    },
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables);
    },
    onSuccess: (_result, payload) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(payload))) return;
      invalidateOrderPaymentState(queryClient, payload?.order_id || orderId);
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
}
export function useDeleteOrderCustomerPaymentMutation(orderId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => {
      const authCarrier = requireMutationAuthCarrier(variables);
      return deleteOrderCustomerPayment(variables?.paymentId, authCarrier);
    },
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables);
    },
    onSuccess: (_result, variables) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables))) return;
      invalidateOrderPaymentState(queryClient, orderId);
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
}
