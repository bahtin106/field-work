import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useLocalSearchParams, useNavigation, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  findNodeHandle,
  InteractionManager,
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

import Modal from 'react-native-modal';
import { useAuth } from '../../components/hooks/useAuth';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useSubscriptionGuard } from '../../hooks/useSubscriptionGuard';
import { useOrderMedia } from '../../hooks/useOrderMedia';
import dismissToRoute from '../../lib/navigation/dismissToRoute';
import goBackSmart from '../../lib/navigation/goBackSmart';
import { yandexDiskIntegration, yandexDiskMedia } from '../../lib/yandexDiskIntegration';
import { orderMediaStorage } from '../../lib/orderMediaStorage';
import { applyAndroidSystemBars } from '../../lib/systemBars';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../lib/workTypes';

import * as ImageManipulator from 'expo-image-manipulator';
import { FileSystemUploadType, uploadAsync as uploadFileAsync, downloadAsync, cacheDirectory } from 'expo-file-system/legacy';
import { encode as encodeBase64 } from 'base64-arraybuffer';

import AppHeader from '../../components/navigation/AppHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import SectionHeader from '../../components/ui/SectionHeader';
import TextField from '../../components/ui/TextField';
import LabelValueRow from '../../components/ui/LabelValueRow';
import ExpandableTextRow from '../../components/ui/ExpandableTextRow';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { buildAddressForNavigator, openAddressInYandex } from '../../components/ui/map';
import { usePermissions } from '../../lib/permissions';
import { formatClientNameForOrder, getClientByOrderId } from '../../src/features/clients/api';
import { useClient, useUpdateClientMutation } from '../../src/features/clients/queries';
import {
  ensureRequestAssigneeNamePrefetch,
  ensureRequestPrefetch,
  useRequest,
  useRequestRealtimeSync,
} from '../../src/features/requests/queries';
import { updateRequestWithVersion } from '../../src/features/requests/api';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import {
  buildOrderAddressDisplay,
  buildOrderAddressShort,
  extractOrderAddress,
  normalizeOrderAddressMode,
} from '../../src/features/requests/addressing';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getEntityFieldMap,
  toLegacySchemaFields,
} from '../../src/features/fieldSettings/catalog';
import { useEntityFieldSettings } from '../../src/features/fieldSettings/queries';
import { isValidOptionalMobilePhone, toE164MobilePhoneOrNull } from '../../src/shared/validation/phone';
import { useTranslation } from '../../src/i18n/useTranslation';
import { markFirstContent, markScreenMount } from '../../src/shared/perf/devMetrics';
import { useTheme } from '../../theme/ThemeProvider';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import OrderPhotosModal from './components/OrderPhotosModal';
import FullscreenImageViewer from './components/FullscreenImageViewer';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const PHOTO_MAX_WIDTH = 1280;
const PHOTO_COMPRESS_QUALITY = 0.8;
const PHOTO_MIME_TYPE = 'image/jpeg';
const YANDEX_URL_MARKERS = ['yadisk://', 'yadi.sk', 'disk.yandex'];
const REMOVED_ORDER_OBJECT_FIELDS = new Set([
  'country',
  'region',
  'city',
  'street',
  'house',
  'postal_code',
  'office',
  'floor',
  'entrance',
  'apartment',
  'entrance_info',
  'parking_notes',
  'geo_lat',
  'geo_lng',
]);

const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());
const REQUEST_SYNC_FIELDS = [
  'id',
  'updated_at',
  'status',
  'assigned_to',
  'client_id',
  'object_id',
  'time_window_start',
  'time_window_end',
  'title',
  'comment',
  'fio',
  'phone',
  'department_id',
  'work_type_id',
  'price',
  'fuel_cost',
  'urgent',
];

function isYandexMediaUrl(url) {
  const raw = String(url || '').toLowerCase();
  return YANDEX_URL_MARKERS.some((marker) => raw.includes(marker));
}

function isYandexProviderFailureMessage(rawMessage) {
  const message = String(rawMessage || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('quota') ||
    message.includes('diskfull') ||
    message.includes('no space') ||
    message.includes('not connected') ||
    message.includes('authorization expired') ||
    message.includes('reconnect') ||
    message.includes('invalid_grant') ||
    message.includes('unauthorized') ||
    message.includes('token refresh failed') ||
    message.includes('temporarily unavailable') ||
    message.includes('resource is locked') ||
    message.includes('cloud-api.yandex') ||
    message.includes('yandex disk')
  );
}

function shouldRetryDeleteWithAlternateProvider(rawMessage) {
  const message = String(rawMessage || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('media mapping not found') ||
    message.includes('media provider is not beget s3') ||
    message.includes('media provider is not yandex disk')
  );
}

export default function OrderDetails() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { has, loading: permsLoading } = usePermissions();
  const { settings: companySettings, useDepartureTime } = useCompanySettings();
  const auth = useAuth();
  const authUserId = auth.user?.id || null;
  const authRole = auth.profile?.role || null;
  const authCompanyId = auth.profile?.company_id || null;
  const mediaProvider = companySettings?.media_provider === 'yandex_disk' ? 'yandex_disk' : 'beget_s3';
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
  const { data: orderFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER, {
    enabled: !!id,
  });
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: !!id,
  });
  const updateClientMutation = useUpdateClientMutation();
  const firstContentTrackedRef = useRef(false);
  const lastRequestSyncRef = useRef('');

  const [order, setOrder] = useState(null);
  const [orderReady, setOrderReady] = useState(false);
  const [workTypesReady, setWorkTypesReady] = useState(false);
  const [role, setRole] = useState(null);
  const [userId, setUserId] = useState(null);
  const [executorName, setExecutorName] = useState(null);
  const [bannerMessage, setBannerMessage] = useState('');
  const [effectiveMediaProvider, setEffectiveMediaProvider] = useState(mediaProvider);
  const [cloudHealth, setCloudHealth] = useState('unknown');
  const [editMode, setEditMode] = useState(false);
  const [schemaEdit, setSchemaEdit] = useState({ context: 'edit', fields: [] });
  const orderFieldSettings = useMemo(
    () => orderFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER),
    [orderFieldSettingsData],
  );
  const objectFieldSettings = useMemo(
    () => objectFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [objectFieldSettingsData],
  );
  const orderFieldsByKey = useMemo(() => getEntityFieldMap(orderFieldSettings), [orderFieldSettings]);
  const objectFieldsByKey = useMemo(() => getEntityFieldMap(objectFieldSettings), [objectFieldSettings]);

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
  const isAdminUser = String(role || authRole || '').toLowerCase() === 'admin';
  const cloudFallbackActive =
    mediaProvider === 'yandex_disk' && effectiveMediaProvider === 'beget_s3';
  const cloudHealthLabel = useMemo(
    () =>
      t(
        `company_integrations_yandex_health_${cloudHealth}`,
        t('company_integrations_yandex_health_error'),
      ),
    [cloudHealth, t],
  );
  const normalizeId = useCallback((value) => {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
  }, []);
  const workTypeName = useMemo(() => {
    const normalized = normalizeId(workTypeId);
    const fallbackName =
      String(
        order?.work_type_name ||
          order?.work_type?.name ||
          requestData?.work_type_name ||
          requestData?.work_type?.name ||
          '',
      ).trim() || null;
    if (!normalized) return fallbackName;
    const found = workTypes.find((w) => normalizeId(w?.id) === normalized);
    return found?.name || fallbackName;
  }, [normalizeId, order?.work_type, order?.work_type_name, requestData?.work_type, requestData?.work_type_name, workTypeId, workTypes]);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [warningVisible, setWarningVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [assigneeModalVisible, setAssigneeModalVisible] = useState(false);
  const [departmentModalVisible, setDepartmentModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(5);
  const [deleteEnabled, setDeleteEnabled] = useState(false);
  const [orderPhotosModal, setOrderPhotosModal] = useState({ visible: false, category: null });
  const [amountEditModalVisible, setAmountEditModalVisible] = useState(false);
  const [fuelEditModalVisible, setFuelEditModalVisible] = useState(false);
  const [amountDraft, setAmountDraft] = useState('');
  const [fuelDraft, setFuelDraft] = useState('');
  const [financeSaving, setFinanceSaving] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const viewerRawPhotosRef = useRef([]);
  const viewerCategoryRef = useRef(null);
  const [viewerCategoryLabel, setViewerCategoryLabel] = useState('');
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);
  const [resolvedClientId, setResolvedClientId] = useState(null);
  const [localPendingMap, setLocalPendingMap] = useState({});
  const cloudFallbackNoticeShownRef = useRef(false);

  // ─── Centralised media hook (caching, resolution, Yandex/Storage) ───
  const orderMedia = useOrderMedia({ order, mediaProvider, t });
  // Stable ref so fetchData doesn't re-create when orderMedia resolves URLs
  const orderMediaRef = useRef(orderMedia);
  useEffect(() => { orderMediaRef.current = orderMedia; }, [orderMedia]);

  // Always-current order ref — prevents stale closures in parallel uploads
  const orderRef = useRef(order);
  useEffect(() => { orderRef.current = order; }, [order]);

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

  const notifyCloudFallback = useCallback(() => {
    if (cloudFallbackNoticeShownRef.current) return;
    cloudFallbackNoticeShownRef.current = true;
    showToast(
      isAdminUser
        ? t('order_cloud_fallback_admin_notice')
        : t('order_cloud_fallback_worker_notice'),
    );
  }, [isAdminUser, showToast, t]);

  useEffect(() => {
    setEffectiveMediaProvider(mediaProvider);
    if (mediaProvider !== 'yandex_disk') {
      setCloudHealth('ok');
      cloudFallbackNoticeShownRef.current = false;
    }
  }, [mediaProvider]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (mediaProvider !== 'yandex_disk') return undefined;

      (async () => {
        try {
          const status = await yandexDiskIntegration('status');
          if (cancelled) return;
          const connected = Boolean(status?.connected || status?.account);
          const healthCode = String(status?.health || (connected ? 'unknown' : 'not_connected'));
          setCloudHealth(healthCode);
          if (!connected || healthCode !== 'ok') {
            setEffectiveMediaProvider('beget_s3');
            notifyCloudFallback();
          } else {
            setEffectiveMediaProvider('yandex_disk');
            cloudFallbackNoticeShownRef.current = false;
          }
        } catch (_e) {
          if (cancelled) return;
          setCloudHealth('error');
          setEffectiveMediaProvider('beget_s3');
          notifyCloudFallback();
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [mediaProvider, notifyCloudFallback]),
  );

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

  // ─── Hydrate all form fields from order object (extracted to avoid duplication) ───
  const hydrateFormFields = useCallback((o) => {
    if (!o) return;
    const rawDigits = (
      (o.phone ?? o.customer_phone_visible ?? o.phone_visible) || ''
    ).replace(/\D/g, '');
    setTitle(o.title || '');
    setDescription(o.comment || '');
    setRegion(o.region || '');
    setCity(o.city || '');
    setStreet(o.street || '');
    setHouse(o.house || '');
    setCustomerName(o.fio || o.customer_name || '');
    setPhone(rawDigits || '');
    setDepartureDate(o.time_window_start ? new Date(o.time_window_start) : null);
    setAssigneeId(o.assigned_to || null);
    setToFeed(!o.assigned_to);
    setUrgent(!!o.urgent);
    setDepartmentId(o.department_id || null);
    setAmount(o.price !== null && o.price !== undefined ? String(o.price) : '');
    setGsm(o.fuel_cost !== null && o.fuel_cost !== undefined ? String(o.fuel_cost) : '');
    // Executor name from cache (instant)
    const cachedExecName = deriveExecutorNameInstant(o);
    if (cachedExecName) setExecutorName(cachedExecName);
  }, [deriveExecutorNameInstant]);


  const fetchData = useCallback(async () => {
    if (!id) {
      setOrderReady(true);
      return;
    }

    try {
      // ── 1. Auth: instant from context (no network) ────────────────
      const uid = authUserId;
      const currentRole = authRole;
      setUserId(uid);
      setRole(currentRole);

      // ── 2. Order data: show cache instantly, then refetch ─────────
      const cachedOrderRaw = queryClient.getQueryData(queryKeys.requests.detail(id));

      // If we have cached data and screen hasn't shown content yet, render instantly
      if (cachedOrderRaw && !firstContentTrackedRef.current) {
        const cachedOrder = { ...cachedOrderRaw, time_window_start: cachedOrderRaw.time_window_start ?? null };
        hydrateFormFields(cachedOrder);
        setOrder(cachedOrder);
        setWorkTypeId(cachedOrder.work_type_id ?? null);
        setOrderReady(true);
      }

      // Fetch fresh data in background
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

      const fetchedOrder = {
        ...fetchedOrderRaw,
        time_window_start: fetchedOrderRaw.time_window_start ?? null,
      };

      // ── 3. Fill missing fields IN PARALLEL (not sequential!) ──────
      const missingFieldsPromises = [];
      if (typeof fetchedOrder.department_id === 'undefined') {
        missingFieldsPromises.push(
          supabase.from('orders').select('department_id').eq('id', id).single()
            .then(({ data }) => { if (data) fetchedOrder.department_id = data.department_id || null; })
            .catch(() => {})
        );
      }
      if (typeof fetchedOrder.work_type_id === 'undefined' || fetchedOrder.work_type_id === null) {
        missingFieldsPromises.push(
          supabase.from('orders').select('work_type_id').eq('id', id).single()
            .then(({ data }) => { if (data) fetchedOrder.work_type_id = data.work_type_id ?? null; })
            .catch(() => {})
        );
      }
      if (missingFieldsPromises.length) await Promise.all(missingFieldsPromises);

      // ── 4. Auto-status "Новый"→"В работе" ────────────────────────
      let effectiveOrder = fetchedOrder;
      if (uid && fetchedOrder.status === 'Новый' && fetchedOrder.assigned_to === uid) {
        try {
          await updateRequestWithVersion(id, { status: 'В работе' }, fetchedOrder?.updated_at || null);
          queryClient.invalidateQueries({ queryKey: ['requests'] });
          queryClient.invalidateQueries({ queryKey: queryKeys.requests.detail(id) });
          const refreshed = await ensureRequestPrefetch(queryClient, id);
          effectiveOrder = refreshed || { ...fetchedOrder, status: 'В работе' };
        } catch (e) {
          console.warn('Persist status error:', e);
          effectiveOrder = fetchedOrder;
        }
      }

      // ── 5. Resolve media (async, non-blocking for screen) ────────
      // Show order + form immediately, resolve media in background
      hydrateFormFields(effectiveOrder);
      setOrder(effectiveOrder);
      setWorkTypeId(effectiveOrder.work_type_id ?? null);
      setOrderReady(true);

      // Media resolution + sync + secondary data — all in parallel, non-blocking
      const media = orderMediaRef.current;
      const bgTasks = [];

      // 5a. Yandex media resolution
      bgTasks.push(
        media.resolveOrder(effectiveOrder).then((inspected) => {
          if (inspected) setOrder(inspected);
        }).catch(() => {})
      );

      // 5b. Storage photo sync — only remove photos missing from storage, never add orphans
      bgTasks.push(
        media.syncPhotos(effectiveOrder.id).then((fresh) => {
          if (!fresh) return;
          setOrder((prev) => {
            const cats = ['contract_file', 'photo_before', 'photo_after', 'act_file'];
            const next = { ...prev };
            let changed = false;
            for (const cat of cats) {
              const dbPhotos = prev[cat] || [];
              if (!dbPhotos.length) continue;
              const storageSet = new Set(fresh[cat] || []);
              const filtered = dbPhotos.filter((url) => storageSet.has(url));
              if (filtered.length < dbPhotos.length) {
                next[cat] = filtered;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }).catch(() => {})
      );

      // 5c. Executor name
      if (effectiveOrder.assigned_to) {
        const cachedName = deriveExecutorNameInstant(effectiveOrder);
        if (cachedName) {
          setExecutorName(cachedName);
        } else {
          bgTasks.push(
            supabase.from('profiles').select('first_name, last_name').eq('id', effectiveOrder.assigned_to).single()
              .then(({ data: executorProfile }) => {
                if (executorProfile) {
                  const full = `${executorProfile.first_name || ''} ${executorProfile.last_name || ''}`.trim();
                  EXECUTOR_NAME_CACHE.set(effectiveOrder.assigned_to, full);
                  setExecutorName(full);
                }
              }).catch(() => {})
          );
        }
      }

      // 5d. Users list
      bgTasks.push(
        supabase.from('profiles').select('id, first_name, last_name, role')
          .in('role', ['worker', 'dispatcher', 'admin'])
          .order('last_name', { ascending: true })
          .then(({ data: execList }) => setUsers(execList || []))
          .catch(() => {})
      );

      // 5e. Departments
      const orderCompanyId = fetchedOrder?.company_id || authCompanyId || null;
      if (orderCompanyId) {
        bgTasks.push(
          (async () => {
            try {
              const { data: companyRow } = await supabase.from('companies').select('use_departments').eq('id', orderCompanyId).maybeSingle();
              const useDepartmentsEnabled = companyRow?.use_departments !== false;
              setUseDepartmentsFlag(useDepartmentsEnabled);
              if (useDepartmentsEnabled) {
                const { data: deptList } = await supabase.from('departments').select('id, name').eq('is_enabled', true).eq('company_id', orderCompanyId).order('name', { ascending: true });
                setDepartments(deptList || []);
              }
            } catch {}
          })()
        );
      } else {
        setUseDepartmentsFlag(false);
      }

      // Fire all background tasks in parallel — screen is already visible
      await Promise.allSettled(bgTasks);

      initialFormSnapshotRef.current = makeSnapshotFromOrder(effectiveOrder);
    } catch (e) {
      console.warn('Fetch data error:', e);
      setOrderReady(true);
    }
  }, [
    id,
    authUserId,
    authRole,
    authCompanyId,
    hydrateFormFields,
    makeSnapshotFromOrder,
    queryClient,
    refetchRequestData,
    deriveExecutorNameInstant,
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

  const uploadLocalUri = useCallback(
    async (category, uri, opts) => {
      const replaceUrl = opts?.replaceUrl || null;
      const silent = opts?.silent === true;
      try {
        const cur = orderRef.current;
        const orderId = cur?.id;
        if (!orderId) return false;

        const manipulated = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: PHOTO_MAX_WIDTH } }],
          { compress: PHOTO_COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
        );

        let ab = null;
        const ensureArrayBuffer = async () => {
          if (ab) return ab;
          const fallbackResp = await fetch(manipulated.uri);
          ab = await fallbackResp.arrayBuffer();
          return ab;
        };
        const uploadToBegetStorage = async () => {
          try {
            let data = null;
            let directUploadCompleted = false;
            try {
              const prepared = await orderMediaStorage('prepare_upload', {
                order_id: orderId,
                category,
                mime: PHOTO_MIME_TYPE,
              });
              const uploadUrl = String(prepared?.upload_url || '').trim();
              const uploadMethod = String(prepared?.upload_method || 'PUT').trim() || 'PUT';
              const uploadHeaders =
                prepared?.upload_headers && typeof prepared.upload_headers === 'object'
                  ? Object.fromEntries(
                      Object.entries(prepared.upload_headers)
                        .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
                        .filter(([key, value]) => key && value),
                    )
                  : {};
              if (!uploadUrl) throw new Error('prepare upload failed');

              const uploadRes = await uploadFileAsync(uploadUrl, manipulated.uri, {
                httpMethod: uploadMethod,
                headers: uploadHeaders,
                uploadType: FileSystemUploadType.BINARY_CONTENT,
              });
              if (!uploadRes || Number(uploadRes.status || 0) < 200 || Number(uploadRes.status || 0) >= 300) {
                throw new Error(String(uploadRes?.body || 'direct upload failed'));
              }
              directUploadCompleted = true;

              data = await orderMediaStorage('commit_upload', {
                order_id: orderId,
                category,
                object_key: prepared?.object_key || null,
                public_url: prepared?.public_url || null,
              });
            } catch (directError) {
              if (directUploadCompleted) throw directError;
              console.warn('[order-photo-upload] direct beget upload fallback', directError);
              const fallbackBuffer = await ensureArrayBuffer();
              data = await orderMediaStorage('upload', {
                order_id: orderId,
                category,
                file_base64: encodeBase64(fallbackBuffer),
                mime: PHOTO_MIME_TYPE,
              });
            }
            return {
              url: String(data?.url || ''),
              mediaUrls: Array.isArray(data?.media_urls)
                ? data.media_urls.map((value) => String(value || '')).filter(Boolean)
                : null,
              orderUpdatedAt: data?.order_updated_at ? String(data.order_updated_at) : null,
            };
          } catch (error) {
            console.warn('[order-photo-upload] beget upload error', error);
            return { url: '', mediaUrls: null, orderUpdatedAt: null };
          }
        };

        let publicUrl = '';
        let providerMediaUrls = null;
        let providerOrderUpdatedAt = null;
        if (effectiveMediaProvider === 'yandex_disk') {
          try {
            let data = null;
            let directUploadCompleted = false;
            try {
              const prepared = await yandexDiskMedia('prepare_upload', {
                order_id: orderId,
                category,
                mime: PHOTO_MIME_TYPE,
              });
              const uploadUrl = String(prepared?.upload_url || '').trim();
              const uploadMethod = String(prepared?.upload_method || 'PUT').trim() || 'PUT';
              const uploadHeaders =
                prepared?.upload_headers && typeof prepared.upload_headers === 'object'
                  ? Object.fromEntries(
                      Object.entries(prepared.upload_headers)
                        .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
                        .filter(([key, value]) => key && value),
                    )
                  : {};
              if (!uploadUrl) throw new Error('prepare upload failed');

              const uploadRes = await uploadFileAsync(uploadUrl, manipulated.uri, {
                httpMethod: uploadMethod,
                headers: uploadHeaders,
                uploadType: FileSystemUploadType.BINARY_CONTENT,
              });
              if (!uploadRes || Number(uploadRes.status || 0) < 200 || Number(uploadRes.status || 0) >= 300) {
                throw new Error(String(uploadRes?.body || 'direct upload failed'));
              }
              directUploadCompleted = true;

              data = await yandexDiskMedia('commit_upload', {
                order_id: orderId,
                category,
                external_path: prepared?.external_path || null,
              });
            } catch (directError) {
              if (directUploadCompleted) throw directError;
              console.warn('[order-photo-upload] direct yandex upload fallback', directError);
              const fallbackBuffer = await ensureArrayBuffer();
              data = await yandexDiskMedia('upload', {
                order_id: orderId,
                category,
                file_base64: encodeBase64(fallbackBuffer),
                mime: PHOTO_MIME_TYPE,
              });
            }
            publicUrl = String(data?.url || '');
            providerMediaUrls = Array.isArray(data?.media_urls)
              ? data.media_urls.map((value) => String(value || '')).filter(Boolean)
              : null;
            providerOrderUpdatedAt = data?.order_updated_at ? String(data.order_updated_at) : null;
            orderMediaRef.current.removeFromCache(publicUrl);
          } catch (e) {
            if (!isYandexProviderFailureMessage(e?.message || e)) throw e;
            setCloudHealth('error');
            setEffectiveMediaProvider('beget_s3');
            notifyCloudFallback();
            const result = await uploadToBegetStorage();
            publicUrl = result.url;
            providerMediaUrls = result.mediaUrls;
            providerOrderUpdatedAt = result.orderUpdatedAt;
          }
        } else {
          const result = await uploadToBegetStorage();
          publicUrl = result.url;
          providerMediaUrls = result.mediaUrls;
          providerOrderUpdatedAt = result.orderUpdatedAt;
        }

        if (!publicUrl) {
          if (!silent) showToast(t('order_toast_upload_error'));
          return false;
        }

        // Read the LATEST photos from ref (not stale closure) to build the updated array
        const latest = orderRef.current;
        const buildUpdated = (arr) => {
          const list = [...(arr || [])];
          if (replaceUrl) {
            const ri = list.indexOf(replaceUrl);
            if (ri >= 0) {
              list[ri] = publicUrl;
              return list;
            }
          }
          if (providerMediaUrls) return [...providerMediaUrls];
          // Prepend new photos so they appear at the start
          if (!list.includes(publicUrl)) list.unshift(publicUrl);
          return list;
        };
        const updated = buildUpdated(latest[category]);
        try {
          if (replaceUrl || !providerMediaUrls) {
            await updateRequestWithVersion(
              orderId,
              { [category]: updated },
              providerOrderUpdatedAt || latest?.updated_at || null,
            );
          }
          setOrder((o) => ({ ...o, [category]: buildUpdated(o[category]) }));
          queryClient.setQueryData(queryKeys.requests.detail(orderId), (old) => {
            if (!old) return old;
            return { ...old, [category]: buildUpdated(old[category]) };
          });
          return true;
        } catch (e) {
          if (replaceUrl && publicUrl) {
            try {
              const payload = { order_id: orderId, category, url: publicUrl };
              const tryYandex = () => yandexDiskMedia('delete', payload);
              const tryBeget = () => orderMediaStorage('delete', payload);
              const preferYandex = isYandexMediaUrl(publicUrl);

              try {
                await (preferYandex ? tryYandex() : tryBeget());
              } catch (primaryError) {
                if (!shouldRetryDeleteWithAlternateProvider(primaryError?.message || primaryError)) {
                  throw primaryError;
                }
                await (preferYandex ? tryBeget() : tryYandex());
              }
            } catch (cleanupError) {
              console.warn('[uploadLocalUri] rollback cleanup failed:', cleanupError);
            }
          }
          return false;
        }
      } catch (e) {
        console.warn('uploadLocalUri error', e);
        return false;
      }
    },
    [effectiveMediaProvider, notifyCloudFallback, queryClient, showToast, t],
  );

  const compressAndUploadMultiple = useCallback(
    async (category, uris = [], options = {}) => {
      if (!uris.length) return;
      const onItemSettled =
        options && typeof options.onItemSettled === 'function' ? options.onItemSettled : null;
      // Sequential uploads to avoid DB race conditions (each upload reads latest state via orderRef)
      let ok = 0;
      for (const uri of uris) {
        try {
          const success = await uploadLocalUri(category, uri);
          if (success) ok++;
        } catch (e) {
          console.warn('[compressAndUploadMultiple] single upload failed', e);
        } finally {
          try {
            onItemSettled?.(uri);
          } catch {}
        }
      }
      if (ok > 0) {
        showToast(
          ok === 1
            ? t('order_toast_photo_uploaded')
            : t('order_toast_photos_uploaded', 'Загружено {count} фото').replace('{count}', String(ok)),
        );
      }
    },
    [uploadLocalUri, showToast, t],
  );

  const deleteOrderMediaByUrl = useCallback(async (orderId, category, url) => {
    const payload = { order_id: orderId, category, url };
    const tryYandex = () => yandexDiskMedia('delete', payload);
    const tryBeget = () => orderMediaStorage('delete', payload);
    const preferYandex = isYandexMediaUrl(url);

    try {
      return preferYandex ? await tryYandex() : await tryBeget();
    } catch (primaryError) {
      if (!shouldRetryDeleteWithAlternateProvider(primaryError?.message || primaryError)) {
        throw primaryError;
      }
      return preferYandex ? await tryBeget() : await tryYandex();
    }
  }, []);

  const removePhoto = useCallback(
    (category, index) => {
      const cur = orderRef.current;
      const orderId = cur?.id;
      if (!orderId) return;

      const photos = cur[category] || [];
      const removed = photos[index];
      if (!removed) return;

      // Optimistic: remove from UI immediately
      const filterOut = (arr) => (arr || []).filter((u) => u !== removed);
      setOrder((prev) => ({ ...prev, [category]: filterOut(prev[category]) }));
      orderMediaRef.current.removeFromCache(removed);
      queryClient.setQueryData(queryKeys.requests.detail(orderId), (old) => {
        if (!old) return old;
        return { ...old, [category]: filterOut(old[category]) };
      });

      // Background: actual deletion
      const rollback = () => {
        setOrder((prev) => {
          const arr = prev[category] || [];
          if (arr.includes(removed)) return prev;
          const restored = [...arr];
          restored.splice(index, 0, removed);
          return { ...prev, [category]: restored };
        });
        queryClient.setQueryData(queryKeys.requests.detail(orderId), (old) => {
          if (!old) return old;
          const arr = old[category] || [];
          if (arr.includes(removed)) return old;
          const restored = [...arr];
          restored.splice(index, 0, removed);
          return { ...old, [category]: restored };
        });
        showToast(t('order_toast_delete_error'));
      };

      (async () => {
        try {
          const updated = filterOut(cur[category]);

          const data = await deleteOrderMediaByUrl(orderId, category, removed);
          const mediaUrls = Array.isArray(data?.media_urls)
            ? data.media_urls.map((value) => String(value || '')).filter(Boolean)
            : null;
          if (!mediaUrls) {
            await updateRequestWithVersion(orderId, { [category]: updated }, cur?.updated_at || null);
          }
        } catch (e) {
          console.warn('[removePhoto] background deletion failed:', e);
          rollback();
        }
      })();
    },
    [queryClient, showToast, t, deleteOrderMediaByUrl],
  );

  const removePhotosBatch = useCallback(
    (category, urls = []) => {
      const cur = orderRef.current;
      const orderId = cur?.id;
      if (!orderId) return;

      const selected = (urls || []).map((value) => String(value || '')).filter(Boolean);
      if (!selected.length) return;

      const originalPhotos = Array.isArray(cur?.[category]) ? [...cur[category]] : [];
      const selectedSet = new Set(selected);
      const nextPhotos = originalPhotos.filter((url) => !selectedSet.has(String(url)));
      const buildPersistedPhotos = (failedUrls = []) => {
        const failedSet = new Set((failedUrls || []).map((value) => String(value || '')));
        return originalPhotos.filter(
          (url) => !selectedSet.has(String(url)) || failedSet.has(String(url)),
        );
      };

      setOrder((prev) => ({ ...prev, [category]: nextPhotos }));
      for (const url of selected) {
        orderMediaRef.current.removeFromCache(url);
      }
      queryClient.setQueryData(queryKeys.requests.detail(orderId), (old) => {
        if (!old) return old;
        return { ...old, [category]: nextPhotos };
      });

      const restoreFailed = (failedUrls) => {
        const failedSet = new Set((failedUrls || []).map((value) => String(value || '')));
        if (!failedSet.size) return;

        setOrder((prev) => {
          const currentPhotos = Array.isArray(prev?.[category]) ? prev[category] : [];
          const restored = [];
          for (const photo of originalPhotos) {
            if (!selectedSet.has(String(photo)) || failedSet.has(String(photo))) {
              restored.push(photo);
            }
          }
          for (const photo of currentPhotos) {
            if (!restored.includes(photo)) restored.push(photo);
          }
          return { ...prev, [category]: restored };
        });

        queryClient.setQueryData(queryKeys.requests.detail(orderId), (old) => {
          if (!old) return old;
          const currentPhotos = Array.isArray(old?.[category]) ? old[category] : [];
          const restored = [];
          for (const photo of originalPhotos) {
            if (!selectedSet.has(String(photo)) || failedSet.has(String(photo))) {
              restored.push(photo);
            }
          }
          for (const photo of currentPhotos) {
            if (!restored.includes(photo)) restored.push(photo);
          }
          return { ...old, [category]: restored };
        });
      };

      (async () => {
        const failedUrls = [];
        for (const removed of selected) {
          try {
            const updated = buildPersistedPhotos(failedUrls);
            const data = await deleteOrderMediaByUrl(orderId, category, removed);
            const mediaUrls = Array.isArray(data?.media_urls)
              ? data.media_urls.map((value) => String(value || '')).filter(Boolean)
              : null;
            if (!mediaUrls) {
              await updateRequestWithVersion(orderId, { [category]: updated }, cur?.updated_at || null);
            }
          } catch (error) {
            console.warn('[removePhotosBatch] background deletion failed:', error);
            failedUrls.push(removed);
          }
        }

        if (failedUrls.length) {
          restoreFailed(failedUrls);
          showToast(
            failedUrls.length === selected.length
              ? t('order_toast_delete_error')
              : t('order_toast_delete_partial_error', 'Часть фото удалить не удалось'),
          );
        }
      })();
    },
    [queryClient, showToast, t, deleteOrderMediaByUrl],
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
    const clientIdForContacts = order?.client_id ? String(order.client_id) : resolvedClientId;
    if (!clientIdForContacts) return showWarning(t('order_validation_client_required'));
    if (!phone.trim()) return showWarning(t('order_validation_phone_required'));
    if (!departureDate) return showWarning(t('order_validation_date_required'));
    if (!assigneeId && !toFeed) return showWarning(t('order_validation_executor_required'));

    if (!isValidOptionalMobilePhone(phone)) {
      return showWarning(t('order_validation_phone_format'));
    }
    const normalizedPhone = toE164MobilePhoneOrNull(phone);
    if (!normalizedPhone) return showWarning(t('order_validation_phone_format'));

    const nextStatus = toFeed
      ? t('order_status_in_feed')
      : order.status === t('order_status_in_feed')
        ? t('order_status_in_progress')
        : order.status;

    const payload = {
      title,
      comment: description,
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
      await updateClientMutation.mutateAsync({
        id: clientIdForContacts,
        patch: {
          phone: normalizedPhone,
        },
      });
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
      const rawDigitsSaved = ((data.customer_phone_visible || data.phone_visible) || '').replace(/\D/g, '');
      setTitle(data.title || '');
      setDescription(data.comment || '');
      setRegion(data.region || '');
      setCity(data.city || '');
      setStreet(data.street || '');
      setHouse(data.house || '');
      setCustomerName(formatClientNameForOrder(linkedClient) || '');
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
    linkedClient,
    resolvedClientId,
    updateClientMutation,
  ]);

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

      const deletedOrderClientId = String(order?.client_id || resolvedClientId || '').trim();
      if (deletedOrderClientId) {
        queryClient.invalidateQueries({
          queryKey: ['clients', 'delete-blockers', deletedOrderClientId],
        });
      }
      queryClient.invalidateQueries({
        queryKey: ['clients', 'delete-blockers'],
      });

      showToast(t('order_toast_order_deleted'));
      setDeleteModalVisible(false);
      goBackSmart(
        navigation,
        router,
        backTargetPath ? { pathname: backTargetPath, params: returnParams } : null,
        '/orders',
      );
    } catch (e) {
      console.warn('Delete error:', e);
      showToast(t('order_toast_delete_error'));
    }
  }, [order, resolvedClientId, queryClient, navigation, router, showToast, t, mediaProvider, backTargetPath, returnParams]);

  const goBack = useCallback(() => {
    if (editMode) {
      requestCloseEdit();
      return;
    }
    goBackSmart(
      navigation,
      router,
      returnTo && backTargetPath !== pathname ? { pathname: backTargetPath, params: returnParams } : null,
      '/orders/my-orders',
    );
  }, [editMode, returnTo, backTargetPath, pathname, navigation, router, returnParams, requestCloseEdit]);

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

  // ─── Photo viewer (uses FullscreenImageViewer) ────────────────────
  const openViewer = useCallback(
    (photos, index, category, label) => {
      if (!Array.isArray(photos) || !photos.length) return;
      const pairs = photos
        .map((raw) => ({ raw, display: orderMedia.getDisplayUrl(raw) }))
        .filter((p) => p.display);
      viewerRawPhotosRef.current = pairs.map((p) => p.raw);
      viewerCategoryRef.current = category || null;
      setViewerCategoryLabel(label || '');
      setViewerPhotos(pairs.map((p) => p.display));
      setViewerIndex(Math.min(index, pairs.length - 1));
      setViewerVisible(true);
    },
    [orderMedia],
  );

  const closeViewer = useCallback(() => {
    setViewerVisible(false);
  }, []);

  const handleViewerDelete = useCallback(
    (viewerIdx) => {
      const category = viewerCategoryRef.current;
      const rawPhotos = viewerRawPhotosRef.current;
      if (!category || !rawPhotos?.[viewerIdx]) return;

      const rawUrl = rawPhotos[viewerIdx];
      viewerRawPhotosRef.current = rawPhotos.filter((_, i) => i !== viewerIdx);

      const orderPhotos = orderRef.current?.[category] || [];
      const realIndex = orderPhotos.indexOf(rawUrl);
      if (realIndex >= 0) removePhoto(category, realIndex);
    },
    [removePhoto],
  );

  const handleViewerRotateSave = useCallback(
    (rotationsMap) => {
      const category = viewerCategoryRef.current;
      const rawPhotos = [...(viewerRawPhotosRef.current || [])];
      if (!category || !rawPhotos.length) return;

      // Fire-and-forget — runs entirely in background
      (async () => {
        for (const [indexStr, degrees] of Object.entries(rotationsMap)) {
          if (!degrees) continue;
          const idx = Number(indexStr);
          const rawUrl = rawPhotos[idx];
          if (!rawUrl) continue;

          try {
            const displayUrl = orderMediaRef.current.getDisplayUrl(rawUrl) || rawUrl;
            const localPath = `${cacheDirectory}rotate_src_${Date.now()}.jpg`;
            const { uri: localUri } = await downloadAsync(displayUrl, localPath);

            const manipulated = await ImageManipulator.manipulateAsync(
              localUri,
              [{ rotate: degrees }],
              { compress: PHOTO_COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
            );

            // Replace in place — the old URL is swapped for the new one at the same index
            const success = await uploadLocalUri(category, manipulated.uri, { replaceUrl: rawUrl });
            if (success) {
              // Delete old file from storage in background
              const orderId = orderRef.current?.id;
              if (orderId) {
                try {
                  if (isYandexMediaUrl(rawUrl)) {
                    await yandexDiskMedia('delete', { order_id: orderId, category, url: rawUrl });
                  } else {
                    await orderMediaStorage('delete', { order_id: orderId, category, url: rawUrl });
                  }
                } catch (delErr) {
                  console.warn('[Viewer] old rotated file cleanup:', delErr);
                }
              }
              orderMediaRef.current.removeFromCache(rawUrl);
            }
          } catch (e) {
            console.warn('[Viewer] rotate save error:', e);
          }
        }
      })();
    },
    [uploadLocalUri],
  );

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

  // ─── Photo permissions (must be before handlePhotoRowAdd!) ────────
  const canAddCameraPhotos = has('canAddCameraPhotos');
  const canAddGalleryPhotos = has('canAddGalleryPhotos');
  const canAddAnyPhotos = canAddCameraPhotos || canAddGalleryPhotos;

  // ─── Photo row add handler ────────────────────────────────────────
  const handlePhotoRowAdd = useCallback(
    (category) => {
      if (!canAddAnyPhotos) {
        showToast(t('order_photo_add_not_allowed'));
        return;
      }
      setOrderPhotosModal({ visible: true, category });
    },
    [canAddAnyPhotos, showToast, t],
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

  const handleUploadUri = useCallback(
    async (category, uri) => {
      const id = `local:${Date.now()}`;
      setLocalPendingMap((p) => ({ ...(p || {}), [category]: [...((p && p[category]) || []), { id, uri, pending: true }] }));
      try {
        await uploadLocalUri(category, uri);
      } catch (e) {
        console.warn('handleUploadUri error', e);
      } finally {
        setLocalPendingMap((p) => ({ ...(p || {}), [category]: ((p && p[category]) || []).filter((x) => x.uri !== uri) }));
      }
    },
    [uploadLocalUri],
  );

  const handleUploadMultiple = useCallback(
    async (category, uris = []) => {
      const ids = uris.map((u) => ({ id: `local:${Date.now()}_${Math.random()}`, uri: u, pending: true }));
      setLocalPendingMap((p) => ({ ...(p || {}), [category]: [...((p && p[category]) || []), ...ids] }));
      try {
        await compressAndUploadMultiple(category, uris, {
          onItemSettled: (uri) => {
            setLocalPendingMap((p) => ({
              ...(p || {}),
              [category]: ((p && p[category]) || []).filter((x) => x.uri !== uri),
            }));
          },
        });
      } catch (e) {
        console.warn('handleUploadMultiple error', e);
      } finally {
        setLocalPendingMap((p) => ({
          ...(p || {}),
          [category]: ((p && p[category]) || []).filter((x) => !ids.find((y) => y.id === x.id)),
        }));
      }
    },
    [compressAndUploadMultiple],
  );

  useEffect(() => {
    const fields = toLegacySchemaFields(orderFieldSettings).filter(
      (field) => !REMOVED_ORDER_OBJECT_FIELDS.has(String(field?.field_key || '')),
    );
    setSchemaEdit({ context: 'edit', fields });
  }, [orderFieldSettings]);

  useEffect(() => {
    fetchData();
  }, [id, fetchData]);

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

      if (
        returnTo &&
        !isNavigatingRef.current &&
        backTargetPath !== pathname &&
        !(typeof navigation?.canGoBack === 'function' && navigation.canGoBack())
      ) {
        e.preventDefault();
        isNavigatingRef.current = true;
        dismissToRoute(router, { pathname: backTargetPath, params: returnParams });
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

  // Короткая версия для заголовка native (обязательно строка — чтобы не ломать Screen/header)
  const fullTitle = order?.title || t('routes.orders/[id]', 'routes.orders/[id]');
  const shortTitle = useMemo(() => {
    if (!fullTitle) return '';
    const max = 36;
    return fullTitle.length > max ? `${fullTitle.slice(0, max - 1).trim()}…` : fullTitle;
  }, [fullTitle]);
  const descriptionValue = useMemo(() => String(order?.comment ?? '').trim(), [order?.comment]);
  const canViewClients = has('canViewClients');
  const canViewObjects = has('canViewObjects');
  const linkedClientId = order?.client_id ? String(order.client_id) : resolvedClientId;
  const linkedObjectId = order?.object_id ? String(order.object_id) : null;
  const { data: linkedClient } = useClient(linkedClientId, {
    enabled: !!linkedClientId && canViewClients,
  });
  const customerDisplayName = useMemo(() => {
    const liveClientName = formatClientNameForOrder(linkedClient);
    if (liveClientName) return liveClientName;
    const savedCustomerName = String(order?.fio || order?.customer_name || customerName || '').trim();
    if (savedCustomerName) return savedCustomerName;
    return '';
  }, [customerName, linkedClient, order?.customer_name, order?.fio]);
  const orderAddress = useMemo(() => extractOrderAddress(order), [order]);
  const shortOrderAddress = useMemo(() => buildOrderAddressShort(orderAddress), [orderAddress]);
  const orderAddressForNavigator = useMemo(() => buildAddressForNavigator(orderAddress), [orderAddress]);
  const orderAddressItems = useMemo(
    () =>
      [
        [t('order_field_country'), orderAddress.country],
        [t('order_field_region'), orderAddress.region],
        [t('order_field_district'), orderAddress.district],
        [t('order_field_city'), orderAddress.city],
        [t('order_field_street'), orderAddress.street],
        [t('order_field_house'), orderAddress.house],
        [t('order_field_office'), orderAddress.office],
        [t('order_field_floor'), orderAddress.floor],
        [t('order_field_entrance'), orderAddress.entrance],
        [t('order_field_apartment'), orderAddress.apartment],
        [t('order_field_postal_code'), orderAddress.postal_code],
        [t('order_field_entrance_info'), orderAddress.entrance_info],
        [t('order_field_parking_notes'), orderAddress.parking_notes],
        [t('order_field_geo_lat'), orderAddress.geo_lat],
        [t('order_field_geo_lng'), orderAddress.geo_lng],
      ]
        .filter(([label]) => {
          const keyMap = {
            [t('order_field_country')]: 'country',
            [t('order_field_region')]: 'region',
            [t('order_field_district')]: 'district',
            [t('order_field_city')]: 'city',
            [t('order_field_street')]: 'street',
            [t('order_field_house')]: 'house',
            [t('order_field_office')]: 'office',
            [t('order_field_floor')]: 'floor',
            [t('order_field_entrance')]: 'entrance',
            [t('order_field_apartment')]: 'apartment',
            [t('order_field_postal_code')]: 'postal_code',
            [t('order_field_entrance_info')]: 'entrance_info',
            [t('order_field_parking_notes')]: 'parking_notes',
            [t('order_field_geo_lat')]: 'geo_lat',
            [t('order_field_geo_lng')]: 'geo_lng',
          };
          const fieldKey = keyMap[label];
          return fieldKey ? objectFieldsByKey.get(fieldKey)?.isEnabled !== false : true;
        })
        .filter(([, value]) => String(value || '').trim().length > 0)
        .map(([label, value]) => ({ label, value: String(value || '').trim() })),
    [objectFieldsByKey, orderAddress, t],
  );
  const normalizedAddressMode = useMemo(
    () => normalizeOrderAddressMode(order?.address_mode),
    [order?.address_mode],
  );
  const isObjectDeleted = normalizedAddressMode === 'object' && !linkedObjectId;
  const objectRowValue = useMemo(() => {
    if (linkedObjectId) return String(order?.object_name || '').trim();
    if (isObjectDeleted) return t('objects_deleted');
    if (normalizedAddressMode === 'custom') return t('order_address_custom_mode');
    return '';
  }, [isObjectDeleted, linkedObjectId, normalizedAddressMode, order?.object_name, t]);

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
    router.push({
      pathname: `/clients/${linkedClientId}`,
      params: {
        returnTo: `/orders/${order?.id}`,
        returnParams: JSON.stringify({}),
      },
    });
  }, [canViewClients, linkedClientId, order?.id, router]);
  const onOpenObject = useCallback(() => {
    if (!linkedObjectId || !canViewObjects) return;
    router.push({
      pathname: `/objects/${linkedObjectId}`,
      params: {
        returnTo: `/orders/${order?.id}`,
        returnParams: JSON.stringify({}),
      },
    });
  }, [canViewObjects, linkedObjectId, order?.id, router]);

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
  const canViewOrderAmount = has('canViewOrderAmount');
  const canEditOrderAmount = canViewOrderAmount && has('canEditOrderAmount');
  const canViewOrderFuelCost = has('canViewOrderFuelCost');
  const canEditOrderFuelCost = canViewOrderFuelCost && has('canEditOrderFuelCost');
  const canViewFinanceSection = canViewOrderAmount || canViewOrderFuelCost;

  return (
    <>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        edges={['left', 'right']}
      >
      <AppHeader
        back
        onBackPress={goBack}
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
                  <View style={[styles.statusChip, { backgroundColor: statusMeta.bg, opacity: 0.6 }]}>
                    <Text style={[styles.statusChipText, { color: statusMeta.fg }]}>
                      {order.status}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={base.sep} />

              {orderFieldsByKey.get('assigned_to')?.isEnabled !== false ? (
              <Pressable
                style={base.row}
                onPress={() => {
                  const assignee = order?.assigned_to || null;
                  if (!assignee) return;
                  // allow opening own profile always; others require permission
                  const allowed = String(assignee) === String(auth.user?.id) || has('canViewClients');
                  if (!allowed) return;
                  router.push(`/users/${assignee}`);
                }}
                disabled={!order?.assigned_to || !(String(order?.assigned_to) === String(auth.user?.id) || has('canViewClients'))}
              >
                <Text style={base.label}>{t('order_details_executor')}</Text>
                <View style={base.rightWrap}>
                  {deriveExecutorNameInstant(order) || executorName ? (
                    <Text style={[base.value, order?.assigned_to && (String(order?.assigned_to) === String(auth.user?.id) || has('canViewClients')) ? styles.link : null]}>
                      {deriveExecutorNameInstant(order) || executorName}
                    </Text>
                  ) : (
                    <Text style={[base.value, { color: theme.colors.textSecondary }]}>
                      {t('order_details_not_assigned')}
                    </Text>
                  )}
                </View>
              </Pressable>
              ) : null}
              {orderFieldsByKey.get('assigned_to')?.isEnabled !== false ? <View style={base.sep} /> : null}

              {orderFieldsByKey.get('work_type_id')?.isEnabled !== false ? (
              <View style={base.row}>
                <Text style={base.label}>{t('order_details_work_type')}</Text>
                <View style={base.rightWrap}>
                  <Text style={base.value}>
                    {workTypeName || t('order_details_work_type_not_selected')}
                  </Text>
                </View>
              </View>
              ) : null}
              {orderFieldsByKey.get('work_type_id')?.isEnabled !== false ? <View style={base.sep} /> : null}

              {orderFieldsByKey.get('time_window_start')?.isEnabled !== false ? (
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
                      returnTo: `/orders/${order.id}`,
                      returnParams: JSON.stringify({}),
                    },
                  });
                }}
              >
                <Text style={base.label}>{t('order_details_departure_date')}</Text>
                <View style={base.rightWrap}>
                  <Text style={[base.value, styles.link]}>
                    {(() => {
                      if (!order.time_window_start) return t('order_details_departure_not_specified');
                      const startDate = new Date(order.time_window_start);
                      const hasRangeEnd = !!order.time_window_end;
                      if (!hasRangeEnd) {
                        return format(
                          startDate,
                          useDepartureTime ? 'd MMMM yyyy, HH:mm' : 'd MMMM yyyy',
                          { locale: ru },
                        );
                      }
                      const endDate = new Date(order.time_window_end);
                      return `${format(startDate, 'd MMMM yyyy', { locale: ru })} — ${format(endDate, 'd MMMM yyyy', { locale: ru })}`;
                    })()}
                  </Text>
                </View>
              </Pressable>
              ) : null}
              {orderFieldsByKey.get('time_window_start')?.isEnabled !== false ? <View style={base.sep} /> : null}

              {orderFieldsByKey.get('comment')?.isEnabled !== false ? (
              <ExpandableTextRow
                label={t('order_details_description')}
                value={descriptionValue || t('order_details_description_empty')}
              />
              ) : null}
            </Card>

            <SectionHeader topSpacing="xs" bottomSpacing="xs">
              {t('order_details_object_data')}
            </SectionHeader>
            <Card paddedXOnly>
              {orderFieldsByKey.get('client_id')?.isEnabled !== false ? (
              <Pressable style={base.row} onPress={onOpenClient} disabled={!linkedClientId || !canViewClients}>
                <Text style={base.label}>{t('order_details_customer')}</Text>
                <View style={base.rightWrap}>
                  <Text style={[base.value, linkedClientId && canViewClients ? styles.link : null]}>
                    {customerDisplayName}
                  </Text>
                </View>
              </Pressable>
              ) : null}
              {orderFieldsByKey.get('client_id')?.isEnabled !== false ? <View style={base.sep} /> : null}

              {orderFieldsByKey.get('object_id')?.isEnabled !== false ? (
              <Pressable style={base.row} onPress={onOpenObject} disabled={!linkedObjectId || !canViewObjects}>
                <Text style={base.label}>{t('routes_objects_object')}</Text>
                <View style={base.rightWrap}>
                  <Text
                    style={[
                      base.value,
                      linkedObjectId && canViewObjects ? styles.link : null,
                      isObjectDeleted ? styles.deletedObjectText : null,
                    ]}
                  >
                    {objectRowValue}
                  </Text>
                </View>
              </Pressable>
              ) : null}
              {(orderFieldsByKey.get('object_id')?.isEnabled !== false && orderAddressItems.length > 0) ? <View style={base.sep} /> : null}
              {orderAddressItems.length > 0 ? (
              <ExpandableTextRow
                label={t('order_details_address')}
                value={orderAddressItems.map((item) => `${item.label}: ${item.value}`).join(', ')}
                collapsedValue={buildOrderAddressDisplay(orderAddress) || shortOrderAddress || t('order_details_address_not_specified')}
                expandedKeyValueItems={orderAddressItems}
                expandedActionText={orderAddressForNavigator ? t('order_address_map') : null}
                collapsedValueStyle={styles.link}
                onValuePress={
                  orderAddressForNavigator
                    ? () => {
                        openAddressInYandex(orderAddressForNavigator);
                      }
                    : null
                }
                onCollapsedPress={
                  orderAddressForNavigator
                    ? () => {
                        openAddressInYandex(orderAddressForNavigator);
                      }
                    : null
                }
                forceShow
              />
              ) : null}
              {(orderAddressItems.length > 0 || orderFieldsByKey.get('object_id')?.isEnabled !== false) && (orderFieldsByKey.get('secondary_phone')?.isEnabled !== false || orderFieldsByKey.get('contact_email')?.isEnabled !== false) ? <View style={base.sep} /> : null}
              {orderFieldsByKey.get('secondary_phone')?.isEnabled !== false ? (
              <LabelValueRow
                label={t('order_field_secondary_phone')}
                value={order?.secondary_phone}
              />
              ) : null}
              {orderFieldsByKey.get('secondary_phone')?.isEnabled !== false && orderFieldsByKey.get('contact_email')?.isEnabled !== false ? <View style={base.sep} /> : null}
              {orderFieldsByKey.get('contact_email')?.isEnabled !== false ? <LabelValueRow label={t('order_field_contact_email')} value={order?.contact_email} /> : null}
            </Card>

            {canViewFinanceSection && (orderFieldsByKey.get('price')?.isEnabled !== false || orderFieldsByKey.get('fuel_cost')?.isEnabled !== false) ? (
              <>
                <SectionHeader topSpacing="xs" bottomSpacing="xs">
                  {t('order_details_finance_data')}
                </SectionHeader>
                <Card paddedXOnly>
                  {canViewOrderAmount && orderFieldsByKey.get('price')?.isEnabled !== false ? (
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

                  {canViewOrderAmount && orderFieldsByKey.get('price')?.isEnabled !== false && canViewOrderFuelCost && orderFieldsByKey.get('fuel_cost')?.isEnabled !== false ? <View style={base.sep} /> : null}

                  {canViewOrderFuelCost && orderFieldsByKey.get('fuel_cost')?.isEnabled !== false ? (
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

            {!isFree && (
              <>
                <SectionHeader topSpacing="xs" bottomSpacing="xs">
                  {t('order_details_photos_section', 'Фото')}
                </SectionHeader>
                {cloudFallbackActive ? (
                  <Text style={styles.cloudWarningText}>
                    {isAdminUser
                      ? `${t('order_cloud_fallback_admin_notice')} (${cloudHealthLabel})`
                      : t('order_cloud_fallback_worker_notice')}
                  </Text>
                ) : null}
                <Card paddedXOnly>
                  {[
                    { key: 'contract_file', label: t('order_details_contract_photo') },
                    { key: 'photo_before', label: t('order_details_photo_before') },
                    { key: 'photo_after', label: t('order_details_photo_after') },
                    { key: 'act_file', label: t('order_details_act') },
                  ].map((row, idx, arr) => {
                    const count = (order?.[row.key] || []).length + (localPendingMap[row.key] || []).length;
                    return (
                      <View key={row.key}>
                        {idx > 0 && <View style={base.sep} />}
                        <Pressable
                          style={({ pressed }) => [base.row, pressed && { opacity: 0.7 }]}
                          onPress={() => setOrderPhotosModal({ visible: true, category: row.key })}
                        >
                          <Text style={base.label}>{row.label}</Text>
                          <View style={base.rightWrap}>
                            <Text style={base.value}>
                              {t('order_photos_count', '{count} фото').replace('{count}', String(count))}
                            </Text>
                            <Feather
                              name="chevron-right"
                              size={theme.icons?.sm ?? 18}
                              color={theme.colors.textSecondary}
                              style={{ marginLeft: theme.spacing.xs }}
                            />
                          </View>
                        </Pressable>
                      </View>
                    );
                  })}
                </Card>
              </>
            )}

            <OrderPhotosModal
              visible={orderPhotosModal.visible}
              onClose={() => setOrderPhotosModal({ visible: false, category: null })}
              category={orderPhotosModal.category}
              photos={order?.[orderPhotosModal.category] || []}
              pending={localPendingMap[orderPhotosModal.category] || []}
              getDisplayUrl={orderMedia.getDisplayUrl}
              getIssue={orderMedia.getIssue}
              onUploadUri={handleUploadUri}
              onUploadMultiple={handleUploadMultiple}
              onRemove={removePhoto}
              onRemoveMany={removePhotosBatch}
              onOpenViewer={(photos, idx) => {
                const catLabels = {
                  contract_file: t('order_details_contract_photo'),
                  photo_before: t('order_details_photo_before'),
                  photo_after: t('order_details_photo_after'),
                  act_file: t('order_details_act'),
                };
                openViewer(photos, idx, orderPhotosModal.category, catLabels[orderPhotosModal.category] || '');
              }}
            />

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

      <FullscreenImageViewer
        visible={viewerVisible}
        images={viewerPhotos}
        initialIndex={viewerIndex}
        onClose={closeViewer}
        onDelete={handleViewerDelete}
        onRotateSave={handleViewerRotateSave}
        categoryLabel={viewerCategoryLabel}
      />

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
    deletedObjectText: {
      color: theme.colors.textSecondary,
      fontStyle: 'italic',
    },
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
    cloudWarningText: {
      color: theme.colors.warning || theme.colors.primary,
      fontSize: typo.sizes?.sm || 14,
      marginBottom: sp.sm || 8,
      marginTop: -(sp.xs || 4),
    },
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
  });
}
