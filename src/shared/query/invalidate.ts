import type { QueryClient, QueryKey } from '@tanstack/react-query';

type InvalidateKey = QueryKey;

export async function invalidateNow(queryClient: QueryClient, queryKey: InvalidateKey) {
  await queryClient.invalidateQueries({
    queryKey,
    refetchType: 'all',
  });
}

export async function invalidateManyNow(queryClient: QueryClient, queryKeys: InvalidateKey[]) {
  if (!Array.isArray(queryKeys) || queryKeys.length === 0) return;
  await Promise.all(queryKeys.map((queryKey) => invalidateNow(queryClient, queryKey)));
}

