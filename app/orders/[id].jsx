import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useLocalSearchParams, useNavigation, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Easing,
  findNodeHandle,
  InteractionManager,
  Keyboard,
  Pressable,
  Animated as RNAnimated,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../components/hooks/useAuth';
import {
  ThemedRefreshControl,
  useManagedRefresh,
  usePullToRefreshFeedback,
} from '../../components/ui/PullToRefreshFeedback';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useFinanceEntryMedia } from '../../hooks/useFinanceEntryMedia';
import { useSubscriptionGuard } from '../../hooks/useSubscriptionGuard';
import { useOrderMedia } from '../../hooks/useOrderMedia';
import dismissToRoute from '../../lib/navigation/dismissToRoute';
import goBackSmart from '../../lib/navigation/goBackSmart';
import { yandexDiskIntegration, yandexDiskMedia } from '../../lib/yandexDiskIntegration';
import { financeEntryMediaStorage, financeEntryYandexMedia } from '../../lib/financeEntryMedia';
import { orderMediaStorage } from '../../lib/orderMediaStorage';
import { applyAndroidSystemBars } from '../../lib/systemBars';
import { supabase } from '../../lib/supabase';
import { mapStatusToDb } from '../../lib/orderFilters';
import { fetchWorkTypes, getMyCompanyId } from '../../lib/workTypes';

import * as ImageManipulator from 'expo-image-manipulator';
import { FileSystemUploadType, uploadAsync as uploadFileAsync, downloadAsync, cacheDirectory } from 'expo-file-system/legacy';
import { encode as encodeBase64 } from 'base64-arraybuffer';

import AppHeader from '../../components/navigation/AppHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import ClearButton from '../../components/ui/ClearButton';
import SectionHeader from '../../components/ui/SectionHeader';
import TextField from '../../components/ui/TextField';
import LabelValueRow from '../../components/ui/LabelValueRow';
import OrderStatusCapsule from '../../components/ui/OrderStatusCapsule';
import ExpandableTextRow from '../../components/ui/ExpandableTextRow';
import { BaseModal, ConfirmModal, AlertModal, SelectModal } from '../../components/ui/modals';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { buildAddressForNavigator, openAddressInYandex, openCoordinatesInYandex } from '../../components/ui/map';
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
import { resolveRequestTitle } from '../../src/features/requests/title';
import {
  financeQueryKeys,
  useDeleteOrderFinanceEntryMutation,
  useOrderFinanceEntries,
  useUpsertOrderFinanceEntryMutation,
} from '../../src/features/finance/queries';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { getPrefetchRegistry } from '../../src/shared/query/prefetchRegistry';
import { useScreenRefreshRegistration } from '../../src/shared/query/screenRefreshRegistry';
import FieldErrorText from '../../src/shared/feedback/FieldErrorText';
import {
  buildOrderAddressDisplay,
  buildOrderAddressShort,
  extractOrderAddress,
  filterOrderAddressByObjectFieldSettings,
  normalizeOrderAddressMode,
} from '../../src/features/requests/addressing';
import {
  hasClientObjectMapPoint,
  normalizeClientObjectLocationMode,
  normalizeCoordinateValue,
} from '../../src/features/objects/addressing';
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
import DeferredScreen from '../../src/shared/perf/DeferredScreen';
import { useQueryClient } from '@tanstack/react-query';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import OrderPhotosModal from './components/OrderPhotosModal';
import FullscreenImageViewer from './components/FullscreenImageViewer';
import { useToast } from '../../components/ui/ToastProvider';

const PHOTO_MAX_WIDTH = 1280;
const PHOTO_COMPRESS_QUALITY = 0.8;
const PHOTO_MIME_TYPE = 'image/jpeg';
const YANDEX_URL_MARKERS = ['yadisk://', 'yadi.sk', 'disk.yandex'];
const ROUTE_PLACEHOLDER_RE = /^\[[^\]]+\]$/;
const REMOVED_ORDER_OBJECT_FIELDS = new Set([
  'country',
  'region',
  'city',
  'street',
  'house',
  'postal_code',
  'floor',
  'entrance',
  'apartment',
  'comment',
  'geo_lat',
  'geo_lng',
]);

const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());
const EXECUTOR_NAME_CACHE_MAX_ENTRIES = 300;

function getCachedExecutorName(userId) {
  if (!userId || !EXECUTOR_NAME_CACHE.has(userId)) return '';
  const value = EXECUTOR_NAME_CACHE.get(userId);
  EXECUTOR_NAME_CACHE.delete(userId);
  EXECUTOR_NAME_CACHE.set(userId, value);
  return typeof value === 'string' ? value : '';
}

function setCachedExecutorName(userId, displayName) {
  if (!userId) return;
  const value = String(displayName || '').trim();
  EXECUTOR_NAME_CACHE.delete(userId);
  EXECUTOR_NAME_CACHE.set(userId, value);
  while (EXECUTOR_NAME_CACHE.size > EXECUTOR_NAME_CACHE_MAX_ENTRIES) {
    const oldestKey = EXECUTOR_NAME_CACHE.keys().next()?.value;
    if (oldestKey == null) break;
    EXECUTOR_NAME_CACHE.delete(oldestKey);
  }
}

function normalizeOrderRouteId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (ROUTE_PLACEHOLDER_RE.test(normalized)) return null;
  return normalized;
}

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
  'work_type_id',
  'price',
  'payment_status',
  'payment_method',
  'finance_income_total',
  'finance_expense_total',
  'finance_discount_total',
  'finance_gross_total',
  'finance_net_total',
  'urgent',
  'contract_file',
  'photo_before',
  'photo_after',
  'act_file',
  'media_file_5',
];

const FORCED_VISIBLE_ORDER_FIELDS = new Set([
  'client_id',
  'object_id',
  'assigned_to',
  'price',
  'payment_status',
  'payment_method',
]);

const FORCED_HIDDEN_ORDER_FIELDS = new Set(['department_id']);
const ORDER_MEDIA_FIELD_KEYS = ['contract_file', 'photo_before', 'photo_after', 'act_file', 'media_file_5'];

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

function FinanceAccordionRow({
  label,
  summaryValue,
  summaryIcon = null,
  summaryIconOnPress = null,
  summaryIconAccessibilityLabel = null,
  summaryTone = 'default',
  hideSummaryWhenCollapsed = false,
  hideSummary = false,
  expanded,
  onToggle,
  children,
  base,
  styles,
  theme,
}) {
  const summaryColor =
    summaryTone === 'success'
      ? theme.colors.success
      : summaryTone === 'warning'
        ? theme.colors.warning || theme.colors.primary
      : summaryTone === 'danger'
        ? theme.colors.danger
        : summaryTone === 'primary'
          ? theme.colors.primary
          : theme.colors.text;

  return (
    <View>
      <Pressable
        style={({ pressed }) => [base.row, pressed && styles.financeSectionRowPressed]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={[base.label, expanded ? styles.financeSectionLabelExpanded : null]}>{label}</Text>
        <View style={base.middleSpacer} />
        <View style={styles.financeSectionRight}>
          {!hideSummary && (!hideSummaryWhenCollapsed || expanded) ? (
            <View style={[base.valueWrapper, styles.financeSectionSummaryWrap]}>
              {summaryIcon ? (
                summaryIconOnPress ? (
                  <FinanceSummaryIconButton
                    icon={summaryIcon}
                    onPress={summaryIconOnPress}
                    accessibilityLabel={summaryIconAccessibilityLabel}
                    styles={styles}
                  />
                ) : (
                  <View style={styles.financeSectionSummaryIcon}>{summaryIcon}</View>
                )
              ) : null}
              <Text
                style={[base.value, styles.financeSectionSummaryValue, { color: summaryColor }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {summaryValue}
              </Text>
            </View>
          ) : null}
          <View
            style={[
              styles.financeSectionChevronWrap,
              expanded ? styles.financeSectionChevronWrapExpanded : null,
            ]}
          >
            <Feather
              name="chevron-down"
              size={theme.components?.listItem?.chevronSize ?? theme.icons?.md ?? 18}
              color={theme.colors.textSecondary}
            />
          </View>
        </View>
      </Pressable>

      {expanded ? <View style={styles.financeSectionExpanded}>{children}</View> : null}
    </View>
  );
}

function FinanceSummaryIconButton({ icon, onPress, accessibilityLabel, styles }) {
  const progress = useRef(new RNAnimated.Value(0)).current;

  const runPressAnimation = useCallback(() => {
    progress.stopAnimation(() => {
      progress.setValue(0);
      RNAnimated.timing(progress, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        progress.setValue(0);
      });
    });
  }, [progress]);

  const animatedStyle = useMemo(
    () => ({
      transform: [
        {
          scale: progress.interpolate({
            inputRange: [0, 0.2, 0.55, 1],
            outputRange: [1, 0.9, 1.04, 1],
          }),
        },
        {
          rotate: progress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', '360deg'],
          }),
        },
      ],
    }),
    [progress],
  );

  return (
    <Pressable
      onPress={(event) => {
        event?.stopPropagation?.();
        runPressAnimation();
        onPress?.();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || undefined}
      style={styles.financeSectionSummaryIconButton}
    >
      <RNAnimated.View style={animatedStyle}>{icon}</RNAnimated.View>
    </Pressable>
  );
}

function OrderDetailsContent() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const titlePrefix = useMemo(() => t('order_auto_title_prefix', 'Заявка от'), [t]);
  const toast = useToast();
  const { has, loading: permsLoading } = usePermissions();
  const { settings: companySettings } = useCompanySettings();
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
    const normalizedFromParams = normalizeOrderRouteId(fromParams);
    if (normalizedFromParams) {
      return normalizedFromParams;
    }
    const path = String(pathname || '');
    const clean = path.split('?')[0];
    const parts = clean.split('/').filter(Boolean);
    const last = parts.length ? String(parts[parts.length - 1]).trim() : '';
    // Ignore known non-id route segments to avoid invalid UUID requests.
    if (!last || ['orders', 'my-orders', 'all-orders', 'calendar', 'new'].includes(last)) {
      return null;
    }
    return normalizeOrderRouteId(last);
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
  const canViewOrderAmount = has('canViewOrderAmount');
  const canEditOrderAmount = canViewOrderAmount && has('canEditOrderAmount');
  const canEditFinances = canEditOrderAmount;
  const canViewFinanceOwn = has('canViewFinanceOwn');
  const canViewFinanceAll = has('canViewFinanceAll');
  const canViewFinanceEntries = canViewFinanceOwn || canViewFinanceAll;
  const canEditFinanceEntries = has('canEditFinanceEntries');
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
  const resolveTitleForSave = useCallback(
    (value, fallbackDate = null) =>
      resolveRequestTitle(value, {
        fallbackDate,
        prefix: titlePrefix,
      }),
    [titlePrefix],
  );
  const isOrderFieldVisible = useCallback(
    (fieldKey) => {
      const normalizedFieldKey = String(fieldKey || '');
      if (FORCED_HIDDEN_ORDER_FIELDS.has(normalizedFieldKey)) return false;
      if (FORCED_VISIBLE_ORDER_FIELDS.has(normalizedFieldKey)) return true;
      const field = orderFieldsByKey.get(normalizedFieldKey);
      return !field || field.isEnabled !== false;
    },
    [orderFieldsByKey],
  );
  const getOrderFieldLabel = useCallback(
    (fieldKey, fallbackLabel) => {
      const field = orderFieldsByKey.get(String(fieldKey || ''));
      const customLabel = String(field?.customLabel || field?.custom_label || '').trim();
      if (customLabel) return customLabel;
      if (field?.labelKey) {
        return t(field.labelKey, field?.fallbackLabel || fallbackLabel || String(fieldKey || ''));
      }
      return fallbackLabel || String(fieldKey || '');
    },
    [orderFieldsByKey, t],
  );
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
  const [paymentStatusModalVisible, setPaymentStatusModalVisible] = useState(false);
  const [paymentMethodModalVisible, setPaymentMethodModalVisible] = useState(false);
  const [financeKindModalVisible, setFinanceKindModalVisible] = useState(false);
  const [financeCalcModeModalVisible, setFinanceCalcModeModalVisible] = useState(false);
  const [financeExpensePayerModalVisible, setFinanceExpensePayerModalVisible] = useState(false);
  const [financePercentBaseModalVisible, setFinancePercentBaseModalVisible] = useState(false);
  const [amountDraft, setAmountDraft] = useState('');
  const amountEditInputRef = useRef(null);
  const [financeEntryModalVisible, setFinanceEntryModalVisible] = useState(false);
  const [financeEntryViewModalVisible, setFinanceEntryViewModalVisible] = useState(false);
  const [financeEntryDeleteConfirmVisible, setFinanceEntryDeleteConfirmVisible] = useState(false);
  const [financeEntryPhotosModalVisible, setFinanceEntryPhotosModalVisible] = useState(false);
  const [financeEntryLocalPending, setFinanceEntryLocalPending] = useState([]);
  const [financeEntryViewCommentExpanded, setFinanceEntryViewCommentExpanded] = useState(false);
  const [financeEntryViewCommentExpandable, setFinanceEntryViewCommentExpandable] = useState(false);
  const [financeEntryViewCommentMeasureWidth, setFinanceEntryViewCommentMeasureWidth] = useState(0);
  const [expandedFinanceSections, setExpandedFinanceSections] = useState({
    customer: false,
    internal: false,
    executor: false,
  });
  const [selectedFinanceEntry, setSelectedFinanceEntry] = useState(null);
  const [financeEntryDraft, setFinanceEntryDraft] = useState({
    id: null,
    kind: 'expense',
    calc_mode: 'fixed',
    percent_base: 'base_price',
    expense_payer: 'executor',
    title: '',
    note: '',
    input_amount: '',
    input_percent: '',
    photo_urls: [],
  });
  const [financeEntryFieldErrors, setFinanceEntryFieldErrors] = useState({});
  const [financeEntrySubmitAttempt, setFinanceEntrySubmitAttempt] = useState(false);
  const financeAmountInputRef = useRef(null);
  const financePercentInputRef = useRef(null);
  const financeCommentInputRef = useRef(null);
  const financeEntryInitialPhotoUrlsRef = useRef([]);
  const [financeSaving, setFinanceSaving] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [financeViewerVisible, setFinanceViewerVisible] = useState(false);
  const [financeViewerPhotos, setFinanceViewerPhotos] = useState([]);
  const [financeViewerIndex, setFinanceViewerIndex] = useState(0);
  const financeViewerRawPhotosRef = useRef([]);
  const financeEntryInspectSignatureRef = useRef('');
  const [financeViewerCategoryLabel, setFinanceViewerCategoryLabel] = useState('');
  const financeEntryViewCommentText = useMemo(
    () => String(selectedFinanceEntry?.note || '').trim(),
    [selectedFinanceEntry?.note],
  );
  const financeEntryViewHasComment = financeEntryViewCommentText.length > 0;
  const financeEntryViewPhotoCount = useMemo(
    () =>
      Array.isArray(selectedFinanceEntry?.photo_urls)
        ? selectedFinanceEntry.photo_urls.map((value) => String(value || '')).filter(Boolean).length
        : 0,
    [selectedFinanceEntry?.photo_urls],
  );
  const financeEntryViewHasPhotos = financeEntryViewPhotoCount > 0;
  const normalizeFinanceTextInput = useCallback((value) => String(value ?? '').replace(/\s*[\r\n]+\s*/g, ' '), []);
  const clearFinanceEntryFieldError = useCallback((fieldKey) => {
    if (!fieldKey) return;
    setFinanceEntryFieldErrors((prev) => {
      if (!prev?.[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }, []);
  const focusAmountEditInput = useCallback(() => {
    amountEditInputRef.current?.focus?.();
  }, []);
  const [viewerIndex, setViewerIndex] = useState(0);
  const viewerRawPhotosRef = useRef([]);
  const viewerCategoryRef = useRef(null);
  const [viewerCategoryLabel, setViewerCategoryLabel] = useState('');
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);
  const [resolvedClientId, setResolvedClientId] = useState(null);
  const [localPendingMap, setLocalPendingMap] = useState({});
  const cloudFallbackNoticeShownRef = useRef(false);

  // в”Ђв”Ђв”Ђ Centralised media hook (caching, resolution, Yandex/Storage) в”Ђв”Ђв”Ђ
  const orderMedia = useOrderMedia({ order, mediaProvider, t });
  // Stable ref so fetchData doesn't re-create when orderMedia resolves URLs
  const orderMediaRef = useRef(orderMedia);
  useEffect(() => { orderMediaRef.current = orderMedia; }, [orderMedia]);
  const financeEntryMedia = useFinanceEntryMedia({
    financeEntryId: financeEntryDraft.id,
    photoUrls: financeEntryDraft.photo_urls,
    mediaProvider,
    t,
    enabled: financeEntryPhotosModalVisible && !!financeEntryDraft.id,
  });

  // Always-current order ref — prevents stale closures in parallel uploads
  const orderRef = useRef(order);
  useEffect(() => { orderRef.current = order; }, [order]);

  const { data: requestData, refetch: refetchRequestData } = useRequest(id, {
    enabled: !!id,
    staleTime: 45 * 1000,
    refetchOnMount: false,
  });
  const financeEntriesQuery = useOrderFinanceEntries(id, {
    enabled: !!id && canViewFinanceEntries,
  });
  const upsertFinanceEntryMutation = useUpsertOrderFinanceEntryMutation(id);
  const deleteFinanceEntryMutation = useDeleteOrderFinanceEntryMutation(id);
  const financeEntries = useMemo(
    () => (Array.isArray(financeEntriesQuery.data) ? financeEntriesQuery.data : []),
    [financeEntriesQuery.data],
  );
  const orderedFinanceEntries = useMemo(
    () =>
      [...financeEntries].sort((a, b) => {
        const rank = (kind) => (kind === 'income' ? 0 : 1);
        return rank(a?.kind) - rank(b?.kind);
      }),
    [financeEntries],
  );
  const financeIncomeEntries = useMemo(
    () => orderedFinanceEntries.filter((entry) => entry?.kind === 'income'),
    [orderedFinanceEntries],
  );
  const financeDiscountEntries = useMemo(
    () => orderedFinanceEntries.filter((entry) => entry?.kind === 'discount'),
    [orderedFinanceEntries],
  );
  const financeExpenseEntries = useMemo(
    () => orderedFinanceEntries.filter((entry) => entry?.kind === 'expense'),
    [orderedFinanceEntries],
  );
  const hasCustomerFinanceEntries = financeIncomeEntries.length > 0 || financeDiscountEntries.length > 0;
  const isLocalFinancePhotoUrl = useCallback((value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return false;
    return (
      raw.startsWith('file:') ||
      raw.startsWith('content:') ||
      raw.startsWith('ph:') ||
      raw.startsWith('asset-library:')
    );
  }, []);
  const formatFinancePhotoCount = useCallback(
    (count) => t('order_photos_count', '{count} фото').replace('{count}', String(Number(count) || 0)),
    [t],
  );

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
    toast.info(String(msg || ''));
  }, [toast]);

  const notifyCloudFallback = useCallback(() => {
    if (!isAdminUser) return;
    if (cloudFallbackNoticeShownRef.current) return;
    cloudFallbackNoticeShownRef.current = true;
    showToast(t('order_cloud_fallback_admin_notice'));
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
      if (!isAdminUser) {
        setCloudHealth('unknown');
        setEffectiveMediaProvider('yandex_disk');
        cloudFallbackNoticeShownRef.current = false;
        return undefined;
      }

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
        } catch {
          if (cancelled) return;
          setCloudHealth('error');
          setEffectiveMediaProvider('beget_s3');
          notifyCloudFallback();
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [isAdminUser, mediaProvider, notifyCloudFallback]),
  );

  const deriveExecutorNameInstant = useCallback((o) => {
    if (!o) return null;
    const cached = getCachedExecutorName(o.assigned_to);
    if (cached) return cached;

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
        [obj.first_name, obj.middle_name, obj.last_name].filter(Boolean).join(' ').trim() ||
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
      canEditFinances,
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
  const isValidFinanceNumericInput = useCallback((s) => {
    const raw = String(s ?? '').trim();
    if (!raw) return true;
    return /^\d+(?:[.,]\d+)?$/.test(raw);
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

  const saveOrderPaymentField = useCallback(
    async (patch) => {
      if (!order?.id || !patch || typeof patch !== 'object') return;
      setFinanceSaving(true);
      try {
        const updatedOrder = await updateRequestWithVersion(order.id, patch, order?.updated_at || null);
        setOrder(updatedOrder || order);
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
    [order, showToast, t],
  );

  const handleQrPaymentPress = useCallback(() => {
    showToast(t('order_payment_qr_soon', 'Скоро добавим'));
  }, [showToast, t]);

  const makeSnapshotFromOrder = useCallback((o) => {
    if (!o) return '';
    const phoneDigits = ((o.phone ?? o.phone_visible) || '')
      .replace(/\D/g, '')
      .replace(/^8(\d{10})$/, '7$1');

    return JSON.stringify({
      title: resolveRequestTitle(o, { prefix: titlePrefix }),
      comment: o.comment || '',
      region: o.region || '',
      city: o.city || '',
      street: o.street || '',
      house: o.house || '',
      phone: phoneDigits,
      time_window_start: o.time_window_start ? new Date(o.time_window_start).toISOString() : null,
      assigned_to: o.assigned_to || null,
      price: o.price ?? null,
      payment_status: o.payment_status ?? null,
      payment_method: o.payment_method ?? null,
    });
  }, [titlePrefix]);

  const makeSnapshotFromState = useCallback(() => {
    const phoneDigits = (phone || '').replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1');
    return JSON.stringify({
      title: resolveTitleForSave(title, departureDate),
      comment: description || '',
      region: region || '',
      city: city || '',
      street: street || '',
      house: house || '',
      phone: phoneDigits,
      time_window_start: departureDate ? departureDate.toISOString() : null,
      assigned_to: assigneeId || null,
      ...(canEditFinances
        ? {
            price: parseMoney(amount),
            payment_status: order?.payment_status ?? null,
            payment_method: order?.payment_method ?? null,
          }
        : {}),
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
    canEditFinances,
    amount,
    order?.payment_method,
    order?.payment_status,
    parseMoney,
    resolveTitleForSave,
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

  // в”Ђв”Ђв”Ђ Hydrate all form fields from order object (extracted to avoid duplication) в”Ђв”Ђв”Ђ
  const hydrateFormFields = useCallback((o) => {
    if (!o) return;
    const rawDigits = (
      (o.phone ?? o.customer_phone_visible ?? o.phone_visible) || ''
    ).replace(/\D/g, '');
    setTitle(resolveRequestTitle(o, { prefix: titlePrefix }));
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
    setAmount(o.price !== null && o.price !== undefined ? String(o.price) : '');
    // Executor name from cache (instant)
    const cachedExecName = deriveExecutorNameInstant(o);
    if (cachedExecName) setExecutorName(cachedExecName);
  }, [deriveExecutorNameInstant, titlePrefix]);


  const fetchData = useCallback(async () => {
    if (!id) {
      setOrderReady(true);
      return;
    }

    try {
      // в”Ђв”Ђ 1. Auth: instant from context (no network) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      const uid = authUserId;
      const currentRole = authRole;
      setUserId(uid);
      setRole(currentRole);

      // в”Ђв”Ђ 2. Order data: show cache instantly, then refetch в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

      // в”Ђв”Ђ 3. Fill missing fields IN PARALLEL (not sequential!) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      const missingFieldsPromises = [];
      if (typeof fetchedOrder.work_type_id === 'undefined' || fetchedOrder.work_type_id === null) {
        missingFieldsPromises.push(
          supabase.from('orders').select('work_type_id').eq('id', id).single()
            .then(({ data }) => { if (data) fetchedOrder.work_type_id = data.work_type_id ?? null; })
            .catch(() => {})
        );
      }
      if (missingFieldsPromises.length) await Promise.all(missingFieldsPromises);

      // в”Ђв”Ђ 4. Auto-status "Новый"в†’"В работе" в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      let effectiveOrder = fetchedOrder;
      if (uid && fetchedOrder.status === mapStatusToDb('new') && fetchedOrder.assigned_to === uid) {
        try {
          await updateRequestWithVersion(id, { status: mapStatusToDb('in_progress') }, fetchedOrder?.updated_at || null);
          queryClient.invalidateQueries({ queryKey: ['requests'] });
          queryClient.invalidateQueries({ queryKey: queryKeys.requests.detail(id) });
          const refreshed = await ensureRequestPrefetch(queryClient, id);
          effectiveOrder = refreshed || { ...fetchedOrder, status: mapStatusToDb('in_progress') };
        } catch (e) {
          console.warn('Persist status error:', e);
          effectiveOrder = fetchedOrder;
        }
      }

      // в”Ђв”Ђ 5. Resolve media (async, non-blocking for screen) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      // Show order + form immediately, resolve media in background
      hydrateFormFields(effectiveOrder);
      setOrder(effectiveOrder);
      setWorkTypeId(effectiveOrder.work_type_id ?? null);
      setOrderReady(true);

      // Media resolution + sync + secondary data вЂ” all in parallel, non-blocking
      const media = orderMediaRef.current;
      const bgTasks = [];

      // 5a. Yandex media resolution
      bgTasks.push(
        media.resolveOrder(effectiveOrder).then((inspected) => {
          if (inspected) setOrder(inspected);
        }).catch(() => {})
      );

      // 5b. Storage photo sync вЂ” only remove photos missing from storage, never add orphans
      bgTasks.push(
        media.syncPhotos(effectiveOrder.id).then((fresh) => {
          if (!fresh) return;
          setOrder((prev) => {
            const cats = ORDER_MEDIA_FIELD_KEYS;
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
            supabase.from('profiles').select('first_name, middle_name, last_name').eq('id', effectiveOrder.assigned_to).single()
              .then(({ data: executorProfile }) => {
                if (executorProfile) {
                  const full =
                    `${executorProfile.first_name || ''} ${executorProfile.middle_name || ''} ${executorProfile.last_name || ''}`.trim();
                  setCachedExecutorName(effectiveOrder.assigned_to, full);
                  setExecutorName(full);
                }
              }).catch(() => {})
          );
        }
      }

      // 5d. Users list
      bgTasks.push(
        supabase.from('profiles').select('id, first_name, middle_name, last_name, role')
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

      // Fire all background tasks in parallel вЂ” screen is already visible
      await Promise.allSettled(bgTasks);

      initialFormSnapshotRef.current = makeSnapshotFromOrder(effectiveOrder);
    } catch (e) {
      const errorName = String(e?.name || '').trim();
      if (errorName === 'CancelledError') {
        setOrderReady(true);
        return;
      }
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

  useScreenRefreshRegistration(
    'orders.detail',
    () => {
      if (editMode) return undefined;
      return fetchData();
    },
    !!id,
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

  const refreshAll = useCallback(async () => {
    if (!id) return;
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: queryKeys.requests.detail(id) }),
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.orderEntries(id) }),
      queryClient.invalidateQueries({ queryKey: ['requests'] }),
      refetchRequestData?.(),
      financeEntriesQuery.refetch?.(),
    ]);
    await fetchData();
  }, [fetchData, financeEntriesQuery, id, queryClient, refetchRequestData]);
  const { refreshing, didSucceed, onRefresh } = useManagedRefresh(refreshAll);
  const { indicator: refreshIndicator } = usePullToRefreshFeedback(refreshing, { didSucceed });

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
        } catch {
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

  const financeKindLabel = useCallback(
    (kind) =>
      kind === 'income'
        ? t('finance_kind_income', 'Доход')
        : kind === 'discount'
          ? t('finance_kind_discount', 'Скидка')
          : t('finance_kind_expense', 'Расход'),
    [t],
  );
  const financeDeleteTitle = useCallback(
    (kind) =>
      kind === 'income'
        ? t('order_finance_delete_income_title', 'Удалить доход?')
        : kind === 'discount'
          ? t('order_finance_delete_discount_title', 'Удалить скидку?')
          : t('order_finance_delete_expense_title', 'Удалить расход?'),
    [t],
  );

  const financeCalcModeLabel = useCallback(
    (mode) =>
      mode === 'percent'
        ? t('finance_calc_percent', 'Процент')
        : t('finance_calc_fixed', 'Фиксированная сумма'),
    [t],
  );

  const financePercentBaseLabel = useCallback(
    (baseValue) => {
      if (baseValue === 'base_price') {
        return t('finance_percent_base_price', 'От изначальной стоимости');
      }
      if (baseValue === 'gross_before_discount') {
        return t('finance_percent_gross_before_discount', 'От изначальной стоимости + доп. доходы');
      }
      return t('finance_percent_gross_after_discount', 'От общей суммы');
    },
    [t],
  );

  const allowedFinancePercentBases = useCallback((kind) => {
    if (String(kind || 'expense') === 'discount') {
      return ['base_price', 'gross_before_discount'];
    }
    return ['base_price', 'gross_before_discount', 'gross_after_discount'];
  }, []);

  const normalizeFinancePercentBase = useCallback(
    (kind, percentBase) => {
      const normalizedBase = String(percentBase || 'base_price');
      const allowed = allowedFinancePercentBases(kind);
      return allowed.includes(normalizedBase) ? normalizedBase : 'base_price';
    },
    [allowedFinancePercentBases],
  );

  const getDefaultFinanceEntryTitle = useCallback(
    (kind) => {
      if (kind === 'discount') return t('order_finance_default_title_discount', 'Новая скидка');
      if (kind === 'income') return t('order_finance_default_title_income', 'Новый доход');
      return t('order_finance_default_title_expense', 'Новый расход');
    },
    [t],
  );

  const getFinanceEntryModalTitle = useCallback(
    (kind, isEdit = false) => {
      if (isEdit) {
        if (kind === 'discount') return t('order_finance_modal_edit_discount', 'Редактировать скидку');
        if (kind === 'income') return t('order_finance_modal_edit_income', 'Редактировать доход');
        return t('order_finance_modal_edit_expense', 'Редактировать расход');
      }
      if (kind === 'discount') return t('order_finance_modal_add_discount', 'Добавить скидку');
      if (kind === 'income') return t('order_finance_modal_add_income', 'Добавить доход');
      return t('order_finance_modal_add_expense', 'Добавить расход');
    },
    [t],
  );

  const financeKindSelectItems = useMemo(
    () => [
      {
        id: 'expense',
        label: t('finance_kind_expense', 'Расход'),
        right: <Feather name="chevron-right" size={theme.icons?.sm ?? 18} color={theme.colors.textSecondary} />,
      },
      {
        id: 'income',
        label: t('finance_kind_income', 'Доход'),
        right: <Feather name="chevron-right" size={theme.icons?.sm ?? 18} color={theme.colors.textSecondary} />,
      },
      {
        id: 'discount',
        label: t('finance_kind_discount', 'Скидка'),
        right: <Feather name="chevron-right" size={theme.icons?.sm ?? 18} color={theme.colors.textSecondary} />,
      },
    ],
    [t, theme.colors.textSecondary, theme.icons?.sm],
  );

  const financeCalcModeItems = useMemo(
    () => [
      {
        id: 'fixed',
        label: t('finance_calc_fixed', 'Фиксированная сумма'),
      },
      {
        id: 'percent',
        label: t('finance_calc_percent', 'Процент'),
      },
    ],
    [t],
  );

  const financePercentBaseItems = useMemo(
    () =>
      allowedFinancePercentBases(financeEntryDraft.kind).map((id) => ({
        id,
        label: financePercentBaseLabel(id),
      })),
    [allowedFinancePercentBases, financeEntryDraft.kind, financePercentBaseLabel],
  );

  const financeExpensePayerLabel = useCallback(
    (payer) =>
      payer === 'executor'
        ? t('finance_expense_payer_executor', 'Исполнитель')
        : t('finance_expense_payer_company', 'Компания'),
    [t],
  );

  const financeExpensePayerItems = useMemo(
    () => [
      {
        id: 'executor',
        label: financeExpensePayerLabel('executor'),
      },
      {
        id: 'company',
        label: financeExpensePayerLabel('company'),
      },
    ],
    [financeExpensePayerLabel],
  );

  const normalizePaymentStatus = useCallback((value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'unpaid';
    if (
      raw === 'paid' ||
      raw === 'оплачено' ||
      raw === 'оплачен' ||
      (raw.includes('оплач') && !raw.includes('не'))
    ) {
      return 'paid';
    }
    return 'unpaid';
  }, []);

  const normalizePaymentMethod = useCallback((value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'cashless' || raw === 'безнал' || raw === 'безналичный') return 'cashless';
    return 'cash';
  }, []);

  const paymentStatusLabel = useCallback(
    (value) =>
      normalizePaymentStatus(value) === 'paid'
        ? t('order_payment_status_paid', 'Оплачено')
        : t('order_payment_status_unpaid', 'Не оплачено'),
    [normalizePaymentStatus, t],
  );

  const paymentMethodLabel = useCallback(
    (value) =>
      normalizePaymentMethod(value) === 'cashless'
        ? t('order_payment_method_cashless', 'Безнал')
        : t('order_payment_method_cash', 'Наличные'),
    [normalizePaymentMethod, t],
  );

  const paymentStatusItems = useMemo(
    () => [
      { id: 'unpaid', label: paymentStatusLabel('unpaid') },
      { id: 'paid', label: paymentStatusLabel('paid') },
    ],
    [paymentStatusLabel],
  );

  const paymentMethodItems = useMemo(
    () => [
      { id: 'cash', label: paymentMethodLabel('cash') },
      { id: 'cashless', label: paymentMethodLabel('cashless') },
    ],
    [paymentMethodLabel],
  );

  const openCreateFinanceEntry = useCallback(
    (kind = 'expense') => {
      financeEntryInitialPhotoUrlsRef.current = [];
      setFinanceEntryFieldErrors({});
      setFinanceEntrySubmitAttempt(false);
      setFinanceEntryDraft({
        id: null,
        kind,
        calc_mode: 'fixed',
        percent_base: normalizeFinancePercentBase(kind, 'base_price'),
        expense_payer: kind === 'expense' ? 'executor' : 'company',
        title: getDefaultFinanceEntryTitle(kind),
        note: '',
        input_amount: '',
        input_percent: '',
        photo_urls: [],
      });
      setFinanceEntryModalVisible(true);
    },
    [getDefaultFinanceEntryTitle, normalizeFinancePercentBase],
  );

  const openEditFinanceEntry = useCallback((entry) => {
    if (!entry?.id) return;
    financeEntryInitialPhotoUrlsRef.current = Array.isArray(entry.photo_urls)
      ? entry.photo_urls.map((value) => String(value || '')).filter(Boolean)
      : [];
    setFinanceEntryFieldErrors({});
    setFinanceEntrySubmitAttempt(false);
    setFinanceEntryDraft({
      id: entry.id,
      kind: String(entry.kind || 'expense'),
      calc_mode: String(entry.calc_mode || 'fixed'),
      percent_base: normalizeFinancePercentBase(entry.kind, entry.percent_base),
      expense_payer: String(entry.expense_payer || 'company'),
      title: String(entry.title || ''),
      note: String(entry.note || ''),
      input_amount: String(entry.input_amount ?? ''),
      input_percent: String(entry.input_percent ?? ''),
      photo_urls: Array.isArray(entry.photo_urls)
        ? entry.photo_urls.map((value) => String(value || '')).filter(Boolean)
        : [],
    });
    setFinanceEntryModalVisible(true);
  }, [normalizeFinancePercentBase]);

  const openFinanceEntryView = useCallback((entry) => {
    if (!entry?.id) return;
    setSelectedFinanceEntry(entry);
    setFinanceEntryViewCommentExpanded(false);
    setFinanceEntryViewCommentExpandable(false);
    setFinanceEntryViewModalVisible(true);
  }, []);

  const startEditFinanceEntryFromView = useCallback(() => {
    if (!selectedFinanceEntry) return;
    setFinanceEntryViewModalVisible(false);
    openEditFinanceEntry(selectedFinanceEntry);
  }, [openEditFinanceEntry, selectedFinanceEntry]);

  const openFinanceEntryPhotosFromView = useCallback(() => {
    if (!selectedFinanceEntry) return;
    financeEntryInitialPhotoUrlsRef.current = Array.isArray(selectedFinanceEntry.photo_urls)
      ? selectedFinanceEntry.photo_urls.map((value) => String(value || '')).filter(Boolean)
      : [];
    setFinanceEntryDraft({
      id: selectedFinanceEntry.id,
      kind: String(selectedFinanceEntry.kind || 'expense'),
      calc_mode: String(selectedFinanceEntry.calc_mode || 'fixed'),
      percent_base: normalizeFinancePercentBase(selectedFinanceEntry.kind, selectedFinanceEntry.percent_base),
      expense_payer: String(selectedFinanceEntry.expense_payer || 'company'),
      title: String(selectedFinanceEntry.title || ''),
      note: String(selectedFinanceEntry.note || ''),
      input_amount: String(selectedFinanceEntry.input_amount ?? ''),
      input_percent: String(selectedFinanceEntry.input_percent ?? ''),
      photo_urls: Array.isArray(selectedFinanceEntry.photo_urls)
        ? selectedFinanceEntry.photo_urls.map((value) => String(value || '')).filter(Boolean)
        : [],
    });
    setFinanceEntryPhotosModalVisible(true);
  }, [normalizeFinancePercentBase, selectedFinanceEntry]);

  useEffect(() => {
    if (!financeEntryPhotosModalVisible || !financeEntryDraft.id || effectiveMediaProvider !== 'yandex_disk') {
      financeEntryInspectSignatureRef.current = '';
      return;
    }
    const remoteUrls = (financeEntryDraft.photo_urls || []).filter((url) => !isLocalFinancePhotoUrl(url));
    if (!remoteUrls.length) {
      financeEntryInspectSignatureRef.current = '';
      return;
    }
    const signature = `${financeEntryDraft.id}:${remoteUrls.join('|')}`;
    if (financeEntryInspectSignatureRef.current === signature) return;
    financeEntryInspectSignatureRef.current = signature;
    financeEntryMedia
      .inspectUrls(remoteUrls)
      .then((data) => {
        const cleanedRemoteUrls = Array.isArray(data?.photo_urls)
          ? data.photo_urls.map((value) => String(value || '')).filter(Boolean)
          : remoteUrls;
        const hasCleanup =
          Array.isArray(data?.cleaned_urls) &&
          data.cleaned_urls.map((value) => String(value || '')).filter(Boolean).length > 0;
        if (!hasCleanup) return;
        setFinanceEntryDraft((prev) => {
          const localUrls = (prev.photo_urls || []).filter((url) => isLocalFinancePhotoUrl(url));
          const nextUrls = [...cleanedRemoteUrls, ...localUrls];
          const same =
            nextUrls.length === (prev.photo_urls || []).length &&
            nextUrls.every((value, index) => value === prev.photo_urls[index]);
          return same ? prev : { ...prev, photo_urls: nextUrls };
        });
      })
      .catch(() => {});
  }, [
    effectiveMediaProvider,
    financeEntryDraft.id,
    financeEntryDraft.photo_urls,
    financeEntryMedia,
    financeEntryPhotosModalVisible,
    isLocalFinancePhotoUrl,
  ]);

  const openFinanceEntryPhotosModal = useCallback(() => {
    setFinanceEntryPhotosModalVisible(true);
  }, []);

  const closeFinanceEntryPhotosModal = useCallback(() => {
    setFinanceEntryPhotosModalVisible(false);
    financeEntryInspectSignatureRef.current = '';
    setFinanceEntryLocalPending([]);
  }, []);

  const handleFinanceEntryPhotoUploadUri = useCallback(async (_category, uri) => {
    if (!uri) return;
    setFinanceEntryDraft((prev) => ({
      ...prev,
      photo_urls: [...(prev.photo_urls || []), String(uri)],
    }));
  }, []);

  const handleFinanceEntryPhotoUploadMultiple = useCallback(async (_category, uris = []) => {
    const nextUris = (uris || []).map((value) => String(value || '')).filter(Boolean);
    if (!nextUris.length) return;
    setFinanceEntryDraft((prev) => ({
      ...prev,
      photo_urls: [...(prev.photo_urls || []), ...nextUris],
    }));
  }, []);

  const removeFinanceEntryPhotoRemote = useCallback(
    async (removedUrl, rollback) => {
      const url = String(removedUrl || '').trim();
      if (!url) return true;
      const financeEntryIdValue = String(financeEntryDraft.id || '').trim();
      if (!financeEntryIdValue || isLocalFinancePhotoUrl(url)) return true;

      try {
        await deleteFinanceEntryPhotoByUrl(financeEntryIdValue, url);
        financeEntryInitialPhotoUrlsRef.current = (financeEntryInitialPhotoUrlsRef.current || []).filter(
          (value) => String(value || '') !== url,
        );
        setSelectedFinanceEntry((prev) => {
          if (!prev || String(prev.id || '') !== financeEntryIdValue) return prev;
          return {
            ...prev,
            photo_urls: (prev.photo_urls || []).filter((value) => String(value || '') !== url),
          };
        });
        return true;
      } catch (error) {
        console.warn('[finance-entry-photo-remove] remote delete failed:', error);
        if (typeof rollback === 'function') rollback();
        showWarning(error?.message || t('order_toast_delete_error'));
        return false;
      }
    },
    [deleteFinanceEntryPhotoByUrl, financeEntryDraft.id, isLocalFinancePhotoUrl, showWarning, t],
  );

  const handleFinanceEntryPhotoRemove = useCallback((_category, index) => {
    let removedUrl = '';
    setFinanceEntryDraft((prev) => {
      removedUrl = String((prev.photo_urls || [])[index] || '').trim();
      if (removedUrl) financeEntryMedia.removeFromCache(removedUrl);
      return {
        ...prev,
        photo_urls: (prev.photo_urls || []).filter((_, itemIndex) => itemIndex !== index),
      };
    });
    if (!removedUrl) return;
    void removeFinanceEntryPhotoRemote(removedUrl, () => {
      setFinanceEntryDraft((prev) => {
        if ((prev.photo_urls || []).some((value) => String(value || '') === removedUrl)) return prev;
        const next = [...(prev.photo_urls || [])];
        const restoreAt = Number.isFinite(index) ? Math.max(0, Math.min(index, next.length)) : next.length;
        next.splice(restoreAt, 0, removedUrl);
        return { ...prev, photo_urls: next };
      });
    });
  }, [financeEntryMedia, removeFinanceEntryPhotoRemote]);

  const handleFinanceEntryPhotoRemoveMany = useCallback((_category, urls = []) => {
    const selected = new Set((urls || []).map((value) => String(value || '')).filter(Boolean));
    const removedUrls = [];
    selected.forEach((url) => financeEntryMedia.removeFromCache(url));
    setFinanceEntryDraft((prev) => ({
      ...prev,
      photo_urls: (prev.photo_urls || []).filter((value) => {
        const normalized = String(value || '');
        const shouldRemove = selected.has(normalized);
        if (shouldRemove) removedUrls.push(normalized);
        return !shouldRemove;
      }),
    }));
    removedUrls.forEach((removedUrl) => {
      void removeFinanceEntryPhotoRemote(removedUrl, () => {
        setFinanceEntryDraft((prev) => {
          if ((prev.photo_urls || []).some((value) => String(value || '') === removedUrl)) return prev;
          return { ...prev, photo_urls: [...(prev.photo_urls || []), removedUrl] };
        });
      });
    });
  }, [financeEntryMedia, removeFinanceEntryPhotoRemote]);

  const openFinanceEntryViewer = useCallback((photos, index) => {
    if (!Array.isArray(photos) || !photos.length) return;
    const pairs = photos
      .map((raw) => ({ raw, display: financeEntryMedia.getDisplayUrl(raw) || raw }))
      .filter((pair) => pair.display);
    financeViewerRawPhotosRef.current = pairs.map((pair) => pair.raw);
    setFinanceViewerPhotos(pairs.map((pair) => pair.display));
    setFinanceViewerIndex(Math.min(index, pairs.length - 1));
    setFinanceViewerCategoryLabel(
      String(financeEntryDraft.title || '').trim() || t('order_finance_entry_modal_title', 'Финансовая статья'),
    );
    setFinanceViewerVisible(true);
  }, [financeEntryDraft.title, financeEntryMedia, t]);

  const closeFinanceEntryViewer = useCallback(() => {
    setFinanceViewerVisible(false);
  }, []);

  const handleFinanceViewerDelete = useCallback((viewerIdx) => {
    const rawUrl = financeViewerRawPhotosRef.current?.[viewerIdx];
    if (!rawUrl) return;
    financeEntryMedia.removeFromCache(rawUrl);
    setFinanceEntryDraft((prev) => ({
      ...prev,
      photo_urls: (prev.photo_urls || []).filter((value) => value !== rawUrl),
    }));
    void removeFinanceEntryPhotoRemote(rawUrl, () => {
      setFinanceEntryDraft((prev) => {
        if ((prev.photo_urls || []).some((value) => String(value || '') === String(rawUrl || ''))) return prev;
        return { ...prev, photo_urls: [...(prev.photo_urls || []), String(rawUrl || '')] };
      });
    });
  }, [financeEntryMedia, removeFinanceEntryPhotoRemote]);

  const handleFinanceViewerRotateSave = useCallback((rotationsMap) => {
    const rawPhotos = [...(financeViewerRawPhotosRef.current || [])];
    if (!rawPhotos.length) return;

    (async () => {
      for (const [indexStr, degrees] of Object.entries(rotationsMap || {})) {
        if (!degrees) continue;
        const idx = Number(indexStr);
        const rawUrl = rawPhotos[idx];
        if (!rawUrl) continue;
        const previousDisplayUrl = financeEntryMedia.getDisplayUrl(rawUrl) || rawUrl;
        try {
          const localPath = `${cacheDirectory}finance_rotate_${Date.now()}_${idx}.jpg`;
          const { uri: localUri } = await downloadAsync(previousDisplayUrl, localPath);
          const manipulated = await ImageManipulator.manipulateAsync(
            localUri,
            [{ rotate: degrees }],
            { compress: PHOTO_COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
          );

          // Optimistic UI: show rotated image immediately.
          financeEntryMedia.setDisplayUrl(rawUrl, manipulated.uri);

          const financeEntryId = String(financeEntryDraft.id || '').trim();
          if (!financeEntryId) {
            financeEntryMedia.setDisplayUrl(rawUrl, previousDisplayUrl);
            continue;
          }

          const uploaded = await uploadFinanceEntryLocalUri(financeEntryId, manipulated.uri);
          const uploadedUrl = String(uploaded?.url || '').trim();

          if (!uploadedUrl) {
            financeEntryMedia.setDisplayUrl(rawUrl, previousDisplayUrl);
            continue;
          }

          setFinanceEntryDraft((prev) => ({
            ...prev,
            photo_urls: (prev.photo_urls || []).map((value) => (value === rawUrl ? uploadedUrl : value)),
          }));
          financeViewerRawPhotosRef.current = (financeViewerRawPhotosRef.current || []).map((value) =>
            value === rawUrl ? uploadedUrl : value,
          );
          financeEntryMedia.removeFromCache(rawUrl);
        } catch (error) {
          console.warn('[FinanceViewer] rotate save error:', error);
          financeEntryMedia.setDisplayUrl(rawUrl, previousDisplayUrl);
        }
      }
    })();
  }, [financeEntryDraft.id, financeEntryMedia, uploadFinanceEntryLocalUri]);

  const uploadFinanceEntryLocalUri = useCallback(
    async (financeEntryIdValue, uri) => {
      if (!financeEntryIdValue || !uri) return null;

      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: PHOTO_MAX_WIDTH } }],
        { compress: PHOTO_COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
      );

      let arrayBuffer = null;
      const ensureArrayBuffer = async () => {
        if (arrayBuffer) return arrayBuffer;
        const response = await fetch(manipulated.uri);
        arrayBuffer = await response.arrayBuffer();
        return arrayBuffer;
      };

      if (effectiveMediaProvider === 'yandex_disk') {
        try {
          let data = null;
          let directUploadCompleted = false;
          try {
            const prepared = await financeEntryYandexMedia('prepare_upload', {
              finance_entry_id: financeEntryIdValue,
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

            data = await financeEntryYandexMedia('commit_upload', {
              finance_entry_id: financeEntryIdValue,
              external_path: prepared?.external_path || null,
            });
          } catch (directError) {
            if (directUploadCompleted) throw directError;
            const fallbackBuffer = await ensureArrayBuffer();
            data = await financeEntryYandexMedia('upload', {
              finance_entry_id: financeEntryIdValue,
              file_base64: encodeBase64(fallbackBuffer),
              mime: PHOTO_MIME_TYPE,
            });
          }
          return data;
        } catch (error) {
          if (!isYandexProviderFailureMessage(error?.message || error)) throw error;
          setCloudHealth('error');
          setEffectiveMediaProvider('beget_s3');
          notifyCloudFallback();
        }
      }

      let data = null;
      let directUploadCompleted = false;
      try {
        const prepared = await financeEntryMediaStorage('prepare_upload', {
          finance_entry_id: financeEntryIdValue,
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

        data = await financeEntryMediaStorage('commit_upload', {
          finance_entry_id: financeEntryIdValue,
          object_key: prepared?.object_key || null,
          public_url: prepared?.public_url || null,
        });
      } catch (directError) {
        if (directUploadCompleted) throw directError;
        const fallbackBuffer = await ensureArrayBuffer();
        data = await financeEntryMediaStorage('upload', {
          finance_entry_id: financeEntryIdValue,
          file_base64: encodeBase64(fallbackBuffer),
          mime: PHOTO_MIME_TYPE,
        });
      }

      return data;
    },
    [effectiveMediaProvider, notifyCloudFallback],
  );

  const deleteFinanceEntryPhotoByUrl = useCallback(async (financeEntryIdValue, url) => {
    const payload = { finance_entry_id: financeEntryIdValue, url };
    const tryYandex = () => financeEntryYandexMedia('delete', payload);
    const tryBeget = () => financeEntryMediaStorage('delete', payload);
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

  const saveFinanceEntry = useCallback(async () => {
    if (!id || !companyId) return;
    const title = String(financeEntryDraft.title || '').trim();
    const rawAmount = String(financeEntryDraft.input_amount ?? '').trim();
    const rawPercent = String(financeEntryDraft.input_percent ?? '').trim();
    const parsedAmount = parseMoney(financeEntryDraft.input_amount);
    const parsedPercent = parseMoney(financeEntryDraft.input_percent);
    const nextErrors = {};
    setFinanceEntrySubmitAttempt(true);
    if (!title) {
      nextErrors.title = { message: t('finance_rule_name_required', 'Укажите название правила') };
    }
    if (financeEntryDraft.calc_mode === 'percent') {
      if (rawPercent && !isValidFinanceNumericInput(rawPercent)) {
        nextErrors.input_percent = { message: t('order_validation_amount_format', 'Введите корректную сумму') };
      } else if (!rawPercent || parsedPercent === 0) {
        nextErrors.input_percent = { message: t('field_settings_required_fill', 'Заполните обязательные поля') };
      }
    } else if (rawAmount && !isValidFinanceNumericInput(rawAmount)) {
      nextErrors.input_amount = { message: t('order_validation_amount_format', 'Введите корректную сумму') };
    } else if (!rawAmount || parsedAmount === 0) {
      nextErrors.input_amount = { message: t('field_settings_required_fill', 'Заполните обязательные поля') };
    }
    if (Object.keys(nextErrors).length > 0) {
      setFinanceEntryFieldErrors(nextErrors);
      return;
    }
    setFinanceEntryFieldErrors({});

    try {
      const savedEntry = await upsertFinanceEntryMutation.mutateAsync({
        id: financeEntryDraft.id || undefined,
        company_id: companyId,
        order_id: id,
        kind: financeEntryDraft.kind,
        calc_mode: financeEntryDraft.calc_mode,
        percent_base: financeEntryDraft.percent_base,
        expense_payer: financeEntryDraft.kind === 'expense' ? financeEntryDraft.expense_payer : 'company',
        title,
        note: String(financeEntryDraft.note || '').trim() || null,
        input_amount: parsedAmount || 0,
        input_percent: parsedPercent || 0,
        recipient_user_id: null,
      });
      const savedEntryId = savedEntry?.id || financeEntryDraft.id;
      if (!savedEntryId) throw new Error(t('order_save_error'));

      const draftPhotos = Array.isArray(financeEntryDraft.photo_urls)
        ? financeEntryDraft.photo_urls.map((value) => String(value || '')).filter(Boolean)
        : [];
      const initialRemotePhotos = financeEntryInitialPhotoUrlsRef.current || [];
      const localDraftPhotos = draftPhotos.filter((value) => isLocalFinancePhotoUrl(value));
      const remoteDraftPhotos = draftPhotos.filter((value) => !isLocalFinancePhotoUrl(value));
      const removedRemotePhotos = initialRemotePhotos.filter((value) => !remoteDraftPhotos.includes(value));
      const mediaErrors = [];

      for (const removedUrl of removedRemotePhotos) {
        try {
          await deleteFinanceEntryPhotoByUrl(savedEntryId, removedUrl);
          financeEntryMedia.removeFromCache(removedUrl);
        } catch (error) {
          mediaErrors.push(error?.message || t('order_toast_delete_error'));
        }
      }

      for (const localUri of localDraftPhotos) {
        try {
          await uploadFinanceEntryLocalUri(savedEntryId, localUri);
        } catch (error) {
          mediaErrors.push(error?.message || t('order_toast_upload_error'));
        }
      }

      await financeEntriesQuery.refetch();
      financeEntryInitialPhotoUrlsRef.current = [];
      setFinanceEntryLocalPending([]);
      setFinanceEntryPhotosModalVisible(false);
      setFinanceEntryModalVisible(false);
      setFinanceEntrySubmitAttempt(false);
      setFinanceEntryFieldErrors({});
      setSelectedFinanceEntry(null);
      if (mediaErrors.length > 0) {
        showWarning(
          t(
            'finance_entry_media_partial_save',
            'Статья сохранена, но часть фотографий не удалось обработать.',
          ),
        );
      } else {
        showToast(t('order_toast_saved'));
      }
    } catch (error) {
      showWarning(error?.message || t('order_save_error'));
    }
  }, [
    companyId,
    deleteFinanceEntryPhotoByUrl,
    financeEntriesQuery,
    financeEntryDraft,
    financeEntryMedia,
    id,
    isValidFinanceNumericInput,
    isLocalFinancePhotoUrl,
    parseMoney,
    showToast,
    showWarning,
    setFinanceEntryFieldErrors,
    setFinanceEntrySubmitAttempt,
    t,
    uploadFinanceEntryLocalUri,
    upsertFinanceEntryMutation,
  ]);

  const removeFinanceEntry = useCallback(
    async (entry) => {
      if (!entry?.id || entry?.is_system) return;
      try {
        await deleteFinanceEntryMutation.mutateAsync(entry.id);
        showToast(t('finance_rule_deleted', 'Запись удалена'));
      } catch (error) {
        showWarning(error?.message || t('order_save_error'));
      }
    },
    [deleteFinanceEntryMutation, showToast, showWarning, t],
  );

  const confirmDeleteFinanceEntry = useCallback(async () => {
    if (!selectedFinanceEntry?.id) return;
    await removeFinanceEntry(selectedFinanceEntry);
    setFinanceEntryDeleteConfirmVisible(false);
    setFinanceEntryViewModalVisible(false);
    setSelectedFinanceEntry(null);
  }, [removeFinanceEntry, selectedFinanceEntry]);

  const toggleFinanceSection = useCallback((sectionKey) => {
    setExpandedFinanceSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
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
    const required = ORDER_MEDIA_FIELD_KEYS.filter((fieldKey) => {
      const field = orderFieldsByKey.get(fieldKey);
      return field?.isEnabled !== false && field?.isRequired === true;
    });
    return required.every((cat) => Array.isArray(order[cat]) && order[cat].length > 0);
  }, [order, orderFieldsByKey]);

  const handleFinishOrder = useCallback(async () => {
    const missing = [];
    if (
      isOrderFieldVisible('contract_file') &&
      orderFieldsByKey.get('contract_file')?.isRequired === true &&
      (!Array.isArray(order.contract_file) || order.contract_file.length === 0)
    ) {
      missing.push(getOrderFieldLabel('contract_file', t('order_media_field_1', 'Медиа 1')).toLowerCase());
    }
    if (
      isOrderFieldVisible('photo_before') &&
      orderFieldsByKey.get('photo_before')?.isRequired === true &&
      (!Array.isArray(order.photo_before) || order.photo_before.length === 0)
    ) {
      missing.push(getOrderFieldLabel('photo_before', t('order_media_field_2', 'Медиа 2')).toLowerCase());
    }
    if (
      isOrderFieldVisible('photo_after') &&
      orderFieldsByKey.get('photo_after')?.isRequired === true &&
      (!Array.isArray(order.photo_after) || order.photo_after.length === 0)
    ) {
      missing.push(getOrderFieldLabel('photo_after', t('order_media_field_3', 'Медиа 3')).toLowerCase());
    }
    if (
      isOrderFieldVisible('act_file') &&
      orderFieldsByKey.get('act_file')?.isRequired === true &&
      (!Array.isArray(order.act_file) || order.act_file.length === 0)
    ) {
      missing.push(getOrderFieldLabel('act_file', t('order_media_field_4', 'Медиа 4')).toLowerCase());
    }
    if (
      isOrderFieldVisible('media_file_5') &&
      orderFieldsByKey.get('media_file_5')?.isRequired === true &&
      (!Array.isArray(order.media_file_5) || order.media_file_5.length === 0)
    ) {
      missing.push(getOrderFieldLabel('media_file_5', t('order_media_field_5', 'Медиа 5')).toLowerCase());
    }

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
      await updateRequestWithVersion(order.id, { status: mapStatusToDb('done') }, order?.updated_at || null);
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
  }, [getOrderFieldLabel, isOrderFieldVisible, order, orderFieldsByKey, showToast, t]);

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
        const isInFeed = latestStatus === t('order_status_in_feed') || latestStatus === mapStatusToDb('feed');
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
        setExecutorName(
          me ? `${me.first_name || ''} ${me.middle_name || ''} ${me.last_name || ''}`.trim() : null,
        );
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

    const resolvedTitle = resolveTitleForSave(title, departureDate);
    if (!resolvedTitle) return showWarning(t('order_validation_title_required'));
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
      title: resolvedTitle,
      comment: description,
      assigned_to: toFeed ? null : assigneeId,
      time_window_start: departureDate.toISOString(),
      status: nextStatus,
      urgent,
      ...(canEditFinances ? { price: parseMoney(amount) } : {}),
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
      setTitle(resolveRequestTitle(data, { prefix: titlePrefix }));
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
      setWorkTypeId(data.work_type_id || null);

      initialFormSnapshotRef.current = makeSnapshotFromOrder(data);

      if (data.assigned_to) {
        const sel = (users || []).find((u) => u.id === data.assigned_to);
        if (sel) {
          setExecutorName(`${sel.first_name || ''} ${sel.middle_name || ''} ${sel.last_name || ''}`.trim());
        } else {
          try {
            const { data: exec } = await supabase
              .from('profiles')
              .select('first_name, middle_name, last_name')
              .eq('id', data.assigned_to)
              .single();
            setExecutorName(
              exec ? `${exec.first_name || ''} ${exec.middle_name || ''} ${exec.last_name || ''}`.trim() : null,
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
    canEditFinances,
    amount,
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
    resolveTitleForSave,
    titlePrefix,
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

      setTitle(resolveRequestTitle(order, { prefix: titlePrefix }));
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
      setWorkTypeId(order.work_type_id || null);
      setAmount(order.price !== null && order.price !== undefined ? String(order.price) : '');
    }
  }, [order, makeSnapshotFromOrder, applyNavBar, titlePrefix]);

  const deleteOrderCompletely = useCallback(async () => {
    const deletedOrderId = String(order?.id || '').trim();
    const pruneDeletedOrderFromCache = (cache) => {
      if (!cache || !deletedOrderId) return cache;
      if (Array.isArray(cache)) {
        return cache.filter((item) => String(item?.id || '') !== deletedOrderId);
      }
      if (typeof cache !== 'object') return cache;

      if (Array.isArray(cache?.items)) {
        return {
          ...cache,
          items: cache.items.filter((item) => String(item?.id || '') !== deletedOrderId),
        };
      }

      if (Array.isArray(cache?.pages)) {
        return {
          ...cache,
          pages: cache.pages.map((page) => pruneDeletedOrderFromCache(page)),
        };
      }

      return cache;
    };

    const applyDeletedOrderToLocalCaches = () => {
      if (!deletedOrderId) return;
      queryClient.setQueriesData({ queryKey: ['requests'] }, (old) =>
        pruneDeletedOrderFromCache(old),
      );
      queryClient.removeQueries({ queryKey: queryKeys.requests.detail(deletedOrderId), exact: true });

      const listCacheMy = globalThis?.LIST_CACHE?.my;
      if (listCacheMy && typeof listCacheMy === 'object') {
        Object.keys(listCacheMy).forEach((key) => {
          const value = listCacheMy[key];
          if (!Array.isArray(value)) return;
          listCacheMy[key] = value.filter((item) => String(item?.id || '') !== deletedOrderId);
        });
      }
    };

    try {
      const { data, error: delErr } = await supabase
        .from('orders')
        .delete()
        .eq('id', order.id)
        .select('id');

      if (delErr) {
        showToast(t('order_toast_delete_error'));
        return;
      }
      if (!Array.isArray(data) || data.length === 0) {
        // Record is already gone (stale detail screen) - treat as successful delete UX.
        applyDeletedOrderToLocalCaches();
      } else {
        applyDeletedOrderToLocalCaches();
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
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      if (deletedOrderId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.requests.detail(deletedOrderId) });
      }

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
  }, [order, resolvedClientId, queryClient, navigation, router, showToast, t, backTargetPath, returnParams]);

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

  // в”Ђв”Ђв”Ђ Photo viewer (uses FullscreenImageViewer) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

      // Fire-and-forget вЂ” runs entirely in background
      (async () => {
        for (const [indexStr, degrees] of Object.entries(rotationsMap)) {
          if (!degrees) continue;
          const idx = Number(indexStr);
          const rawUrl = rawPhotos[idx];
          if (!rawUrl) continue;
          const previousDisplayUrl = orderMediaRef.current.getDisplayUrl(rawUrl) || rawUrl;

          try {
            const localPath = `${cacheDirectory}rotate_src_${Date.now()}.jpg`;
            const { uri: localUri } = await downloadAsync(previousDisplayUrl, localPath);

            const manipulated = await ImageManipulator.manipulateAsync(
              localUri,
              [{ rotate: degrees }],
              { compress: PHOTO_COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
            );

            // Optimistic UI: show rotated image immediately.
            orderMediaRef.current.setDisplayUrl(rawUrl, manipulated.uri);

            // Replace in place вЂ” the old URL is swapped for the new one at the same index
            const success = await uploadLocalUri(category, manipulated.uri, {
              replaceUrl: rawUrl,
              silent: true,
            });
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
            } else {
              orderMediaRef.current.setDisplayUrl(rawUrl, previousDisplayUrl);
            }
          } catch (e) {
            console.warn('[Viewer] rotate save error:', e);
            orderMediaRef.current.setDisplayUrl(rawUrl, previousDisplayUrl);
          }
        }
      })();
    },
    [uploadLocalUri],
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
      if (!id) return;
      const task = InteractionManager.runAfterInteractions(() => {
        refetchRequestData?.();
      });
      return () => task.cancel();
    }, [id, refetchRequestData]),
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

  const fullTitle = resolveRequestTitle(order, {
    prefix: titlePrefix,
    fallbackDate: order?.time_window_start,
  });
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
  const visibleOrderAddress = useMemo(
    () => filterOrderAddressByObjectFieldSettings(orderAddress, objectFieldsByKey),
    [objectFieldsByKey, orderAddress],
  );
  const shortOrderAddress = useMemo(() => buildOrderAddressShort(visibleOrderAddress), [visibleOrderAddress]);
  const fullOrderAddress = useMemo(() => buildOrderAddressDisplay(visibleOrderAddress), [visibleOrderAddress]);
  const orderAddressForNavigator = useMemo(
    () => buildAddressForNavigator(visibleOrderAddress),
    [visibleOrderAddress],
  );
  const orderMapLat = useMemo(() => normalizeCoordinateValue(orderAddress?.geo_lat), [orderAddress?.geo_lat]);
  const orderMapLng = useMemo(() => normalizeCoordinateValue(orderAddress?.geo_lng), [orderAddress?.geo_lng]);
  const orderHasMapPoint = useMemo(() => hasClientObjectMapPoint(orderAddress), [orderAddress]);
  const orderLocationMode = useMemo(
    () =>
      normalizeClientObjectLocationMode(order?.object_location_mode || order?.object?.location_mode, {
        fallback: orderHasMapPoint ? 'map' : 'address',
      }),
    [order?.object?.location_mode, order?.object_location_mode, orderHasMapPoint],
  );
  const useCoordinatesForOrderAddress = orderLocationMode === 'map' && orderHasMapPoint;
  const orderAddressItems = useMemo(
    () =>
      [
        [t('order_field_country'), visibleOrderAddress.country],
        [t('order_field_region'), visibleOrderAddress.region],
        [t('order_field_district'), visibleOrderAddress.district],
        [t('order_field_city'), visibleOrderAddress.city],
        [t('order_field_street'), visibleOrderAddress.street],
        [t('order_field_house'), visibleOrderAddress.house],
        [t('order_field_floor'), visibleOrderAddress.floor],
        [t('order_field_entrance'), visibleOrderAddress.entrance],
        [t('order_field_apartment'), visibleOrderAddress.apartment],
        [t('order_field_postal_code'), visibleOrderAddress.postal_code],
        [t('order_field_comment'), visibleOrderAddress.entrance_info],
      ]
        .filter(([, value]) => String(value || '').trim().length > 0)
        .map(([label, value]) => ({ label, value: String(value || '').trim() })),
    [t, visibleOrderAddress],
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

  const _selectedAssignee = (users || []).find((u) => u.id === assigneeId) || null;
  const isFree = !order.assigned_to;
  const isInFeedStatus = order.status === mapStatusToDb('feed') || order.status === t('order_status_in_feed');
  const canAcceptOrder =
    isInFeedStatus &&
    isFree &&
    !isReadOnlyBySubscription &&
    (role === 'worker' || (has('canAssignExecutors') && canEditByRole()));
  const canViewFinanceSection = canViewOrderAmount || canViewFinanceEntries;
  const currency = order?.currency || companySettings?.currency;
  const grossTotal = Number(order.price ?? 0) || 0;
  const financeIncomeTotal = financeEntries.reduce(
    (sum, entry) => (entry?.kind === 'income' ? sum + (Number(entry?.calculated_amount) || 0) : sum),
    0,
  );
  const financeExpenseTotal = financeEntries.reduce(
    (sum, entry) => (entry?.kind === 'expense' ? sum + (Number(entry?.calculated_amount) || 0) : sum),
    0,
  );
  const financeCompanyPaidExpenseTotal = financeEntries.reduce(
    (sum, entry) =>
      entry?.kind === 'expense' && String(entry?.expense_payer || 'company') === 'company'
        ? sum + (Number(entry?.calculated_amount) || 0)
        : sum,
    0,
  );
  const financeExecutorPaidExpenseTotal = financeEntries.reduce(
    (sum, entry) =>
      entry?.kind === 'expense' && String(entry?.expense_payer || 'company') === 'executor'
        ? sum + (Number(entry?.calculated_amount) || 0)
        : sum,
    0,
  );
  const financeDiscountTotal = financeEntries.reduce(
    (sum, entry) => (entry?.kind === 'discount' ? sum + (Number(entry?.calculated_amount) || 0) : sum),
    0,
  );
  const customerFinanceTotal =
    Number(order.finance_gross_total ?? grossTotal + financeIncomeTotal - financeDiscountTotal) || 0;
  const internalFinanceTotal = Number(financeExpenseTotal) || 0;
  const normalizedPaymentStatus = normalizePaymentStatus(order?.payment_status);
  const normalizedPaymentMethod = normalizePaymentMethod(order?.payment_method);
  const isOrderPaid = normalizedPaymentStatus === 'paid';
  const executorAccruedTotal =
    Number(customerFinanceTotal - financeCompanyPaidExpenseTotal + financeExecutorPaidExpenseTotal) || 0;
  const executorFinanceTotal = isOrderPaid ? executorAccruedTotal : 0;
  const hasExecutorFinanceBreakdown =
    financeCompanyPaidExpenseTotal > 0 || financeExecutorPaidExpenseTotal > 0;
  const showInitialCostLine =
    canViewOrderAmount &&
    isOrderFieldVisible('price');
  const visibleMediaFields = ORDER_MEDIA_FIELD_KEYS.filter(
    (fieldKey) => isOrderFieldVisible(fieldKey),
  );
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
          title: fullTitle,
          fullTitle,
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
      <View style={{ flex: 1 }}>
        {refreshIndicator}
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
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
                  <OrderStatusCapsule status={order.status} />
                </View>
              </View>
              <View style={base.sep} />

              {isOrderFieldVisible('assigned_to') ? (
                <Pressable
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
                  <LabelValueRow
                    label={t('order_details_executor')}
                    valueComponent={
                      deriveExecutorNameInstant(order) || executorName ? (
                        <Text
                          style={[
                            base.value,
                            order?.assigned_to &&
                            (String(order?.assigned_to) === String(auth.user?.id) || has('canViewClients'))
                              ? styles.link
                              : null,
                          ]}
                        >
                          {deriveExecutorNameInstant(order) || executorName}
                        </Text>
                      ) : (
                        <Text style={[base.value, { color: theme.colors.textSecondary }]}>
                          {t('order_details_not_assigned')}
                        </Text>
                      )
                    }
                    hideWhenEmpty={false}
                  />
                </Pressable>
              ) : null}
              {isOrderFieldVisible('assigned_to') ? <View style={base.sep} /> : null}

              {orderFieldsByKey.get('work_type_id')?.isEnabled !== false ? (
                <LabelValueRow
                  label={t('order_details_work_type')}
                  value={workTypeName || t('order_details_work_type_not_selected')}
                  hideWhenEmpty={false}
                />
              ) : null}
              {orderFieldsByKey.get('work_type_id')?.isEnabled !== false ? <View style={base.sep} /> : null}

              {(isOrderFieldVisible('time_window_start') || isOrderFieldVisible('departure_time')) ? (
                <Pressable
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
                  <LabelValueRow
                    label={t('order_details_departure_date')}
                    valueComponent={
                      <Text style={[base.value, styles.link]}>
                        {(() => {
                          if (!order.time_window_start) return t('order_details_departure_not_specified');
                          const startDate = new Date(order.time_window_start);
                          const hasRangeEnd = !!order.time_window_end;
                          const showDepartureTime = isOrderFieldVisible('departure_time');
                          if (!hasRangeEnd) {
                            return format(
                              startDate,
                              showDepartureTime ? 'd MMMM yyyy, HH:mm' : 'd MMMM yyyy',
                              { locale: ru },
                            );
                          }
                          const endDate = new Date(order.time_window_end);
                          return `${format(startDate, 'd MMMM yyyy', { locale: ru })} — ${format(endDate, 'd MMMM yyyy', { locale: ru })}`;
                        })()}
                      </Text>
                    }
                    hideWhenEmpty={false}
                  />
                </Pressable>
              ) : null}
              {(isOrderFieldVisible('time_window_start') || isOrderFieldVisible('departure_time')) ? <View style={base.sep} /> : null}

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
              {isOrderFieldVisible('client_id') ? (
                <Pressable onPress={onOpenClient} disabled={!linkedClientId || !canViewClients}>
                  <LabelValueRow
                    label={t('order_details_customer')}
                    valueComponent={
                      <Text style={[base.value, linkedClientId && canViewClients ? styles.link : null]}>
                        {customerDisplayName}
                      </Text>
                    }
                    hideWhenEmpty={false}
                  />
                </Pressable>
              ) : null}
              {isOrderFieldVisible('client_id') ? <View style={base.sep} /> : null}

              {isOrderFieldVisible('object_id') ? (
                <Pressable onPress={onOpenObject} disabled={!linkedObjectId || !canViewObjects}>
                  <LabelValueRow
                    label={t('routes_objects_object')}
                    valueComponent={
                      <Text
                        style={[
                          base.value,
                          linkedObjectId && canViewObjects ? styles.link : null,
                          isObjectDeleted ? styles.deletedObjectText : null,
                        ]}
                      >
                        {objectRowValue}
                      </Text>
                    }
                    hideWhenEmpty={false}
                  />
                </Pressable>
              ) : null}
              {isOrderFieldVisible('object_id') ? <View style={base.sep} /> : null}
              {isOrderFieldVisible('object_id') ? (
                useCoordinatesForOrderAddress ? (
                  <LabelValueRow
                    label={t('objects_location_coordinates')}
                    valueComponent={(
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => openCoordinatesInYandex(orderMapLat, orderMapLng)}
                      >
                        <Text style={[base.value, styles.link]}>{`${orderMapLat}, ${orderMapLng}`}</Text>
                      </Pressable>
                    )}
                    hideWhenEmpty={false}
                  />
                ) : (
                  <ExpandableTextRow
                    label={t('order_details_address')}
                    value={
                      orderAddressItems.length > 0
                        ? orderAddressItems.map((item) => `${item.label}: ${item.value}`).join(', ')
                        : t('order_details_address_not_specified')
                    }
                    collapsedValue={shortOrderAddress || fullOrderAddress || t('order_details_address_not_specified')}
                    expandedKeyValueItems={orderAddressItems}
                    expandedActionText={orderAddressForNavigator ? t('order_address_map') : null}
                    collapsedValueStyle={orderAddressForNavigator ? styles.link : null}
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
                )
              ) : null}
            </Card>

            {canViewFinanceSection && (isOrderFieldVisible('price') || canViewFinanceEntries) ? (
              <>
                <SectionHeader topSpacing="xs" bottomSpacing="xs">
                  {t('order_details_finance_data')}
                </SectionHeader>
                <Card paddedXOnly>
                  {canViewFinanceEntries ? (
                    <>
                      <FinanceAccordionRow
                        label={t('order_finance_customer_section', 'Общая сумма')}
                        summaryValue={formatMoney(customerFinanceTotal, currency)}
                        summaryTone={isOrderPaid ? 'success' : 'warning'}
                        summaryIcon={
                          isOrderPaid ? (
                            <View
                              style={[
                                styles.financeStatusCircle,
                                { borderColor: theme.colors.success },
                              ]}
                            >
                              <Feather
                                name="check"
                                size={Math.max(10, (theme.icons?.xs ?? 12))}
                                color={theme.colors.success}
                              />
                            </View>
                          ) : (
                            <MaterialCommunityIcons
                              name="qrcode"
                              size={theme.icons?.sm ?? 18}
                              color={theme.colors.warning || theme.colors.primary}
                            />
                          )
                        }
                        summaryIconOnPress={isOrderPaid ? null : handleQrPaymentPress}
                        summaryIconAccessibilityLabel={isOrderPaid ? null : t('order_payment_qr_soon', 'Скоро добавим')}
                        expanded={expandedFinanceSections.customer}
                        onToggle={() => toggleFinanceSection('customer')}
                        base={base}
                        styles={styles}
                        theme={theme}
                      >
                        {financeEntriesQuery.isLoading ? (
                          <View style={styles.financeSectionLoader}>
                            <ActivityIndicator size="small" color={theme.colors.primary} />
                          </View>
                        ) : (
                          <>
                            {isOrderFieldVisible('payment_status') ? (
                              <>
                                <Pressable
                                  style={({ pressed }) => [canEditFinances && pressed && { opacity: 0.7 }]}
                                  disabled={!canEditFinances}
                                  onPress={() => {
                                    if (!canEditFinances) return;
                                    setPaymentStatusModalVisible(true);
                                  }}
                                >
                                    <LabelValueRow
                                      label={t('order_details_payment_status', 'Статус оплаты')}
                                      valueComponent={
                                        <Text
                                          style={[
                                          base.value,
                                          {
                                            color: isOrderPaid
                                              ? theme.colors.success
                                              : theme.colors.warning || theme.colors.primary,
                                          },
                                        ]}
                                      >
                                        {paymentStatusLabel(normalizedPaymentStatus)}
                                      </Text>
                                    }
                                    hideWhenEmpty={false}
                                    rightActions={
                                      canEditFinances ? (
                                        <Feather
                                          name="chevron-right"
                                          size={theme.icons?.sm ?? 18}
                                          color={theme.colors.textSecondary}
                                        />
                                      ) : null
                                    }
                                  />
                                </Pressable>
                                {isOrderFieldVisible('payment_method') || showInitialCostLine ? <View style={base.sep} /> : null}
                              </>
                            ) : null}

                            {isOrderFieldVisible('payment_method') ? (
                              <>
                                <Pressable
                                  style={({ pressed }) => [canEditFinances && pressed && { opacity: 0.7 }]}
                                  disabled={!canEditFinances}
                                  onPress={() => {
                                    if (!canEditFinances) return;
                                    setPaymentMethodModalVisible(true);
                                  }}
                                >
                                    <LabelValueRow
                                      label={t('order_details_payment_method', 'Способ оплаты')}
                                      value={paymentMethodLabel(normalizedPaymentMethod)}
                                      hideWhenEmpty={false}
                                      rightActions={
                                        canEditFinances ? (
                                        <Feather
                                          name="chevron-right"
                                          size={theme.icons?.sm ?? 18}
                                          color={theme.colors.textSecondary}
                                        />
                                      ) : null
                                    }
                                  />
                                </Pressable>
                                {showInitialCostLine ? <View style={base.sep} /> : null}
                              </>
                            ) : null}

                            {showInitialCostLine ? (
                              <Pressable
                                style={({ pressed }) => [canEditOrderAmount && pressed && { opacity: 0.7 }]}
                                disabled={!canEditOrderAmount}
                                onPress={() => {
                                  if (!canEditOrderAmount) return;
                                  setAmountDraft(String(order?.price ?? ''));
                                  setAmountEditModalVisible(true);
                                }}
                              >
                                <LabelValueRow
                                  label={t('order_finance_initial_cost', 'Изначальная стоимость')}
                                  value={formatMoney(order.price, currency)}
                                  hideWhenEmpty={false}
                                  rightActions={
                                    canEditOrderAmount ? (
                                      <Feather
                                        name="chevron-right"
                                        size={theme.icons?.sm ?? 18}
                                        color={theme.colors.textSecondary}
                                      />
                                    ) : null
                                  }
                                />
                              </Pressable>
                            ) : null}

                            {showInitialCostLine && hasCustomerFinanceEntries ? <View style={base.sep} /> : null}

                            {financeIncomeEntries.map((entry, index) => (
                              <View key={entry.id}>
                                {index > 0 ? <View style={base.sep} /> : null}
                                <Pressable
                                  style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                                  onPress={() => openFinanceEntryView(entry)}
                                >
                                  <LabelValueRow
                                    label={entry.title || t('finance_rule_name', 'Название')}
                                    labelContainerStyle={styles.financeEntryLabelWrap}
                                    rightWrapStyle={styles.financeEntryRightWrap}
                                    valueComponent={
                                      <Text style={base.value} numberOfLines={1} ellipsizeMode="tail">
                                        {`+ ${formatMoney(entry.calculated_amount, currency)}`}
                                      </Text>
                                    }
                                    hideWhenEmpty={false}
                                    rightActions={
                                      <Feather
                                        name="chevron-right"
                                        size={theme.icons?.sm ?? 18}
                                        color={theme.colors.textSecondary}
                                      />
                                    }
                                  />
                                </Pressable>
                              </View>
                            ))}

                            {financeIncomeEntries.length > 0 && financeDiscountEntries.length > 0 ? <View style={base.sep} /> : null}

                            {financeDiscountEntries.map((entry, index) => (
                              <View key={entry.id}>
                                {index > 0 ? <View style={base.sep} /> : null}
                                <Pressable
                                  style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                                  onPress={() => openFinanceEntryView(entry)}
                                >
                                  <LabelValueRow
                                    label={entry.title || t('finance_rule_name', 'Название')}
                                    labelContainerStyle={styles.financeEntryLabelWrap}
                                    rightWrapStyle={styles.financeEntryRightWrap}
                                    valueComponent={
                                      <Text style={base.value} numberOfLines={1} ellipsizeMode="tail">
                                        {`- ${formatMoney(entry.calculated_amount, currency)}`}
                                      </Text>
                                    }
                                    hideWhenEmpty={false}
                                    rightActions={
                                      <Feather
                                        name="chevron-right"
                                        size={theme.icons?.sm ?? 18}
                                        color={theme.colors.textSecondary}
                                      />
                                    }
                                  />
                                </Pressable>
                              </View>
                            ))}

                          </>
                        )}
                      </FinanceAccordionRow>

                      {internalFinanceTotal > 0 ? (
                        <>
                          <View style={base.sep} />

                          <FinanceAccordionRow
                            label={t('order_finance_internal_section', 'Расходы')}
                            summaryValue={`- ${formatMoney(internalFinanceTotal, currency)}`}
                            summaryTone="default"
                            hideSummaryWhenCollapsed={true}
                            expanded={expandedFinanceSections.internal}
                            onToggle={() => toggleFinanceSection('internal')}
                            base={base}
                            styles={styles}
                            theme={theme}
                          >
                            {financeEntriesQuery.isLoading ? (
                              <View style={styles.financeSectionLoader}>
                                <ActivityIndicator size="small" color={theme.colors.primary} />
                              </View>
                            ) : (
                              <>
                                {financeExpenseEntries.map((entry, index) => (
                                  <View key={entry.id}>
                                    {index > 0 ? <View style={base.sep} /> : null}
                                    <Pressable
                                      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                                      onPress={() => openFinanceEntryView(entry)}
                                    >
                                      <LabelValueRow
                                        label={entry.title || t('finance_rule_name', 'Название')}
                                        labelContainerStyle={styles.financeEntryLabelWrap}
                                        rightWrapStyle={styles.financeEntryRightWrap}
                                        valueComponent={
                                          <Text style={base.value} numberOfLines={1} ellipsizeMode="tail">
                                            {`- ${formatMoney(entry.calculated_amount, currency)}`}
                                          </Text>
                                        }
                                        hideWhenEmpty={false}
                                        rightActions={
                                          <Feather
                                            name="chevron-right"
                                            size={theme.icons?.sm ?? 18}
                                            color={theme.colors.textSecondary}
                                          />
                                        }
                                      />
                                    </Pressable>
                                  </View>
                                ))}

                              </>
                            )}
                          </FinanceAccordionRow>

                          <View style={base.sep} />
                        </>
                      ) : null}

                      {hasExecutorFinanceBreakdown ? (
                        <FinanceAccordionRow
                          label={t('order_finance_executor_section', 'Исполнителю')}
                          summaryValue={formatMoney(executorFinanceTotal, currency)}
                          summaryTone="default"
                          hideSummaryWhenCollapsed={true}
                          expanded={expandedFinanceSections.executor}
                          onToggle={() => toggleFinanceSection('executor')}
                          base={base}
                          styles={styles}
                          theme={theme}
                        >
                          {financeEntriesQuery.isLoading ? (
                            <View style={styles.financeSectionLoader}>
                              <ActivityIndicator size="small" color={theme.colors.primary} />
                            </View>
                          ) : (
                            <>
                              <LabelValueRow
                                label={t('order_finance_customer_section', 'Общая сумма')}
                                value={formatMoney(customerFinanceTotal, currency)}
                                hideWhenEmpty={false}
                              />
                              {financeCompanyPaidExpenseTotal > 0 ? (
                                <>
                                  <View style={base.sep} />
                                    <LabelValueRow
                                      label={t('order_finance_company_expense_total', 'Расходы компании')}
                                      valueComponent={
                                        <Text style={base.value}>
                                          {`- ${formatMoney(financeCompanyPaidExpenseTotal, currency)}`}
                                      </Text>
                                    }
                                    hideWhenEmpty={false}
                                  />
                                </>
                              ) : null}
                              {financeExecutorPaidExpenseTotal > 0 ? (
                                <>
                                  <View style={base.sep} />
                                    <LabelValueRow
                                      label={t('order_finance_executor_reimbursement_total', 'Расходы исполнителя')}
                                      valueComponent={
                                        <Text style={base.value}>
                                          {formatMoney(financeExecutorPaidExpenseTotal, currency)}
                                      </Text>
                                    }
                                    hideWhenEmpty={false}
                                  />
                                </>
                              ) : null}
                            </>
                          )}
                        </FinanceAccordionRow>
                      ) : null}

                      {canEditFinanceEntries ? (
                        <>
                          <View style={base.sep} />
                          <Pressable
                            style={({ pressed }) => [base.row, pressed && { opacity: 0.7 }]}
                            onPress={() => setFinanceKindModalVisible(true)}
                          >
                            <Text style={base.label}>
                              {t('order_finance_add_entry_action', 'Добавить расход/доход/скидку')}
                            </Text>
                            <View style={base.rightWrap}>
                              <Feather
                                name="chevron-right"
                                size={theme.icons?.sm ?? 18}
                                color={theme.colors.textSecondary}
                                style={{ marginLeft: theme.spacing.xs }}
                              />
                            </View>
                          </Pressable>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {showInitialCostLine ? (
                        <Pressable
                          style={({ pressed }) => [canEditOrderAmount && pressed && { opacity: 0.7 }]}
                          disabled={!canEditOrderAmount}
                          onPress={() => {
                            if (!canEditOrderAmount) return;
                            setAmountDraft(String(order?.price ?? ''));
                            setAmountEditModalVisible(true);
                          }}
                        >
                          <LabelValueRow
                            label={t('order_finance_initial_cost', 'Изначальная стоимость')}
                            value={formatMoney(order.price, currency)}
                            hideWhenEmpty={false}
                            rightActions={
                              canEditOrderAmount ? (
                                <Feather
                                  name="chevron-right"
                                  size={theme.icons?.sm ?? 18}
                                  color={theme.colors.textSecondary}
                                />
                              ) : null
                            }
                          />
                        </Pressable>
                      ) : null}

                    </>
                  )}
                </Card>
              </>
            ) : null}

            {!isFree && visibleMediaFields.length > 0 && (
              <>
                <SectionHeader topSpacing="xs" bottomSpacing="xs">
                  {t('order_details_photos_section', 'Фото')}
                </SectionHeader>
                {cloudFallbackActive && isAdminUser ? (
                  <Text style={styles.cloudWarningText}>
                    {`${t('order_cloud_fallback_admin_notice')} (${cloudHealthLabel})`}
                  </Text>
                ) : null}
                <Card paddedXOnly>
                  {visibleMediaFields
                    .map((fieldKey) => ({
                      key: fieldKey,
                      label: getOrderFieldLabel(fieldKey, t(`order_media_field_${ORDER_MEDIA_FIELD_KEYS.indexOf(fieldKey) + 1}`, `Медиа ${ORDER_MEDIA_FIELD_KEYS.indexOf(fieldKey) + 1}`)),
                    }))
                    .map((row, idx) => {
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
                  contract_file: getOrderFieldLabel('contract_file', t('order_media_field_1', 'Медиа 1')),
                  photo_before: getOrderFieldLabel('photo_before', t('order_media_field_2', 'Медиа 2')),
                  photo_after: getOrderFieldLabel('photo_after', t('order_media_field_3', 'Медиа 3')),
                  act_file: getOrderFieldLabel('act_file', t('order_media_field_4', 'Медиа 4')),
                  media_file_5: getOrderFieldLabel('media_file_5', t('order_media_field_5', 'Медиа 5')),
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

            {order.status !== mapStatusToDb('done') && !isFree && canEdit() && (
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
      </View>
    </SafeAreaView>

      <SelectModal
        visible={workTypeModalVisible}
        title={t('order_modal_work_type_select')}
        searchable={false}
        items={(workTypes || [])
          .filter((item) => item?.is_enabled !== false)
          .map((wt) => ({ id: wt.id, label: wt.name }))}
        onSelect={(item) => {
          setWorkTypeId(item.id);
          setWorkTypeModalVisible(false);
        }}
        onClose={() => setWorkTypeModalVisible(false)}
        emptyComponent={
          <Text style={styles.modalText}>{t('order_modal_work_type_empty')}</Text>
        }
      />

      <FullscreenImageViewer
        visible={viewerVisible}
        images={viewerPhotos}
        initialIndex={viewerIndex}
        onClose={closeViewer}
        onDelete={handleViewerDelete}
        onRotateSave={handleViewerRotateSave}
        categoryLabel={viewerCategoryLabel}
      />

      <ConfirmModal
        visible={cancelVisible}
        title={t('order_modal_cancel_edit_title')}
        message={t('order_modal_cancel_edit_msg')}
        confirmLabel={t('order_modal_cancel_leave')}
        cancelLabel={t('order_modal_cancel_stay')}
        confirmVariant="destructive"
        onClose={() => setCancelVisible(false)}
        onConfirm={confirmCancel}
      />

      <SelectModal
        visible={assigneeModalVisible}
        title={t('order_modal_select_executor')}
        searchable={false}
        items={[
          { id: '__feed__', label: t('order_modal_to_feed') },
          ...users.map((user) => ({
            id: user.id,
            label: [user.first_name, user.middle_name, user.last_name].filter(Boolean).join(' '),
          })),
        ]}
        onSelect={(item) => {
          if (item.id === '__feed__') {
            setToFeed(true);
            setAssigneeId(null);
          } else {
            setAssigneeId(item.id);
            setExecutorName(item.label);
            setToFeed(false);
          }
          setAssigneeModalVisible(false);
        }}
        onClose={() => setAssigneeModalVisible(false)}
      />

      {useDepartments ? (
        <SelectModal
          visible={departmentModalVisible}
          title={t('order_modal_select_department')}
          searchable={false}
          items={departments.map((d) => ({ id: d.id, label: d.name }))}
          onSelect={(item) => {
            setDepartmentId(item.id);
            setDepartmentModalVisible(false);
          }}
          onClose={() => setDepartmentModalVisible(false)}
          emptyComponent={
            <Text style={styles.modalText}>{t('order_modal_no_departments')}</Text>
          }
        />
      ) : null}

      <BaseModal
        visible={amountEditModalVisible}
        onClose={() => setAmountEditModalVisible(false)}
        onOpened={focusAmountEditInput}
        onOpenedDelayMs={170}
        title={t('order_modal_edit_amount_title')}
        maxHeightRatio={0.45}
      >
        <TextField
          ref={amountEditInputRef}
          showSoftInputOnFocus
          label={t('order_modal_edit_amount_label')}
          value={amountDraft}
          onChangeText={setAmountDraft}
          keyboardType="decimal-pad"
          placeholder={t('order_placeholder_amount')}
          returnKeyType="done"
          onSubmitEditing={() =>
            saveInlineFinanceField({
              field: 'price',
              rawValue: amountDraft,
              onDone: () => setAmountEditModalVisible(false),
            })
          }
        />
        <View style={styles.financeEntryModalActions}>
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
      </BaseModal>

      <SelectModal
        visible={paymentStatusModalVisible}
        title={t('order_details_payment_status', 'Статус оплаты')}
        searchable={false}
        items={paymentStatusItems}
        selectedId={normalizedPaymentStatus}
        onSelect={async (item) => {
          const nextStatus = String(item?.id || 'unpaid');
          setPaymentStatusModalVisible(false);
          await saveOrderPaymentField({ payment_status: nextStatus });
        }}
        onClose={() => setPaymentStatusModalVisible(false)}
      />

      <SelectModal
        visible={paymentMethodModalVisible}
        title={t('order_details_payment_method', 'Способ оплаты')}
        searchable={false}
        items={paymentMethodItems}
        selectedId={normalizedPaymentMethod}
        onSelect={async (item) => {
          const nextMethod = String(item?.id || 'cash');
          setPaymentMethodModalVisible(false);
          await saveOrderPaymentField({ payment_method: nextMethod });
        }}
        onClose={() => setPaymentMethodModalVisible(false)}
      />

      <SelectModal
        visible={financeKindModalVisible}
        title={t('common_add', 'Добавить')}
        searchable={false}
        items={financeKindSelectItems}
        onSelect={(item) => {
          setFinanceKindModalVisible(false);
          openCreateFinanceEntry(item?.id || 'expense');
        }}
        onClose={() => setFinanceKindModalVisible(false)}
      />

      <SelectModal
        visible={financeCalcModeModalVisible}
        title={t('finance_rule_calc_mode', 'Формат расчёта')}
        searchable={false}
        items={financeCalcModeItems}
        selectedId={financeEntryDraft.calc_mode}
        onSelect={(item) => {
          setFinanceEntryDraft((prev) => ({ ...prev, calc_mode: String(item?.id || 'fixed') }));
          setFinanceCalcModeModalVisible(false);
        }}
        onClose={() => setFinanceCalcModeModalVisible(false)}
      />

      <SelectModal
        visible={financePercentBaseModalVisible}
        title={t('finance_rule_percent_base', 'Основа процента')}
        searchable={false}
        items={financePercentBaseItems}
        itemTitleNumberOfLines={2}
        multilineItems
        selectedId={normalizeFinancePercentBase(financeEntryDraft.kind, financeEntryDraft.percent_base)}
        onSelect={(item) => {
          setFinanceEntryDraft((prev) => ({
            ...prev,
            percent_base: normalizeFinancePercentBase(prev.kind, item?.id || 'base_price'),
          }));
          setFinancePercentBaseModalVisible(false);
        }}
        onClose={() => setFinancePercentBaseModalVisible(false)}
      />

      <SelectModal
        visible={financeExpensePayerModalVisible}
        title={t('finance_expense_payer', 'Кто оплатил')}
        searchable={false}
        items={financeExpensePayerItems}
        selectedId={financeEntryDraft.expense_payer}
        onSelect={(item) => {
          setFinanceEntryDraft((prev) => ({
            ...prev,
            expense_payer: String(item?.id || 'executor'),
          }));
          setFinanceExpensePayerModalVisible(false);
        }}
        onClose={() => setFinanceExpensePayerModalVisible(false)}
      />

      <BaseModal
        visible={financeEntryViewModalVisible}
        onClose={() => setFinanceEntryViewModalVisible(false)}
        title={String(selectedFinanceEntry?.title || '').trim() || t('order_finance_entry_modal_title', 'Финансовая статья')}
        maxHeightRatio={0.7}
      >
        <LabelValueRow
          label={t('finance_rule_kind', 'Тип')}
          value={financeKindLabel(selectedFinanceEntry?.kind)}
          middleSpacerStyle={styles.financeModalCompactSpacer}
          rightWrapStyle={styles.financeModalRightWrap}
        />
        <View style={base.sep} />
        {selectedFinanceEntry?.calc_mode === 'percent' ? (
          <LabelValueRow
            label={t('finance_rule_percent_value', 'Процент')}
            value={`${Number(selectedFinanceEntry?.input_percent || 0)}% (${financePercentBaseLabel(selectedFinanceEntry?.percent_base)})`}
            maxValueLines={2}
            middleSpacerStyle={styles.financeModalTightSpacer}
            rightWrapStyle={styles.financeModalPercentRightWrap}
          />
        ) : (
          <LabelValueRow
            label={t('order_field_initial_amount', 'Изначальная сумма')}
            value={formatMoney(selectedFinanceEntry?.calculated_amount, order?.currency || companySettings?.currency)}
            middleSpacerStyle={styles.financeModalCompactSpacer}
            rightWrapStyle={styles.financeModalRightWrap}
          />
        )}
        {selectedFinanceEntry?.kind === 'expense' ? (
          <>
            <View style={base.sep} />
            <LabelValueRow
              label={t('finance_expense_payer', 'Кто оплатил')}
              value={financeExpensePayerLabel(selectedFinanceEntry?.expense_payer)}
              middleSpacerStyle={styles.financeModalCompactSpacer}
              rightWrapStyle={styles.financeModalRightWrap}
            />
          </>
        ) : null}
        {financeEntryViewHasComment ? (
          <>
            <View style={base.sep} />
            <Pressable
              onPress={() => {
                if (!financeEntryViewCommentExpandable && !financeEntryViewCommentExpanded) return;
                setFinanceEntryViewCommentExpanded((prev) => !prev);
              }}
              style={({ pressed }) => [pressed && (financeEntryViewCommentExpandable || financeEntryViewCommentExpanded) ? { opacity: 0.7 } : null]}
            >
              <View
                onLayout={(event) => {
                  const width = Number(event?.nativeEvent?.layout?.width) || 0;
                  setFinanceEntryViewCommentMeasureWidth((prev) => (prev === width ? prev : width));
                }}
              >
                {financeEntryViewCommentExpanded ? (
                  <View style={styles.financeEntryCommentBlock}>
                    <View style={styles.financeEntryCommentHeader}>
                      <Text style={base.label}>{t('order_finance_note', 'Комментарий')}</Text>
                      {financeEntryViewCommentExpandable ? (
                        <Feather
                          name="chevron-up"
                          size={theme.icons?.sm ?? 18}
                          color={theme.colors.textSecondary}
                        />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        base.value,
                        styles.financeEntryCommentValue,
                        styles.financeEntryExpandedComment,
                        styles.financeEntryCommentPressable,
                      ]}
                    >
                      {financeEntryViewCommentText}
                    </Text>
                  </View>
                ) : (
                  <LabelValueRow
                    label={t('order_finance_note', 'Комментарий')}
                    middleSpacerStyle={styles.financeModalCompactSpacer}
                    rightWrapStyle={styles.financeCommentCollapsedRightWrap}
                    valueComponent={
                      <Text
                        style={[base.value, styles.financeCommentCollapsedValue, styles.financeEntryCommentPressable]}
                        numberOfLines={financeEntryViewCommentExpandable ? 1 : 2}
                        ellipsizeMode="tail"
                      >
                        {financeEntryViewCommentText}
                      </Text>
                    }
                    rightActions={
                      financeEntryViewCommentExpandable ? (
                        <Feather
                          name="chevron-down"
                          size={theme.icons?.sm ?? 18}
                          color={theme.colors.textSecondary}
                        />
                      ) : null
                    }
                    hideWhenEmpty={false}
                  />
                )}
              </View>
            </Pressable>
            {financeEntryViewCommentMeasureWidth > 0 ? (
              <View style={styles.financeEntryCommentMeasureWrap} pointerEvents="none">
                <View style={{ width: financeEntryViewCommentMeasureWidth }}>
                  <View style={styles.financeEntryCommentMeasureInner}>
                  <Text
                    style={[base.value, styles.financeEntryCommentMeasureText]}
                    onTextLayout={(event) => {
                      const lines = event?.nativeEvent?.lines;
                      const nextExpandable = Array.isArray(lines) && lines.length > 2;
                      setFinanceEntryViewCommentExpandable((prev) =>
                        prev === nextExpandable ? prev : nextExpandable
                      );
                    }}
                  >
                    {financeEntryViewCommentText}
                  </Text>
                  </View>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
        {financeEntryViewHasPhotos ? (
          <>
            <View style={base.sep} />
            <Pressable
              style={({ pressed }) => [base.row, pressed && { opacity: 0.7 }]}
              onPress={openFinanceEntryPhotosFromView}
            >
              <LabelValueRow
                label={t('order_details_photos_section', 'Фото')}
                value={formatFinancePhotoCount(financeEntryViewPhotoCount)}
                middleSpacerStyle={styles.financeModalCompactSpacer}
                rightWrapStyle={styles.financeModalRightWrap}
                hideWhenEmpty={false}
                rightActions={
                  <Feather
                    name="chevron-right"
                    size={theme.icons?.sm ?? 18}
                    color={theme.colors.textSecondary}
                  />
                }
              />
            </Pressable>
          </>
        ) : null}
        {canEditFinanceEntries && selectedFinanceEntry?.is_system !== true ? (
          <View style={styles.financeEntryModalActions}>
            <Button
              title={t('btn_edit')}
              variant="secondary"
              onPress={startEditFinanceEntryFromView}
            />
            <Button
              title={t('btn_delete')}
              variant="destructive"
              onPress={() => setFinanceEntryDeleteConfirmVisible(true)}
            />
          </View>
        ) : null}
      </BaseModal>

      <ConfirmModal
        visible={financeEntryDeleteConfirmVisible}
        title={financeDeleteTitle(selectedFinanceEntry?.kind)}
        message={t('order_finance_delete_message', 'Это значение будет удалено без возможности восстановления')}
        confirmLabel={t('btn_delete')}
        confirmVariant="destructive"
        loading={deleteFinanceEntryMutation.isPending}
        onClose={() => setFinanceEntryDeleteConfirmVisible(false)}
        onConfirm={confirmDeleteFinanceEntry}
      />

      <BaseModal
        visible={financeEntryModalVisible}
        onClose={() => {
          setFinanceEntrySubmitAttempt(false);
          setFinanceEntryFieldErrors({});
          setFinanceEntryModalVisible(false);
        }}
        onShow={() => {
          const targetRef =
            financeEntryDraft.calc_mode === 'percent'
              ? financePercentInputRef.current
              : financeAmountInputRef.current;
          setTimeout(() => {
            targetRef?.focus?.();
          }, 40);
        }}
        title={getFinanceEntryModalTitle(financeEntryDraft.kind, !!financeEntryDraft.id)}
        maxHeightRatio={0.82}
        footer={
          <View style={styles.financeEntryModalActions}>
            <Button
              title={t('btn_cancel')}
              onPress={() => {
                setFinanceEntrySubmitAttempt(false);
                setFinanceEntryFieldErrors({});
                setFinanceEntryModalVisible(false);
              }}
              variant="secondary"
            />
            <Button
              title={t('btn_save')}
              loading={upsertFinanceEntryMutation.isPending}
              onPress={saveFinanceEntry}
            />
          </View>
        }
      >
        <ScrollView
          style={styles.financeEntryModalScroll}
          contentContainerStyle={styles.financeEntryModalScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
        >
          <TextField
            label={`${t('finance_rule_name', 'Название')}${t('common_required_suffix', ' *')}`}
            value={financeEntryDraft.title}
            onChangeText={(value) => {
              clearFinanceEntryFieldError('title');
              setFinanceEntryDraft((prev) => ({ ...prev, title: value }));
            }}
            placeholder={t('finance_rule_name', 'Название')}
            multiline
            autoGrow
            minLines={2}
            filterInput={normalizeFinanceTextInput}
            maxLength={50}
            forceValidation={financeEntrySubmitAttempt}
            error={financeEntryFieldErrors?.title ? 'invalid' : undefined}
          />
          <FieldErrorText message={financeEntryFieldErrors?.title?.message} />
          <TextField
            label={t('finance_rule_calc_mode', 'Формат расчёта')}
            value={financeCalcModeLabel(financeEntryDraft.calc_mode)}
            pressable
            onPress={() => setFinanceCalcModeModalVisible(true)}
          />
          {financeEntryDraft.calc_mode === 'percent' ? (
            <>
              <TextField
                ref={financePercentInputRef}
                label={`${t('finance_rule_percent_value', 'Процент')}${t('common_required_suffix', ' *')}`}
                value={String(financeEntryDraft.input_percent || '')}
                onChangeText={(value) => {
                  clearFinanceEntryFieldError('input_percent');
                  setFinanceEntryDraft((prev) => ({ ...prev, input_percent: value }));
                }}
                keyboardType="decimal-pad"
                returnKeyType="next"
                onSubmitEditing={() => {
                  financeCommentInputRef.current?.focus?.();
                }}
                forceValidation={financeEntrySubmitAttempt}
                error={financeEntryFieldErrors?.input_percent ? 'invalid' : undefined}
              />
              <FieldErrorText message={financeEntryFieldErrors?.input_percent?.message} />
              <TextField
                label={t('finance_rule_percent_base', 'Основа процента')}
                value={financePercentBaseLabel(financeEntryDraft.percent_base)}
                multiline
                numberOfLines={2}
                pressable
                onPress={() => setFinancePercentBaseModalVisible(true)}
              />
            </>
          ) : (
            <>
              <TextField
                ref={financeAmountInputRef}
                label={`${t('order_field_initial_amount', 'Изначальная сумма')}${t('common_required_suffix', ' *')}`}
                value={String(financeEntryDraft.input_amount || '')}
                onChangeText={(value) => {
                  clearFinanceEntryFieldError('input_amount');
                  setFinanceEntryDraft((prev) => ({ ...prev, input_amount: value }));
                }}
                keyboardType="decimal-pad"
                returnKeyType="next"
                onSubmitEditing={() => {
                  financeCommentInputRef.current?.focus?.();
                }}
                forceValidation={financeEntrySubmitAttempt}
                error={financeEntryFieldErrors?.input_amount ? 'invalid' : undefined}
              />
              <FieldErrorText message={financeEntryFieldErrors?.input_amount?.message} />
            </>
          )}
          {financeEntryDraft.kind === 'expense' ? (
            <TextField
              label={t('finance_expense_payer', 'Кто оплатил')}
              value={financeExpensePayerLabel(financeEntryDraft.expense_payer)}
              pressable
              onPress={() => setFinanceExpensePayerModalVisible(true)}
            />
          ) : null}
          <TextField
            ref={financeCommentInputRef}
            label={t('finance_rule_note_template', 'Комментарий')}
            value={financeEntryDraft.note}
            multiline
            autoGrow
            minLines={2}
            filterInput={normalizeFinanceTextInput}
            onChangeText={(value) => setFinanceEntryDraft((prev) => ({ ...prev, note: value }))}
            maxLength={200}
            returnKeyType="done"
            rightSlot={
              financeEntryDraft.note ? (
                <ClearButton
                  accessibilityLabel={t('common_clear', 'Очистить')}
                  onPress={() => setFinanceEntryDraft((prev) => ({ ...prev, note: '' }))}
                  style={styles.financeCommentClearButton}
                />
              ) : null
            }
            onSubmitEditing={() => {
              Keyboard.dismiss();
            }}
          />
          <TextField
            label={t('order_details_photos_section', 'Фото')}
            value={formatFinancePhotoCount((financeEntryDraft.photo_urls || []).length)}
            pressable
            onPress={openFinanceEntryPhotosModal}
          />
        </ScrollView>
      </BaseModal>

      <OrderPhotosModal
        visible={financeEntryPhotosModalVisible}
        onClose={closeFinanceEntryPhotosModal}
        category="finance_entry_photo"
        photos={financeEntryDraft.photo_urls || []}
        pending={financeEntryLocalPending}
        getDisplayUrl={financeEntryMedia.getDisplayUrl}
        getIssue={financeEntryMedia.getIssue}
        onUploadUri={handleFinanceEntryPhotoUploadUri}
        onUploadMultiple={handleFinanceEntryPhotoUploadMultiple}
        onRemove={handleFinanceEntryPhotoRemove}
        onRemoveMany={handleFinanceEntryPhotoRemoveMany}
        onOpenViewer={openFinanceEntryViewer}
      />

      <FullscreenImageViewer
        visible={financeViewerVisible}
        images={financeViewerPhotos}
        initialIndex={financeViewerIndex}
        onClose={closeFinanceEntryViewer}
        onDelete={handleFinanceViewerDelete}
        onRotateSave={handleFinanceViewerRotateSave}
        categoryLabel={financeViewerCategoryLabel}
      />

      <AlertModal
        visible={warningVisible}
        title={t('order_modal_warning_title')}
        message={warningMessage}
        buttonLabel={t('btn_ok')}
        onClose={() => setWarningVisible(false)}
      />

      <ConfirmModal
        visible={deleteModalVisible}
        title={t('order_modal_delete_title')}
        message={t('order_modal_delete_msg')}
        confirmLabel={
          deleteEnabled
            ? t('order_modal_delete_confirm')
            : t('order_modal_delete_countdown').replace('{n}', deleteCountdown)
        }
        cancelLabel={t('order_modal_cancel_stay')}
        confirmVariant="destructive"
        onClose={() => setDeleteModalVisible(false)}
        onConfirm={deleteOrderCompletely}
      />
    </>
  );
}

export default function OrderDetails() {
  return (
    <DeferredScreen>
      <OrderDetailsContent />
    </DeferredScreen>
  );
}

function createStyles(theme) {
  const sp = theme.spacing || {};
  const rad = theme.radii || {};
  const typo = theme.typography || {};

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

    // Р—РђРњР•РќРђ РєРЅРѕРїРєРё РЅР° СЃСЃС‹Р»РєСѓ
    editLink: {
      paddingHorizontal: sp.md || 12,
      paddingVertical: sp.xs || 6,
    },
    editLinkText: {
      color: theme.colors.primary,
      fontWeight: typo.weight?.semibold || '600',
    },

    // headerCard Р±РѕР»СЊС€Рµ РЅРµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ, РјРѕР¶РЅРѕ РѕСЃС‚Р°РІРёС‚СЊ РёР»Рё СѓРґР°Р»РёС‚СЊ РїРѕ Р¶РµР»Р°РЅРёСЋ
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
    financeEntryModalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: sp.md || 12,
      marginTop: sp.md || 12,
      paddingTop: sp.xs || 6,
      paddingBottom: sp.sm || 10,
    },
    financeEntryModalScroll: {
      flexGrow: 0,
      minHeight: 0,
    },
    financeEntryModalScrollContent: {
      paddingBottom: sp.xl || 20,
    },
    financeSectionRowPressed: {
      opacity: 0.7,
    },
    financeSectionLabelExpanded: {
      fontWeight: typo.weight?.semibold || '600',
      color: theme.colors.text,
    },
    financeSectionRight: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexShrink: 1,
      minWidth: 0,
      paddingRight: sp.xs || 6,
    },
    financeSectionSummaryValue: {
      flexShrink: 1,
      minWidth: 0,
      fontWeight: typo.weight?.bold || '700',
    },
    financeSectionSummaryWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      minWidth: 0,
    },
    financeCompactRightWrap: {
      maxWidth: '44%',
    },
    financeEntryLabelWrap: {
      flexShrink: 1,
      flexGrow: 1,
      minWidth: 0,
      maxWidth: '100%',
      paddingRight: sp.sm || 8,
    },
    financeEntryRightWrap: {
      flexShrink: 0,
      maxWidth: '46%',
    },
    financeTightRightWrap: {
      maxWidth: '36%',
    },
    financeCompactSpacer: {
      flex: 0,
      minWidth: sp.sm || 8,
    },
    financeModalCompactSpacer: {
      flex: 0,
      minWidth: sp.xs || 6,
    },
    financeModalTightSpacer: {
      flex: 0,
      minWidth: 4,
    },
    financeModalRightWrap: {
      maxWidth: '42%',
    },
    financeModalWideRightWrap: {
      maxWidth: '52%',
    },
    financeModalPercentRightWrap: {
      maxWidth: '68%',
    },
    financeCommentCollapsedRightWrap: {
      maxWidth: '62%',
    },
    financeSectionSummaryIcon: {
      marginRight: sp.xs || 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    financeSectionSummaryIconButton: {
      marginRight: sp.xs || 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    financeStatusCircle: {
      width: 18,
      height: 18,
      borderRadius: 999,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    financeSectionChevronWrap: {
      marginLeft: sp.sm || 8,
    },
    financeSectionChevronWrapExpanded: {
      transform: [{ rotate: '180deg' }],
    },
    financeSectionExpanded: {
      paddingLeft: sp.md || 12,
      paddingRight: sp.xs || 6,
      paddingBottom: sp.xs || 6,
    },
    financeSectionLoader: {
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
    },
    financeEntryExpandedComment: {
      textAlign: 'left',
    },
    financeEntryCommentBlock: {
      paddingVertical: 2,
    },
    financeEntryCommentHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: sp.xs || 6,
      gap: sp.xs || 6,
    },
    financeCommentCollapsedValue: {
      textAlign: 'right',
    },
    financeEntryCommentValue: {
      textAlign: 'left',
      width: '100%',
    },
    financeEntryCommentPressable: {
      color: theme.colors.text,
    },
    financeEntryCommentMeasureWrap: {
      position: 'absolute',
      opacity: 0,
      left: -10000,
      top: -10000,
    },
    financeEntryCommentMeasureInner: {
      width: '62%',
      marginLeft: 'auto',
    },
    financeEntryCommentMeasureText: {
      textAlign: 'right',
    },
    financeSectionFooterAction: {
      color: theme.colors.primary,
    },
    financeCommentClearButton: {
      marginTop: sp.sm || 8,
    },
    assigneeOption: { paddingVertical: sp.md || 10 },
    assigneeText: { fontSize: typo.sizes?.md || 16, color: theme.colors.text },
    cloudWarningText: {
      color: theme.colors.warning || theme.colors.primary,
      fontSize: typo.sizes?.sm || 14,
      marginBottom: sp.sm || 8,
      marginTop: -(sp.xs || 4),
    },
  });
}
