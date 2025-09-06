// apps/field-work/app/users/[id].jsx

import { AntDesign } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter, useFocusEffect, useNavigation } from 'expo-router';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  
  View,
  Image,
} from 'react-native';
import { MaskedTextInput } from 'react-native-mask-text';
import Modal from 'react-native-modal';


import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';
import Screen from '../../components/layout/Screen';
import UIButton from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';

const SECONDARY_BG = '#d1d1d6';


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
  // fallback for dynamic color objects
  return `rgba(0,0,0,${a})`;
}




const ITEM_HEIGHT = 44;
const VISIBLE_COUNT = 5;
const SCREEN_W = Dimensions.get('window').width;
const DIALOG_W = Math.min(SCREEN_W * 0.85, 360);
const WHEEL_W = (DIALOG_W - 32) / 3;

const MONTHS_GEN = [
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
const MONTHS_ABBR = [
  'янв.',
  'февр.',
  'март',
  'апр.',
  'май',
  'июн.',
  'июл.',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
];

function daysInMonth(monthIdx, yearNullable) {
  if (monthIdx === 1 && yearNullable == null) return 29;
  const y = yearNullable ?? 2024;
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

function Wheel({ data, index, onIndexChange, width, enabled = true, activeColor = '#007AFF' }) {
  const listRef = useRef(null);
  const isSyncingRef = useRef(false);
  const [selIndex, setSelIndex] = useState(index ?? 0);

  



  // Запуск загрузки данных при монтировании: без этого loading остаётся true и экран крутится бесконечно
  useEffect(() => {
    const next = Math.max(0, Math.min(data.length - 1, index ?? 0));
    if (next !== selIndex) {
      setSelIndex(next);
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: next * ITEM_HEIGHT, animated: false });
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 0);
    }
  }, [index, data.length]);

  useEffect(() => {
    if (selIndex > data.length - 1) {
      const next = data.length - 1;
      setSelIndex(next);
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: next * ITEM_HEIGHT, animated: false });
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 0);
      onIndexChange?.(next);
    }
  }, [data.length]);

  const snapOffsets = useMemo(() => data.map((_, i) => i * ITEM_HEIGHT), [data]);

  const onMomentumEnd = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const i = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(data.length - 1, i));
    const target = clamped * ITEM_HEIGHT;
    if (!isSyncingRef.current && Math.abs(target - y) > 0.5) {
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: target, animated: false });
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 0);
    }
    if (clamped !== selIndex) {
      setSelIndex(clamped);
      onIndexChange?.(clamped);
    }
  };

  return (
    <FlatList
      ref={listRef}
      data={data}
      keyExtractor={(_, i) => String(i)}
      renderItem={({ item, index: i }) => (
        <View style={[wheelStyles.item, !enabled && { opacity: 0.35 }]}>
          <Text style={[wheelStyles.itemText, i === selIndex && [wheelStyles.itemTextActive, { color: activeColor }]]}>
            {item}
          </Text>
        </View>
      )}
      showsVerticalScrollIndicator={false}
      getItemLayout={(_, i) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * i, index: i })}
      snapToOffsets={snapOffsets}
      snapToAlignment="center"
      decelerationRate={Platform.OS === 'ios' ? 0.995 : 0.985}
      bounces={false}
      overScrollMode="never"
      onMomentumScrollEnd={onMomentumEnd}
      initialNumToRender={VISIBLE_COUNT + 2}
      scrollEventThrottle={16}
      style={{ width }}
      contentContainerStyle={{ paddingVertical: (ITEM_HEIGHT * (VISIBLE_COUNT - 1)) / 2 }}
      scrollEnabled={enabled}
      initialScrollIndex={Math.max(0, Math.min(data.length - 1, selIndex))}
      onScrollToIndexFailed={(info) => {
        const offset = Math.min(
          info.highestMeasuredFrameIndex * ITEM_HEIGHT,
          info.averageItemLength * info.index,
        );
        listRef.current?.scrollToOffset({ offset, animated: false });
        setTimeout(
          () =>
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: false,
              viewPosition: 0.5,
            }),
          0,
        );
      }}
    />
  );
}
const wheelStyles = StyleSheet.create({
  item: { height: ITEM_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  itemText: { fontSize: 18, color: '#C7C7CC' },
  itemTextActive: { fontSize: 20, fontWeight: '700' },
});

const ROLES = ['dispatcher', 'worker'];
const ROLE_LABELS = { dispatcher: 'Диспетчер', worker: 'Рабочий', admin: 'Администратор' };
const ROLE_DESCRIPTIONS = {
  dispatcher: 'Назначение и управление заявками.',
  worker: 'Выполнение заявок, без админ‑прав.',
};

export default function EditUser() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: 16 },
  /* pageTitle removed in favor of appBar */

  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  appBarBack: { padding: 6, borderRadius: 10 },
  appBarTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  rolePillHeader: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  rolePillHeaderText: { fontSize: 12, fontWeight: '600' },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerCard: { padding: 8, marginBottom: 12 },
  headerCardSuspended: {
    backgroundColor: withAlpha(theme.colors.danger, 0.08),
    borderColor: withAlpha(theme.colors.danger, 0.2),
    borderWidth: 1,
    borderRadius: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: withAlpha(theme.colors.primary, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.primary, 0.24),
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarCamBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    backgroundColor: theme.colors.primary,
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  avatarText: { color: theme.colors.primary, fontWeight: '700' },
  nameTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeGreen: { backgroundColor: theme.colors.success },
  badgeRed: { backgroundColor: theme.colors.danger },
  badgeOutline: {
    borderWidth: 1,
    borderColor: '#C7C7CC',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeOutlineText: { color: '#3A3A3C', fontSize: 12 },
  badgeText: { fontSize: 12, fontWeight: '600' },

  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 12,
    borderColor: theme.colors.border,
    borderWidth: 1,
    marginBottom: 12,
  },
  section: { marginTop: 6, marginBottom: 8, fontWeight: '600', color: theme.colors.text },
  label: { fontWeight: '500', marginBottom: 4, marginTop: 12, color: theme.colors.textSecondary },
  input: { marginHorizontal: 16, marginBottom: 10 },
  inputFocused: {
    borderColor: theme.colors.primary,
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  inputError: { borderColor: '#FF3B30' },

  inputWithIcon: { paddingRight: 44 },
  inputIcon: {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: [{ translateY: -10 }],
    padding: 0,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },

  selectInput: { marginHorizontal: 16, marginBottom: 10 },
  selectInputText: { fontSize: 16, color: theme.colors.text },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateClearBtn: { marginLeft: 8, padding: 6 },

  appButton: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center' },
  appButtonText: { fontSize: 16 },
  btnPrimary: { backgroundColor: theme.colors.primary },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  // outlined secondary button in "bank" style
  btnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#C7C7CC' },
  btnSecondaryText: { color: '#111', fontWeight: '500' },
  btnDestructive: { backgroundColor: theme.colors.danger },
  btnDestructiveText: { color: '#fff', fontWeight: '600' },

  errorCard: {
    backgroundColor: '#FF3B3018',
    borderColor: '#FF3B30',
    borderWidth: 1,
    padding: 12,
    borderRadius: 14,
    marginBottom: 12,
  },
  errorTitle: { color: '#D70015', fontWeight: '600' },
  errorText: { color: '#D70015', marginTop: 4 },

  successCard: {
    backgroundColor: '#34C75918',
    borderColor: '#34C759',
    borderWidth: 1,
    padding: 12,
    borderRadius: 14,
    marginBottom: 12,
  },
  successText: { color: '#1E9E4A', fontWeight: '600' },

  assigneeOption: { paddingVertical: 10, paddingHorizontal: 4 },
  assigneeText: { fontSize: 16, color: theme.colors.text },

  copyBtn: {
    backgroundColor: '#E5F0FF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7C7FF',
  },
  copyBtnText: { color: theme.colors.primary, fontWeight: '600' },

  modalContainer: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 20,
    width: '90%',
    alignSelf: 'center',
    maxWidth: 400,
  },
  modalContainerFull: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    width: '100%',
  },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  modalText: { fontSize: 15, color: '#555', marginBottom: 20 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },

  helperError: { color: '#D70015', fontSize: 12, marginTop: 6 },

  centeredModal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
  picker: {
    backgroundColor: theme.colors.surface,
    borderRadius: 18,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderColor: '#E5E5EA',
    borderWidth: 1,
    width: '85%',
    maxWidth: 360,
    overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  pickerTitle: {
    textAlign: 'center',
    fontSize: 18,
    color: theme.colors.text,
    marginBottom: 12,
    fontWeight: '600',
  },
  wheelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    height: ITEM_HEIGHT * VISIBLE_COUNT,
  },
  selectionLines: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: (ITEM_HEIGHT * (VISIBLE_COUNT - 1)) / 2,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E5EA',
  },
  pickerActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  actionBtn: { flex: 1 },
  yearSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  yearSwitchLabel: { color: theme.colors.text, fontSize: 14 },
  // dim overlays around the wheel area
  dimTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: ITEM_HEIGHT,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  dimBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: ITEM_HEIGHT,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },

  radioRow: { gap: 10 },
  radio: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#C7C7CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  radioOuterActive: { borderColor: theme.colors.primary },
  radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'transparent' },
  radioInnerActive: { backgroundColor: theme.colors.primary },

  roleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FAFAFC',
  },
  roleItemSelected: { borderColor: theme.colors.primary, backgroundColor: '#EAF2FF' },
  roleTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  roleDesc: { fontSize: 13, color: '#6B7280', marginTop: 2 },

  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  actionBarBtn: { marginLeft: 8 },

  toast: {
    alignSelf: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#CDEFD6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
    maxWidth: 440,
  },
  toastText: { color: '#1E9E4A', fontWeight: '600' },
}), [theme]);
  const roleColor = React.useCallback((r) => {
    if (r === 'admin') return theme.colors.primary;
    if (r === 'dispatcher') return theme.colors.success;
    if (r === 'worker') return theme.colors.worker || theme.colors.primary;
    return theme.colors.textSecondary;
  }, [theme]);
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;

  const [meIsAdmin, setMeIsAdmin] = useState(false);
  const [meId, setMeId] = useState(null);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [headerName, setHeaderName] = useState('Без имени'); // название профиля — меняем только после сохранения
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [birthdate, setBirthdate] = useState(null);

  // Department
  const [departmentId, setDepartmentId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [deptModalVisible, setDeptModalVisible] = useState(false);

  const activeDeptName = useMemo(() => {
    const d = (departments || []).find((x) => String(x.id) === String(departmentId));
    return d ? d.name : null;
  }, [departments, departmentId]);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [withYear, setWithYear] = useState(true);
  const [dayIdx, setDayIdx] = useState(0);
  const [monthIdx, setMonthIdx] = useState(0);
  const [yearIdx, setYearIdx] = useState(0);

  const [confirmPwdVisible, setConfirmPwdVisible] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);

  // focus states for iOS-like focus border
  const [focusFirst, setFocusFirst] = useState(false);
  const [focusLast, setFocusLast] = useState(false);
  const [focusEmail, setFocusEmail] = useState(false);
  const [focusPhone, setFocusPhone] = useState(false);
  const [focusPwd, setFocusPwd] = useState(false);

  const years = useMemo(() => {
    const nowY = new Date().getFullYear();
    return range(1900, nowY).reverse();
  }, []);
  const days = useMemo(
    () => range(1, daysInMonth(monthIdx, withYear ? years[yearIdx] : null)),
    [monthIdx, yearIdx, withYear, years],
  );

  const openPicker = () => {
    const base = birthdate instanceof Date ? new Date(birthdate) : new Date();
    const y = base.getFullYear();
    const m = base.getMonth();
    const d = base.getDate();
    const yIndex = Math.max(0, years.indexOf(y));
    setYearIdx(yIndex >= 0 ? yIndex : 0);
    setMonthIdx(m);
    setWithYear(true);
    const maxD = daysInMonth(m, years[yIndex >= 0 ? yIndex : 0]);
    setDayIdx(Math.max(0, Math.min(d - 1, maxD - 1)));
    setShowDatePicker(true);
  };

  const headerTitle = useMemo(() => {
    const d = (dayIdx + 1).toString();
    const m = MONTHS_GEN[monthIdx] || '';
    if (!withYear) return `${d} ${m}`;
    return `${d} ${m} ${years[yearIdx]}`;
  }, [dayIdx, monthIdx, withYear, yearIdx, years]);

  const applyPicker = () => {
    const d = dayIdx + 1;
    const m = monthIdx;
    const y = withYear ? years[yearIdx] : new Date().getFullYear();
    const next = new Date(y, m, d, 12, 0, 0, 0);
    setBirthdate(next);
    setShowDatePicker(false);
  };

  const [role, setRole] = useState('worker');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [showRoles, setShowRoles] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const toastAnim = useRef(new Animated.Value(0)).current;

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
      const filename = `avatar_${Date.now()}.jpg`;
      const path = `profiles/${userId}/${filename}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, fileData, { contentType: 'image/jpeg', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = pub?.publicUrl || null;
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);
      if (updErr) throw updErr;
      setAvatarUrl(publicUrl);
      setOk('Фото профиля обновлено');
    } catch (e) {
      setErr(e?.message || 'Не удалось загрузить фото');
    }
  };

  const deleteAvatar = async () => {
    try {
      setErr('');
      setOk('');
      // попытка удалить все файлы в папке пользователя
      const prefix = `profiles/${userId}`;
      const { data: list, error: listErr } = await supabase.storage.from('avatars').list(prefix);
      if (!listErr && Array.isArray(list) && list.length) {
        const paths = list.map((f) => `${prefix}/${f.name}`);
        await supabase.storage.from('avatars').remove(paths);
      }
      // очистить ссылку в профиле
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', userId);
      if (updErr) throw updErr;
      setAvatarUrl(null);
      setOk('Фото удалено');
    } catch (e) {
      setErr(e?.message || 'Не удалось удалить фото');
    }
  };

  const pickFromCamera = async () => {
    const okCam = await ensureCameraPerms();
    if (!okCam) {
      setErr('Нет доступа к камере');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) {
      await uploadAvatar(res.assets[0].uri);
    }
  };
  const pickFromLibrary = async () => {
    const okLib = await ensureLibraryPerms();
    if (!okLib) {
      setErr('Нет доступа к галерее');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      selectionLimit: 1,
    });
    if (!res.canceled && res.assets && res.assets[0]?.uri) {
      await uploadAvatar(res.assets[0].uri);
    }
  };

  useEffect(() => {
    if (!ok) return;
    toastAnim.stopAnimation();
    toastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(3200),
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => setOk(''));
  }, [ok]);

  const [cancelVisible, setCancelVisible] = useState(false);
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
    });
    return current !== initialSnap;
  }, [firstName, lastName, email, phone, birthdate, role, newPassword, isSuspended, initialSnap]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (allowLeaveRef.current) return false;
        if (isDirty) {
          setCancelVisible(true);
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [isDirty]),
  );

  const allowLeaveRef = useRef(false);

  



  const autoClearLoadingRef = useRef(null);
  useEffect(() => {
    if (loading) {
      autoClearLoadingRef.current = setTimeout(() => setLoading(false), 12000);
    }
    return () => {
      if (autoClearLoadingRef.current) clearTimeout(autoClearLoadingRef.current);
    };
  }, [loading]);
// --- Helpers & action handlers (added to fix missing references) ---
const showWarning = (msg) => {
  setWarningMessage(String(msg || 'Что-то пошло не так'));
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
    setCancelVisible(true);
    return;
  }
  // no changes — just leave
  allowLeaveRef.current = true;
  if (navigation && typeof navigation.goBack === 'function') {
    navigation.goBack();
  } else if (router && typeof router.back === 'function') {
    router.back();
  }
};

const handleSave = async () => {
  setErr('');
  // simple validations consistent with memoized flags
  if (!emailValid) {
    showWarning('Введите корректный e‑mail');
    return;
  }
  if (String(phone || '').trim() && !phoneValid) {
    showWarning('Телефон должен быть в формате +7 9XX XXX‑XX‑XX');
    return;
  }
  if (!passwordValid) {
    showWarning('Пароль должен быть не короче 6 символов');
    return;
  }
  // If password is being changed — ask to confirm
  if (newPassword && newPassword.length > 0) {
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
    setOk('');

    // Update basic profile fields
    const payload = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: String(phone || '').replace(/\D/g, '') || null,
      birthdate: birthdate ? new Date(birthdate).toISOString().slice(0, 10) : null,
      department_id: departmentId || null,
    };
    const { error: updProfileErr } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId);
    if (updProfileErr) throw updProfileErr;

    // Update auth-level fields (email / password / role) via edge function if available
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/update_user`;
      if (FN_URL && FN_URL.startsWith('http')) {
        const body = {
          user_id: userId,
          email: String(email || '').trim() || undefined,
          password: newPassword && newPassword.length ? newPassword : undefined,
          role,
        };
        await fetch(FN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      }
    } 
catch (e) {}
    // Reset password field if it was set
    setNewPassword('');
    setConfirmPwdVisible(false);
    setPendingSave(false);

    // Update header and initial snapshot to disable dirty guard
    setHeaderName(`${firstName || ''} ${lastName || ''}`.replace(/\s+/g, ' ').trim() || 'Без имени');
    setInitialSnap(JSON.stringify({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: String(email || '').trim(),
      phone: String(phone || '').replace(/\D/g, '') || '',
      birthdate: birthdate ? String(new Date(birthdate).toISOString().slice(0, 10)) : null,
      role,
      newPassword: null,
      departmentId: departmentId || null,
      isSuspended,
    }));
    allowLeaveRef.current = true;
    setOk('Сохранено');
  }
  catch (e) {
    setErr(e?.message || 'Не удалось сохранить изменения');
  }
  finally {
    setSaving(false);
  }
};

useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || !isDirty) return; // пропускаем, если уже подтвердили
      e.preventDefault();
      setCancelVisible(true);
    });
    return sub;
  }, [navigation, isDirty]);

  useEffect(() => {
    if (initialSnap) {
      // любое редактирование после сохранения снова включает защиту
      allowLeaveRef.current = false;
    }
  }, [firstName, lastName, email, phone, birthdate, role, newPassword, isSuspended, departmentId]);

  const passwordValid = useMemo(
    () => newPassword.length === 0 || newPassword.length >= 6,
    [newPassword],
  );
  const emailValid = useMemo(() => isValidEmailStrict(email), [email]);
  const rawPhone = useMemo(() => String(phone || '').replace(/\D/g, ''), [phone]);
  const phoneValid = useMemo(() => {
    if (rawPhone.length !== 11) return false;
    if (!rawPhone.startsWith('7')) return false;
    if (rawPhone[1] !== '9') return false; // РФ мобильные
    return true;
  }, [rawPhone]);

  const fetchMe = useCallback(async () => {
    const { data: authUser } = await supabase.auth.getUser();
    const uid = authUser?.user?.id;
    if (!uid) return;
    setMeId(uid);
    const { data: me } = await supabase.from('profiles').select('id, role').eq('id', uid).single();
    setMeIsAdmin(me?.role === 'admin');
  }, []);

  const formatName = (p) => {
    const n1 = (p.first_name || '').trim();
    const n2 = (p.last_name || '').trim();
    const fn = (p.full_name || '').trim();
    const name = n1 || n2 ? `${n1} ${n2}`.replace(/\s+/g, ' ').trim() : fn || 'Без имени';
    return name;
  };

  const fetchUser = useCallback(async () => {
  setLoading(true);
  try {
    const { data, error } = await supabase.rpc('admin_get_profile_with_email', { target_user_id: userId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    setEmail(row?.email || '');
    setRole(row?.user_role || 'worker');
    if (row?.birthdate) {
      const d = new Date(row.birthdate);
      setBirthdate(!isNaN(d.getTime()) ? d : null);
    } else setBirthdate(null);

    const { data: prof } = await supabase
      .from('profiles')
      .select('first_name, last_name, full_name, phone, is_suspended, suspended_at, avatar_url, department_id')
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
    }

    setInitialSnap(JSON.stringify({
      firstName: (prof?.first_name || '').trim(),
      lastName: (prof?.last_name || '').trim(),
      email: (row?.email || '').trim(),
      phone: String(prof?.phone || '').replace(/\D/g, '') || '',
      birthdate: row?.birthdate ? String(row?.birthdate) : null,
      role: row?.user_role || 'worker',
      newPassword: null,
      departmentId: (prof?.department_id ?? null),
      isSuspended: !!(prof?.is_suspended || prof?.suspended_at),
    }));
  } catch (e) {
    setErr(e?.message || 'Не удалось загрузить пользователя');
  } finally {
    setLoading(false);
  }
}, [userId]);

  
  // Стартовая загрузка данных при монтировании
  useEffect(() => {
    fetchMe();
    fetchUser();
  }, [fetchMe, fetchUser]);
const reassignOrders = async (fromUserId, toUserId) => {
    const { error } = await supabase
      .from('orders')
      .update({ assigned_to: toUserId })
      .eq('assigned_to', fromUserId);
    return error;
  };

  const setSuspended = async (uid, value) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/update_user`;
      if (FN_URL && FN_URL.startsWith('http')) {
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
        } catch {}
      }
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ is_suspended: !!value, suspended_at: value ? new Date().toISOString() : null })
        .eq('id', uid);
      return updErr ?? null;
    } catch (e) {
      const { error } = await supabase
        .from('profiles')
        .update({ is_suspended: !!value, suspended_at: value ? new Date().toISOString() : null })
        .eq('id', uid);
      return error ?? e;
    }
  };

  const deleteUserEverywhere = async (uid) => {
    const tryPaths = [
      '/admin_delete_user',
      '/delete_user',
      '/admin-delete-user',
      '/user_delete',
      '/remove_user',
    ];
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
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ user_id: uid }),
        });
        if (res.ok) return null;
        let payload = null;
        try {
          payload = await res.json();
        } catch {}
        if (payload && (payload.ok === true || payload.success === true)) return null;
      }
    } catch {}
    const { error } = await supabase.from('profiles').delete().eq('id', uid);
    return error;
  };

  const onAskSuspend = () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return; // не для себя
    setOrdersAction('keep');
    setSuccessor(null);
    setSuccessorError('');
    setSuspendVisible(true);
  };
  const onAskUnsuspend = () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return;
    setUnsuspendVisible(true);
  };
  const onConfirmSuspend = async () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return;
    try {
      setSaving(true);
      setErr('');
      setOk('');
      if (ordersAction === 'reassign') {
        if (!successor?.id) {
          setSuccessorError('Выберите правопреемника');
          setSaving(false);
          return;
        }
        const errR = await reassignOrders(userId, successor.id);
        if (errR) throw new Error(errR.message || 'Не удалось переназначить заявки');
      }
      const errS = await setSuspended(userId, true);
      if (errS) throw new Error(errS.message || 'Не удалось отстранить пользователя');
      setIsSuspended(true);
      setOk('Сотрудник отстранён');
      setSuspendVisible(false);
    } catch (e) {
      setErr(e?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };
  const onConfirmUnsuspend = async () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return;
    try {
      setSaving(true);
      setErr('');
      setOk('');
      const errS = await setSuspended(userId, false);
      if (errS) throw new Error(errS.message || 'Не удалось снять отстранение');
      setIsSuspended(false);
      setOk('Отстранение снято');
      setUnsuspendVisible(false);
    } catch (e) {
      setErr(e?.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };
  const onAskDelete = () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return;
    setSuccessor(null);
    setSuccessorError('');
    setDeleteVisible(true);
  };
  const onConfirmDelete = async () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return;
    if (!successor?.id) {
      setSuccessorError('Укажите правопреемника');
      return;
    }
    try {
      setSaving(true);
      setErr('');
      setOk('');
      const errR = await reassignOrders(userId, successor.id);
      if (errR) throw new Error(errR.message || 'Не удалось переназначить заявки');
      const errD = await deleteUserEverywhere(userId);
      if (errD) throw new Error(errD.message || 'Не удалось удалить пользователя');
      setOk('Сотрудник удалён');
      setDeleteVisible(false);
      setTimeout(() => router.back(), 300);
    } catch (e) {
      setErr(e?.message || 'Ошибка');
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

  if (loading) {
    return (
      <Screen background="background" edges={['top','left','right']}>
        <ActivityIndicator size="large" />
        {/* Toast */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 140,
            opacity: toastAnim,
            transform: [
              { translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          }}
        >
          {!!ok && (
            <View style={styles.toast}>
              <AntDesign name="checkcircle" size={18} color="#1E9E4A" />
              <Text style={styles.toastText}>{ok}</Text>
            </View>
          )}
        </Animated.View>
      </Screen>
    );
  }
  if (!meIsAdmin) {
    return (
      <Screen background="background" edges={['top','left','right']}>
        <View style={{ padding: 16, justifyContent: 'center', alignItems: 'center', flex: 1 }}>
        <Text style={{ fontSize: 16, color: theme.colors.textSecondary }}>Доступ только для администратора</Text>
        {/* Toast */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 140,
            opacity: toastAnim,
            transform: [
              { translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          }}
        >
          {!!ok && (
            <View style={styles.toast}>
              <AntDesign name="checkcircle" size={18} color="#1E9E4A" />
              <Text style={styles.toastText}>{ok}</Text>
            </View>
          )}
        </Animated.View>
        </View>
      </Screen>
    );
  }

  const isSelfAdmin = meIsAdmin && meId === userId;
  const initials =
    `${(firstName || '').trim().slice(0, 1)}${(lastName || '').trim().slice(0, 1)}`.toUpperCase();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <Screen background="background" edges={['top','left','right']}>
        <View style={styles.container}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[styles.scroll, { paddingBottom: 120 }]}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode={Platform.OS === 'ios' ? 'on-drag' : 'none'}
            contentInsetAdjustmentBehavior="automatic"
          >
            {/* Top AppBar with back arrow */}
            <View style={styles.appBar}>
              <Pressable onPress={() => router.back()} hitSlop={12} style={styles.appBarBack}>
                <AntDesign name="arrowleft" size={22} color={theme.colors.text} />
              </Pressable>
              <Text style={styles.appBarTitle}>Редактирование сотрудника</Text>
              <View style={{ width: 22 }} />
            </View>

            {/* Avatar + Status */}
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
                  onPress={() => setAvatarSheet(true)}
                  accessibilityLabel="Изменить фото профиля"
                >
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
                  ) : (
                    <>
                      <Text style={styles.avatarText}>{initials || '•'}</Text>
                      <View style={styles.avatarCamBadge}>
                        <AntDesign name="camera" size={12} color="#fff" />
                      </View>
                    </>
                  )}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nameTitle}>{headerName}</Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: 8,
                      marginTop: 4,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Pressable
                      onPress={isSuspended ? onAskUnsuspend : onAskSuspend}
                      style={[styles.badge, isSuspended ? styles.badgeRed : styles.badgeGreen]}
                    >
                      <Text style={[styles.badgeText, { color: '#fff' }]}>
                        {isSuspended ? 'Отстранён' : 'Активен'}
                      </Text>
                    </Pressable>
                    {role === 'admin' ? (
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
                          {ROLE_LABELS.admin}
                        </Text>
                      </View>
                    ) : (
                      !isSelfAdmin && (
                        <Pressable
                          onPress={() => setShowRoles(true)}
                          style={[
                            styles.rolePillHeader,
                            {
                              borderColor: withAlpha(roleColor(role), 0.2),
                              backgroundColor: withAlpha(roleColor(role), 0.13),
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Изменить роль"
                        >
                          <Text style={[styles.rolePillHeaderText, { color: roleColor(role) }]}>
                            {ROLE_LABELS[role] || role}
                          </Text>
                        </Pressable>
                      )
                    )}
                  </View>
                </View>
              </View>
            </View>

            {err ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>Ошибка</Text>
                <Text style={styles.errorText}>{err}</Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.section}>Личные данные</Text>

              <Text style={styles.label}>Имя *</Text>
              <TextField placeholder="Имя" placeholderTextColor={theme.colors.textSecondary}
                style={[
                  styles.input,
                  focusFirst && styles.inputFocused,
                  !firstName.trim() && styles.inputError,
                ]}
                value={firstName}
                onChangeText={setFirstName}
                onFocus={() => setFocusFirst(true)}
                onBlur={() => setFocusFirst(false)}
              />
              {!firstName.trim() ? <Text style={styles.helperError}>Укажите имя</Text> : null}

              <Text style={styles.label}>Фамилия *</Text>
              <TextField placeholder="Фамилия" placeholderTextColor={theme.colors.textSecondary}
                style={[
                  styles.input,
                  focusLast && styles.inputFocused,
                  !lastName.trim() && styles.inputError,
                ]}
                value={lastName}
                onChangeText={setLastName}
                onFocus={() => setFocusLast(true)}
                onBlur={() => setFocusLast(false)}
              />
              {!lastName.trim() ? <Text style={styles.helperError}>Укажите фамилию</Text> : null}

              <Text style={styles.label}>E‑mail *</Text>
              <TextField placeholder="you@example.com" placeholderTextColor={theme.colors.textSecondary}
                style={[
                  styles.input,
                  focusEmail && styles.inputFocused,
                  !emailValid && styles.inputError,
                ]}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocusEmail(true)}
                onBlur={() => setFocusEmail(false)}
              />
              {!emailValid ? (
                <Text style={styles.helperError}>Укажите корректный имейл</Text>
              ) : null}

              <Text style={styles.label}>Телефон *</Text>
              <MaskedTextInput
                style={[
                  styles.input,
                  focusPhone && styles.inputFocused,
                  !phoneValid && styles.inputError,
                ]}
                mask="+7 (999) 999-99-99"
                keyboardType="phone-pad"
                placeholder="+7 (___) ___-__-__"
                value={phone}
                editable={true}
                onChangeText={(text, rawText) => setPhone(rawText)}
                onFocus={() => setFocusPhone(true)}
                onBlur={() => setFocusPhone(false)}
              />
              
              {!phoneValid ? (
                <Text style={styles.helperError}>Укажите корректный номер</Text>
              ) : null}

              <Text style={styles.label}>Отдел</Text>
              <Pressable style={{ marginHorizontal: 16, marginBottom: 10 }} onPress={() => setDeptModalVisible(true)}>
                <Text style={styles.selectInputText}>{activeDeptName || 'Выберите отдел'}</Text>
                <AntDesign name="down" size={16} color="#666" />
              </Pressable>

              <Text style={styles.label}>Дата рождения</Text>
              <View style={styles.dateRow}>
                <Pressable style={[styles.selectInput, { flex: 1 }]} onPress={openPicker}>
                  <Text style={styles.selectInputText}>
                    {birthdate
                      ? withYear
                        ? birthdate.toLocaleDateString('ru-RU', {
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric',
                          })
                        : birthdate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
                      : 'Выберите дату'}
                  </Text>
                  <AntDesign name="calendar" size={16} color="#666" />
                </Pressable>
                {birthdate ? (
                  <Pressable
                    onPress={() => setBirthdate(null)}
                    style={styles.dateClearBtn}
                    accessibilityLabel="Удалить дату"
                  >
                    <AntDesign name="minuscircle" size={22} color={theme.colors.danger} />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {!isSelfAdmin && (
              <View style={styles.card}>
                <View style={{ flexDirection: 'row' }}>
                  <Pressable
                    onPress={onAskDelete}
                    style={({ pressed }) => [
                      styles.appButton,
                      styles.btnDestructive,
                      { flex: 1 },
                      pressed && { transform: [{ scale: 0.98 }] },
                    ]}
                  >
                    <Text style={[styles.appButtonText, styles.btnDestructiveText]}>Удалить</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.section}>Пароль</Text>
              <Text style={styles.label}>Новый пароль (мин. 6 символов)</Text>

              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={{ flex: 1, position: 'relative' }}>
                  <TextField
                    style={[
                      styles.input,
                      styles.inputWithIcon,
                      focusPwd && styles.inputFocused,
                      newPassword.length > 0 && !passwordValid && styles.inputError,
                    ]}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onFocus={() => setFocusPwd(true)}
                    onBlur={() => setFocusPwd(false)}
                  />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    style={styles.inputIcon}
                    accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    <AntDesign name={showPassword ? 'eye' : 'eyeo'} size={20} color="#8E8E93" />
                  </Pressable>
                </View>

                <Pressable
                  onPress={async () => {
                    await Clipboard.setStringAsync(newPassword || '');
                    showWarning('Пароль скопирован');
                    setTimeout(() => setWarningVisible(false), 1000);
                  }}
                  disabled={!newPassword}
                  style={({ pressed }) => [
                    styles.copyBtn,
                    !newPassword && { opacity: 0.5 },
                    pressed && { transform: [{ scale: 0.96 }] },
                  ]}
                >
                  <Text style={styles.copyBtnText}>Скопировать</Text>
                </Pressable>
              </View>

              {newPassword.length > 0 && !passwordValid && (
                <Text style={{ marginTop: 6, color: '#D70015', fontSize: 12 }}>
                  Минимум 6 символов
                </Text>
              )}
            </View>

            {/* old inline buttons removed in favor of sticky action bar */}
          </ScrollView>

          {/* Sticky bottom action bar */}
          <View style={styles.actionBar}>
            <UIButton variant="secondary" size="md" onPress={handleCancelPress} style={{flex:1}}>'Отменить'</UIButton>
            <UIButton size="md" variant="primary" onPress={handleSave} style={{flex:1}}>saving ? 'Сохранение…' : 'Сохранить'</UIButton>
          </View>
        </View>

        <Modal
          isVisible={cancelVisible}
          onBackdropPress={() => setCancelVisible(false)}
          useNativeDriver
          backdropOpacity={0.3}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Выйти без сохранения?</Text>
            <Text style={styles.modalText}>Все изменения будут потеряны. Вы уверены?</Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setCancelVisible(false)}
                style={[styles.appButton, styles.btnPrimary]}
              >
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>Остаться</Text>
              </Pressable>
              <UIButton variant="destructive" size="md" onPress={confirmCancel}>'Выйти'</UIButton>
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={warningVisible}
          onBackdropPress={() => setWarningVisible(false)}
          useNativeDriver
          backdropOpacity={0.3}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Внимание</Text>
            <Text style={styles.modalText}>{warningMessage}</Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setWarningVisible(false)}
                style={[styles.appButton, styles.btnPrimary]}
              >
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>Ок</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={confirmPwdVisible}
          onBackdropPress={() => setConfirmPwdVisible(false)}
          useNativeDriver
          backdropOpacity={0.3}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Обновить пароль пользователя?</Text>
            <Text style={styles.modalText}>Вы изменяете пароль. Сохранить изменения?</Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setConfirmPwdVisible(false);
                  setPendingSave(false);
                }}
                style={[styles.appButton, styles.btnSecondary]}
              >
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <Pressable
                disabled={pendingSave && saving}
                onPress={() => proceedSave()}
                style={[styles.appButton, styles.btnPrimary]}
              >
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>
                  {saving ? 'Сохраняю…' : 'Сохранить'}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Date picker: wheels */}
        <Modal
          isVisible={showDatePicker}
          onBackdropPress={() => setShowDatePicker(false)}
          useNativeDriver
          animationIn="fadeIn"
          animationOut="fadeOut"
          backdropOpacity={0.35}
          style={styles.centeredModal}
        >
          <View style={styles.picker}>
            <Text style={styles.pickerTitle}>{headerTitle}</Text>
            <View style={{ position: 'relative' }}>
              <View style={styles.wheelsRow}>
                <Wheel
                  data={days.map(String)}
                  activeColor={theme.colors.primary}
                  index={dayIdx}
                  onIndexChange={setDayIdx}
                  width={WHEEL_W}
                />
                <Wheel
                  data={MONTHS_ABBR}
                  activeColor={theme.colors.primary}
                  index={monthIdx}
                  onIndexChange={(i) => {
                    setMonthIdx(i);
                    setDayIdx((d) =>
                      Math.min(d, daysInMonth(i, withYear ? years[yearIdx] : null) - 1),
                    );
                  }}
                  width={WHEEL_W}
                />
                <Wheel
                  data={years.map(String)}
                  activeColor={theme.colors.primary}
                  index={yearIdx}
                  onIndexChange={setYearIdx}
                  width={WHEEL_W}
                  enabled={withYear}
                />
              </View>
              <View pointerEvents="none" style={styles.selectionLines} />
              {/* dim overlays */}
              <View pointerEvents="none" style={styles.dimTop} />
              <View pointerEvents="none" style={styles.dimBottom} />
            </View>
            <View style={styles.yearSwitchRow}>
              <Text style={styles.yearSwitchLabel}>Указать год</Text>
              <Switch value={withYear} onValueChange={setWithYear} />
            </View>
            <View style={styles.pickerActions}>
              <Pressable
                onPress={() => setShowDatePicker(false)}
                style={[styles.appButton, styles.btnSecondary, styles.actionBtn]}
              >
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <UIButton variant="primary" size="md" onPress={applyPicker}>'ОК'</UIButton>
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={suspendVisible}
          onBackdropPress={() => setSuspendVisible(false)}
          useNativeDriver
          animationIn="zoomIn"
          animationOut="zoomOut"
          backdropOpacity={0.25}
          style={styles.centeredModal}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Отстранить сотрудника?</Text>
            <Text style={styles.modalText}>Выберите, что сделать с его заявками.</Text>
            <View style={styles.radioRow}>
              <Pressable
                onPress={() => {
                  setOrdersAction('keep');
                  setSuccessorError('');
                }}
                style={({ pressed }) => [styles.radio, pressed && { opacity: 0.8 }]}
              >
                <View
                  style={[styles.radioOuter, ordersAction === 'keep' && styles.radioOuterActive]}
                >
                  <View
                    style={[styles.radioInner, ordersAction === 'keep' && styles.radioInnerActive]}
                  />
                </View>
                <Text style={styles.radioLabel}>Оставить как есть</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setOrdersAction('reassign');
                }}
                style={({ pressed }) => [styles.radio, pressed && { opacity: 0.8 }]}
              >
                <View
                  style={[
                    styles.radioOuter,
                    ordersAction === 'reassign' && styles.radioOuterActive,
                  ]}
                >
                  <View
                    style={[
                      styles.radioInner,
                      ordersAction === 'reassign' && styles.radioInnerActive,
                    ]}
                  />
                </View>
                <Text style={styles.radioLabel}>Переназначить на сотрудника</Text>
              </Pressable>
            </View>
            {ordersAction === 'reassign' && (
              <View>
                <Text style={[styles.label, { marginTop: 8 }]}>Правопреемник</Text>
                <Pressable
                  onPress={openSuccessorPickerFromSuspend}
                  style={[styles.selectInput, successorError && { borderColor: '#FF453A' }]}
                >
                  <Text style={styles.selectInputText}>
                    {successor?.name || 'Выберите сотрудника'}
                  </Text>
                  <AntDesign name="search1" size={16} color="#666" />
                </Pressable>
                {!!successorError && <Text style={styles.helperError}>{successorError}</Text>}
              </View>
            )}
            <View style={[styles.modalActions, { marginTop: 16 }]}>
              <Pressable
                onPress={() => setSuspendVisible(false)}
                style={[styles.appButton, styles.btnSecondary]}
              >
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <UIButton variant="primary" size="md" onPress={onConfirmSuspend}>"{saving ? 'Применяю…' : 'Отстранить'}"</UIButton>
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={unsuspendVisible}
          onBackdropPress={() => setUnsuspendVisible(false)}
          useNativeDriver
          animationIn="zoomIn"
          animationOut="zoomOut"
          backdropOpacity={0.25}
          style={styles.centeredModal}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Снять отстранение?</Text>
            <Text style={styles.modalText}>Сотрудник снова сможет пользоваться приложением.</Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setUnsuspendVisible(false)}
                style={[styles.appButton, styles.btnSecondary]}
              >
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <UIButton variant="primary" size="md" onPress={onConfirmUnsuspend}>"{saving ? 'Применяю…' : 'Подтверждаю'}"</UIButton>
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={deleteVisible}
          onBackdropPress={() => setDeleteVisible(false)}
          useNativeDriver
          animationIn="zoomIn"
          animationOut="zoomOut"
          backdropOpacity={0.25}
          style={styles.centeredModal}
        >
          <View style={styles.modalContainer}>
            <Text style={[styles.modalTitle, { color: theme.colors.danger }]}>Удалить сотрудника?</Text>
            <Text style={styles.modalText}>
              Необходимо выбрать правопреемника, чтобы переназначить все его заявки.
            </Text>
            <Text style={[styles.label, { marginTop: 8 }]}>Правопреемник *</Text>
            <Pressable
              onPress={openSuccessorPickerFromDelete}
              style={[styles.selectInput, successorError && { borderColor: '#FF453A' }]}
            >
              <Text style={styles.selectInputText}>{successor?.name || 'Выберите сотрудника'}</Text>
              <AntDesign name="search1" size={16} color="#666" />
            </Pressable>
            {!!successorError && <Text style={styles.helperError}>{successorError}</Text>}
            <View style={[styles.modalActions, { marginTop: 16 }]}>
              <Pressable
                onPress={() => setDeleteVisible(false)}
                style={[styles.appButton, styles.btnSecondary]}
              >
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <UIButton variant="primary" size="md" onPress={onConfirmDelete}>"{saving ? 'Удаляю…' : 'Удалить'}"</UIButton>
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={pickerVisible}
          useNativeDriver={false}
          onBackdropPress={() => {
            setPickerVisible(false);
            if (pickerReturn === 'delete') setDeleteVisible(true);
            if (pickerReturn === 'suspend') setSuspendVisible(true);
            setPickerReturn(null);
          }}
          animationIn="slideInUp"
          animationOut="slideOutDown"
          backdropOpacity={0.4}
          style={{ justifyContent: 'flex-end', margin: 0 }}
        >
          <View
            style={[
              styles.modalContainerFull,
              { paddingBottom: 8, width: '100%', maxHeight: '80%' },
            ]}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 48,
                height: 5,
                borderRadius: 3,
                backgroundColor: theme.colors.border,
                marginBottom: 10,
              }}
            />
            <Text style={styles.modalTitle}>Выбор сотрудника</Text>
            <TextField
              value={pickerQuery}
              onChangeText={setPickerQuery}
              placeholder="Поиск по имени"
              style={[styles.input, { marginBottom: 10 }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {pickerLoading ? (
              <ActivityIndicator style={{ marginVertical: 8 }} />
            ) : (
              <FlatList
                data={pickerItems}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 520 }}
                keyboardShouldPersistTaps="handled"
                ItemSeparatorComponent={() => (
                  <View style={{ height: 1, backgroundColor: theme.colors.border }} />
                )}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      setSuccessor({ id: item.id, name: item.name, role: item.role });
                      setSuccessorError('');
                      setPickerVisible(false);
                      if (pickerReturn === 'delete') setDeleteVisible(true);
                      if (pickerReturn === 'suspend') setSuspendVisible(true);
                      setPickerReturn(null);
                    }}
                    style={({ pressed }) => [
                      styles.assigneeOption,
                      pressed && { backgroundColor: '#f5f5f5' },
                    ]}
                  >
                    <Text style={styles.assigneeText}>{item.name}</Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                      {ROLE_LABELS[item.role] || item.role}
                    </Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={{ textAlign: 'center', color: theme.colors.textSecondary, paddingVertical: 16 }}>
                    Ничего не найдено
                  </Text>
                }
              />
            )}
            <View style={[styles.modalActions, { marginTop: 10 }]}>
              <Pressable
                onPress={() => {
                  setPickerVisible(false);
                  if (pickerReturn === 'delete') setDeleteVisible(true);
                  if (pickerReturn === 'suspend') setSuspendVisible(true);
                  setPickerReturn(null);
                }}
                style={[styles.appButton, styles.btnSecondary, { flex: 1 }]}
              >
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Закрыть</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={avatarSheet}
          onBackdropPress={() => setAvatarSheet(false)}
          useNativeDriver
          backdropOpacity={0.3}
          style={styles.centeredModal}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Фото профиля</Text>
            <View style={{ gap: 10 }}>
              <Pressable
                onPress={() => {
                  setAvatarSheet(false);
                  pickFromCamera();
                }}
                style={[styles.appButton, styles.btnPrimary]}
              >
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>Сделать фото</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setAvatarSheet(false);
                  pickFromLibrary();
                }}
                style={[styles.appButton, styles.btnSecondary]}
              >
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>
                  Выбрать из галереи
                </Text>
              </Pressable>
              {!!avatarUrl && (
                <Pressable
                  onPress={() => {
                    setAvatarSheet(false);
                    deleteAvatar();
                  }}
                  style={[styles.appButton, styles.btnDestructive]}
                >
                  <Text style={[styles.appButtonText, styles.btnDestructiveText]}>
                    Удалить фото
                  </Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.modalActions, { marginTop: 12 }]}>
              <Pressable
                onPress={() => setAvatarSheet(false)}
                style={[styles.appButton, styles.btnSecondary, { flex: 1 }]}
              >
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Выбор отдела */}
        <Modal
          isVisible={deptModalVisible}
          onBackdropPress={() => setDeptModalVisible(false)}
          useNativeDriver
          backdropOpacity={0.3}
          style={styles.centeredModal}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Выбор отдела</Text>
            <View style={{ gap: 10, maxHeight: 320 }}>
              <Pressable
                onPress={() => { setDepartmentId(null); setDeptModalVisible(false); }}
                style={({ pressed }) => [styles.roleItem, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.roleTitle}>Без отдела</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 280 }}>
              {(departments || []).map((d) => (
                <Pressable
                  key={String(d.id)}
                  onPress={() => { setDepartmentId(d.id); setDeptModalVisible(false); }}
                  style={({ pressed }) => [
                    styles.roleItem,
                    String(departmentId) === String(d.id) && styles.roleItemSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleTitle}>{d.name}</Text>
                  </View>
                  <AntDesign
                    name={String(departmentId) === String(d.id) ? 'checkcircle' : 'checkcircleo'}
                    size={20}
                    color={String(departmentId) === String(d.id) ? theme.colors.primary : '#C7C7CC'}
                  />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Modal>

        {/* Роль — красивый выбор в модалке */}
        <Modal
          isVisible={showRoles}
          onBackdropPress={() => setShowRoles(false)}
          useNativeDriver
          backdropOpacity={0.3}
          style={styles.centeredModal}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Выбор роли</Text>
            <View style={{ gap: 10 }}>
              {ROLES.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => {
                    setRole(r);
                    setShowRoles(false);
                  }}
                  style={({ pressed }) => [
                    styles.roleItem,
                    role === r && styles.roleItemSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleTitle}>{ROLE_LABELS[r]}</Text>
                    <Text style={styles.roleDesc}>{ROLE_DESCRIPTIONS[r]}</Text>
                  </View>
                  <AntDesign
                    name={role === r ? 'checkcircle' : 'checkcircleo'}
                    size={20}
                    color={role === r ? theme.colors.primary : '#C7C7CC'}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        </Modal>

        {/* Toast */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 140,
            opacity: toastAnim,
            transform: [
              { translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          }}
        >
          {!!ok && (
            <View style={styles.toast}>
              <AntDesign name="checkcircle" size={18} color="#1E9E4A" />
              <Text style={styles.toastText}>{ok}</Text>
            </View>
          )}
        </Animated.View>
      </Screen>
    </KeyboardAvoidingView>
  );
}