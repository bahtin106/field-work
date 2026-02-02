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
import { globalCache } from '../../lib/cache';
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
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

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

  // Согласие с политикой
  const [consentChecked, setConsentChecked] = useState(false);

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
        field: {
          marginHorizontal: 0,
          marginVertical: theme.components?.input?.fieldSpacing ?? theme.spacing.sm,
        },
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
    }

    // Если есть незаполненные обязательные поля - показываем общее сообщение
    if (requiredFieldsMissing.length > 0) {
      errors.push(t('err_required_fields'));
    }

    // Email: если заполнен, но неверный формат
    if (email.trim() && !emailValid) {
      errors.push(t('err_email_invalid_format'));
    }

    // Email: если уже занят
    if (emailCheckStatus === 'taken') {
      errors.push(t('warn_email_already_taken'));
    }

    setValidationErrors(errors);
  }, [
    firstName,
    lastName,
    email,
    emailValid,
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
      !birthdate &&
      !avatarUrl &&
      (departmentId == null || departmentId === '')
    );
  }, [
    firstName,
    lastName,
    email,
    phone,
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
      birthdate: birthdate ? new Date(birthdate).toISOString().slice(0, 10) : null,
      avatar: !!avatarUrl,
    });
    return snap !== initialSnapRef.current;
  }, [firstName, lastName, email, phone, role, birthdate, avatarUrl]);

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
    Keyboard.dismiss();
    setSubmittedAttempt(true);

    // Проверка обязательных полей (БЕЗ пароля)
    const missingFirst = !firstName.trim();
    const missingLast = !lastName.trim();
    const invalidEmail = !emailValid;
    const emailTaken = emailCheckStatus === 'taken';

    if (emailTaken) {
      toastError(t('error_email_exists'));
      return;
    }

    if (missingFirst || missingLast || invalidEmail) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    // Показываем модалку подтверждения вместо прямого создания
    setInviteEmail(String(email).trim().toLowerCase());
    setInviteModalVisible(true);
  }, [
    submitting,
    firstName,
    lastName,
    emailValid,
    emailCheckStatus,
    email,
    router,
    t,
    toastError,
    scrollRef,
  ]);

  // Отправка приглашения по волшебной ссылке
  const handleInviteConfirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setErr('');

    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();
      const phoneNormalized = String(phone || '').replace(/\D/g, '') || null;
      const bdate = birthdate instanceof Date ? new Date(birthdate).toISOString().slice(0, 10) : null;

      // Вызываем edge function для отправки приглашения
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const supabaseUrl = supabase.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
      const url = `${supabaseUrl}/functions/v1/invite_user`;
      
      console.log('[handleInviteConfirm] Starting invite request');
      console.log('[handleInviteConfirm] URL:', url);
      console.log('[handleInviteConfirm] Has token:', !!token);
      console.log('[handleInviteConfirm] Email:', inviteEmail);
      
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: inviteEmail,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          full_name: fullName,
          phone: phoneNormalized,
          birthdate: bdate,
          role,
          department_id: departmentId,
        }),
      });

      console.log('[handleInviteConfirm] Response status:', resp.status);
      
      const raw = await resp.text();
      console.log('[handleInviteConfirm] Response body:', raw);
      
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!resp.ok) {
        const msg =
          (body && (body.message || body.error || body.details || body.hint)) ||
          raw ||
          `HTTP ${resp.status}`;
        console.error('[handleInviteConfirm] Error:', { status: resp.status, msg, raw });

        if (/already exists|email.*taken|user.*exists/i.test(String(msg))) {
          throw new Error(t('error_email_exists'));
        }
        throw new Error(msg);
      }

      console.log('[handleInviteConfirm] Success!');

      // Успешно отправили приглашение
      setInviteModalVisible(false);
      toastSuccess(`Приглашение отправлено на ${inviteEmail}`);
      
      // Очищаем кеш и переходим обратно
      globalCache.invalidate('users:');
      allowLeaveRef.current = true;
      router.replace('/users');
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
    phone,
    birthdate,
    role,
    departmentId,
    inviteEmail,
    router,
    theme,
    t,
    toastSuccess,
    toastError,
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

        {/* Пароль отправляется по волшебной ссылке в письме - полей пароля не нужно */}

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

        <ConfirmModal
          visible={inviteModalVisible}
          title="Отправить приглашение?"
          message={`Письмо с ссылкой для создания пароля будет отправлено на:\n\n${inviteEmail}\n\nСотрудник сможет создать свой пароль и войти в приложение.`}
          confirmLabel="Отправить"
          cancelLabel="Отмена"
          onConfirm={handleInviteConfirm}
          onClose={() => setInviteModalVisible(false)}
        />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
