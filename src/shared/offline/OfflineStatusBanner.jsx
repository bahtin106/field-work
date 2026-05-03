import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { withAlpha } from '../../../theme/colors';
import { useOfflineSync } from './useOfflineSync';

export default function OfflineStatusBanner({ enabled = true }) {
  const { theme } = useTheme();
  const { isOnline, isPoorConnection, isSyncing, outbox } = useOfflineSync({ enabled });

  const pending = Number(outbox?.pending || 0);
  const conflicts = Number(outbox?.conflicts || 0);
  const failed = Number(outbox?.failed || 0);

  if (isOnline && !isPoorConnection && pending === 0 && conflicts === 0 && failed === 0 && !isSyncing) {
    return null;
  }

  const tone = conflicts > 0 || failed > 0 ? 'danger' : isOnline ? 'warning' : 'primary';
  const accent = tone === 'danger'
    ? theme.colors.danger
    : tone === 'warning'
      ? theme.colors.warning || theme.colors.primary
      : theme.colors.primary;

  const parts = [];
  if (!isOnline) parts.push('Нет интернета. Показываем сохраненные данные.');
  else if (isPoorConnection) parts.push('Слабое соединение. Данные могут обновляться медленнее.');
  else if (isSyncing) parts.push('Синхронизируем офлайн-правки.');
  if (pending > 0) parts.push(`В очереди: ${pending}.`);
  if (conflicts > 0) parts.push(`Конфликты версий: ${conflicts}.`);
  if (failed > 0) parts.push(`Ошибки синхронизации: ${failed}.`);

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
