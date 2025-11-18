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
import RadioGroupField from '../../components/ui/RadioGroupField';
import SectionHeader from '../../components/ui/SectionHeader';
import TextField from '../../components/ui/TextField';
import { useToast } from '../../components/ui/ToastProvider';
import ValidationAlert from '../../components/ui/ValidationAlert';
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
  const { success: toastSuccess, error: toastError } = useToast();
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
  const [error, setError] = useState('');
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [emailCheckStatus, setEmailCheckStatus] = useState(null);
  const [invalidCharWarning, setInvalidCharWarning] = useState(false);

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

  // Validation
  useEffect(() => {
    const errors = [];

    if (submittedAttempt) {
      if (!firstName.trim()) errors.push(t('err_first_name'));
      if (!lastName.trim()) errors.push(t('err_last_name'));
      if (!email.trim()) errors.push(t('err_email'));
      if (!password.trim()) errors.push(t('err_password_short'));
      if (!confirmPassword.trim()) errors.push(t('err_password_mismatch'));
      if (!accountType) errors.push(t('register_error_account_type'));
      if (accountType === 'company' && !companyName.trim())
        errors.push(t('register_error_company_name'));
    }

    if (email.trim() && !emailValid) {
      errors.push(t('err_email_invalid_format'));
    }

    if (emailCheckStatus === 'taken') {
      errors.push(t('warn_email_already_taken'));
    }

    if (password.length > 0) {
      const pwdValidation = getPasswordValidationErrors(password);
      if (!pwdValidation.valid) {
        if (pwdValidation.errors.includes('password_too_short')) {
          errors.push(t('err_password_short'));
        }
        if (pwdValidation.errors.includes('password_invalid_chars')) {
          errors.push(t('err_password_invalid_chars'));
        }
      }
    }

    if (password.length > 0 && confirmPassword.length > 0 && !passwordsMatch) {
      errors.push(t('err_password_mismatch'));
    }

    setValidationErrors(errors);
  }, [
    firstName,
    lastName,
    email,
    emailValid,
    password,
    confirmPassword,
    passwordsMatch,
    accountType,
    companyName,
    submittedAttempt,
    emailCheckStatus,
    t,
  ]);

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
      needsCompanyName
    ) {
      if (emailTaken) toastError(t('error_email_exists'));
      return;
    }

    setError('');
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
        toastSuccess(t('register_success_please_login'));
        setTimeout(() => router.replace('/(auth)/login'), theme.timings.postRegisterNavDelayMs);
      } else {
        toastSuccess(t('register_success'));
        // Navigation will happen automatically via _layout
      }
    } catch (e) {
      const msg = e?.message ? String(e.message) : t('toast_generic_error');
      setError(msg);
      toastError(msg);
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
    toastSuccess,
    toastError,
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

            {/* Errors */}
            {error ? (
              <ValidationAlert
                messages={[error]}
                type="error"
                style={{ marginBottom: theme.spacing.sm }}
              />
            ) : null}

            {validationErrors.length > 0 && (
              <ValidationAlert
                messages={validationErrors}
                type="error"
                style={{ marginBottom: theme.spacing.sm }}
              />
            )}

            {invalidCharWarning && (
              <ValidationAlert
                messages={[t('err_password_invalid_chars')]}
                type="warning"
                style={{ marginBottom: theme.spacing.sm }}
              />
            )}

            {emailCheckStatus === 'checking' && emailValid && (
              <ValidationAlert
                messages={[t('warn_checking_email')]}
                type="info"
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
                onChangeText={setFirstName}
                forceValidation={submittedAttempt}
                error={submittedAttempt && !firstName.trim() ? 'required' : undefined}
                editable={!submitting}
              />
              <TextField
                ref={lastNameRef}
                label={t('label_last_name')}
                placeholder={t('placeholder_last_name')}
                style={styles.field}
                value={lastName}
                onChangeText={setLastName}
                forceValidation={submittedAttempt}
                error={submittedAttempt && !lastName.trim() ? 'required' : undefined}
                editable={!submitting}
              />
              <TextField
                ref={emailRef}
                label={t('label_email')}
                placeholder={t('placeholder_email')}
                style={styles.field}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                forceValidation={submittedAttempt}
                error={
                  submittedAttempt && !email.trim()
                    ? 'required'
                    : email.trim() && !emailValid
                      ? 'invalid'
                      : emailCheckStatus === 'taken'
                        ? 'taken'
                        : undefined
                }
                editable={!submitting}
              />
            </Card>

            {/* Account type */}
            <SectionHeader bottomSpacing="xs">{t('register_section_account_type')}</SectionHeader>
            <Card paddedXOnly>
              <RadioGroupField
                value={accountType}
                onChange={setAccountType}
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
                    <TextField
                      label={t('register_company_name')}
                      placeholder={t('register_company_name_placeholder')}
                      style={styles.field}
                      value={companyName}
                      onChangeText={setCompanyName}
                      forceValidation={submittedAttempt}
                      error={
                        submittedAttempt && accountType === 'company' && !companyName.trim()
                          ? 'required'
                          : undefined
                      }
                      editable={!submitting}
                    />
                  ) : null
                }
              />
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
                onChangeText={setPassword}
                placeholder={t('register_placeholder_password')}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.field}
                forceValidation={submittedAttempt}
                error={
                  submittedAttempt && !password.trim()
                    ? 'required'
                    : password.length > 0 && !passwordValid
                      ? 'invalid'
                      : undefined
                }
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

              <TextField
                label={t('label_password_repeat')}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder={t('placeholder_repeat_password')}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.field}
                forceValidation={submittedAttempt}
                error={
                  submittedAttempt && !confirmPassword.trim()
                    ? 'required'
                    : confirmPassword.length > 0 && !passwordsMatch
                      ? 'mismatch'
                      : undefined
                }
                filterInput={filterPasswordInput}
                maxLength={AUTH_CONSTRAINTS.PASSWORD.MAX_LENGTH}
                editable={!submitting}
              />
            </Card>

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
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
