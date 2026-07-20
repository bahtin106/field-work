import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePermissions } from '../../lib/permissions';
import { purgeTrashItem, restoreTrashItem } from '../../src/features/trash/api';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';
import { useToast } from '../ui/ToastProvider';

const formatMessage = (t, key, values = {}) => {
  let message = String(t(key, key));
  Object.entries(values).forEach(([name, value]) => {
    message = message.split(`{${name}}`).join(String(value ?? ''));
  });
  return message;
};

function timeLeft(value, t) {
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return t('trash_due_now');
  const days = Math.floor(ms / 86400000);
  return days > 0
    ? formatMessage(t, 'trash_days_left', { count: days })
    : formatMessage(t, 'trash_hours_left', { count: Math.max(1, Math.ceil(ms / 3600000)) });
}

export default function TrashReadOnlyNotice({ item, compact = false }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useTranslation();
  const { has } = usePermissions();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const title = String(item?.title || '').trim();
  const id = String(item?.id || '').trim();
  const bannerTitle = t(`trash_deleted_${item?.entity_type}_banner`, t('trash_deleted_banner'));

  const invalidate = async () => {
    await Promise.all(['trash', 'requests', 'clients', 'objects'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  const restoreMutation = useMutation({
    mutationFn: restoreTrashItem,
    onSuccess: async (result) => {
      await invalidate();
      toast.success(t(result?.queued ? 'trash_restore_queued' : 'trash_restored'));
      router.back();
    },
    onError: () => toast.error(t('trash_action_error')),
  });
  const purgeMutation = useMutation({
    mutationFn: purgeTrashItem,
    onSuccess: async () => {
      await invalidate();
      toast.success(t('trash_purged'));
      router.back();
    },
    onError: (error) => toast.error(t(String(error?.message || '') === 'TRASH_PURGE_REQUIRES_ONLINE' ? 'trash_purge_online_only' : 'trash_action_error')),
  });

  const confirmRestore = () => Alert.alert(
    t('trash_restore_title'),
    formatMessage(t, 'trash_restore_message', { title }),
    [
      { text: t('common_cancel'), style: 'cancel' },
      { text: t('trash_restore'), onPress: () => restoreMutation.mutate(id) },
    ],
  );
  const confirmPurge = () => Alert.alert(
    t('trash_purge_title'),
    formatMessage(t, 'trash_purge_message', { title }),
    [
      { text: t('common_cancel'), style: 'cancel' },
      { text: t('trash_purge'), style: 'destructive', onPress: () => purgeMutation.mutate(id) },
    ],
  );

  if (!item) return null;
  const busy = restoreMutation.isPending || purgeMutation.isPending;
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={styles.banner}>
        <Feather name="trash-2" size={28} color={theme.colors.danger} />
        <View style={styles.grow}>
          <Text style={styles.title}>{bannerTitle}</Text>
          <Text style={styles.readOnly}>{t('trash_read_only')}</Text>
          <Text style={styles.countdown}>{timeLeft(item.purge_at, t)}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {has('canRestoreTrash') ? (
          <Pressable disabled={busy} onPress={confirmRestore} style={styles.restoreButton}>
            {restoreMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="rotate-ccw" size={17} color="#fff" />}
            <Text style={styles.buttonText}>{t('trash_restore')}</Text>
          </Pressable>
        ) : null}
        {has('canPurgeTrash') ? (
          <Pressable disabled={busy} onPress={confirmPurge} style={styles.purgeButton}>
            {purgeMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="trash-2" size={17} color="#fff" />}
            <Text style={styles.buttonText}>{t('trash_purge')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  wrap: { marginBottom: theme.spacing.md },
  wrapCompact: { marginHorizontal: 0 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.danger, backgroundColor: theme.colors.card },
  grow: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.danger, fontSize: 18, fontWeight: '800' },
  readOnly: { color: theme.colors.textSecondary, marginTop: 2 },
  countdown: { color: theme.colors.danger, fontWeight: '700', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 9 },
  restoreButton: { flex: 1, minHeight: 42, borderRadius: 12, backgroundColor: theme.colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  purgeButton: { flex: 1, minHeight: 42, borderRadius: 12, backgroundColor: theme.colors.danger, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center', flexShrink: 1 },
});
