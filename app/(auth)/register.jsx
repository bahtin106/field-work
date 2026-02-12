import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import ConsentCheckbox from '../../components/ui/ConsentCheckbox';
import PrivacyPolicyModal from '../../components/ui/modals/PrivacyPolicyModal';
import RadioGroupField from '../../components/ui/RadioGroupField';
import SectionHeader from '../../components/ui/SectionHeader';
import TextField from '../../components/ui/TextField';
import { useFeedback, ScreenBanner, FieldErrorText, normalizeError, FEEDBACK_CODES, getMessageByCode } from '../../src/shared/feedback';
import {
  AUTH_CONSTRAINTS,
  filterPasswordInput,
  getPasswordValidationErrors,
  isValidEmail,
  isValidPassword,
} from '../../lib/authValidation';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

// no local color/date utils here — keep file free of literals

const createStyles = (theme, insets = {}) => {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      paddingHorizontal: theme.spacing.lg,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      // Убираем верхний паддинг полностью
      paddingTop: 0,
      paddingBottom: theme.components.scrollView.paddingBottom + insets.bottom,
    },
    title: {
      textAlign: 'center',
      color: theme.colors.text,
      fontSize: theme.typography.sizes.xxl,
      fontWeight: theme.typography.weight.bold,
      // Уменьшаем нижний отступ
      marginBottom: theme.spacing.sm,
    },
    section: {
      marginBottom: theme.spacing.sm,
    },
    field: {
      marginHorizontal: 0,
      marginVertical: theme.components?.input?.fieldSpacing ?? theme.spacing.sm,
    },
    firstField: { marginTop: theme.spacing.xs / 2 },
    separator: {
      height: 1,
      backgroundColor: theme.colors.border,
      marginVertical: theme.spacing.xs,
    },
    // legacy styles removed (radio group replaces old layout)
    errorText: {
      color: theme.colors.danger,
      textAlign: 'center',
      marginVertical: theme.spacing.sm,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    backButton: {
      marginTop: theme.spacing.sm,
    },
    backLink: {
      marginTop: theme.spacing.sm,
      alignSelf: 'center',
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
    },
    backLinkText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
  });
};

export default function RegisterScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { banner, showBanner, clearBanner, showSuccessToast } = useFeedback();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, insets), [theme, insets]);
  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Company state
  const [accountType, setAccountType] = useState(null); // 'solo' | 'company'
  const [companyName, setCompanyName] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  // Согласие с политикой
  const [consentChecked, setConsentChecked] = useState(false);
  const [emailCheckStatus, setEmailCheckStatus] = useState(null);
  const [invalidCharWarning, setInvalidCharWarning] = useState(false);
  const [policyVisible, setPolicyVisible] = useState(false);

  const emailCheckTimeoutRef = useRef(null);
  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const pwdRef = useRef(null);

  const emailValid = useMemo(() => isValidEmail(email), [email]);
  const passwordValid = useMemo(() => isValidPassword(password), [password]);
  const passwordsMatch = useMemo(
    () => !password || password === confirmPassword,
    [password, confirmPassword],
  );
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
  const firstNameError =
    fieldErrors.firstName?.message ||
    (shouldShowError('firstName') && !firstName.trim() ? requiredMsg : null);
  const lastNameError =
    fieldErrors.lastName?.message ||
    (shouldShowError('lastName') && !lastName.trim() ? requiredMsg : null);
  const emailError =
    fieldErrors.email?.message ||
    ((shouldShowError('email') || emailCheckStatus === 'taken') &&
    !email.trim()
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
  const accountTypeError =
    fieldErrors.accountType?.message ||
    (shouldShowError('accountType') && !accountType
      ? t('register_error_account_type')
      : null);
  const companyNameError =
    fieldErrors.companyName?.message ||
    (shouldShowError('companyName') &&
    accountType === 'company' &&
    !companyName.trim()
      ? t('register_error_company_name')
      : null);

  const initials = useMemo(
    () =>
      `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}`.toUpperCase(),
    [firstName, lastName],
  );

  // Email availability check
  const checkEmailAvailability = useCallback(async (emailToCheck) => {
    if (!emailToCheck || !isValidEmail(emailToCheck)) {
      setEmailCheckStatus(null);
      return;
    }

    try {
      setEmailCheckStatus('checking');

      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', emailToCheck.trim().toLowerCase())
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.warn('Email check error:', error);
        setEmailCheckStatus(null);
        return;
      }

      setEmailCheckStatus(data ? 'taken' : 'available');
    } catch (e) {
      console.warn('Email check failed:', e);
      setEmailCheckStatus(null);
    }
  }, []);

  // Debounced email check
  useEffect(() => {
    if (emailCheckTimeoutRef.current) {
      clearTimeout(emailCheckTimeoutRef.current);
    }

    if (!email || !emailValid) {
      setEmailCheckStatus(null);
      return;
    }

    emailCheckTimeoutRef.current = setTimeout(() => {
      checkEmailAvailability(email.trim().toLowerCase());
    }, theme.timings.emailDebounceMs);

    return () => {
      if (emailCheckTimeoutRef.current) {
        clearTimeout(emailCheckTimeoutRef.current);
      }
    };
  }, [email, emailValid, checkEmailAvailability]);

  const didClearBannerRef = useRef(false);
  useEffect(() => {
    if (didClearBannerRef.current) return;
    didClearBannerRef.current = true;
    clearBanner();
  }, [clearBanner]);

  const handleInvalidPasswordInput = useCallback(() => {
    setInvalidCharWarning(true);
    setTimeout(() => {
      setInvalidCharWarning(false);
    }, theme.timings.invalidInputWarningMs);
  }, []);

  const handleRegister = useCallback(async () => {
    if (submitting) return;
    Keyboard.dismiss();
    setSubmittedAttempt(true);
    clearBanner();
    setFieldErrors({});

    const missingFirst = !firstName.trim();
    const missingLast = !lastName.trim();
    const invalidEmail = !emailValid;
    const invalidPwd = !passwordValid;
    const mismatchPwd = !passwordsMatch;
    const emailTaken = emailCheckStatus === 'taken';
    const noAccountType = !accountType;
    const needsCompanyName = accountType === 'company' && !companyName.trim();

    if (
      emailTaken ||
      missingFirst ||
      missingLast ||
      invalidEmail ||
      invalidPwd ||
      mismatchPwd ||
      noAccountType ||
      needsCompanyName ||
      !consentChecked
    ) {
      const nextFieldErrors = {};
      if (missingFirst) nextFieldErrors.firstName = { message: requiredMsg };
      if (missingLast) nextFieldErrors.lastName = { message: requiredMsg };
      if (invalidEmail) nextFieldErrors.email = { message: getMessageByCode(FEEDBACK_CODES.INVALID_EMAIL, t) };
      if (emailTaken) nextFieldErrors.email = { message: getMessageByCode(FEEDBACK_CODES.EMAIL_TAKEN, t) };
      if (invalidPwd) nextFieldErrors.password = { message: getMessageByCode(FEEDBACK_CODES.PASSWORD_TOO_SHORT, t) };
      if (mismatchPwd) nextFieldErrors.confirmPassword = { message: getMessageByCode(FEEDBACK_CODES.PASSWORD_MISMATCH, t) };
      if (noAccountType) nextFieldErrors.accountType = { message: t('register_error_account_type') };
      if (needsCompanyName) nextFieldErrors.companyName = { message: t('register_error_company_name') };
      if (Object.keys(nextFieldErrors).length) setFieldErrors(nextFieldErrors);
      if (!consentChecked) {
        showBanner({
          message: t('register_error_consent_required'),
          severity: 'warning',
        });
        // TODO: add inline consent error under checkbox when ConsentCheckbox supports it
      }
      if (missingFirst) {
        firstNameRef.current?.focus?.();
      } else if (missingLast) {
        lastNameRef.current?.focus?.();
      } else if (invalidEmail || emailTaken) {
        emailRef.current?.focus?.();
      } else if (invalidPwd) {
        pwdRef.current?.focus?.();
      }
      return;
    }

    clearBanner();
    setSubmitting(true);

    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();

      // Call register edge function
      const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/register_user`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: String(email).trim().toLowerCase(),
          password: String(password),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          full_name: fullName,
          account_type: accountType,
          company_name: accountType === 'company' ? companyName.trim() : null,
        }),
      });

      const raw = await resp.text();
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!resp.ok) {
        const msg =
          (body && (body.message || body.error || body.details || body.hint)) ||
          raw ||
          `HTTP ${resp.status}`;

        if (/already exists|email.*taken|user.*exists/i.test(String(msg))) {
          throw new Error(t('error_email_exists'));
        }
        throw new Error(msg);
      }

      const userId = body?.user_id;
      if (!userId) throw new Error(t('error_profile_not_updated'));

      // Auto login
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: String(email).trim().toLowerCase(),
        password: String(password),
      });

      if (loginErr) {
        showSuccessToast(t('register_success_please_login'));
        setTimeout(() => router.replace('/(auth)/login'), theme.timings.postRegisterNavDelayMs);
      } else {
        showSuccessToast(t('register_success'));
        // Navigation will happen automatically via _layout
      }
    } catch (e) {
      const normalized = normalizeError(e, { t, fieldMap: { email: 'email' } });
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
    confirmPassword,
    passwordsMatch,
    emailValid,
    passwordValid,
    emailCheckStatus,
    accountType,
    companyName,
    router,
    t,
    showSuccessToast,
    showBanner,
    clearBanner,
    requiredMsg,
  ]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      // Делаем как в new/edit: управляем нижним отступом сами через contentContainerStyle
      edges={['left', 'right']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>{t('register_title')}</Text>

            {/* Avatar - removed */}

            {banner ? (
              <ScreenBanner
                message={banner}
                onClose={clearBanner}
                style={{ marginBottom: theme.spacing.sm }}
              />
            ) : null}

            {invalidCharWarning && (
              <ScreenBanner
                message={{ message: t('err_password_invalid_chars'), severity: 'warning' }}
                onClose={() => setInvalidCharWarning(false)}
                style={{ marginBottom: theme.spacing.sm }}
              />
            )}

            {emailCheckStatus === 'checking' && emailValid && (
              <ScreenBanner
                message={{ message: t('warn_checking_email'), severity: 'info' }}
                onClose={() => setEmailCheckStatus(null)}
                style={{ marginBottom: theme.spacing.sm }}
              />
            )}

            {/* Personal info */}
            <SectionHeader bottomSpacing="xs">{t('section_personal')}</SectionHeader>
            <Card paddedXOnly>
              <TextField
                ref={firstNameRef}
                label={t('label_first_name')}
                placeholder={t('placeholder_first_name')}
                style={styles.field}
                value={firstName}
                onChangeText={(val) => {
                  setFirstName(val);
                  clearFieldError('firstName');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, firstName: true }))}
                forceValidation={submittedAttempt}
                error={firstNameError ? 'invalid' : undefined}
                editable={!submitting}
              />
              <FieldErrorText message={firstNameError} />
              <TextField
                ref={lastNameRef}
                label={t('label_last_name')}
                placeholder={t('placeholder_last_name')}
                style={styles.field}
                value={lastName}
                onChangeText={(val) => {
                  setLastName(val);
                  clearFieldError('lastName');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, lastName: true }))}
                forceValidation={submittedAttempt}
                error={lastNameError ? 'invalid' : undefined}
                editable={!submitting}
              />
              <FieldErrorText message={lastNameError} />
              <TextField
                ref={emailRef}
                label={t('label_email')}
                placeholder={t('placeholder_email')}
                style={styles.field}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={(val) => {
                  setEmail(val);
                  clearFieldError('email');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                forceValidation={submittedAttempt}
                error={emailError ? 'invalid' : undefined}
                editable={!submitting}
              />
              <FieldErrorText message={emailError} />
            </Card>

            {/* Account type */}
            <SectionHeader bottomSpacing="xs">{t('register_section_account_type')}</SectionHeader>
            <Card paddedXOnly>
              <RadioGroupField
                value={accountType}
                onChange={(val) => {
                  setAccountType(val);
                  clearFieldError('accountType');
                }}
                disabled={submitting}
                options={[
                  {
                    id: 'solo',
                    title: t('register_account_solo'),
                    subtitle: t('register_account_solo_desc'),
                  },
                  {
                    id: 'company',
                    title: t('register_account_company'),
                    subtitle: t('register_account_company_desc'),
                  },
                ]}
                renderExpanded={(id) =>
                  id === 'company' ? (
                    <>
                      <TextField
                        label={t('register_company_name')}
                        placeholder={t('register_company_name_placeholder')}
                        style={styles.field}
                        value={companyName}
                        onChangeText={(val) => {
                          setCompanyName(val);
                          clearFieldError('companyName');
                        }}
                        onBlur={() => setTouched((prev) => ({ ...prev, companyName: true }))}
                        forceValidation={submittedAttempt}
                        error={companyNameError ? 'invalid' : undefined}
                        editable={!submitting}
                      />
                      <FieldErrorText message={companyNameError} />
                    </>
                  ) : null
                }
              />
              <FieldErrorText message={accountTypeError} />
            </Card>

            {/* Company name handled inside RadioGroupField when 'company' selected */}

            {/* Password */}
            <SectionHeader bottomSpacing="xs">
              {t('section_password_template').replace(
                '{n}',
                String(AUTH_CONSTRAINTS.PASSWORD.MIN_LENGTH),
              )}
            </SectionHeader>
            <Card paddedXOnly>
              <TextField
                ref={pwdRef}
                label={t('register_label_password')}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  clearFieldError('password');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                placeholder={t('register_placeholder_password')}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.field}
                forceValidation={submittedAttempt}
                error={passwordError ? 'invalid' : undefined}
                filterInput={filterPasswordInput}
                onInvalidInput={handleInvalidPasswordInput}
                maxLength={AUTH_CONSTRAINTS.PASSWORD.MAX_LENGTH}
                rightSlot={
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    accessibilityLabel={
                      showPassword ? t('a11y_hide_password') : t('a11y_show_password')
                    }
                    accessibilityRole="button"
                    style={{ padding: theme.spacing.xs }}
                    disabled={submitting}
                  >
                    <Feather
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={theme.components?.listItem?.chevronSize}
                      color={theme.colors.primary}
                    />
                  </Pressable>
                }
                editable={!submitting}
              />
              <FieldErrorText message={passwordError} />

              <TextField
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
                style={styles.field}
                forceValidation={submittedAttempt}
                error={confirmPasswordError ? 'invalid' : undefined}
                filterInput={filterPasswordInput}
                maxLength={AUTH_CONSTRAINTS.PASSWORD.MAX_LENGTH}
                editable={!submitting}
              />
              <FieldErrorText message={confirmPasswordError} />
            </Card>

            <ConsentCheckbox
              checked={consentChecked}
              onChange={setConsentChecked}
              onShowPolicy={() => setPolicyVisible(true)}
            />
            {/* Actions */}
            <Button
              title={t('register_button')}
              variant="primary"
              size="lg"
              onPress={handleRegister}
              disabled={submitting}
              loading={submitting}
              style={{ marginTop: theme.spacing.lg }}
            />
            <Pressable
              onPress={() => router.back()}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={t('register_back_to_login')}
              style={styles.backLink}
            >
              <Text style={styles.backLinkText}>{t('register_back_to_login')}</Text>
            </Pressable>
            <PrivacyPolicyModal visible={policyVisible} onClose={() => setPolicyVisible(false)} />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
