import Feather from '@expo/vector-icons/Feather';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/modals';
import { useToast } from '../../components/ui/ToastProvider';
import { LEGAL_LINKS } from '../../config/externalUrls';
import { supabase } from '../../lib/supabase';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { useTranslation } from '../../src/i18n/useTranslation';
import { withAlpha } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeProvider';

const OPEN_REQUEST_STATUSES = ['pending', 'processing'];

async function findOpenDeletionRequest(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return null;
  const { data, error } = await supabase
    .from('account_deletion_requests')
    .select('id, requested_at, status')
    .eq('user_id', normalizedUserId)
    .in('status', OPEN_REQUEST_STATUSES)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  try {
    return date.toLocaleString();
  } catch {
    return date.toISOString();
  }
}

export default function AccountDeletionScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, profile } = useAuthContext();
  const userId = String(user?.id || profile?.id || '').trim();
  const queryKey = React.useMemo(() => ['accountDeletionRequest', userId], [userId]);
  const [confirmVisible, setConfirmVisible] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState('');

  const requestQuery = useQuery({
    queryKey,
    queryFn: () => findOpenDeletionRequest(userId),
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
    retry: 1,
  });

  const openDetails = React.useCallback(async () => {
    try {
      await Linking.openURL(LEGAL_LINKS.dataDeletion);
    } catch {
      toast.error(t('toast_error'));
    }
  }, [t, toast]);

  const submitRequest = React.useCallback(async () => {
    if (!userId || submitting || requestQuery.data) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const { data, error } = await supabase.rpc('request_account_deletion');
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      if (!created?.request_id) throw new Error('account_deletion_request_failed');
      const request = {
        id: created.request_id,
        requested_at: created.requested_at || new Date().toISOString(),
        status: created.request_status || 'pending',
      };
      queryClient.setQueryData(queryKey, request);
      toast.success(t('account_deletion_submitted_title'));
    } catch (error) {
      const message = String(error?.message || '').trim();
      setSubmitError(message || t('account_deletion_send_error'));
      toast.error(t('account_deletion_send_error'));
    } finally {
      setSubmitting(false);
    }
  }, [queryClient, queryKey, requestQuery.data, submitting, t, toast, userId]);

  const existingRequest = requestQuery.data;

  return (
    <Screen scroll headerOptions={{ title: t('account_deletion_title') }}>
      <View style={styles.content}>
        <Card style={styles.card}>
          <View style={styles.iconWrap}>
            <Feather name="user-x" size={28} color={theme.colors.danger} />
          </View>
          <Text style={styles.title}>{t('account_deletion_intro_title')}</Text>
          <Text style={styles.body}>{t('account_deletion_intro_body')}</Text>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('account_deletion_scope_title')}</Text>
          <Text style={styles.body}>{t('account_deletion_scope_body')}</Text>
          <Text style={styles.note}>{t('account_deletion_retention_note')}</Text>
        </Card>

        {existingRequest ? (
          <Card style={[styles.card, styles.successCard]}>
            <View style={styles.statusRow}>
              <Feather name="check-circle" size={22} color={theme.colors.success} />
              <Text style={styles.successTitle}>{t('account_deletion_submitted_title')}</Text>
            </View>
            <Text style={styles.body}>{t('account_deletion_submitted_body')}</Text>
            {formatDate(existingRequest.requested_at) ? (
              <Text style={styles.note}>{formatDate(existingRequest.requested_at)}</Text>
            ) : null}
          </Card>
        ) : null}

        {submitError ? <Text style={styles.error}>{t('account_deletion_send_error')}</Text> : null}

        <View style={styles.actions}>
          <Button
            title={t('account_deletion_request_button')}
            variant="destructive"
            loading={submitting}
            disabled={!userId || Boolean(existingRequest) || requestQuery.isLoading}
            onPress={() => setConfirmVisible(true)}
          />
          <Button
            title={t('account_deletion_details_button')}
            variant="secondary"
            disabled={submitting}
            onPress={openDetails}
          />
        </View>
      </View>

      <ConfirmModal
        visible={confirmVisible}
        title={t('account_deletion_confirm_title')}
        message={t('account_deletion_confirm_message')}
        confirmLabel={t('account_deletion_confirm_button')}
        cancelLabel={t('btn_cancel')}
        confirmVariant="destructive"
        onClose={() => setConfirmVisible(false)}
        onConfirm={submitRequest}
      />
    </Screen>
  );
}

const createStyles = (theme) => StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.components.screenLayout.contentPaddingBottom,
    gap: theme.spacing.md,
  },
  card: { gap: theme.spacing.md },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(theme.colors.danger, 0.08),
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weight.bold,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weight.bold,
  },
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.sizes.md,
    lineHeight: 22,
  },
  note: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.sizes.sm,
    lineHeight: 20,
  },
  successCard: { borderColor: theme.colors.success },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  successTitle: {
    flex: 1,
    color: theme.colors.success,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weight.bold,
  },
  actions: { gap: theme.spacing.sm },
  error: { color: theme.colors.danger, fontSize: theme.typography.sizes.sm },
});
