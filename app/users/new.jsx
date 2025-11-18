import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Theme / layout / UI
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppHeader from '../../components/navigation/AppHeader';
import Card from '../../components/ui/Card';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { ConfirmModal, DateTimeModal, SelectModal } from '../../components/ui/modals';
import PhoneInput from '../../components/ui/PhoneInput';
import SectionHeader from '../../components/ui/SectionHeader';
import TextField from '../../components/ui/TextField';
import { useToast } from '../../components/ui/ToastProvider';
import ValidationAlert from '../../components/ui/ValidationAlert';
import { useTheme } from '../../theme';

// i18n
import { useI18nVersion } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';

// data / constants
import { ROLE, ROLE_LABELS, EDITABLE_ROLES as ROLES } from '../../constants/roles';
import {
  AUTH_CONSTRAINTS,
  filterPasswordInput,
  getPasswordValidationErrors,
  isValidEmail as isValidEmailShared,
  isValidPassword,
} from '../../lib/authValidation';
import { FUNCTIONS as APP_FUNCTIONS, AVATAR, STORAGE, TBL } from '../../lib/constants';
import { supabase } from '../../lib/supabase';
import { getDict, t as T } from '../../src/i18n';

// --- locals / env-driven ---
const TABLES = {
  profiles: TBL.PROFILES || 'profiles',
  departments: TBL.DEPARTMENTS || 'departments',
};

const __IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const __pick = (val, devFallback) => (val != null ? val : __IS_PROD ? null : devFallback);

const AVA_PREFIX = AVATAR.FILENAME_PREFIX;
const AVA_MIME = AVATAR.MIME;

const FN_CREATE_USER =
  process.env.EXPO_PUBLIC_FN_CREATE_USER || (APP_FUNCTIONS.CREATE_USER ?? 'create_user');

let ROLE_LABELS_LOCAL = ROLE_LABELS;
try {
  const fromEnv = process.env.EXPO_PUBLIC_ROLE_LABELS_JSON;
  if (fromEnv) ROLE_LABELS_LOCAL = { ...ROLE_LABELS_LOCAL, ...JSON.parse(fromEnv) };
} catch {}

// --- helpers ---
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
    const dict = getDict?.() || {};
    const offset = Number(dict.month_label_offset ?? 0) || 0;
    const m = d.getMonth();
    const idx = (m + offset + 12) % 12;
    const month = T(`months_genitive_${idx}`);
    const day = d.getDate();
    const year = d.getFullYear();
    return withYear ? `${day} ${month} ${year}` : `${day} ${month}`;
  } catch {
    return '';
  }
}

export default function NewUserScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const ver = useI18nVersion();
  const router = useRouter();
  const navigation = useNavigation();
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const base = useMemo(() => listItemStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  // state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [headerName, setHeaderName] = useState(t('placeholder_no_name'));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(ROLE.WORKER);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  const [phone, setPhone] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [withYear, setWithYear] = useState(true);
  const [dobModalVisible, setDobModalVisible] = useState(false);

  const [departmentId, setDepartmentId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [deptModalVisible, setDeptModalVisible] = useState(false);
  const activeDeptName = useMemo(() => {
    const d = (departments || []).find((x) => String(x.id) === String(departmentId));
    return d ? d.name : null;
  }, [departments, departmentId]);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarSheet, setAvatarSheet] = useState(false);

  const [showRoles, setShowRoles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [cancelVisible, setCancelVisible] = useState(false);
  const [submittedAttempt, setSubmittedAttempt] = useState(false);

  // Validation states
  const [validationErrors, setValidationErrors] = useState([]);
  const [emailCheckStatus, setEmailCheckStatus] = useState(null); // null | 'checking' | 'available' | 'taken'
  const [invalidCharWarning, setInvalidCharWarning] = useState(false);

  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const pwdRef = useRef(null);
  const phoneRef = useRef(null);
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const allowLeaveRef = useRef(false);
  const emailCheckTimeoutRef = useRef(null);

  const MEDIA_ASPECT = Array.isArray(theme.media?.aspect) ? theme.media.aspect : [1, 1];
  const MEDIA_QUALITY = typeof theme.media?.quality === 'number' ? theme.media.quality : 0.85;
  const ICON_MD = theme.icons?.md ?? 22;
  const ICON_SM = theme.icons?.sm ?? 18;
  const ICONBUTTON_TOUCH = theme.components?.iconButton?.size ?? 32;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.colors.background },
        scroll: { paddingHorizontal: theme.spacing?.lg ?? 16, flexGrow: 1 },
        headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
        headerCard: { padding: theme.spacing.sm, marginBottom: theme.spacing.md },
        avatar: {
          width: theme.components?.avatar?.md ?? 96,
          height: theme.components?.avatar?.md ?? 96,
          borderRadius: (theme.components?.avatar?.md ?? 96) / 2,
          backgroundColor: withAlpha(theme.colors.primary, 0.12),
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: theme.components.card.borderWidth,
          borderColor: withAlpha(theme.colors.primary, 0.24),
          overflow: 'hidden',
        },
        avatarImg: { width: '100%', height: '100%' },
        avatarCamBadge: {
          position: 'absolute',
          right: -(theme.components?.avatar?.badgeOffset ?? 2),
          bottom: -(theme.components?.avatar?.badgeOffset ?? 2),
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.xs,
          paddingVertical: theme.spacing.xs,
          borderWidth: theme.components?.avatar?.border ?? theme.components.card.borderWidth,
          borderColor: theme.colors.surface,
        },
        avatarText: { color: theme.colors.primary, fontWeight: '700' },
        nameTitle: {
          fontSize: theme.typography.sizes.md,
          fontWeight: '600',
          color: theme.colors.text,
        },
        field: { marginHorizontal: 0, marginVertical: theme.spacing.sm },
        actionBar: {
          flexDirection: 'row',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg + theme.spacing[theme.components?.card?.padX ?? 'lg'],
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
        },
        actionBtn: { alignSelf: 'stretch' },
      }),
    [theme],
  );

  const MIN_PASSWORD_LENGTH = useMemo(() => {
    const envVal = Number(process.env.EXPO_PUBLIC_PASSWORD_MIN_LENGTH || 0) || 0;
    const sharedMin = Number(AUTH_CONSTRAINTS?.PASSWORD?.MIN_LENGTH || 0) || 0;
    return Math.max(sharedMin, envVal || 6);
  }, []);

  const emailValid = useMemo(() => isValidEmailShared(email), [email]);
  const passwordValid = useMemo(() => isValidPassword(password), [password]);
  const passwordsMatch = useMemo(
    () => !password || password === confirmPassword,
    [password, confirmPassword],
  );

  // Проверка email на существование (debounced)
  const checkEmailAvailability = useCallback(
    async (emailToCheck) => {
      if (!emailToCheck || !isValidEmailShared(emailToCheck)) {
        setEmailCheckStatus(null);
        return;
      }

      try {
        setEmailCheckStatus('checking');

        const { data, error } = await supabase
          .from(TABLES.profiles)
          .select('id')
          .eq('email', emailToCheck.trim().toLowerCase())
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') {
          // PGRST116 = no rows returned (email available)
          console.warn('Email check error:', error);
          setEmailCheckStatus(null);
          return;
        }

        setEmailCheckStatus(data ? 'taken' : 'available');
      } catch (e) {
        console.warn('Email check failed:', e);
        setEmailCheckStatus(null);
      }
    },
    [TABLES.profiles],
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

    // Задержка 800ms перед проверкой
    emailCheckTimeoutRef.current = setTimeout(() => {
      checkEmailAvailability(email.trim().toLowerCase());
    }, 800);

    return () => {
      if (emailCheckTimeoutRef.current) {
        clearTimeout(emailCheckTimeoutRef.current);
      }
    };
  }, [email, emailValid, checkEmailAvailability]);

  // Сбор всех ошибок валидации для отображения
  useEffect(() => {
    const errors = [];
    const requiredFieldsMissing = [];

    // Проверяем обязательные поля (помеченные звездочкой)
    if (submittedAttempt) {
      if (!firstName.trim()) requiredFieldsMissing.push('firstName');
      if (!lastName.trim()) requiredFieldsMissing.push('lastName');
      if (!email.trim()) requiredFieldsMissing.push('email');
      if (!password.trim()) requiredFieldsMissing.push('password');
      if (!confirmPassword.trim()) requiredFieldsMissing.push('confirmPassword');
    }

    // Если есть незаполненные обязательные поля - показываем общее сообщение
    if (requiredFieldsMissing.length > 0) {
      errors.push(t('err_required_fields'));
    }

    // Проверяем специфичные ошибки валидации (формат, соответствие и т.д.)

    // Email: если заполнен, но неверный формат
    if (email.trim() && !emailValid) {
      errors.push(t('err_email_invalid_format'));
    }

    // Email: если уже занят
    if (emailCheckStatus === 'taken') {
      errors.push(t('warn_email_already_taken'));
    }

    // Пароль: если заполнен, но не соответствует требованиям
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

    // Пароли не совпадают (если оба заполнены)
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
    submittedAttempt,
    emailCheckStatus,
    t,
  ]);

  // Обработчик недопустимых символов в пароле
  const handleInvalidPasswordInput = useCallback(() => {
    setInvalidCharWarning(true);

    // Автоскрытие предупреждения через 3 секунды
    setTimeout(() => {
      setInvalidCharWarning(false);
    }, 3000);
  }, []);

  const initials = useMemo(
    () =>
      `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}`.toUpperCase(),
    [firstName, lastName],
  );

  const initialSnapRef = useRef('');
  useEffect(() => {
    initialSnapRef.current = JSON.stringify({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      role: ROLE.WORKER,
      password: false,
      birthdate: null,
      avatar: null,
    });
  }, []);
  const isEmptyForm = useMemo(() => {
    return (
      !firstName.trim() &&
      !lastName.trim() &&
      !email.trim() &&
      !String(phone || '').replace(/\D/g, '') &&
      !password &&
      !confirmPassword &&
      !birthdate &&
      !avatarUrl &&
      (departmentId == null || departmentId === '')
    );
  }, [
    firstName,
    lastName,
    email,
    phone,
    password,
    confirmPassword,
    birthdate,
    avatarUrl,
    departmentId,
  ]);

  const isDirty = useMemo(() => {
    const snap = JSON.stringify({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: String(phone || '').replace(/\D/g, ''),
      role,
      password: password.length > 0,
      birthdate: birthdate ? new Date(birthdate).toISOString().slice(0, 10) : null,
      avatar: !!avatarUrl,
    });
    return snap !== initialSnapRef.current;
  }, [firstName, lastName, email, phone, role, password, birthdate, avatarUrl]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (allowLeaveRef.current || isEmptyForm || !isDirty) {
        return false;
      }
      setCancelVisible(true);
      return true;
    });
    return () => sub.remove();
  }, [isDirty, isEmptyForm]);
  // Intercept header back/cancel: show confirm only when form changed
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || isEmptyForm || !isDirty) return;
      e.preventDefault();
      setCancelVisible(true);
    });
    return sub;
  }, [navigation, isDirty, isEmptyForm]);

  useEffect(() => {
    setHeaderName(
      `${firstName || ''} ${lastName || ''}`.replace(/\s+/g, ' ').trim() ||
        t('placeholder_no_name'),
    );
  }, [firstName, lastName, t]);

  const ensureCameraPerms = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    return status === 'granted';
  };
  const ensureLibraryPerms = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === 'granted';
  };
  const uploadAvatar = async (userId, uri) => {
    try {
      const resp = await fetch(uri);
      const ab = await resp.arrayBuffer();
      const fileData = new Uint8Array(ab);
      const filename = `${AVA_PREFIX}${Date.now()}.jpg`;
      const path = `${STORAGE.AVATAR_PREFIX}/${userId}/${filename}`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE.AVATORS || STORAGE.AVATARS)
        .upload(path, fileData, { contentType: AVA_MIME, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage
        .from(STORAGE.AVATORS || STORAGE.AVATARS)
        .getPublicUrl(path);
      const publicUrl = pub?.publicUrl || null;
      const { error: updErr } = await supabase
        .from(TABLES.profiles)
        .update({ avatar_url: publicUrl })
        .eq('id', userId);
      if (updErr) throw updErr;
      setAvatarUrl(publicUrl);
      return publicUrl;
    } catch (e) {
      setErr(e?.message || t('toast_generic_error'));
      return null;
    }
  };
  const pickFromCamera = async () => {
    const ok = await ensureCameraPerms();
    if (!ok) {
      setErr(t('error_camera_denied'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: MEDIA_QUALITY,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUrl(res.assets[0].uri);
  };
  const pickFromLibrary = async () => {
    const ok = await ensureLibraryPerms();
    if (!ok) {
      setErr(t('error_library_denied'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: MEDIA_QUALITY,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      selectionLimit: 1,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUrl(res.assets[0].uri);
  };

  const fetchDepartments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from(TABLES.departments)
        .select('id, name')
        .order('name', { ascending: true });
      if (!error) setDepartments(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const warn = (key) => {
    toastInfo(t(key));
  };

  const handleCreate = useCallback(async () => {
    if (submitting) return;
    Keyboard.dismiss(); // Закрываем клавиатуру при создании
    setSubmittedAttempt(true);

    // Проверка всех обязательных полей
    const missingFirst = !firstName.trim();
    const missingLast = !lastName.trim();
    const invalidEmail = !emailValid;
    const invalidPwd = !passwordValid;
    const mismatchPwd = !passwordsMatch;
    const emailTaken = emailCheckStatus === 'taken';

    // Если email уже занят - показываем ошибку сразу
    if (emailTaken) {
      toastError(t('error_email_exists'));
      return;
    }

    // Проверяем все обязательные поля
    if (missingFirst || missingLast || invalidEmail || invalidPwd || mismatchPwd) {
      // Прокручиваем к началу чтобы показать ошибки
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    setErr('');
    setSubmitting(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();
      const phoneNormalized = String(phone || '').replace(/\D/g, '') || null;

      // create auth user via edge function
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/${FN_CREATE_USER}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: String(email).trim().toLowerCase(),
          password: String(password),
          role,
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

        // Логируем для отладки
        console.error('Create user error:', { status: resp.status, msg, raw });

        // Переводим типичные ошибки на русский
        if (/already exists|email.*taken|user.*exists/i.test(String(msg))) {
          throw new Error(t('error_email_exists'));
        }
        if (/password must be at least.*chars|password.*short/i.test(String(msg))) {
          throw new Error(t('error_password_too_short'));
        }
        if (/invalid role/i.test(String(msg))) {
          throw new Error(t('error_invalid_role'));
        }
        if (/unauthorized/i.test(String(msg))) {
          throw new Error('Ошибка авторизации. Попробуйте выйти и войти снова.');
        }
        if (/forbidden/i.test(String(msg))) {
          throw new Error('У вас нет прав для создания пользователей.');
        }
        if (/auth create error/i.test(String(msg))) {
          // Показываем детали ошибки создания
          const details = msg.match(/Auth create error: (.+)/i);
          if (details && details[1]) {
            throw new Error(`Не удалось создать пользователя: ${details[1]}`);
          }
          throw new Error(t('error_auth_failed'));
        }

        // Если не удалось распознать - показываем исходную ошибку для отладки
        throw new Error(msg);
      }
      const userId = body?.user_id;
      if (!userId) throw new Error(t('error_profile_not_updated'));

      // Save profile fields
      const bdate =
        birthdate instanceof Date ? new Date(birthdate).toISOString().slice(0, 10) : null;
      const { error: upErr } = await supabase
        .from(TABLES.profiles)
        .update({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          full_name: fullName || null,
          phone: phoneNormalized,
          birthdate: bdate,
          role,
        })
        .eq('id', userId);
      if (upErr) throw upErr;

      // upload avatar if chosen
      if (avatarUrl && avatarUrl.startsWith('file')) {
        await uploadAvatar(userId, avatarUrl);
      }

      toastSuccess(t('toast_success'));
      setTimeout(() => router.replace('/users'), theme.timings?.backDelayMs ?? 300);
    } catch (e) {
      const msg = String(e?.message || t('toast_generic_error'));
      setErr(msg);
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
    passwordsMatch,
    emailValid,
    passwordValid,
    emailCheckStatus,
    role,
    phone,
    birthdate,
    avatarUrl,
    router,
    theme.timings?.backDelayMs,
    t,
    toastSuccess,
    toastError,
    scrollRef,
  ]);

  const roleItems = useMemo(
    () => ROLES.map((r) => ({ id: r, label: ROLE_LABELS_LOCAL[r] || r })),
    [],
  );

  const onCancel = () => {
    if (isDirty) {
      setCancelVisible(true);
      return;
    }
    router.back();
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={['left', 'right']}
    >
      <AppHeader
        back
        options={{
          headerTitleAlign: 'left',
          title: t('routes.users/new'),
          rightTextLabel: submitting ? t('toast_saving') : t('btn_create'),
          onRightPress: handleCreate,
        }}
      />
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingBottom:
              (theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl) +
              (insets?.bottom ?? 0),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        bottomOffset={40}
        onScroll={(e) => {
          try {
            scrollYRef.current = e.nativeEvent.contentOffset.y || 0;
          } catch {}
        }}
        scrollEventThrottle={16}
      >
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <Pressable
              style={styles.avatar}
              onPress={() => setAvatarSheet(true)}
              accessibilityRole="button"
              accessibilityLabel={t('a11y_change_avatar')}
              accessibilityHint={t('a11y_change_avatar_hint')}
            >
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>{initials || '•'}</Text>
              )}
              <View style={styles.avatarCamBadge}>
                <Feather
                  name="camera"
                  size={Math.max(
                    theme.icons?.minCamera ?? 12,
                    Math.round((theme.icons?.sm ?? 18) * (theme.icons?.cameraRatio ?? 0.67)),
                  )}
                  color={theme.colors.onPrimary}
                />
              </View>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.nameTitle}>{headerName}</Text>
            </View>
          </View>
        </Card>

        {/* Ошибки БД */}
        {err ? (
          <ValidationAlert
            messages={[err]}
            type="error"
            style={{ marginBottom: theme.spacing.md }}
          />
        ) : null}

        {/* Ошибки валидации */}
        {validationErrors.length > 0 && (
          <ValidationAlert
            messages={validationErrors}
            type="error"
            style={{ marginBottom: theme.spacing.md }}
          />
        )}

        {/* Предупреждение о недопустимых символах в пароле */}
        {invalidCharWarning && (
          <ValidationAlert
            messages={[t('err_password_invalid_chars')]}
            type="warning"
            style={{ marginBottom: theme.spacing.md }}
          />
        )}

        {/* Статус проверки email */}
        {emailCheckStatus === 'checking' && emailValid && (
          <ValidationAlert
            messages={[t('warn_checking_email')]}
            type="info"
            style={{ marginBottom: theme.spacing.md }}
          />
        )}

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
          />
          <PhoneInput
            ref={phoneRef}
            value={phone}
            onChangeText={(val) => {
              setPhone(val);
            }}
            error={undefined}
            style={styles.field}
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
            onPress={() => setDobModalVisible(true)}
            rightSlot={
              birthdate ? (
                <ClearButton
                  onPress={() => setBirthdate(null)}
                  accessibilityLabel={t('common_clear')}
                />
              ) : null
            }
          />
        </Card>

        <SectionHeader bottomSpacing="xs">{t('section_company_role')}</SectionHeader>
        <Card paddedXOnly>
          <TextField
            label={t('label_department')}
            value={String(activeDeptName || t('placeholder_department'))}
            style={styles.field}
            pressable
            onPress={() => setDeptModalVisible(true)}
          />

          <TextField
            label={t('label_role')}
            value={String(ROLE_LABELS_LOCAL[role] || role)}
            style={styles.field}
            pressable
            onPress={() => setShowRoles(true)}
          />
        </Card>

        <SectionHeader bottomSpacing="xs">{t('section_password')}</SectionHeader>
        <Card paddedXOnly>
          <View style={{ position: 'relative' }}>
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
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable
                    onPress={() => {
                      setShowPassword((v) => !v);
                    }}
                    android_ripple={{
                      color: theme?.colors?.border ?? '#00000020',
                      borderless: false,
                      radius: 24,
                    }}
                    accessibilityLabel={
                      showPassword ? t('a11y_hide_password') : t('a11y_show_password')
                    }
                    accessibilityRole="button"
                    hitSlop={{
                      top: theme.spacing.sm,
                      bottom: theme.spacing.sm,
                      left: theme.spacing.sm,
                      right: theme.spacing.sm,
                    }}
                    style={{ padding: theme.spacing.xs, borderRadius: theme.radii.md }}
                  >
                    <Feather
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={ICON_MD}
                      color={theme.colors.primary ?? theme.colors.text}
                    />
                  </Pressable>
                </View>
              }
            />
          </View>

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
          />
        </Card>

        <ConfirmModal
          visible={cancelVisible}
          onClose={() => setCancelVisible(false)}
          title={t('dlg_leave_title')}
          message={t('dlg_leave_msg')}
          confirmLabel={t('dlg_leave_confirm')}
          cancelLabel={t('dlg_leave_cancel')}
          confirmVariant="destructive"
          onConfirm={() => {
            allowLeaveRef.current = true;
            setCancelVisible(false);
            router.back();
          }}
        />

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

        <SelectModal
          visible={deptModalVisible}
          onClose={() => setDeptModalVisible(false)}
          title={t('user_department_title')}
          items={(departments || []).map((d) => ({ id: d.id, label: d.name }))}
          searchable={false}
          onSelect={(it) => {
            setDepartmentId(it.id);
            setDeptModalVisible(false);
          }}
        />

        <SelectModal
          visible={showRoles}
          onClose={() => setShowRoles(false)}
          title={t('user_role_title')}
          items={roleItems}
          searchable={false}
          onSelect={(it) => {
            setRole(it.id);
            setShowRoles(false);
          }}
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
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
