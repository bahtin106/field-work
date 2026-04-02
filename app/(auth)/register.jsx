import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
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
import { useFormAutoScroll } from '../../src/shared/forms/useFormAutoScroll';
import {
  AUTH_CONSTRAINTS,
  filterPasswordInput,
  isValidEmail,
  isValidHumanName,
  normalizeHumanName,
  isValidPassword,
} from '../../lib/authValidation';
import { KeyboardAwareScrollView } from '../../lib/keyboardControllerCompat';
import { normalizeCompanyName, validateCompanyName } from '../../lib/companyName';
import { FUNCTIONS } from '../../lib/constants';
import { logClientError } from '../../lib/errorLogsClient';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

// no local color/date utils here — keep file free of literals

const createStyles = (theme, insets = {}) => {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1 },
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
    banner: {
      marginBottom: theme.spacing.sm,
    },
    passwordToggle: {
      padding: theme.spacing.xs,
    },
    submitButton: {
      marginTop: theme.spacing.lg,
    },
  });
};

const resolveDeviceTimeZone = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.trim() ? tz.trim() : 'UTC';
  } catch {
    return 'UTC';
  }
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
    (accountType === 'company' && companyCheckStatus === 'taken'
      ? t('errors_companyName_duplicate')
      :
    (shouldShowError('companyName') &&
    accountType === 'company' &&
    companyNameValidationMessage
      ? companyNameValidationMessage
      : null));

  // Availability check via edge function (avoids direct RLS access from client)
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
    const noAccountType = !accountType;
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
      noAccountType ||
      needsCompanyName ||
      !consentChecked
    ) {
      const nextFieldErrors = {};
      if (missingFirst) nextFieldErrors.firstName = { message: requiredMsg };
      if (missingLast) nextFieldErrors.lastName = { message: requiredMsg };
      if (invalidFirstName) nextFieldErrors.firstName = { message: requiredMsg };
      if (invalidLastName) nextFieldErrors.lastName = { message: requiredMsg };
      if (invalidEmail) nextFieldErrors.email = { message: getMessageByCode(FEEDBACK_CODES.INVALID_EMAIL, t) };
      if (emailTaken) nextFieldErrors.email = { message: getMessageByCode(FEEDBACK_CODES.EMAIL_TAKEN, t) };
      if (invalidPwd) nextFieldErrors.password = { message: getMessageByCode(FEEDBACK_CODES.PASSWORD_TOO_SHORT, t) };
      if (mismatchPwd) nextFieldErrors.confirmPassword = { message: getMessageByCode(FEEDBACK_CODES.PASSWORD_MISMATCH, t) };
      if (noAccountType) nextFieldErrors.accountType = { message: t('register_error_account_type') };
      if (needsCompanyName) nextFieldErrors.companyName = { message: companyNameValidationError };
      if (companyTaken) nextFieldErrors.companyName = { message: t('errors_companyName_duplicate') };
      if (Object.keys(nextFieldErrors).length) setFieldErrors(nextFieldErrors);
      if (!consentChecked) {
        showBanner({
          message: t('register_error_consent_required'),
          severity: 'warning',
        });
        // TODO: add inline consent error under checkbox when ConsentCheckbox supports it
      }
      scrollToFirstInvalid([
        { invalid: missingFirst, ref: firstNameRef },
        { invalid: missingLast, ref: lastNameRef },
        { invalid: invalidEmail || emailTaken, ref: emailRef },
        { invalid: needsCompanyName, ref: companyNameRef },
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
    consentChecked,
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

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      // Делаем как в new/edit: управляем нижним отступом сами через contentContainerStyle
      edges={['left', 'right']}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
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

            {/* Avatar - removed */}

            {banner ? (
              <ScreenBanner
                message={banner}
                onClose={clearBanner}
                style={styles.banner}
              />
            ) : null}

            {invalidCharWarning && (
              <ScreenBanner
                message={{ message: t('err_password_invalid_chars'), severity: 'warning' }}
                onClose={() => setInvalidCharWarning(false)}
                style={styles.banner}
              />
            )}

            {emailCheckStatus === 'checking' && emailValid && (
              <ScreenBanner
                message={{ message: t('warn_checking_email'), severity: 'info' }}
                onClose={() => setEmailCheckStatus(null)}
                style={styles.banner}
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
                        ref={companyNameRef}
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
                    style={styles.passwordToggle}
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
                ref={confirmPwdRef}
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
              style={styles.submitButton}
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
          </KeyboardAwareScrollView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}
