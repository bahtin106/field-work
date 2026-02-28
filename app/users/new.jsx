import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
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
import { useFeedback, ScreenBanner, FieldErrorText, normalizeError, FEEDBACK_CODES, getMessageByCode } from '../../src/shared/feedback';
import { useFormAutoScroll } from '../../src/shared/forms/useFormAutoScroll';
import { useTheme } from '../../theme';
import { useDepartmentsQuery } from '../../src/features/employees/queries';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';
import { useCompanyEntitlements } from '../../hooks/useCompanyEntitlements';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { uploadProfileMedia } from '../../src/features/profileMedia/api';

// i18n
import { useI18nVersion } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';

// data / constants
import { ROLE, ROLE_LABELS, EDITABLE_ROLES as ROLES } from '../../constants/roles';
import {
  AUTH_CONSTRAINTS,
  isValidEmail as isValidEmailShared,
} from '../../lib/authValidation';
import { AVATAR, STORAGE, TBL } from '../../lib/constants';
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

const _FN_INVITE_USER = process.env.EXPO_PUBLIC_FN_INVITE_USER || 'invite-user';

let ROLE_LABELS_LOCAL = ROLE_LABELS;
try {
  const fromEnv = process.env.EXPO_PUBLIC_ROLE_LABELS_JSON;
  if (fromEnv) ROLE_LABELS_LOCAL = { ...ROLE_LABELS_LOCAL, ...JSON.parse(fromEnv) };
} catch {}

const IMAGE_MEDIA_TYPES = (() => {
  try {
    if (ImagePicker.MediaType && ImagePicker.MediaType.Images) return ImagePicker.MediaType.Images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.images) return ImagePicker.MediaType.images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.image) return ImagePicker.MediaType.image;
  } catch {
    // ignore and fall back
  }
  return ['images'];
})();

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

function pickMessageFromPayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  return String(payload.message || payload.error || payload.details || payload.hint || '').trim();
}

function mapInviteErrorToUiMessage(rawMessage, statusCode, t) {
  const msg = String(rawMessage || '').trim();

  if (/already exists|email.*taken|user.*exists|duplicate|email.*exists/i.test(msg)) {
    return t('error_email_exists');
  }
  if (/seat limit exceeded/i.test(msg)) {
    return t('err_seat_limit_exceeded_generic');
  }
  if (/read-only|subscription expired/i.test(msg)) {
    return t('err_subscription_read_only');
  }
  if (statusCode === 401 || /unauthorized/i.test(msg)) {
    return t('err_invite_failed');
  }
  if (statusCode === 403 || /forbidden/i.test(msg)) {
    return t('error_no_access');
  }
  if (!msg || /edge function returned a non-2xx status code/i.test(msg)) {
    return t('err_invite_failed');
  }
  return msg;
}

async function resolveInviteInvokeErrorMessage(inviteError, t) {
  const statusCode =
    Number(inviteError?.context?.status || inviteError?.status || inviteError?.code || 0) || 0;

  let payloadMessage = '';
  const context = inviteError?.context;
  if (context && typeof context.clone === 'function') {
    try {
      const bodyText = await context.clone().text();
      if (bodyText) {
        try {
          payloadMessage = pickMessageFromPayload(JSON.parse(bodyText));
        } catch {
          payloadMessage = bodyText.trim();
        }
      }
    } catch {}
  }

  const rawMessage = payloadMessage || String(inviteError?.message || '');
  return mapInviteErrorToUiMessage(rawMessage, statusCode, t);
}

export default function NewUserScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const _ver = useI18nVersion();
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigation = useNavigation();
  const { banner, showBanner, clearBanner, showSuccessToast, showInfoToast } = useFeedback();
  const _base = useMemo(() => listItemStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  // state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [headerName, setHeaderName] = useState(t('placeholder_no_name'));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(ROLE.WORKER);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSuccessScreen, setInviteSuccessScreen] = useState(false);
  const [inviteLink, _setInviteLink] = useState(null);
  const [_inviteUserId, _setInviteUserId] = useState(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);

  const [phone, setPhone] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [withYear, setWithYear] = useState(true);
  const [dobModalVisible, setDobModalVisible] = useState(false);

  const [departmentId, setDepartmentId] = useState(null);
  const { data: companyId } = useMyCompanyIdQuery();
  const { data: entitlements } = useCompanyEntitlements(companyId || null);
  const { useDepartments } = useCompanySettings(companyId || null);
  const { data: departments = [] } = useDepartmentsQuery({
    companyId,
    enabled: !!companyId && useDepartments,
    onlyEnabled: true,
  });
  const [deptModalVisible, setDeptModalVisible] = useState(false);
  const activeDeptName = useMemo(() => {
    const d = (departments || []).find((x) => String(x.id) === String(departmentId));
    return d ? d.name : null;
  }, [departments, departmentId]);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarSheet, setAvatarSheet] = useState(false);

  useEffect(() => {
    if (!useDepartments && departmentId !== null) {
      setDepartmentId(null);
    }
  }, [departmentId, useDepartments]);

  const [showRoles, setShowRoles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [cancelVisible, setCancelVisible] = useState(false);
  const [submittedAttempt, setSubmittedAttempt] = useState(false);

  //   
  const [_consentChecked, _setConsentChecked] = useState(false);

  // Validation states
  const [emailCheckStatus, setEmailCheckStatus] = useState(null); // null | 'checking' | 'available' | 'taken'
  const [invalidCharWarning, setInvalidCharWarning] = useState(false);

  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const _pwdRef = useRef(null);
  const phoneRef = useRef(null);
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const allowLeaveRef = useRef(false);
  const emailCheckTimeoutRef = useRef(null);
  const headerHeight = theme?.components?.header?.height ?? 56;
  const { scrollToFirstInvalid } = useFormAutoScroll({
    scrollRef,
    scrollYRef,
    insetsBottom: insets.bottom ?? 0,
    headerHeight,
  });

  const _MEDIA_ASPECT = Array.isArray(theme.media?.aspect) ? theme.media.aspect : [1, 1];
  const MEDIA_QUALITY = typeof theme.media?.quality === 'number' ? theme.media.quality : 0.85;
  const _ICON_MD = theme.icons?.md ?? 22;
  const _ICON_SM = theme.icons?.sm ?? 18;
  const _ICONBUTTON_TOUCH = theme.components?.iconButton?.size ?? 32;

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

  const _MIN_PASSWORD_LENGTH = useMemo(() => {
    const envVal = Number(process.env.EXPO_PUBLIC_PASSWORD_MIN_LENGTH || 0) || 0;
    const sharedMin = Number(AUTH_CONSTRAINTS?.PASSWORD?.MIN_LENGTH || 0) || 0;
    return Math.max(sharedMin, envVal || 6);
  }, []);

  const emailValid = useMemo(() => isValidEmailShared(email), [email]);
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

  //  email   (debounced)
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
          .ilike('email', emailToCheck.trim().toLowerCase())
          .limit(1)
          .maybeSingle();

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
    [],
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

    //  800ms  
    emailCheckTimeoutRef.current = setTimeout(() => {
      checkEmailAvailability(email.trim().toLowerCase());
    }, 800);

    return () => {
      if (emailCheckTimeoutRef.current) {
        clearTimeout(emailCheckTimeoutRef.current);
      }
    };
  }, [email, emailValid, checkEmailAvailability]);

  useEffect(() => {
    clearBanner();
  }, [clearBanner]);

  //     
  const _handleInvalidPasswordInput = useCallback(() => {
    setInvalidCharWarning(true);

    //    3 
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
      (!useDepartments || departmentId == null || departmentId === '')
    );
  }, [
    firstName,
    lastName,
    email,
    phone,
    birthdate,
    avatarUrl,
    departmentId,
    useDepartments,
  ]);

  const isDirty = useMemo(() => {
    const snap = JSON.stringify({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: String(phone || '').replace(/\D/g, ''),
      role,
      birthdate: birthdate
        ? withYear
          ? new Date(birthdate).toISOString().slice(0, 10)
          : `${new Date(1900, birthdate.getMonth(), birthdate.getDate()).toISOString().slice(0, 10)}`
        : null,
      avatar: !!avatarUrl,
    });
    return snap !== initialSnapRef.current;
  }, [firstName, lastName, email, phone, role, birthdate, withYear, avatarUrl]);

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
  const _uploadAvatar = async (userId, uri) => {
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
      showBanner({ message: e?.message || t('toast_generic_error'), severity: 'error' });
      return null;
    }
  };
  const pickFromCamera = async () => {
    const ok = await ensureCameraPerms();
    if (!ok) {
      showBanner({ message: t('error_camera_denied'), severity: 'error' });
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: MEDIA_QUALITY,
      mediaTypes: IMAGE_MEDIA_TYPES,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUrl(res.assets[0].uri);
  };
  const pickFromLibrary = async () => {
    const ok = await ensureLibraryPerms();
    if (!ok) {
      showBanner({ message: t('error_library_denied'), severity: 'error' });
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: MEDIA_QUALITY,
      mediaTypes: IMAGE_MEDIA_TYPES,
      selectionLimit: 1,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUrl(res.assets[0].uri);
  };

  const _warn = (key) => {
    showInfoToast(t(key));
  };

  const handleCreate = useCallback(async () => {
    if (submitting) return;
    Keyboard.dismiss();
    setSubmittedAttempt(true);

    //    ( )
    const missingFirst = !firstName.trim();
    const missingLast = !lastName.trim();
    const invalidEmail = !emailValid;
    const emailTaken = emailCheckStatus === 'taken';

    if (emailTaken) {
      setFieldErrors((prev) => ({
        ...prev,
        email: {
          code: FEEDBACK_CODES.EMAIL_TAKEN,
          message: getMessageByCode(FEEDBACK_CODES.EMAIL_TAKEN, t),
        },
      }));
      return;
    }

    if (missingFirst || missingLast || invalidEmail) {
      scrollToFirstInvalid([
        { invalid: missingFirst, ref: firstNameRef, fallbackY: 0 },
        { invalid: missingLast, ref: lastNameRef, fallbackY: 0 },
        { invalid: invalidEmail, ref: emailRef, fallbackY: 0 },
      ]);
      return;
    }

    //      
    const canEditBySubscription = entitlements?.can_edit !== false;
    if (!canEditBySubscription) {
      showBanner({ message: t('err_subscription_read_only'), severity: 'error' });
      return;
    }

    const canAddMembers = entitlements?.features?.can_add_members;
    if (canAddMembers === false) {
      showBanner({ message: t('err_seat_limit_exceeded_generic'), severity: 'error' });
      return;
    }

    setInviteEmail(String(email).trim().toLowerCase());
    setInviteModalVisible(true);
  }, [
    submitting,
    firstName,
    lastName,
    emailValid,
    emailCheckStatus,
    email,
    t,
    entitlements?.can_edit,
    entitlements?.features?.can_add_members,
    showBanner,
    scrollToFirstInvalid,
  ]);

  //     
  const handleInviteConfirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    clearBanner();
    setFieldErrors({});

    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();
      const phoneNormalized = String(phone || '').replace(/\D/g, '') || null;
      const bdate = birthdate instanceof Date
        ? withYear
          ? new Date(birthdate).toISOString().slice(0, 10)
          : `${new Date(1900, birthdate.getMonth(), birthdate.getDate()).toISOString().slice(0, 10)}`
        : null;

      if (!__IS_PROD) {
        console.debug('[handleInviteConfirm] Starting invite flow');
        console.debug('[handleInviteConfirm] Email:', inviteEmail);
      }

      const { data: existingProfile } = await supabase
        .from(TABLES.profiles)
        .select('id, email')
        .ilike('email', inviteEmail)
        .maybeSingle();

      if (existingProfile) {
        throw new Error(t('error_email_exists'));
      }

      const payload = {
        email: inviteEmail,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        full_name: fullName || null,
        phone: phoneNormalized,
        birthdate: bdate,
        role,
        department_id: useDepartments ? (departmentId || null) : null,
      };

      const { data: inviteData, error: inviteError } = await supabase.functions.invoke(
        _FN_INVITE_USER,
        { body: payload },
      );

      if (inviteError) {
        const messageForUi = await resolveInviteInvokeErrorMessage(inviteError, t);
        throw new Error(messageForUi || t('err_invite_failed'));
      }

      if (inviteData?.success !== true) {
        const msgStr = String(pickMessageFromPayload(inviteData) || '');
        throw new Error(mapInviteErrorToUiMessage(msgStr, 0, t) || t('err_invite_failed'));
      }

      setInviteModalVisible(false);
      if (avatarUrl && inviteData?.user_id) {
        try {
          await uploadProfileMedia('employee', String(inviteData.user_id), avatarUrl);
        } catch (avatarError) {
          showBanner({
            message: avatarError?.message || t('toast_generic_error'),
            severity: 'warning',
          });
        }
      }
      showSuccessToast(`${t('toast_invite_sent_prefix')} ${inviteEmail}`);
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      allowLeaveRef.current = true;
      router.replace('/users');
    } catch (e) {
      const normalized = normalizeError(e, { t, fieldMap: { email: 'email' } });
      if (Object.keys(normalized.fieldErrors || {}).length) {
        setFieldErrors((prev) => ({ ...prev, ...normalized.fieldErrors }));
      }
      if (normalized.screenError) {
        showBanner({
          ...normalized.screenError,
          action: { label: t('btn_retry'), onPress: handleInviteConfirm },
        });
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    firstName,
    lastName,
    phone,
    birthdate,
    withYear,
    role,
    departmentId,
    useDepartments,
    inviteEmail,
    avatarUrl,
    router,
    queryClient,
    t,
    showSuccessToast,
    showBanner,
    clearBanner,
  ]);
  const roleItems = useMemo(
    () => ROLES.map((r) => ({ id: r, label: ROLE_LABELS_LOCAL[r] || r })),
    [],
  );

  const _onCancel = () => {
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
                <Text style={styles.avatarText}>{initials || '*'}</Text>
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

        {banner ? (
          <ScreenBanner
            message={banner}
            onClose={clearBanner}
            style={{ marginBottom: theme.spacing.md }}
          />
        ) : null}

        {invalidCharWarning && (
          <ScreenBanner
            message={{ message: t('err_password_invalid_chars'), severity: 'warning' }}
            onClose={() => setInvalidCharWarning(false)}
            style={{ marginBottom: theme.spacing.md }}
          />
        )}

        {emailCheckStatus === 'checking' && emailValid && (
          <ScreenBanner
            message={{ message: t('warn_checking_email'), severity: 'info' }}
            onClose={() => setEmailCheckStatus(null)}
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
            onChangeText={(val) => {
              setFirstName(val);
              clearFieldError('firstName');
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, firstName: true }))}
            forceValidation={submittedAttempt}
            error={firstNameError ? 'invalid' : undefined}
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
          />
          <FieldErrorText message={emailError} />
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
          {useDepartments ? (
            <TextField
              label={t('label_department')}
              value={String(activeDeptName || t('placeholder_department'))}
              style={styles.field}
              pressable
              onPress={() => setDeptModalVisible(true)}
            />
          ) : null}

          <TextField
            label={t('label_role')}
            value={String(ROLE_LABELS_LOCAL[role] || role)}
            style={styles.field}
            pressable
            onPress={() => setShowRoles(true)}
          />
        </Card>

        {/*        -     */}

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

        {useDepartments ? (
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
        ) : null}

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
          title={t('invite_modal_title')}
          message={
            <Text
              style={{
                fontSize: theme.typography.sizes.md,
                color: theme.colors.textSecondary,
              }}
            >
              {t('invite_modal_body_prefix')}
              {'\n\n'}
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                {inviteEmail}
              </Text>
              {'\n\n'}
              {t('invite_modal_body_suffix')}
            </Text>
          }
          confirmLabel={t('invite_modal_confirm')}
          cancelLabel={t('btn_cancel')}
          onConfirm={handleInviteConfirm}
          onClose={() => setInviteModalVisible(false)}
        />
      </KeyboardAwareScrollView>

      {inviteSuccessScreen && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.colors.background,
            zIndex: 1000,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: theme.spacing.lg,
          }}
        >
          <View style={{ alignItems: 'center', gap: theme.spacing.xl, flex: 1, justifyContent: 'center' }}>
            <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: withAlpha(theme.colors.success || theme.colors.primary, 0.12),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather
                  name="check-circle"
                  size={48}
                  color={theme.colors.success || theme.colors.primary}
                />
              </View>

              <Text
                style={{
                  fontSize: theme.typography.sizes.lg,
                  fontWeight: '700',
                  color: theme.colors.text,
                  textAlign: 'center',
                }}
              >
                {t('invite_success_title')}
              </Text>

              <Text
                style={{
                  fontSize: theme.typography.sizes.sm,
                  color: theme.colors.textSecondary,
                  textAlign: 'center',
                  lineHeight: Math.round(
                    theme.typography.sizes.sm * (theme.typography.lineHeights?.normal ?? 1.5),
                  ),
                }}
              >
                {t('invite_success_message')}
              </Text>
            </View>

            <View
              style={{
                width: '100%',
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.lg,
                padding: theme.spacing.md,
                borderWidth: theme.components.card.borderWidth,
                borderColor: theme.colors.border,
              }}
            >
              <Text
                style={{
                  fontSize: theme.typography.sizes.xs,
                  color: theme.colors.textSecondary,
                  marginBottom: theme.spacing.sm,
                }}
              >
                {t('invite_link_label')}
              </Text>
              <Text
                style={{
                  fontSize: theme.typography.sizes.sm,
                  color: theme.colors.text,
                  fontFamily: 'monospace',
                  lineHeight: Math.round(theme.typography.sizes.sm * 1.5),
                }}
                numberOfLines={4}
              >
                {inviteLink}
              </Text>
            </View>

            <Pressable
              onPress={async () => {
                if (inviteLink) {
                  await Clipboard.setStringAsync(inviteLink);
                  setInviteLinkCopied(true);
                  setTimeout(() => setInviteLinkCopied(false), 2000);
                }
              }}
              style={({ pressed }) => [
                {
                  width: '100%',
                  paddingVertical: theme.spacing.md,
                  paddingHorizontal: theme.spacing.lg,
                  borderRadius: theme.radii.lg,
                  backgroundColor: theme.colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text
                style={{
                  fontSize: theme.typography.sizes.md,
                  fontWeight: '600',
                  color: '#fff',
                }}
              >
                {inviteLinkCopied ? t('invite_link_copied') : t('invite_copy_link')}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setInviteSuccessScreen(false);
                queryClient.invalidateQueries({ queryKey: ['employees'] }).catch(() => {});
                allowLeaveRef.current = true;
                router.replace('/users');
              }}
              style={({ pressed }) => [
                {
                  width: '100%',
                  paddingVertical: theme.spacing.md,
                  paddingHorizontal: theme.spacing.lg,
                  borderRadius: theme.radii.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: theme.components.card.borderWidth,
                  borderColor: theme.colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={{
                  fontSize: theme.typography.sizes.md,
                  fontWeight: '600',
                  color: theme.colors.text,
                }}
              >
                {t('btn_back')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}











