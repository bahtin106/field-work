// removed Feather icons usage from this file per request
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useNavigation, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  findNodeHandle,
  Image,
  InteractionManager,
  Linking,
  Platform,
  Pressable,
  Animated as RNAnimated,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { useSubscriptionGuard } from '../../hooks/useSubscriptionGuard';
import { yandexDiskMedia } from '../../lib/yandexDiskIntegration';
import { fetchFormSchema } from '../../lib/settings';
import { applyAndroidSystemBars } from '../../lib/systemBars';
import { extractStorageObjectPath } from '../../lib/storageObjectPaths';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../lib/workTypes';

import * as ImageManipulator from 'expo-image-manipulator';
import { encode as encodeBase64 } from 'base64-arraybuffer';

import AppHeader from '../../components/navigation/AppHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import SectionHeader from '../../components/ui/SectionHeader';
import { SelectModal } from '../../components/ui/modals';
import TextField from '../../components/ui/TextField';
import LabelValueRow from '../../components/ui/LabelValueRow';
import ExpandableTextRow from '../../components/ui/ExpandableTextRow';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { usePermissions } from '../../lib/permissions';
import { formatClientNameForOrder, getClientByOrderId } from '../../src/features/clients/api';
import { useClient } from '../../src/features/clients/queries';
import {
  ensureRequestAssigneeNamePrefetch,
  ensureRequestPrefetch,
  useRequest,
  useRequestRealtimeSync,
} from '../../src/features/requests/queries';
import { updateRequestWithVersion } from '../../src/features/requests/api';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import { useTranslation } from '../../src/i18n/useTranslation';
import { markFirstContent, markScreenMount } from '../../src/shared/perf/devMetrics';
import { useTheme } from '../../theme/ThemeProvider';
import { useQueryClient } from '@tanstack/react-query';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const PHOTO_PICKER_SOURCE = {
  CAMERA: 'camera',
  GALLERY: 'gallery',
};
const PHOTO_MAX_WIDTH = 1280;
const PHOTO_COMPRESS_QUALITY = 0.8;
const PHOTO_PICKER_QUALITY = 1;
const PHOTO_FILE_EXTENSION = 'jpg';
const PHOTO_MIME_TYPE = 'image/jpeg';

const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());
const REQUEST_SYNC_FIELDS = [
  'id',
  'updated_at',
  'status',
  'assigned_to',
  'time_window_start',
  'title',
  'comment',
  'region',
  'city',
  'street',
  'house',
  'fio',
  'phone',
  'department_id',
  'work_type_id',
  'price',
  'fuel_cost',
  'urgent',
];
const MEDIA_CATEGORIES = ['contract_file', 'photo_before', 'photo_after', 'act_file'];

export default function OrderDetails() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { has, loading: permsLoading } = usePermissions();
  const { settings: companySettings, useDepartureTime } = useCompanySettings();
  const mediaProvider = companySettings?.media_provider === 'yandex_disk' ? 'yandex_disk' : 'app_storage';
  const styles = useMemo(() => createStyles(theme), [theme]);
  const base = useMemo(() => listItemStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const applyNavBar = useCallback(async () => {
    try {
      await applyAndroidSystemBars(theme);
    } catch {}
  }, [theme]);

  const pathname = usePathname();
  const __params = useLocalSearchParams();
  const idParam = __params?.id;
  const id = useMemo(() => {
    const fromParams = Array.isArray(idParam) ? idParam[0] : idParam;
    if (fromParams != null && String(fromParams).trim() !== '') {
      return String(fromParams).trim();
    }
    const path = String(pathname || '');
    const clean = path.split('?')[0];
    const parts = clean.split('/').filter(Boolean);
    const last = parts.length ? String(parts[parts.length - 1]).trim() : '';
    // Ignore known non-id route segments to avoid invalid UUID requests.
    if (!last || ['orders', 'my-orders', 'all-orders', 'calendar', 'new'].includes(last)) {
      return null;
    }
    return last;
  }, [idParam, pathname]);
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
  const queryClient = useQueryClient();
  const firstContentTrackedRef = useRef(false);
  const lastRequestSyncRef = useRef('');
  const orderForInspectRef = useRef(null);
  const mediaProbeInFlightRef = useRef(new Set());

  const [order, setOrder] = useState(null);
  const [orderReady, setOrderReady] = useState(false);
  const [workTypesReady, setWorkTypesReady] = useState(false);
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
  const [useDepartments, setUseDepartmentsFlag] = useState(false);
  const [companyId, setCompanyId] = useState(null);
  const subscriptionGuard = useSubscriptionGuard(companyId);
  const isReadOnlyBySubscription =
    !subscriptionGuard.isLoading &&
    String(subscriptionGuard.reason || '').startsWith('subscription_');
  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  const [workTypeId, setWorkTypeId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [amount, setAmount] = useState('');
  const [gsm, setGsm] = useState('');
  const canEditFinances = role === 'admin' || role === 'dispatcher';
  const normalizeId = useCallback((value) => {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
  }, []);
  const workTypeName = useMemo(() => {
    const normalized = normalizeId(workTypeId);
    if (!normalized) return null;
    const found = workTypes.find((w) => normalizeId(w?.id) === normalized);
    return found?.name || null;
  }, [normalizeId, workTypeId, workTypes]);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [warningVisible, setWarningVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [assigneeModalVisible, setAssigneeModalVisible] = useState(false);
  const [departmentModalVisible, setDepartmentModalVisible] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(5);
  const [deleteEnabled, setDeleteEnabled] = useState(false);
  const [photoSourceModal, setPhotoSourceModal] = useState({ visible: false, category: null });
  const [amountEditModalVisible, setAmountEditModalVisible] = useState(false);
  const [fuelEditModalVisible, setFuelEditModalVisible] = useState(false);
  const [amountDraft, setAmountDraft] = useState('');
  const [fuelDraft, setFuelDraft] = useState('');
  const [financeSaving, setFinanceSaving] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [resolvedMediaUrls, setResolvedMediaUrls] = useState({});
  const [mediaIssues, setMediaIssues] = useState({});
  const [photoLoadingMap, setPhotoLoadingMap] = useState({});
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);
  const [resolvedClientId, setResolvedClientId] = useState(null);
  const { data: requestData, refetch: refetchRequestData } = useRequest(id, {
    enabled: !!id,
    staleTime: 45 * 1000,
    refetchOnMount: false,
  });

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

  const buildOrderSyncToken = useCallback((entity) => {
    if (!entity || typeof entity !== 'object') return '';
    const payload = {};
    for (const field of REQUEST_SYNC_FIELDS) {
      payload[field] = entity[field] ?? null;
    }
    return JSON.stringify(payload);
  }, []);

  const hasMeaningfulOrderDiff = useCallback((prevOrder, nextOrder) => {
    if (!prevOrder) return true;
    if (!nextOrder) return false;
    return buildOrderSyncToken(prevOrder) !== buildOrderSyncToken(nextOrder);
  }, [buildOrderSyncToken]);

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
        case 'time_window_start':
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
        } else if (k === 'time_window_start') {
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

  const formatMoney = useCallback(
    (v, currency = null) => {
      if (v === null || v === undefined || v === '') return '—';
      const n = typeof v === 'string' ? parseFloat(v) : Number(v);
      if (!Number.isFinite(n)) return '—';
      const cur = currency || companySettings?.currency || 'RUB';
      try {
        // use centralized util for consistent behavior across app
        const { formatCurrency } = require('../../lib/currency');
        return formatCurrency(n, cur, 'ru-RU') || '—';
      } catch {
        return '—';
      }
    },
    [companySettings],
  );

  const saveInlineFinanceField = useCallback(
    async ({ field, rawValue, onDone }) => {
      if (!order?.id) return;
      const parsed = parseMoney(rawValue);
      if (parsed === null) {
        showWarning(
          field === 'price' ? t('order_validation_amount_format') : t('order_validation_fuel_format'),
        );
        return;
      }

      setFinanceSaving(true);
      try {
        const updatedOrder = await updateRequestWithVersion(
          order.id,
          { [field]: parsed },
          order?.updated_at || null,
        );
        setOrder(updatedOrder || order);
        if (field === 'price') setAmount(String(parsed));
        if (field === 'fuel_cost') setGsm(String(parsed));
        onDone?.();
        showToast(t('order_toast_saved'));
      } catch (e) {
        if (e?.code === 'CONFLICT' && e?.latest) {
          setOrder(e.latest);
          showToast(t('order_toast_status_updated'));
        } else {
          showToast(e?.message || t('order_save_error'));
        }
      } finally {
        setFinanceSaving(false);
      }
    },
    [order, parseMoney, showToast, showWarning, t],
  );

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
      time_window_start: o.time_window_start ? new Date(o.time_window_start).toISOString() : null,
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
      time_window_start: departureDate ? departureDate.toISOString() : null,
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
    if (mediaProvider !== 'app_storage') return;
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
  }, [order, mediaProvider]);

  const fetchServerPhotos = useCallback(async (orderId) => {
    if (mediaProvider !== 'app_storage') return null;
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
  }, [mediaProvider]);

  const getPhotoDisplayUrl = useCallback(
    (sourceUrl) => {
      if (!sourceUrl) return '';
      return resolvedMediaUrls[sourceUrl] || sourceUrl;
    },
    [resolvedMediaUrls],
  );

  const getMediaIssueMessage = useCallback(
    (sourceUrl) => {
      const issue = mediaIssues[sourceUrl];
      if (!issue) return '';
      const code = String(issue.code || '').trim();
      if (code === 'deleted_remote') return t('order_photo_issue_deleted_remote');
      if (code === 'missing_mapping') return t('order_photo_issue_missing_mapping');
      if (code === 'disk_unavailable') return t('order_photo_issue_disk_unavailable');
      if (code === 'disk_auth') return t('order_photo_issue_disk_auth');
      if (code === 'disk_locked') return t('order_photo_issue_disk_locked');
      if (code === 'disk_error' || code === 'download_error')
        return t('order_photo_issue_temporary');
      if (code === 'client_network') return t('order_photo_issue_client_network');
      if (issue.message) return issue.message;
      return t('order_photo_issue_temporary');
    },
    [mediaIssues, t],
  );

  const setPhotoLoading = useCallback((url, value) => {
    const key = String(url || '').trim();
    if (!key) return;
    setPhotoLoadingMap((prev) => {
      if ((prev[key] || false) === value) return prev;
      return { ...prev, [key]: value };
    });
  }, []);

  const isLikelyYandexLink = useCallback((url) => {
    const raw = String(url || '').toLowerCase();
    return raw.startsWith('yadisk://') || raw.includes('yadi.sk') || raw.includes('disk.yandex');
  }, []);

  const inspectSingleMedia = useCallback(
    async (category, sourceUrl) => {
      const key = `${category}:${sourceUrl}`;
      if (!order?.id || mediaProvider !== 'yandex_disk') return false;
      if (mediaProbeInFlightRef.current.has(key)) return false;
      mediaProbeInFlightRef.current.add(key);
      try {
        const data = await yandexDiskMedia('inspect_urls', {
          order_id: order.id,
          category,
          urls: [sourceUrl],
        });
        const resolved = data?.resolved_urls && typeof data.resolved_urls === 'object'
          ? data.resolved_urls
          : {};
        const issues = data?.issues && typeof data.issues === 'object' ? data.issues : {};
        const mediaUrls = Array.isArray(data?.media_urls) ? data.media_urls : null;

        if (Object.keys(resolved).length) {
          setResolvedMediaUrls((prev) => ({ ...prev, ...resolved }));
        }
        if (Object.keys(issues).length) {
          setMediaIssues((prev) => ({ ...prev, ...issues }));
        }
        if (Array.isArray(mediaUrls)) {
          setOrder((prev) => {
            if (!prev) return prev;
            return { ...prev, [category]: mediaUrls };
          });
        }
        return !!issues[sourceUrl];
      } catch {
        return false;
      } finally {
        mediaProbeInFlightRef.current.delete(key);
      }
    },
    [mediaProvider, order?.id],
  );

  const inspectYandexMedia = useCallback(
    async (baseOrder) => {
      if (mediaProvider !== 'yandex_disk' || !baseOrder?.id) {
        setResolvedMediaUrls({});
        setMediaIssues({});
        return baseOrder;
      }

      const nextResolved = {};
      const nextIssues = {};
      let nextOrder = { ...baseOrder };

      for (const category of MEDIA_CATEGORIES) {
        const urls = Array.isArray(nextOrder?.[category]) ? nextOrder[category].filter(Boolean) : [];
        if (!urls.length) continue;
        try {
          const data = await yandexDiskMedia('inspect_urls', {
            order_id: nextOrder.id,
            category,
            urls,
          });

          const resolved = data?.resolved_urls && typeof data.resolved_urls === 'object'
            ? data.resolved_urls
            : {};
          const issues = data?.issues && typeof data.issues === 'object' ? data.issues : {};
          const mediaUrls = Array.isArray(data?.media_urls) ? data.media_urls : urls;

          Object.assign(nextResolved, resolved);
          Object.assign(nextIssues, issues);

          if (Array.isArray(mediaUrls)) {
            nextOrder[category] = mediaUrls;
          }
        } catch (e) {
          const message = String(e?.message || '').trim() || t('order_photo_issue_temporary');
          for (const url of urls) {
            nextIssues[url] = { code: 'disk_error', message };
          }
        }
      }

      setResolvedMediaUrls(nextResolved);
      setMediaIssues(nextIssues);
      return nextOrder;
    },
    [mediaProvider, t],
  );

  const fetchData = useCallback(async () => {
    if (!id) {
      setOrderReady(true);
      return;
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

      // Use freshest detail from server first; fallback to cache only if needed.
      const cachedOrderRaw = queryClient.getQueryData(queryKeys.requests.detail(id));
      let fetchedOrderRaw = null;
      try {
        const refetched = await refetchRequestData();
        fetchedOrderRaw = refetched?.data || null;
      } catch {
        // fallback below
      }
      if (!fetchedOrderRaw) {
        fetchedOrderRaw = await ensureRequestPrefetch(queryClient, id);
      }
      if (!fetchedOrderRaw && cachedOrderRaw) {
        fetchedOrderRaw = cachedOrderRaw;
      }
      if (!fetchedOrderRaw) throw new Error('Order not found');

      const fetchedOrder = fetchedOrderRaw
        ? {
            ...fetchedOrderRaw,
            time_window_start: fetchedOrderRaw.time_window_start ?? null,
          }
        : null;

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

      // ПЕРЕДЕЛАНО: сохраняем статус "В работе" в БД и перезагружаем заявку
      let effectiveOrder = fetchedOrder;
      if (uid && fetchedOrder.status === 'Новый' && fetchedOrder.assigned_to === uid) {
        try {
          await updateRequestWithVersion(
            id,
            { status: 'В работе' },
            fetchedOrder?.updated_at || null,
          );

          await queryClient.invalidateQueries({ queryKey: ['requests'] });
          await queryClient.invalidateQueries({ queryKey: queryKeys.requests.detail(id) });
          const refreshed = await ensureRequestPrefetch(queryClient, id);
          effectiveOrder = refreshed || { ...fetchedOrder, status: 'В работе' };
        } catch (e) {
          console.warn('Persist status error:', e);
          effectiveOrder = fetchedOrder;
        }
      }

      const inspectedOrder = await inspectYandexMedia(effectiveOrder);
      setOrder(inspectedOrder);
      setWorkTypeId(inspectedOrder.work_type_id ?? null);
      setOrderReady(true);

      InteractionManager.runAfterInteractions(async () => {
        try {
          const fresh = await fetchServerPhotos(inspectedOrder.id);
          if (fresh) {
            setOrder((prev) => ({
              ...prev,
              contract_file: fresh.contract_file,
              photo_before: fresh.photo_before,
              photo_after: fresh.photo_after,
              act_file: fresh.act_file,
            }));
          }

          initialFormSnapshotRef.current = makeSnapshotFromOrder(inspectedOrder);
          const rawDigits = (
            (inspectedOrder.phone ??
              inspectedOrder.customer_phone_visible ??
              inspectedOrder.phone_visible) ||
            ''
          ).replace(/\D/g, '');

          setTitle(inspectedOrder.title || '');
          setDescription(inspectedOrder.comment || '');
          setRegion(inspectedOrder.region || '');
          setCity(inspectedOrder.city || '');
          setStreet(inspectedOrder.street || '');
          setHouse(inspectedOrder.house || '');
          setCustomerName(inspectedOrder.fio || inspectedOrder.customer_name || '');
          setPhone(rawDigits || '');
          setDepartureDate(
            inspectedOrder.time_window_start ? new Date(inspectedOrder.time_window_start) : null,
          );
          setAssigneeId(inspectedOrder.assigned_to || null);
          setToFeed(!inspectedOrder.assigned_to);
          setUrgent(!!inspectedOrder.urgent);
          setDepartmentId(inspectedOrder.department_id || null);
          setAmount(
            inspectedOrder.price !== null && inspectedOrder.price !== undefined
              ? String(inspectedOrder.price)
              : '',
          );
          setGsm(
            inspectedOrder.fuel_cost !== null && inspectedOrder.fuel_cost !== undefined
              ? String(inspectedOrder.fuel_cost)
              : '',
          );

          if (inspectedOrder.assigned_to) {
            const { data: executorProfile } = await supabase
              .from('profiles')
              .select('first_name, last_name')
              .eq('id', inspectedOrder.assigned_to)
              .single();
            if (executorProfile) {
              const full =
                `${executorProfile.first_name || ''} ${executorProfile.last_name || ''}`.trim();
              EXECUTOR_NAME_CACHE.set(inspectedOrder.assigned_to, full);
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

      let nextDepartments = [];
      try {
        const orderCompanyId = fetchedOrder?.company_id || null;
        let useDepartmentsEnabled = false;
        if (orderCompanyId) {
          const { data: companyRow } = await supabase
            .from('companies')
            .select('use_departments')
            .eq('id', orderCompanyId)
            .maybeSingle();
          useDepartmentsEnabled = companyRow?.use_departments !== false;
          setUseDepartmentsFlag(useDepartmentsEnabled);
          if (useDepartmentsEnabled) {
            const { data: deptList } = await supabase
              .from('departments')
              .select('id, name')
              .eq('is_enabled', true)
              .eq('company_id', orderCompanyId)
              .order('name', { ascending: true });
            nextDepartments = deptList || [];
          }
        }
        if (!orderCompanyId) setUseDepartmentsFlag(false);
      } catch {}
      setDepartments(nextDepartments);
    } catch (e) {
      console.warn('Fetch data error:', e);
      setOrderReady(true);
    }
  }, [
    id,
    fetchServerPhotos,
    inspectYandexMedia,
    makeSnapshotFromOrder,
    queryClient,
    refetchRequestData,
  ]);

  const canEditByRole = useCallback(
    () => has('canEditOrders') && !companySettings?.recalc_in_progress,
    [has, companySettings],
  );
  const canEdit = useCallback(
    () => canEditByRole() && !isReadOnlyBySubscription,
    [canEditByRole, isReadOnlyBySubscription],
  );

  const warmEditScreenCache = useCallback(
    async ({ force = false } = {}) => {
      if (!id || !canEdit()) return;
      const registry = getPrefetchRegistry();
      await registry.run(
        `order-edit:${id}`,
        async () => {
          try {
            await ensureRequestPrefetch(queryClient, id);
          } catch {}

          const tasks = [];
          if (companyId) {
            tasks.push(fetchWorkTypes(companyId, { includeDisabled: true }));
          } else {
            tasks.push(
              (async () => {
                try {
                  const cid = await getMyCompanyId();
                  if (cid) {
                    setCompanyId(cid);
                    await fetchWorkTypes(cid, { includeDisabled: true });
                  }
                } catch {}
              })(),
            );
          }

          const assignedId = order?.assigned_to || requestData?.assigned_to || null;
          if (assignedId) {
            tasks.push(ensureRequestAssigneeNamePrefetch(queryClient, assignedId));
          }

          if (tasks.length) {
            await Promise.allSettled(tasks);
          }
        },
        { force },
      );
    },
    [id, canEdit, queryClient, companyId, order?.assigned_to, requestData?.assigned_to],
  );

  const handlePhonePress = useCallback(() => {
    const p = order?.customer_phone_visible;
    if (p) Linking.openURL(`tel:${formatPhoneE164(p)}`);
  }, [order, formatPhoneE164]);

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
    async (category, source) => {
      try {
        let result = null;
        if (source === PHOTO_PICKER_SOURCE.CAMERA) {
          const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
          if (!permissionResult.granted) {
            showToast(t('order_no_camera_permission'));
            return;
          }
          result = await ImagePicker.launchCameraAsync({ quality: PHOTO_PICKER_QUALITY });
        } else {
          const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permissionResult.granted) {
            showToast(t('order_no_gallery_permission'));
            return;
          }
          result = await ImagePicker.launchImageLibraryAsync({ quality: PHOTO_PICKER_QUALITY });
        }
        if (!result || result.canceled) return;

        const manipulated = await ImageManipulator.manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: PHOTO_MAX_WIDTH } }],
          { compress: PHOTO_COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
        );

        const resp = await fetch(manipulated.uri);
        const ab = await resp.arrayBuffer();
        const fileData = new Uint8Array(ab);

        if (mediaProvider === 'yandex_disk') {
          const data = await yandexDiskMedia('upload', {
            order_id: order.id,
            category,
            file_base64: encodeBase64(ab),
            mime: PHOTO_MIME_TYPE,
          });
          const publicUrl = String(data?.url || '');
          if (!publicUrl) {
            showToast(t('order_toast_upload_error'));
            return;
          }

          const updated = [...(order[category] || []), publicUrl];
          let updateError = null;
          try {
            await updateRequestWithVersion(order.id, { [category]: updated }, order?.updated_at || null);
          } catch (e) {
            updateError = e;
          }

          if (updateError) {
            if (updateError?.code === 'CONFLICT' && updateError?.latest) {
              setOrder(updateError.latest);
              showToast('Заявка уже обновилась на другом устройстве.');
              return;
            }
            showToast('Ошибка сохранения ссылки');
            return;
          }

          setOrder({ ...order, [category]: updated });
          if (data?.display_url) {
            setResolvedMediaUrls((prev) => ({ ...prev, [publicUrl]: String(data.display_url) }));
          }
          setMediaIssues((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, publicUrl)) return prev;
            const next = { ...prev };
            delete next[publicUrl];
            return next;
          });
          showToast(t('order_toast_photo_uploaded'));
          return;
        }
        const fileName = `${Date.now()}.${PHOTO_FILE_EXTENSION}`;
        const path = `orders/${order.id}/${category}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('orders-photos')
          .upload(path, fileData, {
            cacheControl: '3600',
            upsert: false,
            contentType: PHOTO_MIME_TYPE,
          });

        if (uploadError) {
          console.warn('[order-photo-upload] storage upload error', {
            message: uploadError?.message,
            name: uploadError?.name,
            statusCode: uploadError?.statusCode,
            error: uploadError?.error,
            path,
            bucket: 'orders-photos',
            size: fileData?.length,
          });
          showToast('Ошибка загрузки фото');
          return;
        }

        const { data: publicData } = supabase.storage.from('orders-photos').getPublicUrl(path);
        const publicUrl = publicData.publicUrl;

        const updated = [...(order[category] || []), publicUrl];

        let updateError = null;
        try {
          await updateRequestWithVersion(order.id, { [category]: updated }, order?.updated_at || null);
        } catch (e) {
          updateError = e;
        }

        if (updateError) {
          if (updateError?.code === 'CONFLICT' && updateError?.latest) {
            setOrder(updateError.latest);
            showToast('Заявка уже обновилась на другом устройстве.');
            return;
          }
          showToast('Ошибка сохранения ссылки');
          return;
        }

        setOrder({ ...order, [category]: updated });
        showToast(t('order_toast_photo_uploaded'));
        if (mediaProvider === 'app_storage') {
          await syncPhotosFromStorage();
        }
      } catch (e) {
        console.warn('Upload error:', e);
        showToast(t('order_toast_upload_error'));
      }
    },
    [order, showToast, syncPhotosFromStorage, t, mediaProvider],
  );

  const removePhoto = useCallback(
    async (category, index) => {
      const updated = [...(order[category] || [])];
      const [removed] = updated.splice(index, 1);

      if (mediaProvider === 'yandex_disk') {
        await yandexDiskMedia('delete', {
          order_id: order.id,
          category,
          url: removed,
        });

        let yError = null;
        try {
          await updateRequestWithVersion(order.id, { [category]: updated }, order?.updated_at || null);
        } catch (e) {
          yError = e;
        }

        if (!yError) {
          setOrder({ ...order, [category]: updated });
          setResolvedMediaUrls((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, removed)) return prev;
            const next = { ...prev };
            delete next[removed];
            return next;
          });
          setMediaIssues((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, removed)) return prev;
            const next = { ...prev };
            delete next[removed];
            return next;
          });
          showToast(t('order_toast_photo_deleted'));
        } else {
          showToast(t('order_toast_delete_error'));
        }
        return;
      }

      const relativePath = extractStorageObjectPath(removed, 'orders-photos');
      if (relativePath) {
        await supabase.storage.from('orders-photos').remove([relativePath]);
      }

      let error = null;
      try {
        await updateRequestWithVersion(order.id, { [category]: updated }, order?.updated_at || null);
      } catch (e) {
        error = e;
      }

      if (!error) {
        setOrder({ ...order, [category]: updated });
        setResolvedMediaUrls((prev) => {
          if (!Object.prototype.hasOwnProperty.call(prev, removed)) return prev;
          const next = { ...prev };
          delete next[removed];
          return next;
        });
        setMediaIssues((prev) => {
          if (!Object.prototype.hasOwnProperty.call(prev, removed)) return prev;
          const next = { ...prev };
          delete next[removed];
          return next;
        });
        showToast(t('order_toast_photo_deleted'));
        if (mediaProvider === 'app_storage') {
          await syncPhotosFromStorage();
        }
      } else {
        showToast(t('order_toast_delete_error'));
      }
    },
    [order, showToast, syncPhotosFromStorage, t, mediaProvider],
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

    let error = null;
    try {
      await updateRequestWithVersion(order.id, { status: 'Завершённая' }, order?.updated_at || null);
    } catch (e) {
      error = e;
    }

    if (error) {
      if (error?.code === 'CONFLICT' && error?.latest) {
        setOrder(error.latest);
        showToast('Заявка уже обновилась на другом устройстве.');
        return;
      }
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
      const asBool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 't';
      const readAccepted = (payload) => {
        if (asBool(payload)) return true;
        if (Array.isArray(payload) && payload.length > 0) return readAccepted(payload[0]);
        if (payload && typeof payload === 'object') {
          return asBool(payload.accepted) || asBool(payload.success) || asBool(payload.result);
        }
        return false;
      };

      let accepted = readAccepted(data);
      let latestOrder = null;
      if (!accepted) {
        try {
          await queryClient.invalidateQueries({ queryKey: queryKeys.requests.detail(order.id) });
          latestOrder = await ensureRequestPrefetch(queryClient, order.id);
          accepted =
            !!latestOrder?.assigned_to &&
            !!userId &&
            String(latestOrder.assigned_to) === String(userId);
        } catch {}
      }

      if (!accepted && latestOrder && !latestOrder.assigned_to && userId) {
        const latestStatus = String(latestOrder.status || '');
        const isInFeed = latestStatus === t('order_status_in_feed') || latestStatus === 'В ленте';
        if (isInFeed) {
          try {
            const fallbackOrder = await updateRequestWithVersion(
              order.id,
              { assigned_to: userId, status: t('order_status_in_progress') },
              latestOrder?.updated_at || order?.updated_at || null,
            );
            latestOrder = fallbackOrder || latestOrder;
            accepted =
              !!latestOrder?.assigned_to &&
              String(latestOrder.assigned_to) === String(userId);
          } catch (e) {
            if (e?.code === 'CONFLICT' && e?.latest) {
              latestOrder = e.latest;
              accepted =
                !!latestOrder?.assigned_to &&
                String(latestOrder.assigned_to) === String(userId);
            }
          }
        }
      }

      if (accepted) {
        const me = (users || []).find((u) => u.id === userId);
        setOrder((prev) => ({
          ...(prev || {}),
          assigned_to: userId,
          status: latestOrder?.status || t('order_status_in_progress'),
        }));
        setExecutorName(me ? `${me.first_name || ''} ${me.last_name || ''}`.trim() : null);
        setAssigneeId(userId);
        setToFeed(false);
        showToast('Заявка принята');
      } else {
        const assignedToOther =
          !!latestOrder?.assigned_to &&
          (!userId || String(latestOrder.assigned_to) !== String(userId));
        if (assignedToOther) {
          showToast('Упс, заявку уже принял кто-то другой');
        } else {
          showToast('Не удалось принять заявку');
        }
      }
    } catch {
      showToast(t('order_toast_network_error'));
    }
  }, [order, users, userId, showToast, t, queryClient]);

  const _handleSubmitEdit = useCallback(async () => {
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
      time_window_start: departureDate.toISOString(),
      status: nextStatus,
      urgent,
      department_id: departmentId || null,
      ...(canEditFinances ? { price: parseMoney(amount), fuel_cost: parseMoney(gsm) } : {}),
      ...(useWorkTypes ? { work_type_id: workTypeId } : {}),
    };

    const targetId = order?.id ?? id;
    if (!targetId) {
      showToast(t('order_validation_no_order_id'));
      return;
    }

    let data = null;
    let error = null;
    try {
      data = await updateRequestWithVersion(targetId, payload, order?.updated_at || null);
    } catch (e) {
      error = e;
    }

    if (error) {
      if (error?.code === 'CONFLICT') {
        if (error?.latest) {
          setOrder(error.latest);
          initialFormSnapshotRef.current = makeSnapshotFromOrder(error.latest);
        }
        showToast('Заявка уже изменена на другом устройстве. Данные обновлены.');
        return;
      }
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
      setDepartureDate(data.time_window_start ? new Date(data.time_window_start) : null);
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
    description,
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
          let error = null;
          try {
            await updateRequestWithVersion(
              order.id,
              { status: t('order_status_in_feed'), assigned_to: null },
              order?.updated_at || null,
            );
          } catch (e) {
            error = e;
          }
          if (error) {
            if (error?.code === 'CONFLICT' && error?.latest) {
              setOrder(error.latest);
              showToast('Статус уже изменен с другого устройства.');
              return;
            }
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

        let error = null;
        try {
          await updateRequestWithVersion(order.id, { status: next }, order?.updated_at || null);
        } catch (e) {
          error = e;
        }
        if (error) {
          if (error?.code === 'CONFLICT' && error?.latest) {
            setOrder(error.latest);
            showToast('Статус уже изменен с другого устройства.');
            return;
          }
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
      setDepartureDate(order.time_window_start ? new Date(order.time_window_start) : null);
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
      const categories = ['contract_file', 'photo_before', 'photo_after', 'act_file'];
      if (mediaProvider === 'yandex_disk') {
        for (const cat of categories) {
          const urls = Array.isArray(order?.[cat]) ? order[cat] : [];
          for (const url of urls) {
            try {
              await yandexDiskMedia('delete', {
                order_id: order.id,
                category: cat,
                url,
              });
            } catch {
              // ignore cleanup errors on remote provider during hard delete
            }
          }
        }
      } else {
        const bucket = 'orders-photos';
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
        const relPaths = Array.from(
          new Set(allUrls.map((u) => extractStorageObjectPath(u, 'orders-photos')).filter(Boolean)),
        );
        if (relPaths.length) {
          await supabase.storage.from(bucket).remove(relPaths);
        }
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
  }, [order, navigation, router, showToast, t, mediaProvider]);

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
  }, [editMode, returnTo, backTargetPath, pathname, router, returnParams, navigation, requestCloseEdit]);

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

  const _scrollToDateField = useCallback(() => {
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
      const prepared = Array.isArray(photos) ? photos.map((u) => getPhotoDisplayUrl(u)).filter(Boolean) : [];
      setViewerPhotos(prepared);
      setViewerIndex(index);
      setViewerVisible(true);
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      bgOpacity.value = 1;
    },
    [bgOpacity, getPhotoDisplayUrl, scale, translateX, translateY],
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
            {canAddAnyPhotos ? (
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
              onPress={() => {
                if (!canAddAnyPhotos) {
                  showToast(t('order_photo_add_not_allowed'));
                  return;
                }
                if (photoSourceItems.length === 1) {
                  compressAndUpload(category, photoSourceItems[0].id);
                  return;
                }
                setPhotoSourceModal({ visible: true, category });
              }}
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
            ) : null}

            {!canViewOrderPhotos ? (
              <Text style={[base.value, { color: theme.colors.textSecondary }]}>
                {t('order_photo_view_not_allowed')}
              </Text>
            ) : (
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
                  {(() => {
                    const displayUrl = getPhotoDisplayUrl(url);
                    const issueMessage = getMediaIssueMessage(url);
                    return (
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
                    onPress={() => {
                      if (!issueMessage) openViewer(photos, index);
                    }}
                  >
                    {issueMessage ? (
                      <View style={styles.photoUnavailableTile}>
                        <Text style={styles.photoUnavailableTitle}>{t('order_photo_unavailable')}</Text>
                        <Text style={styles.photoUnavailableReason}>{issueMessage}</Text>
                      </View>
                    ) : (
                      <View style={styles.photoTileFrame}>
                        <Image
                          source={{ uri: displayUrl }}
                          style={{ width: 116, height: 116, borderRadius: theme.radii?.lg || 12 }}
                          onLoadStart={() => setPhotoLoading(url, true)}
                          onLoadEnd={() => setPhotoLoading(url, false)}
                          onError={() => {
                            setPhotoLoading(url, false);
                            (async () => {
                              let handled = false;
                              if (mediaProvider === 'yandex_disk' && isLikelyYandexLink(url)) {
                                handled = await inspectSingleMedia(category, url);
                              }
                              if (!handled) {
                                setMediaIssues((prev) => ({
                                  ...prev,
                                  [url]: {
                                    code: 'client_network',
                                    message: t('order_photo_issue_client_network'),
                                  },
                                }));
                              }
                            })();
                          }}
                        />
                        {photoLoadingMap[url] ? (
                          <View style={styles.photoLoadingOverlay}>
                            <ActivityIndicator color={theme.colors.primary} size="small" />
                          </View>
                        ) : null}
                      </View>
                    )}
                  </Pressable>
                    );
                  })()}
                  {canAddAnyPhotos ? (
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
                  ) : null}
                </View>
              ))}
              </ScrollView>
            )}
          </Card>
        </View>
      );
    },
    [
      order,
      base.value,
      canAddAnyPhotos,
      canViewOrderPhotos,
      compressAndUpload,
      getMediaIssueMessage,
      getPhotoDisplayUrl,
      inspectSingleMedia,
      isLikelyYandexLink,
      mediaProvider,
      openViewer,
      photoSourceItems,
      photoLoadingMap,
      removePhoto,
      setPhotoLoading,
      showToast,
      styles,
      t,
      theme,
    ],
  );

  useEffect(() => {
    markScreenMount('RequestView');
  }, []);

  useEffect(() => {
    if (!requestData || editMode) return;
    const syncToken = buildOrderSyncToken(requestData);
    if (lastRequestSyncRef.current === syncToken) return;
    lastRequestSyncRef.current = syncToken;

    setOrder((prev) => {
      if (!prev) return { ...requestData };
      const merged = { ...prev, ...requestData };
      return hasMeaningfulOrderDiff(prev, merged) ? merged : prev;
    });
    const nextAssignee = requestData?.assigned_to || null;
    setAssigneeId(nextAssignee);
    setToFeed(!nextAssignee);
    if (!nextAssignee) setExecutorName(null);
    if (Object.prototype.hasOwnProperty.call(requestData, 'work_type_id')) {
      setWorkTypeId(requestData?.work_type_id ?? null);
    }
    if (!orderReady) setOrderReady(true);
  }, [requestData, editMode, hasMeaningfulOrderDiff, orderReady, buildOrderSyncToken]);

  useEffect(() => {
    if (!order?.id || firstContentTrackedRef.current) return;
    firstContentTrackedRef.current = true;
    markFirstContent('RequestView');
  }, [order, order?.id]);

  useRequestRealtimeSync({ enabled: !!id, companyId });

  useEffect(() => {
    applyNavBar();
  }, [applyNavBar]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchFormSchema('edit');
        if (mounted && data && Array.isArray(data.fields)) setSchemaEdit(data);
      } catch {
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
    orderForInspectRef.current = order || null;
  }, [order]);

  useEffect(() => {
    const snapshot = orderForInspectRef.current;
    if (mediaProvider === 'yandex_disk' && snapshot?.id) {
      inspectYandexMedia(snapshot)
        .then((next) => {
          if (next) {
            setOrder(next);
          }
        })
        .catch(() => {});
      return;
    }
    setResolvedMediaUrls({});
    setMediaIssues({});
  }, [inspectYandexMedia, mediaProvider, order?.id, order?.updated_at]);

  useEffect(() => {
    let alive = true;
    setWorkTypesReady(false);
    (async () => {
      try {
        const cid = await getMyCompanyId();
        if (!alive) return;
        setCompanyId(cid);
        if (cid) {
          const { useWorkTypes: flag, types } = await fetchWorkTypes(cid, {
            includeDisabled: true,
          });
          if (!alive) return;
          setUseWorkTypesFlag(!!flag);
          setWorkTypes(types || []);
        }
      } catch (e) {
        console.warn('workTypes bootstrap', e?.message || e);
      } finally {
        if (alive) setWorkTypesReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loading = !orderReady || !workTypesReady;

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
      if (id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.requests.detail(id) });
        refetchRequestData?.();
      }
    }, [id, queryClient, refetchRequestData]),
  );

  useFocusEffect(
    useCallback(
      () => () => {
        if (!id) return;
        queryClient.cancelQueries({ queryKey: queryKeys.requests.detail(id) });
      },
      [id, queryClient],
    ),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const task = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        warmEditScreenCache();
      });
      return () => {
        cancelled = true;
        try {
          task?.cancel?.();
        } catch {}
      };
    }, [warmEditScreenCache]),
  );

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

  // Короткая версия для заголовка native (обязательно строка — чтобы не ломать Screen/header)
  const fullTitle = order?.title || t('routes.orders/[id]', 'routes.orders/[id]');
  const shortTitle = useMemo(() => {
    if (!fullTitle) return '';
    const max = 36;
    return fullTitle.length > max ? `${fullTitle.slice(0, max - 1).trim()}…` : fullTitle;
  }, [fullTitle]);
  const descriptionValue = useMemo(() => String(order?.comment ?? '').trim(), [order?.comment]);
  const canViewClients = has('canViewClients');
  const linkedClientId = order?.client_id ? String(order.client_id) : resolvedClientId;
  const { data: linkedClient } = useClient(linkedClientId, {
    enabled: !!linkedClientId && canViewClients,
  });
  const customerDisplayName = useMemo(() => {
    const liveClientName = formatClientNameForOrder(linkedClient);
    if (liveClientName) return liveClientName;
    return (order?.fio || order?.customer_name || '').trim() || t('common_dash');
  }, [linkedClient, order?.customer_name, order?.fio, t]);

  useEffect(() => {
    let cancelled = false;

    if (!order?.id || !canViewClients) {
      setResolvedClientId(null);
      return () => {
        cancelled = true;
      };
    }

    if (order?.client_id) {
      setResolvedClientId(String(order.client_id));
      return () => {
        cancelled = true;
      };
    }

    getClientByOrderId(String(order.id))
      .then((client) => {
        if (cancelled) return;
        setResolvedClientId(client?.id ? String(client.id) : null);
      })
      .catch(() => {
        if (!cancelled) setResolvedClientId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [canViewClients, order?.client_id, order?.id]);

  const onOpenClient = useCallback(() => {
    if (!linkedClientId || !canViewClients) return;
    router.push(`/clients/${linkedClientId}`);
  }, [canViewClients, linkedClientId, router]);

  if (permsLoading || loading || !order) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const statusMeta = getStatusMeta(order.status);
  const _selectedAssignee = (users || []).find((u) => u.id === assigneeId) || null;
  const isFree = !order.assigned_to;
  const isInFeedStatus = order.status === 'В ленте' || order.status === t('order_status_in_feed');
  const canAcceptOrder =
    isInFeedStatus &&
    isFree &&
    !isReadOnlyBySubscription &&
    (role === 'worker' || (has('canAssignExecutors') && canEditByRole()));
  const canChangeStatus = canEdit() && order.status !== 'В ленте';
  const canAddCameraPhotos = has('canAddCameraPhotos');
  const canAddGalleryPhotos = has('canAddGalleryPhotos');
  const canViewOrderPhotos = has('canViewOrderPhotos');
  const canViewOrderAmount = has('canViewOrderAmount');
  const canEditOrderAmount = canViewOrderAmount && has('canEditOrderAmount');
  const canViewOrderFuelCost = has('canViewOrderFuelCost');
  const canEditOrderFuelCost = canViewOrderFuelCost && has('canEditOrderFuelCost');
  const canViewFinanceSection = canViewOrderAmount || canViewOrderFuelCost;
  const canAddAnyPhotos = canAddCameraPhotos || canAddGalleryPhotos;
  const photoSourceItems = [
    canAddCameraPhotos
      ? { id: PHOTO_PICKER_SOURCE.CAMERA, label: t('order_photo_source_camera') }
      : null,
    canAddGalleryPhotos
      ? { id: PHOTO_PICKER_SOURCE.GALLERY, label: t('order_photo_source_gallery') }
      : null,
  ].filter(Boolean);

  return (
    <>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        edges={['left', 'right']}
      >
      <AppHeader
        back
        options={{
          headerTitleAlign: 'left',
          title: shortTitle,
          headerTitleStyle: {
            fontSize: theme?.typography?.sizes?.md ?? 15,
            fontWeight: theme?.typography?.weight?.semibold ?? '600',
          },
          rightTextLabel: canEditByRole() && !editMode && order?.id ? t('order_details_edit') : undefined,
          onRightPress:
            canEditByRole() && !editMode && order?.id
              ? () => {
                  if (isReadOnlyBySubscription) {
                    showToast(
                      t(
                        'subscription_edit_unavailable_toast',
                        'Изменение недоступно. Оплатите подписку',
                      ),
                    );
                    return;
                  }
                  warmEditScreenCache({ force: true });
                  router.push({
                    pathname: `/orders/edit/${order.id}`,
                    params: {
                      ...(companyId ? { companyId } : {}),
                      ...(order?.work_type_id ? { workTypeId: String(order.work_type_id) } : {}),
                      ...(workTypeName ? { workTypeName: String(workTypeName) } : {}),
                    },
                  });
                }
              : undefined,
        }}
      />
      <ScrollView
        ref={detailsScrollRef}
        contentContainerStyle={[
          styles.contentWrap,
          {
            paddingBottom:
              (theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl) +
              (insets?.bottom ?? 0),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
            {isReadOnlyBySubscription ? (
              <>
                <Card style={{ marginBottom: theme.spacing?.sm ?? 8 }}>
                  <Text style={{ color: theme.colors.warning, fontWeight: '600' }}>
                    {t(
                      'subscription_read_only_notice',
                      'Режим чтения: изменение недоступно до продления подписки',
                    )}
                  </Text>
                </Card>
              </>
            ) : null}
            <SectionHeader topSpacing="xs" bottomSpacing="xs">
              {t('order_details_general_data')}
            </SectionHeader>
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

              <View style={base.row}>
                <Text style={base.label}>{t('order_details_executor')}</Text>
                <View style={base.rightWrap}>
                  {deriveExecutorNameInstant(order) || executorName ? (
                    <Text style={base.value}>{deriveExecutorNameInstant(order) || executorName}</Text>
                  ) : (
                    <Text style={[base.value, { color: theme.colors.textSecondary }]}>
                      {t('order_details_not_assigned')}
                    </Text>
                  )}
                </View>
              </View>
              <View style={base.sep} />

              <View style={base.row}>
                <Text style={base.label}>{t('order_details_work_type')}</Text>
                <View style={base.rightWrap}>
                  <Text style={base.value}>
                    {workTypeName || t('order_details_work_type_not_selected')}
                  </Text>
                </View>
              </View>
              <View style={base.sep} />

              <Pressable
                style={base.row}
                onPress={() => {
                  const dateStr = order.time_window_start
                    ? new Date(order.time_window_start).toISOString().slice(0, 10)
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
                    {order.time_window_start
                      ? format(
                          new Date(order.time_window_start),
                          useDepartureTime ? 'd MMMM yyyy, HH:mm' : 'd MMMM yyyy',
                          { locale: ru },
                        )
                      : t('order_details_departure_not_specified')}
                  </Text>
                </View>
              </Pressable>
              <View style={base.sep} />

              <ExpandableTextRow
                label={t('order_details_description')}
                value={descriptionValue || t('order_details_description_empty')}
              />
            </Card>

            <SectionHeader topSpacing="xs" bottomSpacing="xs">
              {t('order_details_object_data')}
            </SectionHeader>
            <Card paddedXOnly>
              <Pressable style={base.row} onPress={onOpenClient} disabled={!linkedClientId || !canViewClients}>
                <Text style={base.label}>{t('order_details_customer')}</Text>
                <View style={base.rightWrap}>
                  <Text style={[base.value, linkedClientId && canViewClients ? styles.link : null]}>
                    {customerDisplayName}
                  </Text>
                </View>
              </Pressable>
              <View style={base.sep} />

              <LabelValueRow
                label={t('order_details_phone')}
                valueComponent={
                  (() => {
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
                  })()
                }
              />
              <View style={base.sep} />

              <Pressable onPress={openInYandex}>
                <LabelValueRow
                  label={t('order_details_address')}
                  valueComponent={
                    <Text style={[base.value, styles.link]} numberOfLines={2}>
                      {[order.address, order.region, order.city, order.street, order.house]
                        .filter(Boolean)
                        .join(', ') || t('order_details_address_not_specified')}
                    </Text>
                  }
                />
              </Pressable>
            </Card>

            {canViewFinanceSection ? (
              <>
                <SectionHeader topSpacing="xs" bottomSpacing="xs">
                  {t('order_details_finance_data')}
                </SectionHeader>
                <Card paddedXOnly>
                  {canViewOrderAmount ? (
                    <>
                      <LabelValueRow
                        label={t('order_details_amount')}
                        value={formatMoney(order.price, order?.currency || companySettings?.currency)}
                      />
                      {canEditOrderAmount ? (
                        <>
                          <View style={base.sep} />
                          <Pressable
                            style={base.row}
                            onPress={() => {
                              setAmountDraft(String(order?.price ?? ''));
                              setAmountEditModalVisible(true);
                            }}
                          >
                            <Text style={base.label}>{t('order_details_edit_amount_action')}</Text>
                            <View style={base.rightWrap}>
                              <Text style={[base.value, styles.link]}>{t('btn_edit')}</Text>
                            </View>
                          </Pressable>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {canViewOrderAmount && canViewOrderFuelCost ? <View style={base.sep} /> : null}

                  {canViewOrderFuelCost ? (
                    <>
                      <View style={base.row}>
                        <Text style={base.label}>{t('order_details_fuel')}</Text>
                        <View style={base.rightWrap}>
                          <Text style={base.value}>
                            {formatMoney(order.fuel_cost, order?.currency || companySettings?.currency)}
                          </Text>
                        </View>
                      </View>
                      {canEditOrderFuelCost ? (
                        <>
                          <View style={base.sep} />
                          <Pressable
                            style={base.row}
                            onPress={() => {
                              setFuelDraft(String(order?.fuel_cost ?? ''));
                              setFuelEditModalVisible(true);
                            }}
                          >
                            <Text style={base.label}>{t('order_details_edit_fuel_action')}</Text>
                            <View style={base.rightWrap}>
                              <Text style={[base.value, styles.link]}>{t('btn_edit')}</Text>
                            </View>
                          </Pressable>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </Card>
              </>
            ) : null}

            {!isFree && renderPhotoRow(t('order_details_contract_photo'), 'contract_file')}
            {!isFree && renderPhotoRow(t('order_details_photo_before'), 'photo_before')}
            {!isFree && renderPhotoRow(t('order_details_photo_after'), 'photo_after')}
            {!isFree && renderPhotoRow(t('order_details_act'), 'act_file')}

            {canAcceptOrder && (
              <Pressable
                style={({ pressed }) => [styles.finishButton, pressed && { opacity: 0.9 }]}
                onPress={onAcceptOrder}
              >
                <Text style={styles.finishButtonText}>{t('order_details_accept_order')}</Text>
              </Pressable>
            )}

            {order.status !== 'Завершённая' && !isFree && canEdit() && (
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

            {has('canDeleteOrders') && canEdit() && (
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
      {Platform.OS === 'ios' && !!bannerMessage && (
        <View pointerEvents="none" style={styles.banner}>
          <Text style={styles.bannerText}>{bannerMessage}</Text>
        </View>
      )}
    </SafeAreaView>

      <SelectModal
        visible={photoSourceModal.visible}
        title={t('order_photo_source_title')}
        items={photoSourceItems}
        searchable={false}
        onClose={() => setPhotoSourceModal({ visible: false, category: null })}
        onSelect={(item) => {
          const source = item?.id;
          const category = photoSourceModal.category;
          setPhotoSourceModal({ visible: false, category: null });
          if (!source || !category) return;
          compressAndUpload(category, source);
        }}
      />

      <Modal
        isVisible={workTypeModalVisible}
        onBackdropPress={() => setWorkTypeModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_work_type_select')}</Text>
          {(workTypes || []).filter((item) => item?.is_enabled !== false).length === 0 ? (
            <Text style={styles.modalText}>{t('order_modal_work_type_empty')}</Text>
          ) : (
            (workTypes || [])
              .filter((item) => item?.is_enabled !== false)
              .map((t) => (
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
              <Text style={{ color: theme.colors.onPrimary, fontSize: 22, fontWeight: '700' }}>
                ×
              </Text>
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

      {useDepartments ? (
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
      ) : null}

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
        isVisible={amountEditModalVisible}
        onBackdropPress={() => setAmountEditModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
        onModalHide={applyNavBar}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_edit_amount_title')}</Text>
          <TextField
            label={t('order_modal_edit_amount_label')}
            value={amountDraft}
            onChangeText={setAmountDraft}
            keyboardType="decimal-pad"
            placeholder={t('order_placeholder_amount')}
          />
          <View style={styles.modalActions}>
            <Button
              title={t('btn_cancel')}
              onPress={() => setAmountEditModalVisible(false)}
              variant="secondary"
            />
            <Button
              title={t('order_modal_edit_save')}
              loading={financeSaving}
              onPress={() =>
                saveInlineFinanceField({
                  field: 'price',
                  rawValue: amountDraft,
                  onDone: () => setAmountEditModalVisible(false),
                })
              }
            />
          </View>
        </View>
      </Modal>

      <Modal
        isVisible={fuelEditModalVisible}
        onBackdropPress={() => setFuelEditModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
        onModalHide={applyNavBar}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>{t('order_modal_edit_fuel_title')}</Text>
          <TextField
            label={t('order_modal_edit_fuel_label')}
            value={fuelDraft}
            onChangeText={setFuelDraft}
            keyboardType="decimal-pad"
            placeholder={t('order_placeholder_amount')}
          />
          <View style={styles.modalActions}>
            <Button
              title={t('btn_cancel')}
              onPress={() => setFuelEditModalVisible(false)}
              variant="secondary"
            />
            <Button
              title={t('order_modal_edit_save')}
              loading={financeSaving}
              onPress={() =>
                saveInlineFinanceField({
                  field: 'fuel_cost',
                  rawValue: fuelDraft,
                  onDone: () => setFuelEditModalVisible(false),
                })
              }
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
    </>
  );
}

function createStyles(theme) {
  const sp = theme.spacing || {};
  const rad = theme.radii || {};
  const typo = theme.typography || {};
  const shadows = theme.shadows || {};

  return StyleSheet.create({
    contentWrap: {
      paddingHorizontal: sp.lg || 16,
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
    photoUnavailableTile: {
      width: 116,
      height: 116,
      borderRadius: rad.lg || 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: sp.sm || 8,
    },
    photoUnavailableTitle: {
      color: theme.colors.text,
      fontSize: typo.sizes?.xs || 12,
      fontWeight: typo.weight?.semibold || '600',
      textAlign: 'center',
    },
    photoUnavailableReason: {
      color: theme.colors.textSecondary,
      fontSize: typo.sizes?.xxs || 11,
      textAlign: 'center',
      marginTop: sp.xs || 4,
      lineHeight: (typo.sizes?.xxs || 11) + 4,
    },
    photoTileFrame: {
      width: 116,
      height: 116,
      borderRadius: rad.lg || 12,
      overflow: 'hidden',
    },
    photoLoadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.25)',
    },
  });
}
