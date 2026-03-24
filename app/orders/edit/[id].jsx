import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { fetchWorkTypes, getMyCompanyId } from '../../../lib/workTypes';
import {
  ensureRequestAssigneeNamePrefetch,
  useRequest,
  useRequestRealtimeSync,
  useUpdateRequestMutation,
} from '../../../src/features/requests/queries';
import { useClient, useClients, useUpdateClientMutation } from '../../../src/features/clients/queries';
import {
  buildAdditionalPhoneDisplayLabel,
  CLIENT_ADDITIONAL_PHONE_SLOT_IDS,
  collectClientPhoneSearchValues,
  getClientAdditionalPhones,
} from '../../../src/features/clients/additionalPhones';
import { useClientObjects } from '../../../src/features/objects/queries';
import {
  getObjectAdditionalPhones,
  OBJECT_ADDITIONAL_PHONE_SLOT_IDS,
} from '../../../src/features/objects/additionalPhones';
import {
  hasClientObjectMapPoint,
  normalizeClientObjectLocationMode,
  normalizeCoordinateValue,
} from '../../../src/features/objects/addressing';
import {
  ORDER_ADDRESS_MODE,
  buildOrderAddressDisplay,
  buildOrderAddressShort,
  extractOrderAddress,
  extractOrderAddressFromObject,
  filterOrderAddressByObjectFieldSettings,
  normalizeOrderAddressMode,
  toOrderAddressPatch,
} from '../../../src/features/requests/addressing';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getEntityFieldMap,
  getOrderedEntityFields,
} from '../../../src/features/fieldSettings/catalog';
import { useEntityFieldSettings } from '../../../src/features/fieldSettings/queries';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDepartments as useDepartmentsHook } from '../../../components/hooks/useDepartments';
import { useUsers } from '../../../components/hooks/useUsers';
import EditScreenTemplate, { useEditFormStyles } from '../../../components/layout/EditScreenTemplate';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import ClearButton from '../../../components/ui/ClearButton';
import { BaseModal, ConfirmModal, DateTimeModal, SelectModal } from '../../../components/ui/modals';
import QuickPreviewModal from '../../../components/ui/modals/QuickPreviewModal';
import PhoneInput from '../../../components/ui/PhoneInput';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField, { SwitchField } from '../../../components/ui/TextField';
import { useToast } from '../../../components/ui/ToastProvider';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';
import { usePermissions } from '../../../lib/permissions';
import { supabase } from '../../../lib/supabase';
import { t as T } from '../../../src/i18n';
import { formatRuMask } from '../../../components/ui/phone';
import { queryKeys } from '../../../src/shared/query/queryKeys';
import { FieldErrorText } from '../../../src/shared/feedback';
import { getRequiredFieldLabel } from '../../../src/shared/forms/fieldValidation';
import {
  isValidOptionalMobilePhone,
  toE164MobilePhoneOrNull,
} from '../../../src/shared/validation/phone';
import { parseClientPrefillFromSearch } from '../../../src/features/clients/prefillFromSearch';
import { buildSearchIndex, matchesSearch } from '../../../src/shared/search/matching';
import { useTheme } from '../../../theme/ThemeProvider';
import DeferredScreen from '../../../src/shared/perf/DeferredScreen';
import { openCoordinatesInYandex } from '../../../components/ui/map';
import { resolveRequestTitle } from '../../../src/features/requests/title';
import { buildAssigneeSelectItems } from '../../../src/features/requests/assigneeSelect';

const HEADER_HEIGHT_FALLBACK = 56;
const BOTTOM_SPACER_FALLBACK = 80;
const ORDER_STATUS_KEYS = ['in_feed', 'new', 'in_progress', 'completed'];
const WORK_TYPE_NONE_OPTION_ID = '__none__';
const ORDER_CLIENT_FLOW_STORAGE_PREFIX = 'order_client_flow:';
const ROUTE_PLACEHOLDER_RE = /^\[[^\]]+\]$/;
const PHONE_SOURCE_SEPARATOR = ':';
const PHONE_SOURCE_KIND = Object.freeze({
  MANUAL: 'manual',
  CLIENT_PRIMARY: 'client_primary',
  CLIENT_ADDITIONAL: 'client_additional',
  OBJECT_ADDITIONAL: 'object_additional',
});
const PHONE_SOURCE_IDS = Object.freeze({
  MANUAL: PHONE_SOURCE_KIND.MANUAL,
  CLIENT_PRIMARY: PHONE_SOURCE_KIND.CLIENT_PRIMARY,
});

function buildPhoneSourceId(kind, slotId = null) {
  const normalizedKind = String(kind || '').trim();
  if (!normalizedKind) return PHONE_SOURCE_IDS.MANUAL;
  if (slotId === null || slotId === undefined) return normalizedKind;
  const normalizedSlotId = Number(slotId);
  if (!Number.isFinite(normalizedSlotId)) return normalizedKind;
  return `${normalizedKind}${PHONE_SOURCE_SEPARATOR}${Math.trunc(normalizedSlotId)}`;
}

function parsePhoneSourceId(sourceId) {
  const raw = String(sourceId || '').trim();
  if (!raw) return { kind: PHONE_SOURCE_KIND.MANUAL, slotId: null };
  const [kindPart, slotPart] = raw.split(PHONE_SOURCE_SEPARATOR);
  const kind = String(kindPart || '').trim();
  if (!slotPart) return { kind, slotId: null };
  const slotId = Number(slotPart);
  if (!Number.isFinite(slotId)) return { kind, slotId: null };
  return { kind, slotId: Math.trunc(slotId) };
}

function normalizePhoneSourceId(sourceId) {
  const { kind, slotId } = parsePhoneSourceId(sourceId);
  if (kind === PHONE_SOURCE_KIND.CLIENT_PRIMARY) return PHONE_SOURCE_IDS.CLIENT_PRIMARY;
  if (kind === PHONE_SOURCE_KIND.CLIENT_ADDITIONAL) {
    if (CLIENT_ADDITIONAL_PHONE_SLOT_IDS.includes(slotId)) {
      return buildPhoneSourceId(PHONE_SOURCE_KIND.CLIENT_ADDITIONAL, slotId);
    }
    return PHONE_SOURCE_IDS.MANUAL;
  }
  if (kind === PHONE_SOURCE_KIND.OBJECT_ADDITIONAL) {
    if (OBJECT_ADDITIONAL_PHONE_SLOT_IDS.includes(slotId)) {
      return buildPhoneSourceId(PHONE_SOURCE_KIND.OBJECT_ADDITIONAL, slotId);
    }
    return PHONE_SOURCE_IDS.MANUAL;
  }
  return PHONE_SOURCE_IDS.MANUAL;
}

function normalizeOrderRouteId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (ROUTE_PLACEHOLDER_RE.test(normalized)) return null;
  return normalized;
}

function parseCoordinatesFromText(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const text = raw.replace(/,/g, '.');
  const matches = text.match(/-?\d+(?:\.\d+)?/g) || [];
  if (matches.length < 2) return null;
  const first = Number(matches[0]);
  const second = Number(matches[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  const inLatRange = (value) => value >= -90 && value <= 90;
  const inLngRange = (value) => value >= -180 && value <= 180;
  let lat = first;
  let lng = second;
  if (!inLatRange(lat) || !inLngRange(lng)) {
    lat = second;
    lng = first;
  }
  if (!inLatRange(lat) || !inLngRange(lng)) return null;
  return {
    lat: normalizeCoordinateValue(lat),
    lng: normalizeCoordinateValue(lng),
  };
}

function normalizeTimestampLike(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  normalized = normalized.replace(/([+-]\d{2})$/, '$1:00');
  return normalized;
}

function hasValidDateLike(input) {
  if (!input) return false;
  if (input instanceof Date) {
    return !Number.isNaN(input?.getTime?.());
  }

  const direct = new Date(input);
  if (!Number.isNaN(direct?.getTime?.())) return true;

  const normalizedRaw = normalizeTimestampLike(input);
  if (!normalizedRaw) return false;
  const normalized = new Date(normalizedRaw);
  return !Number.isNaN(normalized?.getTime?.());
}

function hasExplicitTimeLike(input) {
  if (!input) return false;
  const parse = (value) => {
    if (value instanceof Date) return value;
    const direct = new Date(value);
    if (!Number.isNaN(direct?.getTime?.())) return direct;
    const normalizedRaw = normalizeTimestampLike(value);
    if (!normalizedRaw) return null;
    const normalized = new Date(normalizedRaw);
    return Number.isNaN(normalized?.getTime?.()) ? null : normalized;
  };

  const parsed = parse(input);
  if (!parsed) return false;
  return parsed.getHours() !== 0 || parsed.getMinutes() !== 0;
}

function parseTimeStringToDate(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function formatTimeForStorage(input) {
  const date = input instanceof Date ? input : null;
  if (!date || Number.isNaN(date?.getTime?.())) return null;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}:00`;
}

function formatDateOnlyForStorage(input) {
  const date = input instanceof Date ? input : null;
  if (!date || Number.isNaN(date?.getTime?.())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function EditOrderContent() {
  const navigation = useNavigation();
  const router = useRouter();
  const {
    id: rawId,
    companyId: rawCompanyId,
    workTypeId: rawWorkTypeId,
    workTypeName: rawWorkTypeName,
  } = useLocalSearchParams();
  const id = useMemo(() => {
    const value = Array.isArray(rawId) ? rawId[0] : rawId;
    return normalizeOrderRouteId(value);
  }, [rawId]);
  const companyIdFromParams = useMemo(() => {
    const value = Array.isArray(rawCompanyId) ? rawCompanyId[0] : rawCompanyId;
    return value ? String(value) : null;
  }, [rawCompanyId]);
  const workTypeIdFromParams = useMemo(() => {
    const value = Array.isArray(rawWorkTypeId) ? rawWorkTypeId[0] : rawWorkTypeId;
    if (value === null || value === undefined || value === '') return null;
    return String(value);
  }, [rawWorkTypeId]);
  const workTypeNameFromParams = useMemo(() => {
    const value = Array.isArray(rawWorkTypeName) ? rawWorkTypeName[0] : rawWorkTypeName;
    return value ? String(value) : '';
  }, [rawWorkTypeName]);

  const updateRequestMutation = useUpdateRequestMutation();
  const queryClient = useQueryClient();
  const { data: orderFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER, {
    enabled: !!id,
  });
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: !!id,
  });

  const { theme } = useTheme();
  const { has: hasPermission, loading: permissionsLoading } = usePermissions();
  const canViewOrderAmount = hasPermission('canViewOrderAmount');
  const canEditOrderAmount = canViewOrderAmount && hasPermission('canEditOrderAmount');
  const formStyles = useEditFormStyles();
  const { settings: companySettings } = useCompanySettings();
  const {
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    info: toastInfo,
  } = useToast();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [companyId, setCompanyId] = useState(companyIdFromParams);
  const { departments } = useDepartmentsHook({
    companyId,
    enabled: !!companyId,
    onlyEnabled: true,
  });
  useRequestRealtimeSync({ enabled: !!id && !!companyId, companyId });
  const [assigneeModalVisible, setAssigneeModalVisible] = useState(false);
  const { users: employees } = useUsers({
    filters: {},
    enabled: assigneeModalVisible,
  });
  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  const [workTypeId, setWorkTypeId] = useState(null);
  const [workTypeResolved, setWorkTypeResolved] = useState(false);
  const [workTypeNameFallback, setWorkTypeNameFallback] = useState('');
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [office, setOffice] = useState('');
  const [floor, setFloor] = useState('');
  const [entrance, setEntrance] = useState('');
  const [apartment, setApartment] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [addressMode, setAddressMode] = useState(ORDER_ADDRESS_MODE.OBJECT);
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [addressModalDraft, setAddressModalDraft] = useState(() => extractOrderAddress({}));
  const [addressModalLocationMode, setAddressModalLocationMode] = useState('address');
  const [addressModalClipboardHasCoordinates, setAddressModalClipboardHasCoordinates] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneSourceModalVisible, setPhoneSourceModalVisible] = useState(false);
  const [phoneSourceId, setPhoneSourceId] = useState(PHONE_SOURCE_IDS.MANUAL);
  const [entranceInfo, setEntranceInfo] = useState('');
  const [departureDate, setDepartureDate] = useState(null);
  const [departureTime, setDepartureTime] = useState(null);
  const [departureEndDate, setDepartureEndDate] = useState(null);
  const [isDepartureRange, setIsDepartureRange] = useState(false);
  const [assigneeId, setAssigneeId] = useState(null);
  const [toFeed, setToFeed] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [statusKey, setStatusKey] = useState(null);
  const [statusLabel, setStatusLabel] = useState('');
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [clientModalVisible, setClientModalVisible] = useState(false);
  const [clientModalSearch, setClientModalSearch] = useState('');
  const [previewClient, setPreviewClient] = useState(null);
  const [previewClientVisible, setPreviewClientVisible] = useState(false);
  const [previewObject, setPreviewObject] = useState(null);
  const [previewObjectVisible, setPreviewObjectVisible] = useState(false);
  const [previewAnchor, setPreviewAnchor] = useState({ x: 0, y: 0 });
  const [objectModalVisible, setObjectModalVisible] = useState(false);
  const [parkingNotes, setParkingNotes] = useState('');
  const [geoLat, setGeoLat] = useState('');
  const [geoLng, setGeoLng] = useState('');
  const [customAddressLocationMode, setCustomAddressLocationMode] = useState('address');
  const [assignedEmployeeLabel, setAssignedEmployeeLabel] = useState('');
  const [formHydrated, setFormHydrated] = useState(false);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelKey, setCancelKey] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  const [touched, setTouched] = useState({});
  const titlePrefix = useMemo(() => T('order_auto_title_prefix', 'Заявка от'), []);
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const insets = useSafeAreaInsets();
  const titleRef = useRef(null);
  const descriptionRef = useRef(null);
  const regionRef = useRef(null);
  const districtRef = useRef(null);
  const cityRef = useRef(null);
  const streetRef = useRef(null);
  const houseRef = useRef(null);
  const postalCodeRef = useRef(null);
  const countryRef = useRef(null);
  const officeRef = useRef(null);
  const floorRef = useRef(null);
  const entranceRef = useRef(null);
  const apartmentRef = useRef(null);
  const customerNameRef = useRef(null);
  const entranceInfoRef = useRef(null);
  const parkingNotesRef = useRef(null);
  const geoLatRef = useRef(null);
  const geoLngRef = useRef(null);
  const [price, setPrice] = useState('');
  const { data: clients = [] } = useClients(
    { companyId, search: '' },
    { enabled: !!companyId },
  );
  const { data: selectedClient } = useClient(selectedClientId, {
    enabled: !!selectedClientId,
  });
  const updateClientMutation = useUpdateClientMutation();
  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [stickyPlanningFieldMap, setStickyPlanningFieldMap] = useState({});
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
  const hasPersistedOrderFieldValue = useCallback(
    (fieldKey) => {
      const key = String(fieldKey || '');
      if (!key) return false;
      const value = orderData?.[key];
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value === 'boolean') return value === true;
      if (value !== null && value !== undefined && String(value).trim().length > 0) return true;

      if (key === 'work_type_id') {
        return (
          String(orderData?.work_type_name || '').trim().length > 0 ||
          String(orderData?.work_type?.name || '').trim().length > 0
        );
      }
      if (key === 'object_id') {
        if (String(orderData?.object_id || '').trim().length > 0) return true;
        if (String(orderData?.address_mode || '').trim().toLowerCase() === 'custom') return true;
        const addressFieldKeys = [
          'country',
          'region',
          'district',
          'city',
          'street',
          'house',
          'postal_code',
          'floor',
          'entrance',
          'apartment',
          'comment',
          'entrance_info',
          'geo_lat',
          'geo_lng',
        ];
        return addressFieldKeys.some(
          (addressKey) => String(orderData?.[addressKey] || '').trim().length > 0,
        );
      }
      if (key === 'time_window_start') {
        return (
          hasValidDateLike(orderData?.time_window_start) ||
          hasValidDateLike(orderData?.time_window_end) ||
          hasValidDateLike(departureDate) ||
          hasValidDateLike(departureEndDate)
        );
      }
      if (key === 'departure_time') {
        return (
          String(orderData?.departure_time || '').trim().length > 0 ||
          hasExplicitTimeLike(orderData?.time_window_start) ||
          hasExplicitTimeLike(orderData?.departure_time) ||
          hasExplicitTimeLike(departureTime)
        );
      }
      if (key === 'price') return orderData?.price !== null && orderData?.price !== undefined;
      return false;
    },
    [departureDate, departureEndDate, departureTime, orderData],
  );
  const getVisibleObjectAddressDraft = useCallback(
    (source) =>
      filterOrderAddressByObjectFieldSettings(
        extractOrderAddressFromObject(source),
        objectFieldsByKey,
      ),
    [objectFieldsByKey],
  );
  const orderedGeneralFieldKeys = useMemo(
    () =>
      getOrderedEntityFields(orderFieldSettings, {
        visibleOnly: false,
        requiredFirst: true,
        fieldKeys: ['title', 'comment', 'work_type_id'],
      })
        .map((field) => field.fieldKey)
        .filter(
          (fieldKey) =>
            orderFieldsByKey.get(fieldKey)?.isEnabled !== false || hasPersistedOrderFieldValue(fieldKey),
        ),
    [hasPersistedOrderFieldValue, orderFieldSettings, orderFieldsByKey],
  );
  const orderedCustomerFieldKeys = useMemo(
    () =>
      getOrderedEntityFields(orderFieldSettings, {
        visibleOnly: false,
        requiredFirst: true,
        fieldKeys: ['client_id', 'object_id', 'phone'],
      })
        .map((field) => field.fieldKey)
        .filter(
          (fieldKey) =>
            orderFieldsByKey.get(fieldKey)?.isEnabled !== false || hasPersistedOrderFieldValue(fieldKey),
        ),
    [hasPersistedOrderFieldValue, orderFieldSettings, orderFieldsByKey],
  );
  const dynamicPlanningFieldKeys = useMemo(
    () =>
      ['urgent', 'time_window_start', 'departure_time', 'assigned_to'].filter((fieldKey) => {
        const field = orderFieldsByKey.get(fieldKey);
        if (!field) return hasPersistedOrderFieldValue(fieldKey);
        return field.isEnabled !== false || hasPersistedOrderFieldValue(fieldKey);
      }),
    [hasPersistedOrderFieldValue, orderFieldsByKey],
  );
  useEffect(() => {
    setStickyPlanningFieldMap({});
  }, [id]);
  useEffect(() => {
    if (!formHydrated) return;
    setStickyPlanningFieldMap((prev) => {
      const next = { ...prev };
      let changed = false;
      dynamicPlanningFieldKeys.forEach((fieldKey) => {
        if (next[fieldKey]) return;
        next[fieldKey] = true;
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [dynamicPlanningFieldKeys, formHydrated]);
  const orderedPlanningFieldKeys = useMemo(() => {
    const priority = ['urgent', 'time_window_start', 'departure_time', 'assigned_to'];
    const visible = new Set(dynamicPlanningFieldKeys);
    Object.keys(stickyPlanningFieldMap || {}).forEach((fieldKey) => {
      if (stickyPlanningFieldMap?.[fieldKey]) visible.add(fieldKey);
    });
    return priority.filter((fieldKey) => visible.has(fieldKey));
  }, [dynamicPlanningFieldKeys, stickyPlanningFieldMap]);
  const hydratedOrderIdRef = useRef(null);
  const snapshotRef = useRef(null);
  const userEditedRef = useRef(false);
  const allowLeaveRef = useRef(false);
  const clientFlowKeyRef = useRef(
    `edit-order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const assignedLabelRequestIdRef = useRef(0);
  const normalizeId = useCallback((value) => {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
  }, []);
  const withRequiredLabel = useCallback(
    (label, required) => getRequiredFieldLabel(label, required),
    [],
  );
  const isFieldRequired = useCallback(
    (fieldKey) => {
      const field = orderFieldsByKey.get(fieldKey);
      if (!field || field.isEnabled === false) return false;
      return field.isRequired === true;
    },
    [orderFieldsByKey],
  );
  const clearFieldError = useCallback((fieldKey) => {
    setFieldErrors((prev) => {
      if (!prev?.[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }, []);
  const shouldShowError = useCallback(
    (fieldKey) => submittedAttempt || !!touched[fieldKey],
    [submittedAttempt, touched],
  );
  const getFieldError = useCallback(
    (fieldKey) => (shouldShowError(fieldKey) ? fieldErrors?.[fieldKey]?.message || null : null),
    [fieldErrors, shouldShowError],
  );
  const selectedEmployeeName = useMemo(() => {
    if (selectedEmployee) return selectedEmployee.display_name || selectedEmployee.email || '';
    return assignedEmployeeLabel || T('common_noName');
  }, [selectedEmployee, assignedEmployeeLabel]);
  const selectedClientName = useMemo(() => {
    if (!selectedClientId) return '';
    const client = clients.find((item) => String(item.id) === String(selectedClientId));
    return client?.fullName || selectedClient?.fullName || selectedClient?.full_name || customerName || '';
  }, [clients, customerName, selectedClient, selectedClientId]);
  const { data: clientObjectsByApi = [] } = useClientObjects(selectedClientId, { enabled: !!selectedClientId });

  const clientObjects = useMemo(() => {
    if (Array.isArray(selectedClient?.objects) && selectedClient.objects.length) return selectedClient.objects;
    if (Array.isArray(clientObjectsByApi) && clientObjectsByApi.length) return clientObjectsByApi;
    return [];
  }, [selectedClient, clientObjectsByApi]);
  const selectedObject = useMemo(
    () => clientObjects.find((item) => String(item.id) === String(selectedObjectId)) || null,
    [clientObjects, selectedObjectId],
  );
  const selectedClientAdditionalPhones = useMemo(
    () => getClientAdditionalPhones(selectedClient),
    [selectedClient],
  );
  const selectedObjectAdditionalPhones = useMemo(
    () => getObjectAdditionalPhones(selectedObject),
    [selectedObject],
  );
  const resolvePhoneBySourceId = useCallback(
    (sourceId) => {
      const normalizedSourceId = normalizePhoneSourceId(sourceId);
      const { kind, slotId } = parsePhoneSourceId(normalizedSourceId);
      if (kind === PHONE_SOURCE_KIND.CLIENT_PRIMARY) {
        return String(selectedClient?.phone || '').trim();
      }
      if (kind === PHONE_SOURCE_KIND.CLIENT_ADDITIONAL) {
        if (!CLIENT_ADDITIONAL_PHONE_SLOT_IDS.includes(slotId)) return '';
        return String(selectedClientAdditionalPhones?.[slotId - 1]?.phone || '').trim();
      }
      if (kind === PHONE_SOURCE_KIND.OBJECT_ADDITIONAL) {
        if (!OBJECT_ADDITIONAL_PHONE_SLOT_IDS.includes(slotId)) return '';
        return String(selectedObjectAdditionalPhones?.[slotId - 1]?.phone || '').trim();
      }
      return '';
    },
    [selectedClient, selectedClientAdditionalPhones, selectedObjectAdditionalPhones],
  );
  const phoneSourceItems = useMemo(() => {
    const items = [
      {
        id: PHONE_SOURCE_IDS.MANUAL,
        label: T('create_order_phone_source_manual'),
      },
    ];

    if (selectedClientId) {
      const clientPrimaryPhone = String(selectedClient?.phone || '').trim();
      items.push({
        id: PHONE_SOURCE_IDS.CLIENT_PRIMARY,
        label: T('create_order_phone_source_client_primary'),
        subtitle: clientPrimaryPhone ? formatRuMask(clientPrimaryPhone) : undefined,
        disabled: !clientPrimaryPhone,
      });

      CLIENT_ADDITIONAL_PHONE_SLOT_IDS.forEach((slotId) => {
        const entry = selectedClientAdditionalPhones?.[slotId - 1] || {};
        const sourcePhone = String(entry?.phone || '').trim();
        if (!sourcePhone) return;
        const displayLabel = buildAdditionalPhoneDisplayLabel(T, entry?.label);
        items.push({
          id: buildPhoneSourceId(PHONE_SOURCE_KIND.CLIENT_ADDITIONAL, slotId),
          label: T('create_order_phone_source_client_additional').replace('{label}', displayLabel),
          subtitle: formatRuMask(sourcePhone),
        });
      });
    }

    OBJECT_ADDITIONAL_PHONE_SLOT_IDS.forEach((slotId) => {
      const entry = selectedObjectAdditionalPhones?.[slotId - 1] || {};
      const sourcePhone = String(entry?.phone || '').trim();
      if (!sourcePhone) return;
      const displayLabel = buildAdditionalPhoneDisplayLabel(T, entry?.label);
      items.push({
        id: buildPhoneSourceId(PHONE_SOURCE_KIND.OBJECT_ADDITIONAL, slotId),
        label: T('create_order_phone_source_object_additional').replace('{label}', displayLabel),
        subtitle: formatRuMask(sourcePhone),
      });
    });

    return items;
  }, [selectedClient, selectedClientAdditionalPhones, selectedClientId, selectedObjectAdditionalPhones]);
  const selectedPhoneSourceLabel = useMemo(() => {
    const selectedItem = phoneSourceItems.find((item) => item.id === phoneSourceId);
    return selectedItem?.label || T('create_order_phone_source_manual');
  }, [phoneSourceId, phoneSourceItems]);
  const selectedObjectSummary = useMemo(() => {
    const liveSummary = [selectedObject?.name, buildOrderAddressShort(getVisibleObjectAddressDraft(selectedObject))]
      .filter(Boolean)
      .join(' - ');
    if (liveSummary) return liveSummary;
    return String(orderData?.object_name_snapshot || orderData?.object_name || '').trim();
  }, [getVisibleObjectAddressDraft, orderData?.object_name, orderData?.object_name_snapshot, selectedObject]);

  const selectedWorkTypeName = useMemo(() => {
    const normalizedSelected = normalizeId(workTypeId);
    if (!normalizedSelected) return workTypeNameFallback || '';
    const match = workTypes.find((w) => normalizeId(w?.id) === normalizedSelected);
    return match?.name ?? (workTypeNameFallback || '');
  }, [normalizeId, workTypeId, workTypeNameFallback, workTypes]);

  const selectedStatusLabel = useMemo(() => {
    return statusLabel || '';
  }, [statusLabel]);

  const statusItems = useMemo(() => {
    return ORDER_STATUS_KEYS.map((k) => ({ id: k, label: T(`order_status_${k}`) }));
  }, []);
  const workTypeItems = useMemo(
    () => [
      {
        id: WORK_TYPE_NONE_OPTION_ID,
        label: T('order_details_work_type_not_selected'),
      },
      ...(workTypes || [])
        .filter((wt) => wt?.is_enabled !== false)
        .map((wt) => ({
        id: normalizeId(wt?.id),
        label: String(wt?.name || ''),
        })),
    ],
    [normalizeId, workTypes],
  );
  const clientItems = useMemo(() => {
    if (!Array.isArray(clients) || clients.length === 0) {
      return [{ id: 'empty', label: T('empty_noData'), disabled: true }];
    }
    return clients.map((client) => ({
      id: client.id,
      label: client.fullName || T('common_noName'),
      subtitle: collectClientPhoneSearchValues(client).find(Boolean) || undefined,
      clientRaw: client,
      searchIndex: buildSearchIndex({
        texts: [
          client.fullName,
          client.firstName,
          client.lastName,
          client.middleName,
          client.email,
        ],
        phones: collectClientPhoneSearchValues(client),
      }),
      onPress: () => {
        setSelectedClientId(client.id);
        setSelectedObjectId(null);
        setAddressMode(ORDER_ADDRESS_MODE.OBJECT);
        const clientPrimaryPhone = String(client.phone || '').trim();
        setPhone(clientPrimaryPhone);
        setPhoneSourceId(clientPrimaryPhone ? PHONE_SOURCE_IDS.CLIENT_PRIMARY : PHONE_SOURCE_IDS.MANUAL);
        setClientModalVisible(false);
      },
    }));
  }, [clients]);

  const openClientPreview = useCallback((item, event) => {
    const client = item?.clientRaw || null;
    if (!client?.id) return;
    const pageX = Number(event?.nativeEvent?.pageX);
    const pageY = Number(event?.nativeEvent?.pageY);
    if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
      setPreviewAnchor({ x: pageX, y: pageY });
    }
    setPreviewClient(client);
    setPreviewClientVisible(true);
  }, []);

  const previewClientRows = useMemo(() => {
    const phoneValue = previewClient?.phone ? formatRuMask(previewClient.phone) : '';
    const objectNames = Array.isArray(previewClient?.objects)
      ? previewClient.objects
          .map((objectItem) => String(objectItem?.name || '').trim())
          .filter(Boolean)
      : [];
    return [
      { key: 'phone', label: T('view_label_phone'), value: phoneValue },
      { key: 'objects', label: T('clients_objects_section'), value: objectNames.join(', ') },
    ];
  }, [previewClient]);

  const previewClientTags = useMemo(
    () =>
      Array.isArray(previewClient?.tags)
      ? previewClient.tags.map((tag) => String(tag?.value || '').trim()).filter(Boolean)
      : [],
    [previewClient?.tags],
  );
  const previewObjectRows = useMemo(() => {
    if (!previewObject) return [];
    const previewVisibleAddress = getVisibleObjectAddressDraft(previewObject);
    const fullAddress = buildOrderAddressDisplay(previewVisibleAddress);
    return [
      {
        key: 'client',
        label: T('routes_clients_client'),
        value: String(previewObject.clientName || '').trim(),
      },
      {
        key: 'address',
        label: T('order_details_address'),
        value: fullAddress || T('order_details_address_not_specified'),
      },
      {
        key: 'comment',
        label: T('order_field_comment'),
        value: String(previewVisibleAddress.comment || previewVisibleAddress.entrance_info || '').trim(),
      },
    ].filter((row) => String(row?.value || '').trim());
  }, [getVisibleObjectAddressDraft, previewObject]);

  const openPreviewClientCard = useCallback(() => {
    if (!hasPermission('canViewClients')) return;
    const clientId = String(previewClient?.id || '').trim();
    if (!clientId) return;
    setPreviewClientVisible(false);
    setClientModalVisible(false);
    router.push({
      pathname: `/clients/${clientId}`,
      params: {
        returnTo: `/orders/edit/${String(id || '')}`,
      },
    });
  }, [hasPermission, id, previewClient?.id, router]);

  const openPreviewObjectCard = useCallback(() => {
    if (!hasPermission('canViewObjects')) return;
    const objectId = String(previewObject?.id || '').trim();
    if (!objectId) return;
    setPreviewObjectVisible(false);
    setObjectModalVisible(false);
    router.push({
      pathname: `/objects/${objectId}`,
      params: {
        returnTo: `/orders/edit/${String(id || '')}`,
      },
    });
  }, [hasPermission, id, previewObject?.id, router]);

  const openObjectPreview = useCallback((item, event) => {
    if (!hasPermission('canViewObjects')) return;
    const objectItem = item?.objectRaw || null;
    if (!objectItem?.id) return;
    const pageX = Number(event?.nativeEvent?.pageX);
    const pageY = Number(event?.nativeEvent?.pageY);
    if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
      setPreviewAnchor({ x: pageX, y: pageY });
    }
    setPreviewObject({
      ...objectItem,
      clientName: selectedClientName || '',
    });
    setPreviewObjectVisible(true);
  }, [hasPermission, selectedClientName]);

  const objectItems = useMemo(() => {
    if (!clientObjects.length) {
      return [{ id: 'empty', label: T('objects_empty'), disabled: true }];
    }
    return clientObjects.map((objectItem) => ({
      id: objectItem.id,
      label: objectItem.is_primary
        ? [objectItem.name, T('objects_primary')].filter(Boolean).join(' - ')
        : objectItem.name,
      subtitle: buildOrderAddressShort(getVisibleObjectAddressDraft(objectItem)) || undefined,
      objectRaw: objectItem,
      onPress: () => {
        setSelectedObjectId(objectItem.id);
        setAddressMode(ORDER_ADDRESS_MODE.OBJECT);
        const objectAddress = extractOrderAddressFromObject(objectItem);
        setCountry(objectAddress.country);
        setRegion(objectAddress.region);
        setDistrict(objectAddress.district);
        setCity(objectAddress.city);
        setStreet(objectAddress.street);
        setHouse(objectAddress.house);
        setPostalCode(objectAddress.postal_code);
        setOffice(objectAddress.apartment || objectAddress.office || '');
        setFloor(objectAddress.floor);
        setEntrance(objectAddress.entrance);
        setApartment(objectAddress.apartment);
        setEntranceInfo(objectAddress.comment || objectAddress.entrance_info || '');
        setParkingNotes('');
        setGeoLat(objectAddress.geo_lat);
        setGeoLng(objectAddress.geo_lng);
        setCustomAddressLocationMode(
          normalizeClientObjectLocationMode(objectAddress.location_mode, {
            fallback: hasClientObjectMapPoint(objectAddress) ? 'map' : 'address',
          }),
        );
        setObjectModalVisible(false);
      },
    }));
  }, [clientObjects, getVisibleObjectAddressDraft]);

  const openCreateClientFromModal = useCallback(() => {
    const prefill = parseClientPrefillFromSearch(clientModalSearch);
    setClientModalVisible(false);
    router.push({
      pathname: '/clients/new',
      params: {
        flow_key: clientFlowKeyRef.current,
        flow_return_to: `/orders/edit/${String(id || '')}`,
        ...(prefill.firstName ? { prefill_first_name: prefill.firstName } : {}),
        ...(prefill.lastName ? { prefill_last_name: prefill.lastName } : {}),
        ...(prefill.middleName ? { prefill_middle_name: prefill.middleName } : {}),
        ...(prefill.phoneRaw ? { prefill_phone: prefill.phoneRaw } : {}),
      },
    });
  }, [clientModalSearch, id, router]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const consumeCreatedClient = async () => {
        const key = `${ORDER_CLIENT_FLOW_STORAGE_PREFIX}${clientFlowKeyRef.current}`;
        try {
          const raw = await AsyncStorage.getItem(key);
          if (!raw || cancelled) return;
          await AsyncStorage.removeItem(key);
          const parsed = JSON.parse(raw);
          const resolvedClientId = String(
            parsed?.selectedClientId || parsed?.createdClientId || '',
          ).trim();
          if (!resolvedClientId) return;
          setSelectedClientId(resolvedClientId);
          setSelectedObjectId(null);
          setClientModalVisible(false);
          setClientModalSearch('');
        } catch {}
      };
      void consumeCreatedClient();
      return () => {
        cancelled = true;
      };
    }, []),
  );
  useEffect(() => {
    if (selectedClientId) return;
    setAddressMode(ORDER_ADDRESS_MODE.OBJECT);
    setSelectedObjectId(null);
    setAddressModalVisible(false);
  }, [selectedClientId]);

  useEffect(() => {
    if (phoneSourceId === PHONE_SOURCE_IDS.MANUAL) return;
    const sourceIsAvailable = phoneSourceItems.some(
      (item) => item.id === phoneSourceId && !item.disabled,
    );
    if (sourceIsAvailable) return;
    setPhoneSourceId(PHONE_SOURCE_IDS.MANUAL);
  }, [phoneSourceId, phoneSourceItems]);

  useEffect(() => {
    if (phoneSourceId === PHONE_SOURCE_IDS.MANUAL) return;
    const selectedSource = phoneSourceItems.find(
      (item) => item.id === phoneSourceId && !item.disabled,
    );
    if (!selectedSource) return;
    const nextPhone = resolvePhoneBySourceId(phoneSourceId);
    const currentPhone = String(phone || '').trim();
    const resolvedPhone = String(nextPhone || '').trim();
    if (currentPhone === resolvedPhone) return;
    setPhone(resolvedPhone);
    clearFieldError('phone');
  }, [clearFieldError, phone, phoneSourceId, phoneSourceItems, resolvePhoneBySourceId]);

  const selectedEmployee = useMemo(() => {
    if (!assigneeId || !employees?.length) return null;
    return employees.find((user) => String(user.id) === String(assigneeId));
  }, [assigneeId, employees]);

  const refreshAssignedLabel = useCallback(async (userId) => {
    const requestId = ++assignedLabelRequestIdRef.current;
    if (!userId) {
      setAssignedEmployeeLabel('');
      return;
    }
    try {
      const data = await ensureRequestAssigneeNamePrefetch(queryClient, userId);
      if (assignedLabelRequestIdRef.current !== requestId) return;
      setAssignedEmployeeLabel(String(data || ''));
    } catch (e) {
      if (assignedLabelRequestIdRef.current !== requestId) return;
      if (__DEV__) {
        console.warn('assigned name fetch', e?.message || e);
      }
      setAssignedEmployeeLabel('');
    }
  }, [queryClient]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cid = companyIdFromParams || (await getMyCompanyId());
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
        if (__DEV__) {
          console.warn('workTypes bootstrap', e?.message || e);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyIdFromParams]);

  useEffect(() => {
    setFormHydrated(false);
  }, [id]);

  const {
    data: orderData,
    isLoading: orderLoading,
    error: orderError,
    refetch: refetchOrder,
  } = useRequest(id);

  const parseDecimalOrNull = useCallback((input) => {
    const raw = String(input ?? '').trim();
    if (!raw) return null;
    const normalized = raw.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);

  const normalizeDateOrNull = useCallback((input) => {
    if (!input) return null;
    if (input instanceof Date) {
      return Number.isNaN(input?.getTime?.()) ? null : input;
    }

    const direct = new Date(input);
    if (!Number.isNaN(direct?.getTime?.())) return direct;

    const normalizedRaw = normalizeTimestampLike(input);
    if (!normalizedRaw) return null;
    const normalized = new Date(normalizedRaw);
    return Number.isNaN(normalized?.getTime?.()) ? null : normalized;
  }, []);
  const hasDepartureTimeValue = useCallback(
    (input) => {
      const value = input instanceof Date ? input : parseTimeStringToDate(input);
      if (!value) return false;
      return !Number.isNaN(value?.getTime?.());
    },
    [],
  );
  const displayDepartureDate = useMemo(
    () => normalizeDateOrNull(departureDate),
    [departureDate, normalizeDateOrNull],
  );
  const displayDepartureEndDate = useMemo(
    () => normalizeDateOrNull(departureEndDate),
    [departureEndDate, normalizeDateOrNull],
  );
  const displayDepartureTime = useMemo(
    () => (departureTime instanceof Date && !Number.isNaN(departureTime?.getTime?.()) ? departureTime : null),
    [departureTime],
  );
  const resolveTitleForSave = useCallback(
    (value, fallbackDate = null) =>
      resolveRequestTitle(value, {
        fallbackDate,
        prefix: titlePrefix,
      }),
    [titlePrefix],
  );

  const buildSnapshot = useCallback(
    (draft) =>
      JSON.stringify({
        title: String(draft.title || '').trim(),
        description: String(draft.description || '').trim(),
        region: String(draft.region || '').trim(),
        district: String(draft.district || '').trim(),
        city: String(draft.city || '').trim(),
        street: String(draft.street || '').trim(),
        house: String(draft.house || '').trim(),
        country: String(draft.country || '').trim(),
        postalCode: String(draft.postalCode || '').trim(),
        office: String(draft.office || '').trim(),
        floor: String(draft.floor || '').trim(),
        entrance: String(draft.entrance || '').trim(),
        apartment: String(draft.apartment || '').trim(),
        customerName: String(draft.customerName || '').trim(),
        selectedClientId: draft.selectedClientId || null,
        selectedObjectId: draft.selectedObjectId || null,
        addressMode: normalizeOrderAddressMode(draft.addressMode),
        phoneSourceId: normalizePhoneSourceId(draft.phoneSourceId),
        phone: String(draft.phone || '').replace(/\D/g, ''),
        entranceInfo: String(draft.entranceInfo || '').trim(),
        parkingNotes: String(draft.parkingNotes || '').trim(),
        geoLat: String(draft.geoLat || '').trim(),
        geoLng: String(draft.geoLng || '').trim(),
        customAddressLocationMode: normalizeClientObjectLocationMode(draft.customAddressLocationMode, {
          fallback:
            normalizeCoordinateValue(draft.geoLat) && normalizeCoordinateValue(draft.geoLng)
              ? 'map'
              : 'address',
        }),
        departureDateIso: formatDateOnlyForStorage(normalizeDateOrNull(draft.departureDate)) || null,
        departureEndDateIso: formatDateOnlyForStorage(normalizeDateOrNull(draft.departureEndDate)) || null,
        departureTime: formatTimeForStorage(draft.departureTime) || null,
        isDepartureRange: !!draft.isDepartureRange,
        assigneeId: draft.assigneeId || null,
        toFeed: !!draft.toFeed,
        urgent: !!draft.urgent,
        price: String(draft.price ?? '').trim(),
        workTypeId: draft.workTypeId || null,
        status: draft.status || null,
      }),
    [normalizeDateOrNull],
  );

  useEffect(() => {
    if (!id || !orderData) return;
    const isNewOrderScreenOpen = hydratedOrderIdRef.current !== id;
    if (!isNewOrderScreenOpen && userEditedRef.current) return;
    let cancelled = false;

    (async () => {
      const row = orderData;
      const nextTitle = resolveRequestTitle(row, { prefix: titlePrefix });
      const nextDescription = row.comment || '';
      const nextRegion = row.region || '';
      const nextDistrict = row.district || '';
      const nextCity = row.city || '';
      const nextStreet = row.street || '';
      const nextHouse = row.house || '';
      const nextCountry = row.country ?? country ?? '';
      const nextPostalCode = row.postal_code ?? postalCode ?? '';
      const nextOffice = row.apartment ?? row.office ?? office ?? '';
      const nextFloor = row.floor ?? floor ?? '';
      const nextEntrance = row.entrance ?? entrance ?? '';
      const nextApartment = row.apartment ?? apartment ?? '';
      const nextCustomerName =
        row.fio ||
        row.customer_name ||
        [row.client?.first_name, row.client?.middle_name, row.client?.last_name]
          .filter(Boolean)
          .join(' ') ||
        row.client?.full_name ||
        '';
      const nextClientId = normalizeId(row.client_id);
      const nextObjectId = normalizeId(row.object_id);
      let nextAddressMode = normalizeOrderAddressMode(row.address_mode);
      if (nextAddressMode === ORDER_ADDRESS_MODE.OBJECT && !nextObjectId) {
        nextAddressMode = ORDER_ADDRESS_MODE.CUSTOM;
      }
      const raw = (row.phone || row.customer_phone_visible || '').replace(/\D/g, '');
      const nextEntranceInfo = row.entrance_info ?? row.object?.comment ?? '';
      const nextParkingNotes = '';
      const nextGeoLat = row.geo_lat ?? '';
      const nextGeoLng = row.geo_lng ?? '';
      const nextCustomAddressLocationMode = normalizeClientObjectLocationMode(row.location_mode, {
        fallback:
          normalizeCoordinateValue(nextGeoLat) && normalizeCoordinateValue(nextGeoLng)
            ? 'map'
            : 'address',
      });
      const rawDepartureDate = normalizeDateOrNull(row.time_window_start);
      const nextDepartureDate = rawDepartureDate
        ? new Date(
            rawDepartureDate.getFullYear(),
            rawDepartureDate.getMonth(),
            rawDepartureDate.getDate(),
            0,
            0,
            0,
            0,
          )
        : null;
      const legacyDepartureTime = hasExplicitTimeLike(row.time_window_start)
        ? normalizeDateOrNull(row.time_window_start)
        : null;
      const nextDepartureTime = parseTimeStringToDate(row.departure_time) || legacyDepartureTime || null;
      const nextDepartureEndDate = normalizeDateOrNull(row.time_window_end);
      const nextIsDepartureRange = !!nextDepartureEndDate;
      const nextAssigneeId = row.assigned_to || null;
      const nextToFeed = !row.assigned_to;
      const nextUrgent = !!row.urgent;
      const nextWorkTypeId = normalizeId(row.work_type_id ?? workTypeIdFromParams);
      const nextWorkTypeResolved =
        typeof row.work_type_id !== 'undefined' || workTypeIdFromParams !== null;
      const nextStatus = row.status || (nextToFeed ? T('order_status_in_feed') : T('order_status_new'));
      const nextPrice = row.price !== null && row.price !== undefined ? String(row.price) : '';
      const fallbackName =
        String(row.work_type_name || row.work_type?.name || workTypeNameFromParams || '').trim() || '';
      let nextAssignedEmployeeLabel = '';
      if (row.assigned_to && row.assignee_profile) {
        const data = row.assignee_profile;
        const nameParts = `${data.first_name || ''} ${data.middle_name || ''} ${data.last_name || ''}`.trim();
        const normalizedFullName = (data.full_name || '').trim();
        nextAssignedEmployeeLabel = nameParts || normalizedFullName || data.email || '';
      }

      setTitle(nextTitle);
      setDescription(nextDescription);
      setRegion(nextRegion);
      setDistrict(nextDistrict);
      setCity(nextCity);
      setStreet(nextStreet);
      setHouse(nextHouse);
      setCountry(nextCountry);
      setPostalCode(nextPostalCode);
      setOffice(nextOffice);
      setFloor(nextFloor);
      setEntrance(nextEntrance);
      setApartment(nextApartment);
      setCustomerName(nextCustomerName);
      setSelectedClientId(nextClientId);
      setSelectedObjectId(nextObjectId);
      setAddressMode(nextAddressMode);
      setPhoneSourceId(PHONE_SOURCE_IDS.MANUAL);
      setPhone(raw);
      setEntranceInfo(String(nextEntranceInfo || ''));
      setParkingNotes(String(nextParkingNotes || ''));
      setGeoLat(String(nextGeoLat || ''));
      setGeoLng(String(nextGeoLng || ''));
      setCustomAddressLocationMode(nextCustomAddressLocationMode);
      setDepartureDate(nextDepartureDate);
      setDepartureTime(nextDepartureTime);
      setDepartureEndDate(nextDepartureEndDate);
      setIsDepartureRange(nextIsDepartureRange);
      setAssigneeId(nextAssigneeId);
      setAssignedEmployeeLabel(nextAssignedEmployeeLabel);
      setWorkTypeNameFallback(fallbackName);
      setWorkTypeResolved(nextWorkTypeResolved);

      setToFeed(nextToFeed);
      setUrgent(nextUrgent);
      setWorkTypeId(nextWorkTypeId);
      setStatusLabel(nextStatus);
      try {
        const found = ORDER_STATUS_KEYS.find((k) => T(`order_status_${k}`) === nextStatus);
        setStatusKey(found || null);
      } catch {
        setStatusKey(null);
      }
      setPrice(nextPrice);

      snapshotRef.current = buildSnapshot({
        title: nextTitle,
        description: nextDescription,
        region: nextRegion,
        district: nextDistrict,
        city: nextCity,
        street: nextStreet,
        house: nextHouse,
        country: nextCountry,
        postalCode: nextPostalCode,
        office: nextOffice,
        floor: nextFloor,
        entrance: nextEntrance,
        apartment: nextApartment,
        customerName: nextCustomerName,
        selectedClientId: nextClientId,
        selectedObjectId: nextObjectId,
        addressMode: nextAddressMode,
        phoneSourceId: PHONE_SOURCE_IDS.MANUAL,
        phone: raw,
        entranceInfo: nextEntranceInfo,
        parkingNotes: nextParkingNotes,
        geoLat: nextGeoLat,
        geoLng: nextGeoLng,
        customAddressLocationMode: nextCustomAddressLocationMode,
        departureDate: nextDepartureDate,
        departureTime: nextDepartureTime,
        departureEndDate: nextDepartureEndDate,
        isDepartureRange: nextIsDepartureRange,
        assigneeId: nextAssigneeId,
        toFeed: nextToFeed,
        urgent: nextUrgent,
        price: nextPrice,
        workTypeId: nextWorkTypeId,
        status: nextStatus,
      });
      userEditedRef.current = false;
      hydratedOrderIdRef.current = id;
      setFormHydrated(true);

      if (row.assigned_to && !row.assignee_profile) {
        ensureRequestAssigneeNamePrefetch(queryClient, row.assigned_to)
          .then((data) => {
            if (cancelled || userEditedRef.current) return;
            setAssignedEmployeeLabel(String(data || ''));
          })
          .catch(() => {});
      }

      if (!nextWorkTypeResolved || nextWorkTypeId == null) {
        supabase
          .from('orders')
          .select('work_type_id, client_id, time_window_end')
          .eq('id', id)
          .maybeSingle()
          .then(({ data: wtRow }) => {
            if (cancelled || userEditedRef.current || !wtRow) return;
            const resolvedWorkTypeId = normalizeId(wtRow.work_type_id);
            const resolvedClientId = normalizeId(wtRow.client_id) || nextClientId;
            const resolvedDepartureEndDate = normalizeDateOrNull(wtRow.time_window_end);
            setWorkTypeId(resolvedWorkTypeId);
            setSelectedClientId(resolvedClientId);
            setSelectedObjectId(nextObjectId);
            setDepartureEndDate((prev) => prev || resolvedDepartureEndDate);
            setIsDepartureRange((prev) => prev || !!resolvedDepartureEndDate);
            setWorkTypeResolved(true);
            snapshotRef.current = buildSnapshot({
              title: nextTitle,
              description: nextDescription,
              region: nextRegion,
              district: nextDistrict,
              city: nextCity,
              street: nextStreet,
              house: nextHouse,
              country: nextCountry,
              postalCode: nextPostalCode,
              office: nextOffice,
              floor: nextFloor,
              entrance: nextEntrance,
              apartment: nextApartment,
              customerName: nextCustomerName,
              selectedClientId: resolvedClientId,
              selectedObjectId: nextObjectId,
              addressMode: nextAddressMode,
              phoneSourceId: PHONE_SOURCE_IDS.MANUAL,
              phone: raw,
              entranceInfo: nextEntranceInfo,
              parkingNotes: nextParkingNotes,
              geoLat: nextGeoLat,
              geoLng: nextGeoLng,
              customAddressLocationMode: nextCustomAddressLocationMode,
              departureDate: nextDepartureDate,
              departureTime: nextDepartureTime,
              departureEndDate: nextDepartureEndDate || resolvedDepartureEndDate,
              isDepartureRange: nextIsDepartureRange || !!resolvedDepartureEndDate,
              assigneeId: nextAssigneeId,
              toFeed: nextToFeed,
              urgent: nextUrgent,
              price: nextPrice,
              workTypeId: resolvedWorkTypeId,
              status: nextStatus,
            });
            userEditedRef.current = false;
          })
          .catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    id,
    orderData,
    buildSnapshot,
    normalizeDateOrNull,
    normalizeId,
    queryClient,
    workTypeIdFromParams,
    workTypeNameFromParams,
    country,
    postalCode,
    office,
    floor,
    entrance,
    apartment,
    titlePrefix,
  ]);
  useEffect(() => {
    if (!assigneeId) {
      assignedLabelRequestIdRef.current += 1;
      setAssignedEmployeeLabel('');
      return;
    }
    if (assignedEmployeeLabel) return;
    refreshAssignedLabel(assigneeId);
  }, [assigneeId, refreshAssignedLabel, assignedEmployeeLabel]);

  useEffect(() => {
    return () => {
      assignedLabelRequestIdRef.current += 1;
    };
  }, []);

  const isDirty = useMemo(() => {
    if (!id || hydratedOrderIdRef.current !== id || !snapshotRef.current) return false;
    const current = buildSnapshot({
      title,
      description,
      region,
      district,
      city,
      street,
      house,
      country,
      postalCode,
      office,
      floor,
      entrance,
      apartment,
      customerName,
      selectedClientId,
      selectedObjectId,
      addressMode,
      phoneSourceId,
      phone,
      entranceInfo,
      parkingNotes,
      geoLat,
      geoLng,
      customAddressLocationMode,
      departureDate,
      departureTime,
      departureEndDate,
      isDepartureRange,
      assigneeId,
      toFeed,
      urgent,
      price,
      workTypeId,
      status: statusLabel,
    });
    return current !== snapshotRef.current;
  }, [
    id,
    title,
    description,
    region,
    district,
    city,
    street,
    house,
    country,
    postalCode,
    office,
    floor,
    entrance,
    apartment,
    customerName,
    selectedClientId,
    selectedObjectId,
    addressMode,
    phoneSourceId,
    phone,
    entranceInfo,
    parkingNotes,
    geoLat,
    geoLng,
    customAddressLocationMode,
    departureDate,
    departureTime,
    departureEndDate,
    isDepartureRange,
    assigneeId,
    toFeed,
    urgent,
    price,
    workTypeId,
    statusLabel,
    buildSnapshot,
  ]);

  useEffect(() => {
    userEditedRef.current = isDirty;
  }, [isDirty]);

  useFocusEffect(
    useCallback(
      () => {
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
      },
      [isDirty],
    ),
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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: formStyles.card,
        field: formStyles.field,
        separator: {
          height: theme.components?.input?.separator?.height ?? 1,
          backgroundColor: theme.components?.input?.separator?.color || theme.colors.border,
          marginLeft: theme.spacing?.lg ?? 16,
          marginRight: theme.spacing?.lg ?? 16,
        },
        toggleRow: {
          ...formStyles.field,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        toggleLabel: {
          color: theme.colors.text,
          fontSize: theme.typography.sizes.md,
          fontWeight: theme.typography.weight.medium,
        },
        toggle: {
          width: 42,
          height: 24,
          borderRadius: 999,
          padding: 2,
          justifyContent: 'center',
          backgroundColor: theme.colors.inputBorder,
        },
        toggleOn: {
          backgroundColor: theme.colors.primary,
        },
        toggleKnob: {
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: theme.colors.surface,
          alignSelf: 'flex-start',
        },
        toggleKnobOn: {
          alignSelf: 'flex-end',
        },
        locationModeRow: {
          ...formStyles.field,
          flexDirection: 'row',
          borderRadius: theme?.radius?.md ?? theme?.components?.input?.borderRadius ?? 10,
          borderWidth: 1,
          borderColor: theme.colors.inputBorder,
          overflow: 'hidden',
        },
        locationModeBtn: {
          flex: 1,
          minHeight: theme.components.input.height,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
        },
        locationModeBtnActive: {
          backgroundColor: theme.colors.primarySoft,
        },
        locationModeBtnText: {
          color: theme.colors.textSecondary,
          fontSize: theme.typography.sizes.md,
          fontWeight: theme.typography.weight.medium,
        },
        locationModeBtnTextActive: {
          color: theme.colors.primary,
        },
        mapPointBlock: {
          ...formStyles.field,
          borderWidth: 1,
          borderColor: theme.colors.inputBorder,
          borderRadius: theme?.radius?.md ?? theme?.components?.input?.borderRadius ?? 10,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          backgroundColor: theme.colors.surface,
        },
        mapPointHint: {
          color: theme.colors.textSecondary,
          fontSize: theme.typography.sizes.sm,
        },
        mapPointValueRow: {
          marginTop: theme.spacing.xs,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        mapPointValue: {
          flex: 1,
          color: theme.colors.text,
          fontSize: theme.typography.sizes.md,
          fontWeight: theme.typography.weight.medium,
        },
        mapPointClearBtn: {
          marginLeft: theme.spacing.sm,
          padding: 2,
        },
        mapActionsRow: {
          marginTop: theme.spacing.sm,
          flexDirection: 'row',
          gap: theme.spacing.sm,
        },
        mapActionBtn: {
          flex: 1,
          minHeight: theme.components.input.height,
          borderRadius: theme?.radius?.md ?? theme?.components?.input?.borderRadius ?? 10,
          borderWidth: 1,
          borderColor: theme.colors.inputBorder,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: theme.spacing.sm,
          backgroundColor: theme.colors.card,
        },
        mapActionBtnInactive: {
          opacity: 0.45,
        },
        mapActionBtnText: {
          color: theme.colors.text,
          fontSize: theme.typography.sizes.sm,
          fontWeight: theme.typography.weight.medium,
        },
      }),
    [formStyles, theme],
  );

  const showToast = useCallback((msg, type = 'info', options) => {
    const text = String(msg || '');
    try {
      if (type === 'error') {
        toastError?.(text, options);
      } else if (type === 'warning') {
        toastWarning?.(text, options);
      } else if (type === 'success') {
        toastSuccess?.(text, options);
      } else {
        toastInfo?.(text, options);
      }
    } catch (e) {
      if (__DEV__) {
        console.warn('Toast error:', e);
      }
    }
  }, [toastError, toastInfo, toastSuccess, toastWarning]);

  const performLeave = useCallback(() => {
    allowLeaveRef.current = true;
    if (navigation && typeof navigation.goBack === 'function') {
      navigation.goBack();
    } else if (router && typeof router.back === 'function') {
      router.back();
    }
  }, [navigation, router]);

  const confirmCancel = useCallback(() => {
    setCancelVisible(false);
    performLeave();
  }, [performLeave]);

  const handleCancelPress = useCallback(() => {
    if (isDirty) {
      setCancelKey((k) => k + 1);
      setCancelVisible(true);
      return;
    }
    performLeave();
  }, [isDirty, performLeave]);

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
    if (isDirty) {
      allowLeaveRef.current = false;
    }
  }, [isDirty]);

  const focusField = useCallback(
    (fieldRef) =>
      ensureVisibleField({
        fieldRef,
        scrollRef,
        scrollYRef,
        insetsBottom: insets.bottom ?? 0,
        headerHeight: theme?.components?.header?.height ?? HEADER_HEIGHT_FALLBACK,
      }),
    [insets.bottom, theme?.components?.header?.height],
  );
  const assigneeItems = useMemo(() => {
    const departmentsById = new Map(
      (Array.isArray(departments) ? departments : []).map((department) => [
        String(department?.id || ''),
        String(department?.name || '').trim(),
      ]),
    );
    return buildAssigneeSelectItems({
      users: employees,
      departmentsById,
      t: T,
      includeFeed: true,
      onSelectFeed: () => {
        setAssigneeId(null);
        setToFeed(true);
        setStatusKey('in_feed');
        setStatusLabel(T('order_status_in_feed'));
        setAssigneeModalVisible(false);
      },
      onSelectUser: (userId) => {
        setAssigneeId(userId ?? null);
        setToFeed(false);
        if (statusKey === 'in_feed') {
          setStatusKey('new');
          setStatusLabel(T('order_status_new'));
        }
        setAssigneeModalVisible(false);
      },
    });
  }, [departments, employees, statusKey]);
  const customAddressDraft = useMemo(
    () => ({
      country,
      region,
      district,
      city,
      street,
      house,
      postal_code: postalCode,
      floor,
      entrance,
      apartment: apartment || office,
      entrance_info: entranceInfo,
      parking_notes: '',
      geo_lat: geoLat,
      geo_lng: geoLng,
      location_mode: customAddressLocationMode,
    }),
    [
      apartment,
      office,
      city,
      country,
      district,
      entrance,
      entranceInfo,
      floor,
      geoLat,
      geoLng,
      house,
      postalCode,
      region,
      street,
      customAddressLocationMode,
    ],
  );
  const addressModalMapLat = useMemo(
    () => normalizeCoordinateValue(addressModalDraft?.geo_lat),
    [addressModalDraft?.geo_lat],
  );
  const addressModalMapLng = useMemo(
    () => normalizeCoordinateValue(addressModalDraft?.geo_lng),
    [addressModalDraft?.geo_lng],
  );
  const addressModalHasMapPoint = useMemo(
    () => !!addressModalMapLat && !!addressModalMapLng,
    [addressModalMapLat, addressModalMapLng],
  );
  const activeAddressDraft = useMemo(
    () =>
      addressMode === ORDER_ADDRESS_MODE.OBJECT
        ? selectedObject
          ? extractOrderAddressFromObject(selectedObject)
          : customAddressDraft
        : customAddressDraft,
    [addressMode, customAddressDraft, selectedObject],
  );
  const customAddressFields = useMemo(
    () => [
      { key: 'country', label: T('order_field_country'), ref: countryRef },
      { key: 'region', label: T('order_field_region'), ref: regionRef },
      { key: 'district', label: T('order_field_district'), ref: districtRef },
      { key: 'city', label: T('order_field_city'), ref: cityRef },
      { key: 'street', label: T('order_field_street'), ref: streetRef },
      { key: 'house', label: T('order_field_house'), ref: houseRef },
      { key: 'postal_code', label: T('order_field_postal_code'), ref: postalCodeRef },
      { key: 'floor', label: T('order_field_floor'), ref: floorRef },
      { key: 'entrance', label: T('order_field_entrance'), ref: entranceRef },
      { key: 'apartment', label: T('order_field_apartment'), ref: apartmentRef },
      { key: 'entrance_info', label: T('order_field_comment'), ref: entranceInfoRef, settingsKey: 'comment' },
    ].filter((field) => {
      const lookupKey = field.settingsKey || field.key;
      return objectFieldsByKey.get(lookupKey)?.isEnabled === true;
    }),
    [objectFieldsByKey],
  );
  const applyAddressDraft = useCallback((draft) => {
    const next = extractOrderAddress(draft);
    setCountry(next.country);
    setRegion(next.region);
    setDistrict(next.district);
    setCity(next.city);
    setStreet(next.street);
    setHouse(next.house);
    setPostalCode(next.postal_code);
    setOffice(next.apartment || next.office || '');
    setFloor(next.floor);
    setEntrance(next.entrance);
    setApartment(next.apartment);
    setEntranceInfo(next.comment || next.entrance_info || '');
    setParkingNotes('');
    setGeoLat(next.geo_lat);
    setGeoLng(next.geo_lng);
    setCustomAddressLocationMode(
      normalizeClientObjectLocationMode(next.location_mode, {
        fallback: hasClientObjectMapPoint(next) ? 'map' : 'address',
      }),
    );
  }, []);

  useEffect(() => {
    if (!addressModalVisible || addressModalLocationMode !== 'map') {
      setAddressModalClipboardHasCoordinates(false);
      return undefined;
    }
    let disposed = false;
    const checkClipboard = async () => {
      try {
        const value = await Clipboard.getStringAsync();
        if (!disposed) setAddressModalClipboardHasCoordinates(!!parseCoordinatesFromText(value));
      } catch {
        if (!disposed) setAddressModalClipboardHasCoordinates(false);
      }
    };
    checkClipboard();
    const timer = setInterval(checkClipboard, theme.timing?.clipboardPollMs ?? 1200);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [addressModalLocationMode, addressModalVisible, theme.timing?.clipboardPollMs]);

  const setAddressModalNextLocationMode = useCallback((nextMode) => {
    const normalized = normalizeClientObjectLocationMode(nextMode, {
      fallback: addressModalHasMapPoint ? 'map' : 'address',
    });
    setAddressModalLocationMode(normalized);
    setAddressModalDraft((prev) => ({ ...prev, location_mode: normalized }));
  }, [addressModalHasMapPoint]);

  const openAddressModalMap = useCallback(async () => {
    try {
      if (addressModalHasMapPoint) {
        openCoordinatesInYandex(addressModalMapLat, addressModalMapLng);
      } else {
        await Linking.openURL('yandexnavi://map_search?text=');
      }
    } catch {
      try {
        await Linking.openURL('https://yandex.ru/maps/');
      } catch {}
    }
  }, [addressModalHasMapPoint, addressModalMapLat, addressModalMapLng]);

  const pasteAddressModalCoordinatesFromClipboard = useCallback(async () => {
    if (!addressModalClipboardHasCoordinates) return;
    try {
      const value = await Clipboard.getStringAsync();
      const parsed = parseCoordinatesFromText(value);
      if (!parsed) return;
      setAddressModalDraft((prev) => ({
        ...prev,
        geo_lat: parsed.lat,
        geo_lng: parsed.lng,
        location_mode: 'map',
      }));
      setAddressModalLocationMode('map');
    } catch {}
  }, [addressModalClipboardHasCoordinates]);

  const clearAddressModalMapPoint = useCallback(() => {
    setAddressModalDraft((prev) => ({ ...prev, geo_lat: '', geo_lng: '' }));
  }, []);

  const handleSave = async () => {
    if (permissionsLoading) return;
    setSubmittedAttempt(true);
    setFieldErrors({});
    if (!hasPermission('canEditOrders')) {
      showToast(T('order_edit_no_permission'), 'warning');
      return;
    }
    if (savingRef.current || saving) return;
    if (!id) {
      showToast(T('order_validation_no_order_id'), 'error');
      return;
    }
    if (companySettings?.recalc_in_progress) {
      showToast(T('settings_recalc_in_progress'), 'warning');
      return;
    }
    try {
      Keyboard.dismiss();
      [
        titleRef,
        descriptionRef,
        regionRef,
        districtRef,
        cityRef,
        streetRef,
        houseRef,
        postalCodeRef,
        countryRef,
        officeRef,
        floorRef,
        entranceRef,
        apartmentRef,
        customerNameRef,
        entranceInfoRef,
        parkingNotesRef,
        geoLatRef,
        geoLngRef,
      ].forEach(
        (r) => {
          try {
            if (r && r.current && typeof r.current.blur === 'function') {
              r.current.blur();
            }
          } catch {
          }
        },
      );
    } catch {
    }

    const resolvedTitle = resolveTitleForSave(title, departureDate);
    const nextErrors = {};
    if (isFieldRequired('title') && !resolvedTitle) {
      nextErrors.title = { message: T('order_validation_title_required') };
    }
    if (isFieldRequired('comment') && !String(description || '').trim()) {
      nextErrors.comment = { message: T('field_settings_required_fill', 'Заполните обязательные поля') };
    }
    if (isFieldRequired('time_window_start') && !normalizeDateOrNull(departureDate)) {
      nextErrors.time_window_start = { message: T('order_validation_date_required') };
    }
    if (isFieldRequired('departure_time') && !hasDepartureTimeValue(departureTime)) {
      nextErrors.departure_time = {
        message: T('order_validation_departure_time_required', 'Укажите время выезда'),
      };
    }
    if (isFieldRequired('assigned_to') && !toFeed && !assigneeId) {
      nextErrors.assigned_to = { message: T('order_validation_executor_required') };
    }
    if (isFieldRequired('work_type_id') && useWorkTypes && !workTypeId) {
      nextErrors.work_type_id = { message: T('order_validation_work_type_required') };
    }
    if (isFieldRequired('client_id') && !selectedClientId) {
      nextErrors.client_id = { message: T('order_validation_client_required') };
    }
    if (
      isFieldRequired('object_id') &&
      selectedClientId &&
      addressMode === ORDER_ADDRESS_MODE.OBJECT &&
      !selectedObjectId
    ) {
      nextErrors.object_id = { message: T('objects_select_required_for_order') };
    }
    const normalizedPhoneForRequired = toE164MobilePhoneOrNull(phone);
    if (isFieldRequired('phone') && !normalizedPhoneForRequired) {
      nextErrors.phone = {
        message: phone ? T('order_validation_phone_format') : T('order_validation_phone_required'),
      };
    }
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      return;
    }

    const rawPhone = (phone || '').replace(/\D/g, '');
    if (rawPhone && !isValidOptionalMobilePhone(String(phone || ''))) {
      setFieldErrors((prev) => ({ ...prev, phone: { message: T('order_validation_phone_format') } }));
      return showToast(T('order_validation_phone_format'), 'error');
    }
    if (rawPhone && !toE164MobilePhoneOrNull(phone)) {
      setFieldErrors((prev) => ({ ...prev, phone: { message: T('order_validation_phone_format') } }));
      return showToast(T('order_validation_phone_format'), 'error');
    }
    const parsedPrice = canEditOrderAmount ? parseDecimalOrNull(price) : null;
    if (canEditOrderAmount && String(price ?? '').trim() && parsedPrice === null) {
      return showToast(T('order_validation_amount_format'), 'error');
    }
    if (canEditOrderAmount && parsedPrice != null && parsedPrice < 0) {
      return showToast(T('order_validation_amount_format'), 'error');
    }

    await proceedSave();
  };

  const proceedSave = async () => {
    try {
      if (savingRef.current || saving) return;
      savingRef.current = true;
      setSaving(true);
      showToast(T('toast_saving'), 'info', { sticky: true });

      const normalizedDepartureDate = normalizeDateOrNull(departureDate);
      if (isFieldRequired('time_window_start') && !normalizedDepartureDate) {
        setFieldErrors((prev) => ({
          ...prev,
          time_window_start: { message: T('order_validation_date_required') },
        }));
        showToast(T('order_validation_date_required'), 'error');
        return;
      }
      if (isFieldRequired('departure_time') && !hasDepartureTimeValue(departureTime)) {
        setFieldErrors((prev) => ({
          ...prev,
          departure_time: { message: T('order_validation_departure_time_required', 'Укажите время выезда') },
        }));
        showToast(T('order_validation_departure_time_required', 'Укажите время выезда'), 'error');
        return;
      }
      const normalizedDepartureEndDate = normalizeDateOrNull(departureEndDate);
      if (isDepartureRange && !normalizedDepartureEndDate) {
        setFieldErrors((prev) => ({
          ...prev,
          time_window_start: { message: T('order_validation_date_required') },
        }));
        showToast(T('order_validation_date_required'), 'error');
        return;
      }
      if (
        isDepartureRange &&
        normalizedDepartureDate &&
        normalizedDepartureEndDate &&
        normalizedDepartureEndDate.getTime() < normalizedDepartureDate.getTime()
      ) {
        setFieldErrors((prev) => ({
          ...prev,
          time_window_start: { message: T('order_validation_date_range_invalid') },
        }));
        showToast(T('order_validation_date_range_invalid'), 'error');
        return;
      }

      const normalizedPhone = toE164MobilePhoneOrNull(phone);
      const parsedPrice = canEditOrderAmount ? parseDecimalOrNull(price) : null;
      if (canEditOrderAmount && String(price ?? '').trim() && parsedPrice === null) {
        showToast(T('order_validation_amount_format'), 'error');
        return;
      }
      if (canEditOrderAmount && parsedPrice != null && parsedPrice < 0) {
        showToast(T('order_validation_amount_format'), 'error');
        return;
      }
      if (isFieldRequired('client_id') && !selectedClientId) {
        setFieldErrors((prev) => ({
          ...prev,
          client_id: { message: T('order_validation_client_required') },
        }));
        showToast(T('order_validation_client_required'), 'error');
        return;
      }
      if (
        isFieldRequired('object_id') &&
        selectedClientId &&
        addressMode === ORDER_ADDRESS_MODE.OBJECT &&
        !selectedObjectId
      ) {
        setFieldErrors((prev) => ({
          ...prev,
          object_id: { message: T('objects_select_required_for_order') },
        }));
        showToast(T('objects_select_required_for_order'), 'error');
        return;
      }
      if (!selectedClientId && normalizedPhone) {
        showToast(T('order_validation_client_required_for_contact_details'), 'error');
        return;
      }
      if (selectedClientId) {
        await updateClientMutation.mutateAsync({
          id: String(selectedClientId),
          patch: {
            phone: normalizedPhone,
          },
        });
      }
      const payload = {
        title: resolveTitleForSave(title, normalizedDepartureDate),
        comment: description,
        client_id: normalizeId(selectedClientId),
        object_id:
          addressMode === ORDER_ADDRESS_MODE.OBJECT ? normalizeId(selectedObjectId) : null,
        address_mode: addressMode,
        object_name_snapshot:
          addressMode === ORDER_ADDRESS_MODE.OBJECT
            ? String(
                selectedObject?.name || orderData?.object_name_snapshot || orderData?.object_name || '',
              ).trim() || null
            : null,
        ...toOrderAddressPatch(activeAddressDraft),
        assigned_to: toFeed ? null : assigneeId,
        time_window_start: formatDateOnlyForStorage(normalizedDepartureDate),
        time_window_end:
          isDepartureRange && normalizedDepartureEndDate
            ? formatDateOnlyForStorage(normalizedDepartureEndDate)
            : null,
        departure_time: formatTimeForStorage(departureTime),
        urgent,
        ...(canEditOrderAmount ? { price: parsedPrice } : {}),
        ...(useWorkTypes && workTypeResolved
          ? {
              work_type_id: normalizeId(workTypeId),
            }
          : {}),
        ...(statusLabel ? { status: statusLabel } : {}),
      };

      await updateRequestMutation.mutateAsync({
        id,
        patch: payload,
        expectedUpdatedAt: orderData?.updated_at || null,
      });
      snapshotRef.current = buildSnapshot({
        title,
        description,
        region,
        district,
        city,
        street,
        house,
        country,
        postalCode,
        office,
        floor,
        entrance,
        apartment,
        customerName,
        selectedClientId,
        selectedObjectId,
        addressMode,
        phoneSourceId,
        phone,
        entranceInfo,
        parkingNotes,
        geoLat,
        geoLng,
        customAddressLocationMode,
        departureDate,
        departureEndDate,
        departureTime,
        isDepartureRange,
        assigneeId,
        toFeed,
        urgent,
        price,
        workTypeId,
        status: statusLabel,
      });
      userEditedRef.current = false;
      showToast(T('toast_success'), 'success');
    } catch (err) {
      if (__DEV__) {
        console.warn('order save failed', err?.message || err);
      }
      if (err?.code === 'CONFLICT') {
        showToast(
          'Заявка уже была изменена на другом устройстве. Откройте актуальную версию и проверьте поля.',
          'warning',
        );
        await refetchOrder();
      } else {
        const message = String(err?.message || '').trim();
        showToast(message || T('order_save_error'), 'error');
      }
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const isScreenReady = !!orderData && formHydrated;
  const renderEditGeneralField = useCallback(
    (fieldKey) => {
      switch (fieldKey) {
        case 'title':
          return (
            <>
              <TextField
                ref={titleRef}
                label={withRequiredLabel(T('order_field_title'), isFieldRequired('title'))}
                placeholder={T('order_placeholder_title')}
                value={title}
                onChangeText={(value) => {
                  setTitle(value);
                  clearFieldError('title');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, title: true }))}
                multiline
                minLines={1}
                style={styles.field}
                onFocus={() => focusField(titleRef)}
                error={getFieldError('title') ? 'invalid' : undefined}
              />
              <FieldErrorText message={getFieldError('title')} />
            </>
          );
        case 'comment':
          return (
            <>
              <TextField
                ref={descriptionRef}
                label={withRequiredLabel(T('order_field_description'), isFieldRequired('comment'))}
                placeholder={T('order_placeholder_description')}
                value={description}
                onChangeText={(value) => {
                  setDescription(value);
                  clearFieldError('comment');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, comment: true }))}
                multiline
                minLines={1}
                style={styles.field}
                onFocus={() => focusField(descriptionRef)}
                error={getFieldError('comment') ? 'invalid' : undefined}
              />
              <FieldErrorText message={getFieldError('comment')} />
            </>
          );
        case 'work_type_id':
          if (!useWorkTypes) return null;
          return (
            <>
              <TextField
                label={withRequiredLabel(T('order_field_work_type'), isFieldRequired('work_type_id'))}
                value={selectedWorkTypeName}
                placeholder={T('order_details_work_type_not_selected')}
                pressable
                style={styles.field}
                onPress={() => setWorkTypeModalVisible(true)}
                error={getFieldError('work_type_id') ? 'invalid' : undefined}
              />
              <FieldErrorText message={getFieldError('work_type_id')} />
            </>
          );
        default:
          return null;
      }
    },
    [
      clearFieldError,
      description,
      focusField,
      getFieldError,
      isFieldRequired,
      selectedWorkTypeName,
      setDescription,
      styles.field,
      title,
      useWorkTypes,
      withRequiredLabel,
    ],
  );

  const renderEditCustomerField = useCallback(
    (fieldKey) => {
      switch (fieldKey) {
        case 'client_id':
          return (
            <>
              <TextField
                label={withRequiredLabel(T('routes_clients_client'), isFieldRequired('client_id'))}
                value={selectedClientName || T('common_select')}
                pressable
                style={styles.field}
                onPress={() => setClientModalVisible(true)}
                error={getFieldError('client_id') ? 'invalid' : undefined}
              />
              <FieldErrorText message={getFieldError('client_id')} />
            </>
          );
        case 'object_id':
          if (!selectedClientId) return null;
          return (
            <>
              <TextField
                label={withRequiredLabel(T('create_order_client_object_label'), isFieldRequired('object_id'))}
                value={selectedObjectSummary || T('create_order_client_object_placeholder')}
                pressable
                style={styles.field}
                onPress={() => setObjectModalVisible(true)}
                error={getFieldError('object_id') ? 'invalid' : undefined}
              />
              <FieldErrorText message={getFieldError('object_id')} />
            </>
          );
        case 'phone':
          return (
            <>
              <TextField
                label={withRequiredLabel(
                  T('create_order_phone_source_display_label'),
                  true,
                )}
                value={selectedPhoneSourceLabel}
                pressable
                style={styles.field}
                onPress={() => setPhoneSourceModalVisible(true)}
              />
              <PhoneInput
                label={withRequiredLabel(
                  T('create_order_visible_phone_label'),
                  isFieldRequired('phone'),
                )}
                value={phone}
                onChangeText={(value) => {
                  if (phoneSourceId !== PHONE_SOURCE_IDS.MANUAL) {
                    setPhoneSourceId(PHONE_SOURCE_IDS.MANUAL);
                  }
                  setPhone(value);
                  clearFieldError('phone');
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                style={styles.field}
                required={isFieldRequired('phone')}
                error={getFieldError('phone') ? 'invalid' : undefined}
              />
              <FieldErrorText message={getFieldError('phone')} />
            </>
          );
        default:
          return null;
      }
    },
    [
      clearFieldError,
      getFieldError,
      isFieldRequired,
      phone,
      phoneSourceId,
      selectedPhoneSourceLabel,
      selectedClientId,
      selectedClientName,
      selectedObjectSummary,
      setPhoneSourceModalVisible,
      styles.field,
      withRequiredLabel,
    ],
  );

  const renderEditPlanningField = useCallback(
    (fieldKey) => {
      if (fieldKey === 'urgent') {
        return (
          <>
            <SwitchField
              label={T('create_order_label_urgent')}
              value={urgent}
              onValueChange={() => setUrgent((prev) => !prev)}
              style={styles.field}
            />
            <View style={styles.separator} />
          </>
        );
      }

      if (fieldKey === 'time_window_start') {
        return (
          <>
            <TextField
              label={withRequiredLabel(T('order_field_departure_date'), isFieldRequired('time_window_start'))}
              value={
                displayDepartureDate
                  ? (() => {
                      const startLabel = format(displayDepartureDate, 'd MMMM yyyy', { locale: ru });
                      if (!isDepartureRange || !displayDepartureEndDate) return startLabel;
                      const endLabel = format(displayDepartureEndDate, 'd MMMM yyyy', { locale: ru });
                      return `${startLabel} — ${endLabel}`;
                    })()
                  : T('order_placeholder_departure_date')
              }
              pressable
              style={styles.field}
              rightSlot={
                displayDepartureDate ? (
                  <ClearButton
                    onPress={() => {
                      setDepartureDate(null);
                      setDepartureEndDate(null);
                      setIsDepartureRange(false);
                    }}
                    accessibilityLabel={T('common_clear')}
                  />
                ) : null
              }
              onPress={() => setShowDateModal(true)}
              error={getFieldError('time_window_start') ? 'invalid' : undefined}
            />
            <FieldErrorText message={getFieldError('time_window_start')} />
          </>
        );
      }

      if (fieldKey === 'departure_time') {
        return (
          <>
            <TextField
              label={withRequiredLabel(T('order_field_departure_time'), isFieldRequired('departure_time'))}
              value={
                hasDepartureTimeValue(displayDepartureTime)
                  ? format(displayDepartureTime, 'HH:mm', { locale: ru })
                  : T('order_placeholder_departure_time')
              }
              pressable
              style={styles.field}
              rightSlot={
                hasDepartureTimeValue(displayDepartureTime) ? (
                  <ClearButton
                    onPress={() => {
                      setDepartureTime(null);
                    }}
                    accessibilityLabel={T('common_clear')}
                  />
                ) : null
              }
              onPress={() => {
                setShowTimeModal(true);
              }}
              error={getFieldError('departure_time') ? 'invalid' : undefined}
            />
            <FieldErrorText message={getFieldError('departure_time')} />
          </>
        );
      }

      if (fieldKey === 'assigned_to') {
        return (
          <>
            <SwitchField
              label={T('create_order_label_to_feed')}
              value={toFeed}
              onValueChange={() => {
                setToFeed((prev) => {
                  const nextValue = !prev;
                  if (nextValue) setAssigneeId(null);
                  return nextValue;
                });
              }}
              style={styles.field}
            />
            <View style={styles.separator} />
            <TextField
              label={withRequiredLabel(T('create_order_label_executor'), isFieldRequired('assigned_to') && !toFeed)}
              value={
                toFeed
                  ? T('create_order_executor_in_feed')
                  : selectedEmployeeName || T('order_details_not_assigned')
              }
              pressable
              style={styles.field}
              onPress={() => setAssigneeModalVisible(true)}
              error={getFieldError('assigned_to') ? 'invalid' : undefined}
              rightSlot={
                assigneeId && !toFeed ? (
                  <ClearButton
                    onPress={() => setAssigneeId(null)}
                    accessibilityLabel={T('common_clear')}
                  />
                ) : null
              }
            />
            <FieldErrorText message={getFieldError('assigned_to')} />
          </>
        );
      }

      return null;
    },
    [
      assigneeId,
      displayDepartureDate,
      displayDepartureEndDate,
      displayDepartureTime,
      getFieldError,
      hasDepartureTimeValue,
      isDepartureRange,
      isFieldRequired,
      selectedEmployeeName,
      styles.field,
      styles.separator,
      toFeed,
      urgent,
      withRequiredLabel,
    ],
  );

  if ((orderLoading && !orderData) || (!!orderData && !isScreenReady)) {
    return (
      <EditScreenTemplate scrollEnabled={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size={theme.components?.activityIndicator?.size ?? 'large'} />
        </View>
      </EditScreenTemplate>
    );
  }

  if (permissionsLoading) {
    return (
      <EditScreenTemplate scrollEnabled={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size={theme.components?.activityIndicator?.size ?? 'large'} />
        </View>
      </EditScreenTemplate>
    );
  }

  if (!hasPermission('canEditOrders')) {
    return (
      <EditScreenTemplate scrollEnabled={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
            {T('order_edit_no_permission')}
          </Text>
        </View>
      </EditScreenTemplate>
    );
  }

  if (orderError) {
    return (
      <EditScreenTemplate scrollEnabled={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
            {T('order_load_error')}
          </Text>
          <Pressable
            onPress={() => {
              refetchOrder();
            }}
            style={({ pressed }) => [
              {
                marginTop: theme.spacing?.md ?? 12,
                paddingHorizontal: theme.spacing?.md ?? 12,
                paddingVertical: theme.spacing?.sm ?? 8,
                borderRadius: theme.radii?.md ?? 8,
                borderWidth: theme.components?.card?.borderWidth ?? 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
              },
              pressed ? { opacity: 0.8 } : null,
            ]}
          >
            <Text style={{ color: theme.colors.text }}>{T('btn_retry')}</Text>
          </Pressable>
        </View>
      </EditScreenTemplate>
    );
  }

  if (!orderData) {
    return (
      <EditScreenTemplate scrollEnabled={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
            {T('order_not_found')}
          </Text>
        </View>
      </EditScreenTemplate>
    );
  }

  return (
    <>
      <EditScreenTemplate
        rightTextLabel={saving ? T('toast_saving') : T('header_save')}
        onRightPress={handleSave}
        onBack={handleCancelPress}
        headerOptions={{
          headerTitleStyle: {
            fontSize: theme?.typography?.sizes?.md ?? 15,
            fontWeight: theme?.typography?.weight?.semibold ?? '600',
          },
        }}
        scrollRef={scrollRef}
        onScroll={(e) => {
          try {
            scrollYRef.current = e.nativeEvent.contentOffset.y || 0;
          } catch {}
        }}
      >
      <SectionHeader topSpacing="xs" bottomSpacing="xs">{T('create_order_section_main')}</SectionHeader>
          <Card padded={false} style={styles.card}>
            {orderedGeneralFieldKeys.map((fieldKey) => (
              <View key={fieldKey}>{renderEditGeneralField(fieldKey)}</View>
            ))}
          </Card>

          <SectionHeader>{T('create_order_section_planning')}</SectionHeader>
          {orderedPlanningFieldKeys.length > 0 ? (
          <Card padded={false} style={styles.card}>
            {orderedPlanningFieldKeys.map((fieldKey) => (
              <View key={fieldKey}>{renderEditPlanningField(fieldKey)}</View>
            ))}
            <TextField
              label={T('orders_filter_status')}
              value={selectedStatusLabel}
              placeholder={T('orders_filter_status')}
              pressable
              style={styles.field}
              onPress={() => setStatusModalVisible(true)}
            />
          </Card>
          ) : null}

          <SectionHeader>{T('create_order_section_customer')}</SectionHeader>
          <Card padded={false} style={styles.card}>
            {orderedCustomerFieldKeys.map((fieldKey) => (
              <View key={fieldKey}>{renderEditCustomerField(fieldKey)}</View>
            ))}
          </Card>

          <View style={{ height: theme.spacing?.xxl ?? BOTTOM_SPACER_FALLBACK }} />
      </EditScreenTemplate>

      <BaseModal
        visible={addressModalVisible}
        onClose={() => setAddressModalVisible(false)}
        title={T('order_details_address')}
        maxHeightRatio={0.9}
        footer={(
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                title={T('btn_cancel')}
                variant="ghost"
                onPress={() => setAddressModalVisible(false)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={T('btn_save')}
                onPress={() => {
                  applyAddressDraft(addressModalDraft);
                  setAddressMode(ORDER_ADDRESS_MODE.CUSTOM);
                  setAddressModalVisible(false);
                }}
              />
            </View>
          </View>
        )}
      >
        <ScrollView
          style={{ flexShrink: 1, minHeight: 0 }}
          contentContainerStyle={{ paddingBottom: theme.spacing.sm }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          <Card paddedXOnly>
            <View style={styles.locationModeRow}>
              <Pressable
                onPress={() => setAddressModalNextLocationMode('address')}
                style={[styles.locationModeBtn, addressModalLocationMode === 'address' ? styles.locationModeBtnActive : null]}
              >
                <Text style={[styles.locationModeBtnText, addressModalLocationMode === 'address' ? styles.locationModeBtnTextActive : null]}>
                  {T('objects_location_mode_address')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAddressModalNextLocationMode('map')}
                style={[styles.locationModeBtn, addressModalLocationMode === 'map' ? styles.locationModeBtnActive : null]}
              >
                <Text style={[styles.locationModeBtnText, addressModalLocationMode === 'map' ? styles.locationModeBtnTextActive : null]}>
                  {T('objects_location_mode_map')}
                </Text>
              </Pressable>
            </View>
            {addressModalLocationMode === 'map' ? (
              <View style={styles.mapPointBlock}>
                <Text style={styles.mapPointHint}>{T('objects_location_map_hint')}</Text>
                <View style={styles.mapPointValueRow}>
                  <Text style={styles.mapPointValue}>
                    {addressModalHasMapPoint ? `${addressModalMapLat}, ${addressModalMapLng}` : T('objects_location_empty')}
                  </Text>
                  {addressModalHasMapPoint ? (
                    <Pressable onPress={clearAddressModalMapPoint} style={styles.mapPointClearBtn}>
                      <Feather name="x-circle" size={theme.icons?.sm ?? 18} color={theme.colors.textSecondary} />
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.mapActionsRow}>
                  <Pressable onPress={openAddressModalMap} style={styles.mapActionBtn}>
                    <Text style={styles.mapActionBtnText}>{T('objects_location_open_map')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={pasteAddressModalCoordinatesFromClipboard}
                    style={[styles.mapActionBtn, !addressModalClipboardHasCoordinates ? styles.mapActionBtnInactive : null]}
                    disabled={!addressModalClipboardHasCoordinates}
                  >
                    <Text style={styles.mapActionBtnText}>{T('objects_location_paste')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {addressModalLocationMode === 'address'
              ? customAddressFields.map((field) => (
                  <TextField
                    key={`modal-address-${field.key}`}
                    ref={field.ref}
                    label={field.label}
                    value={String(addressModalDraft?.[field.key] || '')}
                    onChangeText={(value) =>
                      setAddressModalDraft((prev) => ({
                        ...prev,
                        [field.key]: String(value || ''),
                      }))
                    }
                    keyboardType={field.keyboardType}
                    style={styles.field}
                    onFocus={() => focusField(field.ref)}
                  />
                ))
              : null}
          </Card>
        </ScrollView>
      </BaseModal>

      <SelectModal
        visible={workTypeModalVisible}
        title={T('order_modal_work_type_select')}
        items={workTypeItems}
        searchable={false}
        selectedId={normalizeId(workTypeId) ?? WORK_TYPE_NONE_OPTION_ID}
        onSelect={(item) => {
          const isNoneOption = item?.id === WORK_TYPE_NONE_OPTION_ID;
          setWorkTypeId(isNoneOption ? null : normalizeId(item?.id));
          setWorkTypeNameFallback(isNoneOption ? '' : String(item?.label || ''));
          setWorkTypeResolved(true);
          setWorkTypeModalVisible(false);
        }}
        onClose={() => setWorkTypeModalVisible(false)}
      />

      <SelectModal
        visible={statusModalVisible}
        title={T('orders_filter_status')}
        items={statusItems}
        searchable={false}
        selectedId={statusKey}
        onSelect={(item) => {
          try {
            setStatusKey(item?.id ?? null);
            setStatusLabel(item?.label ?? '');
            if (item?.id === 'in_feed') {
              setAssigneeId(null);
              setToFeed(true);
            } else {
              setToFeed(false);
            }
          } catch {
          } finally {
            setStatusModalVisible(false);
          }
        }}
        onClose={() => setStatusModalVisible(false)}
      />

      <SelectModal
        visible={phoneSourceModalVisible}
        title={T('create_order_phone_source_modal_title')}
        items={phoneSourceItems}
        searchable={false}
        selectedId={phoneSourceId}
        onSelect={(item) => {
          if (!item?.id || item.disabled) return;
          const normalizedSourceId = normalizePhoneSourceId(item.id);
          setPhoneSourceId(normalizedSourceId);
          if (normalizedSourceId === PHONE_SOURCE_IDS.MANUAL) {
            clearFieldError('phone');
          } else {
            const nextPhone = resolvePhoneBySourceId(normalizedSourceId);
            setPhone(String(nextPhone || '').trim());
            clearFieldError('phone');
          }
          setPhoneSourceModalVisible(false);
        }}
        onClose={() => setPhoneSourceModalVisible(false)}
      />

      <SelectModal
        visible={assigneeModalVisible}
        title={T('create_order_modal_executor_title')}
        items={assigneeItems}
        searchable
        filterFn={(item, query) => matchesSearch(item?.searchIndex, query)}
        selectedId={toFeed ? 'feed' : assigneeId}
        onSelect={(item) => item?.onPress?.()}
        onClose={() => setAssigneeModalVisible(false)}
      />

      <SelectModal
        visible={clientModalVisible}
        title={T('routes_clients_client')}
        items={clientItems}
        searchable
        searchLabel={null}
        searchPlaceholder={T('order_client_modal_search_placeholder')}
        onSearchChange={setClientModalSearch}
        filterFn={(item, query) => matchesSearch(item?.searchIndex, query)}
        emptyComponent={
          <View style={{ paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.sm }}>
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
              {T('order_client_search_empty_hint')}
            </Text>
          </View>
        }
        footer={
          <View style={{ marginBottom: theme.spacing.lg }}>
            <Button
              title={T('order_client_create_new')}
              variant="primary"
              onPress={openCreateClientFromModal}
            />
          </View>
        }
        selectedId={selectedClientId}
        onItemLongPress={openClientPreview}
        onSelect={(item) => item?.onPress?.()}
        onClose={() => setClientModalVisible(false)}
      />

      <QuickPreviewModal
        visible={previewClientVisible}
        onClose={() => setPreviewClientVisible(false)}
        title={String(previewClient?.fullName || '').trim() || T('common_noName')}
        anchor={previewAnchor}
        rows={previewClientRows}
        tags={previewClientTags}
        tagsTitle={T('tags_field_label')}
        footerActionLabel={hasPermission('canViewClients') ? T('common_view') : undefined}
        onFooterAction={hasPermission('canViewClients') ? openPreviewClientCard : undefined}
      />

      <QuickPreviewModal
        visible={previewObjectVisible}
        onClose={() => setPreviewObjectVisible(false)}
        title={String(previewObject?.name || '').trim() || T('objects_new')}
        anchor={previewAnchor}
        rows={previewObjectRows}
        footerActionLabel={hasPermission('canViewObjects') ? T('common_view') : undefined}
        onFooterAction={hasPermission('canViewObjects') ? openPreviewObjectCard : undefined}
      />

      <SelectModal
        visible={objectModalVisible}
        title={T('objects_select')}
        items={objectItems}
        searchable={false}
        selectedId={selectedObjectId}
        onItemLongPress={openObjectPreview}
        onSelect={(item) => item?.onPress?.()}
        onClose={() => setObjectModalVisible(false)}
      />

      <DateTimeModal
        visible={showDateModal}
        mode="date"
        initial={departureDate}
        allowFutureDates={true}
        onApply={(date) => {
          setDepartureDate(
            date
              ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
              : null,
          );
          setDepartureEndDate(null);
          setIsDepartureRange(false);
          setShowDateModal(false);
        }}
        onClose={() => setShowDateModal(false)}
      />

      <DateTimeModal
        visible={showTimeModal}
        mode="time"
        initial={displayDepartureTime || new Date()}
        allowFutureDates={true}
        onApply={(time) => {
          const newTime = new Date();
          newTime.setHours(time.getHours(), time.getMinutes(), 0, 0);
          setDepartureTime(newTime);
          setShowTimeModal(false);
        }}
        onClose={() => setShowTimeModal(false)}
      />

      <ConfirmModal
        key={`cancel-${cancelKey}`}
        visible={cancelVisible}
        onClose={() => setCancelVisible(false)}
        title={T('dlg_leave_title')}
        message={T('dlg_leave_msg')}
        confirmLabel={T('dlg_leave_confirm')}
        cancelLabel={T('dlg_leave_cancel')}
        confirmVariant="destructive"
        onConfirm={confirmCancel}
      />
    </>
  );
}

export default function EditOrderScreen() {
  return (
    <DeferredScreen>
      <EditOrderContent />
    </DeferredScreen>
  );
}

