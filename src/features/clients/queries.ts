import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../shared/query/queryKeys';
import { invalidateManyNow, invalidateNow } from '../../shared/query/invalidate';
import {
  createClient,
  getClientDeleteBlockers,
  deleteClient,
  getClientById,
  getClientOrderCount,
  listClients,
  updateClient,
} from './api';

export function useClients(params = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.clients.list(params),
    queryFn: () => listClients(params),
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useClient(id, options = {}) {
  return useQuery({
    queryKey: queryKeys.clients.detail(id),
    queryFn: () => getClientById(String(id || '')),
    enabled: !!id,
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useClientOrderCount(id, options = {}) {
  return useQuery({
    queryKey: queryKeys.clients.orderCount(id),
    queryFn: () => getClientOrderCount(String(id || '')),
    enabled: !!id,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useClientDeleteBlockers(id, options = {}) {
  return useQuery({
    queryKey: ['clients', 'delete-blockers', String(id || '')],
    queryFn: () => getClientDeleteBlockers(String(id || '')),
    enabled: !!id,
    staleTime: 15 * 1000,
    ...options,
  });
}

export function useClientsRealtimeSync({ enabled = true, companyId = null } = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !companyId) return;

    const channel = supabase
      .channel(`clients:realtime:${companyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'clients',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const rowId = payload?.new?.id || payload?.old?.id;
          if (rowId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(rowId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.clients.orderCount(rowId) });
            queryClient.invalidateQueries({ queryKey: ['clients', 'delete-blockers', String(rowId)] });
            queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(rowId) });
          }
          queryClient.invalidateQueries({ queryKey: ['clients'] });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'client_objects',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const clientId = payload?.new?.client_id || payload?.old?.client_id;
          if (clientId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.objects.byClient(clientId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(clientId) });
            queryClient.invalidateQueries({ queryKey: ['clients', 'delete-blockers', String(clientId)] });
          }
          queryClient.invalidateQueries({ queryKey: ['clients'] });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'client_tag_links',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const clientId = String(payload?.new?.client_id || payload?.old?.client_id || '');
          if (clientId) {
            void invalidateNow(queryClient, queryKeys.clients.detail(clientId));
          }
          void invalidateManyNow(queryClient, [['clients'], ['tags']]);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'company_tags',
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void invalidateManyNow(queryClient, [['clients'], ['objects'], ['tags']]);
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [companyId, enabled, queryClient]);
}

export function useCreateClientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Record<string, any>) => createClient(payload),
    onSuccess: (created: any) => {
      if (created?.id) {
        queryClient.setQueryData(queryKeys.clients.detail(created.id), created);
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useUpdateClientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, any> }) =>
      updateClient(id, patch),
    onSuccess: (updated: any) => {
      if (updated?.id) {
        queryClient.setQueryData(queryKeys.clients.detail(updated.id), updated);
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useDeleteClientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteClient(String(id || '')),
    onSuccess: (_result, deletedId: string) => {
      if (deletedId) {
        queryClient.removeQueries({ queryKey: queryKeys.clients.detail(deletedId) });
        queryClient.removeQueries({ queryKey: queryKeys.clients.orderCount(deletedId) });
        queryClient.removeQueries({ queryKey: ['clients', 'delete-blockers', String(deletedId)] });
        queryClient.removeQueries({ queryKey: queryKeys.objects.byClient(deletedId) });
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export async function ensureClientPrefetch(queryClient, id) {
  if (!id) return null;
  return queryClient.ensureQueryData({
    queryKey: queryKeys.clients.detail(id),
    queryFn: () => getClientById(String(id || '')),
    staleTime: 60 * 1000,
  });
}
