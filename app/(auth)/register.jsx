import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import TextField from '../../components/ui/TextField';
import {
  FEEDBACK_CODES,
  FieldErrorText,
  ScreenBanner,
  getMessageByCode,
  normalizeError,
  useFeedback,
} from '../../src/shared/feedback';
import { useFormAutoScroll } from '../../src/shared/forms/useFormAutoScroll';
import {
  AUTH_CONSTRAINTS,
  filterPasswordInput,
  getPasswordStrengthChecks,
  isValidEmail,
  isValidPassword,
  normalizeHumanName,
} from '../../lib/authValidation';
import { KeyboardAwareScrollView } from '../../lib/keyboardControllerCompat';
import { FUNCTIONS } from '../../lib/constants';
import { logClientError } from '../../lib/errorLogsClient';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
import TurnstileWidget from '../../src/shared/security/TurnstileWidget';
import { useTheme } from '../../theme';
import { withAlpha } from '../../theme/colors';
import { LEGAL_LINKS } from '../../config/externalUrls';

const resolveDeviceTimeZone = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.trim() ? tz.trim() : 'UTC';
  } catch {
    return 'UTC';
  }
};

const REGISTER_FINGERPRINT_KEY = 'register_client_fingerprint_v1';
const REGISTER_PENDING_KEY = 'register_pending_v1';
const REGISTER_CODE_COOLDOWN_PREFIX = 'register_code_cooldown_until:';

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

const createStyles = (theme, insets = {}) => {
  const bottomInset = insets.bottom ?? 0;
  const registerUi = theme.components?.authRegister || {};
  const topSpacingKey = registerUi.contentTopSpacing ?? 'sm';
  const formCardTopPaddingKey = registerUi.formCardTopPadding ?? 'sm';
  const formCardBottomPaddingKey = registerUi.formCardBottomPadding ?? 'xs';
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    flex: { flex: 1 },
    content: {
      width: '100%',
      maxWidth: 620,
      alignSelf: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing[topSpacingKey] ?? theme.spacing.sm,
      paddingBottom:
        (theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl) +
        bottomInset +
        theme.spacing.xl,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.xxl,
      lineHeight: Math.round((theme.typography.sizes.xxl || 28) * 1.18),
      fontWeight: theme.typography.weight.bold,
      marginBottom: theme.spacing.lg,
      textAlign: 'center',
    },
    section: {
      marginBottom: theme.spacing.lg,
    },
    formCard: {
      paddingTop: theme.spacing[formCardTopPaddingKey] ?? theme.spacing.sm,
      paddingBottom: theme.spacing[formCardBottomPaddingKey] ?? theme.spacing.xs,
    },
    field: {
      marginHorizontal: 0,
      marginVertical: theme.spacing.xs,
    },
    fieldWithErrorGap: {
      marginBottom: theme.spacing.xs,
    },
    passwordToggle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: -theme.spacing.xs,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: theme.spacing.xs,
      marginTop: theme.spacing.xs,
      marginLeft: theme.spacing.md,
      marginBottom: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      borderRadius: theme.radii.pill,
      borderWidth: 1,
    },
    statusText: {
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.semibold,
    },
    companyToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    companyToggleText: {
      marginLeft: theme.spacing.sm,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
      flex: 1,
    },
    consentPanel: {
      marginBottom: theme.spacing.lg,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radii.xl,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    consentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.xs,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radii.md,
    },
    consentTextWrap: {
      flex: 1,
      marginLeft: theme.spacing.sm,
    },
    consentText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round((theme.typography.sizes.sm || 14) * 1.35),
    },
    consentLink: {
      color: theme.colors.primary,
      fontWeight: theme.typography.weight.semibold,
    },
    consentDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
      marginLeft: 42,
    },
    consentErrorText: {
      color: theme.colors.danger,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.medium,
      marginTop: theme.spacing.xs,
      marginHorizontal: theme.spacing.xs,
    },
    passwordRules: {
      marginHorizontal: theme.spacing.md,
      marginTop: 2,
      marginBottom: theme.spacing.xs,
      gap: 4,
    },
    passwordRuleText: {
      fontSize: theme.typography.sizes.sm,
      lineHeight: Math.round((theme.typography.sizes.sm || 14) * 1.25),
    },
    banner: {
      marginBottom: theme.spacing.md,
    },
    submitButton: {
      marginTop: theme.spacing.sm,
    },
    loginLinkContainer: {
      alignSelf: 'center',
      marginTop: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
    },
    loginText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      textAlign: 'center',
      fontWeight: theme.typography.weight.medium,
    },
    loginLink: {
      color: theme.colors.primary,
      fontWeight: theme.typography.weight.bold,
    },
  });
};

function AvailabilityStatus({ status, availableText, checkingText, theme, styles }) {
  if (!status || status === 'taken') return null;

  const isAvailable = status === 'available';
  const color = isAvailable ? theme.colors.success : theme.colors.primary;

  return (
    <View
      style={[
        styles.statusBadge,
        {
          backgroundColor: withAlpha(color, 0.1),
          borderColor: withAlpha(color, 0.24),
        },
      ]}
    >
      <Feather name={isAvailable ? 'check-circle' : 'loader'} size={13} color={color} />
      <Text style={[styles.statusText, { color }]}>
        {isAvailable ? availableText : checkingText}
      </Text>
    </View>
  );
}

function pickMessageFromPayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  return String(payload.message || payload.error || payload.details || payload.hint || '').trim();
}

async function _resolveRegisterInvokeError(invokeError, t) {
  const statusCode =
    Number(invokeError?.context?.status || invokeError?.status || invokeError?.code || 0) || 0;

  let payloadMessage = '';
  let payloadCode = '';
  const context = invokeError?.context;
  if (context && typeof context.clone === 'function') {
    try {
      const bodyText = await context.clone().text();
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText);
          payloadMessage = pickMessageFromPayload(parsed);
          payloadCode = String(parsed?.code || '').trim();
        } catch {
          payloadMessage = bodyText.trim();
        }
      }
    } catch {}
  }

  const raw = `${payloadCode} ${payloadMessage} ${String(invokeError?.message || '')}`.trim();
  if (/EMAIL_TAKEN|already exists|email.*taken|user.*exists/i.test(raw)) {
    return new Error(t('error_email_exists'));
  }
  if (/COMPANY_NAME_TAKEN|company.*already exists|duplicate/i.test(raw)) {
    return new Error(t('errors_companyName_duplicate'));
  }
  if (/CONSENT_REQUIRED/i.test(raw)) {
    return new Error(t('register_error_consent_required'));
  }
  if (/EMAIL_VERIFICATION_REQUIRED|EMAIL_VERIFICATION_FAILED/i.test(raw)) {
    return new Error(t('register_code_verify_required'));
  }
  if (/CODE_EXPIRED/i.test(raw)) {
    return new Error(t('register_code_expired'));
  }
  if (statusCode === 429 || /RATE_LIMITED|too many requests/i.test(raw)) {
    return new Error(t('err_invite_rate_limit'));
  }
  if (!payloadMessage && /edge function returned a non-2xx status code/i.test(raw)) {
    return new Error(t('error_profile_not_updated'));
  }

  return new Error(payloadMessage || String(invokeError?.message || t('error_profile_not_updated')));
}

async function parseInvokeErrorDetails(invokeError) {
  const statusCode =
    Number(invokeError?.context?.status || invokeError?.status || invokeError?.code || 0) || 0;
  let payloadCode = '';
  let payloadMessage = '';

  const context = invokeError?.context;
  if (context && typeof context.clone === 'function') {
    try {
      const bodyText = await context.clone().text();
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText);
          payloadCode = String(parsed?.code || '').trim();
          payloadMessage = pickMessageFromPayload(parsed);
        } catch {
          payloadMessage = bodyText.trim();
        }
      }
    } catch {}
  }

  const fallbackMessage = String(invokeError?.message || '').trim();
  return {
    statusCode,
    code: payloadCode,
    message: payloadMessage || fallbackMessage,
  };
}

export default function RegisterScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { banner, showBanner, clearBanner, showSuccessToast } = useFeedback();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, insets), [theme, insets]);
  const interactive = theme.components?.interactive || { pressedOpacity: 0.72 };
  const registerUi = theme.components?.authRegister || {};
  const touchableHitSlop = theme.components?.interactive?.hitSlop ?? {
    top: 8,
    bottom: 8,
    left: 8,
    right: 8,
  };
  const chevronSize = theme.components?.listItem?.chevronSize ?? 20;
  const sharedFieldProps = {
    floatingLabel: true,
    floatingLabelShiftX: registerUi.floatingLabelShiftX ?? -2,
    floatingLabelGapScale: registerUi.floatingLabelGapScale ?? 2,
  };

  const [firstName] = useState('Пользователь');
  const [lastName] = useState('Monitor');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const _createCompanyProfile = false;
  const [companyName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  const [consentAccepted] = useState(true);
  const [emailCheckStatus, setEmailCheckStatus] = useState(null);
  const [invalidCharWarning, setInvalidCharWarning] = useState(false);
  const [companyCheckStatus, setCompanyCheckStatus] = useState(null);
  const [codeSent, setCodeSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');

  const emailCheckTimeoutRef = useRef(null);
  const invalidInputTimeoutRef = useRef(null);
  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const pwdRef = useRef(null);
  const confirmPwdRef = useRef(null);
  const companyNameRef = useRef(null);
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const headerHeight = theme.components?.header?.height ?? 56;
  const keyboardBottomOffset = theme.components?.keyboardAware?.bottomOffset ?? 40;
  const extraKeyboardSpace = theme.components?.keyboardAware?.extraKeyboardSpace ?? 60;
  const { scrollToFirstInvalid } = useFormAutoScroll({
    scrollRef,
    scrollYRef,
    insetsBottom: insets.bottom ?? 0,
    headerHeight,
  });

  const emailValid = useMemo(() => isValidEmail(email), [email]);
  const passwordChecks = useMemo(() => getPasswordStrengthChecks(password), [password]);
  const passwordValid = useMemo(
    () =>
      isValidPassword(password) &&
      passwordChecks.minLength &&
      passwordChecks.hasUpper &&
      passwordChecks.hasLower &&
      passwordChecks.hasDigit,
    [password, passwordChecks],
  );
  const passwordsMatch = useMemo(
    () => !password || password === confirmPassword,
    [password, confirmPassword],
  );
  const checkingAvailability =
    emailCheckStatus === 'checking' || companyCheckStatus === 'checking';
  const accountType = 'solo';
  const allConsentsAccepted = consentAccepted;
  const turnstileSiteKey = String(process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || '').trim();
  const requiresTurnstile = Platform.OS === 'web' && turnstileSiteKey.length > 0;

  const shouldShowError = useCallback(
    (field) => submittedAttempt || !!touched[field],
    [submittedAttempt, touched],
  );
  const clearFieldError = useCallback((field) => {
    setFieldErrors((prev) => {
      if (!prev?.[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const savePendingRegisterDraft = useCallback(async (payload) => {
    try {
      await AsyncStorage.setItem(REGISTER_PENDING_KEY, JSON.stringify(payload || {}));
    } catch {}
  }, []);

  const saveCodeCooldownUntil = useCallback(async (emailValue, cooldownUntilTs) => {
    try {
      const normalizedEmail = String(emailValue || '').trim().toLowerCase();
      if (!normalizedEmail) return;
      await AsyncStorage.setItem(
        `${REGISTER_CODE_COOLDOWN_PREFIX}${normalizedEmail}`,
        String(Math.max(0, Number(cooldownUntilTs || 0))),
      );
    } catch {}
  }, []);

  useEffect(() => {
    setCodeSent(false);
  }, [email]);
  const requiredMsg = useMemo(
    () => getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t),
    [t],
  );
  const emailError =
    fieldErrors.email?.message ||
    ((shouldShowError('email') || emailCheckStatus === 'taken') && !email.trim()
      ? requiredMsg
      : email.trim() && !emailValid
        ? getMessageByCode(FEEDBACK_CODES.INVALID_EMAIL, t)
        : emailCheckStatus === 'taken'
          ? getMessageByCode(FEEDBACK_CODES.EMAIL_TAKEN, t)
          : null);
  const passwordError =
    fieldErrors.password?.message ||
    (shouldShowError('password') && !password.trim()
      ? requiredMsg
      : password.length > 0 && !passwordValid
        ? getMessageByCode(FEEDBACK_CODES.PASSWORD_TOO_SHORT, t)
        : null);

  const openLegalLink = useCallback(async (url) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) await Linking.openURL(url);
    } catch {}
  }, []);

  const checkRegistrationAvailability = useCallback(
    async ({ emailToCheck, accountTypeToCheck: _accountTypeToCheck, companyNameToCheck }) => {
      if (!emailToCheck || !isValidEmail(emailToCheck)) {
        setEmailCheckStatus(null);
        setCompanyCheckStatus(null);
        return;
      }
      const _normalizedCompany = String(companyNameToCheck || '').trim();
      const shouldCheckCompany = false;
      const clientFingerprint = await getOrCreateRegisterClientFingerprint();

      try {
        setEmailCheckStatus('checking');
        if (shouldCheckCompany) {
          setCompanyCheckStatus('checking');
        } else {
          setCompanyCheckStatus(null);
        }

        const { data, error } = await supabase.functions.invoke(FUNCTIONS.REGISTER_USER, {
          body: {
            check_only: true,
            email: String(emailToCheck).trim().toLowerCase(),
            account_type: 'solo',
            company_name: null,
            client_fingerprint: clientFingerprint,
            timezone: resolveDeviceTimeZone(),
          },
        });

        if (error) {
          console.warn('Register availability check error:', error);
          logClientError(error, { source: 'register_availability_check' });
          setEmailCheckStatus(null);
          setCompanyCheckStatus(null);
          return;
        }

        setEmailCheckStatus(data?.email_available ? 'available' : 'taken');
        if (shouldCheckCompany) {
          setCompanyCheckStatus(data?.company_available ? 'available' : 'taken');
        } else {
          setCompanyCheckStatus(null);
        }
      } catch (e) {
        console.warn('Register availability check failed:', e);
        logClientError(e, { source: 'register_availability_check' });
        setEmailCheckStatus(null);
        setCompanyCheckStatus(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (emailCheckTimeoutRef.current) {
      clearTimeout(emailCheckTimeoutRef.current);
    }

    if (!email || !emailValid) {
      setEmailCheckStatus(null);
      return;
    }

    emailCheckTimeoutRef.current = setTimeout(() => {
      checkRegistrationAvailability({
        emailToCheck: email.trim().toLowerCase(),
        accountTypeToCheck: accountType,
        companyNameToCheck: companyName,
      });
    }, theme.timings.emailDebounceMs);

    return () => {
      if (emailCheckTimeoutRef.current) {
        clearTimeout(emailCheckTimeoutRef.current);
      }
    };
  }, [
    email,
    emailValid,
    accountType,
    companyName,
    checkRegistrationAvailability,
    theme.timings.emailDebounceMs,
  ]);

  const didClearBannerRef = useRef(false);
  useEffect(() => {
    if (didClearBannerRef.current) return;
    didClearBannerRef.current = true;
    clearBanner();
  }, [clearBanner]);

  const handleInvalidPasswordInput = useCallback(() => {
    if (invalidInputTimeoutRef.current) {
      clearTimeout(invalidInputTimeoutRef.current);
    }
    setInvalidCharWarning(true);
    invalidInputTimeoutRef.current = setTimeout(() => {
      setInvalidCharWarning(false);
    }, theme.timings.invalidInputWarningMs);
  }, [theme.timings.invalidInputWarningMs]);

  useEffect(
    () => () => {
      if (invalidInputTimeoutRef.current) {
        clearTimeout(invalidInputTimeoutRef.current);
      }
    },
    [],
  );

  const handleRegister = useCallback(async () => {
    if (submitting) return;
    Keyboard.dismiss();
    setSubmittedAttempt(true);
    clearBanner();
    setFieldErrors({});

    const normalizedFirstName = normalizeHumanName(firstName);
    const normalizedLastName = normalizeHumanName(lastName);
    const _normalizedCompanyName = '';
    const missingFirst = false;
    const missingLast = false;
    const invalidFirstName = false;
    const invalidLastName = false;
    const invalidEmail = !emailValid;
    const invalidPwd = !passwordValid;
    const mismatchPwd = !passwordsMatch;
    const emailTaken = emailCheckStatus === 'taken';
    const companyTaken = false;
    const needsCompanyName = false;

    if (
      emailTaken ||
      companyTaken ||
      missingFirst ||
      missingLast ||
      invalidFirstName ||
      invalidLastName ||
      invalidEmail ||
      invalidPwd ||
      mismatchPwd ||
      needsCompanyName ||
      !allConsentsAccepted
    ) {
      const nextFieldErrors = {};
      if (missingFirst) nextFieldErrors.firstName = { message: requiredMsg };
      if (missingLast) nextFieldErrors.lastName = { message: requiredMsg };
      if (invalidFirstName) nextFieldErrors.firstName = { message: requiredMsg };
      if (invalidLastName) nextFieldErrors.lastName = { message: requiredMsg };
      if (invalidEmail) {
        nextFieldErrors.email = {
          message: getMessageByCode(FEEDBACK_CODES.INVALID_EMAIL, t),
        };
      }
      if (emailTaken) {
        nextFieldErrors.email = {
          message: getMessageByCode(FEEDBACK_CODES.EMAIL_TAKEN, t),
        };
      }
      if (invalidPwd) {
        nextFieldErrors.password = {
          message: getMessageByCode(FEEDBACK_CODES.PASSWORD_TOO_SHORT, t),
        };
      }
      if (mismatchPwd) {
        nextFieldErrors.confirmPassword = {
          message: getMessageByCode(FEEDBACK_CODES.PASSWORD_MISMATCH, t),
        };
      }
      if (Object.keys(nextFieldErrors).length) setFieldErrors(nextFieldErrors);
      if (!allConsentsAccepted) {
        showBanner({
          message: t('register_error_consent_required'),
          severity: 'warning',
        });
      }
      scrollToFirstInvalid([
        { invalid: false, ref: firstNameRef },
        { invalid: false, ref: lastNameRef },
        { invalid: invalidEmail || emailTaken, ref: emailRef },
        { invalid: false, ref: companyNameRef },
        { invalid: invalidPwd, ref: pwdRef },
        { invalid: mismatchPwd, ref: confirmPwdRef },
      ]);
      return;
    }

    clearBanner();
    setSubmitting(true);

    try {
      const fullName = `${normalizedFirstName} ${normalizedLastName}`.replace(/\s+/g, ' ').trim();
      const normalizedEmail = String(email).trim().toLowerCase();
      const clientFingerprint = await getOrCreateRegisterClientFingerprint();
      if (requiresTurnstile && !turnstileToken && !codeSent) {
        throw new Error(t('register_code_verify_required'));
      }

      const { data: requestCodeData, error: requestCodeError } = await supabase.functions.invoke(
        FUNCTIONS.REGISTER_REQUEST_CODE,
        {
          body: {
            email: normalizedEmail,
            account_type: 'solo',
            company_name: null,
            client_fingerprint: clientFingerprint,
            bot_token: turnstileToken || null,
          },
        },
      );

      if (requestCodeError || requestCodeData?.ok === false) {
        const responseCode = String(requestCodeData?.code || '').trim();
        if (responseCode === 'EMAIL_TAKEN') throw new Error(t('error_email_exists'));
        if (responseCode === 'COMPANY_NAME_TAKEN') throw new Error(t('errors_companyName_duplicate'));
        if (responseCode === 'RATE_LIMITED') throw new Error(t('err_invite_rate_limit'));
        if (responseCode === 'BOT_CHALLENGE_REQUIRED') throw new Error(t('register_code_verify_required'));

        if (requestCodeError) {
          const details = await parseInvokeErrorDetails(requestCodeError);
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

        if (String(requestCodeData?.message || '').trim()) {
          throw new Error(String(requestCodeData.message).trim());
        }
        throw new Error(t('register_code_send_failed'));
      }

      const cooldownSeconds = Number(requestCodeData?.cooldown_seconds || 60);
      const cooldownUntil = Date.now() + Math.max(1, cooldownSeconds) * 1000;

      await savePendingRegisterDraft({
        email: normalizedEmail,
        password: String(password),
        first_name: normalizedFirstName,
        last_name: normalizedLastName,
        full_name: fullName,
        account_type: 'solo',
        company_name: null,
      });
      await saveCodeCooldownUntil(normalizedEmail, cooldownUntil);

      showSuccessToast(t('register_code_sent'));
      router.push({
        pathname: '/(auth)/register-code',
        params: { email: normalizedEmail },
      });
      return;
    } catch (e) {
      logClientError(e, { source: 'register_submit' });
      const normalized = normalizeError(e, {
        t,
        fieldMap: { email: 'email', companyName: 'companyName' },
      });
      if (Object.keys(normalized.fieldErrors || {}).length) {
        setFieldErrors((prev) => ({ ...prev, ...normalized.fieldErrors }));
      }
      if (normalized.screenError) {
        showBanner({
          ...normalized.screenError,
          action: { label: t('btn_retry'), onPress: handleRegister },
        });
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    firstName,
    lastName,
    email,
    password,
    passwordsMatch,
    emailValid,
    passwordValid,
    allConsentsAccepted,
    emailCheckStatus,
    codeSent,
    turnstileToken,
    requiresTurnstile,
    router,
    t,
    showSuccessToast,
    showBanner,
    clearBanner,
    savePendingRegisterDraft,
    saveCodeCooldownUntil,
    requiredMsg,
    scrollToFirstInvalid,
  ]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAwareScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
          bottomOffset={keyboardBottomOffset}
          extraKeyboardSpace={extraKeyboardSpace}
          onScroll={(e) => {
            try {
              scrollYRef.current = e?.nativeEvent?.contentOffset?.y || 0;
            } catch {}
          }}
          scrollEventThrottle={16}
        >
          <Text style={styles.title}>{t('register_title')}</Text>

          {banner ? (
            <ScreenBanner message={banner} onClose={clearBanner} style={styles.banner} />
          ) : null}

          {invalidCharWarning ? (
            <ScreenBanner
              message={{ message: t('err_password_invalid_chars'), severity: 'warning' }}
              onClose={() => setInvalidCharWarning(false)}
              style={styles.banner}
            />
          ) : null}

          <View style={styles.section}>
            <Card padded={false} paddedXOnly style={styles.formCard}>
              <TextField
                ref={emailRef}
                label={t('label_email')}
                value={email}
                onChangeText={(val) => {
                  setEmail(val);
                  clearFieldError('email');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                placeholder={t('placeholder_email')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => pwdRef.current?.focus()}
                editable={!submitting}
                required
                forceValidation={submittedAttempt}
                error={emailError ? 'invalid' : undefined}
                style={styles.field}
                {...sharedFieldProps}
              />
              <AvailabilityStatus
                status={emailCheckStatus}
                availableText={t('hint_available')}
                checkingText={t('hint_checking')}
                theme={theme}
                styles={styles}
              />
              <FieldErrorText message={emailError} style={styles.fieldWithErrorGap} />
              <TextField
                ref={pwdRef}
                label={t('register_label_password')}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  setConfirmPassword(val);
                  if (invalidCharWarning) setInvalidCharWarning(false);
                  clearFieldError('password');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                placeholder={t('register_placeholder_password')}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleRegister}
                editable={!submitting}
                required
                forceValidation={submittedAttempt}
                error={passwordError ? 'invalid' : undefined}
                filterInput={filterPasswordInput}
                onInvalidInput={handleInvalidPasswordInput}
                maxLength={AUTH_CONSTRAINTS.PASSWORD.MAX_LENGTH}
                rightSlot={
                  <Pressable
                    onPress={() => setShowPassword((value) => !value)}
                    accessibilityLabel={
                      showPassword ? t('a11y_hide_password') : t('a11y_show_password')
                    }
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.passwordToggle,
                      pressed && { backgroundColor: withAlpha(theme.colors.primary, 0.08) },
                    ]}
                    hitSlop={touchableHitSlop}
                    disabled={submitting}
                  >
                    <Feather
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={chevronSize}
                      color={theme.colors.primary}
                    />
                  </Pressable>
                }
                style={styles.field}
                {...sharedFieldProps}
              />
              <FieldErrorText message={passwordError} style={styles.fieldWithErrorGap} />
              <View style={styles.passwordRules}>
                <Text
                  style={[
                    styles.passwordRuleText,
                    { color: passwordChecks.minLength ? theme.colors.success : theme.colors.textSecondary },
                  ]}
                >
                  Минимум 8 символов
                </Text>
                <Text
                  style={[
                    styles.passwordRuleText,
                    { color: passwordChecks.hasUpper ? theme.colors.success : theme.colors.textSecondary },
                  ]}
                >
                  Хотя бы одна заглавная буква
                </Text>
                <Text
                  style={[
                    styles.passwordRuleText,
                    { color: passwordChecks.hasLower ? theme.colors.success : theme.colors.textSecondary },
                  ]}
                >
                  Хотя бы одна строчная буква
                </Text>
                <Text
                  style={[
                    styles.passwordRuleText,
                    { color: passwordChecks.hasDigit ? theme.colors.success : theme.colors.textSecondary },
                  ]}
                >
                  Хотя бы одна цифра
                </Text>
              </View>
            </Card>
          </View>

          <View style={styles.consentPanel}>
            <View style={styles.consentRow}>
              <View style={styles.consentTextWrap}>
                <Text style={styles.consentText}>
                  Нажимая кнопку, вы соглашаетесь с{' '}
                  <Text style={styles.consentLink} onPress={() => openLegalLink(LEGAL_LINKS.offer)}>
                    офертой
                  </Text>
                  ,{' '}
                  <Text style={styles.consentLink} onPress={() => openLegalLink(LEGAL_LINKS.privacy)}>
                    политикой конфиденциальности
                  </Text>
                  ,{' '}
                  <Text style={styles.consentLink} onPress={() => openLegalLink(LEGAL_LINKS.personalData)}>
                    обработкой персональных данных
                  </Text>{' '}
                  и{' '}
                  <Text style={styles.consentLink} onPress={() => openLegalLink(LEGAL_LINKS.cookies)}>
                    cookies
                  </Text>
                  .
                </Text>
              </View>
            </View>
          </View>

          <Button
            title={t('register_code_request_button')}
            variant="primary"
            size="lg"
            onPress={handleRegister}
            loading={submitting}
            disabled={submitting || checkingAvailability}
            style={styles.submitButton}
          />
          {requiresTurnstile ? (
            <View style={[styles.field, { marginTop: theme.spacing.sm }]}>
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                onTokenChange={setTurnstileToken}
                onError={(error) => {
                  logClientError(error, { source: 'register_turnstile' });
                  setTurnstileToken('');
                }}
              />
            </View>
          ) : null}

          <Pressable
            onPress={() => {
              if (submitting) return;
              router.push('/(auth)/login');
            }}
            disabled={submitting}
            style={({ pressed }) => [
              styles.loginLinkContainer,
              pressed && { opacity: interactive.pressedOpacity },
            ]}
            hitSlop={touchableHitSlop}
          >
            <Text style={styles.loginText}>
              <Text style={styles.loginLink}>{t('register_back_to_login')}</Text>
            </Text>
          </Pressable>
        </KeyboardAwareScrollView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}
