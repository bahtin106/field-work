import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import PhoneInput from '../../components/ui/PhoneInput';
import TextField from '../../components/ui/TextField';
import { useToast } from '../../components/ui/ToastProvider';
import ValidationAlert from '../../components/ui/ValidationAlert';
import { DateTimeModal, SelectModal } from '../../components/ui/modals';
import {
  AUTH_CONSTRAINTS,
  filterPasswordInput,
  getPasswordValidationErrors,
  isValidEmail,
  isValidPassword,
} from '../../lib/authValidation';
import { AVATAR, STORAGE } from '../../lib/constants';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

function formatDateRU(date, withYear = true) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const months = [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря',
    ];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();
    return withYear ? `${day} ${month} ${year}` : `${day} ${month}`;
  } catch {
    return '';
  }
}

const createStyles = (theme) => {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      paddingHorizontal: theme.spacing.xl,
    },
    content: {
      paddingVertical: theme.spacing.xl,
      gap: theme.spacing.md,
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
      marginBottom: theme.spacing.lg,
    },
    avatarContainer: {
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    avatar: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: withAlpha(theme.colors.primary, 0.12),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: withAlpha(theme.colors.primary, 0.24),
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarCamBadge: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radii.md,
      padding: theme.spacing.xs,
      borderWidth: 2,
      borderColor: theme.colors.background,
    },
    avatarText: {
      color: theme.colors.primary,
      fontWeight: '700',
      fontSize: theme.typography.sizes.xxl,
    },
    section: {
      marginBottom: theme.spacing.sm,
    },
    sectionTitle: {
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.textSecondary,
      textTransform: 'uppercase',
      marginBottom: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    field: { marginVertical: theme.spacing.xs },
    separator: {
      height: 1,
      backgroundColor: theme.colors.border,
      marginVertical: theme.spacing.xs,
    },
    companyTypeContainer: {
      gap: theme.spacing.sm,
    },
    companyTypeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: theme.spacing.md,
      borderRadius: theme.radii.md,
      borderWidth: 2,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    companyTypeButtonActive: {
      borderColor: theme.colors.primary,
      backgroundColor: withAlpha(theme.colors.primary, 0.08),
    },
    companyTypeContent: {
      flex: 1,
      marginLeft: theme.spacing.sm,
    },
    companyTypeTitle: {
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs / 2,
    },
    companyTypeDesc: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textSecondary,
    },
    checkCircle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkCircleActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    errorText: {
      color: theme.colors.danger,
      textAlign: 'center',
      marginVertical: theme.spacing.sm,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    backButton: {
      marginTop: theme.spacing.md,
    },
  });
};

export default function RegisterScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [withYear, setWithYear] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Company state
  const [accountType, setAccountType] = useState(null); // 'solo' | 'company'
  const [companyName, setCompanyName] = useState('');

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarSheet, setAvatarSheet] = useState(false);

  // UI state
  const [dobModalVisible, setDobModalVisible] = useState(false);
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
  const phoneRef = useRef(null);

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
    }, 800);

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
    }, 3000);
  }, []);

  const ensureCameraPerms = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    return status === 'granted';
  };

  const ensureLibraryPerms = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === 'granted';
  };

  const pickFromCamera = async () => {
    const ok = await ensureCameraPerms();
    if (!ok) {
      setError(t('error_camera_denied'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUrl(res.assets[0].uri);
  };

  const pickFromLibrary = async () => {
    const ok = await ensureLibraryPerms();
    if (!ok) {
      setError(t('error_library_denied'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      selectionLimit: 1,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUrl(res.assets[0].uri);
  };

  const uploadAvatar = async (userId, uri) => {
    try {
      const resp = await fetch(uri);
      const ab = await resp.arrayBuffer();
      const fileData = new Uint8Array(ab);
      const filename = `${AVATAR.FILENAME_PREFIX}${Date.now()}.jpg`;
      const path = `${STORAGE.AVATAR_PREFIX}/${userId}/${filename}`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE.AVATARS)
        .upload(path, fileData, { contentType: AVATAR.MIME, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(STORAGE.AVATARS).getPublicUrl(path);
      const publicUrl = pub?.publicUrl || null;
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);
      if (updErr) throw updErr;
      return publicUrl;
    } catch (e) {
      console.error('Avatar upload error:', e);
      return null;
    }
  };

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
      const phoneNormalized = String(phone || '').replace(/\D/g, '') || null;

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
          phone: phoneNormalized,
          birthdate:
            birthdate instanceof Date ? new Date(birthdate).toISOString().slice(0, 10) : null,
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

      // Upload avatar if chosen
      if (avatarUrl && avatarUrl.startsWith('file')) {
        await uploadAvatar(userId, avatarUrl);
      }

      // Auto login
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: String(email).trim().toLowerCase(),
        password: String(password),
      });

      if (loginErr) {
        toastSuccess(t('register_success_please_login'));
        setTimeout(() => router.replace('/(auth)/login'), 1000);
      } else {
        toastSuccess(t('register_success'));
        // Navigation will happen automatically via _layout
      }
    } catch (e) {
      const msg = String(e?.message || t('toast_generic_error'));
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
    phone,
    birthdate,
    avatarUrl,
    router,
    t,
    toastSuccess,
    toastError,
  ]);

  return (
    <Screen background="background">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>{t('register_title')}</Text>
            <Text style={styles.subtitle}>{t('register_subtitle')}</Text>

            {/* Avatar */}
            <View style={styles.avatarContainer}>
              <Pressable
                style={styles.avatar}
                onPress={() => setAvatarSheet(true)}
                accessibilityRole="button"
                accessibilityLabel={t('a11y_change_avatar')}
              >
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
                ) : (
                  <Text style={styles.avatarText}>{initials || '•'}</Text>
                )}
                <View style={styles.avatarCamBadge}>
                  <Feather
                    name="camera"
                    size={16}
                    color={theme.colors.onPrimary || theme.colors.primaryTextOn}
                  />
                </View>
              </Pressable>
            </View>

            {/* Errors */}
            {error ? (
              <ValidationAlert messages={[error]} type="error" style={{ marginBottom: 12 }} />
            ) : null}

            {validationErrors.length > 0 && (
              <ValidationAlert
                messages={validationErrors}
                type="error"
                style={{ marginBottom: 12 }}
              />
            )}

            {invalidCharWarning && (
              <ValidationAlert
                messages={[t('err_password_invalid_chars')]}
                type="warning"
                style={{ marginBottom: 12 }}
              />
            )}

            {emailCheckStatus === 'checking' && emailValid && (
              <ValidationAlert
                messages={[t('warn_checking_email')]}
                type="info"
                style={{ marginBottom: 12 }}
              />
            )}

            {/* Personal info */}
            <Text style={styles.sectionTitle}>{t('section_personal')}</Text>
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
              <PhoneInput
                ref={phoneRef}
                value={phone}
                onChangeText={setPhone}
                style={styles.field}
                editable={!submitting}
              />
              <TextField
                label={t('label_birthdate')}
                value={
                  birthdate
                    ? String(formatDateRU(birthdate, withYear))
                    : String(t('placeholder_birthdate'))
                }
                style={styles.field}
                pressable
                onPress={() => !submitting && setDobModalVisible(true)}
                editable={!submitting}
              />
            </Card>

            {/* Account type */}
            <Text style={styles.sectionTitle}>{t('register_section_account_type')}</Text>
            <View style={styles.companyTypeContainer}>
              <Pressable
                style={[
                  styles.companyTypeButton,
                  accountType === 'solo' && styles.companyTypeButtonActive,
                ]}
                onPress={() => !submitting && setAccountType('solo')}
                disabled={submitting}
              >
                <View
                  style={[styles.checkCircle, accountType === 'solo' && styles.checkCircleActive]}
                >
                  {accountType === 'solo' && (
                    <Feather name="check" size={16} color={theme.colors.onPrimary} />
                  )}
                </View>
                <View style={styles.companyTypeContent}>
                  <Text style={styles.companyTypeTitle}>{t('register_account_solo')}</Text>
                  <Text style={styles.companyTypeDesc}>{t('register_account_solo_desc')}</Text>
                </View>
              </Pressable>

              <Pressable
                style={[
                  styles.companyTypeButton,
                  accountType === 'company' && styles.companyTypeButtonActive,
                ]}
                onPress={() => !submitting && setAccountType('company')}
                disabled={submitting}
              >
                <View
                  style={[
                    styles.checkCircle,
                    accountType === 'company' && styles.checkCircleActive,
                  ]}
                >
                  {accountType === 'company' && (
                    <Feather name="check" size={16} color={theme.colors.onPrimary} />
                  )}
                </View>
                <View style={styles.companyTypeContent}>
                  <Text style={styles.companyTypeTitle}>{t('register_account_company')}</Text>
                  <Text style={styles.companyTypeDesc}>{t('register_account_company_desc')}</Text>
                </View>
              </Pressable>
            </View>

            {/* Company name if needed */}
            {accountType === 'company' && (
              <Card paddedXOnly style={{ marginTop: theme.spacing.md }}>
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
              </Card>
            )}

            {/* Password */}
            <Text style={styles.sectionTitle}>{t('section_password')}</Text>
            <Card paddedXOnly>
              <TextField
                ref={pwdRef}
                label={t('label_password_new')}
                value={password}
                onChangeText={setPassword}
                placeholder={t('placeholder_new_password')}
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
                      size={theme.icons?.md ?? 22}
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

            <Button
              title={t('register_back_to_login')}
              variant="secondary"
              size="lg"
              onPress={() => router.back()}
              disabled={submitting}
              style={styles.backButton}
            />

            {/* Modals */}
            <SelectModal
              visible={avatarSheet}
              onClose={() => setAvatarSheet(false)}
              title={t('profile_photo_title')}
              items={[
                {
                  id: 'camera',
                  label: t('profile_photo_take'),
                  onPress: () => {
                    setAvatarSheet(false);
                    pickFromCamera();
                  },
                },
                {
                  id: 'gallery',
                  label: t('profile_photo_choose'),
                  onPress: () => {
                    setAvatarSheet(false);
                    pickFromLibrary();
                  },
                },
                ...(avatarUrl
                  ? [
                      {
                        id: 'remove',
                        label: t('profile_photo_delete'),
                        onPress: () => {
                          setAvatarSheet(false);
                          setAvatarUrl(null);
                        },
                      },
                    ]
                  : []),
              ]}
              searchable={false}
            />

            <DateTimeModal
              visible={dobModalVisible}
              onClose={() => setDobModalVisible(false)}
              mode="date"
              allowOmitYear={true}
              omitYearDefault={withYear}
              initial={birthdate || new Date()}
              onApply={(dateObj, extra) => {
                try {
                  const d = new Date(dateObj);
                  setBirthdate(d);
                  if (extra && typeof extra.withYear === 'boolean') setWithYear(extra.withYear);
                } finally {
                  setDobModalVisible(false);
                }
              }}
            />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Screen>
  );
}
