import Constants from 'expo-constants';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect } from 'react';
import { configureQueryEnvironment, persistOptions, persister, queryClient } from './queryClient';

const isDevRuntime = typeof __DEV__ !== 'undefined' && __DEV__;
const isExpoGo = Constants?.appOwnership === 'expo';
const shouldPersistQueryCache = !isDevRuntime && !isExpoGo;

export function QueryProvider({ children }) {
  useEffect(() => {
    configureQueryEnvironment();
  }, []);

  useEffect(() => {
    if (shouldPersistQueryCache) return;
    persister.removeClient?.().catch(() => {});
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
