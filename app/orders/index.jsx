/* global console, __DEV__ */

// app/orders/index.jsx
import React from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '../../components/hooks/useAuth';
import UniversalHome from '../../components/UniversalHome';
import appReadyState from '../../lib/appReadyState';
import { useTheme } from '../../theme/ThemeProvider';

const VERBOSE_ORDERS_BOOT_LOGS =
  __DEV__ && globalThis?.__VERBOSE_ORDERS_BOOT_LOGS__ === true;
const BOOT_FALLBACK_TIMEOUT_MS = 12000;

export default function IndexScreen() {
  const { theme } = useTheme();
  const { user: authUser, profile: authProfile } = useAuth();
  const [homeReady, setHomeReady] = React.useState(false);
  const role = authProfile?.role || 'worker';

  const [bootState, setBootState] = React.useState(() => appReadyState.getBootState());

  React.useEffect(() => {
    const unsubscribe = appReadyState.subscribe((newState) => {
      setBootState(newState);
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    setHomeReady(false);
  }, [authUser?.id]);

  React.useEffect(() => {
    if (!authUser?.id) {
      if (appReadyState.getBootState() !== 'boot') {
        appReadyState.reset();
      }
      return;
    }

    if (appReadyState.getBootState() === 'boot') {
      appReadyState.setBootState('fetching');
    }

    const fallbackTimer = setTimeout(() => {
      if (appReadyState.getBootState() !== 'ready') {
        appReadyState.setBootState('ready');
      }
    }, BOOT_FALLBACK_TIMEOUT_MS);

    return () => clearTimeout(fallbackTimer);
  }, [authUser?.id]);

  React.useEffect(() => {
    if (!VERBOSE_ORDERS_BOOT_LOGS) return;
    if (bootState !== 'ready') {
      console.debug('[Orders] Spinner visible:', {
        bootState,
        authUserId: authUser?.id || null,
        profileRole: authProfile?.role || null,
        homeReady,
        elapsed: Date.now() - appReadyState.getMountTs(),
      });
    } else if (bootState === 'ready') {
      console.debug('[Orders] Spinner hidden, showing content');
    }
  }, [authProfile?.role, authUser?.id, bootState, homeReady]);

  React.useEffect(() => {
    if (!authUser?.id) return;
    if (!homeReady) return;
    if (appReadyState.getBootState() === 'ready') return;
    requestAnimationFrame(() => {
      if (appReadyState.getBootState() !== 'ready') {
        appReadyState.setBootState('ready');
      }
    });
  }, [authUser?.id, homeReady]);

  const handleRootLayout = React.useCallback(() => {
    if (!authUser?.id) return;
    if (!homeReady) return;
    if (appReadyState.getBootState() === 'ready') return;
    appReadyState.setBootState('ready');
  }, [authUser?.id, homeReady]);

  if (!authUser?.id) {
    return <Redirect href='/(auth)/login' />;
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      onLayout={handleRootLayout}
    >
      <UniversalHome
        role={role || 'worker'}
        user={authUser}
        profile={authProfile}
        onInitialReady={() => setHomeReady(true)}
      />
    </View>
  );
}
