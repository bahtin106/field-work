import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { decode } from 'base64-arraybuffer';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useNavigation, usePathname, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  findNodeHandle,
  Image,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  Animated as RNAnimated,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  TouchableWithoutFeedback,
  UIManager,
  View,
} from 'react-native';

import * as NavigationBar from 'expo-navigation-bar';

import {
  PanGestureHandler,
  PinchGestureHandler,
  State,
  TapGestureHandler,
} from 'react-native-gesture-handler';
import Modal from 'react-native-modal';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useCompanySettings } from '../../hooks/useCompanySettings';
import { fetchFormSchema } from '../../lib/settings';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../lib/workTypes';

import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import SectionHeader from '../../components/ui/SectionHeader';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { usePermissions } from '../../lib/permissions';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const ORDER_CACHE = (globalThis.ORDER_CACHE ||= new Map());
const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());

export default function OrderDetails() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { useDepartureTime } = useCompanySettings();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const base = useMemo(() => listItemStyles(theme), [theme]);

  const applyNavBar = useCallback(async () => {
    try {
      await NavigationBar.setButtonStyleAsync(theme.mode === 'dark' ? 'light' : 'dark');
    } catch {}
  }, [theme]);

  const pathname = usePathname();
  const id = useMemo(() => {
    const path = String(pathname || '');
    const clean = path.split('?')[0];
    const parts = clean.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }, [pathname]);

  const __params = useLocalSearchParams();
  const returnTo = useMemo(() => {
    try {
      return Reflect.has(__params, 'returnTo') ? String(__params.returnTo) : '/orders/my-orders';
    } catch {
      return '/orders/my-orders';
    }
  }, [__params]);

  const returnParams = useMemo(() => {
    try {
      return Reflect.has(__params, 'returnParams') ? JSON.parse(String(__params.returnParams)) : {};
    } catch {
      return {};
    }
  }, [__params]);

  const backTargetPath = returnTo === pathname ? '/orders/my-orders' : returnTo;
  const router = useRouter();
  const navigation = useNavigation();
  const isNavigatingRef = useRef(false);

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const hydratedRef = useRef(false);
  const [role, setRole] = useState(null);
  const [userId, setUserId] = useState(null);
  const [executorName, setExecutorName] = useState(null);
  const [bannerMessage, setBannerMessage] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [schemaEdit, setSchemaEdit] = useState({ context: 'edit', fields: [] });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [departureDate, setDepartureDate] = useState(null);
  const [assigneeId, setAssigneeId] = useState(null);
  const [users, setUsers] = useState([]);
  const [toFeed, setToFeed] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [departmentId, setDepartmentId] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  const [workTypeId, setWorkTypeId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [amount, setAmount] = useState('');
  const [gsm, setGsm] = useState('');
  const canEditFinances = role === 'admin' || role === 'dispatcher';
  const [cancelVisible, setCancelVisible] = useState(false);
  const [warningVisible, setWarningVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [assigneeModalVisible, setAssigneeModalVisible] = useState(false);
  const [departmentModalVisible, setDepartmentModalVisible] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(5);
  const [deleteEnabled, setDeleteEnabled] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);

  const initialFormSnapshotRef = useRef('');
  const detailsScrollRef = useRef(null);
  const dateFieldRef = useRef(null);
  const viewFade = useRef(new RNAnimated.Value(1)).current;
  const viewTranslate = useRef(new RNAnimated.Value(0)).current;
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const bgOpacity = useSharedValue(1);
  const panRef = useRef(null);
  const tapRef = useRef(null);
  const pinchRef = useRef(null);

  const showToast = useCallback((msg) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
    } else {
      setBannerMessage(msg);
      setTimeout(() => setBannerMessage(''), 2000);
    }
  }, []);

  const deriveExecutorNameInstant = useCallback((o) => {
    if (!o) return null;
    if (o.assigned_to && EXECUTOR_NAME_CACHE.has(o.assigned_to))
      return EXECUTOR_NAME_CACHE.get(o.assigned_to);

    const fromFields = [
      o.assigned_to_name,
      o.executor_name,
      o.assignee_name,
      o.worker_name,
      o.assigned_name,
    ].find((v) => typeof v === 'string' && v.trim());
    if (fromFields) return String(fromFields).trim();

    const join = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      const s =
        [obj.last_name, obj.first_name, obj.middle_name].filter(Boolean).join(' ').trim() ||
        obj.full_name ||
        obj.name;
      return s ? String(s).trim() : null;
    };

    return join(o.assigned_to_profile) || join(o.executor_profile) || join(o.assignee_profile);
  }, []);

  const getValueForField = useCallback(
    (key) => {
      switch (key) {
        case 'title':
          return (title || '').trim();
        case 'comment':
          return (description || '').trim();
        case 'fio':
          return (customerName || '').trim();
        case 'customer_name':
          return (customerName || '').trim();
        case 'phone':
          return (phone || '').trim();
        case 'region':
          return (region || '').trim();
        case 'city':
          return (city || '').trim();
        case 'street':
          return (street || '').trim();
        case 'house':
          return (house || '').trim();
        case 'datetime':
          return departureDate;
        case 'assigned_to':
          return toFeed ? null : assigneeId;
        case 'price':
          return canEditFinances ? amount : amount || '';
        case 'fuel_cost':
          return canEditFinances ? gsm : gsm || '';
        case 'department_id':
          return departmentId;
        default:
          return null;
      }
    },
    [
      title,
      description,
      customerName,
      phone,
      region,
      city,
      street,
      house,
      departureDate,
      assigneeId,
      toFeed,
      amount,
      gsm,
      canEditFinances,
      departmentId,
    ],
  );

  const getField = useCallback(
    (key) => {
      const arr = schemaEdit?.fields || [];
      const found = arr.find((f) => f.field_key === key);
      if (found) return found;
      if (
        key === 'datetime' ||
        key === 'assigned_to' ||
        key === 'status' ||
        key === 'department_id'
      )
        return { field_key: key };
      if (arr.length === 0) return { field_key: key };
      return null;
    },
    [schemaEdit],
  );

  const hasField = useCallback((key) => !!getField(key), [getField]);

  const validateRequiredBySchemaEdit = useCallback(() => {
    try {
      const arr = (schemaEdit?.fields || []).filter((f) => f?.required);
      if (!arr.length) return { ok: true };

      const missing = [];
      for (const f of arr) {
        const k = f.field_key;
        const val = getValueForField(k);

        if (k === 'phone') {
          const raw = String(val || '')
            .replace(/\D/g, '')
            .replace(/^8(\d{10})$/, '7$1');
          if (!(raw.length === 11 && raw.startsWith('7'))) missing.push(f.label || k);
        } else if (k === 'datetime') {
          if (!val) missing.push(f.label || k);
        } else if (k === 'assigned_to') {
          if (!toFeed && !val) missing.push(f.label || k);
        } else if (val === null || val === undefined || String(val).trim() === '') {
          missing.push(f.label || k);
        }
      }

      return missing.length
        ? { ok: false, msg: `Заполните обязательные поля: ${missing.join(', ')}` }
        : { ok: true };
    } catch {
      return { ok: true };
    }
  }, [schemaEdit, getValueForField, toFeed]);

  const parseMoney = useCallback((s) => {
    const v = String(s ?? '')
      .replace(/[^0-9.,]/g, '')
      .replace(',', '.');
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }, []);

  const formatMoney = useCallback((v) => {
    if (v === null || v === undefined || v === '') return '—';
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    if (!Number.isFinite(n)) return '—';
    const parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${parts[0]}.${parts[1]} ₽`;
  }, []);

  const makeSnapshotFromOrder = useCallback((o) => {
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
      department_id: o.department_id || null,
      price: o.price ?? null,
      fuel_cost: o.fuel_cost ?? null,
    });
  }, []);

  const makeSnapshotFromState = useCallback(() => {
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
      department_id: departmentId || null,
      ...(canEditFinances ? { price: parseMoney(amount), fuel_cost: parseMoney(gsm) } : {}),
    });
  }, [
    title,
    description,
    region,
    city,
    street,
    house,
    customerName,
    phone,
    departureDate,
    assigneeId,
    departmentId,
    canEditFinances,
    amount,
    gsm,
    parseMoney,
  ]);

  const formIsDirty = useCallback(() => {
    if (!order) return false;
    try {
      const current = makeSnapshotFromState();
      const initial = initialFormSnapshotRef.current || makeSnapshotFromOrder(order);
      return current !== initial;
    } catch {
      return false;
    }
  }, [order, makeSnapshotFromState, makeSnapshotFromOrder]);

  const syncPhotosFromStorage = useCallback(async () => {
    if (!order?.id) return;
    try {
      const bucket = 'orders-photos';
      const cats = ['contract_file', 'photo_before', 'photo_after', 'act_file'];
      const next = { ...order };

      for (const cat of cats) {
        const folder = `orders/${order.id}/${cat}`;
        const { data: files } = await supabase.storage.from(bucket).list(folder);
        const urls = (files || []).map((f) => {
          const path = `${folder}/${f.name}`;
          const { data } = supabase.storage.from(bucket).getPublicUrl(path);
          return data.publicUrl;
        });
        next[cat] = urls;
      }
      setOrder(next);
    } catch (e) {
      console.warn('Sync photos error:', e);
    }
  }, [order?.id]);

  const fetchServerPhotos = useCallback(async (orderId) => {
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
      console.warn('Fetch server photos error:', e);
      return null;
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    const cached = ORDER_CACHE.get(id);
    if (cached) {
      setOrder(cached);
      hydratedRef.current = true;
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
        .from('orders_secure')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      if (typeof fetchedOrder.department_id === 'undefined') {
        try {
          const { data: depRow } = await supabase
            .from('orders')
            .select('department_id')
            .eq('id', id)
            .single();
          if (depRow) {
            fetchedOrder.department_id = depRow.department_id || null;
          }
        } catch {}
      }

      if (typeof fetchedOrder.work_type_id === 'undefined' || fetchedOrder.work_type_id === null) {
        try {
          const { data: wtRow } = await supabase
            .from('orders')
            .select('work_type_id')
            .eq('id', id)
            .single();
          if (wtRow) {
            fetchedOrder.work_type_id = wtRow.work_type_id ?? null;
          }
        } catch {}
      }

      // ORDER_CACHE.set(id, fetchedOrder); // удалено: кэш обновим после выбора итогового заказа

      // ПЕРЕДЕЛАНО: сохраняем статус "В работе" в БД и перезагружаем заявку
      if (uid && fetchedOrder.status === 'Новый' && fetchedOrder.assigned_to === uid) {
        try {
          const { error: updateError } = await supabase
            .from('orders')
            .update({ status: 'В работе' })
            .eq('id', id);
          if (updateError) throw updateError;

          const { data: refreshed, error: refErr } = await supabase
            .from('orders_secure')
            .select('*')
            .eq('id', id)
            .single();

          const nextOrder = refErr ? { ...fetchedOrder, status: 'В работе' } : refreshed;
          ORDER_CACHE.set(id, nextOrder);
          setOrder(nextOrder);
        } catch (e) {
          console.warn('Persist status error:', e);
          ORDER_CACHE.set(id, fetchedOrder);
          setOrder(fetchedOrder);
        }
      } else {
        ORDER_CACHE.set(id, fetchedOrder);
        setOrder(fetchedOrder);
      }

      setLoading(false);

      InteractionManager.runAfterInteractions(async () => {
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

          initialFormSnapshotRef.current = makeSnapshotFromOrder(fetchedOrder);
          const rawDigits = (
            (fetchedOrder.phone ??
              fetchedOrder.customer_phone_visible ??
              fetchedOrder.phone_visible) ||
            ''
          ).replace(/\D/g, '');

          setTitle(fetchedOrder.title || '');
          setDescription(fetchedOrder.comment || '');
          setRegion(fetchedOrder.region || '');
          setCity(fetchedOrder.city || '');
          setStreet(fetchedOrder.street || '');
          setHouse(fetchedOrder.house || '');
          setCustomerName(fetchedOrder.fio || fetchedOrder.customer_name || '');
          setPhone(rawDigits || '');
          setDepartureDate(fetchedOrder.datetime ? new Date(fetchedOrder.datetime) : null);
          setAssigneeId(fetchedOrder.assigned_to || null);
          setToFeed(!fetchedOrder.assigned_to);
          setUrgent(!!fetchedOrder.urgent);
          setDepartmentId(fetchedOrder.department_id || null);
          setWorkTypeId(fetchedOrder.work_type_id || null);
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
          }
        } catch (e) {
          console.warn('Interaction error:', e);
        }
      });

      const { data: execList } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .in('role', ['worker', 'dispatcher', 'admin'])
        .order('last_name', { ascending: true });
      setUsers(execList || []);

      const { data: deptList } = await supabase
        .from('departments')
        .select('id, name')
        .order('name', { ascending: true });
      setDepartments(deptList || []);
    } catch (e) {
      console.warn('Fetch data error:', e);
      setLoading(false);
    }
  }, [id, fetchServerPhotos, makeSnapshotFromOrder]);

  const canEdit = useCallback(() => has('canEditOrders'), [has]);

  const handlePhonePress = useCallback(() => {
    const p = order?.customer_phone_visible;
    if (p) Linking.openURL(`tel:${formatPhoneE164(p)}`);
  }, [order]);

  const handlePhoneLongPress = useCallback(async () => {
    const p = order?.customer_phone_visible;
    if (!p) return;
    try {
      await Clipboard.setStringAsync(p);
      showToast(t('order_toast_phone_copied'));
    } catch {}
  }, [order, showToast, t]);

  const openInYandex = useCallback(() => {
    const fullAddress = [order?.region, order?.city, order?.street, order?.house]
      .filter(Boolean)
      .join(', ');
    if (!fullAddress) return;

    const url = `yandexnavi://map_search?text=${encodeURIComponent(fullAddress)}`;
    Linking.openURL(url).catch(() => {
      const fallback = `https://yandex.ru/maps/?text=${encodeURIComponent(fullAddress)}`;
      Linking.openURL(fallback);
    });
  }, [order]);

  const compressAndUpload = useCallback(
    async (category) => {
      try {
        const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
        if (!permissionResult.granted) {
          showToast(t('order_no_camera_permission'));
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
          showToast('Ошибка сохранения ссылки');
          return;
        }

        setOrder({ ...order, [category]: updated });
        showToast(t('order_toast_photo_uploaded'));
        await syncPhotosFromStorage();
      } catch (e) {
        console.warn('Upload error:', e);
        showToast(t('order_toast_upload_error'));
      }
    },
    [order, showToast, syncPhotosFromStorage, t],
  );

  const removePhoto = useCallback(
    async (category, index) => {
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
        showToast(t('order_toast_photo_deleted'));
        await syncPhotosFromStorage();
      } else {
        showToast(t('order_toast_delete_error'));
      }
    },
    [order, showToast, syncPhotosFromStorage, t],
  );

  const canFinishOrder = useCallback(() => {
    const required = ['contract_file', 'photo_before', 'photo_after', 'act_file'];
    return required.every((cat) => Array.isArray(order[cat]) && order[cat].length > 0);
  }, [order]);

  const handleFinishOrder = useCallback(async () => {
    const missing = [];
    if (!Array.isArray(order.contract_file) || order.contract_file.length === 0)
      missing.push(t('order_missing_contract'));
    if (!Array.isArray(order.photo_before) || order.photo_before.length === 0)
      missing.push(t('order_missing_photo_before'));
    if (!Array.isArray(order.photo_after) || order.photo_after.length === 0)
      missing.push(t('order_missing_photo_after'));
    if (!Array.isArray(order.act_file) || order.act_file.length === 0)
      missing.push(t('order_missing_act'));

    if (missing.length > 0) {
      showToast(
        t('order_toast_add_photos', `Добавьте: ${missing.join(', ')}`).replace(
          '{items}',
          missing.join(', '),
        ),
      );
      return;
    }

    const { error } = await supabase
      .from('orders')
      .update({ status: 'Завершённая' })
      .eq('id', order.id);

    if (error) {
      showToast(t('order_toast_finish_error'));
      return;
    }

    setOrder({ ...order, status: t('order_status_completed') });
    showToast(t('order_toast_order_finished'));
  }, [order, showToast, t]);

  const onFinishPress = useCallback(() => handleFinishOrder(), [handleFinishOrder]);

  const onAcceptOrder = useCallback(async () => {
    try {
      if (!order?.id) return;
      const { data, error } = await supabase.rpc('accept_order', { p_order_id: order.id });
      if (error) {
        showToast('Не удалось принять заявку');
        return;
      }
      if (data === true) {
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
      showToast(t('order_toast_network_error'));
    }
  }, [order, users, userId, showToast, t]);

  const handleSubmitEdit = useCallback(async () => {
    const reqCheck = validateRequiredBySchemaEdit();
    if (!reqCheck.ok) {
      showWarning(reqCheck.msg);
      return;
    }
    if (!canEdit()) return;

    if (!title.trim()) return showWarning(t('order_validation_title_required'));
    if (!region && !city && !street && !house)
      return showWarning(t('order_validation_address_required'));
    if (!customerName.trim()) return showWarning(t('order_validation_customer_required'));
    if (!phone.trim()) return showWarning(t('order_validation_phone_required'));
    if (!departureDate) return showWarning(t('order_validation_date_required'));
    if (!assigneeId && !toFeed) return showWarning(t('order_validation_executor_required'));

    const rawPhone = phone.replace(/\D/g, '');
    if (rawPhone.length !== 11 || rawPhone[0] !== '7' || rawPhone[1] !== '9') {
      return showWarning(t('order_validation_phone_format'));
    }

    const nextStatus = toFeed
      ? t('order_status_in_feed')
      : order.status === t('order_status_in_feed')
        ? t('order_status_in_progress')
        : order.status;

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
      department_id: departmentId || null,
      ...(canEditFinances ? { price: parseMoney(amount), fuel_cost: parseMoney(gsm) } : {}),
      ...(useWorkTypes ? { work_type_id: workTypeId } : {}),
    };

    const targetId = order?.id ?? id;
    if (!targetId) {
      showToast(t('order_validation_no_order_id'));
      return;
    }

    const { data, error } = await supabase
      .from('orders')
      .update(payload)
      .eq('id', targetId)
      .select()
      .single();

    if (error) {
      showToast(error.message || t('order_save_error'));
    } else {
      setOrder(data);
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
      setGsm(data.fuel_cost !== null && data.fuel_cost !== undefined ? String(data.fuel_cost) : '');
      setDepartmentId(data.department_id || null);
      setWorkTypeId(data.work_type_id || null);

      initialFormSnapshotRef.current = makeSnapshotFromOrder(data);

      if (data.assigned_to) {
        const sel = (users || []).find((u) => u.id === data.assigned_to);
        if (sel) {
          setExecutorName(`${sel.first_name || ''} ${sel.last_name || ''}`.trim());
        } else {
          try {
            const { data: exec } = await supabase
              .from('profiles')
              .select('first_name, last_name')
              .eq('id', data.assigned_to)
              .single();
            setExecutorName(
              exec ? `${exec.first_name || ''} ${exec.last_name || ''}`.trim() : null,
            );
          } catch {}
        }
      }

      setEditMode(false);
      showToast(t('order_toast_saved'));
    }
  }, [
    validateRequiredBySchemaEdit,
    canEdit,
    title,
    region,
    city,
    street,
    house,
    customerName,
    phone,
    departureDate,
    assigneeId,
    toFeed,
    order,
    urgent,
    departmentId,
    canEditFinances,
    amount,
    gsm,
    parseMoney,
    useWorkTypes,
    workTypeId,
    id,
    users,
    makeSnapshotFromOrder,
    showToast,
    showWarning,
    t,
  ]);

  const updateStatus = useCallback(
    async (next) => {
      if (!canEdit()) return;
      try {
        if (next === t('order_status_in_feed')) {
          const { error } = await supabase
            .from('orders')
            .update({ status: t('order_status_in_feed'), assigned_to: null })
            .eq('id', order.id);
          if (error) {
            showToast(t('order_toast_status_updated'));
            return;
          }
          setOrder((prev) => ({
            ...(prev || {}),
            status: t('order_status_in_feed'),
            assigned_to: null,
          }));
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
        showToast(t('order_toast_status_updated'));
      } catch {
        showToast(t('order_toast_network_error'));
      }
    },
    [canEdit, order, showToast, t],
  );

  const confirmCancel = useCallback(() => {
    setEditMode(false);
    setCancelVisible(false);
    setTimeout(applyNavBar, 10);

    if (order) {
      initialFormSnapshotRef.current = makeSnapshotFromOrder(order);
      const rawDigits = (
        (order.phone ?? order.customer_phone_visible ?? order.phone_visible) ||
        ''
      ).replace(/\D/g, '');

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
      setDepartmentId(order.department_id || null);
      setWorkTypeId(order.work_type_id || null);
      setAmount(order.price !== null && order.price !== undefined ? String(order.price) : '');
      setGsm(
        order.fuel_cost !== null && order.fuel_cost !== undefined ? String(order.fuel_cost) : '',
      );
    }
  }, [order, makeSnapshotFromOrder, applyNavBar]);

  const deleteOrderCompletely = useCallback(async () => {
    try {
      const bucket = 'orders-photos';
      const categories = ['contract_file', 'photo_before', 'photo_after', 'act_file'];

      for (const cat of categories) {
        const listRes = await supabase.storage.from(bucket).list(`orders/${order.id}/${cat}`);
        const files = listRes?.data || [];
        if (files.length) {
          const paths = files.map((f) => `orders/${order.id}/${cat}/${f.name}`);
          await supabase.storage.from(bucket).remove(paths);
        }
      }

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

      const { data, error: delErr } = await supabase
        .from('orders')
        .delete()
        .eq('id', order.id)
        .select('id');

      if (delErr) {
        showToast('Ошибка удаления');
        return;
      }
      if (!Array.isArray(data) || data.length === 0) {
        showToast('Удаление запрещено RLS или запись не найдена');
        return;
      }

      showToast(t('order_toast_order_deleted'));
      setDeleteModalVisible(false);
      if (navigation?.canGoBack?.()) navigation.goBack();
      else router.replace('/orders/orders');
    } catch (e) {
      console.warn('Delete error:', e);
      showToast(t('order_toast_delete_error'));
    }
  }, [order, navigation, router, showToast, t]);

  const goBack = useCallback(() => {
    if (editMode) {
      requestCloseEdit();
      return;
    }

    if (returnTo && !isNavigatingRef.current && backTargetPath !== pathname) {
      isNavigatingRef.current = true;
      router.replace({ pathname: backTargetPath, params: returnParams });
      return;
    }

    if (navigation?.canGoBack?.()) {
      navigation.goBack();
    } else {
      router.replace('/orders/my-orders');
    }
  }, [editMode, returnTo, backTargetPath, pathname, router, returnParams, navigation]);

  const requestCloseEdit = useCallback(() => {
    if (formIsDirty()) {
      setCancelVisible(true);
    } else {
      setEditMode(false);
    }
  }, [formIsDirty]);

  const showWarning = useCallback((message) => {
    setWarningMessage(message);
    setWarningVisible(true);
  }, []);

  const scrollToDateField = useCallback(() => {
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
  }, []);

  const resetZoom = useCallback(() => {
    scale.value = withTiming(1, { duration: 180 });
    translateX.value = withTiming(0, { duration: 180 });
    translateY.value = withTiming(0, { duration: 180 });
  }, [scale, translateX, translateY]);

  const closeViewer = useCallback(() => {
    setViewerVisible(false);
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    bgOpacity.value = 1;
  }, [scale, translateX, translateY, bgOpacity]);

  const onDoubleTap = useCallback(
    (e) => {
      const { x, y } = e.nativeEvent;
      const nextScale = scale.value > 1 ? 1 : 2.5;
      if (nextScale === 1) {
        scale.value = withTiming(1, { duration: 180 });
        translateX.value = withTiming(0, { duration: 180 });
        translateY.value = withTiming(0, { duration: 180 });
      } else {
        const dx = (SCREEN_W / 2 - x) * (nextScale - 1);
        const dy = (SCREEN_H / 2 - y) * (nextScale - 1);
        scale.value = withTiming(nextScale, { duration: 200 });
        translateX.value = withTiming(dx, { duration: 200 });
        translateY.value = withTiming(dy, { duration: 200 });
      }
    },
    [scale, translateX, translateY],
  );

  const onVerticalPan = useCallback(
    ({ nativeEvent }) => {
      if (scale.value > 1.01) return;
      const { translationY, velocityY, state } = nativeEvent;
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
    },
    [scale, bgOpacity, translateY, closeViewer],
  );

  const openViewer = useCallback(
    (photos, index) => {
      setViewerPhotos(photos);
      setViewerIndex(index);
      setViewerVisible(true);
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      bgOpacity.value = 1;
    },
    [scale, translateX, translateY, bgOpacity],
  );

  const onPinchGestureEvent = useCallback(
    (e) => {
      const s = e?.nativeEvent?.scale ?? 1;
      scale.value = s;
    },
    [scale],
  );

  const onPinchStateChange = useCallback(
    (e) => {
      const st = e?.nativeEvent?.state;
      if (st === State.END || st === State.CANCELLED || st === State.FAILED) {
        const next = Math.max(1, Math.min(3, scale.value));
        scale.value = withTiming(next, { duration: 150 });
        if (next === 1) {
          translateX.value = withTiming(0, { duration: 150 });
          translateY.value = withTiming(0, { duration: 150 });
        }
      }
    },
    [scale, translateX, translateY],
  );

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

  const formatPhoneE164 = useCallback((phone) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('7')) {
      return `+7${digits.slice(1)}`;
    }
    if (digits.length === 11 && digits.startsWith('8')) {
      return `+7${digits.slice(1)}`;
    }
    return (phone || '').replace(/\s+/g, '');
  }, []);

  const formatPhoneDisplay = useCallback((phone) => {
    const digitsRaw = (phone || '').replace(/\D/g, '');
    const digits =
      digitsRaw.length === 11 && digitsRaw[0] === '8' ? '7' + digitsRaw.slice(1) : digitsRaw;
    if (digits.length !== 11 || !digits.startsWith('7')) return phone || '';
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }, []);

  const getStatusMeta = useCallback(
    (status) => {
      const statusSet = theme?.colors?.status || theme?._raw?.colors?.status;
      switch (status) {
        case 'В ленте': {
          const c = statusSet?.feed;
          return {
            bg: c?.bg ?? theme.colors.inputBg ?? theme.colors.surface,
            fg: c?.fg ?? theme.colors.warning ?? theme.colors.primary,
          };
        }
        case 'Новый': {
          const c = statusSet?.new;
          return {
            bg: c?.bg ?? theme.colors.inputBg ?? theme.colors.surface,
            fg: c?.fg ?? theme.colors.primary,
          };
        }
        case 'В работе': {
          const c = statusSet?.progress;
          return {
            bg: c?.bg ?? theme.colors.inputBg ?? theme.colors.surface,
            fg: c?.fg ?? theme.colors.success ?? theme.colors.primary,
          };
        }
        case 'Завершённая': {
          const c = statusSet?.done;
          return {
            bg: c?.bg ?? theme.colors.surface,
            fg: c?.fg ?? theme.colors.textSecondary,
          };
        }
        default:
          return { bg: theme.colors.surface, fg: theme.colors.text };
      }
    },
    [theme],
  );

  const renderPhotoRow = useCallback(
    (titleText, category) => {
      const photos = order[category] || [];
      return (
        <View>
          <SectionHeader topSpacing="lg">{titleText}</SectionHeader>
          <Card>
            <Pressable
              style={({ pressed }) => [
                {
                  backgroundColor:
                    theme.colors.chipBg || theme.colors.inputBg || theme.colors.surface,
                  paddingVertical: theme.spacing?.xs || 6,
                  paddingHorizontal: theme.spacing?.md || 12,
                  borderRadius: theme.radii?.pill || 999,
                  alignSelf: 'flex-start',
                  marginBottom: theme.spacing?.sm || 8,
                },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => compressAndUpload(category)}
            >
              <Text
                style={{
                  color: theme.colors.primary,
                  fontWeight: theme.typography?.weight?.semibold || '600',
                  fontSize: theme.typography?.sizes?.xs || 13,
                }}
              >
                {t('order_details_add_photo')}
              </Text>
            </Pressable>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: theme.spacing?.sm || 8 }}
            >
              {photos.map((url, index) => (
                <View
                  key={index}
                  style={{ position: 'relative', marginRight: theme.spacing?.md || 10 }}
                >
                  <Pressable
                    style={({ pressed }) => [
                      {
                        borderRadius: theme.radii?.lg || 12,
                        overflow: 'hidden',
                        ...(Platform.OS === 'ios'
                          ? theme.shadows?.card?.ios || {}
                          : theme.shadows?.card?.android || {}),
                      },
                      pressed && { transform: [{ scale: 0.98 }] },
                    ]}
                    onPress={() => openViewer(photos, index)}
                  >
                    <Image
                      source={{ uri: url }}
                      style={{ width: 116, height: 116, borderRadius: theme.radii?.lg || 12 }}
                    />
                  </Pressable>
                  <Pressable
                    style={{
                      position: 'absolute',
                      top: theme.spacing?.xs || 4,
                      right: theme.spacing?.xs || 4,
                      backgroundColor: theme.colors.danger,
                      width: 24,
                      height: 24,
                      borderRadius: theme.radii?.lg || 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 5,
                    }}
                    onPress={() => removePhoto(category, index)}
                  >
                    <Text
                      style={{
                        color: theme.colors.onPrimary,
                        fontWeight: theme.typography?.weight?.bold || '700',
                        fontSize: theme.typography?.sizes?.md || 16,
                        lineHeight: 18,
                      }}
                    >
                      ×
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </Card>
        </View>
      );
    },
    [order, compressAndUpload, openViewer, removePhoto, t, theme],
  );

  useEffect(() => {
    applyNavBar();
  }, [applyNavBar]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchFormSchema('edit');
        if (mounted && data && Array.isArray(data.fields)) setSchemaEdit(data);
      } catch (e) {
        // silent fallback
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    fetchData();
  }, [id, fetchData]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cid = await getMyCompanyId();
        if (!alive) return;
        setCompanyId(cid);
        if (cid) {
          const { useWorkTypes: flag, types } = await fetchWorkTypes(cid);
          if (!alive) return;
          setUseWorkTypesFlag(!!flag);
          setWorkTypes(types || []);
        }
      } catch (e) {
        console.warn('workTypes bootstrap', e?.message || e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      RNAnimated.parallel([
        RNAnimated.timing(viewFade, {
          toValue: 1,
          duration: 260,
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
  }, [editMode, requestCloseEdit]);

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      const actionType = e?.data?.action?.type;
      if (
        actionType &&
        actionType !== 'GO_BACK' &&
        actionType !== 'POP' &&
        actionType !== 'POP_TO_TOP'
      ) {
        // allow explicit navigations (e.g., bottom bar tabs using router.replace)
        return;
      }

      if (returnTo && !isNavigatingRef.current && backTargetPath !== pathname) {
        e.preventDefault();
        isNavigatingRef.current = true;
        router.replace({ pathname: backTargetPath, params: returnParams });
      }
    });
    return sub;
  }, [
    navigation,
    editMode,
    returnTo,
    backTargetPath,
    pathname,
    router,
    returnParams,
    requestCloseEdit,
  ]);

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
    }, [editMode, requestCloseEdit, goBack]),
  );

  useEffect(() => {
    resetZoom();
  }, [viewerIndex, resetZoom]);

  if ((loading && !hydratedRef.current) || !order) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const statusMeta = getStatusMeta(order.status);
  const selectedAssignee = (users || []).find((u) => u.id === assigneeId) || null;
  const isFree = !order.assigned_to;
  const canChangeStatus = canEdit() && order.status !== 'В ленте';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Screen
        background="background"
        edges={['top', 'bottom']}
        headerOptions={{
          headerTitleAlign: 'left',
          title: t('routes.orders/[id]', 'routes.orders/[id]'),
          rightTextLabel: canEdit() && !editMode && order?.id ? t('order_details_edit') : undefined,
          onRightPress:
            canEdit() && order?.id ? () => router.push(`/orders/edit/${order.id}`) : undefined,
        }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            ref={detailsScrollRef}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            <SectionHeader topSpacing="xs">{t('order_details_general_data')}</SectionHeader>
            <RNAnimated.View
              style={[{ opacity: viewFade, transform: [{ translateY: viewTranslate }] }]}
            >
              <Card paddedXOnly>
                <View style={base.row}>
                  <Text style={base.label}>{t('order_details_status')}</Text>
                  <View
                    style={[
                      base.rightWrap,
                      { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
                    ]}
                  >
                    {order.urgent && (
                      <View style={styles.urgentPill}>
                        <Text style={styles.urgentPillText}>{t('order_details_urgent')}</Text>
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
                        style={[
                          styles.statusChip,
                          { backgroundColor: statusMeta.bg, opacity: 0.6 },
                        ]}
                      >
                        <Text style={[styles.statusChipText, { color: statusMeta.fg }]}>
                          {order.status}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={base.sep} />

                {/* ...existing code... */}
                <View style={base.row}>
                  <Text style={base.label}>{t('order_details_executor')}</Text>
                  <View style={base.rightWrap}>
                    {deriveExecutorNameInstant(order) || executorName ? (
                      <Text style={base.value}>
                        {deriveExecutorNameInstant(order) || executorName}
                      </Text>
                    ) : (
                      <Text style={[base.value, { color: theme.colors.textSecondary }]}>
                        {t('order_details_not_assigned')}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={base.sep} />

                <View style={base.row}>
                  <Text style={base.label}>{t('order_details_customer')}</Text>
                  <View style={base.rightWrap}>
                    <Text style={base.value}>
                      {order.fio || order.customer_name || t('common_dash')}
                    </Text>
                  </View>
                </View>
                <View style={base.sep} />

                <Pressable style={base.row} onPress={openInYandex}>
                  <Text style={base.label}>{t('order_details_address')}</Text>
                  <View style={base.rightWrap}>
                    <Text style={[base.value, styles.link]} numberOfLines={2}>
                      {[order.address, order.region, order.city, order.street, order.house]
                        .filter(Boolean)
                        .join(', ') || t('order_details_address_not_specified')}
                    </Text>
                  </View>
                </Pressable>
                <View style={base.sep} />

                {useWorkTypes && (
                  <>
                    <View style={base.row}>
                      <Text style={base.label}>{t('order_details_work_type')}</Text>
                      <View style={base.rightWrap}>
                        <Text style={base.value}>
                          {workTypes.find((w) => w.id === (order.work_type_id ?? null))?.name ||
                            t('order_details_work_type_not_selected')}
                        </Text>
                      </View>
                    </View>
                    <View style={base.sep} />
                  </>
                )}

                <Pressable
                  style={base.row}
                  onPress={() => {
                    const dateStr = order.datetime
                      ? new Date(order.datetime).toISOString().slice(0, 10)
                      : undefined;
                    const assignee = order.assigned_to || undefined;
                    router.push({
                      pathname: '/orders/calendar',
                      params: {
                        selectedDate: dateStr,
                        selectedUserId: assignee,
                        returnTo: `/order-details/${order.id}`,
                        returnParams: JSON.stringify({}),
                      },
                    });
                  }}
                >
                  <Text style={base.label}>{t('order_details_departure_date')}</Text>
                  <View style={base.rightWrap}>
                    <Text style={[base.value, styles.link]}>
                      {order.datetime
                        ? format(
                            new Date(order.datetime),
                            useDepartureTime ? 'd MMMM yyyy, HH:mm' : 'd MMMM yyyy',
                            { locale: ru },
                          )
                        : t('order_details_departure_not_specified')}
                    </Text>
                  </View>
                </Pressable>
                <View style={base.sep} />

                <View style={base.row}>
                  <Text style={base.label}>{t('order_details_phone')}</Text>
                  <View style={base.rightWrap}>
                    {(() => {
                      const isAdmin = role === 'admin' || role === 'dispatcher';
                      const visiblePhone =
                        order?.customer_phone_visible || (isAdmin ? order?.phone : null);
                      const masked = order?.customer_phone_masked;
                      if (visiblePhone) {
                        return (
                          <Pressable onPress={handlePhonePress} onLongPress={handlePhoneLongPress}>
                            <Text style={[base.value, styles.link]}>
                              {formatPhoneDisplay(visiblePhone)}
                            </Text>
                          </Pressable>
                        );
                      }
                      return (
                        <Text style={[base.value, { color: theme.colors.textSecondary }]}>
                          {masked || t('order_details_phone_hidden')}
                        </Text>
                      );
                    })()}
                  </View>
                </View>
                <View style={base.sep} />

                <View style={base.row}>
                  <Text style={base.label}>{t('order_details_amount')}</Text>
                  <View style={base.rightWrap}>
                    <Text style={base.value}>{formatMoney(order.price)}</Text>
                  </View>
                </View>
                <View style={base.sep} />

                <View style={base.row}>
                  <Text style={base.label}>{t('order_details_fuel')}</Text>
                  <View style={base.rightWrap}>
                    <Text style={base.value}>{formatMoney(order.fuel_cost)}</Text>
                  </View>
                </View>
              </Card>
            </RNAnimated.View>

            {hasField('comment') && (
              <RNAnimated.View
                style={[
                  {
                    opacity: viewFade,
                    transform: [{ translateY: viewTranslate }],
                    marginTop: theme.spacing?.md || 12,
                  },
                ]}
              >
                <SectionHeader>{t('order_details_description')}</SectionHeader>
                <Card>
                  <Text
                    style={[base.value, { lineHeight: 22 }]}
                    numberOfLines={descExpanded ? undefined : 4}
                  >
                    {order.comment?.trim() ? order.comment : t('order_details_description_empty')}
                  </Text>
                  {order.comment && order.comment.length > 120 && (
                    <Pressable
                      onPress={() => setDescExpanded((v) => !v)}
                      hitSlop={theme.components?.interactive?.hitSlop || 8}
                    >
                      <Text
                        style={[
                          styles.link,
                          {
                            marginTop: theme.spacing?.sm || 8,
                            fontWeight: theme.typography?.weight?.semibold || '600',
                          },
                        ]}
                      >
                        {descExpanded ? t('order_details_collapse') : t('order_details_show_full')}
                      </Text>
                    </Pressable>
                  )}
                </Card>
              </RNAnimated.View>
            )}

            {!isFree && renderPhotoRow(t('order_details_contract_photo'), 'contract_file')}
            {!isFree && renderPhotoRow(t('order_details_photo_before'), 'photo_before')}
            {!isFree && renderPhotoRow(t('order_details_photo_after'), 'photo_after')}
            {!isFree && renderPhotoRow(t('order_details_act'), 'act_file')}

            {!order.assigned_to && (role === 'worker' || has('canAssignExecutors')) && (
              <Pressable
                style={({ pressed }) => [styles.finishButton, pressed && { opacity: 0.9 }]}
                onPress={onAcceptOrder}
              >
                <Text style={styles.finishButtonText}>{t('order_details_accept_order')}</Text>
              </Pressable>
            )}

            {order.status !== 'Завершённая' && !isFree && (
              <Pressable
                style={({ pressed }) => [
                  styles.finishButton,
                  !canFinishOrder() && styles.finishButtonDisabled,
                  pressed && canFinishOrder() && { opacity: 0.9 },
                ]}
                onPress={onFinishPress}
              >
                <Text style={styles.finishButtonText}>{t('order_details_finish_order')}</Text>
              </Pressable>
            )}

            {has('canDeleteOrders') && (
              <Pressable
                onPress={() => setDeleteModalVisible(true)}
                style={({ pressed }) => [
                  styles.appButton,
                  styles.btnDestructive,
                  { marginTop: 12 },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={[styles.appButtonText, styles.btnDestructiveText]}>
                  {t('order_details_delete')}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </TouchableWithoutFeedback>

        {Platform.OS === 'ios' && !!bannerMessage && (
          <View pointerEvents="none" style={styles.banner}>
            <Text style={styles.bannerText}>{bannerMessage}</Text>
          </View>
        )}
      </Screen>

      <Modal
        isVisible={workTypeModalVisible}
        onBackdropPress={() => setWorkTypeModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_work_type_select')}</Text>
          {workTypes.length === 0 ? (
            <Text style={styles.modalText}>{t('order_modal_work_type_empty')}</Text>
          ) : (
            workTypes.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => {
                  setWorkTypeId(t.id);
                  setWorkTypeModalVisible(false);
                }}
                style={({ pressed }) => [styles.assigneeOption, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.assigneeText}>{t.name}</Text>
              </Pressable>
            ))
          )}
        </View>
      </Modal>

      <Modal
        isVisible={viewerVisible}
        backdropOpacity={0}
        style={{ margin: 0 }}
        onBackButtonPress={() => setViewerVisible(false)}
        useNativeDriver
        onModalHide={applyNavBar}
      >
        <View style={StyleSheet.absoluteFill}>
          <BlurView intensity={50} tint="dark" style={[StyleSheet.absoluteFill]} />
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: theme.colors.overlay },
              animatedBackdropStyle,
            ]}
          />

          <View style={styles.viewerTopBar}>
            <View style={styles.counterPill}>
              <Text style={styles.counterText}>
                {viewerPhotos.length ? `${viewerIndex + 1}/${viewerPhotos.length}` : ''}
              </Text>
            </View>
            <Pressable onPress={closeViewer} hitSlop={12} style={styles.closeBtn}>
              <Feather name="x" size={24} color={theme.colors.onPrimary} />
            </Pressable>
          </View>

          {(() => {
            const GAP = 16;
            return (
              <RNAnimated.FlatList
                style={{ backgroundColor: theme.colors.background }}
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
                      backgroundColor: theme.colors.background,
                    }}
                  >
                    <PinchGestureHandler
                      ref={pinchRef}
                      onGestureEvent={onPinchGestureEvent}
                      onHandlerStateChange={onPinchStateChange}
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
                                    backgroundColor: theme.colors.background,
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

      <Modal
        isVisible={cancelVisible}
        onBackdropPress={() => setCancelVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
        onModalHide={applyNavBar}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_cancel_edit_title')}</Text>
          <Text style={styles.modalText}>{t('order_modal_cancel_edit_msg')}</Text>
          <View style={styles.modalActions}>
            <Button
              title={t('order_modal_cancel_stay')}
              onPress={() => setCancelVisible(false)}
              variant="primary"
            />
            <Button
              title={t('order_modal_cancel_leave')}
              onPress={confirmCancel}
              variant="destructive"
            />
          </View>
        </View>
      </Modal>

      <Modal
        isVisible={assigneeModalVisible}
        onBackdropPress={() => setAssigneeModalVisible(false)}
        useNativeDriver
        animationIn="slideInUp"
        animationOut="slideOutDown"
        animationInTiming={200}
        animationOutTiming={200}
        backdropOpacity={0.3}
        onModalHide={applyNavBar}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_select_executor')}</Text>
          <Pressable
            onPress={() => {
              setToFeed(true);
              setAssigneeId(null);
              setAssigneeModalVisible(false);
            }}
            style={({ pressed }) => [
              styles.assigneeOption,
              pressed && { backgroundColor: theme.colors.inputBg || theme.colors.surface },
            ]}
          >
            <Text style={styles.assigneeText}>{t('order_modal_to_feed')}</Text>
          </Pressable>
          <View style={{ height: 8 }} />
          {users.map((user) => (
            <Pressable
              key={user.id}
              onPress={() => {
                setAssigneeId(user.id);
                setExecutorName(`${user.first_name || ''} ${user.last_name || ''}`.trim());
                setToFeed(false);
                setAssigneeModalVisible(false);
              }}
              style={({ pressed }) => [
                styles.assigneeOption,
                pressed && { backgroundColor: theme.colors.inputBg || theme.colors.surface },
              ]}
            >
              <Text style={styles.assigneeText}>
                {[user.first_name, user.last_name].filter(Boolean).join(' ')}
              </Text>
            </Pressable>
          ))}
        </View>
      </Modal>

      <Modal
        isVisible={departmentModalVisible}
        onBackdropPress={() => setDepartmentModalVisible(false)}
        useNativeDriver
        animationIn="slideInUp"
        animationOut="slideOutDown"
        animationInTiming={200}
        animationOutTiming={200}
        backdropOpacity={0.3}
        onModalHide={applyNavBar}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_select_department')}</Text>
          {departments.length > 0 ? (
            departments.map((d) => (
              <Pressable
                key={d.id}
                onPress={() => {
                  setDepartmentId(d.id);
                  setDepartmentModalVisible(false);
                }}
                style={({ pressed }) => [styles.assigneeOption, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.assigneeText}>{d.name}</Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.modalText}>{t('order_modal_no_departments')}</Text>
          )}
          <View style={[styles.modalActions, { marginTop: theme.spacing?.sm || 8 }]}>
            <Button
              title={t('btn_cancel')}
              onPress={() => setDepartmentModalVisible(false)}
              variant="secondary"
            />
          </View>
        </View>
      </Modal>

      <Modal
        isVisible={statusModalVisible}
        onBackdropPress={() => setStatusModalVisible(false)}
        style={{ margin: 0 }}
        useNativeDriver
        backdropOpacity={0.3}
        onModalHide={applyNavBar}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_change_status')}</Text>
          {[
            t('order_status_in_feed'),
            t('order_status_new'),
            t('order_status_in_progress'),
            t('order_status_completed'),
          ].map((s) => (
            <Pressable
              key={s}
              onPress={() => updateStatus(s)}
              style={({ pressed }) => [
                styles.assigneeOption,
                pressed && { backgroundColor: theme.colors.inputBg || theme.colors.surface },
              ]}
            >
              <Text style={styles.assigneeText}>
                {s} {order.status === s ? '✓' : ''}
              </Text>
            </Pressable>
          ))}
          <View style={[styles.modalActions, { marginTop: theme.spacing?.sm || 8 }]}>
            <Button
              title={t('btn_cancel')}
              onPress={() => setStatusModalVisible(false)}
              variant="secondary"
            />
          </View>
        </View>
      </Modal>

      <Modal
        isVisible={warningVisible}
        onBackdropPress={() => setWarningVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
        onModalHide={applyNavBar}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_warning_title')}</Text>
          <Text style={styles.modalText}>{warningMessage}</Text>
          <View style={styles.modalActions}>
            <Button title={t('btn_ok')} onPress={() => setWarningVisible(false)} />
          </View>
        </View>
      </Modal>

      <Modal
        isVisible={deleteModalVisible}
        onBackButtonPress={() => setDeleteModalVisible(false)}
        onBackdropPress={() => setDeleteModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
        onModalHide={applyNavBar}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_delete_title')}</Text>
          <Text style={styles.modalText}>{t('order_modal_delete_msg')}</Text>
          <View style={styles.modalActions}>
            <Button
              title={t('order_modal_cancel_stay')}
              onPress={() => setDeleteModalVisible(false)}
              variant="primary"
            />
            <Button
              title={
                deleteEnabled
                  ? t('order_modal_delete_confirm')
                  : t('order_modal_delete_countdown').replace('{n}', deleteCountdown)
              }
              onPress={deleteOrderCompletely}
              disabled={!deleteEnabled}
              variant="destructive"
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme) {
  const sp = theme.spacing || {};
  const rad = theme.radii || {};
  const typo = theme.typography || {};
  const shadows = theme.shadows || {};

  return StyleSheet.create({
    container: {
      paddingTop: (sp.lg || 16) / 2,
      paddingLeft: sp.lg || 16,
      paddingRight: sp.lg || 16,
      paddingBottom: 60,
      backgroundColor: theme.colors.background,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
    },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: sp.md || 12,
    },
    backText: { color: theme.colors.primary, fontSize: typo.sizes?.md || 16 },

    // ЗАМЕНА кнопки на ссылку
    editLink: {
      paddingHorizontal: sp.md || 12,
      paddingVertical: sp.xs || 6,
    },
    editLinkText: {
      color: theme.colors.primary,
      fontWeight: typo.weight?.semibold || '600',
    },

    // headerCard больше не используется, можно оставить или удалить по желанию
    // headerCard: { ...existing code... },

    metaRow: { flexDirection: 'row', alignItems: 'center', gap: sp.sm || 8 },
    urgentPill: {
      backgroundColor: theme.colors.danger,
      paddingHorizontal: sp.md || 10,
      paddingVertical: sp.xs || 6,
      borderRadius: rad.pill || 999,
    },
    urgentPillText: {
      color: theme.colors.onPrimary,
      fontWeight: typo.weight?.bold || '700',
      fontSize: typo.sizes?.xs || 12,
    },
    statusChip: {
      paddingHorizontal: sp.md || 10,
      paddingVertical: sp.xs || 6,
      borderRadius: rad.pill || 999,
    },
    statusChipText: {
      fontSize: typo.sizes?.xs || 12,
      fontWeight: typo.weight?.bold || '700',
      letterSpacing: 0.3,
    },
    link: { color: theme.colors.primary },
    finishButton: {
      marginTop: sp.lg + 2 || 18,
      backgroundColor: theme.colors.primary,
      paddingVertical: sp.md || 14,
      borderRadius: rad.md || 14,
      alignItems: 'center',
    },
    finishButtonText: {
      color: theme.colors.onPrimary,
      fontSize: typo.sizes?.md || 16,
      fontWeight: typo.weight?.bold || '700',
    },
    finishButtonDisabled: {
      backgroundColor: theme.colors.primaryDisabled || theme.colors.primary,
      opacity: 0.6,
    },
    appButton: {
      paddingVertical: sp.md || 12,
      paddingHorizontal: sp.lg || 16,
      borderRadius: rad.lg || 12,
      alignItems: 'center',
    },
    appButtonText: { fontSize: typo.sizes?.md || 16 },
    btnDestructive: { backgroundColor: theme.colors.danger },
    btnDestructiveText: {
      color: theme.colors.onPrimary,
      fontWeight: typo.weight?.bold || '700',
    },
    modalContainer: {
      backgroundColor: theme.colors.surface,
      borderRadius: rad.lg || 12,
      padding: sp.xl || 20,
    },
    modalTitle: {
      fontSize: typo.sizes?.lg || 18,
      fontWeight: typo.weight?.semibold || '600',
      marginBottom: sp.md || 12,
      color: theme.colors.text,
    },
    modalText: {
      fontSize: typo.sizes?.sm || 15,
      color: theme.colors.textSecondary,
      marginBottom: sp.xl || 20,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: sp.md || 12,
    },
    assigneeOption: { paddingVertical: sp.md || 10 },
    assigneeText: { fontSize: typo.sizes?.md || 16, color: theme.colors.text },
    banner: {
      position: 'absolute',
      left: sp.lg || 16,
      right: sp.lg || 16,
      bottom: sp.xxl || 24,
      backgroundColor: theme.colors.bannerBg || theme.colors.text,
      borderRadius: rad.lg || 12,
      paddingVertical: sp.md || 12,
      paddingHorizontal: sp.lg || 16,
      ...(Platform.OS === 'ios' ? shadows?.card?.ios || {} : shadows?.card?.android || {}),
    },
    bannerText: {
      color: theme.colors.onPrimary,
      textAlign: 'center',
      fontWeight: typo.weight?.semibold || '600',
    },
    viewerTopBar: {
      position: 'absolute',
      top: sp.lg || 16,
      left: 0,
      right: 0,
      zIndex: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: sp.lg || 16,
    },
    counterPill: {
      backgroundColor: theme.colors.overlay,
      borderRadius: rad.pill || 999,
      paddingHorizontal: sp.md || 12,
      paddingVertical: sp.xs || 6,
    },
    counterText: {
      color: theme.colors.onPrimary,
      fontWeight: typo.weight?.bold || '700',
    },
    closeBtn: {
      backgroundColor: theme.colors.overlay,
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
