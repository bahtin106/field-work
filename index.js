import 'react-native-reanimated';
import 'react-native-gesture-handler';
import React from 'react';
import { registerRootComponent } from 'expo';
import Constants from 'expo-constants';

// === Telemetry & global error handlers ===
import { initTelemetry, installGlobalHandlers, logEvent, pingTelemetry } from './components/feedback/telemetry';
import ErrorBoundary from './components/feedback/ErrorBoundary';

const EXTRA = Constants.expoConfig?.extra || Constants.manifest?.extra || {};

initTelemetry({
  supabaseUrl: EXTRA.supabaseUrl,
  supabaseAnonKey: EXTRA.supabaseAnonKey,
  eventsTable: 'events',
  errorsTable: 'error_logs',
  appVersion: Constants.expoConfig?.version || Constants.manifest?.version,
  environment: __DEV__ ? 'development' : 'production',
});

installGlobalHandlers();

logEvent('app_start', { source: 'index.js' }).catch(() => {});
pingTelemetry().catch(() => {});
// =========================================

import App from './App';

function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

registerRootComponent(Root);
