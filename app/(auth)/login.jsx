import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import TextField from '../../components/ui/TextField';
import { BaseModal } from '../../components/ui/modals';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuthLogin } from '../../hooks/useAuthLogin';
import { consumeAuthBlockNotice } from '../../lib/authBlockNotice';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

const PASSWORD_RESET_COOLDOWN_SECONDS = 60;
const SUPPORT_MESSAGE_MAX_LEN = 2000;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  const normalized = normalizeEmail(value);
  if (!normalized) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

const createStyles = (theme) => {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      paddingHorizontal: theme.spacing.lg,
      justifyContent: 'center',
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
    },
    content: {
      justifyContent: 'center',
      alignItems: 'stretch',
      gap: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
    },
    title: {
      textAlign: 'center',
      color: theme.colors.text,
      fontSize: theme.typography.sizes.xxl,
      fontWeight: theme.typography.weight.bold,
      marginBottom: theme.spacing.xs,
    },
    subtitle: {
      textAlign: 'center',
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginBottom: theme.spacing.xl,
    },
    fieldCard: {
      position: 'relative',
    },
    eyeButton: {
      position: 'absolute',
      right: theme.spacing.md,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      zIndex: 10,
    },
    errorText: {
      color: theme.colors.danger,
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
      marginTop: theme.spacing.xs,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    registerText: {
      textAlign: 'center',
      marginTop: theme.spacing.sm,
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textSecondary,
    },
    forgotText: {
      textAlign: 'center',
      marginTop: theme.spacing.xs,
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textSecondary,
    },
    registerLink: {
      color: theme.colors.primary,
      fontWeight: theme.typography.weight.semibold,
    },
    modalText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round((theme.typography.sizes.sm || 14) * 1.4),
    },
    modalFooter: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    modalFooterBtn: {
      flex: 1,
    },
    modalScroll: {
      maxHeight: 360,
    },
    modalContent: {
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
    },
    supportLinkText: {
      color: theme.colors.primary,
      fontWeight: theme.typography.weight.semibold,
      marginTop: theme.spacing.xs,
      textAlign: 'center',
    },
    modalCounter: {
      textAlign: 'right',
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
    },
  });
};

function LoginScreenContent() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams();
  const isFocused = useIsFocused();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const interactive = theme.components?.interactive || {
    hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
    pressRetentionOffset: { top: 16, bottom: 16, left: 16, right: 16 },
    rippleRadius: 24,
    rippleBorderless: false,
  };

  const {
    email,
    setEmail,
    password,
    setPassword,
    error,
    loading,
    canSubmit,
    handleLogin,
    reset,
    accessBlock,
    clearAccessBlock,
  } = useAuthLogin();

  // Очищаем форму при монтировании компонента
  useEffect(() => {
    reset();
  }, [reset]);

  const passwordFieldRef = useRef(null);
  const [recoverModalVisible, setRecoverModalVisible] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverSending, setRecoverSending] = useState(false);
  const [recoverFeedback, setRecoverFeedback] = useState(null);
  const [recoverSentOnce, setRecoverSentOnce] = useState(false);
  const [recoverCooldownUntil, setRecoverCooldownUntil] = useState(0);
  const [, forceCooldownTick] = useState(0);
  const [supportModalVisible, setSupportModalVisible] = useState(false);
  const [supportEmail, setSupportEmail] = useState('');
  const [supportName, setSupportName] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportSending, setSupportSending] = useState(false);
  const [supportFeedback, setSupportFeedback] = useState(null);
  const [forcedBlockedMessage, setForcedBlockedMessage] = useState('');

  const handleTogglePassword = useCallback(() => {
    passwordFieldRef.current?.togglePasswordVisibility();
  }, []);

  const handleSubmit = useCallback(async () => {
    await handleLogin();
  }, [handleLogin]);

  useEffect(() => {
    if (!accessBlock?.code) return;
    const fallbackMessage = `${t('auth_access_blocked')}. ${t('auth_blocked_subtitle')}`;
    const nextMessage = String(accessBlock.message || '').trim() || fallbackMessage;
    router.replace({
      pathname: '/(auth)/blocked',
      params: {
        code: String(accessBlock.code || 'access_blocked'),
        message: nextMessage,
        ts: String(Date.now()),
      },
    });
    clearAccessBlock?.();
  }, [accessBlock, clearAccessBlock, router, t]);

  useEffect(() => {
    const blocked = String(params?.blocked || '').trim() === '1';
    if (!blocked) return;

    const message = String(params?.message || '').trim();
    if (message) {
      setForcedBlockedMessage(message);
      return;
    }

    const code = String(params?.code || '').trim().toLowerCase();
    if (code === 'blocked_by_license') {
      setForcedBlockedMessage(t('auth_blocked_by_license'));
      return;
    }
    if (code === 'company_inactive') {
      setForcedBlockedMessage(t('auth_company_inactive'));
      return;
    }
    setForcedBlockedMessage(`${t('auth_access_blocked')}. ${t('auth_blocked_subtitle')}`);
  }, [params?.blocked, params?.code, params?.message, t]);

  useEffect(() => {
    let cancelled = false;
    const restoreNotice = async () => {
      const nextMessage = await consumeAuthBlockNotice();
      if (!nextMessage || cancelled) return;
      setForcedBlockedMessage(nextMessage);
    };
    restoreNotice();
    return () => {
      cancelled = true;
    };
  }, [isFocused]);

  const recoverCooldownLeft = Math.max(
    0,
    Math.ceil((Number(recoverCooldownUntil) - Date.now()) / 1000),
  );
  const canSendRecover = !recoverSending && recoverCooldownLeft <= 0;

  useEffect(() => {
    if (!recoverModalVisible || recoverCooldownLeft <= 0) return undefined;
    const intervalId = setInterval(() => {
      forceCooldownTick((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(intervalId);
  }, [recoverCooldownLeft, recoverModalVisible]);

  const openRecoverModal = useCallback(() => {
    const nextEmail = normalizeEmail(email);
    setRecoverEmail(nextEmail);
    setRecoverFeedback(null);
    setRecoverModalVisible(true);
  }, [email]);

  const openSupportModal = useCallback(() => {
    setSupportEmail(normalizeEmail(recoverEmail || email));
    setSupportName('');
    setSupportMessage('');
    setSupportFeedback(null);
    setSupportModalVisible(true);
  }, [email, recoverEmail]);

  const closeRecoverModal = useCallback(() => {
    if (recoverSending) return;
    setRecoverModalVisible(false);
    setRecoverFeedback(null);
  }, [recoverSending]);

  const sendRecover = useCallback(async () => {
    const normalizedEmail = normalizeEmail(recoverEmail);
    if (!isValidEmail(normalizedEmail)) {
      setRecoverFeedback({ type: 'warning', message: t('err_email') });
      return;
    }

    try {
      setRecoverSending(true);
      setRecoverFeedback(null);

      const { data, error: invokeError } = await supabase.functions.invoke('request-password-reset', {
        body: { email: normalizedEmail },
      });

      if (invokeError) throw invokeError;

      const ok = data?.ok === true;
      if (!ok) {
        const code = String(data?.code || '');
        if (code === 'USER_NOT_FOUND') {
          setRecoverFeedback({ type: 'warning', message: t('login_recover_user_not_found') });
          return;
        }
        if (code === 'RATE_LIMIT') {
          const retryAfter = Math.max(1, Number(data?.retry_after_seconds) || PASSWORD_RESET_COOLDOWN_SECONDS);
          setRecoverCooldownUntil(Date.now() + retryAfter * 1000);
          setRecoverSentOnce(true);
          setRecoverFeedback({
            type: 'warning',
            message: t('login_recover_rate_limit').replace('{n}', String(retryAfter)),
          });
          return;
        }
        throw new Error(String(data?.message || 'reset_failed'));
      }

      setRecoverSentOnce(true);
      setRecoverCooldownUntil(Date.now() + PASSWORD_RESET_COOLDOWN_SECONDS * 1000);
      setRecoverFeedback({ type: 'success', message: t('login_recover_sent_hint') });
    } catch (e) {
      const message = String(e?.message || '').trim() || t('login_recover_send_error');
      setRecoverFeedback({ type: 'error', message });
    } finally {
      setRecoverSending(false);
    }
  }, [recoverEmail, t]);

  const sendSupport = useCallback(async () => {
    const normalizedEmail = normalizeEmail(supportEmail);
    const trimmedMessage = String(supportMessage || '').trim();
    const trimmedName = String(supportName || '').trim();

    if (!isValidEmail(normalizedEmail)) {
      setSupportFeedback({ type: 'warning', message: t('err_email') });
      return;
    }
    if (!trimmedMessage) {
      setSupportFeedback({ type: 'warning', message: t('support_request_message_required') });
      return;
    }

    try {
      setSupportSending(true);
      setSupportFeedback(null);
      const { data, error: invokeError } = await supabase.functions.invoke('public-support-request', {
        body: {
          email: normalizedEmail,
          name: trimmedName || null,
          message: trimmedMessage,
        },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) {
        throw new Error(String(data?.message || t('support_request_send_error')));
      }
      setSupportModalVisible(false);
      setSupportMessage('');
      setSupportName('');
      toast.success(t('support_request_sent'));
    } catch (e) {
      const message = String(e?.message || '').trim() || t('support_request_send_error');
      setSupportFeedback({ type: 'error', message });
    } finally {
      setSupportSending(false);
    }
  }, [supportEmail, supportMessage, supportName, t, toast]);

  const recoverSendTitle = canSendRecover
    ? (recoverSentOnce ? t('login_recover_send_again') : t('btn_send'))
    : t('login_recover_send_in').replace('{n}', String(recoverCooldownLeft));

  return (
    <Screen background="background">
      <KeyboardAvoidingView
        style={styles.flex}
        enabled={Platform.OS === 'ios'}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {Platform.OS === 'web' ? (
          <View style={styles.container}>
            <View style={styles.content}>
              <Text style={styles.title}>{t('login_title')}</Text>
              <Text style={styles.subtitle}>{t('login_subtitle')}</Text>

              <Card paddedXOnly style={styles.fieldCard}>
                <TextField
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('fields_email')}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="next"
                  accessibilityLabel={t('fields_email')}
                  editable={!loading}
                  hideSeparator={true}
                  style={{ minHeight: 52 }}
                />
              </Card>

              <Card paddedXOnly style={styles.fieldCard}>
                <TextField
                  ref={passwordFieldRef}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('fields_password')}
                  secureTextEntry={true}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  textContentType="password"
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  accessibilityLabel={t('fields_password')}
                  editable={!loading}
                  hideSeparator={true}
                  style={{ minHeight: 52 }}
                />
                <Pressable
                  onPress={handleTogglePassword}
                  style={styles.eyeButton}
                  android_ripple={{
                    color: theme.colors.border,
                    borderless: interactive.rippleBorderless,
                    radius: interactive.rippleRadius,
                  }}
                  accessibilityLabel={t('auth_show_password')}
                  accessibilityRole="button"
                  hitSlop={interactive.hitSlop}
                  pressRetentionOffset={interactive.pressRetentionOffset}
                  disabled={loading}
                >
                  <Feather
                    name="eye"
                    size={theme.components.listItem.chevronSize}
                    color={theme.colors.primary}
                  />
                </Pressable>
              </Card>

              {forcedBlockedMessage ? (
                <Text style={styles.errorText}>{forcedBlockedMessage}</Text>
              ) : error ? (
                <Text style={styles.errorText}>{error}</Text>
              ) : null}

              <Button
                title={t('btn_login')}
                variant="primary"
                size="lg"
                onPress={handleSubmit}
                disabled={!canSubmit}
                loading={loading}
              />

              <Text style={styles.forgotText}>
                {t('login_forgot_password')}{' '}
                <Text
                  style={styles.registerLink}
                  onPress={() => !loading && openRecoverModal()}
                >
                  {t('login_recover_link')}
                </Text>
              </Text>

              <Text style={styles.registerText}>
                {t('login_no_account')}{' '}
                <Text
                  style={styles.registerLink}
                  onPress={() => !loading && router.push('/(auth)/register')}
                >
                  {t('register_link')}
                </Text>
              </Text>
            </View>
          </View>
        ) : (
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.container}>
              <View style={styles.content}>
                <Text style={styles.title}>{t('login_title')}</Text>
                <Text style={styles.subtitle}>{t('login_subtitle')}</Text>

                <Card paddedXOnly style={styles.fieldCard}>
                  <TextField
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t('fields_email')}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    returnKeyType="next"
                    accessibilityLabel={t('fields_email')}
                    editable={!loading}
                    hideSeparator={true}
                    style={{ minHeight: 52 }}
                  />
                </Card>

                <Card paddedXOnly style={styles.fieldCard}>
                  <TextField
                    ref={passwordFieldRef}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t('fields_password')}
                    secureTextEntry={true}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password"
                    textContentType="password"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                    accessibilityLabel={t('fields_password')}
                    editable={!loading}
                    hideSeparator={true}
                    style={{ minHeight: 52 }}
                  />
                  <Pressable
                    onPress={handleTogglePassword}
                    style={styles.eyeButton}
                    android_ripple={{
                      color: theme.colors.border,
                      borderless: interactive.rippleBorderless,
                      radius: interactive.rippleRadius,
                    }}
                    accessibilityLabel={t('auth_show_password')}
                    accessibilityRole="button"
                    hitSlop={interactive.hitSlop}
                    pressRetentionOffset={interactive.pressRetentionOffset}
                    disabled={loading}
                  >
                    <Feather
                      name="eye"
                      size={theme.components.listItem.chevronSize}
                      color={theme.colors.primary}
                    />
                  </Pressable>
                </Card>

                {forcedBlockedMessage ? (
                  <Text style={styles.errorText}>{forcedBlockedMessage}</Text>
                ) : error ? (
                  <Text style={styles.errorText}>{error}</Text>
                ) : null}

                <Button
                  title={t('btn_login')}
                  variant="primary"
                  size="lg"
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                  loading={loading}
                />

                <Text style={styles.forgotText}>
                  {t('login_forgot_password')}{' '}
                  <Text
                    style={styles.registerLink}
                    onPress={() => !loading && openRecoverModal()}
                  >
                    {t('login_recover_link')}
                  </Text>
                </Text>

                <Text style={styles.registerText}>
                  {t('login_no_account')}{' '}
                  <Text
                    style={styles.registerLink}
                    onPress={() => !loading && router.push('/(auth)/register')}
                  >
                    {t('register_link')}
                  </Text>
                </Text>
              </View>
            </View>
          </TouchableWithoutFeedback>
        )}
      </KeyboardAvoidingView>

      <BaseModal
        visible={recoverModalVisible}
        onClose={closeRecoverModal}
        title={t('login_recover_modal_title')}
        maxHeightRatio={0.64}
        feedback={recoverFeedback}
        footer={
          <View style={styles.modalFooter}>
            <View style={styles.modalFooterBtn}>
              <Button
                title={t('btn_cancel')}
                variant="secondary"
                onPress={closeRecoverModal}
                disabled={recoverSending}
              />
            </View>
            <View style={styles.modalFooterBtn}>
              <Button
                title={recoverSendTitle}
                onPress={sendRecover}
                loading={recoverSending}
                disabled={!canSendRecover}
              />
            </View>
          </View>
        }
      >
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.modalText}>{t('login_recover_modal_text')}</Text>
          <TextField
            value={recoverEmail}
            onChangeText={setRecoverEmail}
            placeholder={t('fields_email')}
            keyboardType="email-address"
            autoCapitalize="none"
            returnKeyType="done"
            editable={!recoverSending}
          />
          {recoverFeedback?.type === 'error' ? (
            <Pressable onPress={openSupportModal}>
              <Text style={styles.supportLinkText}>{t('login_recover_contact_support')}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </BaseModal>

      <BaseModal
        visible={supportModalVisible}
        onClose={() => {
          if (supportSending) return;
          setSupportModalVisible(false);
          setSupportFeedback(null);
        }}
        title={t('support_request_modal_title')}
        maxHeightRatio={0.72}
        feedback={supportFeedback}
        footer={
          <View style={styles.modalFooter}>
            <View style={styles.modalFooterBtn}>
              <Button
                title={t('btn_cancel')}
                variant="secondary"
                onPress={() => setSupportModalVisible(false)}
                disabled={supportSending}
              />
            </View>
            <View style={styles.modalFooterBtn}>
              <Button
                title={supportSending ? t('btn_sending') : t('btn_send')}
                onPress={sendSupport}
                loading={supportSending}
                disabled={supportSending}
              />
            </View>
          </View>
        }
      >
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
        >
          <TextField
            value={supportEmail}
            onChangeText={setSupportEmail}
            label={t('fields_email')}
            placeholder={t('fields_email')}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!supportSending}
          />
          <TextField
            value={supportName}
            onChangeText={setSupportName}
            label={t('view_label_name')}
            placeholder={t('placeholder_first_name')}
            editable={!supportSending}
          />
          <TextField
            value={supportMessage}
            onChangeText={setSupportMessage}
            label={t('support_request_message_label')}
            placeholder={t('support_request_message_placeholder')}
            multiline
            minLines={3}
            maxLines={8}
            maxLength={SUPPORT_MESSAGE_MAX_LEN}
            editable={!supportSending}
          />
          <Text style={styles.modalCounter}>{`${String(supportMessage || '').length}/${SUPPORT_MESSAGE_MAX_LEN}`}</Text>
        </ScrollView>
      </BaseModal>
    </Screen>
  );
}

export default LoginScreenContent;
