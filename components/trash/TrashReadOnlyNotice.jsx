import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePermissions } from '../../lib/permissions';
import {
  purgeTrashItem,
  restoreTrashItem,
} from '../../src/features/trash/api';
import {
  attachMutationAuthCarrier,
  clearMutationAuthCarrier,
  getMutationAuthCarrier,
  isActiveMutationAuthCarrier,
  requireMutationAuthCarrier,
} from '../../src/shared/security/mutationAuthCarrier';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';
import { ConfirmModal } from '../ui/modals';
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

export default function TrashReadOnlyNotice({ item, compact = false, itemTitle }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useTranslation();
  const { has } = usePermissions();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState(null);
  const title = String(itemTitle || item?.title || '').trim();
  const id = String(item?.id || '').trim();
  const bannerTitle = t(`trash_deleted_${item?.entity_type}_banner`, t('trash_deleted_banner'));

  const invalidate = async () => {
    await Promise.all(['trash', 'requests', 'clients', 'objects'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  const restoreMutation = useMutation({
    mutationFn: (variables) => restoreTrashItem(
      variables.id,
      requireMutationAuthCarrier(variables, { requireOfflineOwner: true }),
    ),
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables, { requireOfflineOwner: true });
    },
    onSuccess: async (result, variables) => {
      const authCarrier = getMutationAuthCarrier(variables);
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      await invalidate();
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      toast.success(t(result?.queued ? 'trash_restore_queued' : 'trash_restored'));
      router.back();
    },
    onError: (_error, variables) => {
      if (isActiveMutationAuthCarrier(getMutationAuthCarrier(variables), { requireOfflineOwner: true })) {
        toast.error(t('trash_action_error'));
      }
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });
  const purgeMutation = useMutation({
    mutationFn: (variables) => purgeTrashItem(
      variables.id,
      requireMutationAuthCarrier(variables, { requireOfflineOwner: true }),
    ),
    onMutate: async (variables) => {
      await attachMutationAuthCarrier(variables, { requireOfflineOwner: true });
    },
    onSuccess: async (_result, variables) => {
      const authCarrier = getMutationAuthCarrier(variables);
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      await invalidate();
      if (!isActiveMutationAuthCarrier(authCarrier, { requireOfflineOwner: true })) return;
      toast.success(t('trash_purged'));
      router.back();
    },
    onError: (error, variables) => {
      if (!isActiveMutationAuthCarrier(getMutationAuthCarrier(variables), { requireOfflineOwner: true })) return;
      toast.error(t(String(error?.message || '') === 'TRASH_PURGE_REQUIRES_ONLINE' ? 'trash_purge_online_only' : 'trash_action_error'));
    },
    onSettled: (_data, _error, variables) => clearMutationAuthCarrier(variables),
  });

  const confirmRestore = () => setConfirmation('restore');
  const confirmPurge = () => setConfirmation('purge');

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
      <ConfirmModal
        visible={confirmation === 'restore'}
        title={t('trash_restore_title')}
        message={formatMessage(t, 'trash_restore_message', { title })}
        confirmLabel={t('trash_restore')}
        cancelLabel={t('common_cancel')}
        loading={restoreMutation.isPending}
        onClose={() => setConfirmation(null)}
        onConfirm={() => restoreMutation.mutate({ id })}
      />
      <ConfirmModal
        visible={confirmation === 'purge'}
        title={t('trash_purge_title')}
        message={formatMessage(t, 'trash_purge_message', { title })}
        confirmLabel={t('trash_purge')}
        cancelLabel={t('common_cancel')}
        confirmVariant="destructive"
        loading={purgeMutation.isPending}
        onClose={() => setConfirmation(null)}
        onConfirm={() => purgeMutation.mutate({ id })}
      />
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
