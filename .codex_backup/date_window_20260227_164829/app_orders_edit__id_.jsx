// apps/field-work/app/orders/edit/[id].jsx
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Pressable,
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
import { useClients } from '../../../src/features/clients/queries';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FiltersPanel from '../../../components/filters/FiltersPanel';
import { useDepartments as useDepartmentsHook } from '../../../components/hooks/useDepartments';
import { useUsers } from '../../../components/hooks/useUsers';
import EditScreenTemplate, { useEditFormStyles } from '../../../components/layout/EditScreenTemplate';
import Card from '../../../components/ui/Card';
import { ConfirmModal, DateTimeModal, SelectModal } from '../../../components/ui/modals';
import { isValidRu as isValidPhone } from '../../../components/ui/phone';
import PhoneInput from '../../../components/ui/PhoneInput';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { useToast } from '../../../components/ui/ToastProvider';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';
import { usePermissions } from '../../../lib/permissions';
import { supabase } from '../../../lib/supabase';
import { t as T } from '../../../src/i18n';
import { queryKeys } from '../../../src/shared/query/queryKeys';
import { useTheme } from '../../../theme/ThemeProvider';

const HEADER_HEIGHT_FALLBACK = 56;
const BOTTOM_SPACER_FALLBACK = 80;
const ORDER_STATUS_KEYS = ['in_feed', 'new', 'in_progress', 'completed'];
const WORK_TYPE_NONE_OPTION_ID = '__none__';

export default function EditOrderScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const {
    id: rawId,
    companyId: rawCompanyId,
    workTypeId: rawWorkTypeId,
    workTypeName: rawWorkTypeName,
  } = useLocalSearchParams();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
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

  const { theme } = useTheme();
  const { has: hasPermission, loading: permissionsLoading } = usePermissions();
  const formStyles = useEditFormStyles();
  const { settings: companySettings, useDepartureTime } = useCompanySettings();
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

  // moved up: СЃРѕСЃС‚РѕСЏРЅРёРµ РІРёРґРёРјРѕСЃС‚Рё picker РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РґРѕСЃС‚СѓРїРЅРѕ РґРѕ РІС‹Р·РѕРІР° useUsers
  const [assigneePickerVisible, setAssigneePickerVisible] = useState(false);

  // useUsers С‚РµРїРµСЂСЊ С‡РёС‚Р°РµС‚ РєРѕСЂСЂРµРєС‚РЅРѕРµ Р·РЅР°С‡РµРЅРёРµ enabled
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
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [building, setBuilding] = useState('');
  const [floor, setFloor] = useState('');
  const [entrance, setEntrance] = useState('');
  const [apartment, setApartment] = useState('');
  const [intercom, setIntercom] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [phone, setPhone] = useState('');
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPref, setContactPref] = useState('');
  const [entranceInfo, setEntranceInfo] = useState('');
  const [departureDate, setDepartureDate] = useState(null);
  const [assigneeId, setAssigneeId] = useState(null);
  const [toFeed, setToFeed] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [statusKey, setStatusKey] = useState(null);
  const [statusLabel, setStatusLabel] = useState('');
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [clientModalVisible, setClientModalVisible] = useState(false);
  const [departmentId, setDepartmentId] = useState(null);
  const [parkingNotes, setParkingNotes] = useState('');
  const [geoLat, setGeoLat] = useState('');
  const [geoLng, setGeoLng] = useState('');
  const [dateTimeValue, setDateTimeValue] = useState('');
  const [assignedEmployeeLabel, setAssignedEmployeeLabel] = useState('');
  const [formHydrated, setFormHydrated] = useState(false);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelKey, setCancelKey] = useState(0);

  // Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРЅС‹Рµ refs Рё СЃРѕСЃС‚РѕСЏРЅРёСЏ, РєРѕС‚РѕСЂС‹Рµ РёСЃРїРѕР»СЊР·СѓРµС‚ РєРѕРјРїРѕРЅРµРЅС‚ РґР°Р»СЊС€Рµ
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const insets = useSafeAreaInsets();
  const titleRef = useRef(null);
  const descriptionRef = useRef(null);
  const regionRef = useRef(null);
  const cityRef = useRef(null);
  const streetRef = useRef(null);
  const houseRef = useRef(null);
  const postalCodeRef = useRef(null);
  const countryRef = useRef(null);
  const buildingRef = useRef(null);
  const floorRef = useRef(null);
  const entranceRef = useRef(null);
  const apartmentRef = useRef(null);
  const intercomRef = useRef(null);
  const customerNameRef = useRef(null);
  const secondaryPhoneRef = useRef(null);
  const contactEmailRef = useRef(null);
  const contactPrefRef = useRef(null);
  const entranceInfoRef = useRef(null);
  const parkingNotesRef = useRef(null);
  const geoLatRef = useRef(null);
  const geoLngRef = useRef(null);
  const datetimeRef = useRef(null);
  const [price, setPrice] = useState('');
  const [fuelCost, setFuelCost] = useState('');
  const { data: clients = [] } = useClients(
    { companyId, search: '' },
    { enabled: !!companyId && hasPermission('canViewClients') },
  );

  // РјРѕРґР°Р»СЊРЅС‹Рµ СЃРѕСЃС‚РѕСЏРЅРёСЏ (Р±С‹Р»Рё СѓРґР°Р»РµРЅС‹ СЂР°РЅРµРµ вЂ” РІРµСЂРЅСѓС‚СЊ)
  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const hydratedOrderIdRef = useRef(null);
  const snapshotRef = useRef(null);
  const userEditedRef = useRef(false);
  const allowLeaveRef = useRef(false);
  const assignedLabelRequestIdRef = useRef(0);
  const normalizeId = useCallback((value) => {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
  }, []);

  // РёРјСЏ РІС‹Р±СЂР°РЅРЅРѕРіРѕ РёСЃРїРѕР»РЅРёС‚РµР»СЏ (РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРѕ)
  const selectedEmployeeName = useMemo(() => {
    if (selectedEmployee) return selectedEmployee.display_name || selectedEmployee.email || '';
    return assignedEmployeeLabel || T('common_noName');
  }, [selectedEmployee, assignedEmployeeLabel]);
  const selectedClientName = useMemo(() => {
    if (!selectedClientId) return '';
    const client = clients.find((item) => String(item.id) === String(selectedClientId));
    return client?.fullName || '';
  }, [clients, selectedClientId]);

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
    }));
  }, [clients]);

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

  const normalizeRuPhoneForDb = useCallback((input) => {
    const digits = String(input || '').replace(/\D/g, '');
    if (!digits) return null;

    let normalized = digits;
    if (normalized.length === 11 && normalized.startsWith('8')) {
      normalized = `7${normalized.slice(1)}`;
    } else if (normalized.length === 10 && normalized.startsWith('9')) {
      normalized = `7${normalized}`;
    }

    if (normalized.length !== 11) return null;
    if (!normalized.startsWith('7')) return null;
    if (normalized[1] !== '9') return null;
    return `+${normalized}`;
  }, []);

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
  const displayDepartureDate = useMemo(
    () => normalizeDateOrNull(departureDate),
    [departureDate, normalizeDateOrNull],
  );

  const buildSnapshot = useCallback(
    (draft) =>
      JSON.stringify({
        title: String(draft.title || '').trim(),
        description: String(draft.description || '').trim(),
        region: String(draft.region || '').trim(),
        city: String(draft.city || '').trim(),
        street: String(draft.street || '').trim(),
        house: String(draft.house || '').trim(),
        country: String(draft.country || '').trim(),
        postalCode: String(draft.postalCode || '').trim(),
        building: String(draft.building || '').trim(),
        floor: String(draft.floor || '').trim(),
        entrance: String(draft.entrance || '').trim(),
        apartment: String(draft.apartment || '').trim(),
        intercom: String(draft.intercom || '').trim(),
        customerName: String(draft.customerName || '').trim(),
        selectedClientId: draft.selectedClientId || null,
        phone: String(draft.phone || '').replace(/\D/g, ''),
        secondaryPhone: String(draft.secondaryPhone || '').replace(/\D/g, ''),
        contactEmail: String(draft.contactEmail || '').trim(),
        contactPref: String(draft.contactPref || '').trim(),
        entranceInfo: String(draft.entranceInfo || '').trim(),
        parkingNotes: String(draft.parkingNotes || '').trim(),
        geoLat: String(draft.geoLat || '').trim(),
        geoLng: String(draft.geoLng || '').trim(),
        datetime: String(draft.datetime || '').trim(),
        departureDateIso: normalizeDateOrNull(draft.departureDate)?.toISOString() || null,
        assigneeId: draft.assigneeId || null,
        toFeed: !!draft.toFeed,
        urgent: !!draft.urgent,
        departmentId: draft.departmentId || null,
        price: String(draft.price ?? '').trim(),
        fuelCost: String(draft.fuelCost ?? '').trim(),
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
      const nextCity = row.city || '';
      const nextStreet = row.street || '';
      const nextHouse = row.house || '';
      const nextCountry = row.country ?? country ?? '';
      const nextPostalCode = row.postal_code ?? postalCode ?? '';
      const nextBuilding = row.building ?? building ?? '';
      const nextFloor = row.floor ?? floor ?? '';
      const nextEntrance = row.entrance ?? entrance ?? '';
      const nextApartment = row.apartment ?? apartment ?? '';
      const nextIntercom = row.intercom ?? intercom ?? '';
      const nextCustomerName = row.fio || row.customer_name || '';
      const nextClientId = normalizeId(row.client_id);
      const raw = (row.phone || row.customer_phone_visible || '').replace(/\D/g, '');
      const nextSecondaryPhone = String(row.secondary_phone || '').replace(/\D/g, '');
      const nextContactEmail = row.contact_email ?? '';
      const nextContactPref = row.contact_pref ?? '';
      const nextEntranceInfo = row.entrance_info ?? '';
      const nextParkingNotes = row.parking_notes ?? '';
      const nextGeoLat = row.geo_lat ?? '';
      const nextGeoLng = row.geo_lng ?? '';
      const nextDateTime = row.datetime ?? '';
      const nextDepartureDate = normalizeDateOrNull(row.time_window_start);
      const nextAssigneeId = row.assigned_to || null;
      const nextToFeed = !row.assigned_to;
      const nextUrgent = !!row.urgent;
      const nextDepartmentId = row.department_id || null;
      const nextWorkTypeId = normalizeId(row.work_type_id ?? workTypeIdFromParams);
      const nextWorkTypeResolved =
        typeof row.work_type_id !== 'undefined' || workTypeIdFromParams !== null;
      const nextStatus = row.status || (nextToFeed ? T('order_status_in_feed') : T('order_status_new'));
      const nextPrice = row.price !== null && row.price !== undefined ? String(row.price) : '';
      const nextFuelCost =
        row.fuel_cost !== null && row.fuel_cost !== undefined ? String(row.fuel_cost) : '';
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
      setCity(nextCity);
      setStreet(nextStreet);
      setHouse(nextHouse);
      setCountry(nextCountry);
      setPostalCode(nextPostalCode);
      setBuilding(nextBuilding);
      setFloor(nextFloor);
      setEntrance(nextEntrance);
      setApartment(nextApartment);
      setIntercom(nextIntercom);
      setCustomerName(nextCustomerName);
      setSelectedClientId(nextClientId);
      setPhone(raw);
      setSecondaryPhone(nextSecondaryPhone);
      setContactEmail(String(nextContactEmail || ''));
      setContactPref(String(nextContactPref || ''));
      setEntranceInfo(String(nextEntranceInfo || ''));
      setParkingNotes(String(nextParkingNotes || ''));
      setGeoLat(String(nextGeoLat || ''));
      setGeoLng(String(nextGeoLng || ''));
      setDateTimeValue(String(nextDateTime || ''));
      setDepartureDate(nextDepartureDate);
      setAssigneeId(nextAssigneeId);
      setAssignedEmployeeLabel(nextAssignedEmployeeLabel);
      setWorkTypeNameFallback(fallbackName);
      setWorkTypeResolved(nextWorkTypeResolved);

      setToFeed(nextToFeed);
      setUrgent(nextUrgent);
      setDepartmentId(nextDepartmentId);
      setWorkTypeId(nextWorkTypeId);
      setStatusLabel(nextStatus);
      try {
        const found = ORDER_STATUS_KEYS.find((k) => T(`order_status_${k}`) === nextStatus);
        setStatusKey(found || null);
      } catch {
        setStatusKey(null);
      }
      setPrice(nextPrice);
      setFuelCost(nextFuelCost);

      snapshotRef.current = buildSnapshot({
        title: nextTitle,
        description: nextDescription,
        region: nextRegion,
        city: nextCity,
        street: nextStreet,
        house: nextHouse,
        country: nextCountry,
        postalCode: nextPostalCode,
        building: nextBuilding,
        floor: nextFloor,
        entrance: nextEntrance,
        apartment: nextApartment,
        intercom: nextIntercom,
        customerName: nextCustomerName,
        selectedClientId: nextClientId,
        phone: raw,
        secondaryPhone: nextSecondaryPhone,
        contactEmail: nextContactEmail,
        contactPref: nextContactPref,
        entranceInfo: nextEntranceInfo,
        parkingNotes: nextParkingNotes,
        geoLat: nextGeoLat,
        geoLng: nextGeoLng,
        datetime: nextDateTime,
        departureDate: nextDepartureDate,
        assigneeId: nextAssigneeId,
        toFeed: nextToFeed,
        urgent: nextUrgent,
        departmentId: nextDepartmentId,
        price: nextPrice,
        fuelCost: nextFuelCost,
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
          .select('work_type_id, client_id, secondary_phone, contact_email, contact_pref, entrance_info, parking_notes, geo_lat, geo_lng, datetime')
          .eq('id', id)
          .maybeSingle()
          .then(({ data: wtRow }) => {
            if (cancelled || userEditedRef.current || !wtRow) return;
            const resolvedWorkTypeId = normalizeId(wtRow.work_type_id);
            const resolvedClientId = normalizeId(wtRow.client_id) || nextClientId;
            const resolvedSecondaryPhone = String(wtRow.secondary_phone || '').replace(/\D/g, '');
            const resolvedContactEmail = String(wtRow.contact_email || '');
            const resolvedContactPref = String(wtRow.contact_pref || '');
            const resolvedEntranceInfo = String(wtRow.entrance_info || '');
            const resolvedParkingNotes = String(wtRow.parking_notes || '');
            const resolvedGeoLat = String(wtRow.geo_lat || '');
            const resolvedGeoLng = String(wtRow.geo_lng || '');
            const resolvedDateTime = String(wtRow.datetime || '');
            setWorkTypeId(resolvedWorkTypeId);
            setSelectedClientId(resolvedClientId);
            setSecondaryPhone((prev) => prev || resolvedSecondaryPhone);
            setContactEmail((prev) => prev || resolvedContactEmail);
            setContactPref((prev) => prev || resolvedContactPref);
            setEntranceInfo((prev) => prev || resolvedEntranceInfo);
            setParkingNotes((prev) => prev || resolvedParkingNotes);
            setGeoLat((prev) => prev || resolvedGeoLat);
            setGeoLng((prev) => prev || resolvedGeoLng);
            setDateTimeValue((prev) => prev || resolvedDateTime);
            setWorkTypeResolved(true);
            snapshotRef.current = buildSnapshot({
              title: nextTitle,
              description: nextDescription,
              region: nextRegion,
              city: nextCity,
              street: nextStreet,
              house: nextHouse,
              country: nextCountry,
              postalCode: nextPostalCode,
              building: nextBuilding,
              floor: nextFloor,
              entrance: nextEntrance,
              apartment: nextApartment,
              intercom: nextIntercom,
              customerName: nextCustomerName,
              selectedClientId: resolvedClientId,
              phone: raw,
              secondaryPhone: nextSecondaryPhone || resolvedSecondaryPhone,
              contactEmail: nextContactEmail || resolvedContactEmail,
              contactPref: nextContactPref || resolvedContactPref,
              entranceInfo: nextEntranceInfo || resolvedEntranceInfo,
              parkingNotes: nextParkingNotes || resolvedParkingNotes,
              geoLat: nextGeoLat || resolvedGeoLat,
              geoLng: nextGeoLng || resolvedGeoLng,
              datetime: nextDateTime || resolvedDateTime,
              departureDate: nextDepartureDate,
              assigneeId: nextAssigneeId,
              toFeed: nextToFeed,
              urgent: nextUrgent,
              departmentId: nextDepartmentId,
              price: nextPrice,
              fuelCost: nextFuelCost,
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
    building,
    floor,
    entrance,
    apartment,
    intercom,
  ]);

  // РћРїС‚РёРјРёР·РёСЂСѓРµРј РІС‹Р·РѕРІ refreshAssignedLabel вЂ” РЅРµ Р·Р°РїСЂР°С€РёРІР°РµРј, РµСЃР»Рё label СѓР¶Рµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ
  useEffect(() => {
    if (!assigneeId) {
      assignedLabelRequestIdRef.current += 1;
      setAssignedEmployeeLabel('');
      return;
    }
    if (assignedEmployeeLabel) return; // СѓР¶Рµ РµСЃС‚СЊ РёРјСЏ вЂ” РїСЂРѕРїСѓСЃРєР°РµРј Р»РёС€РЅРёР№ Р·Р°РїСЂРѕСЃ
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
      city,
      street,
      house,
      country,
      postalCode,
      building,
      floor,
      entrance,
      apartment,
      intercom,
      customerName,
      selectedClientId,
      phone,
      secondaryPhone,
      contactEmail,
      contactPref,
      entranceInfo,
      parkingNotes,
      geoLat,
      geoLng,
      datetime: dateTimeValue,
      departureDate,
      assigneeId,
      toFeed,
      urgent,
      departmentId,
      price,
      fuelCost,
      workTypeId,
      status: statusLabel,
    });
    return current !== snapshotRef.current;
  }, [
    id,
    title,
    description,
    region,
    city,
    street,
    house,
    country,
    postalCode,
    building,
    floor,
    entrance,
    apartment,
    intercom,
    customerName,
    selectedClientId,
    phone,
    secondaryPhone,
    contactEmail,
    contactPref,
    entranceInfo,
    parkingNotes,
    geoLat,
    geoLng,
    dateTimeValue,
    departureDate,
    assigneeId,
    toFeed,
    urgent,
    departmentId,
    price,
    fuelCost,
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
      }),
    [formStyles],
  );

  const showToast = (msg, type = 'info', options) => {
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
  };

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
      // Р•СЃР»Рё Р±С‹Р» СЃС‚Р°С‚СѓСЃ "Р’ Р»РµРЅС‚Рµ" вЂ” РїСЂРё РЅР°Р·РЅР°С‡РµРЅРёРё РёСЃРїРѕР»РЅРёС‚РµР»СЏ РїРµСЂРµРІРѕРґРёРј РІ "РќРѕРІС‹Р№"
      try {
        if (normalized && statusKey === 'in_feed') {
          setStatusKey('new');
          setStatusLabel(T('order_status_new'));
        }
      } catch {
        // ignore
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
      // ignore
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

  const handleSave = async () => {
    if (permissionsLoading) return;
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
    // РЎРєСЂС‹РІР°РµРј РєР»Р°РІРёР°С‚СѓСЂСѓ Рё СЃРЅРёРјР°РµРј С„РѕРєСѓСЃ СЃ РїРѕР»РµР№ РїРµСЂРµРґ РІР°Р»РёРґР°С†РёРµР№/СЃРѕС…СЂР°РЅРµРЅРёРµРј
    try {
      Keyboard.dismiss();
      // РџРѕРїСЂРѕР±СѓРµРј СЂР°Р·РјС‹С‚СЊ РІСЃРµ РїРѕР»СЏ, РµСЃР»Рё Сѓ РЅРёС… РµСЃС‚СЊ РјРµС‚РѕРґ blur
      [
        titleRef,
        descriptionRef,
        regionRef,
        cityRef,
        streetRef,
        houseRef,
        postalCodeRef,
        countryRef,
        buildingRef,
        floorRef,
        entranceRef,
        apartmentRef,
        intercomRef,
        customerNameRef,
        secondaryPhoneRef,
        contactEmailRef,
        contactPrefRef,
        entranceInfoRef,
        parkingNotesRef,
        geoLatRef,
        geoLngRef,
        datetimeRef,
      ].forEach(
        (r) => {
          try {
            if (r && r.current && typeof r.current.blur === 'function') {
              r.current.blur();
            }
          } catch {
            // ignore
          }
        },
      );
    } catch {
      // ignore
    }

    if (!title.trim()) return showToast(T('order_validation_title_required'), 'error');
    if (!normalizeDateOrNull(departureDate)) {
      return showToast(T('order_validation_date_required'), 'error');
    }
    const rawPhone = (phone || '').replace(/\D/g, '');
    if (rawPhone && !isValidPhone(String(phone || ''))) {
      return showToast(T('order_validation_phone_format'), 'error');
    }
    if (rawPhone && !normalizeRuPhoneForDb(phone)) {
      return showToast(T('order_validation_phone_format'), 'error');
    }
    const parsedPrice = parseDecimalOrNull(price);
    const parsedFuelCost = parseDecimalOrNull(fuelCost);
    if (String(price ?? '').trim() && parsedPrice === null) {
      return showToast(T('order_validation_amount_format'), 'error');
    }
    if (String(fuelCost ?? '').trim() && parsedFuelCost === null) {
      return showToast(T('order_validation_fuel_format'), 'error');
    }
    if (parsedPrice != null && parsedPrice < 0) {
      return showToast(T('order_validation_amount_format'), 'error');
    }
    if (parsedFuelCost != null && parsedFuelCost < 0) {
      return showToast(T('order_validation_fuel_format'), 'error');
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
      if (!normalizedDepartureDate) {
        showToast(T('order_validation_date_required'), 'error');
        return;
      }

      const normalizedPhone = normalizeRuPhoneForDb(phone);
      const parsedPrice = parseDecimalOrNull(price);
      const parsedFuelCost = parseDecimalOrNull(fuelCost);
      if (String(price ?? '').trim() && parsedPrice === null) {
        showToast(T('order_validation_amount_format'), 'error');
        return;
      }
      if (String(fuelCost ?? '').trim() && parsedFuelCost === null) {
        showToast(T('order_validation_fuel_format'), 'error');
        return;
      }
      if (parsedPrice != null && parsedPrice < 0) {
        showToast(T('order_validation_amount_format'), 'error');
        return;
      }
      if (parsedFuelCost != null && parsedFuelCost < 0) {
        showToast(T('order_validation_fuel_format'), 'error');
        return;
      }
      const payload = {
        title,
        comment: description,
        region,
        city,
        street,
        house,
        country,
        postal_code: postalCode,
        building,
        floor,
        entrance,
        apartment,
        intercom,
        fio: customerName,
        client_id: normalizeId(selectedClientId),
        phone: normalizedPhone,
        secondary_phone: normalizeRuPhoneForDb(secondaryPhone),
        contact_email: String(contactEmail || '').trim() || null,
        contact_pref: String(contactPref || '').trim() || null,
        entrance_info: String(entranceInfo || '').trim() || null,
        parking_notes: String(parkingNotes || '').trim() || null,
        geo_lat: String(geoLat || '').trim() || null,
        geo_lng: String(geoLng || '').trim() || null,
        datetime: String(dateTimeValue || '').trim() || null,
        assigned_to: toFeed ? null : assigneeId,
        time_window_start: normalizedDepartureDate.toISOString(),
        urgent,
        department_id: departmentId || null,
        price: parsedPrice,
        fuel_cost: parsedFuelCost,
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
        city,
        street,
        house,
        country,
        postalCode,
        building,
        floor,
        entrance,
        apartment,
        intercom,
        customerName,
        selectedClientId,
        phone,
        secondaryPhone,
        contactEmail,
        contactPref,
        entranceInfo,
        parkingNotes,
        geoLat,
        geoLng,
        datetime: dateTimeValue,
        departureDate,
        assigneeId,
        toFeed,
        urgent,
        departmentId,
        price,
        fuelCost,
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
          'Р—Р°СЏРІРєР° СѓР¶Рµ Р±С‹Р»Р° РёР·РјРµРЅРµРЅР° РЅР° РґСЂСѓРіРѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ. РћС‚РєСЂС‹С‚Р° Р°РєС‚СѓР°Р»СЊРЅР°СЏ РІРµСЂСЃРёСЏ, РїСЂРѕРІРµСЂСЊС‚Рµ РїРѕР»СЏ.',
          'warning',
        );
        await refetchOrder();
      } else {
        showToast(T('order_save_error'), 'error');
      }
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const isScreenReady = !!orderData && formHydrated;

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
            <TextField
              ref={titleRef}
              label={T('order_field_title')}
              placeholder={T('order_placeholder_title')}
              value={title}
              onChangeText={setTitle}
              style={styles.field}
              onFocus={() => focusField(titleRef)}
              required
            />

            <TextField
              ref={descriptionRef}
              label={T('order_field_description')}
              placeholder={T('order_placeholder_description')}
              value={description}
              onChangeText={setDescription}
              multiline
              minLines={3}
              style={styles.field}
              onFocus={() => focusField(descriptionRef)}
            />

            <TextField
              label={T('order_details_executor')}
              value={selectedEmployeeName}
              placeholder={T('order_details_not_assigned')}
              pressable
              style={styles.field}
              onPress={() => setAssigneePickerVisible(true)}
            />

            <TextField
              label={T('orders_filter_status')}
              value={selectedStatusLabel}
              placeholder={T('orders_filter_status')}
              pressable
              style={styles.field}
              onPress={() => setStatusModalVisible(true)}
            />

            {useWorkTypes && (
              <TextField
                label={T('order_field_work_type')}
                value={selectedWorkTypeName}
                placeholder={T('order_details_work_type_not_selected')}
                pressable
                style={styles.field}
                onPress={() => setWorkTypeModalVisible(true)}
              />
            )}
          </Card>

          <SectionHeader bottomSpacing="xs">{T('order_section_finances')}</SectionHeader>
          <Card padded={false} style={styles.card}>
            <TextField
              label={T('order_details_amount')}
              placeholder={T('order_placeholder_amount')}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              style={styles.field}
            />
            <TextField
              label={T('order_details_fuel')}
              placeholder={T('order_placeholder_amount')}
              value={fuelCost}
              onChangeText={setFuelCost}
              keyboardType="decimal-pad"
              style={styles.field}
            />
          </Card>

          <SectionHeader bottomSpacing="xs">{T('order_section_address')}</SectionHeader>
          <Card padded={false} style={styles.card}>
            <TextField
              ref={regionRef}
              label={T('order_field_region')}
              value={region}
              onChangeText={setRegion}
              style={styles.field}
              onFocus={() => focusField(regionRef)}
            />
            <TextField
              ref={cityRef}
              label={T('order_field_city')}
              value={city}
              onChangeText={setCity}
              style={styles.field}
              onFocus={() => focusField(cityRef)}
            />
            <TextField
              ref={streetRef}
              label={T('order_field_street')}
              value={street}
              onChangeText={setStreet}
              style={styles.field}
              onFocus={() => focusField(streetRef)}
            />
            <TextField
              ref={houseRef}
              label={T('order_field_house')}
              value={house}
              onChangeText={setHouse}
              style={styles.field}
              onFocus={() => focusField(houseRef)}
            />
            <TextField
              ref={countryRef}
              label={T('order_field_country')}
              value={country}
              onChangeText={setCountry}
              style={styles.field}
              onFocus={() => focusField(countryRef)}
            />
            <TextField
              ref={postalCodeRef}
              label={T('order_field_postal_code')}
              value={postalCode}
              onChangeText={setPostalCode}
              style={styles.field}
              onFocus={() => focusField(postalCodeRef)}
            />
            <TextField
              ref={buildingRef}
              label={T('order_field_building')}
              value={building}
              onChangeText={setBuilding}
              style={styles.field}
              onFocus={() => focusField(buildingRef)}
            />
            <TextField
              ref={floorRef}
              label={T('order_field_floor')}
              value={floor}
              onChangeText={setFloor}
              style={styles.field}
              onFocus={() => focusField(floorRef)}
            />
            <TextField
              ref={entranceRef}
              label={T('order_field_entrance')}
              value={entrance}
              onChangeText={setEntrance}
              style={styles.field}
              onFocus={() => focusField(entranceRef)}
            />
            <TextField
              ref={apartmentRef}
              label={T('order_field_apartment')}
              value={apartment}
              onChangeText={setApartment}
              style={styles.field}
              onFocus={() => focusField(apartmentRef)}
            />
            <TextField
              ref={intercomRef}
              label={T('order_field_intercom')}
              value={intercom}
              onChangeText={setIntercom}
              style={styles.field}
              onFocus={() => focusField(intercomRef)}
            />
            <TextField
              ref={parkingNotesRef}
              label={T('order_field_parking_notes')}
              value={parkingNotes}
              onChangeText={setParkingNotes}
              style={styles.field}
              onFocus={() => focusField(parkingNotesRef)}
            />
            <TextField
              ref={geoLatRef}
              label={T('order_field_geo_lat')}
              value={geoLat}
              onChangeText={setGeoLat}
              keyboardType="decimal-pad"
              style={styles.field}
              onFocus={() => focusField(geoLatRef)}
            />
            <TextField
              ref={geoLngRef}
              label={T('order_field_geo_lng')}
              value={geoLng}
              onChangeText={setGeoLng}
              keyboardType="decimal-pad"
              style={styles.field}
              onFocus={() => focusField(geoLngRef)}
            />
          </Card>

          <SectionHeader bottomSpacing="xs">{T('order_section_customer')}</SectionHeader>
          <Card padded={false} style={styles.card}>
            {hasPermission('canViewClients') ? (
              <TextField
                label={T('routes_clients_client')}
                value={selectedClientName || T('common_select')}
                pressable
                style={styles.field}
                onPress={() => setClientModalVisible(true)}
              />
            ) : null}
            <TextField
              ref={customerNameRef}
              label={T('order_field_customer_name')}
              value={customerName}
              onChangeText={setCustomerName}
              style={styles.field}
              onFocus={() => focusField(customerNameRef)}
            />
            <PhoneInput value={phone} onChangeText={setPhone} style={styles.field} />
            <PhoneInput
              ref={secondaryPhoneRef}
              label={T('order_field_secondary_phone')}
              value={secondaryPhone}
              onChangeText={setSecondaryPhone}
              style={styles.field}
            />
            <TextField
              ref={contactEmailRef}
              label={T('order_field_contact_email')}
              value={contactEmail}
              onChangeText={setContactEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.field}
              onFocus={() => focusField(contactEmailRef)}
            />
            <TextField
              ref={contactPrefRef}
              label={T('order_field_contact_pref')}
              value={contactPref}
              onChangeText={setContactPref}
              style={styles.field}
              onFocus={() => focusField(contactPrefRef)}
            />
            <TextField
              ref={entranceInfoRef}
              label={T('order_field_entrance_info')}
              value={entranceInfo}
              onChangeText={setEntranceInfo}
              style={styles.field}
              onFocus={() => focusField(entranceInfoRef)}
            />
          </Card>

          <SectionHeader bottomSpacing="xs">
            {T('company_settings_sections_departure_helperText_departureOn')}
          </SectionHeader>
          <Card padded={false} style={styles.card}>
            <TextField
              label={T('order_field_departure_date')}
              value={
                displayDepartureDate
                  ? format(displayDepartureDate, 'd MMMM yyyy', { locale: ru })
                  : T('order_placeholder_departure_date')
              }
              pressable
              style={styles.field}
              onPress={() => setShowDateModal(true)}
            />

            {useDepartureTime && (
              <>
                <TextField
                  label={T('order_field_departure_time')}
                  value={
                    displayDepartureDate
                      ? format(displayDepartureDate, 'HH:mm', { locale: ru })
                      : T('order_placeholder_departure_time')
                  }
                  pressable
                  style={styles.field}
                  onPress={() => {
                    if (!displayDepartureDate) {
                      setShowDateModal(true);
                      return;
                    }
                    setShowTimeModal(true);
                  }}
                />
              </>
            )}
            <TextField
              ref={datetimeRef}
              label={T('order_field_datetime')}
              value={dateTimeValue}
              onChangeText={setDateTimeValue}
              style={styles.field}
              onFocus={() => focusField(datetimeRef)}
            />
          </Card>

          <View style={{ height: theme.spacing?.xxl ?? BOTTOM_SPACER_FALLBACK }} />
      </EditScreenTemplate>

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
            // РµСЃР»Рё РІС‹Р±СЂР°РЅР° Р»РµРЅС‚Р° вЂ” СЃРЅРёРјР°РµРј РёСЃРїРѕР»РЅРёС‚РµР»СЏ
            if (item?.id === 'in_feed') {
              setAssigneeId(null);
              setToFeed(true);
            } else {
              setToFeed(false);
            }
          } catch {
            // ignore
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
        selectedId={selectedClientId}
        onSelect={(item) => {
          if (item?.disabled) return;
          setSelectedClientId(item?.id || null);
          setClientModalVisible(false);
        }}
        onClose={() => setClientModalVisible(false)}
      />

      <DateTimeModal
        visible={showDateModal}
        mode="date"
        initial={departureDate}
        allowFutureDates={true}
        onApply={(date) => {
          setDepartureDate(date);
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

