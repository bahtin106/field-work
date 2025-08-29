import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, KeyboardAvoidingView, Platform,
  ScrollView, Pressable, BackHandler, StyleSheet, Animated, Easing, Image, Switch, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Modal from 'react-native-modal';
import * as ImagePicker from 'expo-image-picker';
import { AntDesign } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider'; // <-- use app theme preference

// ---- Design tokens (aligned with [id].jsx) ----
const PRIMARY = '#007AFF';
const SECONDARY_BG = '#d1d1d6';
const DESTRUCTIVE = '#FF3B30';
const TEXT_PRIMARY = '#111';
const TEXT_SECONDARY = '#333';
const BORDER = '#ccc';

const COLORS = { admin: '#007AFF', dispatcher: '#34C759', worker: '#5856D6' };
const roleColor = (r) => COLORS[r] || '#8E8E93';

const ITEM_HEIGHT = 44;
const VISIBLE_COUNT = 5;
const SCREEN_W = Dimensions.get('window').width;
const DIALOG_W = Math.min(SCREEN_W * 0.85, 360);
const WHEEL_W = (DIALOG_W - 32) / 3;

const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_ABBR = ['янв.','февр.','март','апр.','май','июн.','июл.','авг.','сент.','окт.','нояб.','дек.'];

const ROLES = ['dispatcher', 'worker'];
const ROLE_LABELS = { dispatcher: 'Диспетчер', worker: 'Рабочий' };
const ROLE_DESCRIPTIONS = { dispatcher: 'Назначение и управление заявками.', worker: 'Выполнение заявок, без админ-прав.' };

// ---- Helpers ----
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
const onlyDigits = (s) => String(s || '').replace(/\\D/g, '');

// Normalize any user input to 10 national digits for Russia.
function normalizePhoneInput(srcText) {
  const src = String(srcText || '');
  let d = src.replace(/\D/g, '');
  const startsWithPlus7 = /^\s*\+?7/.test(src);
  if (startsWithPlus7 && d.startsWith('7')) d = d.slice(1);
  if (d.length === 11 && (d.startsWith('7') || d.startsWith('8'))) d = d.slice(1);
  if (d.length > 10) {
    // Prefer first 10 after possible trunk removal
    d = d.slice(0, 10);
  }
  // If user typed only trunk '7' or '8' -> treat as empty
  if (d === '7' || d === '8') d = '';
  return d;
}

function formatRuPhoneMasked(nat10) {
  const d = String(nat10 || '');
  if (!d) return '';
  const a = d.slice(0,3);
  const b = d.slice(3,6);
  const c = d.slice(6,8);
  const e = d.slice(8,10);
  let out = '+7 (' + a;
  if (d.length <= 3) return out;
  out += ')';
  if (b) out += ' ' + b;
  if (c) out += '-' + c;
  if (e) out += '-' + e;
  return out;
}

// Dynamic mask with placeholders like +7 (___) ___-__-__
function formatRuPhoneMaskedWithSlots(nat10) {
  const d = String(nat10 || '');
  const a = (d.slice(0,3) + '___').slice(0,3);
  const b = (d.slice(3,6) + '___').slice(0,3);
  const c = (d.slice(6,8) + '__').slice(0,2);
  const e = (d.slice(8,10) + '__').slice(0,2);
  let out = '+7 (' + a + ')';
  out += ' ' + b + '-' + c + '-' + e;
  return out;
}


function daysInMonth(monthIdx, yearNullable) {
  if (monthIdx === 1 && yearNullable == null) return 29;
  const y = yearNullable ?? 2024;
  return new Date(y, monthIdx + 1, 0).getDate();
}
function range(a, b) { const arr=[]; for (let i=a;i<=b;i++) arr.push(i); return arr; }

const pickErr = (a) => {
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (a.error) return String(a.error);
  if (a.message) return String(a.message);
  if (a.msg) return String(a.msg);
  if (a.details) return String(a.details);
  if (a.hint) return String(a.hint);
  return '';
};

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
    <Animated.FlatList
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

export default function NewUser() {
  const { theme } = useTheme(); // respect app preference
  const isDark = theme.mode === 'dark';
  const THEME = React.useMemo(() => ({
    // tuned tokens for good light/dark
    bg: isDark ? '#0E0F13' : '#F2F2F7',
    card: isDark ? '#1C1C1E' : '#FFFFFF',
    border: isDark ? '#2C2C2E' : '#E5E5EA',
    inputBg: isDark ? '#1C1C1E' : '#FFFFFF',
    textPrimary: isDark ? '#FFFFFF' : '#111111',
    textSecondary: isDark ? '#B8B8BD' : '#333333',
    modalBg: isDark ? '#1C1C1E' : '#FFFFFF',
    dim: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    toastBg: isDark ? '#1C1C1E' : '#FFFFFF',
    toastBorder: isDark ? '#2F6B3B' : '#CDEFD6',
  }), [isDark]);
  const router = useRouter();
  const scrollRef = useRef(null);

  // Текущая компания (для проверки дублей внутри компании)
  const [companyId, setCompanyId] = useState(null);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;
      const { data, error } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
      if (!error && data?.company_id) setCompanyId(data.company_id);
    })();
  }, []);

  // fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [role, setRole]           = useState('worker');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [focusPwd2, setFocusPwd2] = useState(false);
  const [tPwd2, setTPwd2] = useState(false);
  // Телефон: 10 цифр национального формата
  const [phoneDigits, setPhoneDigits] = useState('');
  const [showRuPrefix, setShowRuPrefix] = useState(false);
  
  
  // --- Phone mask helpers (caret-aware) ---
  const PHONE_MASK_TEMPLATE = formatRuPhoneMaskedWithSlots('');
  const SLOT_POS = useMemo(() => {
    const arr = [];
    for (let i = 0; i < PHONE_MASK_TEMPLATE.length; i++) {
      if (PHONE_MASK_TEMPLATE[i] === '_') arr.push(i);
    }
    return arr;
  }, []);
  const digitIndexFromCaret = useCallback((pos) => {
    let k = 0;
    for (let i = 0; i < SLOT_POS.length; i++) if (SLOT_POS[i] < pos) k++;
    return k;
  }, [SLOT_POS]);
  const caretFromDigitIndex = useCallback((k) => {
    if (k <= 0) return SLOT_POS[0] ?? 0;
    if (k >= SLOT_POS.length) return PHONE_MASK_TEMPLATE.length;
    return (SLOT_POS[k - 1] + 1);
  }, [SLOT_POS, PHONE_MASK_TEMPLATE]);
  const [phoneSel, setPhoneSel] = useState({ start: 0, end: 0 });
  const phoneSelLockRef = useRef(false);
// Birthdate
  const [birthdate, setBirthdate] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [withYear, setWithYear] = useState(true);
  const [dayIdx, setDayIdx] = useState(0);
  const [monthIdx, setMonthIdx] = useState(0);
  const [yearIdx, setYearIdx] = useState(0);
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

  // Avatar
  const [avatarUri, setAvatarUri] = useState(null);
  const [avatarSheet, setAvatarSheet] = useState(false);

  // UI state
  const [showRoles, setShowRoles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [cancelVisible, setCancelVisible] = useState(false);
  const [warningVisible, setWarningVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');

  // Focus/touched states for premium UX
  const [focusFirst, setFocusFirst] = useState(false);
  const [focusLast, setFocusLast] = useState(false);
  const [focusEmail, setFocusEmail] = useState(false);
  const [focusPhone, setFocusPhone] = useState(false);
  const [focusPwd, setFocusPwd] = useState(false);
  const [tFirst, setTFirst] = useState(false);
  const [tLast, setTLast] = useState(false);
  const [tEmail, setTEmail] = useState(false);
  const [tPhone, setTPhone] = useState(false);
  const [tPwd, setTPwd] = useState(false);

  const toastAnim = useRef(new Animated.Value(0)).current;

  // initial snapshot for "unsaved changes" guard
  const initialSnapRef = useRef('');
  useEffect(() => {
    initialSnapRef.current = JSON.stringify({
      firstName: '', lastName: '', email: '', phone: '', role: 'worker', password: false, birthdate: null, avatar: null,
    });
  }, []);

  const emailValid = useMemo(() => isValidEmailStrict(email), [email]);
  const passwordValid = useMemo(() => String(password).length >= 6, [password]);
  const passwordsMatch = useMemo(() => !password || password === confirmPassword, [password, confirmPassword]);
  const phoneValid = useMemo(() => {
  if (!phoneDigits) return true;
  if (phoneDigits.length !== 10) return false;
  if (phoneDigits[0] !== '9') return false;
  return true;
}, [phoneDigits]);
  const roleValid = useMemo(() => ROLES.includes(role), [role]);

  // initials for avatar placeholder
  const initials = useMemo(() => {
    const f = (firstName || '').trim();
    const l = (lastName || '').trim();
    if (!f && !l) return '';
    const fi = f ? f[0].toUpperCase() : '';
    const li = l ? l[0].toUpperCase() : '';
    return (fi + li) || f.slice(0, 2).toUpperCase();
  }, [firstName, lastName]);

  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0 && emailValid && passwordValid && passwordsMatch && roleValid && phoneValid;

  const isDirty = useMemo(() => {
    const snap = JSON.stringify({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phoneDigits,
      role,
      password: password.length > 0,
      birthdate: birthdate ? birthdate.toISOString().slice(0,10) : null,
      avatar: !!avatarUri,
    });
    return snap !== initialSnapRef.current;
  }, [firstName, lastName, email, phoneDigits, role, password, birthdate, avatarUri]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isDirty) { setCancelVisible(true); return true; }
      return false;
    });
    return () => sub.remove();
  }, [isDirty]);

  const showWarning = (msg) => { setWarningMessage(msg); setWarningVisible(true); };
  useEffect(() => {
    if (!ok) return;
    toastAnim.stopAnimation();
    toastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(2400),
      Animated.timing(toastAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => setOk(''));
  }, [ok]);

  const handleCancelPress = () => { if (isDirty) setCancelVisible(true); else router.back(); };
  const confirmCancel = () => { setCancelVisible(false); router.back(); };

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
    if (!ok) { setErr('Нет доступа к камере'); return; }
    const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1,1], quality: 0.85, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUri(res.assets[0].uri);
  };
  const pickFromLibrary = async () => {
    const ok = await ensureLibraryPerms();
    if (!ok) { setErr('Нет доступа к галерее'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1,1], quality: 0.85, mediaTypes: ImagePicker.MediaTypeOptions.Images, selectionLimit: 1 });
    if (!res.canceled && res.assets && res.assets[0]?.uri) setAvatarUri(res.assets[0].uri);
  };

  const uploadAvatarFor = async (userId, uri) => {
    if (!uri) return null;
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
      return publicUrl;
    } catch (e) {
      setErr(e?.message || 'Не удалось загрузить фото');
      return null;
    }
  };

  const checkDuplicates = useCallback(async (email, fullName, phoneNormalized) => {
    if (!companyId) return; // бэкенд всё равно проверит
    if (phoneNormalized) {
      const { data: samePhone, error: phoneErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('company_id', companyId)
        .eq('phone', phoneNormalized)
        .limit(1);
      if (!phoneErr && samePhone && samePhone.length) {
        throw new Error('Пользователь с таким телефоном уже существует в вашей компании');
      }
    }
    if (fullName) {
      const norm = fullName.trim().toLowerCase();
      const { data: sameName, error: nameErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('company_id', companyId)
        .ilike('full_name', fullName);
      if (!nameErr && Array.isArray(sameName) && sameName.some(r => String(r.full_name || '').trim().toLowerCase() === norm)) {
        throw new Error('Пользователь с таким именем уже есть в вашей компании');
      }
    }
  }, [companyId]);

  const handleCreate = useCallback(async () => {
    if (submitting) return;
    // trigger touched
    if (!tFirst) setTFirst(true);
    if (!tLast) setTLast(true);
    if (!tEmail) setTEmail(true);
    if (!tPwd) setTPwd(true);
    if (!tPwd2) setTPwd2(true);
    if (!tPhone) setTPhone(true);

    if (!firstName.trim()) { showWarning('Имя обязательно'); return; }
    if (!lastName.trim())  { showWarning('Фамилия обязательна'); return; }
    if (!emailValid)       { showWarning('Некорректный e-mail'); return; }
    if (!passwordValid) { showWarning('Пароль: минимум 6 символов'); return; }
    if (!passwordsMatch) { showWarning('Пароли не совпадают'); return; }
    if (!phoneValid)       { showWarning('Некорректный номер телефона'); return; }
    if (!roleValid)        { showWarning('Укажите роль'); return; }

    setErr(''); setOk(''); setSubmitting(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.replace(/\\s+/g,' ').trim();
      const phoneNormalized = phoneDigits ? `+7${phoneDigits}` : null;

      await checkDuplicates(email.trim().toLowerCase(), fullName, phoneNormalized);

      // Create auth user via edge function
      const payload = { email: email.trim().toLowerCase(), password: String(password), role };
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || '';
      const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/create_user`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(payload),
      });

      const raw = await resp.text();
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch {}
      if (!resp.ok) {
        const msg = pickErr(body) || raw || `HTTP ${resp.status}`;
        if (/already exists|email/i.test(msg)) throw new Error('Пользователь с таким e-mail уже существует');
        throw new Error(msg);
      }

      const userId = body?.user_id;
      if (!userId) throw new Error('Создан пользователь, но не получили его ID');

      // Save profile fields
      const bdate = birthdate instanceof Date
        ? `${birthdate.getFullYear()}-${String(birthdate.getMonth()+1).padStart(2,'0')}-${String(birthdate.getDate()).padStart(2,'0')}`
        : null;
      const { error: upErr } = await supabase
        .from('profiles')
        .update({
          first_name: firstName.trim() || null,
          last_name:  lastName.trim()  || null,
          full_name:  fullName || null,
          phone:      phoneNormalized,
          birthdate:  bdate,
        })
        .eq('id', userId);
      if (upErr) throw new Error(upErr.message || 'Создано, но профиль не обновился');

      // upload avatar if any
      if (avatarUri) await uploadAvatarFor(userId, avatarUri);

      setOk('Пользователь создан');
      setTimeout(() => { router.replace('/users'); }, 500);
    } catch (e) {
      setErr(String(e?.message || e) || 'Неизвестная ошибка');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, firstName, lastName, email, password, role, phoneDigits, emailValid, passwordValid, roleValid, phoneValid, birthdate, avatarUri, tFirst, tLast, tEmail, tPwd, tPwd2, tPhone, checkDuplicates]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={THEME.bg} />
        <View style={[styles.container, { backgroundColor: THEME.bg }]}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[styles.scroll, { paddingBottom: 140 }]}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode={Platform.OS === 'ios' ? 'on-drag' : 'none'}
            contentInsetAdjustmentBehavior="automatic"
          >
            {/* Top AppBar with back arrow */}
            <View style={styles.appBar}>
              <Pressable onPress={() => router.back()} hitSlop={12} style={styles.appBarBack}>
                <AntDesign name="arrowleft" size={22} color={THEME.textPrimary} />
              </Pressable>
              <Text style={[styles.appBarTitle, { color: THEME.textPrimary }]}>Новый сотрудник</Text>
              <View style={{width:22}} />
            </View>

            {err ? (<View style={styles.errorCard}><Text style={styles.errorTitle}>Ошибка</Text><Text style={styles.errorText}>{err}</Text></View>) : null}

            {/* Header card with avatar */}
            <View style={[styles.card, styles.headerCard, { backgroundColor: THEME.card, borderColor: THEME.border }]}>
              <View style={styles.headerRow}>
                <Pressable style={styles.avatar} onPress={() => setAvatarSheet(true)} accessibilityLabel='Добавить фото профиля'>
                  {avatarUri ? (
                    <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
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
                  <Text style={[styles.nameTitle, { color: THEME.textPrimary }]}>{(firstName || lastName) ? `${firstName} ${lastName}`.trim() : 'Без имени'}</Text>
                  

                </View>
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: THEME.card, borderColor: THEME.border }]}>
              <Text style={[styles.section, { color: THEME.textPrimary }]}>Личные данные</Text>

              <Text style={[styles.label, { color: THEME.textSecondary }]}>Имя *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.border, color: THEME.textPrimary }, focusFirst && styles.inputFocused, tFirst && !firstName.trim() && styles.inputError]}
                value={firstName}
                onChangeText={setFirstName}
                onFocus={()=>setFocusFirst(true)}
                onBlur={()=>{ setFocusFirst(false); setTFirst(true); }}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {tFirst && !firstName.trim() ? (<Text style={styles.helperError}>Укажите имя</Text>) : null}

              <Text style={[styles.label, { color: THEME.textSecondary }]}>Фамилия *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.border, color: THEME.textPrimary }, focusLast && styles.inputFocused, tLast && !lastName.trim() && styles.inputError]}
                value={lastName}
                onChangeText={setLastName}
                onFocus={()=>setFocusLast(true)}
                onBlur={()=>{ setFocusLast(false); setTLast(true); }}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {tLast && !lastName.trim() ? (<Text style={styles.helperError}>Укажите фамилию</Text>) : null}

              <Text style={[styles.label, { color: THEME.textSecondary }]}>E-mail *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.border, color: THEME.textPrimary }, focusEmail && styles.inputFocused, tEmail && !emailValid && styles.inputError]}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                onFocus={()=>setFocusEmail(true)}
                onBlur={()=>{ setFocusEmail(false); setTEmail(true); }}
              />
              {tEmail && !emailValid ? (<Text style={styles.helperError}>Укажите корректный имейл</Text>) : null}

              <Text style={[styles.label, { color: THEME.textSecondary }]}>Телефон (необязательно)</Text>
<TextInput
  style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.border, color: THEME.textPrimary }, focusPhone && styles.inputFocused, tPhone && !phoneValid && styles.inputError]}
  keyboardType="phone-pad"
  placeholderTextColor={THEME.textSecondary}
  placeholder="+7 (___) ___-__-__"
  value={(focusPhone || showRuPrefix || phoneDigits) ? formatRuPhoneMaskedWithSlots(phoneDigits) : ''}
  maxLength={PHONE_MASK_TEMPLATE.length}
  selection={phoneSel}
  onSelectionChange={(e) => {
    if (phoneSelLockRef.current) return;
    const sel = e?.nativeEvent?.selection;
    if (sel && typeof sel.start === 'number' && typeof sel.end === 'number') {
      setPhoneSel(sel);
    }
  }}
  onChangeText={(text) => {
    const prevDigits = String(phoneDigits || '');
    const prevSel = phoneSel || { start: 0, end: 0 };
    const caretIdx = digitIndexFromCaret(prevSel.start);
    const raw = String(text || '');
    let nd = raw.replace(/\D/g, '');

    if (!prevDigits && (nd.startsWith('7') || nd.startsWith('8'))) nd = nd.slice(1);

    let nextDigits = prevDigits;
    if (nd.length === prevDigits.length + 1) {
      const inserted = nd[nd.length - 1];
      const insAt = Math.max(0, Math.min(10, caretIdx));
      nextDigits = (prevDigits.slice(0, insAt) + inserted + prevDigits.slice(insAt)).slice(0, 10);
      const nextCaret = caretFromDigitIndex(insAt + 1);
      phoneSelLockRef.current = true;
      setPhoneDigits(nextDigits);
      setShowRuPrefix(true);
      setPhoneSel({ start: nextCaret, end: nextCaret });
      setTimeout(() => { phoneSelLockRef.current = false; }, 0);
      return;
    } else if (nd.length === prevDigits.length - 1) {
      const delAt = Math.max(0, Math.min(prevDigits.length, caretIdx)) - 1;
      if (delAt >= 0) {
        nextDigits = prevDigits.slice(0, delAt) + prevDigits.slice(delAt + 1);
      } else {
        nextDigits = prevDigits;
      }
      const nextCaret = caretFromDigitIndex(Math.max(0, caretIdx - 1));
      phoneSelLockRef.current = true;
      setPhoneDigits(nextDigits);
      setShowRuPrefix(true);
      setPhoneSel({ start: nextCaret, end: nextCaret });
      setTimeout(() => { phoneSelLockRef.current = false; }, 0);
      return;
    } else {
      nextDigits = nd.slice(0, 10);
      const nextCaret = caretFromDigitIndex(nextDigits.length);
      phoneSelLockRef.current = true;
      setPhoneDigits(nextDigits);
      setShowRuPrefix(true);
      setPhoneSel({ start: nextCaret, end: nextCaret });
      setTimeout(() => { phoneSelLockRef.current = false; }, 0);
      return;
    }
  }}
  onFocus={() => {
    setFocusPhone(true);
    setShowRuPrefix(true);
    const p = caretFromDigitIndex(String(phoneDigits || '').length);
    phoneSelLockRef.current = true;
    setPhoneSel({ start: p, end: p });
    setTimeout(() => { phoneSelLockRef.current = false; }, 0);
  }}
  onBlur={() => {
    setFocusPhone(false);
    setTPhone(true);
    if (!phoneDigits) setShowRuPrefix(false);
  }}
/>
              {tPhone && !phoneValid ? (<Text style={styles.helperError}>Укажите корректный номер</Text>) : null}

              <Text style={[styles.label, { color: THEME.textSecondary }]}>Дата рождения (необязательно)</Text>
              <View style={styles.dateRow}>
                <Pressable style={[styles.selectInput, { flex: 1, backgroundColor: THEME.inputBg, borderColor: THEME.border }]} onPress={openPicker}>
                  <Text style={[styles.selectInputText, { color: THEME.textPrimary }]}>
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

            <View style={[styles.card, { backgroundColor: THEME.card, borderColor: THEME.border }]}>
              <Text style={[styles.section, { color: THEME.textPrimary }]}>Права</Text>
              <Text style={[styles.label, { color: THEME.textSecondary }]}>Роль</Text>
              <Pressable style={[styles.selectInput, { backgroundColor: THEME.inputBg, borderColor: THEME.border }]} onPress={() => setShowRoles(true)}>
                <Text style={[styles.selectInputText, { color: THEME.textPrimary }]}>{ROLE_LABELS[role] || '—'}</Text>
                <AntDesign name="down" size={16} color="#666" />
              </Pressable>
            </View>

            <View style={[styles.card, { backgroundColor: THEME.card, borderColor: THEME.border }]}>
              <Text style={[styles.section, { color: THEME.textPrimary }]}>Пароль</Text>
              <Text style={[styles.label, { color: THEME.textSecondary }]}>Пароль (мин. 6 символов) *</Text>
              <View style={{ position: 'relative' }}>
                <TextInput
                  style={[
                    styles.input,
                    styles.inputWithIcon,
                    { backgroundColor: THEME.inputBg, borderColor: THEME.border, color: THEME.textPrimary },
                    focusPwd && styles.inputFocused,
                    tPwd && password.length>0 && !passwordValid && styles.inputError
                  ]}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={THEME.textSecondary}
                  onFocus={()=>setFocusPwd(true)}
                  onBlur={()=>{ setFocusPwd(false); setTPwd(true); }}
                />
                <Pressable
                  onPress={() => setShowPassword(v => !v)}
                  style={styles.inputIcon}
                  accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  <AntDesign name={showPassword ? 'eye' : 'eyeo'} size={20} color="#8E8E93" />
                </Pressable>
              </View>
              {tPwd && password.length > 0 && !passwordValid && (
                <Text style={styles.helperError}>Минимум 6 символов</Text>
              )}

              {/* Confirm password */}
              <Text style={[styles.label, { color: THEME.textSecondary }]}>Повторите пароль *</Text>
              <View style={{ position: 'relative' }}>
                <TextInput
                  style={[
                    styles.input,
                    styles.inputWithIcon,
                    { backgroundColor: THEME.inputBg, borderColor: THEME.border, color: THEME.textPrimary },
                    focusPwd2 && styles.inputFocused,
                    tPwd2 && !passwordsMatch && styles.inputError
                  ]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={THEME.textSecondary}
                  onFocus={()=>setFocusPwd2(true)}
                  onBlur={()=>{ setFocusPwd2(false); setTPwd2(true); }}
                />
                <Pressable
                  onPress={() => setShowPassword(v => !v)}
                  style={styles.inputIcon}
                  accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  <AntDesign name={showPassword ? 'eye' : 'eyeo'} size={20} color="#8E8E93" />
                </Pressable>
              </View>
              {tPwd2 && !passwordsMatch && (
                <Text style={styles.helperError}>Пароли не совпадают</Text>
              )}
            </View>
          </ScrollView>

          {/* Sticky bottom action bar */}
          <View style={[styles.actionBar, { backgroundColor: THEME.card, borderTopColor: THEME.border }]}>
            <Pressable onPress={handleCancelPress} style={({ pressed }) => [styles.appButton, styles.btnSecondary, styles.actionBarBtn, pressed && { transform: [{ scale: 0.98 }] }]}>
              <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отменить</Text>
            </Pressable>
            <Pressable disabled={!canSubmit || submitting} onPress={handleCreate} style={({ pressed }) => [styles.appButton, styles.btnPrimary, styles.actionBarBtn, (!canSubmit || submitting) && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.98 }] }]}>
              <Text style={[styles.appButtonText, styles.btnPrimaryText]}>{submitting ? 'Создаю…' : 'Создать'}</Text>
            </Pressable>
          </View>
        </View>

        {/* Modals */}
        <Modal isVisible={cancelVisible} onBackdropPress={() => setCancelVisible(false)} useNativeDriver backdropOpacity={0.3}>
          <View style={[styles.modalContainer, { backgroundColor: THEME.modalBg, borderColor: THEME.border }]}>
            <Text style={[styles.modalTitle, { color: THEME.textPrimary }]}>Выйти без сохранения?</Text>
            <Text style={[styles.modalText, { color: THEME.textPrimary }]} >Всё введённое будет потеряно. Вы уверены?</Text>
            <View style={[styles.modalActions]} >
              <Pressable onPress={() => setCancelVisible(false)} style={[styles.appButton, styles.btnSecondary, styles.modalBtn]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Отмена</Text>
              </Pressable>
              <Pressable onPress={confirmCancel} style={[styles.appButton, styles.btnDestructive, styles.modalBtn]}>
                <Text style={[styles.appButtonText, styles.btnDestructiveText]}>Выйти</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal isVisible={warningVisible} onBackdropPress={() => setWarningVisible(false)} useNativeDriver backdropOpacity={0.3}>
          <View style={[styles.modalContainer, { backgroundColor: THEME.modalBg, borderColor: THEME.border }]}>
            <Text style={[styles.modalTitle, { color: THEME.textPrimary }]}>Внимание</Text>
            <Text style={[styles.modalText, { color: THEME.textPrimary }]} >{warningMessage}</Text>
            <View style={[styles.modalActions]} >
              <Pressable onPress={() => setWarningVisible(false)} style={[styles.appButton, styles.btnPrimary, styles.modalBtn]}>
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>Ок</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Avatar sheet */}
        <Modal
          isVisible={avatarSheet}
          onBackdropPress={() => setAvatarSheet(false)}
          useNativeDriver
          backdropOpacity={0.3}
          style={styles.centeredModal}
        >
          <View style={[styles.modalContainer, { backgroundColor: THEME.modalBg, borderColor: THEME.border }]}>
            <Text style={[styles.modalTitle, { color: THEME.textPrimary }]}>Фото профиля</Text>
            <View style={{ gap: 10 }}>
              <Pressable onPress={() => { setAvatarSheet(false); pickFromCamera(); }} style={[styles.appButton, styles.btnPrimary]}>
                <Text style={[styles.appButtonText, styles.btnPrimaryText]}>Сделать фото</Text>
              </Pressable>
              <Pressable onPress={() => { setAvatarSheet(false); pickFromLibrary(); }} style={[styles.appButton, styles.btnSecondary]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Выбрать из галереи</Text>
              </Pressable>
              {!!avatarUri && (
                <Pressable onPress={() => { setAvatarSheet(false); setAvatarUri(null); }} style={[styles.appButton, styles.btnDestructive]}>
                  <Text style={[styles.appButtonText, styles.btnDestructiveText]}>Удалить фото</Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.modalActions, { marginTop: 12 }]}>
              <Pressable onPress={() => setAvatarSheet(false)} style={[styles.appButton, styles.btnSecondary, { flex: 1 }]}>
                <Text style={[styles.appButtonText, styles.btnSecondaryText]}>Закрыть</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Роль — модалка */}
        <Modal
          isVisible={showRoles}
          onBackdropPress={() => setShowRoles(false)}
          useNativeDriver
          backdropOpacity={0.3}
          style={styles.centeredModal}
        >
          <View style={[styles.modalContainer, { backgroundColor: THEME.modalBg, borderColor: THEME.border }]}>
            <Text style={[styles.modalTitle, { color: THEME.textPrimary }]}>Выбор роли</Text>
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
          <View style={[styles.picker, { backgroundColor: THEME.card, borderColor: THEME.border }]}>
            <Text style={[styles.pickerTitle, { color: THEME.textPrimary }]}>{headerTitle}</Text>
            <View style={{ position:'relative' }}>
              <View style={styles.wheelsRow}>
                <Wheel data={days.map(String)} index={dayIdx} onIndexChange={setDayIdx} width={WHEEL_W} />
                <Wheel data={MONTHS_ABBR} index={monthIdx} onIndexChange={(i)=>{ setMonthIdx(i); setDayIdx(d=>Math.min(d, daysInMonth(i, withYear?years[yearIdx]:null)-1)); }} width={WHEEL_W} />
                <Wheel data={years.map(String)} index={yearIdx} onIndexChange={setYearIdx} width={WHEEL_W} enabled={withYear} />
              </View>
              <View pointerEvents="none" style={[styles.selectionLines, { borderColor: THEME.border }]} />
              <View pointerEvents="none" style={[styles.dimTop, { backgroundColor: THEME.dim }]} />
              <View pointerEvents="none" style={[styles.dimBottom, { backgroundColor: THEME.dim }]} />
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
            <View style={[styles.toast, { backgroundColor: THEME.toastBg, borderColor: THEME.toastBorder }]}>
              <AntDesign name="checkcircle" size={18} color="#1E9E4A" />
              <Text style={[styles.toastText, { color: THEME.textPrimary }]}>{ok}</Text>
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
  appBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, marginBottom: 8 },
  appBarBack: { padding: 8, marginRight: 8 },
  appBarTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '600', color: TEXT_PRIMARY, marginRight: 30 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderColor: '#eee', borderWidth: 1, marginBottom: 12 },

  headerCard: { padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E5E5EA', justifyContent:'center', alignItems:'center', position:'relative' },
  avatarImg: { width: 64, height: 64, borderRadius: 32 },
  avatarText: { fontSize: 22, fontWeight: '700', color: '#6B7280' },
  avatarCamBadge: { position:'absolute', right:-2, bottom:-2, width:20, height:20, borderRadius:10, backgroundColor: PRIMARY, justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:'#fff' },
  nameTitle: { fontSize: 18, fontWeight: '600', color: TEXT_PRIMARY },
  rolePillHeader: { alignSelf:'flex-start', marginTop: 6, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
  rolePillHeaderText: { fontSize: 13, fontWeight: '600' },

  section: { marginTop: 6, marginBottom: 8, fontWeight: '600', color: TEXT_PRIMARY },
  label: { fontWeight: '500', marginBottom: 4, marginTop: 12, color: TEXT_SECONDARY },
  input: { borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff', borderRadius: 10, padding: 10, fontSize: 16 },
  inputWithIcon: { paddingRight: 44 },
  inputIcon: { position: 'absolute', right: 10, top: '50%', transform: [{ translateY: -10 }], padding: 0, height: 20, justifyContent: 'center', alignItems: 'center' },
  inputFocused: { borderColor: PRIMARY, shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6 },
  inputError: { borderColor: '#FF453A' },

  selectInput: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: '#fff', padding: 12, marginTop: 4 },
  selectInputText: { fontSize: 16, color: TEXT_PRIMARY },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateClearBtn: { paddingHorizontal: 6, paddingVertical: 6 },

  appButton: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center' },
  appButtonText: { fontSize: 16 },
  btnPrimary: { backgroundColor: PRIMARY },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  btnSecondary: { backgroundColor: SECONDARY_BG },
  btnSecondaryText: { color: '#111', fontWeight: '500' },
  btnDestructive: { backgroundColor: DESTRUCTIVE },
  btnDestructiveText: { color: '#fff', fontWeight: '600' },

  errorCard: { backgroundColor: '#FF3B3022', borderColor: DESTRUCTIVE, borderWidth: 1, padding: 12, borderRadius: 14, margin: 12 },
  errorTitle: { color: DESTRUCTIVE, fontWeight: '700', marginBottom: 4 },
  errorText: { color: '#6B0000' },

  helperError: { marginTop: 6, color: '#D70015', fontSize: 12 },

  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee', flexDirection: 'row', gap: 12 },
  actionBarBtn: { flex: 1 },

  // toast
  toast: { backgroundColor: '#fff', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#CDEFD6', flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, elevation: 4, alignSelf:'center', maxWidth: 440 },
  toastText: { color: '#1E9E4A', fontWeight: '600' },

  modalContainer: { backgroundColor: '#fff', borderRadius: 12, padding: 20, width: '90%', alignSelf:'center', maxWidth:400 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  modalText: { fontSize: 15, color: '#111', marginBottom: 16, lineHeight: 20 },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  modalBtn: { flex: 1 },

  centeredModal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
  picker: { backgroundColor: '#fff', borderRadius: 18, paddingVertical: 20, paddingHorizontal: 16, borderColor: '#E5E5EA', borderWidth: 1, width: '85%', maxWidth: 360, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  pickerTitle: { textAlign: 'center', fontSize: 18, color: TEXT_PRIMARY, marginBottom: 12, fontWeight: '600' },
  wheelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, height: ITEM_HEIGHT * VISIBLE_COUNT },
  selectionLines: { position: 'absolute', left: 10, right: 10, top: (ITEM_HEIGHT * (VISIBLE_COUNT-1))/2, height: ITEM_HEIGHT, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E5E5EA' },
  pickerActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  actionBtn: { flex: 1 },
  yearSwitchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  yearSwitchLabel: { color: TEXT_PRIMARY, fontSize: 14 },
  dimTop: { position:'absolute', left:0, right:0, top:0, height: ITEM_HEIGHT, backgroundColor: 'rgba(0,0,0,0.06)', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  dimBottom: { position:'absolute', left:0, right:0, bottom:0, height: ITEM_HEIGHT, backgroundColor: 'rgba(0,0,0,0.06)', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },

  roleItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5EA', backgroundColor: '#FAFAFC' },
  roleItemSelected: { borderColor: PRIMARY, backgroundColor: '#EAF2FF' },
  roleTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY },
  roleDesc: { fontSize: 13, color: '#6B7280', marginTop: 2 },
});
