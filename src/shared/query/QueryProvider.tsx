import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect } from 'react';
import { configureQueryEnvironment, persistOptions, queryClient } from './queryClient';

export function QueryProvider({ children }) {
  useEffect(() => {
    configureQueryEnvironment();
  }, []);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}

export default QueryProvider;
