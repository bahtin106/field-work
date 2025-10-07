import { AntDesign, Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter, useFocusEffect, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Dimensions, FlatList, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PhoneInput from '../../../components/ui/PhoneInput';
import { isValidRu as isValidPhone, normalizeRu } from '../../../components/ui/phone';
import SelectModal, { ConfirmModal, AlertModal, SuspendModal, DeleteEmployeeModal, AvatarSheetModal, DepartmentSelectModal, RoleSelectModal, DateTimeModal } from '../../../components/ui/SelectModal';
import { supabase } from '../../../lib/supabase';
import { useTheme } from '../../../theme/ThemeProvider';
import Screen from '../../../components/layout/Screen';
import UIButton from '../../../components/ui/Button';
import IconButton from '../../../components/ui/IconButton';
import Card from '../../../components/ui/Card';
import TextField, { SelectField } from '../../../components/ui/TextField';
import { useToast } from '../../../components/ui/ToastProvider';
import { t as S } from '../../../src/i18n';
import { TBL, STORAGE, FUNCTIONS as APP_FUNCTIONS, AVATAR } from '../../../lib/constants';
import AppHeader from '../../../components/navigation/AppHeader';

const TABLES = {
  profiles: TBL.PROFILES || 'profiles',
  orders: TBL.ORDERS || 'orders',
  departments: TBL.DEPARTMENTS || 'departments',
};

const __EDIT_CFG = (() => {
  try {
    const mix = process.env.EXPO_PUBLIC_EDIT_CONFIG_JSON;
    if (mix) { const o = JSON.parse(mix); if (o && typeof o === 'object') return o; }
  } catch (_) {}
  return {};
})();
const __EDIT_BUCKETS = (() => {
  try {
    const s = process.env.EXPO_PUBLIC_BUCKETS_JSON;
    if (s) { const o = JSON.parse(s); if (o && typeof o === 'object') return o; }
  } catch (_) {}
  return __EDIT_CFG.buckets || {};
})();
const __EDIT_FUNCTIONS = (() => {
  try {
    const s = process.env.EXPO_PUBLIC_FUNCTIONS_JSON;
    if (s) { const o = JSON.parse(s); if (o && typeof o === 'object') return o; }
  } catch (_) {}
  return __EDIT_CFG.functions || {};
})();
const __IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const __pick = (val, devFallback) => (val != null ? val : (__IS_PROD ? null : devFallback));

const BUCKETS = STORAGE;
const AVA_PREFIX = AVATAR.FILENAME_PREFIX;
const AVA_MIME = AVATAR.MIME;


const FUNCTIONS = APP_FUNCTIONS;

const FN_GET_PROFILE = process.env.EXPO_PUBLIC_RPC_GET_PROFILE || (__EDIT_FUNCTIONS.getProfileWithEmail ?? 'admin_get_profile_with_email');

const RT_PREFIX = process.env.EXPO_PUBLIC_RT_USER_PREFIX || 'rt-user-';


import { ROLE, EDITABLE_ROLES as ROLES, ROLE_LABELS } from '../../../constants/roles';

try {
  const fromEnv = process.env.EXPO_PUBLIC_ROLE_LABELS_JSON;
  if (fromEnv) ROLE_LABELS = { ...ROLE_LABELS, ...JSON.parse(fromEnv) };
} catch {}

let ROLE_DESCRIPTIONS = (globalThis?.APP_I18N?.role_descriptions) || {
  [ROLE.DISPATCHER]: S('role_desc_dispatcher'),
  [ROLE.WORKER]: S('role_desc_worker')
};
try {
  const fromEnv = process.env.EXPO_PUBLIC_ROLE_DESCRIPTIONS_JSON;
  if (fromEnv) ROLE_DESCRIPTIONS = { ...ROLE_DESCRIPTIONS, ...JSON.parse(fromEnv) };
} catch {}

function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

function formatDateRU(date, withYear = true) {
  try {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const opts = withYear
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : { day: 'numeric', month: 'long' };
    let s = d.toLocaleDateString('ru-RU', opts);
    s = s.replace(/\s*г\.?$/i, '');
    return s.replace(/(\d+)\s+([А-ЯЁ][а-яё]+)/u, (m, day, month) => `${day} ${month.toLowerCase()}`);
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
 if (s.length> 254) return false;
 if (/\s/.test(s)) return false;
 const parts = s.split('@');
 if (parts.length !== 2) return false;
 const [local, domain] = parts;
 if (!local || !domain) return false;
 if (local.length> 64) return false;
 if (local.startsWith('.') || local.endsWith('.')) return false;
 if (local.includes('..')) return false;
 if (!/^[A-Za-z0-9._%+-]+$/.test(local)) return false;
 const labels = domain.split('.');
 if (labels.length < 2) return false;
 for (const lab of labels) {
  if (!lab) return false;
  if (lab.length> 63) return false;
  if (!/^[A-Za-z0-9-]+$/.test(lab)) return false;
  if (lab.startsWith('-') || lab.endsWith('-')) return false;
 }
 const tld = labels[labels.length - 1];
 if (tld.length < 2 || tld.length> 24) return false;
 return true;
}
export default function EditUser() {
const { theme } = useTheme();
  const MEDIA_ASPECT = Array.isArray(theme.media?.aspect) ? theme.media.aspect : [1, 1];
  const MEDIA_QUALITY = (typeof theme.media?.quality === 'number') ? theme.media.quality : 0.85;

  const ICON_MD = theme.icons?.md ?? 22;
 const ICON_SM = theme.icons?.sm ?? 18;
 const ICONBUTTON_TOUCH = theme.components?.iconButton?.size ?? 32;
 const TRAILING_WIDTH = theme.components?.input?.trailingSlotWidth 
   ?? (ICONBUTTON_TOUCH + theme.spacing.sm + ICON_MD + theme.spacing.sm + (theme.components?.input?.trailingGap ?? 8));
 const CAMERA_ICON = Math.max(theme.icons?.minCamera ?? 12, Math.round((theme.icons?.sm ?? 18) * 0.67));
 const RADIO_SIZE = theme.components?.radio?.size ?? ICON_MD;
 const RADIO_DOT = theme.components?.radio?.dot ?? Math.max(6, Math.round(RADIO_SIZE / 2 - 3));
const TOAST_MAX_W = theme.components?.toast?.maxWidth ?? 440;
 const EXTRA_SCROLL_PAD = theme.spacing.sm;
const styles = React.useMemo(() => {
  return StyleSheet.create({
 container: { flex: 1, backgroundColor: theme.colors.background },
 scroll: { paddingHorizontal: theme.spacing.lg, flexGrow: 1 },
 
 appBar: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: theme.spacing.sm },
 appBarBack: { padding: theme.spacing.xs, borderRadius: theme.radii.md },
 appBarTitle: { fontSize: theme.typography.sizes.lg, fontWeight: '700', color: theme.colors.text },
 rolePillHeader: { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs, borderRadius: theme.radii.lg, borderWidth: theme.components.card.borderWidth },
 rolePillHeaderText: { fontSize: theme.typography.sizes.xs, fontWeight: '600' },
 headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
 headerCard: { padding: theme.spacing.sm, marginBottom: theme.spacing.md },
 headerCardSuspended: {
  backgroundColor: withAlpha(theme.colors.danger, 0.08),
  borderColor: withAlpha(theme.colors.danger, 0.2),
  borderWidth: theme.components.card.borderWidth,
  borderRadius: theme.radii.lg },
 avatar: {
  width: theme.components.avatar.md,
  height: theme.components.avatar.md,
  borderRadius: theme.components.avatar.md / 2,
  backgroundColor: withAlpha(theme.colors.primary, 0.12),
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: theme.components.card.borderWidth,
  borderColor: withAlpha(theme.colors.primary, 0.24),
  overflow: 'hidden' },
 avatarImg: { width: '100%', height: '100%' },
 avatarCamBadge: {
  position: 'absolute',
  right: -2,
  bottom: -2,
  backgroundColor: theme.colors.primary,
  borderRadius: theme.radii.md,
  paddingHorizontal: theme.spacing.xs,
  paddingVertical: theme.spacing.xs,
  borderWidth: theme.components?.avatar?.border ?? theme.components.card.borderWidth,
  borderColor: theme.colors.surface
 },
 avatarText: { color: theme.colors.primary, fontWeight: '700' },
 nameTitle: { fontSize: theme.typography.sizes.md, fontWeight: '600', color: theme.colors.text },
 badge: { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs, borderRadius: theme.radii.pill },
 badgeGreen: { backgroundColor: theme.colors.success },
 badgeRed: { backgroundColor: theme.colors.danger },
 badgeOutline: {
  borderWidth: theme.components.card.borderWidth,
  borderColor: theme.colors.border,
  borderRadius: theme.radii.pill,
  paddingHorizontal: theme.spacing.sm,
  paddingVertical: theme.spacing.xs },
 badgeOutlineText: { color: theme.colors.text, fontSize: theme.typography.sizes.xs },
 badgeText: { fontSize: theme.typography.sizes.xs, fontWeight: '600' },
 card: {
  backgroundColor: theme.colors.surface,
  borderRadius: theme.radii.lg,
  padding: theme.spacing.md,
  borderColor: theme.colors.border,
  borderWidth: theme.components.card.borderWidth,
  marginBottom: theme.spacing.md },
 section: {
  marginTop: theme.spacing.xs,
  marginBottom: theme.spacing.sm,
  marginLeft: theme.spacing[theme.components.sectionTitle.ml],
  fontWeight: '600',
  color: theme.colors.text,
},
 label: { fontWeight: '500', marginBottom: theme.spacing.xs, marginTop: theme.spacing.md, color: theme.colors.textSecondary },
 
 field: { marginHorizontal: 0, marginVertical: theme.spacing.sm },
 errorCard: {
  backgroundColor: withAlpha(theme.colors.danger, 0.12),
  borderColor: theme.colors.danger,
  borderWidth: theme.components.card.borderWidth,
  padding: theme.spacing.md,
  borderRadius: theme.radii.xl,
  marginBottom: theme.spacing.md },
 errorTitle: { color: theme.colors.danger, fontWeight: '600' },
 errorText: { color: theme.colors.danger, marginTop: theme.spacing.xs },
 successCard: {
  backgroundColor: withAlpha(theme.colors.success, 0.1),
  borderColor: theme.colors.success,
  borderWidth: theme.components.card.borderWidth,
  padding: theme.spacing.md,
  borderRadius: theme.radii.xl,
  marginBottom: theme.spacing.md },
 successText: { color: theme.colors.success, fontWeight: '600' },
 assigneeOption: { paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.xs },
 assigneeText: { fontSize: theme.typography.sizes.md, color: theme.colors.text },
 copyBtn: {
  backgroundColor: withAlpha(theme.colors.primary, 0.08),
  paddingVertical: theme.spacing.sm,
  paddingHorizontal: theme.spacing.md,
  borderRadius: theme.radii.sm,
  borderWidth: theme.components.card.borderWidth,
  borderColor: withAlpha(theme.colors.primary, 0.35) },
 copyBtnText: { color: theme.colors.primary, fontWeight: '600' },
 modalContainer: {
  backgroundColor: theme.colors.surface,
  borderRadius: theme.radii.lg,
  padding: theme.spacing.xl,
  width: `${Math.round((theme.components?.modal?.widthPct ?? 0.9) * 100)}%`,
  alignSelf: 'center',
  maxWidth: theme.components?.modal?.maxWidth ?? 400 },
 modalContainerFull: {
  backgroundColor: theme.colors.surface,
  borderTopLeftRadius: theme.radii.xl,
  borderTopRightRadius: theme.radii.xl,
  padding: theme.spacing.xl,
  width: '100%' },
 modalTitle: { fontSize: theme.typography.sizes.lg, fontWeight: '600', marginBottom: theme.spacing.md },
 modalText: { fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary, marginBottom: theme.spacing.xl },
 modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.md },
 helperError: { color: theme.colors.danger, fontSize: theme.typography.sizes.xs, marginTop: theme.spacing.xs, marginLeft: theme.spacing.md },
 centeredModal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
  });
}, [theme]);
 
 const roleColor = React.useCallback((r) => {
  if (r === ROLE.ADMIN) return theme.colors.primary;
  if (r === ROLE.DISPATCHER) return theme.colors.success;
  if (r === ROLE.WORKER) return theme.colors.worker || theme.colors.primary;
  return theme.colors.textSecondary;
 }, [theme]);
 const { success: toastSuccess, error: toastError, info: toastInfo, setAnchorOffset, loading: toastLoading, promise: toastPromise } = useToast();
const router = useRouter();
 const navigation = useNavigation();
 
 
const { id } = useLocalSearchParams();
 const userId = Array.isArray(id) ? id[0] : id;
 const [meIsAdmin, setMeIsAdmin] = useState(false);
 const [meId, setMeId] = useState(null);
 const [meLoaded, setMeLoaded] = useState(false);
 const canEdit = meIsAdmin || (meId && meId === userId);
 const [avatarUrl, setAvatarUrl] = useState(null);
 const [avatarSheet, setAvatarSheet] = useState(false);
 const [avatarKey, setAvatarKey] = useState(0);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [firstName, setFirstName] = useState('');
 const [lastName, setLastName] = useState('');
 const [headerName, setHeaderName] = useState(S('placeholder_no_name'));
 const [email, setEmail] = useState('');
 const [phone, setPhone] = useState('');
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
   const { error: updErr } = await supabase
    .from(TABLES.profiles)
    .update({ avatar_url: publicUrl })
    .eq('id', userId);
   if (updErr) throw updErr;
   setAvatarUrl(publicUrl);
   toastSuccess(S('toast_avatar_updated'));
  } catch (e) {
   setErr(e?.message || S('toast_generic_error'));
  }
 };
 const deleteAvatar = async () => {
  try {
   setErr('');
   toastInfo(S('toast_saving'), { sticky: true });
   const prefix = `${STORAGE.AVATAR_PREFIX}/${userId}`;
   const { data: list, error: listErr } = await supabase.storage.from(STORAGE.AVATARS).list(prefix);
   if (!listErr && Array.isArray(list) && list.length) {
    const paths = list.map((f) => `${prefix}/${f.name}`);
    await supabase.storage.from(STORAGE.AVATARS).remove(paths);
   }
   const { error: updErr } = await supabase
    .from(TABLES.profiles)
    .update({ avatar_url: null })
    .eq('id', userId);
   if (updErr) throw updErr;
   setAvatarUrl(null);
   toastSuccess(S('toast_saved'));
  } catch (e) {
   setErr(e?.message || S('toast_generic_error'));
  }
 };
 const pickFromCamera = async () => {
  const okCam = await ensureCameraPerms();
  if (!okCam) {
   setErr(S('error_camera_denied'));
   return;
  }
  const res = await ImagePicker.launchCameraAsync({
   allowsEditing: true,
   aspect: MEDIA_ASPECT,
   quality: MEDIA_QUALITY,
   mediaTypes: ImagePicker.MediaTypeOptions.Images });
  if (!res.canceled && res.assets && res.assets[0]?.uri) {
   await uploadAvatar(res.assets[0].uri);
  }
 };
 const pickFromLibrary = async () => {
  const okLib = await ensureLibraryPerms();
  if (!okLib) {
   setErr(S('error_library_denied'));
   return;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
   allowsEditing: true,
   aspect: MEDIA_ASPECT,
   quality: MEDIA_QUALITY,
   mediaTypes: ImagePicker.MediaTypeOptions.Images,
   selectionLimit: 1 });
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
 const insets = useSafeAreaInsets();
 const scrollYRef = useRef(0);
 const ensureVisible = (ref) => {
   try {
     if (!ref?.current || !scrollRef?.current) return;
     requestAnimationFrame(() => {
       try {
         ref.current.measureInWindow((x, y, w, h) => {
           const screenH = Dimensions.get('window').height;
           const bottom = (y || 0) + (h || 0);
           const visibleH = screenH - ((insets?.bottom || 0) + EXTRA_SCROLL_PAD);
           if (bottom > visibleH) {
             const delta = bottom - visibleH + EXTRA_SCROLL_PAD;
             const currentY = scrollYRef?.current || 0;
             scrollRef.current.scrollTo({ y: currentY + delta, animated: true });
           }
         });
       } catch (e) {}
     });
   } catch (e) {}
 };

const isDirty = useMemo(() => {
  if (!initialSnap) return false;
  const current = JSON.stringify({
   firstName: firstName.trim(),
   lastName: lastName.trim(),
   email: email.trim(),
   phone: String(phone).replace(/\D/g, '') || '',
   birthdate: birthdate ? birthdate.toISOString().slice(0, 10) : null,
   role,
   newPassword: newPassword || null,
   departmentId: departmentId || null,
   isSuspended: !!isSuspended });
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
   autoClearLoadingRef.current = setTimeout(() => setLoading(false), theme.timings?.requestTimeoutMs ?? 12000);
  }
  return () => {
   if (autoClearLoadingRef.current) clearTimeout(autoClearLoadingRef.current);
  };
 }, [loading]);
const showWarning = (msg) => {
 setWarningMessage(String(msg || S('dlg_generic_warning')));
 setWarningVisible(true);
};
const confirmCancel = () => {
 setCancelVisible(false);
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

const saveRef = useRef(null);
const cancelRef = useRef(null);
const onPressSave = React.useCallback(() => {
 if (saveRef.current) return saveRef.current();
}, []);
const onPressCancel = React.useCallback(() => {
 if (cancelRef.current) return cancelRef.current();
}, []);
useEffect(() => {
 saveRef.current = handleSave;
 cancelRef.current = handleCancelPress;
});
const handleSave = async () => {
 setErr('');
 if (!firstName.trim()) {
  showWarning(S('err_first_name'));
  return;
 }
 if (!lastName.trim()) {
  showWarning(S('err_last_name'));
  return;
 }
 if (!emailValid) {
  showWarning(S('err_email'));
  return;
 }
 if (String(phone || '').trim() && !isValidPhone(String(phone||''))) {
  showWarning(S('err_phone'));
  return;
 }
 if (!passwordValid) {
  showWarning(S('err_password_short'));
  return;
 }
 if (newPassword && newPassword.length> 0) {
  setPendingSave(true);
  setConfirmPwdVisible(true);
  return;
 }
 await proceedSave();
};
const proceedSave = async () => {
 try {
  setSaving(true);
  setErr('');
  toastInfo(S('toast_saving'), { sticky: true });
  const payload = { first_name: firstName.trim(), last_name: lastName.trim(), phone: String(phone || '').replace(/\D/g, '') || null, birthdate: birthdate ? new Date(birthdate).toISOString().slice(0, 10) : null, department_id: meIsAdmin ? (departmentId || null) : undefined, role: (meIsAdmin && !(meId && meId === userId)) ? role : undefined };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  const { data: updRows, error: updProfileErr } = await supabase
   .from(TABLES.profiles)
   .update(payload)
   .eq('id', userId)
   .select('id');
  if (updProfileErr) throw updProfileErr;
  if (!Array.isArray(updRows) || updRows.length === 0) {
   throw new Error(S('error_profile_not_updated'));
  }
  try {
   const { data: sess } = await supabase.auth.getSession();
   const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
   const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/${APP_FUNCTIONS.UPDATE_USER || ''}`;
   if (APP_FUNCTIONS.UPDATE_USER && FN_URL && FN_URL.includes('/functions/v1/') && FN_URL.startsWith('http')) {
    const body = {
     user_id: userId,
     email: String(email || '').trim() || undefined,
     password: newPassword && newPassword.length ? newPassword : undefined,
     role: meIsAdmin ? role : undefined };
    const res = await fetch(FN_URL, {
     method: 'POST',
     headers: {
      'Content-Type': 'application/json',
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}` },
     body: JSON.stringify(body) });
    if (!res.ok) {
     try {
      const j = await res.json();
      console.warn('Edge update_user failed:', j);
     } catch (e) { }
    }
   }
  }
catch (e) { }
  setNewPassword('');
  setConfirmPwdVisible(false);
  setPendingSave(false);
  setHeaderName(`${firstName || ''} ${lastName || ''}`.replace(/\s+/g, ' ').trim() || S('placeholder_no_name'));
  setInitialSnap(JSON.stringify({
   firstName: firstName.trim(),
   lastName: lastName.trim(),
   email: String(email || '').trim(),
   phone: String(phone || '').replace(/\D/g, '') || '',
   birthdate: birthdate ? String(new Date(birthdate).toISOString().slice(0, 10)) : null,
   role,
   newPassword: null,
   departmentId: departmentId || null,
   isSuspended }));
  allowLeaveRef.current = true;
  toastSuccess(S('toast_saved'));
 }
 catch (e) {
  setErr(e?.message || S('error_save_failed'));
  toastError(e?.message || S('error_save_failed'));
 }
 finally {
  setSaving(false);
 }
};
useLayoutEffect(() => {
  navigation.setOptions({
    header: () => (
      <AppHeader
        title={S('title_edit')}
        leftText={S('header_cancel')}
        rightText={S('header_save')}
        onLeftPress={onPressCancel}
        onRightPress={onPressSave}
      />
    ),
  });
}, [navigation, onPressSave, onPressCancel]);

 useEffect(() => { try { setAnchorOffset(theme.components?.toast?.anchorOffset ?? 120); } catch (e) {} }, []);

 useEffect(() => {
 const sub = navigation.addListener('beforeRemove', (e) => {
   if (allowLeaveRef.current || !isDirty) return;
   e.preventDefault();
   setCancelKey((k) => k + 1);
   setCancelVisible(true);
  });
  return sub;
 } , [navigation, isDirty]);
 useEffect(() => {
  if (initialSnap) {
   allowLeaveRef.current = false;
  }
 }, [firstName, lastName, email, phone, birthdate, role, newPassword, isSuspended, departmentId]);
 const passwordValid = useMemo(
  () => newPassword.length === 0 || newPassword.length>= 6,
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
  } catch (e) {
  }
 }, []);
const fetchMe = useCallback(async () => {
  const { data: authUser } = await supabase.auth.getUser();
  const uid = authUser?.user?.id;
  if (!uid) { setMeLoaded(true); return; }
  setMeId(uid);
  const { data: me } = await supabase.from(TABLES.profiles).select('id, role').eq('id', uid).single();
  setMeIsAdmin(me?.role === ROLE.ADMIN);
  setMeLoaded(true);
 }, []);
 const formatName = (p) => {
  const n1 = (p.first_name || '').trim();
  const n2 = (p.last_name || '').trim();
  const fn = (p.full_name || '').trim();
  const name = n1 || n2 ? `${n1} ${n2}`.replace(/\s+/g, ' ').trim() : fn || S('placeholder_no_name');
  return name;
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
    .select('first_name, last_name, full_name, phone, is_suspended, suspended_at, avatar_url, department_id, role, birthdate')
    .eq('id', userId)
    .maybeSingle();

   if (prof) {
    setFirstName(prof.first_name || '');
    setLastName(prof.last_name || '');
    setHeaderName(formatName(prof));
    setDepartmentId(prof?.department_id ?? null);
    if (typeof prof.avatar_url !== 'undefined') setAvatarUrl(prof.avatar_url || null);
    if (typeof prof.phone !== 'undefined') setPhone(String(prof.phone || '').replace(/\D/g, ''));
    setIsSuspended(!!(prof?.is_suspended || prof?.suspended_at));
    if (!meIsAdmin && prof?.birthdate) {
     const d = new Date(prof.birthdate);
     setBirthdate(!isNaN(d.getTime()) ? d : null);
    }
    if (!meIsAdmin) setRole(prof.role || ROLE.WORKER);
   }

   setInitialSnap(JSON.stringify({
    firstName: (prof?.first_name || '').trim(),
    lastName: (prof?.last_name || '').trim(),
    email: (meIsAdmin ? (adminRow?.email || '') : email).trim?.() || '',
    phone: String(prof?.phone || '').replace(/\D/g, '') || '',
    birthdate: (meIsAdmin ? adminRow?.birthdate : (prof?.birthdate || null)) ? String(meIsAdmin ? adminRow?.birthdate : prof?.birthdate) : null,
    role: meIsAdmin ? (adminRow?.user_role || ROLE.WORKER) : (prof?.role || ROLE.WORKER),
    newPassword: null,
    departmentId: (prof?.department_id ?? null),
    isSuspended: !!(prof?.is_suspended || prof?.suspended_at)
   }));
  } catch (e) {
   setErr(e?.message || S('toast_generic_error'));
   toastError(e?.message || S('toast_generic_error'));
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
   .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, () => {
    fetchUser();
    fetchDepartments();
   })
   .subscribe();
  return () => { try { channel.unsubscribe(); } catch {} };
 }, [userId, fetchUser, fetchDepartments]);
const reassignOrders = async (fromUserId, toUserId) => {
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
   const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/${APP_FUNCTIONS.UPDATE_USER || ''}`;
   if (APP_FUNCTIONS.UPDATE_USER && FN_URL && FN_URL.includes('/functions/v1/') && FN_URL.startsWith('http')) {
    try {
     const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
       'Content-Type': 'application/json',
       apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
       Authorization: `Bearer ${token}` },
      body: JSON.stringify({
       user_id: uid,
       is_suspended: !!value,
       suspended_at: value ? new Date().toISOString() : null }) });
    } catch (e) { }
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
 const deleteUserEverywhere = async (uid) => {
  const tryPaths = (
  APP_FUNCTIONS.DELETE_USERAliases && APP_FUNCTIONS.DELETE_USERAliases.length
    ? APP_FUNCTIONS.DELETE_USERAliases.map(n => '/' + String(n || '').replace(/^\//, ''))
    : (String(process.env.EXPO_PUBLIC_FN_DELETE_USER_ALIASES || '')
        .split(',').map(s => s.trim()).filter(Boolean).map(n => '/' + n))
);
  if (APP_FUNCTIONS.DELETE_USER) { tryPaths.unshift('/' + String(APP_FUNCTIONS.DELETE_USER).replace(/^\//, '')); }
  try {
   const { data: sess } = await supabase.auth.getSession();
   const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
   const base = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`;
   for (const path of tryPaths) {
    const url = base + path;
    if (!url.startsWith('http')) continue;
    const res = await fetch(url, {
     method: 'POST',
     headers: {
      'Content-Type': 'application/json',
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}` },
     body: JSON.stringify({ user_id: uid }) });
    if (res.ok) return null;
    let payload = null;
    try {
     payload = await res.json();
    } catch (e) { } if (payload && (payload.ok === true || payload.success === true)) return null;
   }
  } catch (e) { } const { error } = await supabase.from(TABLES.profiles).delete().eq('id', uid);
  return error;
 };
 const onAskSuspend = () => {
  if (!meIsAdmin) return showWarning(S('error_no_access'));
  if (meId && userId === meId) return; // не для себя
  setOrdersAction('keep');
  setSuccessor(null);
  setSuccessorError('');
  setSuspendVisible(true);
 };
 const onAskUnsuspend = () => {
  if (!meIsAdmin) return showWarning(S('error_no_access'));
  if (meId && userId === meId) return;
  setUnsuspendVisible(true);
 };
 const onConfirmSuspend = async () => {
  if (!meIsAdmin) return showWarning(S('error_no_access'));
  if (meId && userId === meId) return;
  try {
   setSaving(true);
   setErr('');
   toastInfo(S('toast_saving'), { sticky: true });
   if (ordersAction === 'reassign') {
    if (!successor?.id) {
     setSuccessorError(S('err_successor_required'));
     setSaving(false);
     return;
    }
    const errR = await reassignOrders(userId, successor.id);
    if (errR) throw new Error(errR.message || S('toast_generic_error'));
   }
   const errS = await setSuspended(userId, true);
   if (errS) throw new Error(errS.message || S('toast_generic_error'));
   setIsSuspended(true);
   toastSuccess(S('toast_suspended'));
   setSuspendVisible(false);
  } catch (e) {
   setErr(e?.message || S('dlg_generic_warning'));
   toastError(e?.message || S('dlg_generic_warning'));
  } finally {
   setSaving(false);
  }
 };
 const onConfirmUnsuspend = async () => {
  if (!meIsAdmin) return showWarning(S('error_no_access'));
  if (meId && userId === meId) return;
  try {
   setSaving(true);
   setErr('');
   toastInfo(S('toast_saving'), { sticky: true });
   const errS = await setSuspended(userId, false);
   if (errS) throw new Error(errS.message || S('err_unsuspend_failed'));
   setIsSuspended(false);
   toastSuccess(S('toast_unsuspended'));
   setUnsuspendVisible(false);
  } catch (e) {
   setErr(e?.message || S('dlg_generic_warning'));
   toastError(e?.message || S('dlg_generic_warning'));
  } finally {
   setSaving(false);
  }
 };
 const onAskDelete = () => {
  if (!meIsAdmin) return showWarning(S('error_no_access'));
  if (meId && userId === meId) return;
  setSuccessor(null);
  setSuccessorError('');
  setDeleteVisible(true);
 };
 const onConfirmDelete = async () => {
  if (!meIsAdmin) return showWarning(S('error_no_access'));
  if (meId && userId === meId) return;
  if (!successor?.id) {
   setSuccessorError(S('err_successor_required'));
   return;
  }
  try {
   setSaving(true);
   setErr('');
   toastInfo(S('toast_saving'), { sticky: true });
   const errR = await reassignOrders(userId, successor.id);
   if (errR) throw new Error(errR.message || S('toast_generic_error'));
   const errD = await deleteUserEverywhere(userId);
   if (errD) throw new Error(errD.message || S('toast_generic_error'));
   toastSuccess(S('toast_deleted'));
   setDeleteVisible(false);
   setTimeout(() => router.back(), theme.timings?.backDelayMs ?? 300)
  } catch (e) {
   setErr(e?.message || S('dlg_generic_warning'));
   toastError(e?.message || S('dlg_generic_warning'));
  } finally {
   setSaving(false);
  }
 };
 const openSuccessorPickerFromDelete = () => {
  setPickerReturn('delete');
  setDeleteVisible(false);
  setPickerVisible(true);
 };
 const openSuccessorPickerFromSuspend = () => {
  setPickerReturn('suspend');
  setSuspendVisible(false);
  setPickerVisible(true);
 };
if (loading || !meLoaded) {
  return (
    <Screen background="background" scroll={false}>
      <ActivityIndicator size="large" />
    </Screen>
  );
}
 if (!canEdit) {
  return (
   <Screen background="background" scroll={false}>
    <View style={{ padding: theme.spacing.lg, justifyContent: 'center', alignItems: 'center', flex: 1 }}>
     <Text style={{ fontSize: theme.typography.sizes.md, color: theme.colors.textSecondary }}>{S('error_no_access')}</Text>
    </View>
   </Screen>
  );
 }
 const isSelfAdmin = meIsAdmin && meId === userId;
 const initials =
  `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}`.toUpperCase();
 return (
  <Screen background="background" scroll={false}>
    
<View style={styles.container}>
     <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      onScroll={(e) => { try { scrollYRef.current = e.nativeEvent.contentOffset.y || 0; } catch (_) {} }}
      scrollEventThrottle={16}
      contentInsetAdjustmentBehavior="always"
      contentContainerStyle={[styles.scroll, { paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl }]}
      showsVerticalScrollIndicator={false}
     >
      <View
       style={[
        styles.card,
        styles.headerCard,
        isSuspended ? styles.headerCardSuspended : null,
       ]}>
       <View style={styles.headerRow}>
        <Pressable
         style={styles.avatar}
         onPress={() => { setAvatarKey((k) => k + 1); setAvatarSheet(true); }}
         accessibilityRole="button"
         accessibilityLabel={S('a11y_change_avatar')}
         accessibilityHint={S('a11y_change_avatar_hint')}>
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
           flexWrap: 'wrap' }}>
          <View
           style={[styles.rolePillHeader, { borderColor: withAlpha(isSuspended ? theme.colors.danger : theme.colors.success, 0.2), backgroundColor: withAlpha(isSuspended ? theme.colors.danger : theme.colors.success, 0.13) }]}>
           <Text style={[styles.rolePillHeaderText, { color: isSuspended ? theme.colors.danger : theme.colors.success }]}>
            {isSuspended ? S('status_suspended') : S('status_active')}
           </Text>
          </View>
          {role === ROLE.ADMIN ? (
           <View
            style={[
             styles.rolePillHeader,
             {
              borderColor: withAlpha(roleColor('admin'), 0.2),
              backgroundColor: withAlpha(roleColor('admin'), 0.13) },
            ]}>
            <Text style={[styles.rolePillHeaderText, { color: roleColor('admin') }]}>
             {ROLE_LABELS.admin}
            </Text>
           </View>
          ) : (
           !isSelfAdmin && (
            <View
             style={[
              styles.rolePillHeader,
              {
               borderColor: withAlpha(roleColor(role), 0.2),
               backgroundColor: withAlpha(roleColor(role), 0.13) },
             ]}>
             <Text style={[styles.rolePillHeaderText, { color: roleColor(role) }]}>
              {ROLE_LABELS[role] || role}
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
        <Text style={styles.errorTitle}>{S('dlg_alert_title')}</Text>
        <Text style={styles.errorText}>{err}</Text>
       </View>
      ) : null}
      <Text style={styles.section}>{S('section_personal')}</Text>
      <Card>
       <TextField label={S('label_first_name')} placeholder={S('placeholder_first_name')} placeholderTextColor={theme.colors.inputPlaceholder} style={styles.field}
        value={firstName}
        onChangeText={setFirstName}
        onFocus={() => setFocusFirst(true)}
        onBlur={() => setFocusFirst(false)}
        />
       {!firstName.trim() ? <Text style={styles.helperError}>{S('err_first_name')}</Text> : null}
       <TextField label={S('label_last_name')} placeholder={S('placeholder_last_name')} placeholderTextColor={theme.colors.inputPlaceholder} style={styles.field}
        value={lastName}
        onChangeText={setLastName}
        onFocus={() => setFocusLast(true)}
        onBlur={() => setFocusLast(false)}
        />
       {!lastName.trim() ? <Text style={styles.helperError}>{S('err_last_name')}</Text> : null}
       <TextField
 label={S('label_email')}
 placeholder={S('placeholder_email')} placeholderTextColor={theme.colors.inputPlaceholder}
 style={styles.field}
 keyboardType="email-address"
 autoCapitalize="none"
 autoCorrect={false}
 value={email}
 onChangeText={setEmail}
 onFocus={() => setFocusEmail(true)}
 onBlur={() => setFocusEmail(false)}
/>
{!emailValid ? (
        <Text style={styles.helperError}>{S('err_email')}</Text>
       ) : null}
       <PhoneInput
 value={phone}
 onChangeText={(val, meta) => {
  setPhone(val);
 }}
 error={!isValidPhone(String(phone||'')) ? S('err_phone') : undefined}
 style={styles.field}
 onFocus={() => setFocusPhone(true)}
 onBlur={() => setFocusPhone(false)}
/>
<SelectField
  label={S('label_birthdate')}
  value={birthdate ? formatDateRU(birthdate, withYear) : S('placeholder_birthdate')}
  onPress={() => setDobModalVisible(true)}
  showValue={true}
  style={styles.field}
/>
      </Card>
      {!isSelfAdmin && (
       <Card>
        <View style={{ flexDirection: 'row' }}>
         <UIButton
          title={S('btn_delete')}
          variant="destructive"
          onPress={onAskDelete}
          style={{ flex: 1 }}
        />
        </View>
       </Card>
      )}
      {meIsAdmin && (
  <>
    <Text style={styles.section}>{S('section_company_role')}</Text>
    <Card>
      <View style={{ marginTop: theme.spacing.xs }}>
  <Text style={styles.label}>{S('label_department')}</Text>
  <SelectField
    value={activeDeptName || S('placeholder_department')}
    onPress={() => setDeptModalVisible(true)}
    showValue={true}
  />
</View>

      {!isSelfAdmin && (
        <>
          <View style={{ marginTop: theme.spacing.xs }}>
  <Text style={styles.label}>{S('label_role')}</Text>
  <SelectField
    value={ROLE_LABELS[role] || role}
    onPress={() => setShowRoles(true)}
    showValue={true}
  />
</View>
          <View style={{ marginTop: theme.spacing.xs }}>
  <Text style={styles.label}>{S('label_status')}</Text>
  <SelectField
    value={isSuspended ? S('status_suspended') : S('status_active')}
    onPress={isSuspended ? onAskUnsuspend : onAskSuspend}
    showValue={true}
  />
</View>
        </>
      )}
    </Card>
  </>
)}

<Text style={styles.section}>{S('section_password')}</Text>
<Card>
  <View style={{ position: 'relative' }}>
    <TextField
  ref={pwdRef}
  value={newPassword}
  onChangeText={setNewPassword}
  placeholder={S('placeholder_new_password')}
  secureTextEntry={!showPassword}
  autoCapitalize="none"
  autoCorrect={false}
  error={newPassword.length > 0 && !passwordValid ? ' ' : undefined}
  style={styles.field}
  rightSlot={(
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Pressable
        onPress={() => { pwdRef.current?.blur(); setShowPassword(v => !v); }}
        accessibilityLabel={showPassword ? S('a11y_hide_password') : S('a11y_show_password')}
        hitSlop={{ top: theme.spacing.sm, bottom: theme.spacing.sm, left: theme.spacing.sm, right: theme.spacing.sm }}
        style={{ padding: theme.spacing.xs }}
      >
        <Feather name={showPassword ? 'eye' : 'eye-off'} size={ICON_MD} color={theme.colors.textSecondary} />
      </Pressable>
      {!!newPassword && (
        <IconButton
          onPress={async () => {
            await Clipboard.setStringAsync(newPassword || '');
            toastSuccess(S('toast_password_copied'));
          }}
          accessibilityLabel={S('a11y_copy_password')}
          size={ICONBUTTON_TOUCH}
        >
          <Feather name="copy" size={ICON_SM} />
        </IconButton>
      )}
    </View>
  )}
/>
  </View>
  </Card>
  {newPassword.length > 0 && !passwordValid ? (
    <Text style={{ marginTop: theme.spacing.xs, color: theme.colors.danger, fontSize: theme.typography.sizes.xs }}>{S('err_password_short')}</Text>
  ) : null}
     </ScrollView>
         </View>
    {/* Exit without saving confirmation */}
    <ConfirmModal
      key={`cancel-${cancelKey}`}
      visible={cancelVisible}
      onClose={() => setCancelVisible(false)}
      title={S('dlg_leave_title')}
      message={S('dlg_leave_msg')}
      confirmLabel={S('dlg_leave_confirm')}
      cancelLabel={S('dlg_leave_cancel')}
      confirmVariant="destructive"
      onConfirm={confirmCancel}
    />
    {/* Alert message */}
    <AlertModal
      visible={warningVisible}
      onClose={() => setWarningVisible(false)}
      title={S('dlg_alert_title')}
      message={warningMessage}
      buttonLabel={S('dlg_ok')}
    />
    {/* Confirm password update */}
    <ConfirmModal
      visible={confirmPwdVisible}
      onClose={() => {
        setConfirmPwdVisible(false);
        setPendingSave(false);
      }}
      title={S('dlg_confirm_pwd_title')}
      message={S('dlg_confirm_pwd_msg')}
      confirmLabel={saving ? S('toast_saving') : S('header_save')}
      cancelLabel={S('header_cancel')}      confirmVariant="primary"
      onConfirm={() => proceedSave()}
    />
        <SuspendModal
      visible={suspendVisible}
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
      title={S('dlg_unsuspend_title')}
      message={S('dlg_unsuspend_msg')}
      confirmLabel={saving ? S('dlg_unsuspend_apply') : S('dlg_unsuspend_confirm')}
      cancelLabel={S('header_cancel')}      confirmVariant="primary"
      onConfirm={onConfirmUnsuspend}
    />
    <DeleteEmployeeModal
      visible={deleteVisible}
      successor={successor}
      successorError={successorError}
      setSuccessorError={setSuccessorError}
      openSuccessorPicker={openSuccessorPickerFromDelete}
      onConfirm={onConfirmDelete}
      saving={saving}
      onClose={() => setDeleteVisible(false)}
    />
    
    <SelectModal
      visible={pickerVisible}
      title={S('picker_user_title')}
      items={(pickerItems || []).map((it) => ({
        id: it.id,
        label: it.name,
        subtitle: ROLE_LABELS[it.role] || it.role,
        right: null,
      }))}
      onSelect={(item) => {
        setSuccessor({ id: item.id, name: item.label, role: item.role });
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
      avatarUrl={avatarUrl}
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
          roleLabels={ROLE_LABELS}
          roleDescriptions={ROLE_DESCRIPTIONS}
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
          const d = new Date(dateObj);
          setBirthdate(d);
          if (extra && typeof extra.withYear === 'boolean') setWithYear(extra.withYear);
        } finally {
          setDobModalVisible(false);
        }
      }}
    />

        </Screen>
 );
}