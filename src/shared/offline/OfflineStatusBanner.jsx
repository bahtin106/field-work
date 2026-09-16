import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { withAlpha } from '../../../theme/colors';
import { useTranslation } from '../../i18n/useTranslation';
import {
  POOR_CONNECTION_BANNER_DELAY_MS,
  SYNCING_BANNER_DELAY_MS,
  resolveOfflineBannerPresentation,
} from './offlineBannerState.mjs';
import { useOfflineSync } from './useOfflineSync';

export default function OfflineStatusBanner({ enabled = true }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { isNetworkKnown, isOnline, isPoorConnection, isSyncing, outbox } = useOfflineSync({ enabled });
  const [poorConnectionVisible, setPoorConnectionVisible] = useState(false);
  const [syncingVisible, setSyncingVisible] = useState(false);
  const hasPendingSyncWork = Number(outbox?.pending || 0) > 0;

  useEffect(() => {
    if (!enabled || !isOnline || !isPoorConnection) {
      setPoorConnectionVisible(false);
      return undefined;
    }

    const timer = setTimeout(
      () => setPoorConnectionVisible(true),
      POOR_CONNECTION_BANNER_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [enabled, isOnline, isPoorConnection]);

  useEffect(() => {
    if (!enabled || !isOnline || !isSyncing || !hasPendingSyncWork) {
      setSyncingVisible(false);
      return undefined;
    }

    const timer = setTimeout(
      () => setSyncingVisible(true),
      SYNCING_BANNER_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [enabled, hasPendingSyncWork, isOnline, isSyncing]);

  const presentation = useMemo(
    () => resolveOfflineBannerPresentation(
      { isNetworkKnown, isOnline, isPoorConnection, isSyncing },
      outbox,
      { poorConnectionVisible, syncingVisible },
    ),
    [
      isNetworkKnown,
      isOnline,
      isPoorConnection,
      isSyncing,
      outbox,
      poorConnectionVisible,
      syncingVisible,
    ],
  );

  if (!presentation) return null;

  const { tone, pending, conflicts, failed, showPoorConnection, showSyncing } = presentation;
  const accent = tone === 'danger'
    ? theme.colors.danger
    : tone === 'warning'
      ? theme.colors.warning || theme.colors.primary
      : theme.colors.primary;

  const parts = [];
  if (!presentation.isOnline) parts.push(t('offline_banner_no_connection'));
  else if (showPoorConnection) parts.push(t('offline_banner_poor_connection'));
  else if (showSyncing) parts.push(t('offline_banner_syncing'));
  if (pending > 0) parts.push(t('offline_banner_pending').replace('{count}', String(pending)));
  if (conflicts > 0) parts.push(t('offline_banner_conflicts').replace('{count}', String(conflicts)));
  if (failed > 0) parts.push(t('offline_banner_failed').replace('{count}', String(failed)));

  return (
    <View
      pointerEvents="none"
      style={[
        styles.container,
        {
          backgroundColor: withAlpha(accent, 0.12),
          borderColor: withAlpha(accent, 0.38),
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <Text style={[styles.text, { color: theme.colors.text }]}>{parts.join(' ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
});
