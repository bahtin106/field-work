import Feather from '@expo/vector-icons/Feather';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';

import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/modals';
import { useToast } from '../../components/ui/ToastProvider';
import { LEGAL_LINKS } from '../../config/externalUrls';
import { FUNCTIONS } from '../../lib/constants';
import { supabase } from '../../lib/supabase';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { useTranslation } from '../../src/i18n/useTranslation';
import { withAlpha } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeProvider';

const OPEN_REQUEST_STATUSES = ['pending', 'processing'];

async function findOpenDeletionRequest(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('account_deletion_requests')
    .select('id, requested_at, status')
    .eq('user_id', userId)
    .in('status', OPEN_REQUEST_STATUSES)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function invokeDeletion(body) {
  const { data, error } = await supabase.functions.invoke(FUNCTIONS.ACCOUNT_DELETION, { body });
  if (error || data?.ok !== true) {
    let errorPayload = null;
    try {
      const response = error?.context;
      if (response && typeof response.clone === 'function') errorPayload = await response.clone().json();
      else if (response && typeof response.json === 'function') errorPayload = await response.json();
    } catch {}
    const code = String(data?.code || errorPayload?.code || error?.message || 'ACCOUNT_DELETION_FAILED').trim();
    const failure = new Error(code);
    failure.code = code;
    throw failure;
  }
  return data;
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  try { return date.toLocaleString(); } catch { return date.toISOString(); }
}

export default function AccountDeletionScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, profile, signOut } = useAuthContext();
  const userId = String(user?.id || profile?.id || '').trim();
  const queryKey = React.useMemo(() => ['accountDeletionRequest', userId], [userId]);
  const [confirmVisible, setConfirmVisible] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [codeRequested, setCodeRequested] = React.useState(false);
  const [maskedEmail, setMaskedEmail] = React.useState('');
  const [busyAction, setBusyAction] = React.useState('');
  const [cooldown, setCooldown] = React.useState(0);
  const [errorCode, setErrorCode] = React.useState('');
  const confirmedDeletionRef = React.useRef(false);

  const requestQuery = useQuery({
    queryKey,
    queryFn: () => findOpenDeletionRequest(userId),
    enabled: Boolean(userId),
    staleTime: 15 * 1000,
    refetchInterval: (query) => query.state.data?.status === 'processing' ? 10 * 1000 : false,
    retry: 1,
  });

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  React.useEffect(() => {
    if (requestQuery.data?.status === 'processing') {
      confirmedDeletionRef.current = true;
      return;
    }
    if (!confirmedDeletionRef.current || !requestQuery.isSuccess || requestQuery.data) return;
    confirmedDeletionRef.current = false;
    void signOut();
  }, [requestQuery.data, requestQuery.isSuccess, signOut]);

  const openDetails = React.useCallback(async () => {
    try { await Linking.openURL(LEGAL_LINKS.dataDeletion); } catch { toast.error(t('toast_error')); }
  }, [t, toast]);

  const requestCode = React.useCallback(async () => {
    if (!userId || busyAction) return;
    setBusyAction('request');
    setErrorCode('');
    try {
      const result = await invokeDeletion({ action: 'request_code' });
      setMaskedEmail(String(result?.email_masked || ''));
      setCooldown(Math.max(1, Number(result?.cooldown_seconds) || 60));
      setCodeRequested(true);
      setCode('');
      if (result?.request_id) {
        queryClient.setQueryData(queryKey, {
          id: result.request_id,
          status: result.status || 'pending',
          requested_at: new Date().toISOString(),
        });
      }
      toast.success(t('account_deletion_code_sent'));
    } catch (error) {
      const nextCode = String(error?.code || error?.message || 'SEND_FAILED').toUpperCase();
      setErrorCode(nextCode);
      toast.error(t(nextCode === 'RATE_LIMITED' ? 'account_deletion_rate_limited' : 'account_deletion_send_error'));
    } finally {
      setBusyAction('');
      setConfirmVisible(false);
    }
  }, [busyAction, queryClient, queryKey, t, toast, userId]);

  const confirmDeletion = React.useCallback(async () => {
    if (busyAction || !/^\d{6}$/.test(code)) return;
    setBusyAction('confirm');
    setErrorCode('');
    try {
      const result = await invokeDeletion({ action: 'confirm', code });
      queryClient.setQueryData(queryKey, {
        id: result.request_id,
        status: result.status || 'processing',
        requested_at: new Date().toISOString(),
      });
      setCodeRequested(false);
      setCode('');
      toast.success(t('account_deletion_verified_title'));
    } catch (error) {
      const nextCode = String(error?.code || error?.message || 'VERIFY_FAILED').toUpperCase();
      setErrorCode(nextCode);
      const messageKey = nextCode === 'CODE_EXPIRED'
        ? 'account_deletion_code_expired'
        : nextCode === 'RATE_LIMITED' || nextCode === 'TOO_MANY_ATTEMPTS'
          ? 'account_deletion_rate_limited'
          : 'account_deletion_code_invalid';
      toast.error(t(messageKey));
    } finally {
      setBusyAction('');
    }
  }, [busyAction, code, queryClient, queryKey, t, toast]);

  const existingRequest = requestQuery.data;
  const processing = existingRequest?.status === 'processing';
  const errorMessageKey = errorCode === 'CODE_EXPIRED'
    ? 'account_deletion_code_expired'
    : errorCode === 'RATE_LIMITED' || errorCode === 'TOO_MANY_ATTEMPTS'
      ? 'account_deletion_rate_limited'
      : errorCode ? 'account_deletion_code_invalid' : '';

  return (
    <Screen scroll headerOptions={{ title: t('account_deletion_title') }}>
      <View style={styles.content}>
        <Card style={styles.card}>
          <View style={styles.iconWrap}><Feather name="user-x" size={28} color={theme.colors.danger} /></View>
          <Text style={styles.title}>{t('account_deletion_intro_title')}</Text>
          <Text style={styles.body}>{t('account_deletion_intro_body')}</Text>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('account_deletion_scope_title')}</Text>
          <Text style={styles.body}>{t('account_deletion_scope_body')}</Text>
          <Text style={styles.note}>{t('account_deletion_retention_note')}</Text>
        </Card>

        {existingRequest ? (
          <Card style={[styles.card, processing ? styles.processingCard : styles.warningCard]}>
            <View style={styles.statusRow}>
              <Feather name={processing ? 'clock' : 'alert-circle'} size={22} color={processing ? theme.colors.primary : theme.colors.warning} />
              <Text style={[styles.statusTitle, { color: processing ? theme.colors.primary : theme.colors.warning }]}>
                {t(processing ? 'account_deletion_verified_title' : 'account_deletion_pending_confirmation_title')}
              </Text>
            </View>
            <Text style={styles.body}>{t(processing ? 'account_deletion_processing_body' : 'account_deletion_pending_confirmation_body')}</Text>
            {formatDate(existingRequest.requested_at) ? <Text style={styles.note}>{formatDate(existingRequest.requested_at)}</Text> : null}
          </Card>
        ) : null}

        {codeRequested && !processing ? (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('account_deletion_code_title')}</Text>
            <Text style={styles.body}>{t('account_deletion_code_body').replace('{email}', maskedEmail || String(user?.email || ''))}</Text>
            <TextInput
              value={code}
              onChangeText={(value) => { setCode(String(value || '').replace(/\D/g, '').slice(0, 6)); if (errorCode) setErrorCode(''); }}
              style={styles.codeInput}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={theme.colors.textSecondary}
              editable={!busyAction}
              autoFocus
              accessibilityLabel={t('account_deletion_code_label')}
            />
            {errorMessageKey ? <Text style={styles.error}>{t(errorMessageKey)}</Text> : null}
            <Button title={t('account_deletion_confirm_delete_button')} variant="destructive" loading={busyAction === 'confirm'} disabled={Boolean(busyAction) || code.length !== 6} onPress={confirmDeletion} />
            <Button
              title={cooldown > 0 ? t('account_deletion_resend_in').replace('{seconds}', String(cooldown)) : t('account_deletion_resend_button')}
              variant="secondary"
              loading={busyAction === 'request'}
              disabled={Boolean(busyAction) || cooldown > 0}
              onPress={requestCode}
            />
          </Card>
        ) : null}

        <View style={styles.actions}>
          {!existingRequest && !codeRequested ? (
            <Button title={t('account_deletion_request_button')} variant="destructive" loading={busyAction === 'request'} disabled={!userId || Boolean(busyAction) || requestQuery.isLoading} onPress={() => setConfirmVisible(true)} />
          ) : null}
          {existingRequest?.status === 'pending' && !codeRequested ? (
            <>
              <Button title={t('account_deletion_enter_code_button')} variant="destructive" disabled={Boolean(busyAction)} onPress={() => { setMaskedEmail(''); setCodeRequested(true); }} />
              <Button title={t('account_deletion_resend_button')} variant="secondary" loading={busyAction === 'request'} disabled={Boolean(busyAction)} onPress={requestCode} />
            </>
          ) : null}
          <Button title={t('account_deletion_details_button')} variant="secondary" disabled={Boolean(busyAction)} onPress={openDetails} />
        </View>
      </View>

      <ConfirmModal
        visible={confirmVisible}
        title={t('account_deletion_confirm_title')}
        message={t('account_deletion_confirm_message')}
        confirmLabel={t('account_deletion_send_code_button')}
        cancelLabel={t('btn_cancel')}
        confirmVariant="destructive"
        onClose={() => setConfirmVisible(false)}
        onConfirm={requestCode}
      />
    </Screen>
  );
}

const createStyles = (theme) => StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.components.screenLayout.contentPaddingBottom, gap: theme.spacing.md },
  card: { gap: theme.spacing.md },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(theme.colors.danger, 0.08) },
  title: { color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weight.bold },
  sectionTitle: { color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weight.bold },
  body: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.md, lineHeight: 22 },
  note: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, lineHeight: 20 },
  processingCard: { borderColor: theme.colors.primary },
  warningCard: { borderColor: theme.colors.warning },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  statusTitle: { flex: 1, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.bold },
  codeInput: { minHeight: 58, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 28, fontWeight: theme.typography.weight.bold, letterSpacing: 8, textAlign: 'center', paddingHorizontal: theme.spacing.md },
  actions: { gap: theme.spacing.sm },
  error: { color: theme.colors.danger, fontSize: theme.typography.sizes.sm },
});
