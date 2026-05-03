import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Checkbox from '../../components/ui/Checkbox';
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
  isValidEmail,
  isValidHumanName,
  isValidPassword,
  normalizeHumanName,
} from '../../lib/authValidation';
import { KeyboardAwareScrollView } from '../../lib/keyboardControllerCompat';
import { normalizeCompanyName, validateCompanyName } from '../../lib/companyName';
import { FUNCTIONS } from '../../lib/constants';
import { logClientError } from '../../lib/errorLogsClient';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
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

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [createCompanyProfile, setCreateCompanyProfile] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  const [consentOfferChecked, setConsentOfferChecked] = useState(false);
  const [consentPrivacyChecked, setConsentPrivacyChecked] = useState(false);
  const [consentPersonalDataChecked, setConsentPersonalDataChecked] = useState(false);
  const [consentCookiesChecked, setConsentCookiesChecked] = useState(false);
  const [emailCheckStatus, setEmailCheckStatus] = useState(null);
  const [invalidCharWarning, setInvalidCharWarning] = useState(false);
  const [companyCheckStatus, setCompanyCheckStatus] = useState(null);

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
  const passwordValid = useMemo(() => isValidPassword(password), [password]);
  const passwordsMatch = useMemo(
    () => !password || password === confirmPassword,
    [password, confirmPassword],
  );
  const checkingAvailability =
    emailCheckStatus === 'checking' || companyCheckStatus === 'checking';
  const accountType = createCompanyProfile ? 'company' : 'solo';
  const allConsentsAccepted =
    consentOfferChecked &&
    consentPrivacyChecked &&
    consentPersonalDataChecked &&
    consentCookiesChecked;

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
  const requiredMsg = useMemo(
    () => getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t),
    [t],
  );
  const companyNameValidationMessage = useMemo(
    () => validateCompanyName(companyName, t),
    [companyName, t],
  );

  const firstNameError =
    fieldErrors.firstName?.message ||
    (shouldShowError('firstName') && !firstName.trim()
      ? requiredMsg
      : firstName.trim() && !isValidHumanName(firstName)
        ? requiredMsg
        : null);
  const lastNameError =
    fieldErrors.lastName?.message ||
    (shouldShowError('lastName') && !lastName.trim()
      ? requiredMsg
      : lastName.trim() && !isValidHumanName(lastName)
        ? requiredMsg
        : null);
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
  const confirmPasswordError =
    fieldErrors.confirmPassword?.message ||
    (shouldShowError('confirmPassword') && !confirmPassword.trim()
      ? requiredMsg
      : confirmPassword.length > 0 && !passwordsMatch
        ? getMessageByCode(FEEDBACK_CODES.PASSWORD_MISMATCH, t)
        : null);
  const companyNameError =
    fieldErrors.companyName?.message ||
    (accountType === 'company' && companyCheckStatus === 'taken'
      ? t('errors_companyName_duplicate')
      : shouldShowError('companyName') &&
          accountType === 'company' &&
          companyNameValidationMessage
        ? companyNameValidationMessage
        : null);

  const openLegalLink = useCallback(async (url) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) await Linking.openURL(url);
    } catch {}
  }, []);

  const checkRegistrationAvailability = useCallback(
    async ({ emailToCheck, accountTypeToCheck, companyNameToCheck }) => {
      if (!emailToCheck || !isValidEmail(emailToCheck)) {
        setEmailCheckStatus(null);
        setCompanyCheckStatus(null);
        return;
      }
      const normalizedCompany = normalizeCompanyName(companyNameToCheck);
      const shouldCheckCompany =
        accountTypeToCheck === 'company' && !validateCompanyName(normalizedCompany, t);

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
            account_type: shouldCheckCompany ? 'company' : 'solo',
            company_name: shouldCheckCompany ? normalizedCompany : null,
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
    [t],
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
    const normalizedCompanyName = normalizeCompanyName(companyName);
    const missingFirst = !normalizedFirstName;
    const missingLast = !normalizedLastName;
    const invalidFirstName = !!normalizedFirstName && !isValidHumanName(normalizedFirstName);
    const invalidLastName = !!normalizedLastName && !isValidHumanName(normalizedLastName);
    const invalidEmail = !emailValid;
    const invalidPwd = !passwordValid;
    const mismatchPwd = !passwordsMatch;
    const emailTaken = emailCheckStatus === 'taken';
    const companyTaken = companyCheckStatus === 'taken';
    const companyNameValidationError =
      accountType === 'company' ? validateCompanyName(normalizedCompanyName, t) : null;
    const needsCompanyName = accountType === 'company' && !!companyNameValidationError;

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
      if (needsCompanyName) nextFieldErrors.companyName = { message: companyNameValidationError };
      if (companyTaken) nextFieldErrors.companyName = { message: t('errors_companyName_duplicate') };
      if (Object.keys(nextFieldErrors).length) setFieldErrors(nextFieldErrors);
      if (!allConsentsAccepted) {
        showBanner({
          message: t('register_error_consent_required'),
          severity: 'warning',
        });
      }
      scrollToFirstInvalid([
        { invalid: missingFirst, ref: firstNameRef },
        { invalid: missingLast, ref: lastNameRef },
        { invalid: invalidEmail || emailTaken, ref: emailRef },
        { invalid: needsCompanyName || companyTaken, ref: companyNameRef },
        { invalid: invalidPwd, ref: pwdRef },
        { invalid: mismatchPwd, ref: confirmPwdRef },
      ]);
      return;
    }

    clearBanner();
    setSubmitting(true);

    try {
      const fullName = `${normalizedFirstName} ${normalizedLastName}`.replace(/\s+/g, ' ').trim();

      const { data: body, error: invokeError } = await supabase.functions.invoke(
        FUNCTIONS.REGISTER_USER,
        {
          body: {
            email: String(email).trim().toLowerCase(),
            password: String(password),
            first_name: normalizedFirstName,
            last_name: normalizedLastName,
            full_name: fullName,
            account_type: accountType,
            company_name: accountType === 'company' ? normalizedCompanyName : null,
            timezone: resolveDeviceTimeZone(),
            consent_offer: true,
            consent_privacy_policy: true,
            consent_personal_data: true,
            consent_cookies: true,
            consent_source: 'mobile_app',
            consent_documents: {
              offer_url: LEGAL_LINKS.offer,
              privacy_url: LEGAL_LINKS.privacy,
              personal_data_url: LEGAL_LINKS.personalData,
              cookies_url: LEGAL_LINKS.cookies,
            },
          },
        },
      );

      if (invokeError) {
        const msg = String(invokeError?.message || '');
        if (/EMAIL_TAKEN|already exists|email.*taken|user.*exists/i.test(msg)) {
          throw new Error(t('error_email_exists'));
        }
        if (/COMPANY_NAME_TAKEN|company.*already exists|duplicate/i.test(msg)) {
          throw new Error(t('errors_companyName_duplicate'));
        }
        throw invokeError;
      }

      const userId = body?.user_id;
      if (!userId) throw new Error(t('error_profile_not_updated'));

      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: String(email).trim().toLowerCase(),
        password: String(password),
      });

      if (loginErr) {
        showSuccessToast(t('register_success_please_login'));
        setTimeout(() => router.replace('/(auth)/login'), theme.timings.postRegisterNavDelayMs);
      } else {
        showSuccessToast(t('register_success'));
      }
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
    companyCheckStatus,
    accountType,
    companyName,
    router,
    t,
    showSuccessToast,
    showBanner,
    clearBanner,
    requiredMsg,
    scrollToFirstInvalid,
    theme.timings.postRegisterNavDelayMs,
  ]);

  const renderConsent = (checked, setChecked, prefix, linkText, url, showDivider = true) => (
    <>
      <View style={styles.consentRow}>
        <Checkbox value={checked} onValueChange={setChecked} />
        <View style={styles.consentTextWrap}>
          <Text style={styles.consentText}>
            {prefix}{' '}
            <Text style={styles.consentLink} onPress={() => openLegalLink(url)}>
              {linkText}
            </Text>
          </Text>
        </View>
      </View>
      {showDivider ? <View style={styles.consentDivider} /> : null}
    </>
  );

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
                ref={firstNameRef}
                label={t('label_first_name')}
                value={firstName}
                onChangeText={(val) => {
                  setFirstName(val);
                  clearFieldError('firstName');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, firstName: true }))}
                placeholder={t('placeholder_first_name')}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => lastNameRef.current?.focus()}
                editable={!submitting}
                required
                forceValidation={submittedAttempt}
                error={firstNameError ? 'invalid' : undefined}
                style={styles.field}
                {...sharedFieldProps}
              />
              <FieldErrorText message={firstNameError} style={styles.fieldWithErrorGap} />
              <TextField
                ref={lastNameRef}
                label={t('label_last_name')}
                value={lastName}
                onChangeText={(val) => {
                  setLastName(val);
                  clearFieldError('lastName');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, lastName: true }))}
                placeholder={t('placeholder_last_name')}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                editable={!submitting}
                required
                forceValidation={submittedAttempt}
                error={lastNameError ? 'invalid' : undefined}
                style={styles.field}
                {...sharedFieldProps}
              />
              <FieldErrorText message={lastNameError} style={styles.fieldWithErrorGap} />
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
                onSubmitEditing={() => companyNameRef.current?.focus()}
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
              <View style={styles.companyToggleRow}>
                <Checkbox
                  value={createCompanyProfile}
                  onValueChange={(nextValue) => {
                    setCreateCompanyProfile(nextValue);
                    if (!nextValue) {
                      setCompanyCheckStatus(null);
                      clearFieldError('companyName');
                    }
                  }}
                />
                <Text style={styles.companyToggleText}>
                  {t('register_create_company_profile')}
                </Text>
              </View>
              {createCompanyProfile ? (
              <TextField
                ref={companyNameRef}
                label={t('register_company_name')}
                value={companyName}
                onChangeText={(val) => {
                  setCompanyName(val);
                  clearFieldError('companyName');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, companyName: true }))}
                placeholder={t('register_company_name_placeholder')}
                autoCapitalize="words"
                returnKeyType="next"
                onSubmitEditing={() => pwdRef.current?.focus()}
                editable={!submitting}
                required
                forceValidation={submittedAttempt}
                error={companyNameError ? 'invalid' : undefined}
                style={styles.field}
                {...sharedFieldProps}
              />
              ) : null}
              {createCompanyProfile ? (
              <AvailabilityStatus
                status={companyCheckStatus}
                availableText={t('hint_available')}
                checkingText={t('hint_checking')}
                theme={theme}
                styles={styles}
              />
              ) : null}
              {createCompanyProfile ? (
              <FieldErrorText message={companyNameError} style={styles.fieldWithErrorGap} />
              ) : null}
              <TextField
                ref={pwdRef}
                label={t('register_label_password')}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (invalidCharWarning) setInvalidCharWarning(false);
                  clearFieldError('password');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                placeholder={t('register_placeholder_password')}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => confirmPwdRef.current?.focus()}
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
              <TextField
                ref={confirmPwdRef}
                label={t('label_password_repeat')}
                value={confirmPassword}
                onChangeText={(val) => {
                  setConfirmPassword(val);
                  clearFieldError('confirmPassword');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, confirmPassword: true }))}
                placeholder={t('placeholder_repeat_password')}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleRegister}
                editable={!submitting}
                required
                forceValidation={submittedAttempt}
                error={confirmPasswordError ? 'invalid' : undefined}
                filterInput={filterPasswordInput}
                maxLength={AUTH_CONSTRAINTS.PASSWORD.MAX_LENGTH}
                hideSeparator
                style={styles.field}
                {...sharedFieldProps}
              />
              <FieldErrorText message={confirmPasswordError} style={styles.fieldWithErrorGap} />
            </Card>
          </View>

          <View style={styles.consentPanel}>
            {renderConsent(
              consentOfferChecked,
              setConsentOfferChecked,
              t('register_consent_offer_prefix'),
              t('register_consent_offer_link'),
              LEGAL_LINKS.offer,
            )}
            {renderConsent(
              consentPrivacyChecked,
              setConsentPrivacyChecked,
              t('register_consent_privacy_prefix'),
              t('register_consent_privacy_link'),
              LEGAL_LINKS.privacy,
            )}
            {renderConsent(
              consentPersonalDataChecked,
              setConsentPersonalDataChecked,
              t('register_consent_personal_data_prefix'),
              t('register_consent_personal_data_link'),
              LEGAL_LINKS.personalData,
            )}
            {renderConsent(
              consentCookiesChecked,
              setConsentCookiesChecked,
              t('register_consent_cookies_prefix'),
              t('register_consent_cookies_link'),
              LEGAL_LINKS.cookies,
              false,
            )}
            {!allConsentsAccepted && submittedAttempt ? (
              <Text style={styles.consentErrorText}>{t('register_error_consent_required')}</Text>
            ) : null}
          </View>

          <Button
            title={t('register_button')}
            variant="primary"
            size="lg"
            onPress={handleRegister}
            loading={submitting}
            disabled={submitting || checkingAvailability}
            style={styles.submitButton}
          />

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
