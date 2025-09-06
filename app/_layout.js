// app/_layout.js
import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// NOTE: paths are relative to app/
import { supabase } from '../lib/supabase';
import SettingsProvider from '../providers/SettingsProvider';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { PermissionsProvider } from '../lib/permissions';
import BottomNav from '../components/navigation/BottomNav';
import { getUserRole } from '../lib/getUserRole';
import Constants from 'expo-constants';
import { initTelemetry, installGlobalHandlers, logEvent, pingTelemetry } from '../components/feedback/telemetry';

// Держим сплэш до полной готовности
SplashScreen.preventAutoHideAsync().catch(() => {});


// === Telemetry bootstrap ===
const EXTRA = Constants.expoConfig?.extra || Constants.manifest?.extra || {};
initTelemetry({
  supabaseUrl: EXTRA.supabaseUrl,
  supabaseAnonKey: EXTRA.supabaseAnonKey,
  eventsTable: 'events',
  errorsTable: 'error_logs',
  appVersion: Constants.expoConfig?.version || Constants.manifest?.version,
  environment: __DEV__ ? 'development' : 'production',
});
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  installGlobalHandlers();
}
pingTelemetry().catch(() => {});
logEvent('self_test', { ts: Date.now(), source: '_layout' })
  .then(() => globalThis?.console?.log?.('[telemetry] self_test inserted'))
  .catch((e) => globalThis?.console?.error?.('[telemetry] self_test failed', e?.message || e));
// ===========================


function RootLayoutInner() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState(null);
  const [booted, setBooted] = useState(false);
  // Wait until Supabase client has an access token (avoid anon fetches)
  async function waitForSession({ tries = 20, delay = 100 } = {}) {
    for (let i = 0; i < tries; i++) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) return session;
      } catch {}
      await new Promise(r => setTimeout(r, delay));
    }
    return null;
  }


  
  const theme = useTheme();
useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        const logged = !!session?.user;
        if (mounted) setIsLoggedIn(logged);

        if (logged) {
          try {
            await waitForSession();
            const r = await getUserRole();
            if (mounted) setRole(r);
          } catch {
            if (mounted) setRole(null);
          }
        } else {
          if (mounted) setRole(null);
        }
      } finally {
        if (mounted) setBooted(true);
      }
    };

    boot();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_, session) => {
      const logged = !!session?.user;
      setIsLoggedIn(logged);
      if (logged && session?.user?.id) {
  try {
    await waitForSession();
    const r = await getUserRole();
    setRole(r);
  } catch {
    setRole(null);
  }
} else {
  setRole(null);
}
      setBooted(true);
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && booted && (isLoggedIn ? role : true)) {
        SplashScreen.hideAsync().catch(() => {});
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
      sub?.remove?.();
    };
  }, [booted]);

  // Скрываем сплэш только когда всё готово:
  useEffect(() => {
    const ready = booted && (isLoggedIn ? !!role : true);
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [booted, isLoggedIn, role]);

  const ready = booted && (isLoggedIn ? !!role : true);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme?.colors?.background }}>
      <PermissionsProvider>
        <SettingsProvider>
          <View style={{ flex: 1 }}>
            <Stack
              initialRouteName={isLoggedIn ? 'orders' : '(auth)'}
              screenOptions={{
                headerShown: false,
                animation: 'simple_push',
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
                animationTypeForReplace: 'push',
                gestureDirection: 'horizontal',
              }}
            >
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="orders" />
            </Stack>

            {isLoggedIn && <BottomNav />}
          </View>
        </SettingsProvider>
      </PermissionsProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}
