// app/users/[id]/edit.jsx

import { AntDesign, Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EditScreenTemplate, { useEditFormStyles } from '../../../components/layout/EditScreenTemplate';
import UIButton from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import ClearButton from '../../../components/ui/ClearButton';
import IconButton from '../../../components/ui/IconButton';
import PhoneInput from '../../../components/ui/PhoneInput';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { useToast } from '../../../components/ui/ToastProvider';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import {
  AlertModal,
  BaseModal,
  ConfirmModal,
  DateTimeModal,
  SelectModal,
} from '../../../components/ui/modals';
import { isValidRu as isValidPhone } from '../../../components/ui/phone';
import { FUNCTIONS as APP_FUNCTIONS, AVATAR, STORAGE, TBL } from '../../../lib/constants';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';
import { supabase } from '../../../lib/supabase';
import { globalCache } from '../../../lib/cache/DataCache';
import { t as T, getDict, useI18nVersion } from '../../../src/i18n';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

const TABLES = {
  profiles: TBL.PROFILES || 'profiles',
  orders: TBL.ORDERS || 'orders',
  departments: TBL.DEPARTMENTS || 'departments',
};

const __EDIT_CFG = (() => {
  try {
    const mix = process.env.EXPO_PUBLIC_EDIT_CONFIG_JSON;
    if (mix) {
      const o = JSON.parse(mix);
      if (o && typeof o === 'object') return o;
    }
  } catch (_) {}
  return {};
})();
const __EDIT_BUCKETS = (() => {
  try {
    const s = process.env.EXPO_PUBLIC_BUCKETS_JSON;
    if (s) {
      const o = JSON.parse(s);
      if (o && typeof o === 'object') return o;
    }
  } catch (_) {}
  return __EDIT_CFG.buckets || {};
})();
const __EDIT_FUNCTIONS = (() => {
  try {
    const s = process.env.EXPO_PUBLIC_FUNCTIONS_JSON;
    if (s) {
      const o = JSON.parse(s);
      if (o && typeof o === 'object') return o;
    }
  } catch (_) {}
  return __EDIT_CFG.functions || {};
})();
const __IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const __pick = (val, devFallback) => (val != null ? val : __IS_PROD ? null : devFallback);

const BUCKETS = STORAGE;
const AVA_PREFIX = AVATAR.FILENAME_PREFIX;
const AVA_MIME = AVATAR.MIME;

const FUNCTIONS = APP_FUNCTIONS;

const FN_GET_PROFILE =
  process.env.EXPO_PUBLIC_RPC_GET_PROFILE ||
  (__EDIT_FUNCTIONS.getProfileWithEmail ?? 'admin_get_profile_with_email');

const RT_PREFIX = process.env.EXPO_PUBLIC_RT_USER_PREFIX || 'rt-user-';

import { ROLE, EDITABLE_ROLES as ROLES, ROLE_LABELS } from '../../../constants/roles';
let ROLE_LABELS_LOCAL = ROLE_LABELS;

// --- Local date formatter to avoid UTC shifts ---
const __ymdLocal = (d) => {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
};
// --- end helper ---

// Robust local-date helpers to avoid UTC shifts and month off-by-one
const __parseLocalYMD = (val) => {
  try {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val)) {
      // Normalize to local date (strip time)
      return new Date(val.getFullYear(), val.getMonth(), val.getDate());
    }
    const s = String(val);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]),
        mo = Number(m[2]),
        d = Number(m[3]);
      return new Date(y, mo - 1, d);
    }
    // Fallback: try Date(...) and normalize
    const d = new Date(val);
    return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  } catch {
    return null;
  }
};

const __coercePickerDate = (v) => {
  try {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v)) {
      return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    if (typeof v === 'object' && v.year && v.month && v.day) {
      // month comes 1..12 from pickers — convert to JS 0..11
      return new Date(Number(v.year), Number(v.month) - 1, Number(v.day));
    }
    if (typeof v === 'string') {
      // Accept "YYYY-MM-DD"
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    const d = new Date(v);
    return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  } catch {
    return null;
  }
};
// --- end local-date helpers ---

try {
  const fromEnv = process.env.EXPO_PUBLIC_ROLE_LABELS_JSON;
  if (fromEnv) ROLE_LABELS_LOCAL = { ...ROLE_LABELS_LOCAL, ...JSON.parse(fromEnv) };
} catch {}

let ROLE_DESCRIPTIONS = globalThis?.APP_I18N?.role_descriptions || {};
try {
  const fromEnv = process.env.EXPO_PUBLIC_ROLE_DESCRIPTIONS_JSON;
  if (fromEnv) ROLE_DESCRIPTIONS = { ...ROLE_DESCRIPTIONS, ...JSON.parse(fromEnv) };
} catch {}

function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*)$/i);
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
    const m = d.getMonth(); // 0..11
    const idx = (m + offset + 12) % 12;
    const month = T(`months_genitive_${idx}`);
    const day = d.getDate();
    const year = d.getFullYear();
    return withYear ? `${day} ${month} ${year}` : `${day} ${month}`;
  } catch {
    return '';
  }
}
function daysInMonth(monthIdx, yearNullable) {
  if (monthIdx === 1 && yearNullable == null) return 29;
  const y = yearNullable ?? new Date().getFullYear();
  return new Date(y, monthIdx + 1, 0).getDate();
}
function range(a, b) {
  const arr = [];
  for (let i = a; i <= b; i++) arr.push(i);
  return arr;
}
function isValidEmailStrict(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (s.length > 254) return false;
  if (/\s/.test(s)) return false;
  const parts = s.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (local.includes('..')) return false;
  if (!/^[A-Za-z0-9._%+-]+$/.test(local)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  for (const lab of labels) {
    if (!lab) return false;
    if (lab.length > 63) return false;
    if (!/^[A-Za-z0-9-]+$/.test(lab)) return false;
    if (lab.startsWith('-') || lab.endsWith('-')) return false;
  }
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || tld.length > 24) return false;
  return true;
}

// === Lightweight wrappers for split modals (local to this screen) ===
function AvatarSheetModal({
  visible,
  hasAvatar,
  onTakePhoto,
  onPickFromLibrary,
  onDeletePhoto,
  onClose,
}) {
  const { t } = useTranslation();

  const items = [
    { id: 'camera', label: t('profile_photo_take') },
    { id: 'library', label: t('profile_photo_choose') },
    // Показываем опцию удаления только если фото есть
    ...(hasAvatar ? [{ id: 'delete', label: t('profile_photo_delete') }] : []),
  ];
  return (
    <SelectModal
      visible={visible}
      title={t('profile_photo_title')}
      items={items}
      searchable={false}
      onSelect={(it) => {
        try {
          if (it.id === 'camera') onTakePhoto?.();
          if (it.id === 'library') onPickFromLibrary?.();
          if (it.id === 'delete') onDeletePhoto?.();
        } finally {
          onClose?.();
        }
      }}
      onClose={onClose}
    />
  );
}

function DepartmentSelectModal({ visible, departments = [], departmentId, onSelect, onClose }) {
  const { t } = useTranslation();
  const mapped = (departments || []).map((d) => ({ id: d.id, label: d.name }));
  return (
    <SelectModal
      visible={visible}
      title={t('user_department_title')}
      items={mapped}
      selectedId={departmentId}
      onSelect={(it) => onSelect?.(it.id)}
      onClose={onClose}
    />
  );
}

function RoleSelectModal({
  visible,
  role,
  roles = [],
  roleLabels = {},
  roleDescriptions = {},
  onSelect,
  onClose,
}) {
  const { t } = useTranslation();
  const items = (roles || []).map((r) => ({
    id: r,
    label: t(`role_${r}`),
    subtitle: roleDescriptions[r] || null,
  }));
  return (
    <SelectModal
      visible={visible}
      title={t('user_role_title')}
      items={items}
      selectedId={role}
      onSelect={(it) => onSelect?.(it.id)}
      onClose={onClose}
    />
  );
}

// === end wrappers ===
export default function EditUser() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const ver = useI18nVersion();
  const router = useRouter();
  const navigation = useNavigation();
  const formStyles = useEditFormStyles();

  const ROLE_DESCRIPTIONS_LOCAL = React.useMemo(
    () => ({
      [ROLE.DISPATCHER]: ROLE_DESCRIPTIONS[ROLE.DISPATCHER] ?? t('role_desc_dispatcher'),
      [ROLE.WORKER]: ROLE_DESCRIPTIONS[ROLE.WORKER] ?? t('role_desc_worker'),
    }),
    [t],
  );
  const MEDIA_ASPECT = Array.isArray(theme.media?.aspect) ? theme.media.aspect : [1, 1];
  const MEDIA_QUALITY = typeof theme.media?.quality === 'number' ? theme.media.quality : 0.85;

  const ICON_MD = theme.icons?.md ?? 22;
  const ICON_SM = theme.icons?.sm ?? 18;
  const ICONBUTTON_TOUCH = theme.components?.iconButton?.size ?? 32;
  const TRAILING_WIDTH =
    theme.components?.input?.trailingSlotWidth ??
    ICONBUTTON_TOUCH +
      theme.spacing.sm +
      ICON_MD +
      theme.spacing.sm +
      (theme.components?.input?.trailingGap ?? theme.spacing.xs);
  const CAMERA_ICON = Math.max(
    theme.icons?.minCamera ?? 12,
    Math.round((theme.icons?.sm ?? 18) * (theme.icons?.cameraRatio ?? 0.67)),
  );
  const RADIO_SIZE = theme.components?.radio?.size ?? ICON_MD;
  const RADIO_DOT =
    theme.components?.radio?.dot ??
    Math.max(theme.components?.radio?.dotMin ?? 6, Math.round(RADIO_SIZE / 2 - 3));
  const TOAST_MAX_W = theme.components?.toast?.maxWidth ?? 440;
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const styles = React.useMemo(() => {
    return StyleSheet.create({
      container: { flex: 1, backgroundColor: theme.colors.background },

      card: formStyles.card,

      rolePillHeader: {
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radii.lg,
        borderWidth: theme.components.card.borderWidth,
      },
      rolePillHeaderText: { fontSize: theme.typography.sizes.xs, fontWeight: '600' },
      headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
      headerCard: { padding: theme.spacing.sm, marginBottom: theme.spacing.md },
      headerCardSuspended: {
        backgroundColor: withAlpha(theme.colors.danger, 0.08),
        borderColor: withAlpha(theme.colors.danger, 0.2),
        borderWidth: theme.components.card.borderWidth,
        borderRadius: theme.radii.lg,
      },
      avatar: {
        width: theme.components.avatar.md,
        height: theme.components.avatar.md,
        borderRadius: theme.components.avatar.md / 2,
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
      badge: {
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radii.pill,
      },
      badgeGreen: { backgroundColor: theme.colors.success },
      badgeRed: { backgroundColor: theme.colors.danger },
      badgeOutline: {
        borderWidth: theme.components.card.borderWidth,
        borderColor: theme.colors.border,
        borderRadius: theme.radii.pill,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
      },
      badgeOutlineText: { color: theme.colors.text, fontSize: theme.typography.sizes.xs },
      badgeText: { fontSize: theme.typography.sizes.xs, fontWeight: '600' },
      // section: используем base.sectionTitle из listItemStyles
      label: {
        fontWeight: '500',
        marginBottom: theme.spacing.xs,
        marginTop: theme.spacing.md,
        color: theme.colors.textSecondary,
      },

      field: formStyles.field,
      errorCard: {
        backgroundColor: withAlpha(theme.colors.danger, 0.12),
        borderColor: theme.colors.danger,
        borderWidth: theme.components.card.borderWidth,
        padding: theme.spacing.md,
        borderRadius: theme.radii.xl,
        marginBottom: theme.spacing.md,
      },
      errorTitle: { color: theme.colors.danger, fontWeight: '600' },
      errorText: { color: theme.colors.danger, marginTop: theme.spacing.xs },
      successCard: {
        backgroundColor: withAlpha(theme.colors.success, 0.1),
        borderColor: theme.colors.success,
        borderWidth: theme.components.card.borderWidth,
        padding: theme.spacing.md,
        borderRadius: theme.radii.xl,
        marginBottom: theme.spacing.md,
      },
      successText: { color: theme.colors.success, fontWeight: '600' },
      assigneeOption: { paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.xs },
      assigneeText: { fontSize: theme.typography.sizes.md, color: theme.colors.text },
      copyBtn: {
        backgroundColor: withAlpha(theme.colors.primary, 0.08),
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radii.sm,
        borderWidth: theme.components.card.borderWidth,
        borderColor: withAlpha(theme.colors.primary, 0.35),
      },
      copyBtnText: { color: theme.colors.primary, fontWeight: '600' },
      modalContainer: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radii.lg,
        padding: theme.spacing.xl,
        width: `${Math.round((theme.components?.modal?.widthPct ?? 0.9) * 100)}%`,
        alignSelf: 'center',
        maxWidth: theme.components?.modal?.maxWidth ?? 400,
      },
      modalContainerFull: {
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: theme.radii.xl,
        borderTopRightRadius: theme.radii.xl,
        padding: theme.spacing.xl,
        width: '100%',
      },
      modalTitle: {
        fontSize: theme.typography.sizes.lg,
        fontWeight: '600',
        marginBottom: theme.spacing.md,
      },
      modalText: {
        fontSize: theme.typography.sizes.md,
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.xl,
      },
      modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.md },
      helperError: {
        color: theme.colors.danger,
        fontSize: theme.typography.sizes.xs,
        marginTop: theme.spacing.xs,
        marginLeft: theme.spacing.md,
      },
      centeredModal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
    });
  }, [theme, formStyles]);

  const roleColor = React.useCallback(
    (r) => {
      if (r === ROLE.ADMIN) return theme.colors.primary;
      if (r === ROLE.DISPATCHER) return theme.colors.success;
      if (r === ROLE.WORKER) return theme.colors.worker || theme.colors.primary;
      return theme.colors.textSecondary;
    },
    [theme],
  );
  const {
    success: toastSuccess,
    error: toastError,
    info: toastInfo,
    setAnchorOffset,
    loading: toastLoading,
    promise: toastPromise,
  } = useToast();

  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;

  const [meIsAdmin, setMeIsAdmin] = useState(false);
  const [meId, setMeId] = useState(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const canEdit = meIsAdmin || (meId && meId === userId);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [initialAvatarUrl, setInitialAvatarUrl] = useState(null); // Изначальный аватар из БД
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState(null); // Временный аватар до сохранения
  const avatarSaveTimestampRef = useRef(0); // Timestamp последнего сохранения аватара
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [avatarKey, setAvatarKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const headerName = useMemo(() => {
    const name = `${firstName || ''} ${lastName || ''}`.replace(/\s+/g, ' ').trim();
    return name || t('placeholder_no_name');
  }, [firstName, lastName, t]);
  const [birthdate, setBirthdate] = useState(null);
  const [departmentId, setDepartmentId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [deptModalVisible, setDeptModalVisible] = useState(false);
  const activeDeptName = useMemo(() => {
    const d = (departments || []).find((x) => String(x.id) === String(departmentId));
    return d ? d.name : null;
  }, [departments, departmentId]);
  const [withYear, setWithYear] = useState(true);
  const [dobModalVisible, setDobModalVisible] = useState(false);
  const [confirmPwdVisible, setConfirmPwdVisible] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const [focusLast, setFocusLast] = useState(false);
  const [focusEmail, setFocusEmail] = useState(false);
  const [focusPhone, setFocusPhone] = useState(false);
  const [focusPwd, setFocusPwd] = useState(false);
  const [role, setRole] = useState(ROLE.WORKER);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showRoles, setShowRoles] = useState(false);

  const [err, setErr] = useState('');
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  const ensureCameraPerms = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    return status === 'granted';
  };
  const ensureLibraryPerms = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === 'granted';
  };
  const uploadAvatar = async (uri) => {
    try {
      const resp = await fetch(uri);
      const ab = await resp.arrayBuffer();
      const fileData = new Uint8Array(ab);
      const filename = `${AVA_PREFIX}${Date.now()}.jpg`;
      const path = `${STORAGE.AVATAR_PREFIX}/${userId}/${filename}`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE.AVATARS)
        .upload(path, fileData, { contentType: AVA_MIME, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(STORAGE.AVATARS).getPublicUrl(path);
      const publicUrl = pub?.publicUrl || null;
      // Не обновляем БД сразу, только сохраняем временный URL
      setPendingAvatarUrl(publicUrl);
      setAvatarUrl(publicUrl);
      toastInfo(t('toast_avatar_pending'));
    } catch (e) {
      setErr(e?.message || t('toast_generic_error'));
    }
  };
  const deleteAvatar = async () => {
    try {
      setErr('');
      // Устанавливаем пустую строку для явного указания на удаление
      // null означает "нет изменений", '' означает "удалить"
      setPendingAvatarUrl('');
      setAvatarUrl(null);
      toastInfo(t('toast_avatar_pending'));
    } catch (e) {
      setErr(e?.message || t('toast_generic_error'));
    }
  };
  const pickFromCamera = async () => {
    const okCam = await ensureCameraPerms();
    if (!okCam) {
      setErr(t('error_camera_denied'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: MEDIA_QUALITY,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) {
      await uploadAvatar(res.assets[0].uri);
    }
  };
  const pickFromLibrary = async () => {
    const okLib = await ensureLibraryPerms();
    if (!okLib) {
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
    if (!res.canceled && res.assets && res.assets[0]?.uri) {
      await uploadAvatar(res.assets[0].uri);
    }
  };
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelKey, setCancelKey] = useState(0);
  const [warningVisible, setWarningVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [initialSnap, setInitialSnap] = useState(null);
  const [isSuspended, setIsSuspended] = useState(false);
  const [suspendVisible, setSuspendVisible] = useState(false);
  const [unsuspendVisible, setUnsuspendVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [totalOrdersCount, setTotalOrdersCount] = useState(0);
  const [ordersAction, setOrdersAction] = useState('keep');
  const [successor, setSuccessor] = useState(null);
  const [successorError, setSuccessorError] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerReturn, setPickerReturn] = useState(null); // 'delete' | 'suspend' | null
  const scrollRef = useRef(null);
  const pwdRef = useRef(null);
  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const phoneRef = useRef(null);
  const dobFieldRef = useRef(null);
  const deptFieldRef = useRef(null);
  const roleFieldRef = useRef(null);
  const statusFieldRef = useRef(null);
  const insets = useSafeAreaInsets();
  const scrollYRef = useRef(0);
  const headerHeight = theme?.components?.header?.height ?? 56;

  const isDirty = useMemo(() => {
    if (!initialSnap) return false;
    const current = JSON.stringify({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: String(phone).replace(/\D/g, '') || '',
      birthdate: birthdate ? __ymdLocal(birthdate) : null,
      role,
      newPassword: newPassword || null,
      departmentId: departmentId || null,
      isSuspended: !!isSuspended,
    });
    return current !== initialSnap;
  }, [firstName, lastName, email, phone, birthdate, role, newPassword, isSuspended, initialSnap]);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (allowLeaveRef.current) return false;
        if (isDirty) {
          setCancelKey((k) => k + 1);
          setCancelVisible(true);
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [isDirty]),
  );
  useFocusEffect(
    useCallback(() => {
      fetchDepartments();
      return () => {};
    }, [fetchDepartments]),
  );
  const allowLeaveRef = useRef(false);
  const autoClearLoadingRef = useRef(null);
  useEffect(() => {
    if (loading || !meLoaded) {
      autoClearLoadingRef.current = setTimeout(
        () => setLoading(false),
        theme.timings?.requestTimeoutMs ?? 12000,
      );
    }
    return () => {
      if (autoClearLoadingRef.current) clearTimeout(autoClearLoadingRef.current);
    };
  }, [loading]);
  const showWarning = (msg) => {
    setWarningMessage(String(msg || t('dlg_generic_warning')));
    setWarningVisible(true);
  };
  const confirmCancel = () => {
    setCancelVisible(false);
    // Восстанавливаем изначальный аватар при отмене
    setAvatarUrl(initialAvatarUrl);
    setPendingAvatarUrl(null);
    allowLeaveRef.current = true;
    if (navigation && typeof navigation.goBack === 'function') {
      navigation.goBack();
    } else if (router && typeof router.back === 'function') {
      router.back();
    }
  };
  const handleCancelPress = () => {
    if (isDirty) {
      setCancelKey((k) => k + 1);
      setCancelVisible(true);
      return;
    }
    allowLeaveRef.current = true;
    if (navigation && typeof navigation.goBack === 'function') {
      navigation.goBack();
    } else if (router && typeof router.back === 'function') {
      router.back();
    }
  };

  const proceedSave = async () => {
    try {
      setSaving(true);
      setErr('');
      toastInfo(t('toast_saving'), { sticky: true });

      // Сохраняем изменения аватара в БД только если есть реальные изменения
      // pendingAvatarUrl === null означает "нет изменений", а не "удалить"
      if (pendingAvatarUrl !== null && pendingAvatarUrl !== initialAvatarUrl) {
        try {
          if (pendingAvatarUrl === '') {
            // Пользователь явно удалил аватар (через deleteAvatar)
            const prefix = `${STORAGE.AVATAR_PREFIX}/${userId}`;
            const { data: list, error: listErr } = await supabase.storage
              .from(STORAGE.AVATARS)
              .list(prefix);
            if (!listErr && Array.isArray(list) && list.length) {
              const paths = list.map((f) => `${prefix}/${f.name}`);
              // Попытка удалить файлы — ошибка не критична, продолжаем дальше
              try {
                await supabase.storage.from(STORAGE.AVATARS).remove(paths);
              } catch (_) {
                // Игнорируем ошибку удаления файлов
              }
            }
            const { error: updErr } = await supabase
              .from(TABLES.profiles)
              .update({ avatar_url: null })
              .eq('id', userId);
            if (updErr) throw updErr;
          } else {
            // Обновляем аватар в БД
            const { error: updErr } = await supabase
              .from(TABLES.profiles)
              .update({ avatar_url: pendingAvatarUrl })
              .eq('id', userId);
            if (updErr) throw updErr;
          }
        } catch (avatarErr) {
          // Если ошибка только в удалении аватара, но профиль обновился — не бросаем ошибку
          // иначе бросаем
          const msg = avatarErr?.message || String(avatarErr);
          if (!msg.includes('avatar') && !msg.includes('storage')) {
            throw avatarErr;
          }
          // Ошибка аватара не критична, продолжаем
        }
        // Обновляем все состояния аватара после успешного сохранения
        // Если удалили (pendingAvatarUrl === ''), сохраняем null как финальное значение
        const finalAvatarUrl = pendingAvatarUrl === '' ? null : pendingAvatarUrl;
        setAvatarUrl(finalAvatarUrl);
        setInitialAvatarUrl(finalAvatarUrl);
        setPendingAvatarUrl(null);
        // Запоминаем время сохранения для защиты от race condition
        avatarSaveTimestampRef.current = Date.now();
      }

      // Если админ редактирует другого пользователя — используем edge-функцию для всего
      const computedFullName = buildFullName(firstName, lastName);
      const normalizedFullName = computedFullName || null;

      if (meIsAdmin && meId && userId && meId !== userId && APP_FUNCTIONS.UPDATE_USER) {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
        const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/${APP_FUNCTIONS.UPDATE_USER || ''}`;

        const body = {
          user_id: userId,
          email: String(email || '').trim() || undefined,
          password: newPassword && newPassword.length ? newPassword : undefined,
          role,
          profile: {
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            full_name: normalizedFullName,
            phone: String(phone || '').replace(/\D/g, '') || null,
            birthdate: birthdate ? __ymdLocal(birthdate) : null,
            department_id: departmentId || null,
          },
        };

        try {
          const res = await fetch(FN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
          });

          // Если статус не успешный — бросаем ошибку сразу
          if (!res.ok) {
            let errMsg = null;
            try {
              const text = await res.text();
              if (text) {
                try {
                  const result = JSON.parse(text);
                  errMsg = result?.message || result?.error || result?.details || null;
                } catch (e) {}
              }
            } catch (e) {}
            throw new Error(errMsg || `HTTP ${res.status}`);
          }
          // Если статус успешный — пытаемся прочитать ответ, но если не удалось — игнорируем
          let result = null;
          try {
            const text = await res.text();
            if (text) {
              try {
                result = JSON.parse(text);
              } catch (e) {
                // Невалидный JSON, но статус успешный — игнорируем
              }
            }
          } catch (e) {
            // Не удалось прочитать тело, но статус успешный — игнорируем
          }
          // Только если статус успешный и явно result.ok === false — бросаем
          if (result && result.ok === false) {
            const msg = result?.message || result?.error || result?.details || null;
            throw new Error(msg || t('error_profile_not_updated'));
          }
        } catch (fetchErr) {
          // ВАЖНО: Если ошибка "Network request failed" - игнорируем, т.к. запрос мог дойти до сервера
          const errMsg = String(fetchErr?.message || '');
          if (errMsg.toLowerCase().includes('network request failed')) {
            console.warn('Admin update failed with network error, assuming server processed it');
            // Не бросаем ошибку, считаем что сервер обработал запрос
          } else {
            // Другие ошибки пробрасываем
            throw fetchErr;
          }
        }
      } else {
        // Пользователь редактирует себя — прямое обновление профиля
        const payload = {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          full_name: normalizedFullName,
          phone: String(phone || '').replace(/\D/g, '') || null,
          birthdate: birthdate ? __ymdLocal(birthdate) : null,
          department_id: meIsAdmin ? departmentId || null : undefined,
        };
        Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

        const { data: updRows, error: updProfileErr } = await supabase
          .from(TABLES.profiles)
          .update(payload)
          .eq('id', userId)
          .select('id');

        if (updProfileErr) throw updProfileErr;
        if (!Array.isArray(updRows) || updRows.length === 0) {
          throw new Error(t('error_profile_not_updated'));
        }

        // Обновление email/password через edge-функцию (если заполнены)
        if ((String(email || '').trim() || newPassword) && APP_FUNCTIONS.UPDATE_USER) {
          try {
            const { data: sess } = await supabase.auth.getSession();
            const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
            const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/${APP_FUNCTIONS.UPDATE_USER || ''}`;

            const body = {
              user_id: userId,
              email: String(email || '').trim() || undefined,
              password: newPassword && newPassword.length ? newPassword : undefined,
            };

            const res = await fetch(FN_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(body),
            });

            if (!res.ok) {
              let errMsg = null;
              try {
                const text = await res.text();
                if (text) {
                  try {
                    const result = JSON.parse(text);
                    errMsg = result?.message || result?.error || result?.details || null;
                  } catch (e) {}
                }
              } catch (e) {}
              throw new Error(errMsg || `HTTP ${res.status}`);
            }
            let result = null;
            try {
              const text = await res.text();
              if (text) {
                try {
                  result = JSON.parse(text);
                } catch (e) {}
              }
            } catch (e) {}
            if (result && result.ok === false) {
              const msg = result?.message || result?.error || result?.details || null;
              throw new Error(msg || t('error_auth_update_failed'));
            }
          } catch (fetchErr) {
            // ВАЖНО: Профиль УЖЕ обновлен выше, поэтому ошибка обновления email/password
            // не должна блокировать успешное завершение. Игнорируем сетевые ошибки.
            const errMsg = String(fetchErr?.message || '');
            if (errMsg.toLowerCase().includes('network request failed')) {
              // Игнорируем сетевую ошибку — профиль уже обновлен
              console.warn('Email/password update failed with network error, but profile was updated');
            } else {
              // Другие ошибки (не сетевые) — пробрасываем
              throw fetchErr;
            }
          }
        }
      }

      setNewPassword('');
      setConfirmPwdVisible(false);
      setPendingSave(false);
      setInitialSnap(
        JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: String(email || '').trim(),
          phone: String(phone || '').replace(/\D/g, '') || '',
          birthdate: birthdate ? __ymdLocal(birthdate) : null,
          role,
          newPassword: null,
          departmentId: departmentId || null,
          isSuspended,
        }),
      );
      allowLeaveRef.current = true;
      toastSuccess(t('toast_success'));
    } catch (e) {
      setErr(e?.message || t('error_save_failed'));
      toastError(e?.message || t('error_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = useCallback(async () => {
    Keyboard.dismiss(); // Закрываем клавиатуру при сохранении
    setErr('');
    setSubmittedAttempt(true);
    if (!firstName.trim()) {
      showWarning(t('err_first_name'));
      return;
    }
    if (!lastName.trim()) {
      showWarning(t('err_last_name'));
      return;
    }
    if (!emailValid) {
      showWarning(t('err_email'));
      return;
    }
    if (String(phone || '').trim() && !isValidPhone(String(phone || ''))) {
      showWarning(t('err_phone'));
      return;
    }
    if (!passwordValid) {
      showWarning(t('err_password_short'));
      return;
    }
    if (newPassword && newPassword.length > 0) {
      setPendingSave(true);
      setConfirmPwdVisible(true);
      return;
    }
    await proceedSave();
  }, [
    firstName,
    lastName,
    emailValid,
    phone,
    passwordValid,
    newPassword,
    showWarning,
    t,
    proceedSave,
    setErr,
    setSubmittedAttempt,
    setPendingSave,
    setConfirmPwdVisible,
  ]);

  const cancelRef = useRef(null);

  const onPressCancel = React.useCallback(() => {
    if (cancelRef.current) return cancelRef.current();
  }, []);

  useEffect(() => {
    cancelRef.current = handleCancelPress;
  });

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || !isDirty) return;
      e.preventDefault();
      setCancelKey((k) => k + 1);
      setCancelVisible(true);
    });
    return sub;
  }, [navigation, isDirty]);
  useEffect(() => {
    if (initialSnap) {
      allowLeaveRef.current = false;
    }
  }, [firstName, lastName, email, phone, birthdate, role, newPassword, isSuspended, departmentId]);
  const passwordValid = useMemo(
    () => newPassword.length === 0 || newPassword.length >= 6,
    [newPassword],
  );
  const emailValid = useMemo(() => isValidEmailStrict(email), [email]);
  const fetchDepartments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from(TABLES.departments)
        .select('id, name')
        .order('name', { ascending: true });
      if (error) throw error;
      setDepartments(Array.isArray(data) ? data : []);
    } catch (e) {}
  }, []);
  const fetchMe = useCallback(async () => {
    const { data: authUser } = await supabase.auth.getUser();
    const uid = authUser?.user?.id;
    if (!uid) {
      setMeLoaded(true);
      return;
    }
    setMeId(uid);
    const { data: me } = await supabase
      .from(TABLES.profiles)
      .select('id, role')
      .eq('id', uid)
      .single();
    setMeIsAdmin(me?.role === ROLE.ADMIN);
    setMeLoaded(true);
  }, []);
  const formatName = (p) => {
    const n1 = (p.first_name || '').trim();
    const n2 = (p.last_name || '').trim();
    const fn = (p.full_name || '').trim();
    const name =
      n1 || n2 ? `${n1} ${n2}`.replace(/\s+/g, ' ').trim() : fn || t('placeholder_no_name');
    return name;
  };
  const buildFullName = (first, last) => {
    const parts = [(first || '').trim(), (last || '').trim()].filter(Boolean);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  const fetchUser = useCallback(async () => {
    setLoading(true);
    try {
      let adminRow = null;
      if (meIsAdmin) {
        const { data, error } = await supabase.rpc(FN_GET_PROFILE, { target_user_id: userId });
        if (error) throw error;
        adminRow = Array.isArray(data) ? data[0] : data;
        setEmail(adminRow?.email || '');
        setRole(adminRow?.user_role || ROLE.WORKER);
        if (adminRow?.birthdate) {
          const d = new Date(adminRow.birthdate);
          setBirthdate(!isNaN(d.getTime()) ? d : null);
        } else {
          setBirthdate(null);
        }
      } else {
        const { data: auth } = await supabase.auth.getUser();
        if (auth?.user?.id === userId) setEmail(auth?.user?.email || '');
      }

      const { data: prof } = await supabase
        .from(TABLES.profiles)
        .select(
          'first_name, last_name, full_name, phone, is_suspended, suspended_at, avatar_url, department_id, role, birthdate',
        )
        .eq('id', userId)
        .maybeSingle();

      if (prof) {
        setFirstName(prof.first_name || '');
        setLastName(prof.last_name || '');
        setDepartmentId(prof?.department_id ?? null);
        if (typeof prof.avatar_url !== 'undefined') {
          // Защита от race condition: не обновляем аватар в течение 3 секунд после сохранения
          const timeSinceLastSave = Date.now() - (avatarSaveTimestampRef.current || 0);
          const AVATAR_SAVE_PROTECTION_MS = 3000; // 3 секунды

          if (timeSinceLastSave < AVATAR_SAVE_PROTECTION_MS) {
            // Недавно сохранили аватар, пропускаем обновление из БД
            return;
          }

          // Сохраняем текущий pendingAvatarUrl чтобы не потерять его при Realtime обновлениях
          setPendingAvatarUrl((current) => {
            // Если есть временный аватар (загружен или помечен на удаление), сохраняем его
            // current === '' означает "пользователь удалил, но не сохранил"
            // current === "url" означает "пользователь загрузил, но не сохранил"
            if (current !== null) {
              // Для отображения: если помечен на удаление (''), показываем null
              setAvatarUrl(current === '' ? null : current);
              setInitialAvatarUrl(prof.avatar_url || null);
              return current;
            }
            // Иначе используем аватар из БД
            setAvatarUrl(prof.avatar_url || null);
            setInitialAvatarUrl(prof.avatar_url || null);
            return null;
          });
        }
        if (typeof prof.phone !== 'undefined')
          setPhone(String(prof.phone || '').replace(/\D/g, ''));
        setIsSuspended(!!(prof?.is_suspended || prof?.suspended_at));
        if (!meIsAdmin && prof?.birthdate) {
          const d = new Date(prof.birthdate);
          setBirthdate(!isNaN(d.getTime()) ? d : null);
        }
        if (!meIsAdmin) setRole(prof.role || ROLE.WORKER);
      }

      setInitialSnap(
        JSON.stringify({
          firstName: (prof?.first_name || '').trim(),
          lastName: (prof?.last_name || '').trim(),
          email: (meIsAdmin ? adminRow?.email || '' : email).trim?.() || '',
          phone: String(prof?.phone || '').replace(/\D/g, '') || '',
          birthdate: (meIsAdmin ? adminRow?.birthdate : prof?.birthdate || null)
            ? String(meIsAdmin ? adminRow?.birthdate : prof?.birthdate)
            : null,
          role: meIsAdmin ? adminRow?.user_role || ROLE.WORKER : prof?.role || ROLE.WORKER,
          newPassword: null,
          departmentId: prof?.department_id ?? null,
          isSuspended: !!(prof?.is_suspended || prof?.suspended_at),
        }),
      );
    } catch (e) {
      setErr(e?.message || t('toast_generic_error'));
      toastError(e?.message || t('toast_generic_error'));
    } finally {
      setLoading(false);
    }
  }, [userId, meIsAdmin, email]);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (meLoaded) {
      fetchUser();
      fetchDepartments();
    }
  }, [meLoaded, fetchUser, fetchDepartments]);
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`${RT_PREFIX}${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        () => {
          fetchUser();
          fetchDepartments();
        },
      )
      .subscribe();
    return () => {
      try {
        channel.unsubscribe();
      } catch {}
    };
  }, [userId, fetchUser, fetchDepartments]);
  const reassignActiveOrders = async (fromUserId, toUserId) => {
    // Переназначаем ВСЕ заявки, независимо от статуса
    const { error } = await supabase
      .from(TABLES.orders)
      .update({ assigned_to: toUserId })
      .eq('assigned_to', fromUserId);
    return error;
  };
  const reassignAllOrders = async (fromUserId, toUserId) => {
    const { error } = await supabase
      .from(TABLES.orders)
      .update({ assigned_to: toUserId })
      .eq('assigned_to', fromUserId);
    return error;
  };
  const setSuspended = async (uid, value) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const supabaseUrl = supabase.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
      const FN_URL = `${supabaseUrl}/functions/v1/${APP_FUNCTIONS.UPDATE_USER || ''}`;
      if (
        APP_FUNCTIONS.UPDATE_USER &&
        FN_URL &&
        FN_URL.includes('/functions/v1/') &&
        FN_URL.startsWith('http')
      ) {
        try {
          const res = await fetch(FN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              user_id: uid,
              is_suspended: !!value,
              suspended_at: value ? new Date().toISOString() : null,
            }),
          });
        } catch (e) {}
      }
      const { error: updErr } = await supabase
        .from(TABLES.profiles)
        .update({ is_suspended: !!value, suspended_at: value ? new Date().toISOString() : null })
        .eq('id', uid);
      return updErr ?? null;
    } catch (e) {
      const { error } = await supabase
        .from(TABLES.profiles)
        .update({ is_suspended: !!value, suspended_at: value ? new Date().toISOString() : null })
        .eq('id', uid);
      return error ?? e;
    }
  };
  const onAskSuspend = async () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return; // не для себя

    try {
      setErr('');
      toastInfo(t('toast_loading_info'), { sticky: true });

      // Вызываем edge function для проверки заявок
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const supabaseUrl = supabase.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
      const checkUrl = `${supabaseUrl}/functions/v1/check_employee_orders`;

      const checkRes = await fetch(checkUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });

      if (!checkRes.ok) {
        const errData = await checkRes.json().catch(() => ({}));
        throw new Error(errData.error || `Ошибка проверки заявок (${checkRes.status})`);
      }

      const { activeOrdersCount, availableEmployees } = await checkRes.json();

      // Сохраняем количество заявок и список доступных сотрудников
      setActiveOrdersCount(activeOrdersCount || 0);
      setPickerItems(availableEmployees || []);
      setOrdersAction('keep');
      setSuccessor(null);
      setSuccessorError('');
      setSuspendVisible(true);
    } catch (e) {
      console.error('Ошибка при проверке заявок:', e);
      setErr(e?.message || t('err_check_orders_failed'));
      toastError(e?.message || t('err_check_orders_failed'));
    }
  };
  
  const loadAvailableEmployees = async () => {
    try {
      // Загружаем список активных сотрудников для выбора преемника
      const { data, error } = await supabase
        .from(TABLES.profiles)
        .select('id, first_name, last_name, full_name, role')
        .eq('is_suspended', false)
        .neq('id', userId) // исключаем самого сотрудника
        .order('full_name', { ascending: true });
      
      if (error) throw error;
      
      const employees = Array.isArray(data) ? data : [];
      setPickerItems(employees);
    } catch (e) {
      console.error('Ошибка загрузки сотрудников:', e);
      toastError('Не удалось загрузить список сотрудников');
    }
  };
  const onAskUnsuspend = () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return;
    setUnsuspendVisible(true);
  };
  const onConfirmSuspend = async () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return;
    try {
      setSaving(true);
      setErr('');
      toastInfo(t('toast_saving'), { sticky: true });
      if (ordersAction === 'reassign') {
        if (!successor?.id) {
          setSuccessorError(t('err_successor_required'));
          setSaving(false);
          return;
        }
        const errR = await reassignActiveOrders(userId, successor.id);
        if (errR) throw new Error(errR.message || t('toast_generic_error'));
      }
      const errS = await setSuspended(userId, true);
      if (errS) throw new Error(errS.message || t('toast_generic_error'));
      setIsSuspended(true);
      
      // Инвалидируем кеш users для мгновенного обновления списка
      globalCache.invalidate('users:');
      
      toastSuccess(t('toast_suspended'));
      setSuspendVisible(false);
      // Разрешаем выход без подтверждения (Apple-style: успешная операция)
      allowLeaveRef.current = true;
      setTimeout(() => router.back(), theme.timings?.backDelayMs ?? 300);
    } catch (e) {
      setErr(e?.message || t('dlg_generic_warning'));
      toastError(e?.message || t('dlg_generic_warning'));
    } finally {
      setSaving(false);
    }
  };
  const onConfirmUnsuspend = async () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return;
    try {
      setSaving(true);
      setErr('');
      toastInfo(t('toast_saving'), { sticky: true });
      const errS = await setSuspended(userId, false);
      if (errS) throw new Error(errS.message || t('err_unsuspend_failed'));
      setIsSuspended(false);
      
      // Инвалидируем кеш users для мгновенного обновления списка
      globalCache.invalidate('users:');
      
      toastSuccess(t('toast_unsuspended'));
      setUnsuspendVisible(false);
      // Разрешаем выход без подтверждения (Apple-style: успешная операция)
      allowLeaveRef.current = true;
      setTimeout(() => router.back(), theme.timings?.backDelayMs ?? 300);
    } catch (e) {
      setErr(e?.message || t('dlg_generic_warning'));
      toastError(e?.message || t('dlg_generic_warning'));
    } finally {
      setSaving(false);
    }
  };
  const onAskDelete = async () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return;

    try {
      setErr('');
      toastInfo(t('toast_loading_info'), { sticky: true });

      // Вызываем edge function для проверки заявок
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const supabaseUrl = supabase.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
      const checkUrl = `${supabaseUrl}/functions/v1/check_employee_orders`;

      console.log('[onAskDelete] checkUrl:', checkUrl);

      const checkRes = await fetch(checkUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });

      console.log('[onAskDelete] checkRes.ok:', checkRes.ok, 'status:', checkRes.status);

      if (!checkRes.ok) {
        const errData = await checkRes.json().catch(() => ({}));
        throw new Error(errData.error || `Ошибка проверки заявок (${checkRes.status})`);
      }

      const { activeOrdersCount, totalOrdersCount, availableEmployees } = await checkRes.json();

      console.log('[onAskDelete] activeOrdersCount:', activeOrdersCount);

      // Сохраняем количество заявок и список доступных сотрудников
      setActiveOrdersCount(activeOrdersCount || 0);
      setTotalOrdersCount(totalOrdersCount || 0);
      setPickerItems(availableEmployees || []);
      setSuccessor(null);
      setSuccessorError('');
      setDeleteVisible(true);
    } catch (e) {
      console.error('Ошибка при проверке заявок:', e);
      setErr(e?.message || t('err_check_orders_failed'));
      toastError(e?.message || t('err_check_orders_failed'));
    }
  };

  const onConfirmDelete = async () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return;

    // Если есть заявки, но преемник не выбран — показываем ошибку
    if (totalOrdersCount > 0 && !successor?.id) {
      setSuccessorError(t('err_successor_required_delete'));
      return;
    }

    try {
      setSaving(true);
      setErr('');
      toastInfo(t('toast_deleting_employee'), { sticky: true });

      // Вызываем edge function для деактивации
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const supabaseUrl = supabase.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
      const deleteUrl = `${supabaseUrl}/functions/v1/${APP_FUNCTIONS.DELETE_USER || 'delete_user'}`;

      console.log('[onConfirmDelete] deleteUrl:', deleteUrl);

      const deleteRes = await fetch(deleteUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: userId,
          reassign_to: successor?.id || null,
        }),
      });

      console.log('[onConfirmDelete] deleteRes.ok:', deleteRes.ok, 'status:', deleteRes.status);

      if (!deleteRes.ok) {
        const errData = await deleteRes.json().catch(() => ({}));
        throw new Error(
          errData.error ||
            errData.message ||
            t('err_delete_failed_status').replace('{status}', String(deleteRes.status)),
        );
      }

      const payload = await deleteRes.json().catch(() => null);
      if (payload && payload.ok === false) {
        throw new Error(payload.message || t('err_delete_failed'));
      }

      // Инвалидируем кеш users для мгновенного обновления списка
      globalCache.invalidate('users:');

      toastSuccess(t('toast_deleted'));
      setDeleteVisible(false);
      // Разрешаем выход без подтверждения (Apple-style: успешная операция)
      allowLeaveRef.current = true;
      setTimeout(() => router.back(), theme.timings?.backDelayMs ?? 300);
    } catch (e) {
      console.error('Ошибка деактивации:', e);
      setErr(e?.message || t('dlg_generic_warning'));
      toastError(e?.message || t('err_deactivate_failed'));
    } finally {
      setSaving(false);
    }
  };
  const openSuccessorPickerFromDelete = () => {
    setPickerReturn('delete');
    setDeleteVisible(false);
    loadAvailableEmployees();
    setPickerVisible(true);
  };
  const openSuccessorPickerFromSuspend = () => {
    setPickerReturn('suspend');
    setSuspendVisible(false);
    loadAvailableEmployees();
    setPickerVisible(true);
  };
  if (loading || !meLoaded) {
    return (
      <EditScreenTemplate scrollEnabled={false}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size={theme.components?.activityIndicator?.size ?? 'large'} />
        </View>
      </EditScreenTemplate>
    );
  }
  if (!canEdit) {
    return (
      <EditScreenTemplate scrollEnabled={false}>
        <View
          style={{
            padding: theme.spacing.lg,
            justifyContent: 'center',
            alignItems: 'center',
            flex: 1,
          }}
        >
          <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>
            {t('error_no_access')}
          </Text>
        </View>
      </EditScreenTemplate>
    );
  }
  const isSelfAdmin = meIsAdmin && meId === userId;
  const initials =
    `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}`.toUpperCase();
  return (
    <EditScreenTemplate
      title={t('header_edit_user')}
      rightTextLabel={saving ? t('toast_saving') : t('header_save')}
      onRightPress={handleSave}
      scrollRef={scrollRef}
      onScroll={(e) => {
        try {
          scrollYRef.current = e.nativeEvent.contentOffset.y || 0;
        } catch (_) {}
      }}
    >
      <View>
            <View
              style={[
                styles.card,
                styles.headerCard,
                isSuspended ? styles.headerCardSuspended : null,
              ]}
            >
              <View style={styles.headerRow}>
                <Pressable
                  style={styles.avatar}
                  onPress={() => {
                    setAvatarKey((k) => k + 1);
                    setAvatarSheet(true);
                  }}
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
                    <AntDesign name="camera" size={CAMERA_ICON} color={theme.colors.onPrimary} />
                  </View>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nameTitle}>{headerName}</Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: theme.spacing.sm,
                      marginTop: theme.spacing.xs,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <View
                      style={[
                        styles.rolePillHeader,
                        {
                          borderColor: withAlpha(
                            isSuspended ? theme.colors.danger : theme.colors.success,
                            0.2,
                          ),
                          backgroundColor: withAlpha(
                            isSuspended ? theme.colors.danger : theme.colors.success,
                            0.13,
                          ),
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.rolePillHeaderText,
                          { color: isSuspended ? theme.colors.danger : theme.colors.success },
                        ]}
                      >
                        {isSuspended ? t('status_suspended') : t('status_active')}
                      </Text>
                    </View>
                    {role === ROLE.ADMIN ? (
                      <View
                        style={[
                          styles.rolePillHeader,
                          {
                            borderColor: withAlpha(roleColor('admin'), 0.2),
                            backgroundColor: withAlpha(roleColor('admin'), 0.13),
                          },
                        ]}
                      >
                        <Text style={[styles.rolePillHeaderText, { color: roleColor('admin') }]}>
                          {t('role_admin')}
                        </Text>
                      </View>
                    ) : (
                      !isSelfAdmin && (
                        <View
                          style={[
                            styles.rolePillHeader,
                            {
                              borderColor: withAlpha(roleColor(role), 0.2),
                              backgroundColor: withAlpha(roleColor(role), 0.13),
                            },
                          ]}
                        >
                          <Text style={[styles.rolePillHeaderText, { color: roleColor(role) }]}>
                            {t(`role_${role}`)}
                          </Text>
                        </View>
                      )
                    )}
                  </View>
                </View>
              </View>
            </View>
            {err ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>{t('dlg_alert_title')}</Text>
                <Text style={styles.errorText}>{err}</Text>
              </View>
            ) : null}
            <SectionHeader topSpacing="xs" bottomSpacing="xs">
              {t('section_personal')}
            </SectionHeader>
            <Card>
              <TextField
                ref={firstNameRef}
                label={t('label_first_name')}
                placeholder={t('placeholder_first_name')}
                placeholderTextColor={theme.colors.inputPlaceholder}
                style={styles.field}
                value={firstName}
                onChangeText={setFirstName}
                onFocus={() => {
                  setFocusFirst(true);
                  ensureVisibleField({
                    fieldRef: firstNameRef,
                    scrollRef,
                    scrollYRef,
                    insetsBottom: insets.bottom ?? 0,
                    headerHeight,
                  });
                }}
                onBlur={() => setFocusFirst(false)}
                forceValidation={submittedAttempt}
                error={!firstName.trim() ? 'required' : undefined}
              />
              <TextField
                ref={lastNameRef}
                label={t('label_last_name')}
                placeholder={t('placeholder_last_name')}
                placeholderTextColor={theme.colors.inputPlaceholder}
                style={styles.field}
                value={lastName}
                onChangeText={setLastName}
                onFocus={() => {
                  setFocusLast(true);
                  ensureVisibleField({
                    fieldRef: lastNameRef,
                    scrollRef,
                    scrollYRef,
                    insetsBottom: insets.bottom ?? 0,
                    headerHeight,
                  });
                }}
                onBlur={() => setFocusLast(false)}
                forceValidation={submittedAttempt}
                error={!lastName.trim() ? 'required' : undefined}
              />
              <TextField
                ref={emailRef}
                label={t('label_email')}
                placeholder={t('placeholder_email')}
                placeholderTextColor={theme.colors.inputPlaceholder}
                style={styles.field}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                onFocus={() => {
                  setFocusEmail(true);
                  ensureVisibleField({
                    fieldRef: emailRef,
                    scrollRef,
                    scrollYRef,
                    insetsBottom: insets.bottom ?? 0,
                    headerHeight,
                  });
                }}
                onBlur={() => setFocusEmail(false)}
                forceValidation={submittedAttempt}
                error={!emailValid ? 'invalid' : undefined}
              />
              <PhoneInput
                ref={phoneRef}
                value={phone}
                onChangeText={(val, meta) => {
                  setPhone(val);
                }}
                error={!isValidPhone(String(phone || '')) ? t('err_phone') : undefined}
                style={styles.field}
                onFocus={() => {
                  setFocusPhone(true);
                  ensureVisibleField({
                    fieldRef: phoneRef,
                    scrollRef,
                    scrollYRef,
                    insetsBottom: insets.bottom ?? 0,
                    headerHeight,
                  });
                }}
                onBlur={() => setFocusPhone(false)}
              />
              <TextField
                label={t('label_birthdate')}
                value={birthdate ? formatDateRU(birthdate, withYear) : t('placeholder_birthdate')}
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

            {meIsAdmin && (
              <>
                <SectionHeader bottomSpacing="xs">{t('section_company_role')}</SectionHeader>
                <Card>
                  <TextField
                    label={t('label_department')}
                    value={activeDeptName || t('placeholder_department')}
                    style={styles.field}
                    pressable
                    onPress={() => setDeptModalVisible(true)}
                  />

                  {!isSelfAdmin && (
                    <>
                      <TextField
                        label={t('label_role')}
                        value={ROLE_LABELS_LOCAL[role] || role}
                        style={styles.field}
                        pressable
                        onPress={() => setShowRoles(true)}
                      />
                    </>
                  )}
                </Card>
              </>
            )}

            <SectionHeader bottomSpacing="xs">{t('section_password')}</SectionHeader>
            <Card>
              <View style={{ position: 'relative' }}>
                <TextField
                  ref={pwdRef}
                  onFocus={() => {
                    setFocusPwd(true);
                    ensureVisibleField({
                      fieldRef: pwdRef,
                      scrollRef,
                      scrollYRef,
                      insetsBottom: insets.bottom ?? 0,
                      headerHeight,
                    });
                  }}
                  onBlur={() => setFocusPwd(false)}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder={t('placeholder_new_password')}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={undefined}
                  style={styles.field}
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
                      {!!newPassword && (
                        <IconButton
                          onPress={async () => {
                            await Clipboard.setStringAsync(newPassword || '');
                            toastSuccess(t('toast_password_copied'));
                          }}
                          accessibilityLabel={t('a11y_copy_password')}
                          size={ICONBUTTON_TOUCH}
                        >
                          <Feather name="copy" size={ICON_SM} />
                        </IconButton>
                      )}
                    </View>
                  }
                />
              </View>
            </Card>

            {meIsAdmin && meId !== userId && !isSuspended && (
              <UIButton
                title={t('btn_suspend')}
                variant="secondary"
                onPress={onAskSuspend}
                style={{ alignSelf: 'stretch', marginTop: theme.spacing.sm }}
              />
            )}

            {meIsAdmin && meId !== userId && isSuspended && (
              <UIButton
                title={t('dlg_unsuspend_confirm')}
                variant="primary"
                onPress={onAskUnsuspend}
                style={{ alignSelf: 'stretch', marginTop: theme.spacing.sm }}
              />
            )}

            {meIsAdmin && meId !== userId && (
              <UIButton
                title={t('btn_delete_employee')}
                variant="destructive"
                onPress={onAskDelete}
                style={{ alignSelf: 'stretch', marginTop: theme.spacing.sm }}
              />
            )}

            {newPassword.length > 0 && !passwordValid ? (
              <Text
                style={{
                  marginTop: theme.spacing.xs,
                  color: theme.colors.danger,
                  fontSize: theme.typography.sizes.xs,
                }}
              >
                {t('err_password_short')}
              </Text>
            ) : null}

            {/* Exit without saving confirmation */}
            <ConfirmModal
              key={`cancel-${cancelKey}`}
              visible={cancelVisible}
              onClose={() => setCancelVisible(false)}
              title={t('dlg_leave_title')}
              message={t('dlg_leave_msg')}
              confirmLabel={t('dlg_leave_confirm')}
              cancelLabel={t('dlg_leave_cancel')}
              confirmVariant="destructive"
              onConfirm={confirmCancel}
            />
            {/* Alert message */}
            <AlertModal
              visible={warningVisible}
              onClose={() => setWarningVisible(false)}
              title={t('dlg_alert_title')}
              message={warningMessage}
              buttonLabel={t('dlg_ok')}
            />
            {/* Confirm password update */}
            <ConfirmModal
              visible={confirmPwdVisible}
              onClose={() => {
                setConfirmPwdVisible(false);
                setPendingSave(false);
              }}
              title={t('dlg_confirm_pwd_title')}
              message={t('dlg_confirm_pwd_msg')}
              confirmLabel={saving ? t('toast_saving') : t('header_save')}
              cancelLabel={t('header_cancel')}
              confirmVariant="primary"
              onConfirm={() => proceedSave()}
            />
            <SuspendModal
              visible={suspendVisible}
              activeOrdersCount={activeOrdersCount}
              ordersAction={ordersAction}
              setOrdersAction={setOrdersAction}
              successor={successor}
              successorError={successorError}
              setSuccessorError={setSuccessorError}
              openSuccessorPicker={openSuccessorPickerFromSuspend}
              onConfirm={onConfirmSuspend}
              saving={saving}
              onClose={() => setSuspendVisible(false)}
            />
            <ConfirmModal
              visible={unsuspendVisible}
              onClose={() => setUnsuspendVisible(false)}
              title={t('dlg_unsuspend_title')}
              message={t('dlg_unsuspend_msg')}
              confirmLabel={saving ? t('dlg_unsuspend_apply') : t('dlg_unsuspend_confirm')}
              cancelLabel={t('header_cancel')}
              confirmVariant="primary"
              onConfirm={onConfirmUnsuspend}
            />
            <DeleteEmployeeModal
              visible={deleteVisible}
              totalOrdersCount={totalOrdersCount}
              successor={successor}
              openSuccessorPicker={openSuccessorPickerFromDelete}
              onConfirm={onConfirmDelete}
              saving={saving}
              onClose={() => setDeleteVisible(false)}
            />

            <SelectModal
              visible={pickerVisible}
              title={t('picker_user_title')}
              items={(pickerItems || []).map((it) => {
                const displayName =
                  it.full_name ||
                  `${it.first_name || ''} ${it.last_name || ''}`.trim() ||
                  t('placeholder_no_name');
                const initials = `${(it.first_name || '').slice(0, 1)}${(it.last_name || '').slice(0, 1)}`.toUpperCase();
                const roleLabel = it.role ? t(`role_${it.role}`) : '';
                
                return {
                  id: it.id,
                  label: displayName,
                  subtitle: roleLabel,
                  role: it.role,
                  icon: (
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: withAlpha(theme.colors.primary, 0.15),
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: theme.typography.sizes.sm,
                          fontWeight: '600',
                          color: theme.colors.primary,
                        }}
                      >
                        {initials}
                      </Text>
                    </View>
                  ),
                };
              })}
              onSelect={(item) => {
                setSuccessor({ id: item.id, name: item.label, role: item.role || 'worker' });
                setSuccessorError('');
                setPickerVisible(false);
                if (pickerReturn === 'delete') setDeleteVisible(true);
                if (pickerReturn === 'suspend') setSuspendVisible(true);
                setPickerReturn(null);
              }}
              onClose={() => {
                setPickerVisible(false);
                if (pickerReturn === 'delete') setDeleteVisible(true);
                if (pickerReturn === 'suspend') setSuspendVisible(true);
                setPickerReturn(null);
              }}
              searchable={true}
              maxHeightRatio={0.8}
            />

            <AvatarSheetModal
              key={`avatar-${avatarKey}`}
              visible={avatarSheet}
              hasAvatar={!!avatarUrl}
              onTakePhoto={pickFromCamera}
              onPickFromLibrary={pickFromLibrary}
              onDeletePhoto={deleteAvatar}
              onClose={() => setAvatarSheet(false)}
            />
            <DepartmentSelectModal
              visible={deptModalVisible}
              departmentId={departmentId}
              departments={departments}
              onSelect={(id) => {
                setDepartmentId(id);
                setDeptModalVisible(false);
              }}
              onClose={() => setDeptModalVisible(false)}
            />
            {/* removed old department select dialog */}
            <RoleSelectModal
              visible={showRoles}
              role={role}
              roles={ROLES}
              roleLabels={ROLE_LABELS_LOCAL}
              roleDescriptions={ROLE_DESCRIPTIONS_LOCAL}
              onSelect={(r) => {
                setRole(r);
                setShowRoles(false);
              }}
              onClose={() => setShowRoles(false)}
            />
            {/* removed old role select dialog */}

            <DateTimeModal
              visible={dobModalVisible}
              onClose={() => setDobModalVisible(false)}
              mode="date"
              allowOmitYear={true}
              omitYearDefault={withYear}
              initial={birthdate || new Date()}
              onApply={(dateObj, extra) => {
                try {
                  // Preserve local date at 12:00 to avoid TZ rollbacks/forwards
                  let d = null;
                  const makeLocalNoon = (y, m, da) =>
                    new Date(Number(y), Number(m), Number(da), 12, 0, 0, 0);

                  if (dateObj instanceof Date && !isNaN(dateObj)) {
                    d = makeLocalNoon(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
                  } else if (
                    dateObj &&
                    typeof dateObj === 'object' &&
                    'year' in dateObj &&
                    'month' in dateObj &&
                    'day' in dateObj
                  ) {
                    // Prefer explicit extra.monthIndex (0..11) or extra.monthOneBased (1..12) when provided by picker.
                    const y = Number(dateObj.year);
                    let m = Number(dateObj.month);
                    const da = Number(dateObj.day);
                    if (extra && extra.monthIndex != null) {
                      m = Number(extra.monthIndex);
                    } else if (extra && extra.monthOneBased != null) {
                      m = Number(extra.monthOneBased) - 1;
                    } else {
                      // Defensive fallback: if month looks 1..12, convert to 0..11
                      if (m >= 1 && m <= 12) m = m - 1;
                    }
                    d = makeLocalNoon(y, m, da);
                  } else if (typeof dateObj === 'string') {
                    const m = dateObj.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                    if (m) d = makeLocalNoon(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
                  } else {
                    const tmp = new Date(dateObj);
                    if (!isNaN(tmp))
                      d = makeLocalNoon(tmp.getFullYear(), tmp.getMonth(), tmp.getDate());
                  }
                  if (d && !isNaN(d)) setBirthdate(d);
                  if (extra && typeof extra.withYear === 'boolean') setWithYear(extra.withYear);
                } finally {
                  setDobModalVisible(false);
                }
              }}
            />
      </View>
    </EditScreenTemplate>
  );
}

// ========== SuspendModal компонент ==========
function SuspendModal({
  visible,
  activeOrdersCount = 0,
  ordersAction = 'keep',
  setOrdersAction,
  successor,
  successorError,
  setSuccessorError,
  openSuccessorPicker,
  onConfirm,
  saving,
  onClose,
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();

  const hasActiveOrders = activeOrdersCount > 0;
  const bodyLineHeight = Math.round(
    theme.typography.sizes.sm * (theme.typography.lineHeights?.normal ?? 1.35),
  );
  
  const options = [
    {
      id: 'keep',
      title: t('user_block_keepOrders'),
      description: t('user_block_keepOrders_desc'),
    },
  ];
  
  // Добавляем опцию переназначения только если есть активные заявки
  if (hasActiveOrders) {
    options.push({
      id: 'reassign',
      title: t('user_block_reassign'),
      description: t('user_block_reassign_desc'),
    });
  }

  const footer = (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.md }}>
      <UIButton
        title={t('btn_cancel')}
        variant="outline"
        onPress={onClose}
        disabled={saving}
      />
      <UIButton
        title={saving ? t('btn_applying') : t('btn_apply')}
        variant="primary"
        onPress={onConfirm}
        disabled={saving || (ordersAction === 'reassign' && !successor?.id)}
      />
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={t('user_changeStatus_title')}
      maxHeightRatio={0.7}
      footer={footer}
    >
      {hasActiveOrders ? (
        <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={true}>
          {options.map((option) => {
            const isSelected = option.id === ordersAction;
            return (
              <Pressable
                key={option.id}
                onPress={() => {
                  setOrdersAction(option.id);
                  setSuccessorError('');
                }}
                android_ripple={{
                  color: theme?.colors?.border ?? '#00000020',
                  borderless: false,
                }}
                style={({ pressed }) => [
                  {
                    paddingVertical: theme.spacing.md,
                    paddingHorizontal: theme.spacing.md,
                    marginBottom: theme.spacing.md,
                    borderWidth: theme.components?.card?.borderWidth ?? 1,
                    borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                    borderRadius: theme.radii.lg,
                    backgroundColor: isSelected
                      ? withAlpha(theme.colors.primary, 0.08)
                      : theme.colors.surface,
                  },
                  pressed && Platform.OS === 'ios' ? { opacity: 0.7 } : null,
                ]}
              >
                {/* Заголовок опции */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: theme.spacing.xs,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: isSelected
                        ? theme.colors.primary
                        : theme.colors.border,
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginRight: theme.spacing.sm,
                    }}
                  >
                    {isSelected && (
                      <View
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: theme.colors.primary,
                        }}
                      />
                    )}
                  </View>
                  <Text
                    style={{
                      fontSize: theme.typography.sizes.md,
                      fontWeight: '600',
                      color: theme.colors.text,
                      flex: 1,
                    }}
                  >
                    {option.title}
                  </Text>
                </View>

                {/* Описание опции (видно только если выбрана) */}
                {isSelected && (
                  <Text
                    style={{
                      fontSize: theme.typography.sizes.sm,
                      color: theme.colors.textSecondary,
                      marginLeft: 32,
                      lineHeight: bodyLineHeight,
                      marginTop: theme.spacing.xs,
                    }}
                  >
                    {option.description}
                  </Text>
                )}

                {/* Выбор преемника для "reassign" */}
                {option.id === 'reassign' && isSelected && (
                  <View style={{ marginTop: theme.spacing.md, marginLeft: 32 }}>
                    <Pressable
                      onPress={openSuccessorPicker}
                      style={({ pressed }) => [
                        {
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingHorizontal: theme.spacing.md,
                          paddingVertical: theme.spacing.sm,
                          borderWidth: theme.components.card.borderWidth,
                          borderColor: successorError
                            ? theme.colors.danger
                            : withAlpha(theme.colors.text, 0.1),
                          borderRadius: theme.radii.lg,
                          backgroundColor: pressed
                            ? withAlpha(theme.colors.primary, 0.04)
                            : theme.colors.surface,
                        },
                      ]}
                    >
                      {/* Avatar */}
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 24,
                          backgroundColor: withAlpha(theme.colors.primary, 0.12),
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginRight: theme.spacing.md,
                          borderWidth: theme.components.card.borderWidth,
                          borderColor: withAlpha(theme.colors.primary, 0.2),
                        }}
                      >
                        <Text
                          style={{
                            fontSize: theme.typography.sizes.sm,
                            fontWeight: '600',
                            color: theme.colors.primary,
                          }}
                        >
                          {successor?.name
                            ? successor.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .toUpperCase()
                                .slice(0, 2)
                            : '?'}
                        </Text>
                      </View>

                      {/* Content */}
                      <View style={{ flex: 1 }}>
                        {successor?.name ? (
                          <>
                            <Text
                              numberOfLines={1}
                              style={{
                                fontSize: theme.typography.sizes.md,
                                fontWeight: '500',
                                color: theme.colors.text,
                              }}
                            >
                              {successor.name}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={{
                                fontSize: theme.typography.sizes.sm,
                                color: theme.colors.textSecondary,
                                marginTop: 2,
                              }}
                            >
                              {t(`role_${successor.role || 'worker'}`)}
                            </Text>
                          </>
                        ) : (
                          <Text
                            style={{
                              fontSize: theme.typography.sizes.md,
                              color: theme.colors.textSecondary,
                            }}
                          >
                            {t('placeholder_pick_employee')}
                          </Text>
                        )}
                      </View>

                      {/* Chevron Icon */}
                      <Feather
                        name="chevron-right"
                        size={24}
                        color={theme.colors.textSecondary}
                        style={{ marginLeft: theme.spacing.sm }}
                      />
                    </Pressable>

                    {successorError && (
                      <Text
                        style={{
                          color: theme.colors.danger,
                          fontSize: theme.typography.sizes.xs,
                          marginTop: theme.spacing.xs,
                        }}
                      >
                        {successorError}
                      </Text>
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View style={{ padding: theme.spacing.md }}>
          <Text
            style={{
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.textSecondary,
              lineHeight: bodyLineHeight,
            }}
          >
            {t('user_block_keepOrders_desc')}
          </Text>
        </View>
      )}
    </BaseModal>
  );
}

// ========== DeleteEmployeeModal компонент ==========
function DeleteEmployeeModal({
  visible,
  totalOrdersCount = 0,
  successor,
  openSuccessorPicker,
  onConfirm,
  saving,
  onClose,
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const bodyLineHeight = Math.round(
    theme.typography.sizes.sm * (theme.typography.lineHeights?.normal ?? 1.35),
  );

  const footer = (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.md }}>
      <UIButton
        title={t('btn_cancel')}
        variant="outline"
        onPress={onClose}
        disabled={saving}
      />
      <UIButton
        title={saving ? t('btn_deleting') : t('btn_delete')}
        variant="destructive"
        onPress={onConfirm}
        disabled={saving || (totalOrdersCount > 0 && !successor?.id)}
      />
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={t('user_delete_title')}
      maxHeightRatio={0.6}
      footer={footer}
    >
      {totalOrdersCount === 0 ? (
        <View style={{ paddingBottom: theme.spacing.md }}>
          <Text
            style={{
              fontSize: theme.typography.sizes.md,
              fontWeight: '500',
              color: theme.colors.text,
              marginBottom: theme.spacing.md,
            }}
          >
            {t('user_delete_no_orders_title')}
          </Text>
          <Text
            style={{
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.textSecondary,
              lineHeight: bodyLineHeight,
            }}
          >
            {t('user_delete_no_orders_desc')}
          </Text>
        </View>
      ) : !successor?.id ? (
        <>
          <View style={{ paddingBottom: theme.spacing.md }}>
            <Text
              style={{
                fontSize: theme.typography.sizes.md,
                fontWeight: '500',
                color: theme.colors.text,
                marginBottom: theme.spacing.md,
              }}
            >
              {t('user_delete_reassign_title')}
            </Text>
            <Text
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                lineHeight: bodyLineHeight,
              }}
            >
              {t('user_delete_reassign_desc').replace('{n}', String(totalOrdersCount))}
            </Text>
          </View>
          <UIButton
            title={t('placeholder_pick_employee')}
            variant="primary"
            onPress={openSuccessorPicker}
            size="sm"
          />
        </>
      ) : (
        <>
          <View style={{ paddingBottom: theme.spacing.md }}>
            <Text
              style={{
                fontSize: theme.typography.sizes.md,
                fontWeight: '500',
                color: theme.colors.text,
                marginBottom: theme.spacing.md,
              }}
            >
              {t('user_delete_reassigned_title')}
            </Text>
            <Text
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                marginBottom: theme.spacing.md,
                lineHeight: bodyLineHeight,
              }}
            >
              {t('user_delete_reassigned_desc').replace('{n}', String(totalOrdersCount))}
            </Text>
          </View>
          <View
            style={{
              backgroundColor: withAlpha(theme.colors.primary, 0.08),
              borderRadius: theme.radii.lg,
              padding: theme.spacing.md,
              marginBottom: theme.spacing.lg,
              borderWidth: theme.components?.card?.borderWidth ?? 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.text,
                fontWeight: '500',
                marginBottom: theme.spacing.xs,
              }}
            >
              {successor.name || t('placeholder_no_name')}
            </Text>
            <Text
              style={{
                fontSize: theme.typography.sizes.xs,
                color: theme.colors.textSecondary,
                marginTop: theme.spacing.xs,
              }}
            >
              {t(`role_${successor.role || 'worker'}`)}
            </Text>
          </View>
          <UIButton
            title={t('placeholder_pick_employee') || 'Выбрать другого'}
            variant="outline"
            onPress={openSuccessorPicker}
            size="sm"
          />
        </>
      )}
    </BaseModal>
  );
}
