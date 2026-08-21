import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect } from 'react';
import { configureQueryEnvironment, persistOptions, persister, queryClient } from './queryClient';

const shouldPersistQueryCache = true;

// TanStack Query assumes `online` until the host tells it otherwise. Register
// React Native connectivity before any child query mounts so a cold offline or
// constrained-network start cannot launch avoidable requests first.
configureQueryEnvironment();

export function QueryProvider({ children }) {
  useEffect(() => {
    if (shouldPersistQueryCache) return;
    Promise.resolve(persister.removeClient?.()).catch(() => {});
  }, []);

  if (!shouldPersistQueryCache) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}

export default QueryProvider;
