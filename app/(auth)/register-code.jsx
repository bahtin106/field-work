import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/ui/Button';
import { FUNCTIONS } from '../../lib/constants';
import { logClientError } from '../../lib/errorLogsClient';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useFeedback } from '../../src/shared/feedback';
import { useTheme } from '../../theme';
import { withAlpha } from '../../theme/colors';
import { LEGAL_LINKS } from '../../config/externalUrls';

const REGISTER_PENDING_KEY = 'register_pending_v1';
const REGISTER_FINGERPRINT_KEY = 'register_client_fingerprint_v1';
const REGISTER_CODE_COOLDOWN_PREFIX = 'register_code_cooldown_until:';
const resolveDeviceTimeZone = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.trim() ? tz.trim() : 'UTC';
  } catch {
    return 'UTC';
  }
};

async function getOrCreateRegisterClientFingerprint() {
  try {
    const existing = String((await AsyncStorage.getItem(REGISTER_FINGERPRINT_KEY)) || '').trim();
    if (existing) return existing;
    const seed = `${Date.now()}-${Math.random()}-${Math.random()}`;
    const normalized = seed.replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 96) || `rfp-${Date.now()}`;
    await AsyncStorage.setItem(REGISTER_FINGERPRINT_KEY, normalized);
    return normalized;
  } catch {
    return `rfp-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

async function parseInvokeErrorMessage(invokeError, fallbackMessage) {
  const fallback = String(fallbackMessage || '').trim() || 'Request failed';
  try {
    const context = invokeError?.context;
    if (!context || typeof context.clone !== 'function') return fallback;
    const textBody = await context.clone().text();
    if (!textBody) return fallback;
    try {
      const parsed = JSON.parse(textBody);
      const parsedMessage = String(parsed?.message || parsed?.error || '').trim();
      if (parsedMessage) return parsedMessage;
      return fallback;
    } catch {
      return textBody.trim() || fallback;
    }
  } catch {
    return fallback;
  }
}

async function parseInvokeErrorDetails(invokeError) {
  const statusCode =
    Number(invokeError?.context?.status || invokeError?.status || invokeError?.code || 0) || 0;
  let code = '';
  let message = '';
  try {
    const context = invokeError?.context;
    if (context && typeof context.clone === 'function') {
      const bodyText = await context.clone().text();
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText);
          code = String(parsed?.code || '').trim();
          message = String(parsed?.message || parsed?.error || '').trim();
        } catch {
          message = bodyText.trim();
        }
      }
    }
  } catch {}
  if (!message) message = String(invokeError?.message || '').trim();
  return { statusCode, code, message };
}

export default function RegisterCodeScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { showBanner, clearBanner, showSuccessToast } = useFeedback();
  const params = useLocalSearchParams();

  const initialEmail = String(params?.email || '').trim().toLowerCase();
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState(Array(6).fill(''));
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowTs, setNowTs] = useState(Date.now());
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [requireManualSubmit, setRequireManualSubmit] = useState(false);

  const inputRefs = useRef([]);
  const submittedCodeRef = useRef('');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: { flex: 1, backgroundColor: theme.colors.background },
        container: {
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.xl,
        },
        card: {
          borderRadius: theme.radii.xxl,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.xl,
          gap: theme.spacing.md,
        },
        iconWrap: {
          alignSelf: 'center',
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(theme.colors.primary, 0.12),
          marginBottom: theme.spacing.sm,
        },
        title: {
          textAlign: 'center',
          color: theme.colors.text,
          fontSize: theme.typography.sizes.xxl,
          fontWeight: theme.typography.weight.bold,
          lineHeight: Math.round((theme.typography.sizes.xxl || 30) * 1.1),
        },
        subtitle: {
          textAlign: 'center',
          color: theme.colors.textSecondary,
          fontSize: theme.typography.sizes.md,
          lineHeight: Math.round((theme.typography.sizes.md || 16) * 1.4),
        },
        email: { fontWeight: theme.typography.weight.bold, color: theme.colors.text },
        row: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: theme.spacing.xs,
          marginTop: theme.spacing.xs,
        },
        otpBox: {
          width: 44,
          height: 58,
          borderRadius: theme.radii.lg,
          borderWidth: 2,
          borderColor: theme.colors.border,
          textAlign: 'center',
          color: theme.colors.text,
          fontSize: theme.typography.sizes.lg,
          fontWeight: theme.typography.weight.bold,
          backgroundColor: theme.colors.card || theme.colors.surface,
        },
        otpLabel: {
          textAlign: 'center',
          color: theme.colors.textSecondary,
          fontSize: theme.typography.sizes.sm,
          letterSpacing: 0.8,
          marginTop: theme.spacing.xs,
        },
        resend: {
          alignSelf: 'center',
          marginTop: theme.spacing.sm,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
        },
        resendText: {
          color: theme.colors.textSecondary,
          fontSize: theme.typography.sizes.sm,
          fontWeight: theme.typography.weight.medium,
          textAlign: 'center',
        },
        errorText: {
          textAlign: 'center',
          color: theme.colors.danger,
          fontSize: theme.typography.sizes.sm,
          fontWeight: theme.typography.weight.medium,
        },
        loginLink: {
          marginTop: theme.spacing.xs,
          alignSelf: 'center',
          color: theme.colors.primary,
          fontWeight: theme.typography.weight.bold,
          fontSize: theme.typography.sizes.md,
        },
      }),
    [theme],
  );

  const timer = Math.max(0, Math.ceil((Number(cooldownUntil || 0) - Number(nowTs || 0)) / 1000));
  const code = otp.join('');
  const canSubmit = code.length === 6 && !!email && !submitting;

  const saveCooldown = useCallback(async (emailValue, untilTs) => {
    try {
      const normalizedEmail = String(emailValue || '').trim().toLowerCase();
      if (!normalizedEmail) return;
      await AsyncStorage.setItem(
        `${REGISTER_CODE_COOLDOWN_PREFIX}${normalizedEmail}`,
        String(Math.max(0, Number(untilTs || 0))),
      );
    } catch {}
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadInitial = async () => {
      try {
        const savedDraftRaw = await AsyncStorage.getItem(REGISTER_PENDING_KEY);
        const savedDraft = savedDraftRaw ? JSON.parse(savedDraftRaw) : null;
        const fallbackEmail = String(savedDraft?.email || '').trim().toLowerCase();
        const resolvedEmail = String(initialEmail || fallbackEmail).trim().toLowerCase();
        if (mounted) setEmail(resolvedEmail);
        if (!resolvedEmail) return;
        const savedCooldown = Number(
          (await AsyncStorage.getItem(`${REGISTER_CODE_COOLDOWN_PREFIX}${resolvedEmail}`)) || 0,
        );
        if (mounted) setCooldownUntil(savedCooldown);
      } catch {}
    };
    void loadInitial();
    return () => {
      mounted = false;
    };
  }, [initialEmail]);

  useEffect(() => {
    const id = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      try {
        inputRefs.current.forEach((ref) => ref?.blur?.());
      } catch {}
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleChange = useCallback((index, value) => {
    const digit = String(value || '').replace(/[^\d]/g, '').slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (inlineError) setInlineError('');
    if (requireManualSubmit) setRequireManualSubmit(false);
    submittedCodeRef.current = '';
    if (digit && index < 5) inputRefs.current[index + 1]?.focus?.();
  }, [inlineError, requireManualSubmit]);

  const handleKeyPress = useCallback(
    (index, key) => {
      if (key !== 'Backspace') return;
      if (otp[index]) {
        setOtp((prev) => {
          const next = [...prev];
          next[index] = '';
          return next;
        });
        submittedCodeRef.current = '';
        return;
      }
      if (index > 0) {
        setOtp((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
        submittedCodeRef.current = '';
        inputRefs.current[index - 1]?.focus?.();
      }
    },
    [otp],
  );

  const handleResend = useCallback(async () => {
    if (!email || timer > 0 || resending) return;
    setResending(true);
    setInlineError('');
    clearBanner();
    try {
      const clientFingerprint = await getOrCreateRegisterClientFingerprint();
      const { data, error } = await supabase.functions.invoke(FUNCTIONS.REGISTER_REQUEST_CODE, {
        body: {
          email,
          account_type: 'solo',
          company_name: null,
          client_fingerprint: clientFingerprint,
          bot_token: null,
        },
      });
      if (error || data?.ok === false) {
        const responseCode = String(data?.code || '').trim();
        if (responseCode === 'RATE_LIMITED') throw new Error(t('err_invite_rate_limit'));
        if (responseCode === 'BOT_CHALLENGE_REQUIRED') throw new Error(t('register_code_verify_required'));

        if (error) {
          const details = await parseInvokeErrorDetails(error);
          if (details.code === 'RATE_LIMITED' || details.statusCode === 429) {
            throw new Error(t('err_invite_rate_limit'));
          }
          if (details.code === 'BOT_CHALLENGE_REQUIRED') {
            throw new Error(t('register_code_verify_required'));
          }
          if (/EMAIL_SERVICE_URL|SERVER_MISCONFIGURED/i.test(details.message || '')) {
            throw new Error('Сервис отправки писем временно недоступен. Попробуйте позже');
          }
          if (details.message) {
            throw new Error(details.message);
          }
        }
        if (String(data?.message || '').trim()) {
          throw new Error(String(data.message).trim());
        }
        throw new Error(t('register_code_send_failed'));
      }

      const cooldownSeconds = Number(data?.cooldown_seconds || 60);
      const nextUntil = Date.now() + Math.max(1, cooldownSeconds) * 1000;
      setCooldownUntil(nextUntil);
      await saveCooldown(email, nextUntil);
      showSuccessToast(t('auth_verify_resend_sent'));
      inputRefs.current[0]?.focus?.();
      setOtp(Array(6).fill(''));
    } catch (e) {
      logClientError(e, { source: 'register_code_resend' });
      setInlineError(String(e?.message || t('common_unexpected_error')));
      showBanner({
        severity: 'error',
        message: String(e?.message || t('common_unexpected_error')),
      });
    } finally {
      setResending(false);
    }
  }, [email, timer, resending, clearBanner, t, saveCooldown, showSuccessToast, showBanner]);

  const handleVerifyAndRegister = useCallback(async (codeToSubmit, options = {}) => {
    const manual = Boolean(options?.manual);
    const normalizedCode = String(codeToSubmit || '').trim();
    if (!/^\d{6}$/.test(normalizedCode)) return;
    if (submitting || resending || !email) return;
    setSubmitting(true);
    setInlineError('');
    clearBanner();
    try {
      const draftRaw = await AsyncStorage.getItem(REGISTER_PENDING_KEY);
      const draft = draftRaw ? JSON.parse(draftRaw) : null;
      const normalizedEmail = String(email || draft?.email || '').trim().toLowerCase();
      if (!normalizedEmail || !draft?.password) {
        throw new Error(t('register_code_expired'));
      }

      const clientFingerprint = await getOrCreateRegisterClientFingerprint();
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
        FUNCTIONS.REGISTER_VERIFY_CODE,
        {
          body: {
            email: normalizedEmail,
            code: normalizedCode,
            client_fingerprint: clientFingerprint,
          },
        },
      );

      if (verifyError || verifyData?.ok === false || !verifyData?.registration_token) {
        const responseCode = String(verifyData?.code || '').trim();
        if (responseCode === 'CODE_EXPIRED') throw new Error(t('register_code_expired'));
        if (responseCode === 'TOO_MANY_ATTEMPTS') throw new Error(t('register_code_too_many_attempts'));
        throw new Error(t('register_code_invalid'));
      }

      const fullName =
        String(draft?.full_name || `${draft?.first_name || ''} ${draft?.last_name || ''}`)
          .replace(/\s+/g, ' ')
          .trim() || 'User Monitor';

      const { data: body, error: registerError } = await supabase.functions.invoke(
        FUNCTIONS.REGISTER_USER,
        {
          body: {
            email: normalizedEmail,
            password: String(draft.password),
            registration_token: String(verifyData.registration_token || ''),
            first_name: String(draft?.first_name || 'User'),
            last_name: String(draft?.last_name || 'Monitor'),
            full_name: fullName,
            account_type: 'solo',
            company_name: null,
            consent_offer: true,
            consent_privacy_policy: true,
            consent_personal_data: true,
            consent_cookies: true,
            consent_source: 'mobile_app',
            client_fingerprint: clientFingerprint,
            timezone: resolveDeviceTimeZone(),
            consent_documents: {
              offer_url: LEGAL_LINKS.offer,
              privacy_url: LEGAL_LINKS.privacy,
              personal_data_url: LEGAL_LINKS.personalData,
              cookies_url: LEGAL_LINKS.cookies,
            },
          },
        },
      );

      if (registerError || !body?.user_id) {
        const rawMessage = registerError
          ? await parseInvokeErrorMessage(registerError, t('error_profile_not_updated'))
          : String(body?.error || body?.message || t('error_profile_not_updated')).trim();
        throw new Error(rawMessage || t('error_profile_not_updated'));
      }

      await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: String(draft.password),
      });

      await AsyncStorage.removeItem(REGISTER_PENDING_KEY);
      await AsyncStorage.removeItem(`${REGISTER_CODE_COOLDOWN_PREFIX}${normalizedEmail}`);
      showSuccessToast(t('register_success'));
      router.replace('/orders');
    } catch (e) {
      logClientError(e, { source: 'register_code_submit' });
      const rawMessage = String(e?.message || t('common_unexpected_error'));
      const message =
        /EMAIL_VERIFICATION_FAILED|Email verification failed/i.test(rawMessage)
          ? t('register_code_invalid')
          : /EMAIL_TAKEN|User with this email already exists/i.test(rawMessage)
            ? t('error_email_exists')
            : rawMessage;
      setInlineError(message);
      showBanner({
        severity: 'error',
        message,
      });
      const isInvalidCodeError =
        message === t('register_code_invalid') ||
        message === t('register_code_expired') ||
        message === t('register_code_too_many_attempts');
      if (isInvalidCodeError) {
        if (!manual) setRequireManualSubmit(true);
        submittedCodeRef.current = '';
      }
    } finally {
      setSubmitting(false);
    }
  }, [clearBanner, email, resending, router, showBanner, showSuccessToast, submitting, t]);

  useEffect(() => {
    if (code.length !== 6) return;
    if (submitting || resending) return;
    if (requireManualSubmit) return;
    if (submittedCodeRef.current === code) return;
    submittedCodeRef.current = code;
    void handleVerifyAndRegister(code, { manual: false });
  }, [code, submitting, resending, requireManualSubmit, handleVerifyAndRegister]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.container}>
          <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Feather name="mail" size={30} color={theme.colors.primary} />
          </View>
          <Text style={styles.title}>{t('register_code_screen_title')}</Text>
          <Text style={styles.subtitle}>
            {t('register_code_screen_sent_to')} <Text style={styles.email}>{email || '-'}</Text>
          </Text>
          <Text style={styles.subtitle}>{t('register_code_screen_expire_hint')}</Text>

          <View style={styles.row}>
            {otp.map((digit, index) => (
              <TextInput
                key={`otp-${index}`}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                style={styles.otpBox}
                value={digit}
                onChangeText={(val) => handleChange(index, val)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent?.key)}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={1}
                editable={!submitting}
                caretHidden={!keyboardVisible}
                autoFocus={index === 0}
              />
            ))}
          </View>
          <Text style={styles.otpLabel}>{t('register_code_screen_otp_label')}</Text>

          <Button
            title={t('register_code_confirm_button')}
            variant="primary"
            size="lg"
            onPress={() => handleVerifyAndRegister(code, { manual: true })}
            loading={submitting}
            disabled={!canSubmit || resending}
          />
          {inlineError ? <Text style={styles.errorText}>{inlineError}</Text> : null}

          <Pressable
            onPress={handleResend}
            disabled={timer > 0 || resending || submitting}
            style={styles.resend}
          >
            <Text style={styles.resendText}>
              {timer > 0
                ? t('register_code_resend_in').replace('{n}', String(timer))
                : resending
                  ? t('register_code_resending')
                  : t('register_code_resend_action')}
            </Text>
          </Pressable>

            <Pressable onPress={() => router.replace('/(auth)/login')}>
              <Text style={styles.loginLink}>{t('btn_login')}</Text>
            </Pressable>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

