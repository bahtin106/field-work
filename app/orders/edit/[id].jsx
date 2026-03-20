import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
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
import { collectClientPhoneSearchValues } from '../../../src/features/clients/additionalPhones';
import { useClientObjects } from '../../../src/features/objects/queries';
import {
  buildClientObjectAddressSummary,
  buildClientObjectShortAddress,
} from '../../../src/features/objects/addressing';
import {
  ORDER_ADDRESS_MODE,
  buildOrderAddressDisplay,
  buildOrderAddressShort,
  extractOrderAddress,
  extractOrderAddressFromObject,
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
import FiltersPanel from '../../../components/filters/FiltersPanel';
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
import TextField from '../../../components/ui/TextField';
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

const HEADER_HEIGHT_FALLBACK = 56;
const BOTTOM_SPACER_FALLBACK = 80;
const ORDER_STATUS_KEYS = ['in_feed', 'new', 'in_progress', 'completed'];
const WORK_TYPE_NONE_OPTION_ID = '__none__';
const ORDER_CLIENT_FLOW_STORAGE_PREFIX = 'order_client_flow:';
const ROUTE_PLACEHOLDER_RE = /^\[[^\]]+\]$/;

function normalizeOrderRouteId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (ROUTE_PLACEHOLDER_RE.test(normalized)) return null;
  return normalized;
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
  const [assigneePickerVisible, setAssigneePickerVisible] = useState(false);
  const { users: employees } = useUsers({
    filters: {},
    enabled: assigneePickerVisible,
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
  const [phone, setPhone] = useState('');
  const [entranceInfo, setEntranceInfo] = useState('');
  const [departureDate, setDepartureDate] = useState(null);
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
  const [assignedEmployeeLabel, setAssignedEmployeeLabel] = useState('');
  const [formHydrated, setFormHydrated] = useState(false);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelKey, setCancelKey] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  const [touched, setTouched] = useState({});
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
  const [departureTimeTouched, setDepartureTimeTouched] = useState(false);
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
  const orderedGeneralFieldKeys = useMemo(
    () =>
      getOrderedEntityFields(orderFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['title', 'comment', 'assigned_to', 'work_type_id'],
      }).map((field) => field.fieldKey),
    [orderFieldSettings],
  );
  const orderedCustomerFieldKeys = useMemo(
    () =>
      getOrderedEntityFields(orderFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['client_id', 'object_id', 'phone'],
      }).map((field) => field.fieldKey),
    [orderFieldSettings],
  );
  const orderedDepartureFieldKeys = useMemo(
    () =>
      getOrderedEntityFields(orderFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['time_window_start', 'departure_time'],
      }).map((field) => field.fieldKey),
    [orderFieldSettings],
  );
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
    (fieldKey) => orderFieldsByKey.get(fieldKey)?.isRequired === true,
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
  const selectedObjectSummary = useMemo(() => {
    const liveSummary = [selectedObject?.name, buildClientObjectAddressSummary(selectedObject)]
      .filter(Boolean)
      .join(' - ');
    if (liveSummary) return liveSummary;
    return String(orderData?.object_name_snapshot || orderData?.object_name || '').trim();
  }, [orderData?.object_name, orderData?.object_name_snapshot, selectedObject]);

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
        setPhone(String(client.phone || ''));
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
    const fullAddress =
      buildClientObjectAddressSummary(previewObject) || buildClientObjectShortAddress(previewObject) || '';
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
        key: 'entrance_info',
        label: T('order_field_entrance_info'),
        value: String(previewObject.entrance_info || '').trim(),
      },
      {
        key: 'parking_notes',
        label: T('order_field_parking_notes'),
        value: String(previewObject.parking_notes || '').trim(),
      },
    ].filter((row) => String(row?.value || '').trim());
  }, [previewObject]);

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

  const redirectToNewObjectCreation = useCallback(() => {
    if (!selectedClientId) return;
    setAddressModalVisible(false);
    setObjectModalVisible(false);
    showToast(
      T(
        'order_object_edit_requires_new_object',
        'У вас нет прав на редактирование выбранного объекта. Создайте новый объект для этой заявки.',
      ),
      'warning',
    );
    router.push({
      pathname: `/clients/${String(selectedClientId)}/objects/new`,
      params: {
        returnTo: `/orders/edit/${String(id || '')}`,
      },
    });
  }, [id, router, selectedClientId, showToast]);

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
      subtitle: buildClientObjectShortAddress(objectItem) || undefined,
      objectRaw: objectItem,
      onPress: () => {
        setSelectedObjectId(objectItem.id);
        const objectAddress = extractOrderAddressFromObject(objectItem);
        setCountry(objectAddress.country);
        setRegion(objectAddress.region);
        setDistrict(objectAddress.district);
        setCity(objectAddress.city);
        setStreet(objectAddress.street);
        setHouse(objectAddress.house);
        setPostalCode(objectAddress.postal_code);
        setOffice(objectAddress.office);
        setFloor(objectAddress.floor);
        setEntrance(objectAddress.entrance);
        setApartment(objectAddress.apartment);
        setEntranceInfo(objectAddress.entrance_info);
        setParkingNotes(objectAddress.parking_notes);
        setGeoLat(objectAddress.geo_lat);
        setGeoLng(objectAddress.geo_lng);
        setObjectModalVisible(false);
      },
    }));
  }, [clientObjects]);

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
    const d = input instanceof Date ? input : new Date(input);
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }, []);
  const hasDepartureTimeValue = useCallback(
    (input, touched = false) => {
      const value = normalizeDateOrNull(input);
      if (!value) return false;
      if (touched) return true;
      return value.getHours() !== 0 || value.getMinutes() !== 0;
    },
    [normalizeDateOrNull],
  );
  const displayDepartureDate = useMemo(
    () => normalizeDateOrNull(departureDate),
    [departureDate, normalizeDateOrNull],
  );
  const displayDepartureEndDate = useMemo(
    () => normalizeDateOrNull(departureEndDate),
    [departureEndDate, normalizeDateOrNull],
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
        phone: String(draft.phone || '').replace(/\D/g, ''),
        entranceInfo: String(draft.entranceInfo || '').trim(),
        parkingNotes: String(draft.parkingNotes || '').trim(),
        geoLat: String(draft.geoLat || '').trim(),
        geoLng: String(draft.geoLng || '').trim(),
        departureDateIso: normalizeDateOrNull(draft.departureDate)?.toISOString() || null,
        departureEndDateIso: normalizeDateOrNull(draft.departureEndDate)?.toISOString() || null,
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
      const nextTitle = row.title || '';
      const nextDescription = row.comment || '';
      const nextRegion = row.region || '';
      const nextDistrict = row.district || '';
      const nextCity = row.city || '';
      const nextStreet = row.street || '';
      const nextHouse = row.house || '';
      const nextCountry = row.country ?? country ?? '';
      const nextPostalCode = row.postal_code ?? postalCode ?? '';
      const nextOffice = row.office ?? office ?? '';
      const nextFloor = row.floor ?? floor ?? '';
      const nextEntrance = row.entrance ?? entrance ?? '';
      const nextApartment = row.apartment ?? apartment ?? '';
      const nextCustomerName =
        row.fio ||
        row.customer_name ||
        row.client?.full_name ||
        [row.client?.last_name, row.client?.first_name, row.client?.middle_name]
          .filter(Boolean)
          .join(' ') ||
        '';
      const nextClientId = normalizeId(row.client_id);
      const nextObjectId = normalizeId(row.object_id);
      let nextAddressMode = normalizeOrderAddressMode(row.address_mode);
      if (nextAddressMode === ORDER_ADDRESS_MODE.OBJECT && !nextObjectId) {
        nextAddressMode = ORDER_ADDRESS_MODE.CUSTOM;
      }
      const raw = (row.phone || row.customer_phone_visible || '').replace(/\D/g, '');
      const nextEntranceInfo = row.entrance_info ?? '';
      const nextParkingNotes = row.parking_notes ?? '';
      const nextGeoLat = row.geo_lat ?? '';
      const nextGeoLng = row.geo_lng ?? '';
      const nextDepartureDate = normalizeDateOrNull(row.time_window_start);
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
        const nameParts = `${data.first_name || ''} ${data.last_name || ''}`.trim();
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
      setPhone(raw);
      setEntranceInfo(String(nextEntranceInfo || ''));
      setParkingNotes(String(nextParkingNotes || ''));
      setGeoLat(String(nextGeoLat || ''));
      setGeoLng(String(nextGeoLng || ''));
      setDepartureDate(nextDepartureDate);
      setDepartureTimeTouched(
        !!nextDepartureDate &&
          (nextDepartureDate.getHours() !== 0 || nextDepartureDate.getMinutes() !== 0),
      );
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
        phone: raw,
        entranceInfo: nextEntranceInfo,
        parkingNotes: nextParkingNotes,
        geoLat: nextGeoLat,
        geoLng: nextGeoLng,
        departureDate: nextDepartureDate,
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
              phone: raw,
              departureDate: nextDepartureDate,
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
      phone,
      entranceInfo,
      parkingNotes,
      geoLat,
      geoLng,
      departureDate,
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
    phone,
    entranceInfo,
    parkingNotes,
    geoLat,
    geoLng,
    departureDate,
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

  const handleAssignmentApply = useCallback(
    (selectedId) => {
      const normalized = selectedId ?? null;
      setAssigneeId(normalized);
      setToFeed(!normalized);
      try {
        if (normalized && statusKey === 'in_feed') {
          setStatusKey('new');
          setStatusLabel(T('order_status_new'));
        }
      } catch {
      }
      setAssigneePickerVisible(false);
    },
    [setAssigneeId, setAssigneePickerVisible, setToFeed, statusKey, setStatusKey, setStatusLabel],
  );

  const handleAssignmentReset = useCallback(() => {
    setAssigneeId(null);
    setToFeed(true);
    try {
      setStatusKey('in_feed');
      setStatusLabel(T('order_status_in_feed'));
    } catch {
    }
  }, [setAssigneeId, setToFeed, setStatusKey, setStatusLabel]);

  const selectExecutorTitle = T('order_modal_select_executor');
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
  const assignmentPanelConfig = useMemo(
    () => ({
      employees,
      selectedId: assigneeId,
      defaults: { selectedId: null },
      onApply: handleAssignmentApply,
      onReset: handleAssignmentReset,
      title: selectExecutorTitle,
    }),
    [employees, assigneeId, handleAssignmentApply, handleAssignmentReset, selectExecutorTitle],
  );
  const customAddressDraft = useMemo(
    () => ({
      country,
      region,
      district,
      city,
      street,
      house,
      postal_code: postalCode,
      office,
      floor,
      entrance,
      apartment,
      entrance_info: entranceInfo,
      parking_notes: parkingNotes,
      geo_lat: geoLat,
      geo_lng: geoLng,
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
      parkingNotes,
      postalCode,
      region,
      street,
    ],
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
  const hasActiveAddress = useMemo(
    () =>
      !!buildOrderAddressShort(
        Object.keys(activeAddressDraft || {}).reduce((acc, field) => {
          if (objectFieldsByKey.get(field)?.isEnabled === false) return acc;
          return { ...acc, [field]: activeAddressDraft?.[field] || '' };
        }, {}),
      ),
    [activeAddressDraft, objectFieldsByKey],
  );
  const shortAddressValue = useMemo(
    () =>
      buildOrderAddressDisplay(
        Object.keys(activeAddressDraft || {}).reduce((acc, field) => {
          if (objectFieldsByKey.get(field)?.isEnabled === false) return acc;
          return { ...acc, [field]: activeAddressDraft?.[field] || '' };
        }, {}),
      ) ||
      buildOrderAddressShort(
        Object.keys(activeAddressDraft || {}).reduce((acc, field) => {
          if (objectFieldsByKey.get(field)?.isEnabled === false) return acc;
          return { ...acc, [field]: activeAddressDraft?.[field] || '' };
        }, {}),
      ) ||
      T('order_details_address_not_specified'),
    [activeAddressDraft, objectFieldsByKey],
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
      { key: 'office', label: T('order_field_office'), ref: officeRef },
      { key: 'floor', label: T('order_field_floor'), ref: floorRef },
      { key: 'entrance', label: T('order_field_entrance'), ref: entranceRef },
      { key: 'apartment', label: T('order_field_apartment'), ref: apartmentRef },
      { key: 'entrance_info', label: T('order_field_entrance_info'), ref: entranceInfoRef },
      { key: 'parking_notes', label: T('order_field_parking_notes'), ref: parkingNotesRef },
      { key: 'geo_lat', label: T('order_field_geo_lat'), ref: geoLatRef, keyboardType: 'decimal-pad' },
      { key: 'geo_lng', label: T('order_field_geo_lng'), ref: geoLngRef, keyboardType: 'decimal-pad' },
    ].filter((field) => objectFieldsByKey.get(field.key)?.isEnabled !== false),
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
    setOffice(next.office);
    setFloor(next.floor);
    setEntrance(next.entrance);
    setApartment(next.apartment);
    setEntranceInfo(next.entrance_info);
    setParkingNotes(next.parking_notes);
    setGeoLat(next.geo_lat);
    setGeoLng(next.geo_lng);
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

    const nextErrors = {};
    if (isFieldRequired('title') && !title.trim()) {
      nextErrors.title = { message: T('order_validation_title_required') };
    }
    if (isFieldRequired('comment') && !String(description || '').trim()) {
      nextErrors.comment = { message: T('field_settings_required_fill', 'Заполните обязательные поля') };
    }
    if (isFieldRequired('time_window_start') && !normalizeDateOrNull(departureDate)) {
      nextErrors.time_window_start = { message: T('order_validation_date_required') };
    }
    if (isFieldRequired('departure_time') && !hasDepartureTimeValue(departureDate, departureTimeTouched)) {
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
      if (isFieldRequired('departure_time') && !hasDepartureTimeValue(normalizedDepartureDate, departureTimeTouched)) {
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
      if (orderFieldsByKey.get('object_id')?.isEnabled !== false && !hasActiveAddress) {
        showToast(T('order_validation_address_required'), 'error');
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
        title,
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
        time_window_start: normalizedDepartureDate ? normalizedDepartureDate.toISOString() : null,
        time_window_end:
          isDepartureRange && normalizedDepartureEndDate
            ? normalizedDepartureEndDate.toISOString()
            : null,
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
        phone,
        departureDate,
        departureEndDate,
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
                minLines={3}
                style={styles.field}
                onFocus={() => focusField(descriptionRef)}
                error={getFieldError('comment') ? 'invalid' : undefined}
              />
              <FieldErrorText message={getFieldError('comment')} />
            </>
          );
        case 'assigned_to':
          return (
            <>
              <TextField
                label={withRequiredLabel(T('order_details_executor'), isFieldRequired('assigned_to') && !toFeed)}
                value={selectedEmployeeName}
                placeholder={T('order_details_not_assigned')}
                pressable
                style={styles.field}
                onPress={() => setAssigneePickerVisible(true)}
                error={getFieldError('assigned_to') ? 'invalid' : undefined}
              />
              <FieldErrorText message={getFieldError('assigned_to')} />
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
      selectedEmployeeName,
      selectedWorkTypeName,
      setDescription,
      styles.field,
      title,
      toFeed,
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
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{T('order_address_use_custom')}</Text>
                <Pressable
                  onPress={() => {
                    if (
                      addressMode === ORDER_ADDRESS_MODE.OBJECT &&
                      selectedObjectId &&
                      !hasPermission('canEditObjects')
                    ) {
                      redirectToNewObjectCreation();
                      return;
                    }
                    setAddressMode((prev) =>
                      prev === ORDER_ADDRESS_MODE.CUSTOM ? ORDER_ADDRESS_MODE.OBJECT : ORDER_ADDRESS_MODE.CUSTOM,
                    );
                  }}
                  style={[
                    styles.toggle,
                    addressMode === ORDER_ADDRESS_MODE.CUSTOM ? styles.toggleOn : null,
                  ]}
                >
                  <View
                    style={[
                      styles.toggleKnob,
                      addressMode === ORDER_ADDRESS_MODE.CUSTOM ? styles.toggleKnobOn : null,
                    ]}
                  />
                </Pressable>
              </View>
              {addressMode === ORDER_ADDRESS_MODE.OBJECT ? (
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
              ) : null}
              {addressMode === ORDER_ADDRESS_MODE.CUSTOM ? (
                <TextField
                  label={T('order_details_address')}
                  value={shortAddressValue}
                  pressable
                  style={styles.field}
                  onPress={() => {
                    setAddressModalDraft(extractOrderAddress(activeAddressDraft));
                    setAddressModalVisible(true);
                  }}
                />
              ) : null}
            </>
          );
        case 'phone':
          return (
            <>
              <PhoneInput
                label={withRequiredLabel(T('fields_phone'), isFieldRequired('phone'))}
                value={phone}
                onChangeText={(value) => {
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
      activeAddressDraft,
      addressMode,
      clearFieldError,
      getFieldError,
      hasPermission,
      isFieldRequired,
      phone,
      redirectToNewObjectCreation,
      selectedClientId,
      selectedClientName,
      selectedObjectId,
      selectedObjectSummary,
      shortAddressValue,
      styles.field,
      styles.toggle,
      styles.toggleKnob,
      styles.toggleKnobOn,
      styles.toggleLabel,
      styles.toggleOn,
      styles.toggleRow,
      withRequiredLabel,
    ],
  );

  const renderEditDepartureField = useCallback(
    (fieldKey) => {
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
                      setDepartureTimeTouched(false);
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
                hasDepartureTimeValue(displayDepartureDate, departureTimeTouched)
                  ? format(displayDepartureDate, 'HH:mm', { locale: ru })
                  : T('order_placeholder_departure_time')
              }
              pressable
              style={styles.field}
              rightSlot={
                hasDepartureTimeValue(displayDepartureDate, departureTimeTouched) ? (
                  <ClearButton
                    onPress={() => {
                      if (!displayDepartureDate) return;
                      const next = new Date(displayDepartureDate);
                      next.setHours(0, 0, 0, 0);
                      setDepartureDate(next);
                      setDepartureTimeTouched(false);
                    }}
                    accessibilityLabel={T('common_clear')}
                  />
                ) : null
              }
              onPress={() => {
                if (!displayDepartureDate) {
                  setShowDateModal(true);
                  return;
                }
                setShowTimeModal(true);
              }}
              error={getFieldError('departure_time') ? 'invalid' : undefined}
            />
            <FieldErrorText message={getFieldError('departure_time')} />
          </>
        );
      }

      return null;
    },
    [
      departureTimeTouched,
      displayDepartureDate,
      displayDepartureEndDate,
      getFieldError,
      hasDepartureTimeValue,
      isDepartureRange,
      isFieldRequired,
      styles.field,
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
      <SectionHeader topSpacing="xs" bottomSpacing="xs">{T('order_details_general_data')}</SectionHeader>
          <Card padded={false} style={styles.card}>
            {orderedGeneralFieldKeys.map((fieldKey) => (
              <View key={fieldKey}>{renderEditGeneralField(fieldKey)}</View>
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

          <SectionHeader bottomSpacing="xs">{T('order_section_finances')}</SectionHeader>
          {orderFieldsByKey.get('price')?.isEnabled !== false && canViewOrderAmount ? (
          <Card padded={false} style={styles.card}>
            {orderFieldsByKey.get('price')?.isEnabled !== false && canViewOrderAmount ? (
            <TextField
              label={T('order_field_initial_amount', 'Изначальная сумма')}
              placeholder={T('order_placeholder_amount')}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              pressable={!canEditOrderAmount}
              onPress={!canEditOrderAmount ? () => {} : undefined}
              style={styles.field}
            />
            ) : null}
          </Card>
          ) : null}

          <SectionHeader bottomSpacing="xs">{T('order_section_customer')}</SectionHeader>
          <Card padded={false} style={styles.card}>
            {orderedCustomerFieldKeys.map((fieldKey) => (
              <View key={fieldKey}>{renderEditCustomerField(fieldKey)}</View>
            ))}
          </Card>

          <SectionHeader bottomSpacing="xs">
            {T('company_settings_sections_departure_helperText_departureOn')}
          </SectionHeader>
          {(orderFieldsByKey.get('time_window_start')?.isEnabled !== false ||
            orderFieldsByKey.get('departure_time')?.isEnabled !== false) ? (
          <Card padded={false} style={styles.card}>
            {orderedDepartureFieldKeys.map((fieldKey) => (
              <View key={fieldKey}>{renderEditDepartureField(fieldKey)}</View>
            ))}
          </Card>
          ) : null}

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
            {customAddressFields.map((field) => (
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
            ))}
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
          setDepartureDate((prev) => {
            if (!date) return null;
            if (!prev) return date;
            const next = new Date(date);
            next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
            return next;
          });
          if (!date) setDepartureTimeTouched(false);
          setDepartureEndDate(null);
          setIsDepartureRange(false);
          setShowDateModal(false);
        }}
        onClose={() => setShowDateModal(false)}
      />

      <DateTimeModal
        visible={showTimeModal}
        mode="time"
        initial={displayDepartureDate || new Date()}
        allowFutureDates={true}
        onApply={(time) => {
          const baseDate = displayDepartureDate || new Date();
          const newDate = new Date(baseDate);
          newDate.setHours(time.getHours(), time.getMinutes(), 0, 0);
          setDepartureDate(newDate);
          setDepartureTimeTouched(true);
          setShowTimeModal(false);
        }}
        onClose={() => setShowTimeModal(false)}
      />

      <FiltersPanel
        visible={assigneePickerVisible}
        onClose={() => setAssigneePickerVisible(false)}
        departments={departments}
        mode="assignment"
        assignment={assignmentPanelConfig}
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

