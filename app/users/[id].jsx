import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { ActivityIndicator, Animated, BackHandler, Dimensions, Easing, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Modal from 'react-native-modal';
import { MaskedTextInput } from 'react-native-mask-text';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { AntDesign } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { supabase } from '../../lib/supabase';

const PRIMARY = '#007AFF';
const SECONDARY_BG = '#d1d1d6';
const DESTRUCTIVE = '#FF3B30';
const TEXT_PRIMARY = '#111';
const TEXT_SECONDARY = '#333';
const BORDER = '#ccc';

// Colors aligned with users/index list screen
const COLORS = {
  admin: '#007AFF',
  dispatcher: '#34C759',
  worker: '#5856D6',
};
const roleColor = (r) => COLORS[r] || '#8E8E93';

const ITEM_HEIGHT = 44;
const VISIBLE_COUNT = 5;
const SCREEN_W = Dimensions.get('window').width;
const DIALOG_W = Math.min(SCREEN_W * 0.85, 360);
const WHEEL_W = (DIALOG_W - 32) / 3;

const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_ABBR = ['янв.','февр.','март','апр.','май','июн.','июл.','авг.','сент.','окт.','нояб.','дек.'];

function daysInMonth(monthIdx, yearNullable) {
  if (monthIdx === 1 && yearNullable == null) return 29;
  const y = yearNullable ?? 2024;
  return new Date(y, monthIdx + 1, 0).getDate();
}
function range(a, b) { const arr=[]; for (let i=a;i<=b;i++) arr.push(i); return arr; }

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

function Wheel({ data, index, onIndexChange, width, enabled=true }) {
  const listRef = useRef(null);
  const isSyncingRef = useRef(false);
  const [selIndex, setSelIndex] = useState(index ?? 0);

  useEffect(() => {
    const next = Math.max(0, Math.min(data.length - 1, index ?? 0));
    if (next !== selIndex) {
      setSelIndex(next);
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: next * ITEM_HEIGHT, animated: false });
      setTimeout(() => { isSyncingRef.current = false; }, 0);
    }
  }, [index, data.length]);

  useEffect(() => {
    if (selIndex > data.length - 1) {
      const next = data.length - 1;
      setSelIndex(next);
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: next * ITEM_HEIGHT, animated: false });
      setTimeout(() => { isSyncingRef.current = false; }, 0);
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
      setTimeout(() => { isSyncingRef.current = false; }, 0);
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
        <View style={[wheelStyles.item, !enabled && {opacity:0.35}]}>
          <Text style={[wheelStyles.itemText, i===selIndex && wheelStyles.itemTextActive]}>{item}</Text>
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
      contentContainerStyle={{ paddingVertical: (ITEM_HEIGHT * (VISIBLE_COUNT-1))/2 }}
      scrollEnabled={enabled}
      initialScrollIndex={Math.max(0, Math.min(data.length - 1, selIndex))}
      onScrollToIndexFailed={(info) => {
        const offset = Math.min(info.highestMeasuredFrameIndex * ITEM_HEIGHT, info.averageItemLength * info.index);
        listRef.current?.scrollToOffset({ offset, animated: false });
        setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.5 }), 0);
      }}
    />
  );
}
const wheelStyles = StyleSheet.create({
  item: { height: ITEM_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  itemText: { fontSize: 18, color: '#C7C7CC' },
  itemTextActive: { fontSize: 20, color: PRIMARY, fontWeight: '700' },
});

const ROLES = ['dispatcher', 'worker'];
const ROLE_LABELS = { dispatcher: 'Диспетчер', worker: 'Рабочий', admin: 'Администратор' };
const ROLE_DESCRIPTIONS = {
  dispatcher: 'Назначение и управление заявками.',
  worker: 'Выполнение заявок, без админ‑прав.',
};

export default function EditUser() {
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
    [monthIdx, yearIdx, withYear, years]
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
      const { error: upErr } = await supabase
        .storage
        .from('avatars')
        .upload(path, fileData, { contentType: 'image/jpeg', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = pub?.publicUrl || null;
      const { error: updErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
      if (updErr) throw updErr;
      setAvatarUrl(publicUrl);
      setOk('Фото профиля обновлено');
    } catch (e) {
      setErr(e?.message || 'Не удалось загрузить фото');
    }
  };

  const deleteAvatar = async () => {
    try {
      setErr(''); setOk('');
      // попытка удалить все файлы в папке пользователя
      const prefix = `profiles/${userId}`;
      const { data: list, error: listErr } = await supabase.storage.from('avatars').list(prefix);
      if (!listErr && Array.isArray(list) && list.length) {
        const paths = list.map(f => `${prefix}/${f.name}`);
        await supabase.storage.from('avatars').remove(paths);
      }
      // очистить ссылку в профиле
      const { error: updErr } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
      if (updErr) throw updErr;
      setAvatarUrl(null);
      setOk('Фото удалено');
    } catch (e) {
      setErr(e?.message || 'Не удалось удалить фото');
    }
  };

  const pickFromCamera = async () => {
    const okCam = await ensureCameraPerms();
    if (!okCam) { setErr('Нет доступа к камере'); return; }
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
    if (!okLib) { setErr('Нет доступа к галерее'); return; }
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
      Animated.timing(toastAnim, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(3200),
      Animated.timing(toastAnim, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
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
      phone: String(phone).replace(/\D/g,'') || '',
      birthdate: birthdate ? birthdate.toISOString().slice(0,10) : null,
      role,
      newPassword: newPassword || null,
      isSuspended,
    });
    return current !== initialSnap;
  }, [firstName, lastName, email, phone, birthdate, role, newPassword, isSuspended, initialSnap]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (allowLeaveRef.current) return false;
        if (isDirty) { setCancelVisible(true); return true; }
        return false;
      });
      return () => sub.remove();
    }, [isDirty])
  );


  const allowLeaveRef = useRef(false);

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
  }, [firstName, lastName, email, phone, birthdate, role, newPassword, isSuspended]);

  const passwordValid = useMemo(() => newPassword.length === 0 || newPassword.length >= 6, [newPassword]);
  const emailValid = useMemo(() => isValidEmailStrict(email), [email]);
  const rawPhone = useMemo(() => String(phone || '').replace(/\D/g,''), [phone]);
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
    const { data: me } = await supabase
      .from('profiles').select('id, role').eq('id', uid).single();
    setMeIsAdmin(me?.role === 'admin');
  }, []);

  const formatName = (p) => {
    const n1 = (p.first_name || '').trim();
    const n2 = (p.last_name || '').trim();
    const fn = (p.full_name || '').trim();
    const name = (n1 || n2) ? `${n1} ${n2}`.replace(/\s+/g,' ').trim() : fn || 'Без имени';
    return name;
  };

  const fetchUser = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .rpc('admin_get_profile_with_email', { target_user_id: userId });
    if (error) {
      setErr(error.message || 'Не удалось загрузить пользователя');
      setLoading(false);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setEmail(row?.email || '');
    setRole(row?.user_role || 'worker');
    if (row?.birthdate) {
      const d = new Date(row.birthdate);
      setBirthdate(!isNaN(d.getTime()) ? d : null);
    } else setBirthdate(null);

    const { data: prof } = await supabase
      .from('profiles')
      .select('first_name, last_name, full_name, phone, is_suspended, suspended_at, avatar_url')
      .eq('id', userId)
      .maybeSingle();

    if (prof) {
      if (prof.first_name || prof.last_name) {
        setFirstName(prof.first_name || '');
        setLastName(prof.last_name || '');
      } else if (prof.full_name) {
        const parts = String(prof.full_name).trim().replace(/\s+/g,' ').split(' ');
        setFirstName(parts[0] || '');
        setLastName(parts.slice(1).join(' ') || '');
      }
      setHeaderName(formatName(prof)); // фикс: заголовок не меняется при редактировании
    }

    if (prof && typeof prof.avatar_url !== 'undefined') { setAvatarUrl(prof.avatar_url || null); }

    if (prof && typeof prof.phone !== 'undefined') {
      const raw = String(prof.phone || '').replace(/\D/g,'');
      setPhone(raw);
    }

    setIsSuspended(!!(prof?.is_suspended || prof?.suspended_at));
    setInitialSnap(JSON.stringify({
      firstName: (prof?.first_name || '').trim(),
      lastName: (prof?.last_name || '').trim(),
      email: (row?.email || '').trim(),
      phone: (String(prof?.phone || '').replace(/\D/g,'') || ''),
      birthdate: row?.birthdate ? String(row?.birthdate) : null,
      role: row?.user_role || 'worker',
      newPassword: null,
      isSuspended: !!(prof?.is_suspended || prof?.suspended_at),
    }));

    setLoading(false);
  }, [userId]);

  useEffect(() => { (async () => { await fetchMe(); await fetchUser(); })(); }, [fetchMe, fetchUser]);

  const saveProfileFields = async (rawPhone) => {
    const full_name = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g,' ').trim() || null;
    const bdate = birthdate instanceof Date
      ? `${birthdate.getFullYear()}-${String(birthdate.getMonth()+1).padStart(2,'0')}-${String(birthdate.getDate()).padStart(2,'0')}`
      : null;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/update_user`;
      if (!FN_URL || !FN_URL.startsWith('http')) throw new Error('Неверный адрес edge‑функции');

      const payload = {
        user_id: userId,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        full_name,
        birthdate: bdate,
        phone: rawPhone ? `+7${rawPhone.slice(1)}` : null
      };

      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

      const raw = await res.text(); let resp = null; try { resp = raw ? JSON.parse(raw) : null; } catch {}
      if (!res.ok) throw new Error(resp?.message || `HTTP ${res.status} ${res.statusText}`);
      if (resp && resp.ok === false) throw new Error(resp?.message || 'Сервер не подтвердил обновление профиля');
      return null;
    } catch (e) {
      return { message: e?.message || 'Ошибка при обновлении профиля' };
    }
  };

  const proceedSave = async (rawPhoneParam) => {
    setErr(''); setOk(''); setSaving(true);
    try {
      const rawPhoneToUse = rawPhoneParam || rawPhone;
      const err1 = await saveProfileFields(rawPhoneToUse);
      if (err1) { setErr(err1.message || 'Ошибка при сохранении профиля'); setSaving(false); return; }

      const payload = { user_id: userId, role, email: email.trim() || null };
      if (newPassword.length >= 6) payload.new_password = newPassword;

      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/update_user`;
      if (!FN_URL || !FN_URL.startsWith('http')) throw new Error('Неверный адрес edge‑функции');

      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

      const raw = await res.text(); let resp = null; try { resp = raw ? JSON.parse(raw) : null; } catch {}
      if (!res.ok) throw new Error(resp?.message || `HTTP ${res.status} ${res.statusText}`);
      if (resp && resp.ok === false) throw new Error(resp?.message || 'Сервер не подтвердил обновление доступа');

      setOk('Сохранено');
      setNewPassword('');
      // Обновляем снапшот и заголовок, и разрешаем выход без предупреждения
      const newFull = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g,' ').trim() || 'Без имени';
      setHeaderName(newFull);
      setInitialSnap(JSON.stringify({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: String(phone).replace(/\D/g,'') || '',
        birthdate: birthdate ? birthdate.toISOString().slice(0,10) : null,
        role,
        isSuspended,
        newPassword: null,
      }));
      allowLeaveRef.current = true;
    } catch (e) {
      setErr(e?.message || 'Ошибка сети');
    } finally {
      setSaving(false);
      setConfirmPwdVisible(false);
      setPendingSave(false);
    }
  };

  const handleSave = async () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (!firstName.trim() || !lastName.trim()) return showWarning('Имя и фамилия обязательны');
    if (!passwordValid) return showWarning('Пароль: минимум 6 символов');
    if (!emailValid) return showWarning('Укажите корректный имейл');
    if (!phoneValid) return showWarning('Укажите корректный номер');
    if (newPassword && newPassword.length >= 6) { setConfirmPwdVisible(true); setPendingSave(true); return; }
    await proceedSave(rawPhone);
  };

  const showWarning = (msg) => { setWarningMessage(msg); setWarningVisible(true); };
  const handleCancelPress = () => { if (isDirty) setCancelVisible(true); else router.back(); };
  const confirmCancel = () => {
    allowLeaveRef.current = true;
    setCancelVisible(false);
    router.back();
  };

  const loadCandidates = useCallback(async (q='') => {
    setPickerLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('id, first_name, last_name, full_name, role')
        .neq('id', userId);
      if (q && q.trim().length) {
        const s = q.trim();
        query = query.or(`full_name.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%`);
      }
      const { data: rows, error } = await query.limit(50);
      if (error) throw error;
      const items = (rows || []).map(r => ({
        id: r.id,
        name: formatName(r),
        role: r.role,
      }));
      setPickerItems(items);
    } catch (e) {
      setPickerItems([]);
    } finally {
      setPickerLoading(false);
    }
  }, [userId]);

  useEffect(() => { if (pickerVisible) loadCandidates(pickerQuery); }, [pickerVisible, pickerQuery, loadCandidates]);

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
            headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
            body: JSON.stringify({ user_id: uid, is_suspended: !!value, suspended_at: value ? new Date().toISOString() : null }),
          });
        } catch {}
      }
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ is_suspended: !!value, suspended_at: value ? new Date().toISOString() : null })
        .eq('id', uid);
      return updErr ?? null;
    } catch (e) {
      const { error } = await supabase.from('profiles').update({ is_suspended: !!value, suspended_at: value ? new Date().toISOString() : null }).eq('id', uid);
      return error ?? e;
    }
  };

  const deleteUserEverywhere = async (uid) => {
    const tryPaths = [
      '/admin_delete_user',
      '/delete_user',
      '/admin-delete-user',
      '/user_delete',
      '/remove_user'
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
          headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
          body: JSON.stringify({ user_id: uid }),
        });
        if (res.ok) return null;
        let payload = null;
        try { payload = await res.json(); } catch {}
        if (payload && (payload.ok === true || payload.success === true)) return null;
      }
    } catch {}
    const { error } = await supabase.from('profiles').delete().eq('id', uid);
    return error;
  };

  const onAskSuspend = () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return; // не для себя
    setOrdersAction('keep'); setSuccessor(null); setSuccessorError(''); setSuspendVisible(true);
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
      setSaving(true); setErr(''); setOk('');
      if (ordersAction === 'reassign') {
        if (!successor?.id) { setSuccessorError('Выберите правопреемника'); setSaving(false); return; }
        const errR = await reassignOrders(userId, successor.id);
        if (errR) throw new Error(errR.message || 'Не удалось переназначить заявки');
      }
      const errS = await setSuspended(userId, true);
      if (errS) throw new Error(errS.message || 'Не удалось отстранить пользователя');
      setIsSuspended(true); setOk('Сотрудник отстранён'); setSuspendVisible(false);
    } catch (e) { setErr(e?.message || 'Ошибка'); }
    finally { setSaving(false); }
  };
  const onConfirmUnsuspend = async () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return;
    try {
      setSaving(true); setErr(''); setOk('');
      const errS = await setSuspended(userId, false);
      if (errS) throw new Error(errS.message || 'Не удалось снять отстранение');
      setIsSuspended(false); setOk('Отстранение снято'); setUnsuspendVisible(false);
    } catch (e) { setErr(e?.message || 'Ошибка'); }
    finally { setSaving(false); }
  };
  const onAskDelete = () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return;
    setSuccessor(null); setSuccessorError(''); setDeleteVisible(true);
  };
  const onConfirmDelete = async () => {
    if (!meIsAdmin) return showWarning('Нет доступа');
    if (meId && userId === meId) return;
    if (!successor?.id) { setSuccessorError('Укажите правопреемника'); return; }
    try {
      setSaving(true); setErr(''); setOk('');
      const errR = await reassignOrders(userId, successor.id);
      if (errR) throw new Error(errR.message || 'Не удалось переназначить заявки');
      const errD = await deleteUserEverywhere(userId);
      if (errD) throw new Error(errD.message || 'Не удалось удалить пользователя');
      setOk('Сотрудник удалён'); setDeleteVisible(false); setTimeout(() => router.back(), 300);
    } catch (e) { setErr(e?.message || 'Ошибка'); }
    finally { setSaving(false); }
  };

  const openSuccessorPickerFromDelete = () => { setPickerReturn('delete'); setDeleteVisible(false); setPickerVisible(true); };
  const openSuccessorPickerFromSuspend = () => { setPickerReturn('suspend'); setSuspendVisible(false); setPickerVisible(true); };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
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
            transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          }}
        >
          {!!ok && (
            <View style={styles.toast}>
              <AntDesign name="checkcircle" size={18} color="#1E9E4A" />
              <Text style={styles.toastText}>{ok}</Text>
            </View>
          )}
        </Animated.View>
      </SafeAreaView>
    );
  }
  if (!meIsAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 16, color: '#8E8E93' }}>Доступ только для администратора</Text>
        {/* Toast */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 140,
            opacity: toastAnim,
            transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          }}
        >
          {!!ok && (
            <View style={styles.toast}>
              <AntDesign name="checkcircle" size={18} color="#1E9E4A" />
              <Text style={styles.toastText}>{ok}</Text>
            </View>
          )}
        </Animated.View>
      </SafeAreaView>
    );
  }

  const isSelfAdmin = meIsAdmin && meId === userId;
  const initials = `${(firstName||'').trim().slice(0,1)}${(lastName||'').trim().slice(0,1)}`.toUpperCase();

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
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
                <AntDesign name="arrowleft" size={22} color={TEXT_PRIMARY} />
              </Pressable>
              <Text style={styles.appBarTitle}>Редактирование сотрудника</Text>
              <View style={{width:22}} />
            </View>

            {/* Avatar + Status */}
            <View style={[styles.card, styles.headerCard, isSuspended ? styles.headerCardSuspended : null]}>
              <View style={styles.headerRow}>
              <Pressable style={styles.avatar} onPress={() => setAvatarSheet(true)} accessibilityLabel='Изменить фото профиля'>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
                ) : (
                  <>
                    <Text style={styles.avatarText}>{initials || '•'}</Text>
                    <View style={styles.avatarCamBadge}>
                      <AntDesign name='camera' size={12} color='#fff' />
                    </View>
                  </>
                )}
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.nameTitle}>{headerName}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'center', flexWrap:'wrap' }}>
                  <Pressable onPress={isSuspended ? onAskUnsuspend : onAskSuspend} style={[styles.badge, isSuspended ? styles.badgeRed : styles.badgeGreen]}>
                    <Text style={[styles.badgeText, { color: '#fff' }]}>{isSuspended ? 'Отстранён' : 'Активен'}</Text>
                  </Pressable>
                  {role === 'admin' ? (
                    <View style={[styles.rolePillHeader, { borderColor: roleColor('admin')+"33", backgroundColor: roleColor('admin')+"22" }]}>
                      <Text style={[styles.rolePillHeaderText, { color: roleColor('admin') }]}>{ROLE_LABELS.admin}</Text>
                    </View>
                  ) : (
                    !isSelfAdmin && (
                      <Pressable onPress={() => setShowRoles(true)} style={[styles.rolePillHeader, { borderColor: roleColor(role)+"33", backgroundColor: roleColor(role)+"22" }]} accessibilityRole="button" accessibilityLabel="Изменить роль">
                        <Text style={[styles.rolePillHeaderText, { color: roleColor(role) }]}>{ROLE_LABELS[role] || role}</Text>
                      </Pressable>
                    )
                  )}
                </View>
              </View>
              </View>
            </View>

            {err ? (<View style={styles.errorCard}><Text style={styles.errorTitle}>Ошибка</Text><Text style={styles.errorText}>{err}</Text></View>) : null}
            

            <View style={styles.card}>
              <Text style={styles.section}>Личные данные</Text>

              <Text style={styles.label}>Имя *</Text>
              <TextInput
                style={[styles.input, focusFirst && styles.inputFocused, !firstName.trim() && styles.inputError]}
                value={firstName}
                onChangeText={setFirstName}
                onFocus={()=>setFocusFirst(true)}
                onBlur={()=>setFocusFirst(false)}
              />
              {!firstName.trim() ? (<Text style={styles.helperError}>Укажите имя</Text>) : null}

              <Text style={styles.label}>Фамилия *</Text>
              <TextInput
                style={[styles.input, focusLast && styles.inputFocused, !lastName.trim() && styles.inputError]}
                value={lastName}
                onChangeText={setLastName}
                onFocus={()=>setFocusLast(true)}
                onBlur={()=>setFocusLast(false)}
              />
              {!lastName.trim() ? (<Text style={styles.helperError}>Укажите фамилию</Text>) : null}

              <Text style={styles.label}>E‑mail *</Text>
              <TextInput
                style={[styles.input, focusEmail && styles.inputFocused, !emailValid && styles.inputError]}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                onFocus={()=>setFocusEmail(true)}
                onBlur={()=>setFocusEmail(false)}
              />
              {!emailValid ? (<Text style={styles.helperError}>Укажите корректный имейл</Text>) : null}

              <Text style={styles.label}>Телефон *</Text>
              <MaskedTextInput
                style={[styles.input, focusPhone && styles.inputFocused, !phoneValid && styles.inputError]}
                mask="+7 (999) 999-99-99"
                keyboardType="phone-pad"
                placeholder="+7 (___) ___-__-__"
                value={phone}
                editable={true}
                onChangeText={(text, rawText) => setPhone(rawText)}
                onFocus={()=>setFocusPhone(true)}
                onBlur={()=>setFocusPhone(false)}
              />
              {!phoneValid ? (<Text style={styles.helperError}>Укажите корректный номер</Text>) : null}

              <Text style={styles.label}>Дата рождения</Text>
              <View style={styles.dateRow}>
                <Pressable style={[styles.selectInput, { flex: 1 }]} onPress={openPicker}>
                  <Text style={styles.selectInputText}>
                    {birthdate
                      ? (withYear
                          ? birthdate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
                          : birthdate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }))
                      : 'Выберите дату'}
                  </Text>
                  <AntDesign name="calendar" size={16} color="#666" />
                </Pressable>
                {birthdate ? (
                  <Pressable onPress={() => setBirthdate(null)} style={styles.dateClearBtn} accessibilityLabel="Удалить дату">
                    <AntDesign name="minuscircle" size={22} color={DESTRUCTIVE} />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {!isSelfAdmin && (<View style={styles.card}>
                  
                  <View style={{ flexDirection: 'row' }}>
                    <Pressable onPress={onAskDelete} style={({ pressed }) => [styles.appButton, styles.btnDestructive, { flex: 1 }, pressed && { transform: [{ scale: 0.98 }] }]}>
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
                  <TextInput
                    style={[styles.input, styles.inputWithIcon, focusPwd && styles.inputFocused, newPassword.length>0 && !passwordValid && styles.inputError]}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onFocus={()=>setFocusPwd(true)}
                    onBlur={()=>setFocusPwd(false)}
                  />
                  <Pressable onPress={() => setShowPassword(v => !v)} style={styles.inputIcon} accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>
                    <AntDesign name={showPassword ? 'eye' : 'eyeo'} size={20} color="#8E8E93" />
                  </Pressable>
                </View>

                <Pressable onPress={async () => { await Clipboard.setStringAsync(newPassword || ''); showWarning('Пароль скопирован'); setTimeout(() => setWarningVisible(false), 1000); }} disabled={!newPassword} style={({ pressed }) => [styles.copyBtn, !newPassword && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.96 }] }]}>
                  <Text style={styles.copyBtnText}>Скопировать</Text>
                </Pressable>
              </View>

              {newPassword.length > 0 && !passwordValid && (
                <Text style={{ marginTop: 6, color: '#D70015', fontSize: 12 }}>Минимум 6 символов</Text>
              )}
            </View>

            {/* old inline buttons removed in favor of sticky action bar */}
          </ScrollView>

          {/* Sticky bottom action bar */}
          <View style={styles.actionBar}>
            <Pressable onPress={handleCancelPress} style={({ pressed }) => [styles.appButton, styles.btnSecondary, styles.actionBarBtn, pressed && { transform: [{ scale: 0.98 }] }]}>
              <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отменить</Text>
            </Pressable>
            <Pressable onPress={handleSave} style={({ pressed }) => [styles.appButton, styles.btnPrimary, styles.actionBarBtn, pressed && { transform: [{ scale: 0.98 }] }]}>
              <Text style={[styles.appButtonText, styles.btnPrimaryText]}>{saving ? 'Сохранение…' : 'Сохранить'}</Text>
            </Pressable>
          </View>
        </View>

        <Modal isVisible={cancelVisible} onBackdropPress={() => setCancelVisible(false)} useNativeDriver backdropOpacity={0.3}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Выйти без сохранения?</Text>
            <Text style={styles.modalText}>Все изменения будут потеряны. Вы уверены?</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setCancelVisible(false)} style={[styles.appButton, styles.btnPrimary]}>
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>Остаться</Text>
              </Pressable>
              <Pressable onPress={confirmCancel} style={[styles.appButton, styles.btnDestructive]}>
                <Text style={[styles.appButtonText, styles.btnDestructiveText]}>Выйти</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal isVisible={warningVisible} onBackdropPress={() => setWarningVisible(false)} useNativeDriver backdropOpacity={0.3}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Внимание</Text>
            <Text style={styles.modalText}>{warningMessage}</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setWarningVisible(false)} style={[styles.appButton, styles.btnPrimary]}>
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>Ок</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal isVisible={confirmPwdVisible} onBackdropPress={() => setConfirmPwdVisible(false)} useNativeDriver backdropOpacity={0.3}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Обновить пароль пользователя?</Text>
            <Text style={styles.modalText}>Вы изменяете пароль. Сохранить изменения?</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => { setConfirmPwdVisible(false); setPendingSave(false); }} style={[styles.appButton, styles.btnSecondary]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <Pressable disabled={pendingSave && saving} onPress={() => proceedSave()} style={[styles.appButton, styles.btnPrimary]}>
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>{saving ? 'Сохраняю…' : 'Сохранить'}</Text>
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
            <View style={{ position:'relative' }}>
              <View style={styles.wheelsRow}>
                <Wheel data={days.map(String)} index={dayIdx} onIndexChange={setDayIdx} width={WHEEL_W} />
                <Wheel data={MONTHS_ABBR} index={monthIdx} onIndexChange={(i)=>{ setMonthIdx(i); setDayIdx(d=>Math.min(d, daysInMonth(i, withYear?years[yearIdx]:null)-1)); }} width={WHEEL_W} />
                <Wheel data={years.map(String)} index={yearIdx} onIndexChange={setYearIdx} width={WHEEL_W} enabled={withYear} />
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
              <Pressable onPress={() => setShowDatePicker(false)} style={[styles.appButton, styles.btnSecondary, styles.actionBtn]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <Pressable onPress={applyPicker} style={[styles.appButton, styles.btnPrimary, styles.actionBtn]}>
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>ОК</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal isVisible={suspendVisible} onBackdropPress={() => setSuspendVisible(false)} useNativeDriver animationIn="zoomIn" animationOut="zoomOut" backdropOpacity={0.25} style={styles.centeredModal}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Отстранить сотрудника?</Text>
            <Text style={styles.modalText}>Выберите, что сделать с его заявками.</Text>
            <View style={styles.radioRow}>
              <Pressable onPress={() => { setOrdersAction('keep'); setSuccessorError(''); }} style={({ pressed }) => [styles.radio, pressed && { opacity: 0.8 }]}>
                <View style={[styles.radioOuter, ordersAction==='keep' && styles.radioOuterActive]}><View style={[styles.radioInner, ordersAction==='keep' && styles.radioInnerActive]} /></View>
                <Text style={styles.radioLabel}>Оставить как есть</Text>
              </Pressable>
              <Pressable onPress={() => { setOrdersAction('reassign'); }} style={({ pressed }) => [styles.radio, pressed && { opacity: 0.8 }]}>
                <View style={[styles.radioOuter, ordersAction==='reassign' && styles.radioOuterActive]}><View style={[styles.radioInner, ordersAction==='reassign' && styles.radioInnerActive]} /></View>
                <Text style={styles.radioLabel}>Переназначить на сотрудника</Text>
              </Pressable>
            </View>
            {ordersAction === 'reassign' && (
              <View>
                <Text style={[styles.label, { marginTop: 8 }]}>Правопреемник</Text>
                <Pressable onPress={openSuccessorPickerFromSuspend} style={[styles.selectInput, successorError && { borderColor: '#FF453A' }]}>
                  <Text style={styles.selectInputText}>{successor?.name || 'Выберите сотрудника'}</Text>
                  <AntDesign name="search1" size={16} color="#666" />
                </Pressable>
                {!!successorError && <Text style={styles.helperError}>{successorError}</Text>}
              </View>
            )}
            <View style={[styles.modalActions, { marginTop: 16 }]}>
              <Pressable onPress={() => setSuspendVisible(false)} style={[styles.appButton, styles.btnSecondary]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <Pressable onPress={onConfirmSuspend} style={[styles.appButton, styles.btnPrimary]}>
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>{saving ? 'Применяю…' : 'Отстранить'}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal isVisible={unsuspendVisible} onBackdropPress={() => setUnsuspendVisible(false)} useNativeDriver animationIn="zoomIn" animationOut="zoomOut" backdropOpacity={0.25} style={styles.centeredModal}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Снять отстранение?</Text>
            <Text style={styles.modalText}>Сотрудник снова сможет пользоваться приложением.</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setUnsuspendVisible(false)} style={[styles.appButton, styles.btnSecondary]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <Pressable onPress={onConfirmUnsuspend} style={[styles.appButton, styles.btnPrimary]}>
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>{saving ? 'Применяю…' : 'Подтверждаю'}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={deleteVisible}
          onBackdropPress={() => setDeleteVisible(false)}
          useNativeDriver animationIn="zoomIn" animationOut="zoomOut"
          backdropOpacity={0.25} style={styles.centeredModal}
        >
          <View style={styles.modalContainer}>
            <Text style={[styles.modalTitle, { color: DESTRUCTIVE }]}>Удалить сотрудника?</Text>
            <Text style={styles.modalText}>Необходимо выбрать правопреемника, чтобы переназначить все его заявки.</Text>
            <Text style={[styles.label, { marginTop: 8 }]}>Правопреемник *</Text>
            <Pressable onPress={openSuccessorPickerFromDelete} style={[styles.selectInput, successorError && { borderColor: '#FF453A' }]}>
              <Text style={styles.selectInputText}>{successor?.name || 'Выберите сотрудника'}</Text>
              <AntDesign name="search1" size={16} color="#666" />
            </Pressable>
            {!!successorError && <Text style={styles.helperError}>{successorError}</Text>}
            <View style={[styles.modalActions, { marginTop: 16 }]}>
              <Pressable onPress={() => setDeleteVisible(false)} style={[styles.appButton, styles.btnSecondary]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <Pressable onPress={onConfirmDelete} style={[styles.appButton, styles.btnDestructive]}>
                <Text style={[styles.appButtonText, styles.btnDestructiveText]}>{saving ? 'Удаляю…' : 'Удалить'}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={pickerVisible}
          useNativeDriver={false}
          onBackdropPress={() => { setPickerVisible(false); if (pickerReturn==='delete') setDeleteVisible(true); if (pickerReturn==='suspend') setSuspendVisible(true); setPickerReturn(null); }}
          animationIn="slideInUp" animationOut="slideOutDown" backdropOpacity={0.4}
          style={{ justifyContent: 'flex-end', margin: 0 }}
        >
          <View style={[styles.modalContainerFull, { paddingBottom: 8, width: '100%', maxHeight: '80%' }]}>
            <View style={{alignSelf:'center', width:48, height:5, borderRadius:3, backgroundColor:'#D1D1D6', marginBottom:10}} />
            <Text style={styles.modalTitle}>Выбор сотрудника</Text>
            <TextInput
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
                ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#eee' }} />}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => { setSuccessor({ id: item.id, name: item.name, role: item.role }); setSuccessorError(''); setPickerVisible(false); if (pickerReturn==='delete') setDeleteVisible(true); if (pickerReturn==='suspend') setSuspendVisible(true); setPickerReturn(null);}}
                    style={({ pressed }) => [styles.assigneeOption, pressed && { backgroundColor: '#f5f5f5' }]}
                  >
                    <Text style={styles.assigneeText}>{item.name}</Text>
                    <Text style={{ fontSize: 12, color: '#8E8E93' }}>{ROLE_LABELS[item.role] || item.role}</Text>
                  </Pressable>
                )}
                ListEmptyComponent={<Text style={{ textAlign:'center', color:'#8E8E93', paddingVertical: 16 }}>Ничего не найдено</Text>}
              />
            )}
            <View style={[styles.modalActions, { marginTop: 10 }]}>
              <Pressable onPress={() => { setPickerVisible(false); if (pickerReturn==='delete') setDeleteVisible(true); if (pickerReturn==='suspend') setSuspendVisible(true); setPickerReturn(null); }} style={[styles.appButton, styles.btnSecondary, { flex: 1 }]}>
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
              <Pressable onPress={() => { setAvatarSheet(false); pickFromCamera(); }} style={[styles.appButton, styles.btnPrimary]}>
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>Сделать фото</Text>
              </Pressable>
              <Pressable onPress={() => { setAvatarSheet(false); pickFromLibrary(); }} style={[styles.appButton, styles.btnSecondary]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Выбрать из галереи</Text>
              </Pressable>
              {!!avatarUrl && (
                <Pressable onPress={() => { setAvatarSheet(false); deleteAvatar(); }} style={[styles.appButton, styles.btnDestructive]}>
                  <Text style={[styles.appButtonText, styles.btnDestructiveText]}>Удалить фото</Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.modalActions, { marginTop: 12 }]}>
              <Pressable onPress={() => setAvatarSheet(false)} style={[styles.appButton, styles.btnSecondary, { flex: 1 }]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
            </View>
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
                  onPress={() => { setRole(r); setShowRoles(false); }}
                  style={({ pressed }) => [
                    styles.roleItem,
                    role === r && styles.roleItemSelected,
                    pressed && { opacity: 0.85 }
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleTitle}>{ROLE_LABELS[r]}</Text>
                    <Text style={styles.roleDesc}>{ROLE_DESCRIPTIONS[r]}</Text>
                  </View>
                  <AntDesign name={role === r ? 'checkcircle' : 'checkcircleo'} size={20} color={role === r ? PRIMARY : '#C7C7CC'} />
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
            transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          }}
        >
          {!!ok && (
            <View style={styles.toast}>
              <AntDesign name="checkcircle" size={18} color="#1E9E4A" />
              <Text style={styles.toastText}>{ok}</Text>
            </View>
          )}
        </Animated.View>

      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f2' },
  scroll: { padding: 16 },
  /* pageTitle removed in favor of appBar */

  appBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  appBarBack: { padding: 6, borderRadius: 10 },
  appBarTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
  rolePillHeader: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  rolePillHeaderText: { fontSize: 12, fontWeight: '600' },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerCard: { padding: 8, marginBottom: 12 },
  headerCardSuspended: { backgroundColor: '#FFF0F0', borderColor: '#FF3B3033', borderWidth: 1, borderRadius: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E6F0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D6E4FF', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarCamBadge: { position: 'absolute', right: -2, bottom: -2, backgroundColor: '#007AFF', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 3 },
  avatarText: { color: PRIMARY, fontWeight: '700' },
  nameTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeGreen: { backgroundColor: '#34C759' },
  badgeRed: { backgroundColor: '#FF3B30' },
  badgeOutline: { borderWidth: 1, borderColor: '#C7C7CC', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeOutlineText: { color: '#3A3A3C', fontSize: 12 },
  badgeText: { fontSize: 12, fontWeight: '600' },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderColor: '#eee', borderWidth: 1, marginBottom: 12 },
  section: { marginTop: 6, marginBottom: 8, fontWeight: '600', color: TEXT_PRIMARY },
  label: { fontWeight: '500', marginBottom: 4, marginTop: 12, color: TEXT_SECONDARY },
  input: { borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff', borderRadius: 10, padding: 10 },
  inputFocused: { borderColor: PRIMARY, shadowColor: '#007AFF', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  inputError: { borderColor: '#FF3B30' },

  inputWithIcon: { paddingRight: 44 },
  inputIcon: { position: 'absolute', right: 10, top: '50%', transform: [{ translateY: -10 }], padding: 0, height: 20, justifyContent: 'center', alignItems: 'center' },

  selectInput: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: '#fff', padding: 12, marginTop: 4 },
  selectInputText: { fontSize: 16, color: TEXT_PRIMARY },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateClearBtn: { marginLeft: 8, padding: 6 },

  appButton: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center' },
  appButtonText: { fontSize: 16 },
  btnPrimary: { backgroundColor: PRIMARY },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  // outlined secondary button in "bank" style
  btnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#C7C7CC' },
  btnSecondaryText: { color: '#111', fontWeight: '500' },
  btnDestructive: { backgroundColor: DESTRUCTIVE },
  btnDestructiveText: { color: '#fff', fontWeight: '600' },

  errorCard: { backgroundColor: '#FF3B3018', borderColor: '#FF3B30', borderWidth: 1, padding: 12, borderRadius: 14, marginBottom: 12 },
  errorTitle: { color: '#D70015', fontWeight: '600' },
  errorText: { color: '#D70015', marginTop: 4 },

  successCard: { backgroundColor: '#34C75918', borderColor: '#34C759', borderWidth: 1, padding: 12, borderRadius: 14, marginBottom: 12 },
  successText: { color: '#1E9E4A', fontWeight: '600' },

  assigneeOption: { paddingVertical: 10, paddingHorizontal: 4 },
  assigneeText: { fontSize: 16, color: TEXT_PRIMARY },

  copyBtn: { backgroundColor: '#E5F0FF', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#A7C7FF' },
  copyBtnText: { color: PRIMARY, fontWeight: '600' },

  modalContainer: { backgroundColor: '#fff', borderRadius: 12, padding: 20, width: '90%', alignSelf:'center', maxWidth:400 },
  modalContainerFull: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, width:'100%' },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  modalText: { fontSize: 15, color: '#555', marginBottom: 20 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },

  helperError: { color: '#D70015', fontSize: 12, marginTop: 6 },

  centeredModal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
  picker: { backgroundColor: '#fff', borderRadius: 18, paddingVertical: 20, paddingHorizontal: 16, borderColor: '#E5E5EA', borderWidth: 1, width: '85%', maxWidth: 360, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  pickerTitle: { textAlign: 'center', fontSize: 18, color: TEXT_PRIMARY, marginBottom: 12, fontWeight: '600' },
  wheelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, height: ITEM_HEIGHT * VISIBLE_COUNT },
  selectionLines: { position: 'absolute', left: 10, right: 10, top: (ITEM_HEIGHT * (VISIBLE_COUNT-1))/2, height: ITEM_HEIGHT, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E5E5EA' },
  pickerActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  actionBtn: { flex: 1 },
  yearSwitchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  yearSwitchLabel: { color: TEXT_PRIMARY, fontSize: 14 },
  // dim overlays around the wheel area
  dimTop: { position:'absolute', left:0, right:0, top:0, height: ITEM_HEIGHT, backgroundColor: 'rgba(0,0,0,0.06)', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  dimBottom: { position:'absolute', left:0, right:0, bottom:0, height: ITEM_HEIGHT, backgroundColor: 'rgba(0,0,0,0.06)', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },

  radioRow: { gap: 10 },
  radio: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  radioOuter: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#C7C7CC', justifyContent:'center', alignItems:'center', marginRight: 8 },
  radioOuterActive: { borderColor: PRIMARY },
  radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'transparent' },
  radioInnerActive: { backgroundColor: PRIMARY },

  roleItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5EA', backgroundColor: '#FAFAFC' },
  roleItemSelected: { borderColor: PRIMARY, backgroundColor: '#EAF2FF' },
  roleTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY },
  roleDesc: { fontSize: 13, color: '#6B7280', marginTop: 2 },

  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E5E5EA', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, flexDirection: 'row', gap: 12 },
  actionBarBtn: { flex: 1 },

  toast: {
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#CDEFD6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    maxWidth: 440
  },
  toastText: { color: '#1E9E4A', fontWeight: '600' }
});