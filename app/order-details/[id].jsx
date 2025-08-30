// app/order-details/[id].jsx
import { AntDesign, Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { decode } from 'base64-arraybuffer';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Platform,
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  BackHandler,
  ActivityIndicator,
  TextInput,
  Linking,
  KeyboardAvoidingView,
  Keyboard,
  TouchableWithoutFeedback,
  ToastAndroid,
  findNodeHandle,
  UIManager,
  Dimensions,
  InteractionManager,
} from 'react-native';
import { Animated as RNAnimated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Modal from 'react-native-modal';
import { MaskedTextInput } from 'react-native-mask-text';

// gestures + reanimated for smooth, Xiaomi-like viewer
import {
  TapGestureHandler,
  PanGestureHandler,
  PinchGestureHandler,
  State,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  useAnimatedGestureHandler,
} from 'react-native-reanimated';

import { supabase } from '../../lib/supabase';

import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

import { useTheme } from '../../theme/ThemeProvider';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Shared lightweight caches (persist while app lives)
const ORDER_CACHE = (globalThis.ORDER_CACHE ||= new Map());
const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());

// ---------------- helpers: UI ----------------
// --- FIXED AppButton ---
function AppButton({ label, onPress, type = 'primary', disabled = false }) {
  const s = StyleSheet.create({
    appButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
    },
    appButtonText: { fontSize: 16 },
    btnPrimary: { backgroundColor: '#007AFF' },
    btnPrimaryText: { color: '#fff', fontWeight: '600' },
    btnSecondary: { backgroundColor: '#d1d1d6' },
    btnSecondaryText: { color: '#111', fontWeight: '500' },
    btnDestructive: { backgroundColor: '#FF3B30' },
    btnDestructiveText: { color: '#fff', fontWeight: '700' },
  });

  const base = [s.appButton];
  let text = [s.appButtonText];

  if (type === 'secondary') {
    base.push(s.btnSecondary);
    text.push(s.btnSecondaryText);
  } else if (type === 'destructive') {
    base.push(s.btnDestructive);
    text.push(s.btnDestructiveText);
  } else {
    base.push(s.btnPrimary);
    text.push(s.btnPrimaryText);
  }

  if (disabled) base.push({ opacity: 0.6 });

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [base, pressed && { opacity: 0.9 }]}
    >
      <Text style={text}>{label}</Text>
    </Pressable>
  );
}
// --- /FIXED AppButton ---

export default function OrderDetails() {
  const { theme } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
        toggle: {
          width: 42,
          height: 26,
          borderRadius: 13,
          backgroundColor: '#d1d1d6',
          padding: 2,
          justifyContent: 'center',
        },
        toggleOn: { backgroundColor: '#FF3B30' },
        knob: {
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: theme.colors.card,
          alignSelf: 'flex-start',
        },
        knobOn: { alignSelf: 'flex-end' },
        toggleLabel: { fontSize: 14, color: theme.colors.text },
        container: { padding: 16, paddingBottom: 60, backgroundColor: '#F5F6F8' },

        centered: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: theme.colors.card,
        },

        // Top
        topBar: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        },
        backText: { color: theme.colors.primary, fontSize: 16 },
        editBtn: {
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 10,
          backgroundColor: '#EEF0F3',
        },
        editBtnText: { color: theme.colors.text, fontWeight: '600' },

        // Header
        headerCard: {
          backgroundColor: theme.colors.card,
          borderRadius: 16,
          padding: 16,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 3,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        headerTitle: {
          fontSize: 22,
          fontWeight: '800',
          color: theme.colors.text,
          marginBottom: 8,
          letterSpacing: 0.2,
        },
        metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        urgentPill: {
          backgroundColor: '#FF3B30',
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
        },
        urgentPillText: { color: '#fff', fontWeight: '700', fontSize: 12 },
        statusChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
        statusChipText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

        // Info card
        cardBlock: {
          backgroundColor: theme.colors.card,
          borderRadius: 16,
          paddingVertical: 4,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.colors.border,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        row: {
          paddingHorizontal: 16,
          paddingVertical: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        },
        rowLabel: { fontSize: 15, color: '#6B7280', flexShrink: 0 },
        rowValue: { fontSize: 16, color: theme.colors.text, textAlign: 'right', flex: 1 },
        linkText: { color: theme.colors.primary, textDecorationLine: 'underline' },
        muted: { color: '#8E8E93' },
        separator: { height: 1, backgroundColor: '#F1F2F4' },

        // Description card
        descCard: {
          marginTop: 12,
          backgroundColor: theme.colors.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: 16,
          paddingVertical: 14,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        descTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text, marginBottom: 6 },
        descText: { fontSize: 16, color: theme.colors.text, lineHeight: 22 },
        descToggle: { marginTop: 8, color: theme.colors.primary, fontWeight: '600' },

        // Photos (horizontal rows)
        photosBlock: {
          marginTop: 16,
          backgroundColor: theme.colors.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingVertical: 8,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        photosHeader: {
          paddingHorizontal: 16,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        photosTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
        addChip: {
          backgroundColor: '#F0F7FF',
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 999,
        },
        addChipText: { color: theme.colors.primary, fontWeight: '600', fontSize: 13 },

        hRow: { paddingHorizontal: 10, paddingBottom: 8 },
        hItem: { position: 'relative', marginRight: 10 },
        imagePressable: {
          borderRadius: 12,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        },
        hImage: { width: 116, height: 116, borderRadius: 12 },
        deletePhoto: {
          position: 'absolute',
          top: 4,
          right: 4,
          backgroundColor: '#FF3B30',
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 5,
          elevation: 5,
        },
        deleteText: { color: '#fff', fontWeight: '700', fontSize: 16, lineHeight: 18 },

        // Buttons
        finishButton: {
          marginTop: 18,
          backgroundColor: theme.colors.primary,
          paddingVertical: 14,
          borderRadius: 14,
          alignItems: 'center',
        },
        finishButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

        appButton: {
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 12,
          alignItems: 'center',
        },
        appButtonText: { fontSize: 16 },
        btnPrimary: { backgroundColor: theme.colors.primary },
        btnPrimaryText: { color: '#fff', fontWeight: '600' },
        btnSecondary: { backgroundColor: '#d1d1d6' },
        btnSecondaryText: { color: theme.colors.text, fontWeight: '500' },
        btnDestructive: { backgroundColor: '#FF3B30' },
        btnDestructiveText: { color: '#fff', fontWeight: '700' },

        // Modals
        modalContainer: { backgroundColor: theme.colors.card, borderRadius: 12, padding: 20 },
        modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
        modalText: { fontSize: 15, color: theme.text.muted.color, marginBottom: 20 },
        modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
        assigneeOption: { paddingVertical: 10 },
        assigneeText: { fontSize: 16, color: theme.colors.text },

        // Edit sheet
        editSheet: {
          backgroundColor: theme.colors.card,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: '92%',
        },
        sheetHeader: {
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 20,
          paddingVertical: 16,
          backgroundColor: '#fafafa',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
        },
        sheetTitle: {
          fontSize: 20,
          fontWeight: '700',
          color: theme.colors.text,
          letterSpacing: 0.3,
        },

        // iOS banner toast
        banner: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 24,
          backgroundcolor: theme.colors.text,
          borderRadius: 12,
          paddingVertical: 12,
          paddingHorizontal: 16,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        },
        bannerText: { color: '#fff', textAlign: 'center', fontWeight: '600' },

        card: {
          backgroundColor: theme.colors.card,
          borderRadius: 12,
          padding: 12,
          borderColor: theme.colors.border,
          borderWidth: 1,
          marginBottom: 12,
        },
        section: { marginTop: 6, marginBottom: 8, fontWeight: '600', color: theme.colors.text },
        label: { fontWeight: '500', marginBottom: 4, marginTop: 12, color: theme.colors.text },
        input: {
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
          borderRadius: 10,
          padding: 10,
        },
        selectInput: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 10,
          backgroundColor: theme.colors.card,
          padding: 12,
          marginTop: 4,
        },
        selectInputText: { fontSize: 16, color: theme.colors.text },

        // Viewer
        viewerTopBar: {
          position: 'absolute',
          top: 16,
          left: 0,
          right: 0,
          zIndex: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
        },
        counterPill: {
          backgroundColor: 'rgba(0,0,0,0.55)',
          borderRadius: 999,
          paddingHorizontal: 12,
          paddingVertical: 6,
        },
        counterText: { color: '#fff', fontWeight: '700' },
        closeBtn: {
          backgroundColor: 'rgba(0,0,0,0.55)',
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
        },
      }),
    [theme],
  );

  const { id, returnTo, returnParams } = useLocalSearchParams();
  const backTargetPath =
    typeof returnTo === 'string' && returnTo ? String(returnTo) : '/(tabs)/orders';
  let backParams = {};
  try {
    backParams = returnParams ? JSON.parse(returnParams) : {};
  } catch (e) {
    backParams = {};
  }

  const router = useRouter();
  const navigation = useNavigation();
  const isNavigatingRef = useRef(false);

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [userId, setUserId] = useState(null);
  const [executorName, setExecutorName] = useState(null);
  // Derive executor name instantly to avoid flicker
  const deriveExecutorNameInstant = (o) => {
    if (!o) return null;
    // from cache by id
    if (o.assigned_to && EXECUTOR_NAME_CACHE.has(o.assigned_to))
      return EXECUTOR_NAME_CACHE.get(o.assigned_to);
    // from common fields
    const fromFields = [
      o.assigned_to_name,
      o.executor_name,
      o.assignee_name,
      o.worker_name,
      o.assigned_name,
    ].find((v) => typeof v === 'string' && v.trim());
    if (fromFields) return String(fromFields).trim();
    // from nested objects
    const join = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      const s =
        [obj.last_name, obj.first_name, obj.middle_name].filter(Boolean).join(' ').trim() ||
        obj.full_name ||
        obj.name;
      return s ? String(s).trim() : null;
    };
    const nested =
      join(o.assigned_to_profile) || join(o.executor_profile) || join(o.assignee_profile);
    if (nested) return nested;
    return null;
  };

  // toast banner (iOS)
  const [bannerMessage, setBannerMessage] = useState('');
  const showToast = (msg) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
    } else {
      setBannerMessage(msg);
      setTimeout(() => setBannerMessage(''), 2000);
    }
  };

  // ===== Edit mode =====
  const [editMode, setEditMode] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState(''); // raw digits (11)
  const [departureDate, setDepartureDate] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [assigneeId, setAssigneeId] = useState(null);
  const [users, setUsers] = useState([]);
  const [toFeed, setToFeed] = useState(false);
  const [urgent, setUrgent] = useState(false);

  // — финансы
  const [amount, setAmount] = useState('');
  const [gsm, setGsm] = useState('');
  const [cancelVisible, setCancelVisible] = useState(false);
  const [warningVisible, setWarningVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const showWarning = (message) => {
    setWarningMessage(message);
    setWarningVisible(true);
  };

  const [assigneeModalVisible, setAssigneeModalVisible] = useState(false);

  // Canonical snapshot of the edit form to detect real changes
  const initialFormSnapshotRef = useRef('');
  const detailsScrollRef = useRef(null);
  const dateFieldRef = useRef(null); // <-- ref used for scroll calculations

  // ===== UI state for description collapse (MUST be before any early return) =====
  const [descExpanded, setDescExpanded] = useState(false);

  // helpers: money formatting/parsing
  const parseMoney = (s) => {
    const v = String(s ?? '')
      .replace(/[^0-9.,]/g, '')
      .replace(',', '.');
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const formatMoney = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    if (!Number.isFinite(n)) return '—';
    const parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${parts[0]}.${parts[1]} ₽`;
  };

  const makeSnapshotFromOrder = (o) => {
    if (!o) return '';
    const phoneDigits = ((o.phone ?? o.phone_visible) || '')
      .replace(/\D/g, '')
      .replace(/^8(\d{10})$/, '7$1');
    return JSON.stringify({
      title: o.title || '',
      comment: o.comment || '',
      region: o.region || '',
      city: o.city || '',
      street: o.street || '',
      house: o.house || '',
      fio: o.fio || '',
      phone: phoneDigits,
      datetime: o.datetime ? new Date(o.datetime).toISOString() : null,
      assigned_to: o.assigned_to || null,
      price: o.price ?? null,
      fuel_cost: o.fuel_cost ?? null,
    });
  };

  const makeSnapshotFromState = () => {
    const phoneDigits = (phone || '').replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1');
    return JSON.stringify({
      title: title || '',
      comment: description || '',
      region: region || '',
      city: city || '',
      street: street || '',
      house: house || '',
      fio: customerName || '',
      phone: phoneDigits,
      datetime: departureDate ? departureDate.toISOString() : null,
      assigned_to: assigneeId || null,
      price: parseMoney(amount),
      fuel_cost: parseMoney(gsm),
    });
  };

  const [statusModalVisible, setStatusModalVisible] = useState(false);

  // ===== Delete controls =====
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(5);
  const [deleteEnabled, setDeleteEnabled] = useState(false);

  // ===== Dirty check for edit form =====
  const formIsDirty = () => {
    if (!order) return false;
    try {
      const current = makeSnapshotFromState();
      const initial = initialFormSnapshotRef.current || makeSnapshotFromOrder(order);
      return current !== initial;
    } catch {
      return false;
    }
  };

  const requestCloseEdit = () => {
    if (formIsDirty()) {
      setCancelVisible(true);
    } else {
      setEditMode(false);
    }
  };

  const goBack = () => {
    if (editMode) {
      requestCloseEdit();
      return;
    }

    if (returnTo && !isNavigatingRef.current) {
      isNavigatingRef.current = true;
      router.replace({ pathname: backTargetPath, params: backParams });
      return;
    }

    if (navigation?.canGoBack?.()) {
      navigation.goBack();
    } else {
      router.replace('/(tabs)/orders');
    }
  };

  // ===== Back handlers with confirm =====
  useEffect(() => {
    const onHardwareBack = () => {
      if (editMode) {
        requestCloseEdit();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [editMode]);

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      // если редактирование — показываем подтверждение
      if (editMode) {
        e.preventDefault();
        requestCloseEdit();
        return;
      }
      // если пришли из списка/календаря — один раз делаем replace с фильтрами
      if (returnTo && !isNavigatingRef.current) {
        e.preventDefault();
        isNavigatingRef.current = true;
        router.replace({ pathname: backTargetPath, params: backParams });
      }
    });

    return sub;
  }, [navigation, editMode, returnTo, backTargetPath]);

  const scrollToDateField = () => {
    const node = dateFieldRef.current;
    const scrollNode = findNodeHandle(detailsScrollRef.current);
    if (!node || !scrollNode) return;
    try {
      UIManager.measureLayout(
        node,
        scrollNode,
        () => {},
        (_x, y) => detailsScrollRef.current?.scrollTo?.({ y, animated: true }),
      );
    } catch {}
  };

  // Keep photos in sync with Supabase storage (server truth)
  const syncPhotosFromStorage = useCallback(async () => {
    if (!order?.id) return;
    try {
      const bucket = 'orders-photos';
      const cats = ['contract_file', 'photo_before', 'photo_after', 'act_file'];
      const next = { ...order };
      for (const cat of cats) {
        const folder = `orders/${order.id}/${cat}`;
        const { data: files, error } = await supabase.storage.from(bucket).list(folder);
        if (error) continue;
        const urls = (files || []).map((f) => {
          const path = `${folder}/${f.name}`;
          const { data } = supabase.storage.from(bucket).getPublicUrl(path);
          return data.publicUrl;
        });
        next[cat] = urls;
      }
      setOrder(next);
    } catch (e) {
      console.warn(e);
    }
  }, [order?.id]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (editMode) {
          requestCloseEdit();
          return true;
        }
        goBack();
        return true;
      });
      return () => subscription.remove();
    }, [editMode]),
  );

  // ===== Ensure photos come only from Supabase (avoid stale local cache) =====
  const fetchServerPhotos = async (orderId) => {
    try {
      const bucket = 'orders-photos';
      const cats = ['contract_file', 'photo_before', 'photo_after', 'act_file'];
      const result = {};
      for (const cat of cats) {
        const list = await supabase.storage.from(bucket).list(`orders/${orderId}/${cat}`);
        const files = list?.data || [];
        const urls = files.map((f) => {
          const { data } = supabase.storage
            .from(bucket)
            .getPublicUrl(`orders/${orderId}/${cat}/${f.name}`);
          return data.publicUrl;
        });
        result[cat] = urls;
      }
      return result;
    } catch (e) {
      console.warn('fetchServerPhotos error', e);
      return null;
    }
  };

  // ===== Modal-internal countdown (start fresh every open) =====
  useEffect(() => {
    let t;
    if (deleteModalVisible) {
      setDeleteEnabled(false);
      setDeleteCountdown(5);
      let c = 5;
      t = setInterval(() => {
        c -= 1;
        setDeleteCountdown(c);
        if (c <= 0) {
          clearInterval(t);
          setDeleteEnabled(true);
        }
      }, 1000);
    }
    return () => clearInterval(t);
  }, [deleteModalVisible]);

  // ===== Fetch order + role + users =====
  useEffect(() => {
    const fetchData = async () => {
      // Instant paint from cache
      const cached = ORDER_CACHE.get(id);
      if (cached) {
        setOrder(cached);
        setLoading(false);
      }
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id || null;
        setUserId(uid);

        if (uid) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', uid)
            .single();
          setRole(profile?.role || null);
        }

        const { data: fetchedOrder, error } = await supabase
          .from('orders_read_masked')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;

        // cache latest
        ORDER_CACHE.set(id, fetchedOrder);

        // сразу показываем статус "В работе", если исполнитель впервые открыл заявку
        if (uid && fetchedOrder.status === 'Новый' && fetchedOrder.assigned_to === uid) {
          setOrder({ ...fetchedOrder, status: 'В работе' }); // моментально в UI
          supabase.from('orders').update({ status: 'В работе' }).eq('id', id); // тихий апдейт
        } else {
          setOrder(fetchedOrder);
        }

        // unblock UI immediately after first paint
        setLoading(false);

        InteractionManager.runAfterInteractions(async () => {
          try {
            // Server-only photos
            try {
              const fresh = await fetchServerPhotos(fetchedOrder.id);
              if (fresh) {
                setOrder((prev) => ({
                  ...prev,
                  contract_file: fresh.contract_file,
                  photo_before: fresh.photo_before,
                  photo_after: fresh.photo_after,
                  act_file: fresh.act_file,
                }));
              }
            } catch (e) {
              console.warn(e);
            }
            // Prefill edit form
            initialFormSnapshotRef.current = makeSnapshotFromOrder(fetchedOrder);
            const rawDigits = ((fetchedOrder.phone ?? fetchedOrder.phone_visible) || '').replace(
              /\D/g,
              '',
            );
            setTitle(fetchedOrder.title || '');
            setDescription(fetchedOrder.comment || '');
            setRegion(fetchedOrder.region || '');
            setCity(fetchedOrder.city || '');
            setStreet(fetchedOrder.street || '');
            setHouse(fetchedOrder.house || '');
            setCustomerName(fetchedOrder.fio || '');
            setPhone(rawDigits || '');
            setDepartureDate(fetchedOrder.datetime ? new Date(fetchedOrder.datetime) : null);
            setAssigneeId(fetchedOrder.assigned_to || null);
            setToFeed(!fetchedOrder.assigned_to);
            setUrgent(!!fetchedOrder.urgent);

            // финансы
            setAmount(
              fetchedOrder.price !== null && fetchedOrder.price !== undefined
                ? String(fetchedOrder.price)
                : '',
            );
            setGsm(
              fetchedOrder.fuel_cost !== null && fetchedOrder.fuel_cost !== undefined
                ? String(fetchedOrder.fuel_cost)
                : '',
            );
            // Executor name
            if (fetchedOrder.assigned_to) {
              const { data: executorProfile } = await supabase
                .from('profiles')
                .select('first_name, last_name')
                .eq('id', fetchedOrder.assigned_to)
                .single();
              if (executorProfile) {
                const full =
                  `${executorProfile.first_name || ''} ${executorProfile.last_name || ''}`.trim();
                EXECUTOR_NAME_CACHE.set(fetchedOrder.assigned_to, full);
                setExecutorName(full);
              } else {
                setExecutorName(null);
              }
            } else {
              // keep previous value to avoid flicker
            }
            // (removed duplicate 'Новый'→'В работе' block)
          } catch (e) {
            console.warn(e);
          }
        });
        // Prefill edit form
        initialFormSnapshotRef.current = makeSnapshotFromOrder(fetchedOrder);
        const rawDigits = ((fetchedOrder.phone ?? fetchedOrder.phone_visible) || '').replace(
          /\D/g,
          '',
        );
        setTitle(fetchedOrder.title || '');
        setDescription(fetchedOrder.comment || '');
        setRegion(fetchedOrder.region || '');
        setCity(fetchedOrder.city || '');
        setStreet(fetchedOrder.street || '');
        setHouse(fetchedOrder.house || '');
        setCustomerName(fetchedOrder.fio || '');
        setPhone(rawDigits || '');
        setDepartureDate(fetchedOrder.datetime ? new Date(fetchedOrder.datetime) : null);
        setAssigneeId(fetchedOrder.assigned_to || null);
        setToFeed(!fetchedOrder.assigned_to);
        setUrgent(!!fetchedOrder.urgent);

        // финансы
        setAmount(
          fetchedOrder.price !== null && fetchedOrder.price !== undefined
            ? String(fetchedOrder.price)
            : '',
        );
        setGsm(
          fetchedOrder.fuel_cost !== null && fetchedOrder.fuel_cost !== undefined
            ? String(fetchedOrder.fuel_cost)
            : '',
        );
        // Executor name
        if (fetchedOrder.assigned_to) {
          const { data: executorProfile } = await supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('id', fetchedOrder.assigned_to)
            .single();
          if (executorProfile) {
            const full =
              `${executorProfile.first_name || ''} ${executorProfile.last_name || ''}`.trim();
            EXECUTOR_NAME_CACHE.set(fetchedOrder.assigned_to, full);
            setExecutorName(full);
          } else {
            setExecutorName(null);
          }
        } else {
          // keep previous value to avoid flicker
        }
        // (removed duplicate 'Новый'→'В работе' block)
        // Executors list
        const { data: execList } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, role')
          .in('role', ['worker', 'dispatcher', 'admin'])
          .order('last_name', { ascending: true });
        setUsers(execList || []);
      } catch (e) {
        console.warn(e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, syncPhotosFromStorage]);

  const canEdit = () => role === 'admin' || role === 'dispatcher';

  // ===== Phone visibility rules =====
  const canSeePhone = () => Boolean(order?.phone_visible);

  const handlePhonePress = () => {
    if (canSeePhone() && order?.phone_visible)
      Linking.openURL(`tel:${formatPhoneE164(order.phone_visible)}`);
  };

  const handlePhoneLongPress = async () => {
    if (canSeePhone() && order?.phone_visible) {
      try {
        await Clipboard.setStringAsync(order.phone_visible);
        showToast('Телефон скопирован');
      } catch {}
    }
  };

  const openInYandex = () => {
    const fullAddress = [order?.region, order?.city, order?.street, order?.house]
      .filter(Boolean)
      .join(', ');
    if (!fullAddress) return;

    const url = `yandexnavi://map_search?text=${encodeURIComponent(fullAddress)}`;
    Linking.openURL(url).catch(() => {
      const fallback = `https://yandex.ru/maps/?text=${encodeURIComponent(fullAddress)}`;
      Linking.openURL(fallback);
    });
  };

  // ===== Photos =====
  const compressAndUpload = async (category) => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      if (!permissionResult.granted) {
        showToast('Нет доступа к камере');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({ quality: 1 });
      if (result.canceled) return;

      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );

      const fileName = `${Date.now()}.jpg`;
      const path = `orders/${order.id}/${category}/${fileName}`;

      const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const arrayBuffer = decode(base64);

      const { error: uploadError } = await supabase.storage
        .from('orders-photos')
        .upload(path, arrayBuffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'image/jpeg',
        });

      if (uploadError) {
        console.warn(uploadError);
        showToast('Ошибка загрузки фото');
        return;
      }

      const { data: publicData } = supabase.storage.from('orders-photos').getPublicUrl(path);
      const publicUrl = publicData.publicUrl;

      const updated = [...(order[category] || []), publicUrl];

      const { error: updateError } = await supabase
        .from('orders')
        .update({ [category]: updated })
        .eq('id', order.id);

      if (updateError) {
        console.warn(updateError);
        showToast('Ошибка сохранения ссылки');
        return;
      }

      setOrder({ ...order, [category]: updated });
      showToast('Фото загружено');
      await syncPhotosFromStorage();
    } catch (e) {
      console.warn(e);
      showToast('Ошибка загрузки');
    }
  };

  const removePhoto = async (category, index) => {
    const updated = [...(order[category] || [])];
    const [removed] = updated.splice(index, 1);

    const relativePath = removed?.split('/storage/v1/object/public/orders-photos/')[1];
    if (relativePath) {
      await supabase.storage.from('orders-photos').remove([relativePath]);
    }

    const { error } = await supabase
      .from('orders')
      .update({ [category]: updated })
      .eq('id', order.id);

    if (!error) {
      setOrder({ ...order, [category]: updated });
      showToast('Фото удалено');
      await syncPhotosFromStorage();
    } else {
      showToast('Ошибка удаления');
    }
  };

  // ===== Finish order =====
  const canFinishOrder = () => {
    const required = ['contract_file', 'photo_before', 'photo_after', 'act_file'];
    return required.every((cat) => Array.isArray(order[cat]) && order[cat].length > 0);
  };

  const handleFinishOrder = async () => {
    const missing = [];
    if (!Array.isArray(order.contract_file) || order.contract_file.length === 0)
      missing.push('фото договора');
    if (!Array.isArray(order.photo_before) || order.photo_before.length === 0)
      missing.push('фото ДО');
    if (!Array.isArray(order.photo_after) || order.photo_after.length === 0)
      missing.push('фото ПОСЛЕ');
    if (!Array.isArray(order.act_file) || order.act_file.length === 0)
      missing.push('акт выполненных работ');

    if (missing.length > 0) {
      showToast(`Добавьте: ${missing.join(', ')}`);
      return;
    }

    const { error } = await supabase
      .from('orders')
      .update({ status: 'Завершённая' })
      .eq('id', order.id);
    if (error) {
      showToast('Ошибка при завершении');
      return;
    }
    setOrder({ ...order, status: 'Завершённая' });
    showToast('Заявка завершена');
  };

  const onFinishPress = async () => {
    await handleFinishOrder();
  };
  // ===== Accept order from feed (worker takes free job) =====
  const onAcceptOrder = async () => {
    try {
      if (!order?.id) return;
      const { data, error } = await supabase.rpc('accept_order', { p_order_id: order.id });
      if (error) {
        showToast('Не удалось принять заявку');
        return;
      }
      if (data === true) {
        // Update local state: assign to me && set status
        const me = (users || []).find((u) => u.id === userId);
        setOrder((prev) => ({ ...(prev || {}), assigned_to: userId, status: 'В работе' }));
        setExecutorName(me ? `${me.first_name || ''} ${me.last_name || ''}`.trim() : null);
        setAssigneeId(userId);
        setToFeed(false);
        showToast('Заявка принята');
      } else {
        showToast('Упс, заявку уже принял кто-то другой');
      }
    } catch (e) {
      showToast('Ошибка сети');
    }
  };

  // ===== Save edits =====
  const handleSubmitEdit = async () => {
    if (!canEdit()) return;

    if (!title.trim()) return showWarning('Укажите название заявки');
    if (!region && !city && !street && !house) return showWarning('Укажите хотя бы часть адреса');
    if (!customerName.trim()) return showWarning('Укажите имя заказчика');
    if (!phone.trim()) return showWarning('Укажите номер телефона');
    if (!departureDate) return showWarning('Укажите дату выезда');
    if (!assigneeId && !toFeed) return showWarning('Выберите исполнителя или отправьте в ленту');

    const rawPhone = phone.replace(/\D/g, '');
    // Требования: 11 цифр, начинается на 7, второй символ 9 (мобильный)
    if (rawPhone.length !== 11 || rawPhone[0] !== '7' || rawPhone[1] !== '9') {
      return showWarning('Введите корректный номер телефона формата +7 (9__) ___-__-__');
    }

    const nextStatus = toFeed ? 'В ленте' : order.status === 'В ленте' ? 'В работе' : order.status;

    const payload = {
      title,
      comment: description,
      region,
      city,
      street,
      house,
      fio: customerName,
      phone: `+7${rawPhone.slice(1)}`,
      assigned_to: toFeed ? null : assigneeId,
      datetime: departureDate.toISOString(),
      status: nextStatus,
      urgent: urgent,
      price: parseMoney(amount),
      fuel_cost: parseMoney(gsm),
    };
    const { data, error } = await supabase
      .from('orders')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      showToast(error.message || 'Ошибка сохранения');
    } else {
      setOrder(data);
      // Sync all form fields from saved row so the editor re-opens with fresh values
      try {
        const rawDigitsSaved = (data.phone || '').replace(/\D/g, '');
        setTitle(data.title || '');
        setDescription(data.comment || '');
        setRegion(data.region || '');
        setCity(data.city || '');
        setStreet(data.street || '');
        setHouse(data.house || '');
        setCustomerName(data.fio || '');
        setPhone(rawDigitsSaved || '');
        setDepartureDate(data.datetime ? new Date(data.datetime) : null);
        setAssigneeId(data.assigned_to || null);
        setToFeed(!data.assigned_to);
        setUrgent(!!data.urgent);
        setAmount(data.price !== null && data.price !== undefined ? String(data.price) : '');
        setGsm(
          data.fuel_cost !== null && data.fuel_cost !== undefined ? String(data.fuel_cost) : '',
        );
      } catch {}
      initialFormSnapshotRef.current = makeSnapshotFromOrder(data);
      {
        const sel = (users || []).find((u) => u.id === data.assigned_to);
        if (sel) {
          setExecutorName(`${sel.first_name || ''} ${sel.last_name || ''}`.trim());
        } else if (data.assigned_to) {
          try {
            const fetchExec = async () => {
              const { data: exec } = await supabase
                .from('profiles')
                .select('first_name, last_name')
                .eq('id', data.assigned_to)
                .single();
              setExecutorName(
                exec ? `${exec.first_name || ''} ${exec.last_name || ''}`.trim() : null,
              );
            };
            fetchExec();
          } catch {}
        } else {
          // keep previous value to avoid flicker
        }
      }
      setEditMode(false);
      showToast('Сохранено');
    }
  };

  const updateStatus = async (next) => {
    if (!canEdit()) return;
    try {
      if (next === 'В ленте') {
        const { error } = await supabase
          .from('orders')
          .update({ status: 'В ленте', assigned_to: null })
          .eq('id', order.id);
        if (error) {
          showToast('Не удалось сменить статус');
          return;
        }
        setOrder((prev) => ({ ...(prev || {}), status: 'В ленте', assigned_to: null }));
        setAssigneeId(null);
        setExecutorName(null);
        setToFeed(true);
        setStatusModalVisible(false);
        showToast('Статус: В ленте');
        return;
      }

      const { error } = await supabase.from('orders').update({ status: next }).eq('id', order.id);
      if (error) {
        showToast('Не удалось сменить статус');
        return;
      }
      setOrder((prev) => ({ ...(prev || {}), status: next }));
      setStatusModalVisible(false);
      showToast('Статус обновлён');
    } catch (_e) {
      showToast('Ошибка сети');
    }
  };

  const confirmCancel = () => {
    setCancelVisible(false);
    if (order) {
      initialFormSnapshotRef.current = makeSnapshotFromOrder(order);
      const rawDigits = ((order.phone ?? order.phone_visible) || '').replace(/\D/g, '');
      setTitle(order.title || '');
      setDescription(order.comment || '');
      setRegion(order.region || '');
      setCity(order.city || '');
      setStreet(order.street || '');
      setHouse(order.house || '');
      setCustomerName(order.fio || '');
      setPhone(rawDigits || '');
      setDepartureDate(order.datetime ? new Date(order.datetime) : null);
      setAssigneeId(order.assigned_to || null);
      setToFeed(!order.assigned_to);
      setUrgent(!!order.urgent);

      // финансы
      setAmount(order.price !== null && order.price !== undefined ? String(order.price) : '');
      setGsm(
        order.fuel_cost !== null && order.fuel_cost !== undefined ? String(order.fuel_cost) : '',
      );
    }
    setEditMode(false);
  };

  // ===== Delete order =====
  const deleteOrderCompletely = async () => {
    try {
      const bucket = 'orders-photos';
      const categories = ['contract_file', 'photo_before', 'photo_after', 'act_file'];

      // 1) удалить всё из папок orders/{id}/{category}
      for (const cat of categories) {
        const listRes = await supabase.storage.from(bucket).list(`orders/${order.id}/${cat}`);
        const files = listRes?.data || [];
        if (files.length) {
          const paths = files.map((f) => `orders/${order.id}/${cat}/${f.name}`);
          await supabase.storage.from(bucket).remove(paths);
        }
      }

      // 2) удаление по URL (на случай расхождений путей)
      const allUrls = []
        .concat(order?.contract_file || [])
        .concat(order?.photo_before || [])
        .concat(order?.photo_after || [])
        .concat(order?.act_file || []);
      const relPaths = allUrls
        .map((u) => u?.split('/storage/v1/object/public/orders-photos/')[1])
        .filter(Boolean);
      if (relPaths.length) {
        await supabase.storage.from(bucket).remove(relPaths);
      }

      // 3) удалить запись
      const { data, error: delErr } = await supabase
        .from('orders')
        .delete()
        .eq('id', order.id)
        .select('id');

      if (delErr) {
        console.warn(delErr);
        showToast('Ошибка удаления');
        return;
      }
      if (!Array.isArray(data) || data.length === 0) {
        showToast('Удаление запрещено RLS или запись не найдена');
        return;
      }

      showToast('Заявка удалена');
      setDeleteModalVisible(false);
      if (navigation?.canGoBack?.()) navigation.goBack();
      else router.replace('/(tabs)/orders');
    } catch (e) {
      console.warn(e);
      showToast('Ошибка удаления');
    }
  };

  // ===== pretty view entrance animation (RN Animated) =====
  const viewFade = useRef(new RNAnimated.Value(0)).current;
  const viewTranslate = useRef(new RNAnimated.Value(8)).current;
  useEffect(() => {
    if (!loading) {
      RNAnimated.parallel([
        RNAnimated.timing(viewFade, {
          toValue: 1,
          duration: 260,
          delay: 40,
          useNativeDriver: true,
        }),
        RNAnimated.spring(viewTranslate, {
          toValue: 0,
          bounciness: 6,
          speed: 12,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [loading, viewFade, viewTranslate]);

  // ======== PHOTO VIEWER (fullscreen, Xiaomi-like) ========
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  // shared values for gesture
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const bgOpacity = useSharedValue(1);
  // refs для координации жестов
  const panRef = useRef(null);
  const tapRef = useRef(null);
  const pinchRef = useRef(null);

  // pinch (щипок) масштабирование
  const pinchHandler = useAnimatedGestureHandler({
    onActive: (event) => {
      // live scale during gesture
      scale.value = event.scale;
    },
    onEnd: () => {
      const next = Math.max(1, Math.min(3, scale.value));
      scale.value = withTiming(next, { duration: 150 });
      if (next === 1) {
        translateX.value = withTiming(0, { duration: 150 });
        translateY.value = withTiming(0, { duration: 150 });
      }
    },
  });

  const resetZoom = () => {
    scale.value = withTiming(1, { duration: 180 });
    translateX.value = withTiming(0, { duration: 180 });
    translateY.value = withTiming(0, { duration: 180 });
  };

  const closeViewer = () => {
    setViewerVisible(false);
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    bgOpacity.value = 1;
  };

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
  }));

  const onDoubleTap = (e) => {
    const { x, y } = e.nativeEvent;
    const nextScale = scale.value > 1 ? 1 : 2.5;
    if (nextScale === 1) {
      scale.value = withTiming(1, { duration: 180 });
      translateX.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(0, { duration: 180 });
    } else {
      // center the tapped point
      const dx = (SCREEN_W / 2 - x) * (nextScale - 1);
      const dy = (SCREEN_H / 2 - y) * (nextScale - 1);
      scale.value = withTiming(nextScale, { duration: 200 });
      translateX.value = withTiming(dx, { duration: 200 });
      translateY.value = withTiming(dy, { duration: 200 });
    }
  };

  const onVerticalPan = ({ nativeEvent }) => {
    if (scale.value > 1.01) return; // don't close while zoomed
    const { translationY, velocityY, state } = nativeEvent;
    // follow finger
    translateY.value = translationY;
    bgOpacity.value = 1 - Math.min(Math.abs(translationY) / 300, 0.8);

    if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
      const shouldClose = Math.abs(translationY) > 120 || Math.abs(velocityY) > 600;
      if (shouldClose) {
        bgOpacity.value = withTiming(0, { duration: 160 }, () => runOnJS(closeViewer)());
      } else {
        translateY.value = withSpring(0);
        bgOpacity.value = withTiming(1, { duration: 160 });
      }
    }
  };

  const openViewer = (photos, index) => {
    setViewerPhotos(photos);
    setViewerIndex(index);
    setViewerVisible(true);
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    bgOpacity.value = 1;
  };

  // sync zoom reset on index change
  useEffect(() => {
    resetZoom();
  }, [viewerIndex]);

  if (loading || !order) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const statusMeta = getStatusMeta(order.status);
  const selectedAssignee = (users || []).find((u) => u.id === assigneeId) || null;
  const isFree = !order.assigned_to;
  const canChangeStatus = canEdit() && order.status !== 'В ленте'; // ← добавили

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            ref={detailsScrollRef}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            {/* Top bar */}
            <View style={styles.topBar}>
              <Pressable
                onPress={() => (editMode ? requestCloseEdit() : goBack())}
                hitSlop={16}
                accessibilityRole="button"
                accessibilityLabel="Назад"
              >
                <Text style={styles.backText}>← Назад</Text>
              </Pressable>

              {canEdit() && !editMode && (
                <Pressable
                  onPress={() => {
                    initialFormSnapshotRef.current = makeSnapshotFromState();
                    setEditMode(true);
                  }}
                  hitSlop={10}
                  style={styles.editBtn}
                >
                  <Text style={styles.editBtnText}>Редактировать</Text>
                </Pressable>
              )}
            </View>

            {/* Header Card (title on its own line, meta chips below) */}
            <RNAnimated.View
              style={[
                styles.headerCard,
                { opacity: viewFade, transform: [{ translateY: viewTranslate }] },
              ]}
            >
              <Text style={styles.headerTitle} numberOfLines={1}>
                {order.title}
              </Text>

              <View style={styles.metaRow}>
                {order.urgent && (
                  <View style={styles.urgentPill}>
                    <Text style={styles.urgentPillText}>Срочная</Text>
                  </View>
                )}

                {canChangeStatus ? (
                  <Pressable
                    onPress={() => setStatusModalVisible(true)}
                    style={[styles.statusChip, { backgroundColor: statusMeta.bg }]}
                  >
                    <Text style={[styles.statusChipText, { color: statusMeta.fg }]}>
                      {order.status}
                    </Text>
                  </Pressable>
                ) : (
                  <View
                    style={[styles.statusChip, { backgroundColor: statusMeta.bg, opacity: 0.6 }]}
                  >
                    <Text style={[styles.statusChipText, { color: statusMeta.fg }]}>
                      {order.status}
                    </Text>
                  </View>
                )}
              </View>
            </RNAnimated.View>

            {/* Info Card (now includes Executor as a uniform row at the top) */}
            <RNAnimated.View
              style={[
                styles.cardBlock,
                { opacity: viewFade, transform: [{ translateY: viewTranslate }] },
              ]}
            >
              <View style={styles.row}>
                <Text style={styles.rowLabel}>👷 Исполнитель</Text>
                {deriveExecutorNameInstant(order) || executorName ? (
                  <Text style={styles.rowValue}>
                    {deriveExecutorNameInstant(order) || executorName}
                  </Text>
                ) : (
                  <Text style={[styles.rowValue, styles.muted]}>не назначен</Text>
                )}
              </View>
              <View style={styles.separator} />

              <View style={styles.row}>
                <Text style={styles.rowLabel}>🧑‍💼 Заказчик</Text>
                <Text style={styles.rowValue}>{order.fio || '—'}</Text>
              </View>
              <View style={styles.separator} />
              <Pressable style={styles.row} onPress={openInYandex}>
                <Text style={styles.rowLabel}>📍 Адрес</Text>
                <Text style={[styles.rowValue, styles.linkText]} numberOfLines={2}>
                  {[order.region, order.city, order.street, order.house]
                    .filter(Boolean)
                    .join(', ') || 'Адрес не указан'}
                </Text>
              </Pressable>
              <View style={styles.separator} />

              <Pressable
                style={styles.row}
                onPress={() => {
                  const dateStr = order.datetime
                    ? new Date(order.datetime).toISOString().slice(0, 10)
                    : undefined;
                  const assignee = order.assigned_to || undefined;
                  router.push({
                    pathname: '/(tabs)/calendar',
                    params: {
                      selectedDate: dateStr,
                      selectedUserId: assignee,
                      returnTo: `/order-details/${order.id}`,
                      returnParams: JSON.stringify({}),
                    },
                  });
                }}
              >
                <Text style={styles.rowLabel}>🗓️ Дата выезда</Text>
                <Text style={[styles.rowValue, styles.linkText]}>
                  {order.datetime
                    ? format(new Date(order.datetime), 'd MMMM yyyy', { locale: ru })
                    : 'не указана'}
                </Text>
              </Pressable>
              <View style={styles.separator} />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>📞 Телефон</Text>
                {canSeePhone() ? (
                  <Pressable onPress={handlePhonePress} onLongPress={handlePhoneLongPress}>
                    <Text style={[styles.rowValue, styles.linkText]}>
                      {formatPhoneDisplay(order.phone_visible)}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={[styles.rowValue, styles.muted]}>Скрыт</Text>
                )}
              </View>
              <View style={styles.separator} />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>💰 Сумма</Text>
                <Text style={styles.rowValue}>{formatMoney(order.price)}</Text>
              </View>
              <View style={styles.separator} />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>⛽ ГСМ</Text>
                <Text style={styles.rowValue}>{formatMoney(order.fuel_cost)}</Text>
              </View>
            </RNAnimated.View>

            {/* Description — отдельная карточка с разворотом */}
            <RNAnimated.View
              style={[
                styles.descCard,
                { opacity: viewFade, transform: [{ translateY: viewTranslate }] },
              ]}
            >
              <Text style={styles.descTitle}>📝 Описание</Text>
              <Text style={styles.descText} numberOfLines={descExpanded ? undefined : 4}>
                {order.comment?.trim() ? order.comment : '—'}
              </Text>
              {order.comment?.length > 120 && (
                <Pressable onPress={() => setDescExpanded((v) => !v)} hitSlop={8}>
                  <Text style={styles.descToggle}>
                    {descExpanded ? 'Свернуть' : 'Показать полностью'}
                  </Text>
                </Pressable>
              )}
            </RNAnimated.View>

            {/* Photos - one row with horizontal scroll per section */}
            {!isFree && renderPhotoRow('Фото договора', 'contract_file')}
            {!isFree && renderPhotoRow('Фото ДО', 'photo_before')}
            {!isFree && renderPhotoRow('Фото ПОСЛЕ', 'photo_after')}
            {!isFree && renderPhotoRow('Акт выполненных работ', 'act_file')}

            {/* Actions */}

            {/* Accept button for workers when order is free */}
            {!order.assigned_to &&
              (role === 'worker' || role === 'admin' || role === 'dispatcher') && (
                <Pressable
                  style={({ pressed }) => [styles.finishButton, pressed && { opacity: 0.9 }]}
                  onPress={onAcceptOrder}
                >
                  <Text style={styles.finishButtonText}>Принять заявку</Text>
                </Pressable>
              )}

            {order.status !== 'Завершённая' && !isFree && (
              <Pressable
                style={({ pressed }) => [
                  styles.finishButton,
                  !canFinishOrder() && { backgroundColor: '#d1d1d6' },
                  pressed && canFinishOrder() && { opacity: 0.9 },
                ]}
                onPress={onFinishPress}
              >
                <Text style={styles.finishButtonText}>Завершить заявку</Text>
              </Pressable>
            )}

            {(role === 'admin' || role === 'dispatcher') && (
              <Pressable
                onPress={() => setDeleteModalVisible(true)}
                style={({ pressed }) => [
                  styles.appButton,
                  styles.btnDestructive,
                  { marginTop: 12 },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={[styles.appButtonText, styles.btnDestructiveText]}>Удалить</Text>
              </Pressable>
            )}
          </ScrollView>
        </TouchableWithoutFeedback>

        {/* iOS toast banner */}
        {Platform.OS === 'ios' && !!bannerMessage && (
          <View pointerEvents="none" style={styles.banner}>
            <Text style={styles.bannerText}>{bannerMessage}</Text>
          </View>
        )}
      </SafeAreaView>

      {/* PHOTO VIEWER MODAL */}
      <Modal
        isVisible={viewerVisible}
        backdropOpacity={0} // we'll control opacity with blur + animated overlay
        style={{ margin: 0 }}
        onBackButtonPress={() => setViewerVisible(false)}
        useNativeDriver
      >
        <View style={StyleSheet.absoluteFill}>
          {/* Blurred backdrop of the underlying screen */}
          <BlurView intensity={50} tint="dark" style={[StyleSheet.absoluteFill]} />
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0,0,0,0.65)' },
              animatedBackdropStyle,
            ]}
          />

          {/* Header: counter + close */}
          <View style={styles.viewerTopBar}>
            <View style={styles.counterPill}>
              <Text style={styles.counterText}>
                {viewerPhotos.length ? `${viewerIndex + 1}/${viewerPhotos.length}` : ''}
              </Text>
            </View>
            <Pressable onPress={closeViewer} hitSlop={12} style={styles.closeBtn}>
              <Feather name="x" size={24} color="#fff" />
            </Pressable>
          </View>

          {/* Horizontal pager with small gap between photos */}
          {(() => {
            const GAP = 16; // зазор между фотографиями
            return (
              <RNAnimated.FlatList
                style={{ backgroundColor: '#000' }}
                data={viewerPhotos}
                keyExtractor={(item, idx) => String(idx)}
                horizontal
                pagingEnabled={false}
                snapToInterval={SCREEN_W + GAP}
                snapToAlignment="center"
                decelerationRate="normal"
                disableIntervalMomentum
                bounces={false}
                showsHorizontalScrollIndicator={false}
                getItemLayout={(_, index) => ({
                  length: SCREEN_W + GAP,
                  offset: (SCREEN_W + GAP) * index,
                  index,
                })}
                initialScrollIndex={viewerIndex}
                onMomentumScrollEnd={(e) => {
                  const x = e.nativeEvent.contentOffset.x;
                  const idx = Math.round(x / (SCREEN_W + GAP));
                  setViewerIndex(idx);
                }}
                renderItem={({ item }) => (
                  <View
                    style={{
                      width: SCREEN_W + GAP,
                      height: SCREEN_H,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#000',
                    }}
                  >
                    <PinchGestureHandler
                      ref={pinchRef}
                      onGestureEvent={pinchHandler}
                      onHandlerStateChange={pinchHandler}
                    >
                      <Animated.View style={[StyleSheet.absoluteFill]}>
                        <TapGestureHandler ref={tapRef} numberOfTaps={2} onActivated={onDoubleTap}>
                          <Animated.View style={[StyleSheet.absoluteFill]}>
                            <PanGestureHandler
                              ref={panRef}
                              onGestureEvent={onVerticalPan}
                              onHandlerStateChange={onVerticalPan}
                              activeOffsetY={[-12, 12]}
                              failOffsetX={[-8, 8]}
                            >
                              <Animated.View
                                style={[
                                  StyleSheet.absoluteFill,
                                  animatedImageStyle,
                                  {
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  },
                                ]}
                              >
                                <Image
                                  source={{ uri: item }}
                                  style={{
                                    width: SCREEN_W,
                                    height: SCREEN_H,
                                    resizeMode: 'contain',
                                    backgroundColor: '#000',
                                  }}
                                />
                              </Animated.View>
                            </PanGestureHandler>
                          </Animated.View>
                        </TapGestureHandler>
                      </Animated.View>
                    </PinchGestureHandler>
                  </View>
                )}
              />
            );
          })()}
        </View>
      </Modal>

      {/* EDIT SHEET MODAL (RESTORED) */}
      <Modal
        isVisible={editMode}
        onBackdropPress={requestCloseEdit}
        onBackButtonPress={requestCloseEdit}
        style={{ justifyContent: 'flex-end', margin: 0 }}
        useNativeDriver
        propagateSwipe
      >
        <View style={styles.editSheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Редактирование заявки</Text>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* SECTIONED FORM START (copied from create-order UI) */}
            <View style={styles.card}>
              <Text style={styles.section}>Основное</Text>
              <Text style={styles.label}>Название заявки *</Text>
              <TextInput
                style={styles.input}
                placeholder="Например: Обрезка деревьев"
                value={title}
                onChangeText={setTitle}
              />
              <Text style={styles.label}>Описание</Text>
              <TextInput
                style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
                placeholder="Подробности (если есть)"
                value={description}
                onChangeText={setDescription}
                multiline
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.section}>Адрес</Text>
              <Text style={styles.label}>Район или область</Text>
              <TextInput
                style={styles.input}
                placeholder="Например: Саратовская область"
                value={region}
                onChangeText={setRegion}
              />
              <Text style={styles.label}>Город или населённый пункт</Text>
              <TextInput
                style={styles.input}
                placeholder="Например: Энгельс"
                value={city}
                onChangeText={setCity}
              />
              <Text style={styles.label}>Улица или СНТ</Text>
              <TextInput
                style={styles.input}
                placeholder="Например: ул. Центральная"
                value={street}
                onChangeText={setStreet}
              />
              <Text style={styles.label}>Дом или участок</Text>
              <TextInput
                style={styles.input}
                placeholder="Например: 15А"
                value={house}
                onChangeText={setHouse}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.section}>Заказчик</Text>
              <Text style={styles.label}>Имя заказчика *</Text>
              <TextInput
                style={styles.input}
                placeholder="ФИО или просто имя"
                value={customerName}
                onChangeText={setCustomerName}
              />
              <Text style={styles.label}>Телефон *</Text>
              <MaskedTextInput
                mask="+7 (999) 999-99-99"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={(text, rawText) => setPhone(rawText)}
                style={styles.input}
                placeholder="+7 (___) ___-__-__"
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.section}>Планирование</Text>

              <View style={styles.toggleRow}>
                <Pressable
                  onPress={() => setUrgent((prev) => !prev)}
                  style={[styles.toggle, urgent && styles.toggleOn]}
                >
                  <View style={[styles.knob, urgent && styles.knobOn]} />
                </Pressable>
                <Text style={styles.toggleLabel}>Срочная</Text>
              </View>

              <Text style={styles.label}>Дата выезда *</Text>
              <View
                ref={(ref) => {
                  if (ref) dateFieldRef.current = findNodeHandle(ref);
                }}
              >
                <Pressable
                  ref={dateFieldRef}
                  onPress={() => {
                    setShowDatePicker(true);
                    setTimeout(scrollToDateField, 200);
                  }}
                  style={styles.selectInput}
                >
                  <Text style={styles.selectInputText}>
                    {departureDate
                      ? departureDate.toLocaleDateString('ru-RU', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                        })
                      : 'Выберите дату'}
                  </Text>
                  <AntDesign name="calendar" size={16} color="#666" />
                </Pressable>
              </View>

              {showDatePicker && (
                <DateTimePicker
                  value={departureDate || new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  minimumDate={new Date()}
                  onChange={(event, selected) => {
                    if (Platform.OS === 'android') setShowDatePicker(false);
                    if (selected) setDepartureDate(selected);
                  }}
                />
              )}

              <View style={[styles.toggleRow, { marginTop: 12 }]}>
                <Pressable
                  onPress={() =>
                    setToFeed((prev) => {
                      const nv = !prev;
                      if (nv) setAssigneeId(null);
                      return nv;
                    })
                  }
                  style={[styles.toggle, toFeed && styles.toggleOn]}
                >
                  <View style={[styles.knob, toFeed && styles.knobOn]} />
                </Pressable>
                <Text style={styles.toggleLabel}>Отправить в ленту</Text>
              </View>

              <Text style={styles.label}>Исполнитель *</Text>
              <Pressable
                onPress={() => setAssigneeModalVisible(true)}
                disabled={toFeed}
                style={[styles.selectInput, toFeed && { opacity: 0.5 }]}
              >
                <Text style={styles.selectInputText}>
                  {selectedAssignee
                    ? [selectedAssignee.first_name, selectedAssignee.last_name]
                        .filter(Boolean)
                        .join(' ')
                    : toFeed
                      ? 'В общую ленту'
                      : 'Выберите исполнителя...'}
                </Text>
                <AntDesign name="down" size={16} color="#666" />
              </Pressable>
            </View>
            {/* Финансы */}
            <View style={styles.card}>
              <Text style={styles.section}>Финансы</Text>
              <Text style={styles.label}>Сумма (₽)</Text>
              <TextInput
                style={styles.input}
                placeholder="Например: 5 000"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <Text style={styles.label}>ГСМ (₽)</Text>
              <TextInput
                style={styles.input}
                placeholder="Например: 700"
                keyboardType="numeric"
                value={gsm}
                onChangeText={setGsm}
              />
            </View>

            <View style={{ height: 16 }} />
            <AppButton label="Сохранить" onPress={handleSubmitEdit} />
            <View style={{ height: 12 }} />
            <AppButton label="Отмена" onPress={requestCloseEdit} type="secondary" />
            {/* SECTIONED FORM END */}
          </ScrollView>
        </View>
      </Modal>

      {/* Cancel confirm */}
      <Modal
        isVisible={cancelVisible}
        onBackdropPress={() => setCancelVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Отменить редактирование?</Text>
          <Text style={styles.modalText}>Все изменения будут потеряны. Вы уверены?</Text>
          <View style={styles.modalActions}>
            <AppButton label="Остаться" onPress={() => setCancelVisible(false)} />
            <AppButton label="Выйти" onPress={confirmCancel} type="destructive" />
          </View>
        </View>
      </Modal>

      {/* Assignee modal */}
      <Modal
        isVisible={assigneeModalVisible}
        onBackdropPress={() => setAssigneeModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Выберите исполнителя</Text>
          <Pressable
            onPress={() => {
              setToFeed(true);
              setAssigneeId(null);
              setAssigneeModalVisible(false);
            }}
            style={({ pressed }) => [styles.assigneeOption, pressed && { backgroundColor: '#eee' }]}
          >
            <Text style={styles.assigneeText}>В общую ленту</Text>
          </Pressable>
          <View style={{ height: 8 }} />
          {users.map((user) => (
            <Pressable
              key={user.id}
              onPress={() => {
                setAssigneeId(user.id);
                setToFeed(false);
                setAssigneeModalVisible(false);
              }}
              style={({ pressed }) => [
                styles.assigneeOption,
                pressed && { backgroundColor: '#eee' },
              ]}
            >
              <Text style={styles.assigneeText}>
                {[user.first_name, user.last_name].filter(Boolean).join(' ')}
              </Text>
            </Pressable>
          ))}
        </View>
      </Modal>

      {/* Status picker */}
      <Modal
        isVisible={statusModalVisible}
        onBackdropPress={() => setStatusModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Изменить статус</Text>
          {['В ленте', 'Новый', 'В работе', 'Завершённая'].map((s) => (
            <Pressable
              key={s}
              onPress={() => updateStatus(s)}
              style={({ pressed }) => [
                styles.assigneeOption,
                pressed && { backgroundColor: '#eee' },
              ]}
            >
              <Text style={styles.assigneeText}>
                {s} {order.status === s ? '✓' : ''}
              </Text>
            </Pressable>
          ))}
          <View style={[styles.modalActions, { marginTop: 8 }]}>
            <AppButton
              label="Отмена"
              onPress={() => setStatusModalVisible(false)}
              type="secondary"
            />
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
            <AppButton label="Ок" onPress={() => setWarningVisible(false)} />
          </View>
        </View>
      </Modal>

      {/* Delete confirm */}
      <Modal
        isVisible={deleteModalVisible}
        onBackButtonPress={() => setDeleteModalVisible(false)}
        onBackdropPress={() => setDeleteModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Удалить заявку?</Text>
          <Text style={styles.modalText}>
            Если удалить, все данные и фотографии будут стерты безвозвратно. Восстановить будет
            невозможно.
          </Text>
          <View style={styles.modalActions}>
            <AppButton label="Остаться" onPress={() => setDeleteModalVisible(false)} />
            <AppButton
              label={deleteEnabled ? 'Удалить' : `Удалить (${deleteCountdown})`}
              onPress={deleteOrderCompletely}
              disabled={!deleteEnabled}
              type="destructive"
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );

  // ===== helpers/render =====
  function renderPhotoRow(titleText, category) {
    const photos = order[category] || [];
    return (
      <View style={styles.photosBlock}>
        <View style={styles.photosHeader}>
          <Text style={styles.photosTitle}>{titleText}</Text>
          <Pressable
            style={({ pressed }) => [styles.addChip, pressed && { opacity: 0.8 }]}
            onPress={() => compressAndUpload(category)}
          >
            <Text style={styles.addChipText}>Добавить</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.hRow}
        >
          {photos.map((url, index) => (
            <View key={index} style={styles.hItem}>
              <Pressable
                style={({ pressed }) => [
                  styles.imagePressable,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => openViewer(photos, index)}
              >
                <Image source={{ uri: url }} style={styles.hImage} />
              </Pressable>
              <Pressable style={styles.deletePhoto} onPress={() => removePhoto(category, index)}>
                <Text style={styles.deleteText}>×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ===== pure helpers =====
  function formatPhoneE164(phone) {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('7')) {
      return `+7${digits.slice(1)}`;
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `+7${digits.slice(1)}`; // NOTE: not used
    }
    return (phone || '').replace(/\s+/g, '');
  }

  function formatPhoneDisplay(phone) {
    const digitsRaw = (phone || '').replace(/\D/g, '');
    // Normalize: treat leading '8' as '7' (Russia), expect 11 digits
    const digits =
      digitsRaw.length === 11 && digitsRaw[0] === '8' ? '7' + digitsRaw.slice(1) : digitsRaw;
    if (digits.length !== 11 || !digits.startsWith('7')) return phone || '';
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }

  function getStatusMeta(status) {
    switch (status) {
      case 'В ленте':
        return { bg: '#FFF7CC', fg: '#8A6D1F' };
      case 'Новый':
        return { bg: '#E8F0FE', fg: '#0A84FF' };
      case 'В работе':
        return { bg: '#E9F7EF', fg: '#34C759' };
      case 'Завершённая':
        return { bg: '#F2F2F7', fg: '#8E8E93' };
      default:
        return { bg: '#EFEFEF', fg: '#111' };
    }
  }
}
