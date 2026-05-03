import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect } from 'react';
import { configureQueryEnvironment, persistOptions, persister, queryClient } from './queryClient';
import { scheduleSmartPrefetch } from './smartPrefetch';

const shouldPersistQueryCache = true;

export function QueryProvider({ children }) {
  useEffect(() => {
    configureQueryEnvironment();
  }, []);

  useEffect(() => {
    const cancel = scheduleSmartPrefetch(queryClient);
    return cancel;
  }, []);

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
