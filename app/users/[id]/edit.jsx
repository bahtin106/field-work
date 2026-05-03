// app/users/[id]/edit.jsx

import { AntDesign, Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
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
import PhoneInput from '../../../components/ui/PhoneInput';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import SecurePasswordInput from '../../../components/SecurePasswordInput';
import { useToast } from '../../../components/ui/ToastProvider';
import { useFeedback, ScreenBanner, FieldErrorText, FEEDBACK_CODES, getMessageByCode } from '../../../src/shared/feedback';
import { queryKeys } from '../../../src/shared/query/queryKeys';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { BaseModal, ConfirmModal, DateTimeModal, SelectModal } from '../../../components/ui/modals';
import AvatarCropModal from '../../../components/ui/AvatarCropModal';
import {
  hasMobilePhoneValue,
  isValidOptionalMobilePhone,
  normalizeOptionalMobilePhone,
} from '../../../src/shared/validation/phone';
import {
  getEmailFieldError,
  normalizeOptionalEmail,
} from '../../../src/shared/validation/fields';
import { FUNCTIONS, TBL } from '../../../lib/constants';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';
import { supabase, EMAIL_SERVICE_URL } from '../../../lib/supabase';
import {
  updateCurrentUserPasswordViaBackend,
  updatePasswordViaBackend,
} from '../../../lib/passwordUpdateClient';
import { t as T, getDict, useI18nVersion } from '../../../src/i18n';
import { useDepartmentsQuery, useEmployee } from '../../../src/features/employees/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getOrderedEntityFields,
} from '../../../src/features/fieldSettings/catalog';
import { createEntityFieldPresentation } from '../../../src/features/fieldSettings/presentation';
import { useEntityFieldSettings } from '../../../src/features/fieldSettings/queries';
import { cleanupProfileMediaEntity, uploadProfileMedia } from '../../../src/features/profileMedia/api';
import { useMyCompanyIdQuery } from '../../../src/features/profile/queries';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import { useCompanySettings } from '../../../hooks/useCompanySettings';

const TABLES = {
  profiles: TBL.PROFILES || 'profiles',
  orders: TBL.ORDERS || 'orders',
  departments: TBL.DEPARTMENTS || 'departments',
};

const MIN_PASSWORD_LENGTH = Number(process.env.EXPO_PUBLIC_MIN_PASSWORD_LENGTH) || 8;
const RT_PREFIX = process.env.EXPO_PUBLIC_RT_USER_PREFIX || 'rt-user-';

// Helper: determine supported mediaTypes option across expo-image-picker versions
const getImagePickerMediaTypesImages = () => {
  try {
    // Use modern API only (MediaTypeOptions is deprecated and logs warnings).
    if (ImagePicker.MediaType && ImagePicker.MediaType.Images) return ImagePicker.MediaType.Images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.images) return ImagePicker.MediaType.images;
    if (ImagePicker.MediaType && ImagePicker.MediaType.image) return ImagePicker.MediaType.image;
  } catch {
    // ignore
  }
  return ['images'];
};

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
const __mdLocal = (d) => {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${m}-${da}`;
};
const __serializeBirthForSave = (d, withYearFlag) => {
  if (!(d instanceof Date) || isNaN(d)) return null;
  if (withYearFlag) return __ymdLocal(d);
  // use sentinel year 1900 (not shown in UI) to preserve Feb 29 handling
  const safe = new Date(1900, d.getMonth(), d.getDate());
  return __ymdLocal(safe);
};


const __parseLocalYMD = (val) => {
  try {
    if (!val) return { date: null, hasYear: false };
    if (val instanceof Date && !isNaN(val)) {
      return { date: new Date(val.getFullYear(), val.getMonth(), val.getDate()), hasYear: true };
    }
    const s = String(val).trim();
    // YYYY-MM-DD
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      // Treat sentinel year 1900 as 'no year' stored
      if (y === 1900) {
        return { date: new Date(new Date().getFullYear(), mo - 1, d), hasYear: false };
      }
      return { date: new Date(y, mo - 1, d), hasYear: true };
    }
    // MM-DD (no year stored)
    m = s.match(/^(\d{2})-(\d{2})$/);
    if (m) {
      const mo = Number(m[1]), d = Number(m[2]);
      // use current year for internal Date but mark hasYear=false
      return { date: new Date(new Date().getFullYear(), mo - 1, d), hasYear: false };
    }
    // Fallback: try Date(...) and normalize (assume has year)
    const d = new Date(val);
    if (isNaN(d)) return { date: null, hasYear: false };
    return { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), hasYear: true };
  } catch {
    return { date: null, hasYear: false };
  }
};
const __coercePickerDate = (v) => {
  try {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v)) {
      return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    if (typeof v === 'object' && v.year && v.month && v.day) {
      // month comes 1..12 from pickers вЂ” convert to JS 0..11
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
function _daysInMonth(monthIdx, yearNullable) {
  if (monthIdx === 1 && yearNullable == null) return 29;
  const y = yearNullable ?? new Date().getFullYear();
  return new Date(y, monthIdx + 1, 0).getDate();
}
function _range(a, b) {
  const arr = [];
  for (let i = a; i <= b; i++) arr.push(i);
  return arr;
}
function normalizeOptionalPhoneForSave(raw) {
  return normalizeOptionalMobilePhone(raw);
}

function hasPhoneValue(raw) {
  return hasMobilePhoneValue(raw);
}

function mapSaveErrorToMessage(error, t) {
  const raw = String(error?.message || error || '');
  const normalized = raw.toLowerCase();

  if (
    normalized.includes('new password should be different from the old password') ||
    normalized.includes('should be different from the old password')
  ) {
    return t('error_new_password_same_as_old');
  }
  if (normalized.includes('password-update-timeout')) {
    return t('errors_network');
  }
  if (normalized.includes('profile-update-timeout')) {
    return t('errors_network');
  }

  return raw || t('error_save_failed');
}

function isSamePasswordError(error) {
  const raw = String(error?.message || error || '');
  const normalized = raw.toLowerCase();
  return (
    normalized.includes('new password should be different from the old password') ||
    normalized.includes('should be different from the old password')
  );
}

async function withTimeout(promise, ms, timeoutMessage = 'timeout') {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function updateUserPasswordViaFunction({ userId, newPassword, changedBy }) {
  return updatePasswordViaBackend({
    userId,
    password: newPassword,
    changedBy,
  });
}

// === Lightweight wrappers for split modals (local to this screen) ===
function AvatarSheetModal({
  visible,
  hasAvatar,
  onTakePhoto,
  onPickFromLibrary,
  onDeletePhoto,
  onViewPhoto,
  onClose,
}) {
  const { t } = useTranslation();

  const { theme } = useTheme();
  const ICON_SM = theme.icons?.sm ?? 18;

  const chevron = (color) => (
    <Feather name="chevron-right" size={ICON_SM} color={color} />
  );

  const items = [
    { id: 'camera', label: t('profile_photo_take'), right: chevron(theme.colors.textSecondary) },
    { id: 'library', label: t('profile_photo_choose'), right: chevron(theme.colors.textSecondary) },
          ...(hasAvatar
      ? [
          { id: 'view', label: 'Просмотреть фото', right: chevron(theme.colors.textSecondary) },
          { id: 'delete', label: t('profile_photo_delete'), right: chevron(theme.colors.textSecondary) },
        ]
      : []),
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
          else if (it.id === 'library') onPickFromLibrary?.();
          else if (it.id === 'delete') onDeletePhoto?.();
          else if (it.id === 'view') onViewPhoto?.();
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
  const mapped = [
    { id: null, label: t('placeholder_department') },
    ...(departments || []).map((d) => ({ id: d.id, label: d.name })),
  ];
  return (
    <SelectModal
      visible={visible}
      title={t('user_department_title')}
      items={mapped}
      selectedId={departmentId}
      isItemSelected={(item, selectedId) =>
        item?.id == null ? selectedId == null : String(item?.id) === String(selectedId)
      }
      searchable={false}
      onSelect={(it) => onSelect?.(it.id)}
      onClose={onClose}
    />
  );
}

function RoleSelectModal({
  visible,
  role,
  roles = [],
  roleLabels: _roleLabels = {},
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
      searchable={false}
      onSelect={(it) => onSelect?.(it.id)}
      onClose={onClose}
    />
  );
}

// === end wrappers ===
export default function EditUser() {
  const toast = useToast();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const _ver = useI18nVersion();
  const queryClient = useQueryClient();
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
  const _MEDIA_ASPECT = Array.isArray(theme.media?.aspect) ? theme.media.aspect : [1, 1];
  const MEDIA_QUALITY = typeof theme.media?.quality === 'number' ? theme.media.quality : 0.85;

  const ICON_MD = theme.icons?.md ?? 22;
  const _ICON_SM = theme.icons?.sm ?? 18;
  const ICONBUTTON_TOUCH = theme.components?.iconButton?.size ?? 32;
  const _TRAILING_WIDTH =
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
  const _RADIO_DOT =
    theme.components?.radio?.dot ??
    Math.max(theme.components?.radio?.dotMin ?? 6, Math.round(RADIO_SIZE / 2 - 3));
  const _TOAST_MAX_W = theme.components?.toast?.maxWidth ?? 440;
  const _base = React.useMemo(() => listItemStyles(theme), [theme]);
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
      // section: РёСЃРїРѕР»СЊР·СѓРµРј base.sectionTitle РёР· listItemStyles
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
    banner,
    showBanner,
    clearBanner,
    showSuccessToast,
    showErrorToast: _showErrorToast,
    showInfoToast,
  } = useFeedback();

  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;

  const { data: employeeData, isLoading: employeeLoading, refetch: refetchEmployee } = useEmployee(
    userId,
    {
      enabled: !!userId,
      placeholderData: (prev) => prev,
      refetchOnMount: 'always',
    },
  );
  const meIsAdmin = !!employeeData?.meIsAdmin;
  const meIsSuperAdmin = !!employeeData?.meIsSuperAdmin;
  const meId = employeeData?.myUid || null;
  const canEdit = !!meId && (meIsAdmin || meId === userId);
  const isEditingOtherUser = !!(meId && userId && meId !== userId);
  const isSuperAdminEditingOther = meIsSuperAdmin && isEditingOtherUser;
  const blockedReason = String(employeeData?.blocked_reason || employeeData?.blockedReason || '').toLowerCase();
  const isManualAdminBlock = blockedReason === 'manual' || blockedReason === 'admin_block';
  const isLicenseBlockedRaw = (employeeData?.license_state || employeeData?.licenseState) === 'blocked_by_license';
  const isLicenseBlocked = isLicenseBlockedRaw && !isManualAdminBlock;
  const isBlockedByAdmin = !!employeeData?.is_admin_blocked
    || !!employeeData?.admin_blocked
    || !!employeeData?.isSuspended
    || blockedReason === 'admin_blocked';
  const isBlocked = !!employeeData?.isBlocked || isBlockedByAdmin || isLicenseBlockedRaw;
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [initialAvatarUrl, setInitialAvatarUrl] = useState(null); // РР·РЅР°С‡Р°Р»СЊРЅС‹Р№ Р°РІР°С‚Р°СЂ РёР· Р‘Р”
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState(null); // Р’СЂРµРјРµРЅРЅС‹Р№ Р°РІР°С‚Р°СЂ РґРѕ СЃРѕС…СЂР°РЅРµРЅРёСЏ
  const avatarSaveTimestampRef = useRef(0); // Timestamp РїРѕСЃР»РµРґРЅРµРіРѕ СЃРѕС…СЂР°РЅРµРЅРёСЏ Р°РІР°С‚Р°СЂР°
  const avatarDisplayUrl = useMemo(
    () =>
      /^https?:\/\//i.test(String(avatarUrl || ''))
        ? employeeData?.avatarDisplayUrl || avatarUrl
        : avatarUrl,
    [avatarUrl, employeeData?.avatarDisplayUrl],
  );
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [cropVisible, setCropVisible] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const [avatarKey, setAvatarKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const requiredMsg = useMemo(() => getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t), [t]);
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

  const headerDisplayName = useMemo(() => {
    const name = `${firstName || ''} ${middleName || ''} ${lastName || ''}`
      .replace(/\s+/g, ' ')
      .trim();
    return name || '';
  }, [firstName, middleName, lastName]);
  const headerFallbackName = useMemo(
    () => t('placeholder_no_name'),
    [t],
  );
  const [birthdate, setBirthdate] = useState(null);
  const [departmentId, setDepartmentId] = useState(null);
  const { data: companyId } = useMyCompanyIdQuery();
  const settingsCompanyId = employeeData?.companyId || companyId || null;
  const { useDepartments } = useCompanySettings(settingsCompanyId);
  const { data: employeeFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.EMPLOYEE, {
    enabled: !!settingsCompanyId,
  });
  const { data: departments = [] } = useDepartmentsQuery({
    companyId: settingsCompanyId,
    enabled: !!settingsCompanyId && useDepartments,
    onlyEnabled: true,
  });
  const [deptModalVisible, setDeptModalVisible] = useState(false);
  const activeDeptName = useMemo(() => {
    const d = (departments || []).find((x) => String(x.id) === String(departmentId));
    return d ? d.name : null;
  }, [departments, departmentId]);
  const [withYear, setWithYear] = useState(true);
  const [dobModalVisible, setDobModalVisible] = useState(false);
  const [confirmPwdVisible, setConfirmPwdVisible] = useState(false);
  const [_pendingSave, setPendingSave] = useState(false);
  const [_focusFirst, setFocusFirst] = useState(false);
  const [_focusLast, setFocusLast] = useState(false);
  const [_focusEmail, setFocusEmail] = useState(false);
  const [_focusPhone, setFocusPhone] = useState(false);
  const [_focusPwd, _setFocusPwd] = useState(false);
  const [role, setRole] = useState(ROLE.WORKER);
  const [newPassword, setNewPassword] = useState('');
  const [_showPassword, _setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFieldResetKey, setPasswordFieldResetKey] = useState(0);
  const [resetPwdVisible, setResetPwdVisible] = useState(false);
  const [resettingPwd, setResettingPwd] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [viewAvatarVisible, setViewAvatarVisible] = useState(false);
  const employeeFieldSettings = useMemo(
    () => employeeFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.EMPLOYEE),
    [employeeFieldSettingsData],
  );
  const fieldUi = useMemo(
    () => createEntityFieldPresentation(employeeFieldSettings),
    [employeeFieldSettings],
  );
  const canManageAvatar = fieldUi.isVisible('avatar_url');
  const canShowPersonalSection = fieldUi.hasVisibleFields(['first_name', 'middle_name', 'last_name', 'birthdate']);
  const canShowContactSection = fieldUi.hasVisibleFields(['email', 'phone']);
  const canEditDepartmentField = meIsAdmin && useDepartments && fieldUi.isVisible('department_id');
  const canShowCompanySection =
    fieldUi.hasVisibleFields(['department_id', 'role']) &&
    ((useDepartments && fieldUi.isVisible('department_id')) || fieldUi.isVisible('role'));
  const orderedPersonalFieldKeys = useMemo(
    () => {
      const keys = getOrderedEntityFields(employeeFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['first_name', 'middle_name', 'last_name', 'birthdate'],
      }).map((field) => field.fieldKey);
      const nameSequence = ['first_name', 'middle_name', 'last_name'];
      const firstNameFieldIndex = keys.findIndex((key) => nameSequence.includes(key));
      if (firstNameFieldIndex < 0) return keys;
      const names = nameSequence.filter((key) => keys.includes(key));
      const withoutNames = keys.filter((key) => !nameSequence.includes(key));
      return [
        ...withoutNames.slice(0, firstNameFieldIndex),
        ...names,
        ...withoutNames.slice(firstNameFieldIndex),
      ];
    },
    [employeeFieldSettings],
  );
  const orderedContactFieldKeys = useMemo(
    () =>
      getOrderedEntityFields(employeeFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['email', 'phone'],
      }).map((field) => field.fieldKey),
    [employeeFieldSettings],
  );
  const orderedCompanyFieldKeys = useMemo(
    () =>
      getOrderedEntityFields(employeeFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['department_id', 'role'],
      }).map((field) => field.fieldKey),
    [employeeFieldSettings],
  );
  const hasAnyName = !!(firstName.trim() || middleName.trim() || lastName.trim());
  const shouldShowAnyNameError =
    shouldShowError('firstName') || shouldShowError('middleName') || shouldShowError('lastName');
  const firstNameError =
    fieldErrors.firstName?.message ||
    (fieldUi.isVisible('first_name') && shouldShowAnyNameError && !hasAnyName ? requiredMsg : null);
  const middleNameError =
    fieldErrors.middleName?.message ||
    (fieldUi.isVisible('middle_name') && shouldShowAnyNameError && !hasAnyName ? requiredMsg : null);
  const lastNameError =
    fieldErrors.lastName?.message ||
    (fieldUi.isVisible('last_name') && shouldShowAnyNameError && !hasAnyName ? requiredMsg : null);
  const emailError =
    fieldErrors.email?.message ||
    ((fieldUi.isVisible('email') && shouldShowError('email'))
      ? getEmailFieldError(email, {
          required: fieldUi.isRequired('email'),
          requiredMessage: requiredMsg,
          t,
        })
      : null);
  const phoneError =
    fieldErrors.phone?.message ||
    (fieldUi.isVisible('phone') && shouldShowError('phone')
      ? !hasPhoneValue(phone)
        ? fieldUi.isRequired('phone') ? requiredMsg : null
        : !isValidOptionalMobilePhone(String(phone || ''))
          ? t('err_phone')
          : null
      : null);
  const birthdateError =
    fieldErrors.birthdate?.message ||
    (fieldUi.isVisible('birthdate') && shouldShowError('birthdate') && fieldUi.isRequired('birthdate') && !birthdate
      ? requiredMsg
      : null);
  const departmentError =
    fieldErrors.department_id?.message ||
    (canEditDepartmentField && shouldShowError('department_id') && fieldUi.isRequired('department_id') && !departmentId
      ? requiredMsg
      : null);

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
      setPendingAvatarUrl(uri);
      setAvatarUrl(uri);
    } catch (e) {
      setErr(e?.message || t('toast_generic_error'));
    }
  };
  const deleteAvatar = async () => {
    try {
      setErr('');
      // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј РїСѓСЃС‚СѓСЋ СЃС‚СЂРѕРєСѓ РґР»СЏ СЏРІРЅРѕРіРѕ СѓРєР°Р·Р°РЅРёСЏ РЅР° СѓРґР°Р»РµРЅРёРµ
      // null РѕР·РЅР°С‡Р°РµС‚ "нет изменений", '' РѕР·РЅР°С‡Р°РµС‚ "удалить"
      setPendingAvatarUrl('');
      setAvatarUrl(null);
      // avatar change will be captured by isDirty and confirmed on exit
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
    const mediaTypesOpt = getImagePickerMediaTypesImages();
    const camOpts = {
      allowsEditing: false,
      aspect: [1, 1],
      quality: MEDIA_QUALITY,
    };
    if (mediaTypesOpt) camOpts.mediaTypes = mediaTypesOpt;
    const res = await ImagePicker.launchCameraAsync(camOpts);
    if (!res.canceled && res.assets && res.assets[0]?.uri) {
      setCropSrc(res.assets[0].uri);
      setCropVisible(true);
    }
  };
  const pickFromLibrary = async () => {
    const okLib = await ensureLibraryPerms();
    if (!okLib) {
      setErr(t('error_library_denied'));
      return;
    }
    const mediaTypesOpt = getImagePickerMediaTypesImages();
    const libOpts = {
      allowsEditing: false,
      aspect: [1, 1],
      quality: MEDIA_QUALITY,
      selectionLimit: 1,
    };
    if (mediaTypesOpt) libOpts.mediaTypes = mediaTypesOpt;
    const res = await ImagePicker.launchImageLibraryAsync(libOpts);
    if (!res.canceled && res.assets && res.assets[0]?.uri) {
      setCropSrc(res.assets[0].uri);
      setCropVisible(true);
    }
  };

  const onCropCancel = () => {
    setCropVisible(false);
    setCropSrc(null);
  };

  const onCropConfirm = async (croppedUri) => {
    setCropVisible(false);
    setCropSrc(null);
    // proceed with upload
    await uploadAvatar(croppedUri);
  };
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelKey, setCancelKey] = useState(0);
  const [initialSnap, setInitialSnap] = useState(null);
  const [isSuspended, setIsSuspended] = useState(false);
  const [suspendVisible, setSuspendVisible] = useState(false);
  const [unsuspendVisible, setUnsuspendVisible] = useState(false);
  const [noFreeLicenseVisible, setNoFreeLicenseVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [totalOrdersCount, setTotalOrdersCount] = useState(0);
  const [ordersAction, setOrdersAction] = useState('keep');
  const [successor, setSuccessor] = useState(null);
  const [successorError, setSuccessorError] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [_pickerQuery, _setPickerQuery] = useState('');
  const [pickerItems, setPickerItems] = useState([]);
  const [_pickerLoading, _setPickerLoading] = useState(false);
  const [pickerReturn, setPickerReturn] = useState(null); // 'delete' | 'suspend' | null
  const scrollRef = useRef(null);
  const _pwdRef = useRef(null);
  const confirmPwdRef = useRef(null);
  const firstNameRef = useRef(null);
  const middleNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const phoneRef = useRef(null);
  const _dobFieldRef = useRef(null);
  const _deptFieldRef = useRef(null);
  const _roleFieldRef = useRef(null);
  const _statusFieldRef = useRef(null);
  const insets = useSafeAreaInsets();
  const scrollYRef = useRef(0);
  const headerHeight = theme?.components?.header?.height ?? 56;

  const syncEmployeeBlockState = useCallback(async () => {
    if (!userId) return null;
    const { data: prof, error } = await supabase
      .from(TABLES.profiles)
      .select('id, company_id, is_admin_blocked, license_state, blocked_reason')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!prof) return null;

    const blockedNow = !!prof.is_admin_blocked
      || prof.license_state === 'blocked_by_license';

    queryClient.setQueryData(queryKeys.employees.detail(userId), (prev) => ({
      ...(prev || {}),
      ...prof,
      companyId: prof.company_id || prev?.companyId || null,
      isSuspended: !!prof.is_admin_blocked,
      isBlocked: blockedNow,
    }));

    return { prof, blockedNow };
  }, [queryClient, userId]);

  const isDirty = useMemo(() => {
    if (!initialSnap) return false;
    const avatarCurrent = pendingAvatarUrl === null ? (avatarUrl || null) : pendingAvatarUrl === '' ? null : pendingAvatarUrl;
    const current = JSON.stringify({
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: normalizeOptionalPhoneForSave(phone) || '',
      birthdate: birthdate ? __serializeBirthForSave(birthdate, withYear) : null,
      role,
      newPassword: newPassword || null,
      departmentId: departmentId || null,
      isSuspended: !!isSuspended,
      avatar: avatarCurrent,
    });
    return current !== initialSnap;
  }, [firstName, middleName, lastName, email, phone, birthdate, withYear, role, newPassword, isSuspended, departmentId, pendingAvatarUrl, avatarUrl, initialSnap]);
  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);
  useFocusEffect(
    useCallback(() => {
      setErr('');
      clearBanner();

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
    }, [clearBanner, isDirty]),
  );
  const allowLeaveRef = useRef(false);
  const generateTempPassword = useCallback(() => {
    const words = ['pilot', 'eagle', 'tiger', 'wolf', 'bear', 'lion', 'shark', 'hawk', 'fox', 'star'];
    const word = words[Math.floor(Math.random() * words.length)];
    const digits = Math.floor(1000 + Math.random() * 9000);
    return word + digits;
  }, []);
  const showWarning = useCallback((msg) => {
    showBanner({ message: String(msg || t('dlg_generic_warning')), severity: 'warning' });
  }, [showBanner, t]);
  const showError = useCallback((msg) => {
    showBanner({ message: String(msg || t('toast_generic_error')), severity: 'error' });
  }, [showBanner, t]);
  const scrollToTop = useCallback(() => {
    try {
      scrollRef.current?.scrollTo?.({ y: 0, animated: true });
    } catch {}
  }, []);
  const confirmCancel = () => {
    setCancelVisible(false);
    // Р’РѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµРј РёР·РЅР°С‡Р°Р»СЊРЅС‹Р№ Р°РІР°С‚Р°СЂ РїСЂРё РѕС‚РјРµРЅРµ
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
      showInfoToast(t('toast_saving'));
      let savedAvatarUrl = avatarUrl || null;

      // pendingAvatarUrl === null РѕР·РЅР°С‡Р°РµС‚ "нет изменений", Р° РЅРµ "удалить"
      if (pendingAvatarUrl !== null && pendingAvatarUrl !== initialAvatarUrl) {
        if (pendingAvatarUrl === '') {
          await cleanupProfileMediaEntity('employee', String(userId));
          savedAvatarUrl = null;
        } else if (!String(pendingAvatarUrl).startsWith('http')) {
          savedAvatarUrl = await uploadProfileMedia('employee', String(userId), pendingAvatarUrl);
          if (!savedAvatarUrl) {
            throw new Error('Не удалось сохранить аватар');
          }
        } else {
          savedAvatarUrl = pendingAvatarUrl;
          if (!isSuperAdminEditingOther) {
            const { error: updErr } = await supabase
              .from(TABLES.profiles)
              .update({ avatar_url: savedAvatarUrl })
              .eq('id', userId);
            if (updErr) throw updErr;
          }
        }

        setAvatarUrl(savedAvatarUrl);
        setInitialAvatarUrl(savedAvatarUrl);
        setPendingAvatarUrl(null);
        avatarSaveTimestampRef.current = Date.now();
      }

      // Р•СЃР»Рё Р°РґРјРёРЅ СЂРµРґР°РєС‚РёСЂСѓРµС‚ РґСЂСѓРіРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ вЂ” РёСЃРїРѕР»СЊР·СѓРµРј edge-С„СѓРЅРєС†РёСЋ РґР»СЏ РІСЃРµРіРѕ
      const computedFullName = buildFullName(firstName, middleName, lastName);
      const normalizedFullName = computedFullName || null;

      if (isSuperAdminEditingOther) {
        const payload = {
          p_profile_id: userId,
          p_first_name: firstName.trim() || null,
          p_last_name: lastName.trim() || null,
          p_role: role || null,
          p_company_id: employeeData?.companyId || null,
          p_phone: normalizeOptionalPhoneForSave(phone),
          p_birthdate: birthdate ? __serializeBirthForSave(birthdate, withYear) : null,
          // RPC applies department update only when parameter is NOT NULL.
          // Send empty string to explicitly clear department (NULLIF('', '') -> NULL in SQL).
          p_department_id: departmentId == null ? '' : String(departmentId),
          p_avatar_url: savedAvatarUrl,
        };

        const { error: rpcErr } = await supabase.rpc('admin_update_profile_super_full', payload);
        if (rpcErr) throw rpcErr;
        const { error: middleNameErr } = await supabase
          .from(TABLES.profiles)
          .update({
            middle_name: middleName.trim() || null,
            full_name: normalizedFullName,
          })
          .eq('id', userId);
        if (middleNameErr) throw middleNameErr;

        if (newPassword && newPassword.length) {
          await withTimeout(
            updateUserPasswordViaFunction({
              userId,
              newPassword,
              changedBy: meId || userId,
            }),
            15000,
            'password-update-timeout',
          );
        }
      } else if (meIsAdmin && meId && userId && meId !== userId) {
        // РђРґРјРёРЅ СЂРµРґР°РєС‚РёСЂСѓРµС‚ РґСЂСѓРіРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
        const profilePatch = {
          first_name: firstName.trim() || null,
          middle_name: middleName.trim() || null,
          last_name: lastName.trim() || null,
          full_name: normalizedFullName,
          phone: normalizeOptionalPhoneForSave(phone),
          birthdate: birthdate ? __serializeBirthForSave(birthdate, withYear) : null,
          department_id: departmentId || null,
          role,
        };
        Object.keys(profilePatch).forEach((k) => profilePatch[k] === undefined && delete profilePatch[k]);

        const { data: profData, error: profErr } = await withTimeout(
          supabase.from(TABLES.profiles).update(profilePatch).eq('id', userId),
          15000,
          'profile-update-timeout',
        );
        console.debug('[proceedSave] profiles.update (admin)', { profErr, profData, profilePatch, userId });

        if (profErr) throw profErr;

        // Р•СЃР»Рё РЅСѓР¶РЅРѕ РѕР±РЅРѕРІРёС‚СЊ РїР°СЂРѕР»СЊ вЂ” РёСЃРїРѕР»СЊР·СѓРµРј email-server API
        if (newPassword && newPassword.length) {
          await withTimeout(
            updateUserPasswordViaFunction({
              userId,
              newPassword,
              changedBy: meId,
            }),
            15000,
            'password-update-timeout',
          );
        }
      } else {
        // РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЂРµРґР°РєС‚РёСЂСѓРµС‚ СЃРµР±СЏ
        const profilePatch = {
          first_name: firstName.trim() || null,
          middle_name: middleName.trim() || null,
          last_name: lastName.trim() || null,
          full_name: normalizedFullName,
          phone: normalizeOptionalPhoneForSave(phone),
          birthdate: birthdate ? __serializeBirthForSave(birthdate, withYear) : null,
        };
        if (meIsAdmin) {
          profilePatch.department_id = departmentId || null;
        }
        Object.keys(profilePatch).forEach((k) => profilePatch[k] === undefined && delete profilePatch[k]);

        const { data: profData, error: profErr } = await supabase
          .from(TABLES.profiles)
          .update(profilePatch)
          .eq('id', userId);
        console.debug('[proceedSave] profiles.update (self)', { profErr, profData, profilePatch, userId });

        if (profErr) throw profErr;

        // Р•СЃР»Рё РЅСѓР¶РЅРѕ РѕР±РЅРѕРІРёС‚СЊ РїР°СЂРѕР»СЊ вЂ” РёСЃРїРѕР»СЊР·СѓРµРј email-server API
        if (newPassword && newPassword.length) {
          await updateCurrentUserPasswordViaBackend(newPassword);
        }
      }

      setNewPassword('');
      setConfirmPassword('');
      // Force remount of password inputs to clear native masked text state on Android.
      setPasswordFieldResetKey((prev) => prev + 1);
      setConfirmPwdVisible(false);
      setPendingSave(false);
      setInitialSnap(
        JSON.stringify({
          firstName: firstName.trim(),
          middleName: middleName.trim(),
          lastName: lastName.trim(),
          email: normalizeOptionalEmail(email) || '',
          phone: normalizeOptionalPhoneForSave(phone) || '',
          birthdate: birthdate ? __serializeBirthForSave(birthdate, withYear) : null,
          role,
          newPassword: null,
          departmentId: departmentId || null,
          isSuspended,
          avatar: savedAvatarUrl,
        }),
      );
      queryClient.setQueryData(queryKeys.employees.detail(userId), (prev) => ({
        ...(prev || {}),
        first_name: firstName.trim() || null,
        middle_name: middleName.trim() || null,
        last_name: lastName.trim() || null,
        full_name: buildFullName(firstName, middleName, lastName) || null,
        email: normalizeOptionalEmail(email),
        phone: normalizeOptionalPhoneForSave(phone),
        birthdate: birthdate ? __serializeBirthForSave(birthdate, withYear) : null,
        role,
        department_id: departmentId || null,
        avatar_url: savedAvatarUrl,
        avatarDisplayUrl: savedAvatarUrl,
        avatar_display_url: savedAvatarUrl,
        isSuspended: !!isSuspended,
        meIsAdmin,
        myUid: meId,
      }));
      queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(userId) });
      if (meId && String(meId) === String(userId)) {
        const normalizedUserId = String(userId);
        const nextProfileSnapshot = {
          first_name: firstName.trim() || null,
          middle_name: middleName.trim() || null,
          last_name: lastName.trim() || null,
          full_name: buildFullName(firstName, middleName, lastName) || null,
          email: normalizeOptionalEmail(email),
          phone: normalizeOptionalPhoneForSave(phone),
          birthdate: birthdate ? __serializeBirthForSave(birthdate, withYear) : null,
          role,
          department_id: departmentId || null,
          avatar_url: savedAvatarUrl,
          avatar_display_url: savedAvatarUrl,
        };
        queryClient.setQueryData(['profile', normalizedUserId], (prev) => ({
          ...(prev || {}),
          ...nextProfileSnapshot,
          id: (prev && prev.id) || normalizedUserId,
        }));
        queryClient.invalidateQueries({ queryKey: queryKeys.profile.me() });
        queryClient.invalidateQueries({ queryKey: ['profile', normalizedUserId] });
      }
      refetchEmployee().catch(() => {});
      allowLeaveRef.current = true;
      showSuccessToast(t('toast_success'));
      // После успешного сохранения возвращаемся на предыдущую страницу
      if (navigation && typeof navigation.goBack === 'function') {
        navigation.goBack();
      } else if (router && typeof router.back === 'function') {
        router.back();
      }
    } catch (e) {
      const msg = mapSaveErrorToMessage(e, t);
      setErr(msg);
      showError(msg);
      if (isSamePasswordError(e)) {
        scrollToTop();
        _showErrorToast(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    Keyboard.dismiss(); // пїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅ пїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅ пїЅпїЅпїЅ пїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅпїЅ
    setErr('');
    clearBanner();
    setFieldErrors({});
    setSubmittedAttempt(true);
    if ((fieldUi.isVisible('first_name') || fieldUi.isVisible('middle_name') || fieldUi.isVisible('last_name')) && !(firstName.trim() || middleName.trim() || lastName.trim())) {
      setFieldErrors({
        firstName: { message: requiredMsg },
        middleName: { message: requiredMsg },
        lastName: { message: requiredMsg },
      });
      ensureVisibleField({
        fieldRef: firstNameRef,
        scrollRef,
        scrollYRef,
        insetsBottom: insets.bottom ?? 0,
        headerHeight,
      });
      firstNameRef.current?.focus?.();
      return;
    }
    const emailFieldError = getEmailFieldError(email, {
      required: fieldUi.isRequired('email'),
      requiredMessage: requiredMsg,
      t,
    });
    if (fieldUi.isVisible('email') && emailFieldError) {
      setFieldErrors({ email: { message: emailFieldError } });
      ensureVisibleField({
        fieldRef: emailRef,
        scrollRef,
        scrollYRef,
        insetsBottom: insets.bottom ?? 0,
        headerHeight,
      });
      emailRef.current?.focus?.();
      return;
    }
    if (fieldUi.isVisible('phone') && fieldUi.isRequired('phone') && !hasPhoneValue(phone)) {
      setFieldErrors({ phone: { message: requiredMsg } });
      ensureVisibleField({
        fieldRef: phoneRef,
        scrollRef,
        scrollYRef,
        insetsBottom: insets.bottom ?? 0,
        headerHeight,
      });
      phoneRef.current?.focus?.();
      return;
    }
    if (fieldUi.isVisible('phone') && hasPhoneValue(phone) && !isValidOptionalMobilePhone(String(phone || ''))) {
      setFieldErrors({ phone: { message: t('err_phone') } });
      ensureVisibleField({
        fieldRef: phoneRef,
        scrollRef,
        scrollYRef,
        insetsBottom: insets.bottom ?? 0,
        headerHeight,
      });
      phoneRef.current?.focus?.();
      return;
    }
    if (fieldUi.isVisible('birthdate') && fieldUi.isRequired('birthdate') && !birthdate) {
      setFieldErrors({ birthdate: { message: requiredMsg } });
      return;
    }
    if (canEditDepartmentField && fieldUi.isRequired('department_id') && !departmentId) {
      setFieldErrors({ department_id: { message: requiredMsg } });
      return;
    }
    // Р•СЃР»Рё СЂРµРґР°РєС‚РёСЂСѓРµРј СЃРѕР±СЃС‚РІРµРЅРЅС‹Р№ РїСЂРѕС„РёР»СЊ Рё Р·Р°РґР°РЅ РЅРѕРІС‹Р№ РїР°СЂРѕР»СЊ вЂ” РїСЂРѕРІРµСЂСЏРµРј РµРіРѕ
    if (meId && meId === userId && newPassword && newPassword.length) {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        setFieldErrors({ newPassword: { message: t('error_password_too_short') || `Минимум ${MIN_PASSWORD_LENGTH}` } });
        return;
      }
      if (confirmPassword !== newPassword) {
        setFieldErrors({ confirmPassword: { message: t('error_passwords_mismatch') || 'Пароли не совпадают' } });
        return;
      }
      // РџРѕРґС‚РІРµСЂР¶РґР°РµРј РґРµР№СЃС‚РІРёРµ (РїРѕРєР°Р¶РµРј РјРѕРґР°Р» РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ)
      setConfirmPwdVisible(true);
      return;
    }

    await proceedSave();
  };

  const cancelRef = useRef(null);

  const _onPressCancel = React.useCallback(() => {
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
  }, [initialSnap, firstName, middleName, lastName, email, phone, birthdate, role, newPassword, isSuspended, departmentId]);
  // password strength check removed for edit screen per request
  const _formatName = (p) => {
    const n1 = (p.first_name || '').trim();
    const n2 = (p.middle_name || '').trim();
    const n3 = (p.last_name || '').trim();
    const fn = (p.full_name || '').trim();
    const name =
      n1 || n2 || n3 ? `${n1} ${n2} ${n3}`.replace(/\s+/g, ' ').trim() : fn || t('placeholder_no_name');
    return name;
  };
  const buildFullName = (first, middle, last) => {
    const parts = [(first || '').trim(), (middle || '').trim(), (last || '').trim()].filter(Boolean);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  useEffect(() => {
    if (!employeeData) return;
    if (isDirtyRef.current) return;

    const avatarFromDb = employeeData?.avatar_url || null;
    const timeSinceLastSave = Date.now() - (avatarSaveTimestampRef.current || 0);
    const AVATAR_SAVE_PROTECTION_MS = 3000;

    setFirstName(employeeData?.first_name || '');
    setMiddleName(employeeData?.middle_name || '');
    setLastName(employeeData?.last_name || '');
    setEmail(employeeData?.email || '');
    setDepartmentId(employeeData?.department_id ?? null);
    setPhone(String(employeeData?.phone || '').replace(/\D/g, ''));
    const normalizedSuspended = !!employeeData?.isSuspended
      || !!employeeData?.is_admin_blocked;
    setIsSuspended(normalizedSuspended);
    setRole(employeeData?.role || ROLE.WORKER);

    const parsedBirthdateObj = __parseLocalYMD(employeeData?.birthdate || null);
    setBirthdate(parsedBirthdateObj.date);
    setWithYear(!!parsedBirthdateObj.hasYear);

    if (timeSinceLastSave >= AVATAR_SAVE_PROTECTION_MS) {
      setPendingAvatarUrl((current) => {
        if (current !== null) {
          setAvatarUrl(current === '' ? null : current);
          setInitialAvatarUrl(avatarFromDb);
          return current;
        }
        setAvatarUrl(avatarFromDb);
        setInitialAvatarUrl(avatarFromDb);
        return null;
      });
    }

    setInitialSnap(
      JSON.stringify({
        firstName: (employeeData?.first_name || '').trim(),
        middleName: (employeeData?.middle_name || '').trim(),
        lastName: (employeeData?.last_name || '').trim(),
        email: String(employeeData?.email || '').trim(),
        phone: String(employeeData?.phone || '').replace(/\D/g, '') || '',
        birthdate: employeeData?.birthdate ? String(employeeData.birthdate) : null,
        role: employeeData?.role || ROLE.WORKER,
        newPassword: null,
        departmentId: employeeData?.department_id ?? null,
        isSuspended: normalizedSuspended,
        avatar: employeeData?.avatar_url ? String(employeeData.avatar_url) : null,
      }),
    );
  }, [employeeData]);
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`${RT_PREFIX}${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        () => {
          if (isDirtyRef.current) {
            // TODO: consider merging remote changes into form without clobbering local edits
            return;
          }
          refetchEmployee();
        },
      )
      .subscribe();
    return () => {
      try {
        channel.unsubscribe();
      } catch {}
    };
  }, [userId, refetchEmployee]);
  const reassignActiveOrders = async (fromUserId, toUserId) => {
    const effectiveCompanyId =
      String(employeeData?.companyId || employeeData?.company_id || '').trim() || null;
    const { error } = await supabase.rpc('reassign_orders_with_options', {
      p_from_user_id: fromUserId,
      p_to_user_id: toUserId,
      p_company_id: effectiveCompanyId,
      p_silent_notifications: true,
    });
    return error || null;
  };
  const _reassignAllOrders = async (fromUserId, toUserId) => {
    const effectiveCompanyId =
      String(employeeData?.companyId || employeeData?.company_id || '').trim() || null;
    const { error } = await supabase.rpc('reassign_orders_with_options', {
      p_from_user_id: fromUserId,
      p_to_user_id: toUserId,
      p_company_id: effectiveCompanyId,
      p_silent_notifications: true,
    });
    return error || null;
  };
  const setSuspended = async (uid, value) => {
    try {
      if (isSuperAdminEditingOther) {
        const { error: rpcErr } = await supabase.rpc('admin_update_profile_super_full', {
          p_profile_id: uid,
          p_is_admin_blocked: !!value,
        });
        if (rpcErr) throw rpcErr;
        return null;
      }

      // 1) Resolve canonical profile row (supports id/user_id drift).
      const { data: targetProfile, error: targetErr } = await supabase
        .from(TABLES.profiles)
        .select('id, company_id, is_admin_blocked, blocked_reason')
        .or(`id.eq.${uid},user_id.eq.${uid}`)
        .limit(1)
        .maybeSingle();
      if (targetErr) throw targetErr;
      if (!targetProfile?.id) {
        throw new Error(t('err_suspend_failed'));
      }

      // 2) Write block state to canonical row.
      const { data: updatedProfile, error: updErr } = await supabase
        .from(TABLES.profiles)
        .update({
          is_admin_blocked: !!value,
          blocked_reason: value ? 'admin_block' : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetProfile.id)
        .select('id, is_admin_blocked, blocked_reason')
        .maybeSingle();

      if (updErr) {
        console.error('Error updating suspension status:', updErr);
        throw updErr;
      }

      // 3) Verify persisted state to avoid silent no-op updates.
      const persisted = updatedProfile || targetProfile;
      const blockedPersisted = !!persisted?.is_admin_blocked;
      if (Boolean(value) !== blockedPersisted) {
        throw new Error(t('err_suspend_failed'));
      }

      return null;
    } catch (e) {
      console.error('setSuspended error:', e);
      return e;
    }
  };
  const onAskResetPassword = () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return;
    setResetPwdVisible(true);
  };
  const onConfirmResetPassword = async () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return;
    if (!email) {
      showError(t('err_reset_password_failed'));
      setResetPwdVisible(false);
      return;
    }

    try {
      setResettingPwd(true);
      setErr('');
      showInfoToast(t('toast_reset_password_sending'), { sticky: true });

      const tempPassword = generateTempPassword();
      
      // 1. Обновляем пароль через edge function update_user
      await withTimeout(
        updateUserPasswordViaFunction({
          userId,
          newPassword: tempPassword,
          changedBy: meId || userId,
        }),
        15000,
        'password-update-timeout',
      );

      console.debug('[Edit] [Password Reset] Password updated successfully');

      // 2. РћС‚РїСЂР°РІР»СЏРµРј РїР°СЂРѕР»СЊ РїРѕ email
      console.debug('[Edit] [Password Reset] Sending email to:', email);
      
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error(t('err_reset_password_failed'));

      const emailResponse = await fetch(`${EMAIL_SERVICE_URL}/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          type: 'password-reset',
          email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          tempPassword,
        }),
      });

      console.debug('[Edit] [Password Reset] Email response status:', emailResponse.status);

      if (!emailResponse.ok) {
        const emailError = await emailResponse.text();
        console.warn('[Edit] [Password Reset] Email send failed:', emailError);
        // РџР°СЂРѕР»СЊ СѓР¶Рµ РѕР±РЅРѕРІР»РµРЅ, РїРѕРєР°Р·С‹РІР°РµРј СѓСЃРїРµС… РґР°Р¶Рµ РµСЃР»Рё email РЅРµ РѕС‚РїСЂР°РІРёР»СЃСЏ
        showSuccessToast(t('toast_reset_password_sent'));
      } else {
        showSuccessToast(t('toast_reset_password_sent'));
      }
    } catch (e) {
      console.error('[Edit] Password reset failed:', e);
      showError(e?.message || t('err_reset_password_failed'));
    } finally {
      setResettingPwd(false);
      setResetPwdVisible(false);
    }
  };
  const onAskSuspend = async () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return; // РЅРµ РґР»СЏ СЃРµР±СЏ

    try {
      setErr('');

      const { data: currentProfile, error: profileErr } = await supabase
        .from(TABLES.profiles)
        .select('company_id, is_admin_blocked, license_state')
        .eq('id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      const blockedNow = !!currentProfile?.is_admin_blocked
        || currentProfile?.license_state === 'blocked_by_license';
      if (blockedNow) {
        setUnsuspendVisible(true);
        return;
      }

      // Р’С‹Р·С‹РІР°РµРј RPC С„СѓРЅРєС†РёСЋ РґР»СЏ РїСЂРѕРІРµСЂРєРё Р·Р°СЏРІРѕРє
      const { data, error } = await supabase.rpc('check_employee_orders', {
        employee_id: userId
      });

      if (error) {
        throw new Error(error.message || 'Ошибка проверки заявок');
      }

      const { activeOrdersCount, availableEmployees } = data || {};

      // РЎРѕС…СЂР°РЅСЏРµРј РєРѕР»РёС‡РµСЃС‚РІРѕ Р·Р°СЏРІРѕРє Рё СЃРїРёСЃРѕРє РґРѕСЃС‚СѓРїРЅС‹С… СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ
      setActiveOrdersCount(activeOrdersCount || 0);
      setPickerItems(availableEmployees || []);
      setOrdersAction('keep');
      setSuccessor(null);
      setSuccessorError('');
      setSuspendVisible(true);
    } catch (e) {
      console.error('Ошибка при проверке заявок:', e);
      setErr(e?.message || t('err_check_orders_failed'));
      showError(e?.message || t('err_check_orders_failed'));
    }
  };
  
  const loadAvailableEmployees = async () => {
    try {
      // Р—Р°РіСЂСѓР¶Р°РµРј СЃРїРёСЃРѕРє Р°РєС‚РёРІРЅС‹С… СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ РґР»СЏ РІС‹Р±РѕСЂР° РїСЂРµРµРјРЅРёРєР°
      const { data, error } = await supabase
        .from(TABLES.profiles)
        .select('id, first_name, middle_name, last_name, full_name, role')
        .eq('is_admin_blocked', false)
        .neq('id', userId) // РёСЃРєР»СЋС‡Р°РµРј СЃР°РјРѕРіРѕ СЃРѕС‚СЂСѓРґРЅРёРєР°
        .order('full_name', { ascending: true });
      
      if (error) throw error;
      
      const employees = Array.isArray(data) ? data : [];
      setPickerItems(employees);
    } catch (e) {
      console.error('Ошибка загрузки сотрудников:', e);
      showError('Не удалось загрузить список сотрудников');
    }
  };
  const onAskUnsuspend = async () => {
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
      showInfoToast(t('toast_saving'), { sticky: true });
      if (ordersAction === 'reassign') {
        if (!successor?.id) {
          setSuccessorError(t('err_successor_required'));
          setSaving(false);
          return;
        }
        const errR = await reassignActiveOrders(userId, successor.id);
        if (errR) throw new Error(errR.message || t('toast_generic_error'));
      }
      const { data: currentProfile, error: profileErr } = await supabase
        .from(TABLES.profiles)
        .select('company_id, is_admin_blocked, license_state')
        .eq('id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      const blockedNow = !!currentProfile?.is_admin_blocked
        || currentProfile?.license_state === 'blocked_by_license';
      if (blockedNow) {
        setSuspendVisible(false);
        setUnsuspendVisible(true);
        return;
      }
      const errSuspend = await setSuspended(userId, true);
      if (errSuspend) throw new Error(errSuspend.message || t('err_suspend_failed'));
      const companyIdForSeat = employeeData?.companyId || employeeData?.company_id || currentProfile?.company_id || null;
      if (!companyIdForSeat) throw new Error(t('billing_unknown_error'));
      const { error: rpcErr } = await supabase.rpc('revoke_seat', {
        p_company_id: companyIdForSeat,
        p_user_id: userId,
        p_reason: 'manual',
      });
      if (rpcErr) throw rpcErr;
      await syncEmployeeBlockState();
      
      // РРЅРІР°Р»РёРґРёСЂСѓРµРј РєРµС€ Рё СЂР°Р·СЂРµС€Р°РµРј РІС‹С…РѕРґ, Р·Р°С‚РµРј СЃСЂР°Р·Сѓ РЅР°Р·Р°Рґ
      await queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(userId) });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      showSuccessToast(t('toast_suspended'));
      setSuspendVisible(false);
      allowLeaveRef.current = true;
      router.back();
    } catch (e) {
      setErr(e?.message || t('dlg_generic_warning'));
      showError(e?.message || t('dlg_generic_warning'));
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
      showInfoToast(t('toast_saving'), { sticky: true });
      const { data: currentProfile, error: profileErr } = await supabase
        .from(TABLES.profiles)
        .select('company_id, is_admin_blocked, license_state')
        .eq('id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;

      const blockedByAdminNow = !!currentProfile?.is_admin_blocked;
      if (blockedByAdminNow) {
        const errS = await setSuspended(userId, false);
        if (errS) throw new Error(errS.message || t('err_unsuspend_failed'));
      }

      const blockedByLicenseNow = currentProfile?.license_state === 'blocked_by_license';
      if (blockedByLicenseNow) {
        const companyIdForSeat = currentProfile?.company_id || employeeData?.companyId || employeeData?.company_id || null;
        if (!companyIdForSeat) throw new Error(t('billing_unknown_error'));
        const { error: rpcErr } = await supabase.rpc('assign_seat', {
          p_company_id: companyIdForSeat,
          p_user_id: userId,
        });
        if (rpcErr) throw rpcErr;
      }
      await syncEmployeeBlockState();
      
      // РРЅРІР°Р»РёРґРёСЂСѓРµРј РєРµС€ Рё СЂР°Р·СЂРµС€Р°РµРј РІС‹С…РѕРґ, Р·Р°С‚РµРј СЃСЂР°Р·Сѓ РЅР°Р·Р°Рґ
      await queryClient.invalidateQueries({ queryKey: queryKeys.employees.detail(userId) });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      showSuccessToast(t('toast_unsuspended'));
      setUnsuspendVisible(false);
      allowLeaveRef.current = true;
      router.back();
    } catch (e) {
      const msg = String(e?.message || '');
      if (/no free paid seats|seat limit exceeded|no free paid seats to unblock member/i.test(msg)) {
        setUnsuspendVisible(false);
        setNoFreeLicenseVisible(true);
        return;
      }
      setErr(e?.message || t('dlg_generic_warning'));
      showError(e?.message || t('dlg_generic_warning'));
    } finally {
      setSaving(false);
    }
  };
  const onAskDelete = async () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return;

    try {
      setErr('');
      showInfoToast(t('toast_loading_info'), { sticky: true });


      // Р’С‹Р·С‹РІР°РµРј RPC С„СѓРЅРєС†РёСЋ РґР»СЏ РїСЂРѕРІРµСЂРєРё Р·Р°СЏРІРѕРє
      console.debug('[onAskDelete] calling check_employee_orders for userId:', userId);

      const { data, error } = await supabase.rpc('check_employee_orders', {
        employee_id: userId
      });

      console.debug('[onAskDelete] result:', { data, error });

      if (error) {
        throw new Error(error.message || 'Ошибка проверки заявок');
      }

      const { activeOrdersCount, totalOrdersCount, availableEmployees } = data || {};

      console.debug('[onAskDelete] activeOrdersCount:', activeOrdersCount);

      // РЎРѕС…СЂР°РЅСЏРµРј РєРѕР»РёС‡РµСЃС‚РІРѕ Р·Р°СЏРІРѕРє Рё СЃРїРёСЃРѕРє РґРѕСЃС‚СѓРїРЅС‹С… СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ
      setActiveOrdersCount(activeOrdersCount || 0);
      setTotalOrdersCount(totalOrdersCount || 0);
      setPickerItems(availableEmployees || []);
      setSuccessor(null);
      setSuccessorError('');
      setDeleteVisible(true);
    } catch (e) {
      console.error('Ошибка при проверке заявок:', e);
      setErr(e?.message || t('err_check_orders_failed'));
      showError(e?.message || t('err_check_orders_failed'));
    }
  };

  const onConfirmDelete = async () => {
    if (!meIsAdmin) return showWarning(t('error_no_access'));
    if (meId && userId === meId) return;

    // Р•СЃР»Рё РµСЃС‚СЊ Р·Р°СЏРІРєРё, РЅРѕ РїСЂРµРµРјРЅРёРє РЅРµ РІС‹Р±СЂР°РЅ вЂ” РїРѕРєР°Р·С‹РІР°РµРј РѕС€РёР±РєСѓ
    if (totalOrdersCount > 0 && !successor?.id) {
      setSuccessorError(t('err_successor_required_delete'));
      return;
    }

    try {
      setSaving(true);
      setErr('');
      showInfoToast(t('toast_deleting_employee'), { sticky: true });

      // Р’С‹Р·С‹РІР°РµРј RPC С„СѓРЅРєС†РёСЋ РґР»СЏ РґРµР°РєС‚РёРІР°С†РёРё
      console.debug('[onConfirmDelete] invoking delete_user:', { userId, successorId: successor?.id });

      const { data, error } = await supabase.functions.invoke(FUNCTIONS.DELETE_USER, {
        body: {
          user_id: userId,
          reassign_to: successor?.id || null,
        },
      });

      console.debug('[onConfirmDelete] delete_user result:', { data, error });

      if (error) {
        throw new Error(error.message || t('err_delete_failed'));
      }

      if (data && data.ok === false) {
        throw new Error(data.message || t('err_delete_failed'));
      }

      // Allow navigation away before the screen changes after delete.
      allowLeaveRef.current = true;

      // Refresh employees list and leave the deleted profile screen.
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      showSuccessToast(t('toast_deleted'));
      setDeleteVisible(false);
      router.replace('/users');
    } catch (e) {
      console.error('Ошибка деактивации:', e);
      setErr(e?.message || t('dlg_generic_warning'));
      showError(e?.message || t('err_deactivate_failed'));
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
  if (employeeLoading && !employeeData) {
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
    `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}${(middleName || '').trim().slice(0, 1)}`
      .slice(0, 2)
      .toUpperCase();
  const personalFieldRenderers = {
      first_name: () => (
        <>
          <TextField
            ref={firstNameRef}
            label={fieldUi.withRequiredLabel('first_name', t('label_first_name'))}
            placeholder={t('placeholder_first_name')}
            placeholderTextColor={theme.colors.inputPlaceholder}
            style={styles.field}
            value={firstName}
            onChangeText={(val) => {
              setFirstName(val);
              clearFieldError('firstName');
            }}
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
            onBlur={() => {
              setFocusFirst(false);
              setTouched((prev) => ({ ...prev, firstName: true }));
            }}
            forceValidation={submittedAttempt}
            error={firstNameError ? 'invalid' : undefined}
          />
          <FieldErrorText message={firstNameError} />
        </>
      ),
      middle_name: () => (
        <>
          <TextField
            ref={middleNameRef}
            label={fieldUi.withRequiredLabel('middle_name', t('label_middle_name'))}
            placeholder={t('label_middle_name')}
            placeholderTextColor={theme.colors.inputPlaceholder}
            style={styles.field}
            value={middleName}
            onChangeText={(val) => {
              setMiddleName(val);
              clearFieldError('middleName');
            }}
            onFocus={() => {
              ensureVisibleField({
                fieldRef: middleNameRef,
                scrollRef,
                scrollYRef,
                insetsBottom: insets.bottom ?? 0,
                headerHeight,
              });
            }}
            onBlur={() => {
              setTouched((prev) => ({ ...prev, middleName: true }));
            }}
            forceValidation={submittedAttempt}
            error={middleNameError ? 'invalid' : undefined}
          />
          <FieldErrorText message={middleNameError} />
        </>
      ),
      last_name: () => (
        <>
          <TextField
            ref={lastNameRef}
            label={fieldUi.withRequiredLabel('last_name', t('label_last_name'))}
            placeholder={t('placeholder_last_name')}
            placeholderTextColor={theme.colors.inputPlaceholder}
            style={styles.field}
            value={lastName}
            onChangeText={(val) => {
              setLastName(val);
              clearFieldError('lastName');
            }}
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
            onBlur={() => {
              setFocusLast(false);
              setTouched((prev) => ({ ...prev, lastName: true }));
            }}
            forceValidation={submittedAttempt}
            error={lastNameError ? 'invalid' : undefined}
          />
          <FieldErrorText message={lastNameError} />
        </>
      ),
      birthdate: () => (
        <>
          <TextField
            label={fieldUi.withRequiredLabel('birthdate', t('label_birthdate'))}
            value={birthdate ? formatDateRU(birthdate, withYear) : t('placeholder_birthdate')}
            style={styles.field}
            multiline={false}
            pressable
            error={birthdateError ? 'invalid' : undefined}
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
          <FieldErrorText message={birthdateError} />
        </>
      ),
    };
  const contactFieldRenderers = {
      email: () => (
        <>
          <TextField
            ref={emailRef}
            label={fieldUi.withRequiredLabel('email', t('view_label_email'))}
            placeholder={t('placeholder_email')}
            placeholderTextColor={theme.colors.inputPlaceholder}
            style={styles.field}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={(val) => {
              setEmail(val);
              clearFieldError('email');
            }}
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
            onBlur={() => {
              setFocusEmail(false);
              setTouched((prev) => ({ ...prev, email: true }));
            }}
            forceValidation={submittedAttempt}
            error={emailError ? 'invalid' : undefined}
          />
          <FieldErrorText message={emailError} />
        </>
      ),
      phone: () => (
        <>
          <PhoneInput
            ref={phoneRef}
            value={phone}
            onChangeText={(val) => {
              setPhone(val);
              clearFieldError('phone');
            }}
            error={phoneError ? 'invalid' : undefined}
            style={styles.field}
            required={fieldUi.isRequired('phone')}
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
            onBlur={() => {
              setFocusPhone(false);
              setTouched((prev) => ({ ...prev, phone: true }));
            }}
          />
          <FieldErrorText message={phoneError} />
        </>
      ),
    };
  const companyFieldRenderers = {
      department_id: useDepartments ? (
        <>
          <TextField
            label={fieldUi.withRequiredLabel('department_id', t('label_department'))}
            value={activeDeptName || t('placeholder_department')}
            style={styles.field}
            pressable
            error={departmentError ? 'invalid' : undefined}
            onPress={() => setDeptModalVisible(true)}
          />
          <FieldErrorText message={departmentError} />
        </>
      ) : null,
      role: !isSelfAdmin ? (
        <>
          <TextField
            label={fieldUi.withRequiredLabel('role', t('label_role'))}
            value={ROLE_LABELS_LOCAL[role] || role}
            style={styles.field}
            pressable
            onPress={() => setShowRoles(true)}
          />
        </>
      ) : null,
    };
  return (
    <EditScreenTemplate
      title={t('header_edit_user')}
      rightTextLabel={saving ? t('toast_saving') : t('header_save')}
      onRightPress={handleSave}
      scrollRef={scrollRef}
      onScroll={(e) => {
        try {
          scrollYRef.current = e.nativeEvent.contentOffset.y || 0;
        } catch {}
      }}
    >
      <View>
            <View
              style={[
                styles.card,
                styles.headerCard,
                isBlocked ? styles.headerCardSuspended : null,
              ]}
            >
              <View style={styles.headerRow}>
                <Pressable
                  style={styles.avatar}
                  onPress={canManageAvatar
                    ? () => {
                        setAvatarKey((k) => k + 1);
                        setAvatarSheet(true);
                      }
                    : undefined}
                  disabled={!canManageAvatar}
                  accessibilityRole={canManageAvatar ? 'button' : undefined}
                  accessibilityLabel={canManageAvatar ? t('a11y_change_avatar') : undefined}
                  accessibilityHint={canManageAvatar ? t('a11y_change_avatar_hint') : undefined}
                >
                  {canManageAvatar && avatarDisplayUrl ? (
                    <ExpoImage
                      source={{ uri: avatarDisplayUrl }}
                      style={styles.avatarImg}
                      contentFit="cover"
                      cachePolicy="none"
                    />
                  ) : (
                    <Text style={styles.avatarText}>{initials || '•'}</Text>
                  )}
                  {canManageAvatar ? (
                    <View style={styles.avatarCamBadge}>
                      <AntDesign name="camera" size={CAMERA_ICON} color={theme.colors.onPrimary} />
                    </View>
                  ) : null}
                </Pressable>
                <View style={{ flex: 1 }}>
                  {headerDisplayName ? (
                    <Text style={styles.nameTitle} numberOfLines={1} ellipsizeMode="tail">
                      {headerDisplayName}
                    </Text>
                  ) : null}
                  {!headerDisplayName ? (
                    <Text style={styles.nameTitle} numberOfLines={1} ellipsizeMode="tail">
                      {headerFallbackName}
                    </Text>
                  ) : null}
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
                            isBlocked ? theme.colors.danger : theme.colors.success,
                            0.2,
                          ),
                          backgroundColor: withAlpha(
                            isBlocked ? theme.colors.danger : theme.colors.success,
                            0.13,
                          ),
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.rolePillHeaderText,
                          { color: isBlocked ? theme.colors.danger : theme.colors.success },
                        ]}
                      >
                        {isBlocked
                          ? t('status_blocked', t('status_suspended'))
                          : t('status_active')}
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
            {banner ? (
              <ScreenBanner
                message={banner}
                onClose={clearBanner}
                style={{ marginBottom: theme.spacing.md }}
              />
            ) : err ? (
              <ScreenBanner
                message={{ message: err, severity: 'error' }}
                onClose={() => setErr('')}
                style={{ marginBottom: theme.spacing.md }}
              />
            ) : null}
            {canShowPersonalSection ? (
            <SectionHeader topSpacing="xs" bottomSpacing="xs">
              {t('section_personal')}
            </SectionHeader>
            ) : null}
            {canShowPersonalSection ? (
            <Card>
              {orderedPersonalFieldKeys.map((fieldKey) => (
                <React.Fragment key={fieldKey}>
                  {personalFieldRenderers[fieldKey]?.() || null}
                </React.Fragment>
              ))}
            </Card>
            ) : null}

            {canShowContactSection ? (
              <>
                <SectionHeader topSpacing="xs" bottomSpacing="xs">
                  {t('clients_contacts_section')}
                </SectionHeader>
                <Card>
                  {orderedContactFieldKeys.map((fieldKey) => (
                    <React.Fragment key={fieldKey}>
                      {contactFieldRenderers[fieldKey]?.() || null}
                    </React.Fragment>
                  ))}
                </Card>
              </>
            ) : null}

            {meId && meId === userId && (
              <>
                <SectionHeader bottomSpacing="xs">
                  {t('section_password_template').replace('{n}', String(MIN_PASSWORD_LENGTH))}
                </SectionHeader>
                <Card>
                  <SecurePasswordInput
                    key={`new-password-${passwordFieldResetKey}`}
                    ref={_pwdRef}
                    value={newPassword}
                    onChangeText={(v) => {
                      setNewPassword(v);
                      // clear errors when typing
                      setFieldErrors((prev) => ({ ...prev, newPassword: undefined }));
                    }}
                    placeholder={t('register_placeholder_password')}
                    inputStyle={styles.field}
                    returnKeyType="next"
                    onSubmitEditing={() => confirmPwdRef.current?.focus?.()}
                  />
                  <FieldErrorText message={fieldErrors.newPassword?.message} />

                  <View style={{ height: theme.spacing.sm }} />

                  <SecurePasswordInput
                    key={`confirm-password-${passwordFieldResetKey}`}
                    ref={confirmPwdRef}
                    value={confirmPassword}
                    onChangeText={(v) => {
                      setConfirmPassword(v);
                      setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                    }}
                    placeholder={t('placeholder_repeat_password')}
                    inputStyle={styles.field}
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                  />
                  <FieldErrorText message={fieldErrors.confirmPassword?.message} />
                </Card>
              </>
            )}

            {meIsAdmin && canShowCompanySection && (useDepartments || !isSelfAdmin) ? (
              <>
                <SectionHeader bottomSpacing="xs">{t('section_company_role')}</SectionHeader>
                <Card>
                  {orderedCompanyFieldKeys.map((fieldKey) => (
                    <React.Fragment key={fieldKey}>
                      {companyFieldRenderers[fieldKey] || null}
                    </React.Fragment>
                  ))}
                </Card>
              </>
            ) : null}

            {meIsAdmin && meId !== userId && (
              <UIButton
                title={t('btn_reset_password')}
                variant="outline"
                onPress={onAskResetPassword}
                style={{ alignSelf: 'stretch', marginTop: theme.spacing.sm }}
                disabled={resettingPwd}
              />
            )}

            {meIsAdmin && meId !== userId && !isBlocked && (
              <UIButton
                title={t('users_edit_block_button')}
                variant="secondary"
                onPress={onAskSuspend}
                style={{ alignSelf: 'stretch', marginTop: theme.spacing.sm }}
              />
            )}

            {meIsAdmin && meId !== userId && isBlocked && (
              <UIButton
                title={t('users_edit_unblock_button')}
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
            <ConfirmModal
              visible={resetPwdVisible}
              onClose={() => setResetPwdVisible(false)}
              title={t('dlg_reset_password_title')}
              message={t('dlg_reset_password_msg')}
              confirmLabel={resettingPwd ? t('toast_saving') : t('btn_reset_password')}
              cancelLabel={t('header_cancel')}
              confirmVariant="primary"
              onConfirm={onConfirmResetPassword}
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
              message={isLicenseBlocked ? t('dlg_unsuspend_msg_license') : t('dlg_unsuspend_msg')}
              confirmLabel={saving ? t('dlg_unsuspend_apply') : t('dlg_unsuspend_confirm')}
              cancelLabel={t('header_cancel')}
              confirmVariant="primary"
              onConfirm={onConfirmUnsuspend}
            />
            <ConfirmModal
              visible={noFreeLicenseVisible}
              onClose={() => {
                try {
                  toast.hide();
                } catch {}
                setSaving(false);
                setNoFreeLicenseVisible(false);
              }}
              title={t('dlg_no_free_license_title')}
              message={t('dlg_no_free_license_msg')}
              confirmLabel={t('dlg_no_free_license_reassign')}
              cancelLabel={t('btn_cancel')}
              confirmVariant="primary"
              onConfirm={() => {
                try {
                  toast.hide();
                } catch {}
                setSaving(false);
                setNoFreeLicenseVisible(false);
                router.push('/billing');
              }}
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
                  `${it.first_name || ''} ${it.middle_name || ''} ${it.last_name || ''}`.trim() ||
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

            {canManageAvatar ? (
              <AvatarSheetModal
                key={`avatar-${avatarKey}`}
                visible={avatarSheet}
                hasAvatar={!!avatarUrl}
                onTakePhoto={pickFromCamera}
                onPickFromLibrary={pickFromLibrary}
                onDeletePhoto={deleteAvatar}
                onViewPhoto={() => {
                  setViewAvatarVisible(true);
                }}
                onClose={() => setAvatarSheet(false)}
              />
            ) : null}
            <AvatarCropModal visible={cropVisible} uri={cropSrc} onCancel={onCropCancel} onConfirm={onCropConfirm} />

            {canManageAvatar ? (
              <BaseModal
                visible={viewAvatarVisible}
                onClose={() => setViewAvatarVisible(false)}
                title={t('profile_photo_title')}
                maxHeightRatio={0.9}
              >
                <View style={{ alignItems: 'center', padding: theme.spacing.md }}>
                  {avatarDisplayUrl ? (
                    <ExpoImage
                      source={{ uri: avatarDisplayUrl }}
                      style={{ width: '100%', height: undefined, aspectRatio: 1, borderRadius: theme.radii.lg }}
                      contentFit="contain"
                      cachePolicy="none"
                    />
                  ) : (
                    <Text style={{ color: theme.colors.textSecondary }}>{t('placeholder_no_photo') || 'Нет фото'}</Text>
                  )}
                </View>
              </BaseModal>
            ) : null}
            {useDepartments ? (
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
            ) : null}
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
                  if (d && !isNaN(d)) {
                    // Если пользователь указал, что год опущен (withYear=false),
                    // не перезаписываем год на 1900 в локальном состоянии, если
                    // ранее был выбран реальный год — сохраним его, чтобы при
                    // повторном включении года пользователь увидел ожидаемое значение.
                    try {
                      if (extra && typeof extra.withYear === 'boolean' && extra.withYear === false) {
                        if (birthdate instanceof Date && !isNaN(birthdate) && birthdate.getFullYear() !== 1900) {
                          // preserve previous year
                          const preserved = new Date(birthdate.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
                          setBirthdate(preserved);
                        } else {
                          // no previous real year — keep provided date (may use sentinel)
                          setBirthdate(d);
                        }
                      } else {
                        setBirthdate(d);
                      }
                    } catch {
                      setBirthdate(d);
                    }
                  }
                  // После выбора даты очищаем возможную ошибку валидации для этого поля
                  try {
                    clearFieldError('birthdate');
                  } catch {}
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

// ========== SuspendModal РєРѕРјРїРѕРЅРµРЅС‚ ==========
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
      // Use a different description when the employee still has active orders.
      description: hasActiveOrders 
        ? t('user_block_keepOrders_desc')
        : t('user_block_noOrders_desc'),
    },
  ];
  
  // Р”РѕР±Р°РІР»СЏРµРј РѕРїС†РёСЋ РїРµСЂРµРЅР°Р·РЅР°С‡РµРЅРёСЏ С‚РѕР»СЊРєРѕ РµСЃР»Рё РµСЃС‚СЊ Р°РєС‚РёРІРЅС‹Рµ Р·Р°СЏРІРєРё
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
                {/* Р—Р°РіРѕР»РѕРІРѕРє РѕРїС†РёРё */}
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

                {/* РћРїРёСЃР°РЅРёРµ РѕРїС†РёРё (РІРёРґРЅРѕ С‚РѕР»СЊРєРѕ РµСЃР»Рё РІС‹Р±СЂР°РЅР°) */}
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

                {/* Р’С‹Р±РѕСЂ РїСЂРµРµРјРЅРёРєР° РґР»СЏ "reassign" */}
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
            {t('user_block_noOrders_desc')}
          </Text>
        </View>
      )}
    </BaseModal>
  );
}

// ========== DeleteEmployeeModal РєРѕРјРїРѕРЅРµРЅС‚ ==========
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


























