import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import React from 'react';
import {
  Appearance,
  DevSettings,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { logClientError } from '../../lib/errorLogsClient';
import { t } from '../../src/i18n';

const OTA_RECOVERY_WINDOW_MS = 10_000;
const APP_BOOT_STARTED_AT = Date.now();

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, reloading: false };
    this.reload = this.reload.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    SplashScreen.hideAsync().catch(() => {});
    logClientError(error, {
      source: 'root_error_boundary',
      componentStack: info?.componentStack,
    });

    const shouldDelegateToOtaRecovery =
      !__DEV__ &&
      Platform.OS !== 'web' &&
      Updates.isEmbeddedLaunch === false &&
      Date.now() - APP_BOOT_STARTED_AT <= OTA_RECOVERY_WINDOW_MS;

    if (shouldDelegateToOtaRecovery) {
      // expo-updates can automatically roll back a broken downloaded update
      // only when the startup error reaches React Native's fatal-error handler.
      throw error;
    }
  }

  async reload() {
    if (this.state.reloading) return;
    this.setState({ reloading: true });
    try {
      if (Platform.OS === 'web') {
        globalThis.location?.reload?.();
        return;
      }
      await Updates.reloadAsync();
    } catch {
      try {
        DevSettings.reload();
      } catch {
        // A state reset remounts the child tree when native reload is
        // unavailable (for example, in a constrained release environment).
      }
      this.setState({ hasError: false, reloading: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const dark = Appearance.getColorScheme() === 'dark';
    const palette = dark
      ? { background: '#111827', text: '#F9FAFB', muted: '#D1D5DB', button: '#0A84FF' }
      : { background: '#F2F2F7', text: '#111827', muted: '#4B5563', button: '#007AFF' };

    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          {t('error_boundary_title')}
        </Text>
        <Text style={[styles.message, { color: palette.muted }]}>
          {t('error_boundary_message')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: this.state.reloading }}
          disabled={this.state.reloading}
          onPress={this.reload}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: palette.button },
            pressed && styles.buttonPressed,
            this.state.reloading && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonText}>{t('error_boundary_reload')}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  message: { marginTop: 12, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  button: {
    minHeight: 48,
    minWidth: 180,
    marginTop: 24,
    borderRadius: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.84 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
