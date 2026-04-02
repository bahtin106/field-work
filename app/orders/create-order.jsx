// app/orders/create-order.jsx
// Order creation screen using shared components/styles

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  findNodeHandle,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import EditScreenTemplate, { useEditFormStyles } from '../../components/layout/EditScreenTemplate';
import ClientObjectEditorModal from '../../components/objects/ClientObjectEditorModal';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import ClearButton from '../../components/ui/ClearButton';
import SectionHeader from '../../components/ui/SectionHeader';
import { listItemStyles } from '../../components/ui/listItemStyles';
import TextField from '../../components/ui/TextField';
import PhoneInput from '../../components/ui/PhoneInput';
import { ConfirmModal, DateTimeModal, SelectModal } from '../../components/ui/modals';
import QuickPreviewModal from '../../components/ui/modals/QuickPreviewModal';
import { useFeedback, ScreenBanner, FieldErrorText, normalizeError, FEEDBACK_CODES, getMessageByCode } from '../../src/shared/feedback';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useDepartments as useDepartmentsHook } from '../../components/hooks/useDepartments';
import { usePermissions } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../lib/workTypes';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getOrderedEntityFields,
  toLegacySchemaFields,
} from '../../src/features/fieldSettings/catalog';
import { useEntityFieldSettings } from '../../src/features/fieldSettings/queries';
import { getLocale } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';
import { getRequiredFieldLabel } from '../../src/shared/forms/fieldValidation';
import { useTheme } from '../../theme/ThemeProvider';
import DeferredScreen from '../../src/shared/perf/DeferredScreen';
import { withAlpha } from '../../theme/colors';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { useSubscriptionGuard } from '../../hooks/useSubscriptionGuard';
import { useClient, useClients, useUpdateClientMutation } from '../../src/features/clients/queries';
import {
  buildAdditionalPhoneDisplayLabel,
  CLIENT_ADDITIONAL_PHONE_SLOT_IDS,
  collectClientPhoneSearchValues,
  getClientAdditionalPhones,
} from '../../src/features/clients/additionalPhones';
import {
  useCreateClientObjectMutation,
  useClientObjects,
  useSearchCompanyObjectsForOrder,
  useUpdateClientObjectMutation,
} from '../../src/features/objects/queries';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';
import { parseClientPrefillFromSearch } from '../../src/features/clients/prefillFromSearch';
import { buildSearchIndex, matchesSearch } from '../../src/shared/search/matching';
import {
  hasMobilePhoneValue,
  isValidOptionalMobilePhone,
  toE164MobilePhoneOrNull,
} from '../../src/shared/validation/phone';
import {
  getRequiredTextFieldError,
} from '../../src/shared/validation/fields';
import { formatRuMask } from '../../components/ui/phone';
import {
  CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS,
  CLIENT_OBJECT_ADDRESS_FIELDS,
  CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS,
  createEmptyClientObjectDraft,
  hasClientObjectMapPoint,
  normalizeClientObjectLocationMode,
  normalizeCoordinateValue,
  sanitizeClientObjectPayload,
} from '../../src/features/objects/addressing';
import {
  buildObjectAdditionalPhonesPatch,
  getObjectAdditionalPhones,
  OBJECT_ADDITIONAL_PHONE_SLOT_IDS,
  getVisibleAdditionalObjectPhoneSlotIds,
  resolveVisibleAdditionalObjectPhoneSlotIds,
} from '../../src/features/objects/additionalPhones';
import {
  buildOrderAddressDisplay,
  buildOrderAddressShort,
  extractOrderAddressFromObject,
  filterOrderAddressByObjectFieldSettings,
  toOrderAddressPatch,
} from '../../src/features/requests/addressing';
import {
  findBestMatchingClientObject,
  findExactMatchingClientObject,
} from '../../src/features/objects/matching';
import { buildAutoRequestTitle, resolveRequestTitle } from '../../src/features/requests/title';
import { buildAssigneeSelectItems } from '../../src/features/requests/assigneeSelect';

const DEFAULT_FIELDS = [
  { field_key: 'title', label: null, type: 'text', position: 10, required: true },
  { field_key: 'phone', label: null, type: 'phone', position: 30 },
];

const REMOVED_ORDER_ADDRESS_FIELDS = new Set([
  'fio',
  'customer_name',
  'region',
  'district',
  'city',
  'street',
  'house',
  'country',
  'postal_code',
  'floor',
  'entrance',
  'apartment',
  'comment',
  'geo_lat',
  'geo_lng',
]);

const SCROLL_ANIMATION_DELAY = 200;
const ORDER_CLIENT_FLOW_STORAGE_PREFIX = 'order_client_flow:';
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

function hasMojibake(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value.includes('�') || value.includes('вЂ')) return true;
  const suspiciousChunks = value.match(/(?:Р\S|С\S|Ð\S|Ñ\S|Ã\S)/g) || [];
  const rsPairs = value.match(/[РС]\S/g) || [];
  const compactLength = value.replace(/\s+/g, '').length;
  if (suspiciousChunks.length >= 4 && suspiciousChunks.length >= Math.floor(compactLength * 0.2)) return true;
  return rsPairs.length >= 5 && rsPairs.length >= Math.floor(compactLength * 0.24);
}

function sanitizeVisibleText(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return String(fallback || '').trim();
  return hasMojibake(text) ? String(fallback || '').trim() : text;
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
  const date = input instanceof Date ? input : parseTimeStringToDate(input);
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

function CreateOrderContent() {
  const { has, loading } = usePermissions();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { profile, user } = useAuthContext();
  const authAccountType = String(user?.user_metadata?.account_type || '').toLowerCase();
  const isSoloAdmin =
    String(profile?.role || '').toLowerCase() === 'admin' && authAccountType === 'solo';
  const soloAdminUserId = String(profile?.id || user?.id || '').trim() || null;
  const subscriptionGuard = useSubscriptionGuard(profile?.company_id || null);
  const { settings: companySettings } = useCompanySettings();
  const formStyles = useEditFormStyles();
  const { banner, showBanner, clearBanner } = useFeedback();

  const styles = useMemo(() => createStyles(theme), [theme]);
  const base = useMemo(() => listItemStyles(theme), [theme]);

  const scrollRef = useRef(null);
  const dateFieldRef = useRef(null);
  const timeFieldRef = useRef(null);
  const fieldRefs = useRef({});

  const [schema, setSchema] = useState({ context: 'create', fields: [] });
  const [form, setForm] = useState({});
  const [description, setDescription] = useState('');
  const [departureDate, setDepartureDate] = useState(null);
  const [departureTime, setDepartureTime] = useState(null);
  const [departureEndDate, setDepartureEndDate] = useState(null);
  const [isDepartureRange, setIsDepartureRange] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [assigneeId, setAssigneeId] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [selectedClientObjectId, setSelectedClientObjectId] = useState(null);
  const [withoutAddressSelected, setWithoutAddressSelected] = useState(false);
  const [stagedSelectedObjectDraft, setStagedSelectedObjectDraft] = useState(null);
  const [draftClientObject, setDraftClientObject] = useState(null);
  const [clientObjectModalVisible, setClientObjectModalVisible] = useState(false);
  const [clientObjectEditorVisible, setClientObjectEditorVisible] = useState(false);
  const [clientObjectDraft, setClientObjectDraft] = useState(createEmptyClientObjectDraft());
  const [clientObjectFieldErrors, setClientObjectFieldErrors] = useState({});
  const [clientObjectEditorMode, setClientObjectEditorMode] = useState('draft');
  const [objectEditPermissionModalVisible, setObjectEditPermissionModalVisible] = useState(false);
  const [objectEditPermissionSeedDraft, setObjectEditPermissionSeedDraft] = useState(null);
  const [pendingSuggestedObjectSelection, setPendingSuggestedObjectSelection] = useState(null);
  const [debouncedObjectSearchParams, setDebouncedObjectSearchParams] = useState({
    query: '',
    street: '',
    house: '',
    city: '',
    clientId: null,
  });
  const [suggestedMatchingObject, setSuggestedMatchingObject] = useState(null);
  const [suggestedMatchingVisible, setSuggestedMatchingVisible] = useState(false);
  const [ignoredMatchSignature, setIgnoredMatchSignature] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [users, setUsers] = useState([]);
  const [toFeed, setToFeed] = useState(false);
  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  const [workTypeId, setWorkTypeId] = useState(null);

  const [cancelVisible, setCancelVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  const [assigneeModalVisible, setAssigneeModalVisible] = useState(false);
  const [clientModalVisible, setClientModalVisible] = useState(false);
  const [clientModalSearch, setClientModalSearch] = useState('');
  const [previewClient, setPreviewClient] = useState(null);
  const [previewClientVisible, setPreviewClientVisible] = useState(false);
  const [previewObject, setPreviewObject] = useState(null);
  const [previewObjectVisible, setPreviewObjectVisible] = useState(false);
  const [previewAnchor, setPreviewAnchor] = useState({ x: 0, y: 0 });
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);
  const [phoneSourceModalVisible, setPhoneSourceModalVisible] = useState(false);
  const [phoneSourceId, setPhoneSourceId] = useState(PHONE_SOURCE_IDS.MANUAL);
  const [draftRestoreVisible, setDraftRestoreVisible] = useState(false);
  const [savedDraft, setSavedDraft] = useState(null);
  const { data: companyId } = useMyCompanyIdQuery();
  const { departments } = useDepartmentsHook({
    companyId,
    enabled: !!companyId,
    onlyEnabled: true,
  });
  const { data: orderFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER, {
    enabled: has('canCreateOrders'),
  });
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: has('canCreateOrders'),
  });
  const { data: clients = [] } = useClients(
    { companyId, search: '' },
    { enabled: !!companyId },
  );
  const { data: selectedClient, refetch: refetchSelectedClient } = useClient(selectedClientId, {
    enabled: !!selectedClientId,
  });
  const updateClientMutation = useUpdateClientMutation();
  const createClientObjectMutation = useCreateClientObjectMutation();
  const updateClientObjectMutation = useUpdateClientObjectMutation();
  const { data: clientObjectsByApi = [] } = useClientObjects(selectedClientId, { enabled: !!selectedClientId });
  const {
    data: companyObjectSearchResults = [],
    isFetching: companyObjectSearchLoading,
  } = useSearchCompanyObjectsForOrder(debouncedObjectSearchParams, {
    enabled: clientObjectEditorVisible && clientObjectEditorMode !== 'update',
  });
  const globalDraftSearchParams = useMemo(() => {
    const street = String(draftClientObject?.street || '').trim();
    const house = String(draftClientObject?.house || '').trim();
    const city = String(draftClientObject?.city || '').trim();
    const entrance = String(draftClientObject?.entrance || '').trim();
    const apartment = String(draftClientObject?.apartment || '').trim();
    return {
      query: [city, street, house, apartment, entrance].filter(Boolean).join(' ').trim(),
      street,
      house,
      city,
      clientId: null,
    };
  }, [draftClientObject]);
  const { data: globalDraftObjectSearchResults = [] } = useSearchCompanyObjectsForOrder(
    globalDraftSearchParams,
    {
      enabled: !!draftClientObject && !selectedClientId,
    },
  );

  const intentionalExitRef = useRef(false);
  const autoTitleRef = useRef('');
  const clientFlowKeyRef = useRef(
    `create-order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  if (!autoTitleRef.current) {
    autoTitleRef.current = buildAutoRequestTitle(new Date(), {
      prefix: t('order_auto_title_prefix', 'Заявка от'),
    });
  }
  const titlePreviewValue = useMemo(
    () =>
      String(form.title || '').trim()
        ? String(form.title || '')
        : autoTitleRef.current,
    [form.title],
  );
  const resolveTitleForSave = useCallback(
    (value, fallbackDate = null) =>
      resolveRequestTitle(value, {
        fallbackDate,
        prefix: t('order_auto_title_prefix', 'Заявка от'),
      }),
    [t],
  );

  const setField = useCallback((key, val) => setForm((s) => ({ ...s, [key]: val })), []);
  const effectiveAssigneeId = isSoloAdmin ? soloAdminUserId : assigneeId;
  const effectiveToFeed = isSoloAdmin ? false : toFeed;
  const orderFieldSettings = useMemo(
    () => orderFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.ORDER),
    [orderFieldSettingsData],
  );
  const objectFieldSettings = useMemo(
    () => objectFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [objectFieldSettingsData],
  );
  const orderedMainFieldKeys = useMemo(
    () =>
      getOrderedEntityFields(orderFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['title', 'comment', 'work_type_id'],
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
  const orderedPlanningFieldKeys = useMemo(
    () => {
      const priority = {
        urgent: 0,
        time_window_start: 1,
        departure_time: 2,
        assigned_to: 3,
      };
      return getOrderedEntityFields(orderFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['urgent', 'time_window_start', 'departure_time', 'assigned_to'],
      })
        .map((field) => field.fieldKey)
        .filter((fieldKey) => !(isSoloAdmin && fieldKey === 'assigned_to'))
        .sort((left, right) => {
          const leftWeight = Number.isFinite(priority[left]) ? priority[left] : Number.MAX_SAFE_INTEGER;
          const rightWeight = Number.isFinite(priority[right]) ? priority[right] : Number.MAX_SAFE_INTEGER;
          return leftWeight - rightWeight;
        });
    },
    [isSoloAdmin, orderFieldSettings],
  );
  const objectFieldsByKey = useMemo(() => new Map((objectFieldSettings?.fields || []).map((field) => [String(field.fieldKey || field.field_key || ''), field])), [objectFieldSettings]);
  const getVisibleObjectAddressDraft = useCallback(
    (source) =>
      filterOrderAddressByObjectFieldSettings(
        extractOrderAddressFromObject(source),
        objectFieldsByKey,
      ),
    [objectFieldsByKey],
  );

  const DRAFT_KEY = 'draft_create_order';

  // � � � Ћ� � С•� ЎвЂ¦� Ў� ‚� � В°� � � …� � С‘� ЎвЂљ� Ў� Љ � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С”
  const saveDraft = useCallback(async () => {
    try {
      const draft = {
        form,
        description,
        departureDate: departureDate?.toISOString(),
        departureTime: formatTimeForStorage(departureTime),
        departureEndDate: departureEndDate?.toISOString(),
        isDepartureRange,
        workTypeId,
        assigneeId,
        selectedClientId,
        selectedClientObjectId,
        withoutAddressSelected,
        stagedSelectedObjectDraft,
        draftClientObject,
        phoneSourceId,
        urgent,
        toFeed,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
      console.warn('[CreateOrder] Save draft failed:', e);
    }
  }, [
    form,
    description,
    departureDate,
    departureTime,
    departureEndDate,
    isDepartureRange,
    workTypeId,
    assigneeId,
    selectedClientId,
    selectedClientObjectId,
    withoutAddressSelected,
    stagedSelectedObjectDraft,
    draftClientObject,
    phoneSourceId,
    urgent,
    toFeed,
  ]);

  // � � вЂ”� � В°� � С–� Ў� ‚� ЎС“� � В·� � С‘� ЎвЂљ� Ў� Љ � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С”
  const loadDraft = useCallback(async () => {
    try {
      const json = await AsyncStorage.getItem(DRAFT_KEY);
      if (!json) return null;
      const draft = JSON.parse(json);
      return draft;
    } catch (e) {
      console.warn('[CreateOrder] Load draft failed:', e);
      return null;
    }
  }, []);

  // � � � €� � Т‘� � В°� � В»� � С‘� ЎвЂљ� Ў� Љ � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С”
  const deleteDraft = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      console.warn('[CreateOrder] Delete draft failed:', e);
    }
  }, []);

  // � � вЂ™� � С•� Ў� ѓ� Ў� ѓ� ЎвЂљ� � В°� � � …� � С•� � � � � � С‘� ЎвЂљ� Ў� Љ � � Т‘� � В°� � � …� � � …� ЎвЂ№� � Вµ � � С‘� � В· � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С”� � В°
  const restoreDraft = useCallback((draft) => {
    if (!draft) return;
    const draftForm = draft.form || {};
    setForm({ ...draftForm });
    setDescription(draft.description || '');
    const restoredDepartureDate = draft.departureDate ? new Date(draft.departureDate) : null;
    setDepartureDate(restoredDepartureDate);
    setDepartureTime(parseTimeStringToDate(draft.departureTime));
    setDepartureEndDate(draft.departureEndDate ? new Date(draft.departureEndDate) : null);
    setIsDepartureRange(!!draft.isDepartureRange);
    setWorkTypeId(draft.workTypeId || null);
    setAssigneeId(isSoloAdmin ? (soloAdminUserId || null) : draft.assigneeId || null);
    setSelectedClientId(draft.selectedClientId || null);
    setSelectedClientObjectId(draft.selectedClientObjectId || null);
    setWithoutAddressSelected(!!draft.withoutAddressSelected);
    setStagedSelectedObjectDraft(draft.stagedSelectedObjectDraft || null);
    setDraftClientObject(draft.draftClientObject || null);
    setPhoneSourceId(normalizePhoneSourceId(draft.phoneSourceId));
    setUrgent(draft.urgent || false);
    setToFeed(isSoloAdmin ? false : draft.toFeed || false);
  }, [isSoloAdmin, soloAdminUserId]);

  useEffect(() => {
    if (!isSoloAdmin) return;
    if (!soloAdminUserId) return;
    setAssigneeId((prev) => (String(prev || '') === String(soloAdminUserId) ? prev : soloAdminUserId));
    setToFeed(false);
  }, [isSoloAdmin, soloAdminUserId]);

  const withRequiredLabel = useCallback(
    (label, required) => getRequiredFieldLabel(label, required),
    [],
  );

  useEffect(() => {
    clearBanner();
  }, [clearBanner]);

  const shouldShowError = useCallback(
    (field) => submittedAttempt || !!touched[field],
    [submittedAttempt, touched],
  );
  const clearFieldError = useCallback((field) => {
    setFieldErrors((prev) => {
      if (!prev?.[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);
  const requiredMsg = useMemo(
    () => getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t),
    [t],
  );

  // � � Сџ� Ў� ‚� � С•� � � � � � Вµ� Ў� ‚� Ў� Џ� � Вµ� � С � � Вµ� Ў� ѓ� ЎвЂљ� Ў� Љ � � В»� � С‘ � � � …� � Вµ� � С—� ЎС“� Ў� ѓ� ЎвЂљ� ЎвЂ№� � Вµ � � Т‘� � В°� � � …� � � …� ЎвЂ№� � Вµ � � � �  � ЎвЂћ� � С•� Ў� ‚� � С� � Вµ
  const hasChanges = useCallback(() => {
    const hasAssignmentChanges = isSoloAdmin ? false : (!!assigneeId || !!toFeed);
    return (
      !!(form.title?.trim()) ||
      !!(form.phone?.trim()) ||
      !!description?.trim() ||
      !!departureDate ||
      !!departureTime ||
      !!departureEndDate ||
      !!isDepartureRange ||
      !!workTypeId ||
      hasAssignmentChanges ||
      !!selectedClientId ||
      !!selectedClientObjectId ||
      !!withoutAddressSelected ||
      !!stagedSelectedObjectDraft ||
      !!draftClientObject ||
      phoneSourceId !== PHONE_SOURCE_IDS.MANUAL ||
      !!urgent
    );
  }, [
    form,
    description,
    departureDate,
    departureTime,
    departureEndDate,
    isDepartureRange,
    workTypeId,
    assigneeId,
    selectedClientId,
    selectedClientObjectId,
    withoutAddressSelected,
    stagedSelectedObjectDraft,
    draftClientObject,
    phoneSourceId,
    urgent,
    isSoloAdmin,
    toFeed,
  ]);

  const handleCancelPress = useCallback(() => {
    // � � Сџ� � С•� � С”� � В°� � В·� ЎвЂ№� � � � � � В°� � Вµ� � С � � С� � С•� � Т‘� � В°� � В»� � С”� ЎС“ � ЎвЂљ� � С•� � В»� Ў� Љ� � С”� � С• � � Вµ� Ў� ѓ� � В»� � С‘ � � Вµ� Ў� ѓ� ЎвЂљ� Ў� Љ � � С‘� � В·� � С� � Вµ� � � …� � Вµ� � � …� � С‘� Ў� Џ
    if (hasChanges()) {
      setCancelVisible(true);
    } else {
      intentionalExitRef.current = true; // � � � ‡� � � � � � � …� ЎвЂ№� � в„– � � � � � ЎвЂ№� ЎвЂ¦� � С•� � Т‘ - � � � …� � Вµ � Ў� ѓ� � С•� ЎвЂ¦� Ў� ‚� � В°� � � …� Ў� Џ� � Вµ� � С � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С”
      router.back();
    }
  }, [hasChanges]);

  const confirmCancel = useCallback(() => {
    intentionalExitRef.current = true; // � � � ‡� � � � � � � …� ЎвЂ№� � в„– � � � � � ЎвЂ№� ЎвЂ¦� � С•� � Т‘ - � � � …� � Вµ � Ў� ѓ� � С•� ЎвЂ¦� Ў� ‚� � В°� � � …� Ў� Џ� � Вµ� � С � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С”
    setCancelVisible(false);
    router.back();
  }, []);

  const scrollToHandle = useCallback((targetRef) => {
    if (!scrollRef.current || !targetRef.current) return;
    const targetHandle = findNodeHandle(targetRef.current);
    const scrollHandle = findNodeHandle(scrollRef.current);
    if (!targetHandle || !scrollHandle) return;
    UIManager.measureLayout(
      targetHandle,
      scrollHandle,
      () => {},
      (_x, y) => {
        scrollRef.current.scrollTo({ y, animated: true });
      },
    );
  }, []);

  const focusField = useCallback(
    (key) => {
      const ref = fieldRefs.current[key];
      if (ref && typeof ref.focus === 'function') {
        ref.focus();
      }
      if (ref) {
        scrollToHandle({ current: ref });
        return;
      }
      if (key === 'time_window_start') {
        scrollToHandle(dateFieldRef);
      } else if (key === 'departure_time') {
        scrollToHandle(timeFieldRef);
      } else if (key === 'assigned_to') {
        scrollToHandle(dateFieldRef);
      }
    },
    [scrollToHandle],
  );

  const normalizePhone = useCallback((val) => toE164MobilePhoneOrNull(val), []);
  const hasDepartureTimeValue = useCallback(
    (value) => {
      const parsed = value instanceof Date ? value : parseTimeStringToDate(value);
      return !!parsed && !Number.isNaN(parsed?.getTime?.());
    },
    [],
  );

  const getField = useCallback(
    (key) => (schema.fields || []).find((f) => f.field_key === key) || null,
    [schema],
  );
  const isFieldRequired = useCallback((key) => getField(key)?.required === true, [getField]);

  const getFieldLabel = useCallback(
    (fieldKey, fallback) => {
      const field = getField(fieldKey);
      const labelMap = {
        title: t('order_field_title'),
        fio: t('order_field_customer_name'),
        phone: t('order_details_phone'),
        region: t('order_field_region'),
        district: t('order_field_district'),
        city: t('order_field_city'),
        street: t('order_field_street'),
        house: t('order_field_house'),
        country: t('order_field_country'),
        postal_code: t('order_field_postal_code'),
        floor: t('order_field_floor'),
        entrance: t('order_field_entrance'),
        apartment: t('order_field_apartment'),
        comment: t('order_field_comment'),
        time_window_start: t('create_order_label_date'),
        departure_time: t('order_field_departure_time'),
        assigned_to: t('create_order_label_executor'),
      };
      const fallbackLabel = labelMap[fieldKey] || fallback || fieldKey;
      const fieldLabel = sanitizeVisibleText(field?.label, '');
      if (fieldLabel) return fieldLabel;

      return fallbackLabel;
    },
    [getField, t],
  );

  const validateRequiredFields = useCallback(() => {
    try {
      const requiredFields = (schema?.fields || []).filter((f) => f?.required);
      if (!requiredFields.length) return { ok: true };

      const missing = [];
      const missingKeys = [];
      for (const f of requiredFields) {
        const k = f.field_key;
        const v = form[k];

        if (k === 'phone') {
          const normalized = normalizePhone(form.phone);
          if (!normalized) {
            missing.push(getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'time_window_start') {
          if (!departureDate) {
            missing.push(getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'departure_time') {
          if (!hasDepartureTimeValue(departureTime)) {
            missing.push(getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'assigned_to') {
          if (!toFeed && !assigneeId) {
            missing.push(getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'client_id') {
          if (!selectedClientId) {
            missing.push(getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'object_id') {
          if (!selectedClientObjectId && !draftClientObject && !withoutAddressSelected) {
            missing.push(getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'work_type_id') {
          if (useWorkTypes && !workTypeId) {
            missing.push(getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'comment') {
          if (!String(description || '').trim()) {
            missing.push(getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'title') {
          if (!resolveTitleForSave(v, departureDate)) {
            missing.push(getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (v === null || v === undefined || String(v).trim() === '') {
          missing.push(getFieldLabel(k));
          missingKeys.push(k);
        }
      }

      if (missing.length) {
        return {
          ok: false,
          msg: t('order_validation_fill_required').replace('{fields}', missing.join(', ')),
          missingKeys,
        };
      }

      return { ok: true };
    } catch {
      return { ok: true };
    }
  }, [schema, form, departureDate, departureTime, toFeed, assigneeId, normalizePhone, getFieldLabel, t, selectedClientId, selectedClientObjectId, withoutAddressSelected, draftClientObject, useWorkTypes, workTypeId, description, hasDepartureTimeValue, resolveTitleForSave]);

  const promptNewObjectCreation = useCallback(
    (seedDraft = null) => {
      const nextDraft = seedDraft
        ? {
            ...createEmptyClientObjectDraft({ name: t('objects_new') }),
            ...sanitizeClientObjectPayload(seedDraft),
            geo_lat: normalizeCoordinateValue(seedDraft?.geo_lat) || '',
            geo_lng: normalizeCoordinateValue(seedDraft?.geo_lng) || '',
            location_mode: normalizeClientObjectLocationMode(seedDraft?.location_mode, {
              fallback: hasClientObjectMapPoint(seedDraft) ? 'map' : 'address',
            }),
          }
        : draftClientObject || createEmptyClientObjectDraft({ name: t('objects_new') });
      setObjectEditPermissionSeedDraft(nextDraft);
      setObjectEditPermissionModalVisible(true);
    },
    [draftClientObject, t],
  );

  const keepCurrentObjectWithoutChanges = useCallback(() => {
    setObjectEditPermissionModalVisible(false);
    setObjectEditPermissionSeedDraft(null);
    setStagedSelectedObjectDraft(null);
  }, []);

  const startNewObjectCreationFromPrompt = useCallback(() => {
    const nextDraft =
      objectEditPermissionSeedDraft ||
      draftClientObject ||
      createEmptyClientObjectDraft({ name: t('objects_new') });
    setObjectEditPermissionModalVisible(false);
    setObjectEditPermissionSeedDraft(null);
    setStagedSelectedObjectDraft(null);
    setClientObjectModalVisible(false);
    setClientObjectEditorMode('draft');
    setClientObjectDraft(nextDraft);
    setClientObjectEditorVisible(true);
  }, [draftClientObject, objectEditPermissionSeedDraft, t]);

  const handleSubmit = useCallback(async () => {
    if (!subscriptionGuard.canEdit) {
      showBanner({
        type: 'warning',
        message: t('subscription_create_unavailable_toast', 'Создание заявки недоступно'),
      });
      return;
    }

    setSubmittedAttempt(true);
    clearBanner();
    setFieldErrors({});

    const reqCheck = validateRequiredFields();
    if (!reqCheck.ok) {
      const nextErrors = {};
      (reqCheck.missingKeys || []).forEach((k) => {
        nextErrors[k] = { message: requiredMsg };
      });
      setFieldErrors(nextErrors);
      if (reqCheck.missingKeys?.length) focusField(reqCheck.missingKeys[0]);
      return;
    }

    const title = resolveTitleForSave(form.title, departureDate);
    const nextErrors = {};
    if (isFieldRequired('work_type_id') && useWorkTypes && !workTypeId) {
      nextErrors.work_type_id = { message: t('order_validation_work_type_required') };
    }
    if (isFieldRequired('time_window_start') && !departureDate) {
      nextErrors.time_window_start = { message: t('order_validation_date_required') };
    }
    if (isFieldRequired('departure_time') && !hasDepartureTimeValue(departureTime)) {
      nextErrors.departure_time = { message: t('order_validation_departure_time_required', 'Укажите время выезда') };
    }
    if (isDepartureRange && (!departureEndDate || departureEndDate < departureDate)) {
      nextErrors.time_window_start = { message: t('order_validation_date_range_invalid') };
    }
    if (isFieldRequired('assigned_to') && !effectiveToFeed && !effectiveAssigneeId) {
      nextErrors.assigned_to = { message: t('order_validation_executor_required') };
    }
    if (Object.keys(nextErrors).length) {
      setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
      focusField(Object.keys(nextErrors)[0]);
      return;
    }

    const phoneField = getField('phone');
    let phoneFormatted = null;
    if (phoneField) {
      phoneFormatted = normalizePhone(form.phone);
      if (hasMobilePhoneValue(form.phone) && !phoneFormatted) {
        setFieldErrors((prev) => ({
          ...prev,
          phone: { message: t('order_validation_phone_format') },
        }));
        focusField('phone');
        return;
      }
    }

    const effectiveCompanyId = companyId || (await getMyCompanyId());
    const normalizedWorkTypeId = useWorkTypes ? String(workTypeId || '').trim() : '';
    if (useWorkTypes && normalizedWorkTypeId) {
      const { types: latestWorkTypes = [] } = effectiveCompanyId
        ? await fetchWorkTypes(effectiveCompanyId, { forceRefresh: true })
        : { types: [] };
      setWorkTypes(latestWorkTypes);
      const hasMatchingWorkType = latestWorkTypes.some(
        (type) => String(type.id) === normalizedWorkTypeId,
      );
      if (!hasMatchingWorkType) {
        setFieldErrors((prev) => ({
          ...prev,
          work_type_id: { message: t('order_validation_work_type_required') },
        }));
        setWorkTypeId(null);
        return;
      }
    }

    const normalizedPhone = normalizePhone(form.phone);
    if (isFieldRequired('client_id') && !selectedClientId) {
      setFieldErrors((prev) => ({
        ...prev,
        client_id: { message: t('order_validation_client_required') },
      }));
      focusField('client_id');
      return;
    }

    if (
      isFieldRequired('object_id') &&
      !selectedClientObjectId &&
      !draftClientObject &&
      !withoutAddressSelected
    ) {
      setFieldErrors((prev) => ({
        ...prev,
        object_id: { message: t('objects_select_required_for_order') },
      }));
      focusField('object_id');
      return;
    }

    if (draftClientObject && !selectedClientId) {
      setFieldErrors((prev) => ({
        ...prev,
        client_id: { message: t('order_validation_client_required_for_contact_details') },
      }));
      focusField('client_id');
      return;
    }

    if (selectedClientId) {
      const shouldSyncClientPrimaryPhone = phoneSourceId === PHONE_SOURCE_IDS.CLIENT_PRIMARY;
      if (shouldSyncClientPrimaryPhone) {
        await updateClientMutation.mutateAsync({
          id: String(selectedClientId),
          patch: {
            phone: normalizedPhone,
          },
        });
      }
    }

    let resolvedObject = stagedSelectedObjectDraft || selectedClientObject;
    let resolvedObjectId = selectedClientObjectId || null;
    const stagedObjectLocationMode = normalizeClientObjectLocationMode(stagedSelectedObjectDraft?.location_mode, {
      fallback: hasClientObjectMapPoint(stagedSelectedObjectDraft) ? 'map' : 'address',
    });
    if (resolvedObjectId && stagedSelectedObjectDraft) {
      if (!has('canEditObjects')) {
        promptNewObjectCreation(stagedSelectedObjectDraft);
        return;
      }
      const updated = await updateClientObjectMutation.mutateAsync({
        id: String(resolvedObjectId),
        patch: {
          ...sanitizeClientObjectPayload(stagedSelectedObjectDraft),
          geo_lat: normalizeCoordinateValue(stagedSelectedObjectDraft?.geo_lat) || null,
          geo_lng: normalizeCoordinateValue(stagedSelectedObjectDraft?.geo_lng) || null,
          location_mode: stagedObjectLocationMode,
        },
      });
      await refetchSelectedClient();
      resolvedObject = updated || stagedSelectedObjectDraft;
      setStagedSelectedObjectDraft(null);
    }
    if (!resolvedObjectId && draftClientObject) {
      const draftObjectLocationMode = normalizeClientObjectLocationMode(draftClientObject?.location_mode, {
        fallback: hasClientObjectMapPoint(draftClientObject) ? 'map' : 'address',
      });
      const exactMatchingObject = findExactMatchingClientObject(draftClientObject, clientObjects);
      if (exactMatchingObject) {
        resolvedObject = exactMatchingObject;
        resolvedObjectId = exactMatchingObject?.id || null;
        setSelectedClientObjectId(exactMatchingObject?.id || null);
        setWithoutAddressSelected(false);
      } else {
        const createdObject = await createClientObjectMutation.mutateAsync({
          client_id: String(selectedClientId),
          ...sanitizeClientObjectPayload(draftClientObject),
          geo_lat: normalizeCoordinateValue(draftClientObject?.geo_lat) || null,
          geo_lng: normalizeCoordinateValue(draftClientObject?.geo_lng) || null,
          location_mode: draftObjectLocationMode,
        });
        resolvedObject = createdObject || null;
        resolvedObjectId = createdObject?.id || null;
        setSelectedClientObjectId(createdObject?.id || null);
        setWithoutAddressSelected(false);
      }
      setDraftClientObject(null);
    }

    const resolvedAddressDraft = resolvedObject
      ? extractOrderAddressFromObject(resolvedObject)
      : null;
    const payload = {
      company_id: effectiveCompanyId || null,
      title,
      work_type_id: useWorkTypes ? normalizedWorkTypeId || null : null,
      comment: description,
      client_id: selectedClientId || null,
      object_id: resolvedObjectId || null,
      address_mode: resolvedObjectId ? 'object' : 'custom',
      ...toOrderAddressPatch(resolvedAddressDraft),
      assigned_to: effectiveToFeed ? null : effectiveAssigneeId,
      time_window_start: formatDateOnlyForStorage(departureDate),
      time_window_end: isDepartureRange ? formatDateOnlyForStorage(departureEndDate) : null,
      departure_time: formatTimeForStorage(departureTime),
      status: effectiveToFeed ? t('order_status_in_feed') : t('order_status_new'),
      urgent,
      currency: companySettings?.currency ?? null,
      creation_source: 'app',
    };

    const { error } = await supabase.from('orders').insert(payload);
    if (error) {
      const rawMessage = String(error?.message || '').toUpperCase();
      if (rawMessage.includes('WORK_TYPE_NOT_FOUND_IN_COMPANY')) {
        setWorkTypeId(null);
        setFieldErrors((prev) => ({
          ...prev,
          work_type_id: { message: t('order_validation_work_type_required') },
        }));
        focusField('work_type_id');
        return;
      }
      const normalized = normalizeError(error, { t });
      if (normalized.screenError) {
        showBanner({
          ...normalized.screenError,
          action: { label: t('btn_retry'), onPress: handleSubmit },
        });
      }
      return;
    } else {
      intentionalExitRef.current = true; // � � � €� Ў� ѓ� � С—� � Вµ� Ўв‚¬� � � …� � С•� � Вµ � Ў� ѓ� � С•� � В·� � Т‘� � В°� � � …� � С‘� � Вµ - � � � …� � Вµ � Ў� ѓ� � С•� ЎвЂ¦� Ў� ‚� � В°� � � …� Ў� Џ� � Вµ� � С � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С”
      await deleteDraft(); // � � � €� � Т‘� � В°� � В»� Ў� Џ� � Вµ� � С � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С” � � С—� � С•� Ў� ѓ� � В»� � Вµ � ЎС“� Ў� ѓ� � С—� � Вµ� Ўв‚¬� � � …� � С•� � С–� � С• � Ў� ѓ� � С•� � В·� � Т‘� � В°� � � …� � С‘� Ў� Џ
      router.replace('/orders/order-success');
    }
  }, [
    validateRequiredFields,
    form,
    useWorkTypes,
    workTypeId,
    departureDate,
    departureTime,
    departureEndDate,
    isDepartureRange,
    effectiveAssigneeId,
    effectiveToFeed,
    selectedClientId,
    selectedClientObjectId,
    withoutAddressSelected,
    selectedClientObject,
    draftClientObject,
    getField,
    isFieldRequired,
    normalizePhone,
    hasDepartureTimeValue,
    description,
    urgent,
    companyId,
    companySettings,
    clientObjects,
    clearBanner,
    has,
    requiredMsg,
    showBanner,
    focusField,
    t,
    deleteDraft,
    createClientObjectMutation,
    refetchSelectedClient,
    promptNewObjectCreation,
    stagedSelectedObjectDraft,
    updateClientMutation,
    updateClientObjectMutation,
    phoneSourceId,
    subscriptionGuard.canEdit,
    resolveTitleForSave,
  ]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (hasChanges()) {
          setCancelVisible(true);
        } else {
          intentionalExitRef.current = true; // � � � ‡� � � � � � � …� ЎвЂ№� � в„– � � � � � ЎвЂ№� ЎвЂ¦� � С•� � Т‘ - � � � …� � Вµ � Ў� ѓ� � С•� ЎвЂ¦� Ў� ‚� � В°� � � …� Ў� Џ� � Вµ� � С � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С”
          router.back();
        }
        return true;
      });
      return () => subscription.remove();
    }, [hasChanges]),
  );

  useEffect(() => {
    let mounted = true;
    (() => {
      const remoteFields = toLegacySchemaFields(orderFieldSettings);
      const fields = (remoteFields.length ? remoteFields : DEFAULT_FIELDS).filter(
        (field) => !REMOVED_ORDER_ADDRESS_FIELDS.has(String(field?.field_key || '')),
      );
      if (!mounted) return;
      setSchema({ context: 'create', fields });
      setForm((prev) => {
        const next = {};
        for (const field of fields) {
          next[field.field_key] = prev?.[field.field_key] ?? '';
        }
        return next;
      });
    })();

    const loadUsers = async () => {
      const { data: userList, error } = await supabase
        .from('profiles')
        .select('id, first_name, middle_name, last_name, role, department_id, email')
        .in('role', ['worker', 'dispatcher', 'admin']);
      if (!error && mounted) setUsers(userList || []);
    };
    loadUsers();

    // � � Сџ� Ў� ‚� � С•� � � � � � Вµ� Ў� ‚� Ў� Џ� � Вµ� � С � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С” � � С—� Ў� ‚� � С‘ � � С� � С•� � � …� ЎвЂљ� � С‘� Ў� ‚� � С•� � � � � � В°� � � …� � С‘� � С‘
    (async () => {
      const draft = await loadDraft();
      if (draft && mounted) {
        setSavedDraft(draft);
        setDraftRestoreVisible(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [loadDraft, orderFieldSettings]);

  // AppState listener - � Ў� ѓ� � С•� ЎвЂ¦� Ў� ‚� � В°� � � …� Ў� Џ� � Вµ� � С � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С” � � С—� Ў� ‚� � С‘ � Ў� ѓ� � � � � � С•� Ў� ‚� � В°� ЎвЂЎ� � С‘� � � � � � В°� � � …� � С‘� � С‘/� � В·� � В°� � С”� Ў� ‚� ЎвЂ№� ЎвЂљ� � С‘� � С‘ � � С—� Ў� ‚� � С‘� � В»� � С•� � В¶� � Вµ� � � …� � С‘� Ў� Џ
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      // � � вЂў� Ў� ѓ� � В»� � С‘ � � С—� Ў� ‚� � С‘� � В»� � С•� � В¶� � Вµ� � � …� � С‘� � Вµ � ЎС“� ЎвЂ¦� � С•� � Т‘� � С‘� ЎвЂљ � � � �  background � � С‘� � В»� � С‘ inactive � � С‘ � Ў� Њ� ЎвЂљ� � С• � � Сњ� � вЂў � Ў� Џ� � � � � � � …� ЎвЂ№� � в„– � � � � � ЎвЂ№� ЎвЂ¦� � С•� � Т‘
      if ((nextAppState === 'background' || nextAppState === 'inactive') && !intentionalExitRef.current) {
        // � � � Ћ� � С•� ЎвЂ¦� Ў� ‚� � В°� � � …� Ў� Џ� � Вµ� � С � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С” � ЎвЂљ� � С•� � В»� Ў� Љ� � С”� � С• � � Вµ� Ў� ѓ� � В»� � С‘ � � Вµ� Ў� ѓ� ЎвЂљ� Ў� Љ � � С‘� � В·� � С� � Вµ� � � …� � Вµ� � � …� � С‘� Ў� Џ
        if (hasChanges()) {
          saveDraft();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [saveDraft, hasChanges]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cid = await getMyCompanyId();
        if (!alive) return;
        if (cid) {
          const { useWorkTypes: flag, types } = await fetchWorkTypes(cid);
          if (!alive) return;
          setUseWorkTypesFlag(!!flag);
          setWorkTypes(types || []);
          setWorkTypeId((prev) => {
            if (!flag || !prev) return null;
            return (types || []).some((type) => String(type.id) === String(prev)) ? prev : null;
          });
        }
      } catch (e) {
        console.warn('[CreateOrder] workTypes bootstrap failed:', e?.message || e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const renderTextField = useCallback(
    ({
      fieldKey,
      label,
      placeholder,
      value,
      onChangeText,
      multiline = false,
      keyboardType,
      required,
      maxLength,
    }) => {
      const errMsg = fieldKey ? fieldErrors?.[fieldKey]?.message : null;
      const showErr = fieldKey ? shouldShowError(fieldKey) : false;
      const finalErr = showErr ? errMsg : null;
      return (
        <>
          <TextField
            ref={(r) => {
              if (fieldKey) fieldRefs.current[fieldKey] = r;
            }}
            label={withRequiredLabel(label, required)}
            placeholder={placeholder || label}
            value={value}
            onChangeText={(val) => {
              onChangeText?.(val);
              if (fieldKey) clearFieldError(fieldKey);
            }}
            onBlur={() => {
              if (fieldKey) setTouched((prev) => ({ ...prev, [fieldKey]: true }));
            }}
            multiline={multiline}
            keyboardType={keyboardType}
            maxLength={maxLength}
            style={formStyles.field}
            forceValidation={submittedAttempt}
            error={finalErr ? 'invalid' : undefined}
          />
          <FieldErrorText message={finalErr} />
        </>
      );
    },
    [
      formStyles,
      withRequiredLabel,
      fieldErrors,
      shouldShowError,
      clearFieldError,
      submittedAttempt,
    ],
  );

  const _renderTextInput = useCallback(
    (key, placeholder, opts = {}) => {
      const f = getField(key);
      if (!f) return null;
      const label = withRequiredLabel(getFieldLabel(key, placeholder), isFieldRequired(key));
      const val = form[key] ?? '';
      return (
        <View key={key}>
          {renderTextField({
            fieldKey: key,
            label,
            placeholder: placeholder || label,
            value: val,
            onChangeText: (text) => setField(key, text),
            required: isFieldRequired(key),
            ...opts,
          })}
        </View>
      );
    },
    [getField, getFieldLabel, form, isFieldRequired, renderTextField, setField, withRequiredLabel],
  );

  const renderPhoneInput = useCallback(
    (key = 'phone') => {
      const f = getField(key);
      if (!f) return null;
      const baseLabel =
        key === 'phone'
          ? t('create_order_visible_phone_label')
          : getFieldLabel(key);
      const label = withRequiredLabel(baseLabel, isFieldRequired(key));
      const val = form[key] ?? '';
      const errMsg = fieldErrors?.[key]?.message;
      const finalErr = shouldShowError(key) ? errMsg : null;
      return (
        <>
          <PhoneInput
            key={key}
            label={label}
            value={val}
            onChangeText={(raw, _meta) => {
              if (key === 'phone' && phoneSourceId !== PHONE_SOURCE_IDS.MANUAL) {
                setPhoneSourceId(PHONE_SOURCE_IDS.MANUAL);
              }
              setField(key, raw);
              clearFieldError(key);
            }}
            onBlur={() => {
              setTouched((prev) => ({ ...prev, [key]: true }));
            }}
            placeholder={t('create_order_placeholder_phone')}
            style={formStyles.field}
            error={finalErr ? 'invalid' : undefined}
          />
          <FieldErrorText message={finalErr} />
        </>
      );
    },
    [
      getField,
      getFieldLabel,
      form,
      setField,
      formStyles,
      t,
      isFieldRequired,
      phoneSourceId,
      withRequiredLabel,
      fieldErrors,
      shouldShowError,
      clearFieldError,
    ],
  );

  const renderToggle = useCallback(
    (value, onPress, label) => {
      const sep = theme.components?.input?.separator || {};
      const insetKey = sep.insetX || 'lg';
      const ml = Number(theme.spacing?.[insetKey] ?? 0) || 0;
      return (
        <View>
          <View style={[base.row, formStyles.field, { paddingHorizontal: ml }]}>
            <Text style={styles.toggleLabel}>{label}</Text>
            <Pressable onPress={onPress} style={[styles.toggle, value && styles.toggleOn]}>
              <View style={[styles.knob, value && styles.knobOn]} />
            </Pressable>
          </View>
          <View style={styles.separator} />
        </View>
      );
    },
    [styles, base, formStyles, theme],
  );

  const selectedWorkTypeName = useMemo(() => {
    if (!workTypeId) return null;
    const found = workTypes.find((w) => String(w.id) === String(workTypeId));
    return found?.name || t('create_order_work_type_selected');
  }, [workTypeId, workTypes, t]);
  const openWorkTypeModal = useCallback(() => {
    try {
      Keyboard.dismiss();
    } catch {}
    setWorkTypeModalVisible(true);
  }, []);

  const selectedAssigneeName = useMemo(() => {
    if (!assigneeId) return null;
    const u = users.find((x) => x.id === assigneeId);
    return (
      [u?.first_name, u?.middle_name, u?.last_name].filter(Boolean).join(' ') ||
      t('create_order_executor_selected')
    );
  }, [assigneeId, users, t]);

  const selectedClientName = useMemo(() => {
    if (!selectedClientId) return null;
    const client = clients.find((x) => String(x.id) === String(selectedClientId));
    return client?.fullName || selectedClient?.fullName || selectedClient?.full_name || null;
  }, [clients, selectedClient, selectedClientId]);

  const clientObjects = useMemo(() => {
    if (Array.isArray(selectedClient?.objects) && selectedClient.objects.length) return selectedClient.objects;
    if (Array.isArray(clientObjectsByApi) && clientObjectsByApi.length) return clientObjectsByApi;
    return [];
  }, [selectedClient, clientObjectsByApi]);
  const selectedClientObject = useMemo(
    () => clientObjects.find((item) => String(item.id) === String(selectedClientObjectId)) || null,
    [clientObjects, selectedClientObjectId],
  );
  const activeObjectDraft = useMemo(
    () =>
      pendingSuggestedObjectSelection?.objectDraft ||
      stagedSelectedObjectDraft ||
      selectedClientObject ||
      draftClientObject ||
      null,
    [draftClientObject, pendingSuggestedObjectSelection, selectedClientObject, stagedSelectedObjectDraft],
  );
  const selectedClientAdditionalPhones = useMemo(
    () => getClientAdditionalPhones(selectedClient),
    [selectedClient],
  );
  const selectedObjectAdditionalPhones = useMemo(
    () => getObjectAdditionalPhones(activeObjectDraft),
    [activeObjectDraft],
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
        label: t('create_order_phone_source_manual'),
      },
    ];

    if (selectedClientId) {
      const clientPrimaryPhone = String(selectedClient?.phone || '').trim();
      items.push({
        id: PHONE_SOURCE_IDS.CLIENT_PRIMARY,
        label: t('create_order_phone_source_client_primary'),
        subtitle: clientPrimaryPhone ? formatRuMask(clientPrimaryPhone) : undefined,
        disabled: !clientPrimaryPhone,
      });

      CLIENT_ADDITIONAL_PHONE_SLOT_IDS.forEach((slotId) => {
        const entry = selectedClientAdditionalPhones?.[slotId - 1] || {};
        const phone = String(entry?.phone || '').trim();
        if (!phone) return;
        const displayLabel = buildAdditionalPhoneDisplayLabel(t, entry?.label);
        items.push({
          id: buildPhoneSourceId(PHONE_SOURCE_KIND.CLIENT_ADDITIONAL, slotId),
          label: t('create_order_phone_source_client_additional').replace('{label}', displayLabel),
          subtitle: formatRuMask(phone),
        });
      });
    }

    OBJECT_ADDITIONAL_PHONE_SLOT_IDS.forEach((slotId) => {
      const entry = selectedObjectAdditionalPhones?.[slotId - 1] || {};
      const phone = String(entry?.phone || '').trim();
      if (!phone) return;
      const displayLabel = buildAdditionalPhoneDisplayLabel(t, entry?.label);
      items.push({
        id: buildPhoneSourceId(PHONE_SOURCE_KIND.OBJECT_ADDITIONAL, slotId),
        label: t('create_order_phone_source_object_additional').replace('{label}', displayLabel),
        subtitle: formatRuMask(phone),
      });
    });

    return items;
  }, [selectedClient, selectedClientAdditionalPhones, selectedClientId, selectedObjectAdditionalPhones, t]);
  const selectedPhoneSourceLabel = useMemo(() => {
    const selectedItem = phoneSourceItems.find((item) => item.id === phoneSourceId);
    return selectedItem?.label || t('create_order_phone_source_manual');
  }, [phoneSourceId, phoneSourceItems, t]);
  const isObjectPointOnMap = useCallback((objectItem) => {
    if (!objectItem) return false;
    const mode = normalizeClientObjectLocationMode(objectItem?.location_mode, {
      fallback: hasClientObjectMapPoint(objectItem) ? 'map' : 'address',
    });
    return mode === 'map' && hasClientObjectMapPoint(objectItem);
  }, []);
  const getObjectShortDescriptor = useCallback(
    (objectItem) => {
      if (!objectItem) return '';
      if (isObjectPointOnMap(objectItem)) return t('objects_location_mode_map');
      return buildOrderAddressShort(getVisibleObjectAddressDraft(objectItem)) || '';
    },
    [getVisibleObjectAddressDraft, isObjectPointOnMap, t],
  );
  const applyPhoneSource = useCallback(
    (sourceId, options = {}) => {
      const normalizedSourceId = normalizePhoneSourceId(sourceId);
      const fillPhone = options.fillPhone !== false;
      const keepPhoneOnManual = options.keepPhoneOnManual !== false;

      setPhoneSourceId(normalizedSourceId);
      if (!fillPhone) return;
      if (normalizedSourceId === PHONE_SOURCE_IDS.MANUAL) {
        if (!keepPhoneOnManual) {
          setForm((prev) => ({ ...prev, phone: '' }));
        }
        clearFieldError('phone');
        return;
      }
      const nextPhone = resolvePhoneBySourceId(normalizedSourceId);
      setForm((prev) => ({ ...prev, phone: String(nextPhone || '').trim() }));
      clearFieldError('phone');
    },
    [clearFieldError, resolvePhoneBySourceId],
  );
  const selectedClientObjectSummary = useMemo(() => {
    const objectName = String(activeObjectDraft?.name || '').trim();
    if (!activeObjectDraft) return null;
    if (isObjectPointOnMap(activeObjectDraft)) {
      return `${objectName || t('create_order_client_object_label')} - ${t('objects_location_mode_map')}`;
    }
    return objectName || null;
  }, [activeObjectDraft, isObjectPointOnMap, t]);
  const selectedClientObjectDisplay = useMemo(() => {
    if (selectedClientObjectSummary) return selectedClientObjectSummary;
    if (withoutAddressSelected) return t('order_object_without_address');
    return t('create_order_client_object_placeholder');
  }, [selectedClientObjectSummary, t, withoutAddressSelected]);
  const visibleActiveAddressDraft = useMemo(
    () => getVisibleObjectAddressDraft(activeObjectDraft),
    [activeObjectDraft, getVisibleObjectAddressDraft],
  );
  const visibleClientObjectFieldKeys = useMemo(
    () =>
      ['name', ...CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS, ...CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS].filter(
        (field) => objectFieldsByKey.get(field)?.isEnabled === true,
      ),
    [objectFieldsByKey],
  );
  const enabledObjectAdditionalPhoneSlots = useMemo(
    () => [1, 2, 3].filter((slotId) => objectFieldsByKey.get(`additional_phone_${slotId}`)?.isEnabled === true),
    [objectFieldsByKey],
  );
  const requiredObjectAdditionalPhoneSlots = useMemo(
    () => [1, 2, 3].filter((slotId) => objectFieldsByKey.get(`additional_phone_${slotId}`)?.isRequired === true),
    [objectFieldsByKey],
  );
  const shortAddressValue = useMemo(
    () =>
      (hasClientObjectMapPoint(activeObjectDraft) &&
      normalizeClientObjectLocationMode(activeObjectDraft?.location_mode, {
        fallback: hasClientObjectMapPoint(activeObjectDraft) ? 'map' : 'address',
      }) === 'map'
        ? `${normalizeCoordinateValue(activeObjectDraft?.geo_lat)}, ${normalizeCoordinateValue(activeObjectDraft?.geo_lng)}`
        : '') ||
      buildOrderAddressDisplay(visibleActiveAddressDraft) ||
      buildOrderAddressShort(visibleActiveAddressDraft) ||
      t('order_details_address_not_specified'),
    [activeObjectDraft, t, visibleActiveAddressDraft],
  );
  const renderCreateMainField = useCallback(
    (fieldKey) => {
      if (!getField(fieldKey)) return null;

      switch (fieldKey) {
        case 'title':
          return renderTextField({
            fieldKey: 'title',
            label: getFieldLabel('title'),
            placeholder: t('create_order_placeholder_title'),
            value: titlePreviewValue,
            onChangeText: (text) => setField('title', text),
            required: isFieldRequired('title'),
          });
        case 'comment':
          return renderTextField({
            fieldKey: 'comment',
            label: getFieldLabel('comment', t('order_field_description')),
            placeholder: t('create_order_placeholder_description'),
            value: description,
            onChangeText: setDescription,
            multiline: false,
            required: isFieldRequired('comment'),
          });
        case 'work_type_id':
          if (!useWorkTypes) return null;
          return (
            <>
              <TextField
                label={withRequiredLabel(t('create_order_work_type_label'), isFieldRequired('work_type_id'))}
                value={selectedWorkTypeName || t('create_order_work_type_placeholder')}
                pressable
                style={formStyles.field}
                onPress={openWorkTypeModal}
                error={
                  shouldShowError('work_type_id') && fieldErrors?.work_type_id ? 'invalid' : undefined
                }
              />
              <FieldErrorText
                message={shouldShowError('work_type_id') ? fieldErrors?.work_type_id?.message : null}
              />
            </>
          );
        default:
          return null;
      }
    },
    [
      description,
      fieldErrors,
      formStyles.field,
      getField,
      getFieldLabel,
      isFieldRequired,
      openWorkTypeModal,
      renderTextField,
      selectedWorkTypeName,
      setDescription,
      setField,
      shouldShowError,
      t,
      titlePreviewValue,
      useWorkTypes,
      withRequiredLabel,
    ],
  );
  const renderCreateCustomerField = useCallback(
    (fieldKey) => {
      if (!getField(fieldKey)) return null;

      switch (fieldKey) {
        case 'client_id':
          return (
            <>
              <TextField
                label={withRequiredLabel(t('routes_clients_client'), isFieldRequired('client_id'))}
                value={selectedClientName || t('common_select')}
                pressable
                style={formStyles.field}
                onPress={() => setClientModalVisible(true)}
                error={shouldShowError('client_id') && fieldErrors?.client_id ? 'invalid' : undefined}
                rightSlot={
                  selectedClientId ? (
                    <ClearButton
                      onPress={() => {
                        setSelectedClientId(null);
                        setSelectedClientObjectId(null);
                        setWithoutAddressSelected(false);
                        setPendingSuggestedObjectSelection(null);
                        setStagedSelectedObjectDraft(null);
                        setSuggestedMatchingObject(null);
                        setSuggestedMatchingVisible(false);
                        setPhoneSourceId(PHONE_SOURCE_IDS.MANUAL);
                        setField('phone', '');
                      }}
                      accessibilityLabel={t('common_clear')}
                    />
                  ) : null
                }
              />
              <FieldErrorText
                message={shouldShowError('client_id') ? fieldErrors?.client_id?.message : null}
              />
            </>
          );
        case 'object_id':
          return (
            <>
              <TextField
                label={withRequiredLabel(t('create_order_client_object_label'), isFieldRequired('object_id'))}
                value={selectedClientObjectDisplay}
                pressable
                style={formStyles.field}
                onPress={openObjectFlow}
                error={shouldShowError('object_id') && fieldErrors?.object_id ? 'invalid' : undefined}
                rightSlot={
                  selectedClientObjectId || draftClientObject || withoutAddressSelected ? (
                    <ClearButton
                      onPress={() => {
                        setSelectedClientObjectId(null);
                        setWithoutAddressSelected(false);
                        setStagedSelectedObjectDraft(null);
                        setDraftClientObject(null);
                        setSuggestedMatchingObject(null);
                        setSuggestedMatchingVisible(false);
                      }}
                      accessibilityLabel={t('common_clear')}
                    />
                  ) : null
                }
              />
              <FieldErrorText
                message={shouldShowError('object_id') ? fieldErrors?.object_id?.message : null}
              />
              {activeObjectDraft ? (
                <TextField
                  label={
                    normalizeClientObjectLocationMode(activeObjectDraft?.location_mode, {
                      fallback: hasClientObjectMapPoint(activeObjectDraft) ? 'map' : 'address',
                    }) === 'map'
                      ? t('objects_location_coordinates')
                      : t('order_details_address')
                  }
                  value={shortAddressValue}
                  pressable
                  multiline
                  minLines={2}
                  style={formStyles.field}
                  onPress={openObjectAddressEditor}
                />
              ) : null}
            </>
          );
        case 'phone':
          return (
            <>
              <TextField
                label={withRequiredLabel(
                  t('create_order_phone_source_display_label'),
                  true,
                )}
                value={selectedPhoneSourceLabel}
                pressable
                style={formStyles.field}
                onPress={() => setPhoneSourceModalVisible(true)}
              />
              {renderPhoneInput('phone')}
            </>
          );
        default:
          return null;
      }
    },
    [
      activeObjectDraft,
      draftClientObject,
      fieldErrors,
      formStyles.field,
      getField,
      isFieldRequired,
      openObjectAddressEditor,
      openObjectFlow,
      renderPhoneInput,
      selectedPhoneSourceLabel,
      selectedClientName,
      selectedClientId,
      selectedClientObjectId,
      selectedClientObjectDisplay,
      withoutAddressSelected,
      setField,
      setPhoneSourceModalVisible,
      shortAddressValue,
      shouldShowError,
      t,
      withRequiredLabel,
    ],
  );
  const renderCreatePlanningField = useCallback(
    (fieldKey) => {
      if (!getField(fieldKey)) return null;

      switch (fieldKey) {
        case 'urgent':
          return renderToggle(urgent, () => setUrgent((v) => !v), t('create_order_label_urgent'));
        case 'time_window_start':
          return (
            <>
              <TextField
                label={withRequiredLabel(
                  getFieldLabel('time_window_start', t('create_order_label_date')),
                  isFieldRequired('time_window_start'),
                )}
                value={departureDateDisplayLabel || t('create_order_placeholder_date')}
                pressable
                style={formStyles.field}
                ref={dateFieldRef}
                error={
                  shouldShowError('time_window_start') && fieldErrors?.time_window_start
                    ? 'invalid'
                    : undefined
                }
                rightSlot={
                  departureDate ? (
                    <ClearButton
                      onPress={() => {
                        setDepartureDate(null);
                        setDepartureEndDate(null);
                        setIsDepartureRange(false);
                      }}
                      accessibilityLabel={t('common_clear')}
                    />
                  ) : null
                }
                onPress={() => {
                  setShowDatePicker(true);
                  setTimeout(() => scrollToHandle(dateFieldRef), SCROLL_ANIMATION_DELAY);
                }}
              />
              <FieldErrorText
                message={shouldShowError('time_window_start') ? fieldErrors?.time_window_start?.message : null}
              />

              <DateTimeModal
                visible={showDatePicker}
                initial={departureDate || new Date()}
                mode="date"
                allowFutureDates
                onApply={(selected) => {
                  const nextStart = selected ? new Date(selected) : null;
                  setIsDepartureRange(false);
                  setDepartureDate(
                    nextStart
                      ? new Date(
                          nextStart.getFullYear(),
                          nextStart.getMonth(),
                          nextStart.getDate(),
                          0,
                          0,
                          0,
                          0,
                        )
                      : null,
                  );
                  setDepartureEndDate(null);
                }}
                onClose={() => setShowDatePicker(false)}
              />
            </>
          );
        case 'departure_time':
          return (
            <>
              <TextField
                label={withRequiredLabel(
                  getFieldLabel('departure_time', t('order_field_departure_time')),
                  isFieldRequired('departure_time'),
                )}
                value={
                  hasDepartureTimeValue(departureTime)
                    ? formatTime(departureTime)
                    : t('create_order_placeholder_time')
                }
                pressable
                style={formStyles.field}
                ref={timeFieldRef}
                error={shouldShowError('departure_time') && fieldErrors?.departure_time ? 'invalid' : undefined}
                rightSlot={
                  hasDepartureTimeValue(departureTime) ? (
                    <ClearButton
                      onPress={() => {
                        setDepartureTime(null);
                      }}
                      accessibilityLabel={t('common_clear')}
                    />
                  ) : null
                }
                onPress={() => {
                  setShowTimePicker(true);
                  setTimeout(() => scrollToHandle(timeFieldRef), SCROLL_ANIMATION_DELAY);
                }}
              />
              <FieldErrorText
                message={shouldShowError('departure_time') ? fieldErrors?.departure_time?.message : null}
              />

              <DateTimeModal
                visible={showTimePicker}
                initial={departureTime || new Date()}
                mode="time"
                onApply={(selected) => {
                  if (selected) {
                    const next = new Date();
                    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
                    setDepartureTime(next);
                  }
                }}
                onClose={() => setShowTimePicker(false)}
              />
            </>
          );
        case 'assigned_to':
          if (isSoloAdmin) return null;
          return (
            <>
              <TextField
                label={withRequiredLabel(
                  getFieldLabel('assigned_to', t('create_order_label_executor')),
                  isFieldRequired('assigned_to'),
                )}
                value={
                  toFeed
                    ? t('create_order_executor_in_feed')
                    : selectedAssigneeName || t('create_order_executor_placeholder')
                }
                pressable
                style={formStyles.field}
                onPress={() => {
                  setAssigneeModalVisible(true);
                }}
                error={shouldShowError('assigned_to') && fieldErrors?.assigned_to ? 'invalid' : undefined}
                rightSlot={
                  assigneeId && !toFeed ? (
                    <ClearButton
                      onPress={() => setAssigneeId(null)}
                      accessibilityLabel={t('common_clear')}
                    />
                  ) : null
                }
              />
              <FieldErrorText
                message={shouldShowError('assigned_to') ? fieldErrors?.assigned_to?.message : null}
              />
            </>
          );
        default:
          return null;
      }
    },
    [
      assigneeId,
      departureDate,
      departureTime,
      departureDateDisplayLabel,
      fieldErrors,
      formatTime,
      formStyles.field,
      getField,
      getFieldLabel,
      hasDepartureTimeValue,
      isFieldRequired,
      renderToggle,
      scrollToHandle,
      selectedAssigneeName,
      showDatePicker,
      showTimePicker,
      shouldShowError,
      isSoloAdmin,
      t,
      toFeed,
      urgent,
      withRequiredLabel,
    ],
  );
  const bestMatchingClientObject = useMemo(
    () => findBestMatchingClientObject(draftClientObject, clientObjects),
    [clientObjects, draftClientObject],
  );
  const bestGlobalMatchingObject = useMemo(() => {
    const top = Array.isArray(globalDraftObjectSearchResults) ? globalDraftObjectSearchResults[0] : null;
    if (!top?.objectId || !top?.clientId) return null;
    return {
      object: {
        id: top.objectId,
        name: top.objectName || t('objects_new'),
      },
      clientId: top.clientId,
      clientName: top.clientName || '',
      raw: top,
      signature: `global:${top.clientId}:${top.objectId}:${globalDraftSearchParams.query}:${globalDraftSearchParams.street}:${globalDraftSearchParams.house}`,
    };
  }, [globalDraftObjectSearchResults, globalDraftSearchParams.house, globalDraftSearchParams.query, globalDraftSearchParams.street, t]);
  const objectSearchSourceDraft = useMemo(
    () => clientObjectDraft || draftClientObject || createEmptyClientObjectDraft(),
    [clientObjectDraft, draftClientObject],
  );
  const objectSearchParams = useMemo(() => {
    const street = String(objectSearchSourceDraft?.street || '').trim();
    const house = String(objectSearchSourceDraft?.house || '').trim();
    const city = String(objectSearchSourceDraft?.city || '').trim();
    const entrance = String(objectSearchSourceDraft?.entrance || '').trim();
    const apartment = String(objectSearchSourceDraft?.apartment || '').trim();
    return {
      query: [city, street, house, apartment, entrance].filter(Boolean).join(' ').trim(),
      street,
      house,
      city,
      clientId: selectedClientId || null,
    };
  }, [objectSearchSourceDraft, selectedClientId]);
  const objectSearchSuggestions = useMemo(
    () =>
      (Array.isArray(companyObjectSearchResults) ? companyObjectSearchResults : [])
        .filter((item) => String(item?.objectId || '') !== String(selectedClientObjectId || ''))
        .map((item) => ({
          ...item,
          shortAddress: buildOrderAddressShort(getVisibleObjectAddressDraft(item)),
        })),
    [companyObjectSearchResults, getVisibleObjectAddressDraft, selectedClientObjectId],
  );
  const objectSearchHasQuery = useMemo(() => {
    const street = String(debouncedObjectSearchParams?.street || '').trim();
    const house = String(debouncedObjectSearchParams?.house || '').trim();
    const query = String(debouncedObjectSearchParams?.query || '').trim();
    return street.length >= 3 || query.length >= 8 || (street.length >= 2 && house.length >= 1);
  }, [debouncedObjectSearchParams]);

  useEffect(() => {
    if (!clientObjectEditorVisible || clientObjectEditorMode === 'update') {
      setDebouncedObjectSearchParams({
        query: '',
        street: '',
        house: '',
        city: '',
        clientId: selectedClientId || null,
      });
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedObjectSearchParams(objectSearchParams);
    }, 220);
    return () => clearTimeout(timer);
  }, [clientObjectEditorMode, clientObjectEditorVisible, objectSearchParams, selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) {
      setSelectedClientObjectId(null);
      setStagedSelectedObjectDraft(null);
      return;
    }
    if (!selectedClient) {
      if (!pendingSuggestedObjectSelection) {
        setSelectedClientObjectId(null);
        setStagedSelectedObjectDraft(null);
      }
      return;
    }
    if (draftClientObject || pendingSuggestedObjectSelection) return;
    const primaryObject = clientObjects.find((item) => item?.is_primary) || clientObjects[0] || null;
    setSelectedClientObjectId((prev) => {
      const prevId = String(prev || '').trim();
      if (prevId && clientObjects.some((item) => String(item?.id || '') === prevId)) {
        return prev;
      }
      return primaryObject?.id || null;
    });
  }, [clientObjects, draftClientObject, pendingSuggestedObjectSelection, selectedClient, selectedClientId]);

  useEffect(() => {
    if (!selectedClientObjectId || !selectedClientObject) {
      setStagedSelectedObjectDraft(null);
      return;
    }
    setStagedSelectedObjectDraft((prev) => {
      if (!prev?.id) return prev;
      return String(prev.id) === String(selectedClientObjectId) ? prev : null;
    });
  }, [selectedClientObject, selectedClientObjectId]);

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
    setForm((prev) => {
      const currentPhone = String(prev.phone || '').trim();
      const resolvedPhone = String(nextPhone || '').trim();
      if (currentPhone === resolvedPhone) return prev;
      return { ...prev, phone: resolvedPhone };
    });
    clearFieldError('phone');
  }, [clearFieldError, phoneSourceId, phoneSourceItems, resolvePhoneBySourceId]);

  useEffect(() => {
    if (!pendingSuggestedObjectSelection || !selectedClient) return;
    if (String(pendingSuggestedObjectSelection.clientId || '') !== String(selectedClientId || '')) return;
    setSelectedClientObjectId(pendingSuggestedObjectSelection.objectId || null);
    setStagedSelectedObjectDraft(pendingSuggestedObjectSelection.objectDraft || null);
    setPendingSuggestedObjectSelection(null);
  }, [pendingSuggestedObjectSelection, selectedClient, selectedClientId]);

  useEffect(() => {
    if (!draftClientObject || !selectedClientId || !bestMatchingClientObject) {
      setSuggestedMatchingObject(null);
      setSuggestedMatchingVisible(false);
      return;
    }
    if (bestMatchingClientObject.signature === ignoredMatchSignature) return;
    setSuggestedMatchingObject(bestMatchingClientObject);
    setSuggestedMatchingVisible(true);
  }, [
    bestMatchingClientObject,
    draftClientObject,
    ignoredMatchSignature,
    selectedClientId,
  ]);

  useEffect(() => {
    if (!draftClientObject || selectedClientId || !bestGlobalMatchingObject) return;
    if (bestGlobalMatchingObject.signature === ignoredMatchSignature) return;
    setSuggestedMatchingObject(bestGlobalMatchingObject);
    setSuggestedMatchingVisible(true);
  }, [
    bestGlobalMatchingObject,
    draftClientObject,
    ignoredMatchSignature,
    selectedClientId,
  ]);

  const formatDate = useCallback((date) => {
    if (!date) return null;
    return date.toLocaleDateString(getLocale(), {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }, []);

  const formatTime = useCallback((date) => {
    if (!date) return null;
    return date.toLocaleTimeString(getLocale(), {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  const departureDateDisplayLabel = useMemo(() => {
    const startLabel = formatDate(departureDate);
    if (!startLabel) return null;
    if (!isDepartureRange) return startLabel;
    const endLabel = formatDate(departureEndDate);
    if (!endLabel) return startLabel;
    return `${startLabel} — ${endLabel}`;
  }, [departureDate, departureEndDate, isDepartureRange, formatDate]);

  const workTypeItems = useMemo(() => {
    if (!workTypes.length) {
      return [
        {
          id: 'empty',
          label: t('create_order_modal_work_type_empty'),
          disabled: true,
        },
      ];
    }
    return workTypes.map((wt) => ({
      id: wt.id,
      label: sanitizeVisibleText(wt?.name, t('common_noName')),
    }));
  }, [workTypes, t]);

  const assigneeItems = useMemo(() => {
    const departmentsById = new Map(
      (Array.isArray(departments) ? departments : []).map((department) => [
        String(department?.id || ''),
        String(department?.name || '').trim(),
      ]),
    );
    return buildAssigneeSelectItems({
      users,
      departmentsById,
      t,
      includeFeed: !isSoloAdmin,
      onSelectFeed: () => {
        setToFeed(true);
        setAssigneeId(null);
        setAssigneeModalVisible(false);
      },
      onSelectUser: (userId) => {
        setAssigneeId(userId);
        setToFeed(false);
        setAssigneeModalVisible(false);
      },
    });
  }, [departments, isSoloAdmin, users, t]);

  const clientItems = useMemo(() => {
    if (!Array.isArray(clients) || clients.length === 0) {
      return [{ id: 'empty', label: t('empty_noData'), disabled: true }];
    }
    return clients.map((client) => ({
      id: client.id,
      label: sanitizeVisibleText(client.fullName, t('common_noName')),
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
        setPendingSuggestedObjectSelection(null);
        setSelectedClientId(client.id);
        setSelectedClientObjectId(null);
        setWithoutAddressSelected(false);
        const primaryPhone = String(client?.phone || '').trim();
        if (primaryPhone) {
          setPhoneSourceId(PHONE_SOURCE_IDS.CLIENT_PRIMARY);
          setForm((prev) => ({ ...prev, phone: primaryPhone }));
          clearFieldError('phone');
        } else {
          setPhoneSourceId(PHONE_SOURCE_IDS.MANUAL);
        }
        setClientModalVisible(false);
      },
    }));
  }, [clearFieldError, clients, t]);

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
    const phone = previewClient?.phone ? formatRuMask(previewClient.phone) : '';
    const objectNames = Array.isArray(previewClient?.objects)
      ? previewClient.objects
          .map((objectItem) => String(objectItem?.name || '').trim())
          .filter(Boolean)
      : [];
    return [
      { key: 'phone', label: t('view_label_phone'), value: phone },
      {
        key: 'objects',
        label: t('clients_objects_section'),
        value: objectNames.join(', '),
      },
    ];
  }, [previewClient, t]);

  const previewClientTags = useMemo(
    () =>
      Array.isArray(previewClient?.tags)
      ? previewClient.tags.map((tag) => String(tag?.value || '').trim()).filter(Boolean)
      : [],
    [previewClient?.tags],
  );
  const previewObjectRows = useMemo(() => {
    if (!previewObject) return [];
    const previewLocationMode = normalizeClientObjectLocationMode(previewObject?.location_mode, {
      fallback: hasClientObjectMapPoint(previewObject) ? 'map' : 'address',
    });
    const previewCoordinatesValue = hasClientObjectMapPoint(previewObject)
      ? `${normalizeCoordinateValue(previewObject?.geo_lat)}, ${normalizeCoordinateValue(previewObject?.geo_lng)}`
      : '';
    const previewVisibleAddress = getVisibleObjectAddressDraft(previewObject);
    const fullAddress = buildOrderAddressDisplay(previewVisibleAddress);
    return [
      {
        key: 'client',
        label: t('routes_clients_client'),
        value: String(previewObject.clientName || '').trim(),
      },
      {
        key: previewLocationMode === 'map' ? 'coordinates' : 'address',
        label: previewLocationMode === 'map' ? t('objects_location_coordinates') : t('order_details_address'),
        value:
          previewLocationMode === 'map'
            ? (previewCoordinatesValue || t('objects_location_empty'))
            : (fullAddress || t('order_details_address_not_specified')),
      },
      {
        key: 'comment',
        label: t('order_field_comment'),
        value: String(previewVisibleAddress.comment || previewVisibleAddress.entrance_info || '').trim(),
      },
    ].filter((row) => String(row?.value || '').trim());
  }, [getVisibleObjectAddressDraft, previewObject, t]);

  const openPreviewClientCard = useCallback(() => {
    if (!has('canViewClients')) return;
    const clientId = String(previewClient?.id || '').trim();
    if (!clientId) return;
    setPreviewClientVisible(false);
    setClientModalVisible(false);
    router.push({
      pathname: `/clients/${clientId}`,
      params: {
        returnTo: '/orders/create-order',
      },
    });
  }, [has, previewClient?.id]);

  const openPreviewObjectCard = useCallback(() => {
    if (!has('canViewObjects')) return;
    const objectId = String(previewObject?.id || previewObject?.objectId || '').trim();
    if (!objectId) return;
    setPreviewObjectVisible(false);
    router.push({
      pathname: `/objects/${objectId}`,
      params: {
        returnTo: '/orders/create-order',
      },
    });
  }, [has, previewObject?.id, previewObject?.objectId]);

  const openSuggestedObjectPreview = useCallback((event) => {
    if (!has('canViewObjects')) return;
    const sourceObject = suggestedMatchingObject?.raw
      ? {
          ...suggestedMatchingObject.raw,
          id: suggestedMatchingObject.raw.objectId,
          name: suggestedMatchingObject.raw.objectName,
          clientName: suggestedMatchingObject.raw.clientName,
          shortAddress: buildOrderAddressShort(getVisibleObjectAddressDraft(suggestedMatchingObject.raw)),
        }
      : {
          ...(suggestedMatchingObject?.object || {}),
          clientName: suggestedMatchingObject?.clientName || selectedClientName || '',
          shortAddress: buildOrderAddressShort(getVisibleObjectAddressDraft(suggestedMatchingObject?.object || {})),
        };
    if (!sourceObject?.id) return;
    const pageX = Number(event?.nativeEvent?.pageX);
    const pageY = Number(event?.nativeEvent?.pageY);
    if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
      setPreviewAnchor({ x: pageX, y: pageY });
    }
    setPreviewObject(sourceObject);
    setPreviewObjectVisible(true);
  }, [getVisibleObjectAddressDraft, has, selectedClientName, suggestedMatchingObject]);

  const handleSelectGlobalObjectSuggestion = useCallback((item) => {
    if (!item?.objectId || !item?.clientId) return;
    const nextObjectDraft = {
      id: item.objectId,
      client_id: item.clientId,
      name: item.objectName || t('objects_new'),
      country: item.country || '',
      region: item.region || '',
      district: item.district || '',
      city: item.city || '',
      street: item.street || '',
      house: item.house || '',
      postal_code: item.postal_code || '',
      floor: item.floor || '',
      entrance: item.entrance || '',
      apartment: item.apartment || '',
      comment: item.comment || item.entrance_info || '',
      geo_lat: item.geo_lat || '',
      geo_lng: item.geo_lng || '',
      location_mode:
        normalizeCoordinateValue(item.geo_lat) && normalizeCoordinateValue(item.geo_lng) ? 'map' : 'address',
    };
    setPendingSuggestedObjectSelection({
      clientId: item.clientId,
      objectId: item.objectId,
      objectDraft: nextObjectDraft,
    });
    setSelectedClientId(item.clientId);
    setSelectedClientObjectId(item.objectId);
    setWithoutAddressSelected(false);
    setStagedSelectedObjectDraft(nextObjectDraft);
    setDraftClientObject(null);
    setClientObjectDraft(nextObjectDraft);
    setClientObjectEditorVisible(false);
    setClientObjectModalVisible(false);
    setSuggestedMatchingObject(null);
    setSuggestedMatchingVisible(false);
    setIgnoredMatchSignature('');
  }, [t]);

  const clientObjectItems = useMemo(() => {
    const items = [
      {
        id: '__no_address__',
        label: t('order_object_without_address'),
        onPress: () => {
          setSelectedClientObjectId(null);
          setWithoutAddressSelected(true);
          setStagedSelectedObjectDraft(null);
          setDraftClientObject(null);
          setClientObjectModalVisible(false);
        },
      },
    ];
    if (draftClientObject) {
      items.push({
        id: 'draft-object',
        label: sanitizeVisibleText(String(draftClientObject.name || '').trim(), t('objects_new')),
        subtitle: getObjectShortDescriptor(draftClientObject) || undefined,
        onPress: () => {
          setClientObjectModalVisible(false);
          setClientObjectEditorMode('draft');
          setClientObjectDraft(draftClientObject);
          setClientObjectEditorVisible(true);
        },
      });
    }
    return [
      ...items,
      ...clientObjects.map((objectItem) => ({
        id: objectItem.id,
        label: objectItem.is_primary
          ? sanitizeVisibleText([objectItem.name, t('objects_primary')].filter(Boolean).join(' - '), t('objects_new'))
          : sanitizeVisibleText(objectItem.name, t('objects_new')),
        subtitle: getObjectShortDescriptor(objectItem) || undefined,
        objectRaw: objectItem,
        onPress: () => {
          setSelectedClientObjectId(objectItem.id);
          setWithoutAddressSelected(false);
          setStagedSelectedObjectDraft(null);
          setDraftClientObject(null);
          setClientObjectModalVisible(false);
        },
      })),
    ];
  }, [clientObjects, draftClientObject, getObjectShortDescriptor, t]);

  const openObjectPreview = useCallback((item, event) => {
    if (!has('canViewObjects')) return;
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
      shortAddress: getObjectShortDescriptor(objectItem) || '',
    });
    setPreviewObjectVisible(true);
  }, [getObjectShortDescriptor, has, selectedClientName]);

  const openCreateClientFromModal = useCallback(() => {
    const prefill = parseClientPrefillFromSearch(clientModalSearch);
    setClientModalVisible(false);
    router.push({
      pathname: '/clients/new',
      params: {
        flow_key: clientFlowKeyRef.current,
        flow_return_to: '/orders/create-order',
        ...(prefill.firstName ? { prefill_first_name: prefill.firstName } : {}),
        ...(prefill.lastName ? { prefill_last_name: prefill.lastName } : {}),
        ...(prefill.middleName ? { prefill_middle_name: prefill.middleName } : {}),
        ...(prefill.phoneRaw ? { prefill_phone: prefill.phoneRaw } : {}),
      },
    });
  }, [clientModalSearch]);

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
          setSelectedClientObjectId(null);
          setWithoutAddressSelected(false);
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

  const handleCreateClientObject = useCallback(async () => {
    const objectLocationMode = normalizeClientObjectLocationMode(clientObjectDraft?.location_mode, {
      fallback: hasClientObjectMapPoint(clientObjectDraft) ? 'map' : 'address',
    });
    const objectHasMapPoint = hasClientObjectMapPoint(clientObjectDraft);
    const nextObjectFieldErrors = visibleClientObjectFieldKeys.reduce((acc, field) => {
      const shouldRelaxRequired =
        objectLocationMode === 'map' && objectHasMapPoint && CLIENT_OBJECT_ADDRESS_FIELDS.includes(field);
      const message = getRequiredTextFieldError(clientObjectDraft?.[field], {
        required: shouldRelaxRequired ? false : objectFieldsByKey.get(field)?.isRequired === true,
        requiredMessage: getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t),
      });
      if (!message) return acc;
      return { ...acc, [field]: message };
    }, {});
    const objectAdditionalPhones = getObjectAdditionalPhones(clientObjectDraft);
    const visibleObjectAdditionalPhoneSlots = resolveVisibleAdditionalObjectPhoneSlotIds({
      enabledSlotIds: enabledObjectAdditionalPhoneSlots,
      requiredSlotIds: requiredObjectAdditionalPhoneSlots,
      valueVisibleSlotIds: getVisibleAdditionalObjectPhoneSlotIds(objectAdditionalPhones),
    });
    const firstInvalidAdditionalPhone = visibleObjectAdditionalPhoneSlots.find((slotId) => {
      const value = String(objectAdditionalPhones?.[slotId - 1]?.phone || '');
      if (requiredObjectAdditionalPhoneSlots.includes(slotId) && !hasMobilePhoneValue(value)) return true;
      return hasMobilePhoneValue(value) && !isValidOptionalMobilePhone(value);
    });
    if (firstInvalidAdditionalPhone) {
      nextObjectFieldErrors[`additional_phone_${firstInvalidAdditionalPhone}`] = t('err_phone');
    }
    setClientObjectFieldErrors(nextObjectFieldErrors);
    if (Object.keys(nextObjectFieldErrors).length > 0) {
      return;
    }
    try {
      const sanitizedDraft = {
        ...createEmptyClientObjectDraft(),
        ...sanitizeClientObjectPayload(clientObjectDraft),
        geo_lat: normalizeCoordinateValue(clientObjectDraft?.geo_lat) || null,
        geo_lng: normalizeCoordinateValue(clientObjectDraft?.geo_lng) || null,
        location_mode: objectLocationMode,
        ...buildObjectAdditionalPhonesPatch(objectAdditionalPhones, {
          defaultLabel: t('order_field_secondary_phone'),
          visibleSlotIds: visibleObjectAdditionalPhoneSlots,
        }),
      };
      if (clientObjectEditorMode === 'update' && selectedClientObjectId) {
        if (!has('canEditObjects')) {
          setClientObjectEditorMode(selectedClientId ? 'persist' : 'draft');
          promptNewObjectCreation(clientObjectDraft);
          return;
        }
        const updated = await updateClientObjectMutation.mutateAsync({
          id: String(selectedClientObjectId),
          patch: {
            ...sanitizeClientObjectPayload(clientObjectDraft),
            geo_lat: normalizeCoordinateValue(clientObjectDraft?.geo_lat) || null,
            geo_lng: normalizeCoordinateValue(clientObjectDraft?.geo_lng) || null,
            location_mode: objectLocationMode,
            ...buildObjectAdditionalPhonesPatch(objectAdditionalPhones, {
              defaultLabel: t('order_field_secondary_phone'),
              visibleSlotIds: visibleObjectAdditionalPhoneSlots,
            }),
          },
        });
        await refetchSelectedClient();
        setSelectedClientObjectId(updated?.id || selectedClientObjectId);
        setWithoutAddressSelected(false);
        setStagedSelectedObjectDraft(null);
        setDraftClientObject(null);
      } else if (clientObjectEditorMode === 'persist' && selectedClientId) {
        setDraftClientObject(sanitizedDraft);
        setSelectedClientObjectId(null);
        setWithoutAddressSelected(false);
      } else {
        setDraftClientObject(sanitizedDraft);
        setSelectedClientObjectId(null);
        setWithoutAddressSelected(false);
      }
      setClientObjectEditorVisible(false);
    } catch (error) {
      showBanner(error?.message || t('clients_save_failed'));
    }
  }, [
    clientObjectDraft,
    clientObjectEditorMode,
    has,
    objectFieldsByKey,
    promptNewObjectCreation,
    refetchSelectedClient,
    selectedClientId,
    selectedClientObjectId,
    showBanner,
    t,
    updateClientObjectMutation,
    enabledObjectAdditionalPhoneSlots,
    requiredObjectAdditionalPhoneSlots,
    visibleClientObjectFieldKeys,
    setWithoutAddressSelected,
  ]);

  const openObjectFlow = useCallback(() => {
    if (selectedClientId) {
      setClientObjectModalVisible(true);
      return;
    }
    setClientObjectEditorMode('draft');
    setClientObjectDraft(draftClientObject || createEmptyClientObjectDraft({ name: t('objects_new') }));
    setClientObjectEditorVisible(true);
  }, [draftClientObject, selectedClientId, t]);

  const openObjectAddressEditor = useCallback(() => {
    if (selectedClientObjectId && !has('canEditObjects')) {
      promptNewObjectCreation(selectedClientObject || activeObjectDraft);
      return;
    }
    const seedDraft =
      activeObjectDraft || draftClientObject || createEmptyClientObjectDraft({ name: t('objects_new') });
    setClientObjectEditorMode(selectedClientObjectId ? 'update' : 'draft');
    setClientObjectDraft(seedDraft);
    setClientObjectEditorVisible(true);
  }, [
    activeObjectDraft,
    draftClientObject,
    has,
    promptNewObjectCreation,
    selectedClientObject,
    selectedClientObjectId,
    t,
  ]);

  if (loading) {
    return (
      <EditScreenTemplate title={t('create_order_title')} scrollEnabled={false}>
        <View style={styles.permissionContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </EditScreenTemplate>
    );
  }

  if (!has('canCreateOrders')) {
    return (
      <EditScreenTemplate title={t('create_order_title')} scrollEnabled={false}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>{t('create_order_no_permission')}</Text>
        </View>
      </EditScreenTemplate>
    );
  }

  return (
    <>
      <EditScreenTemplate title={t('create_order_title')} scrollRef={scrollRef} onBack={handleCancelPress}>
        {banner ? (
          <ScreenBanner
            message={banner}
            onClose={clearBanner}
            style={{ marginBottom: theme.spacing.md }}
          />
        ) : null}
        <SectionHeader topSpacing="xs" bottomSpacing="xs">
          {t('create_order_section_main')}
        </SectionHeader>
        <Card padded={false} style={formStyles.card}>
          {orderedMainFieldKeys.map((fieldKey) => (
            <View key={fieldKey}>{renderCreateMainField(fieldKey)}</View>
          ))}
        </Card>

          <SectionHeader>{t('create_order_section_customer')}</SectionHeader>
          <Card padded={false} style={formStyles.card}>
            {orderedCustomerFieldKeys.map((fieldKey) => (
              <View key={fieldKey}>{renderCreateCustomerField(fieldKey)}</View>
            ))}
          </Card>

          <SectionHeader>{t('create_order_section_planning')}</SectionHeader>
          <Card padded={false} style={formStyles.card}>
            {orderedPlanningFieldKeys.map((fieldKey) => (
              <View key={fieldKey}>{renderCreatePlanningField(fieldKey)}</View>
            ))}
          </Card>

          <View style={styles.buttonContainer}>
            {!subscriptionGuard.canEdit ? (
              <Text style={styles.permissionText}>{t('subscription_read_only_notice')}</Text>
            ) : null}
            <Button
              title={t('create_order_btn_create')}
              onPress={handleSubmit}
              disabled={!subscriptionGuard.canEdit}
            />
          </View>
          <View style={styles.buttonSpacer}>
            <Button
              title={t('create_order_btn_cancel')}
              onPress={handleCancelPress}
              variant="secondary"
            />
          </View>
      </EditScreenTemplate>

      <ConfirmModal
        visible={cancelVisible}
        title={t('create_order_modal_cancel_title')}
        message={t('create_order_modal_cancel_text')}
        confirmLabel={t('create_order_modal_cancel_exit')}
        cancelLabel={t('create_order_modal_cancel_stay')}
        confirmVariant="destructive"
        onConfirm={confirmCancel}
        onClose={() => setCancelVisible(false)}
      />

      <SelectModal
        visible={workTypeModalVisible}
        title={t('create_order_modal_work_type_title')}
        items={workTypeItems}
        searchable={false}
        selectedId={workTypeId}
        onSelect={(item) => {
          if (!item?.id || item.disabled) return;
          try {
            Keyboard.dismiss();
          } catch {}
          setWorkTypeId(String(item.id));
          setWorkTypeModalVisible(false);
        }}
        onClose={() => setWorkTypeModalVisible(false)}
      />

      {!isSoloAdmin ? (
        <SelectModal
          visible={assigneeModalVisible}
          title={t('create_order_modal_executor_title')}
          items={assigneeItems}
          searchable
          filterFn={(item, query) => matchesSearch(item?.searchIndex, query)}
          selectedId={toFeed ? 'feed' : assigneeId}
          onSelect={(item) => item?.onPress?.()}
          onClose={() => setAssigneeModalVisible(false)}
        />
      ) : null}

      <SelectModal
        visible={phoneSourceModalVisible}
        title={t('create_order_phone_source_modal_title')}
        items={phoneSourceItems}
        searchable={false}
        selectedId={phoneSourceId}
        onSelect={(item) => {
          if (!item?.id || item.disabled) return;
          applyPhoneSource(item.id);
          setPhoneSourceModalVisible(false);
        }}
        onClose={() => setPhoneSourceModalVisible(false)}
      />

      <SelectModal
        visible={clientModalVisible}
        title={t('routes_clients_client')}
        maxHeightRatio={Platform.OS === 'android' ? 0.48 : 0.62}
        minTopGapFromStatusBar={40}
        items={clientItems}
        searchable
        searchLabel={null}
        searchPlaceholder={t('order_client_modal_search_placeholder')}
        onSearchChange={setClientModalSearch}
        filterFn={(item, query) => matchesSearch(item?.searchIndex, query)}
        emptyComponent={
          <View style={{ paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.sm }}>
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
              {t('order_client_search_empty_hint')}
            </Text>
          </View>
        }
        footer={
          <View style={{ marginBottom: theme.spacing.lg }}>
            <Button
              title={t('order_client_create_new')}
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
        title={String(previewClient?.fullName || '').trim() || t('common_noName')}
        anchor={previewAnchor}
        rows={previewClientRows}
        tags={previewClientTags}
        tagsTitle={t('tags_field_label')}
        footerActionLabel={has('canViewClients') ? t('common_view') : undefined}
        onFooterAction={has('canViewClients') ? openPreviewClientCard : undefined}
      />

      <QuickPreviewModal
        visible={previewObjectVisible}
        onClose={() => setPreviewObjectVisible(false)}
        title={String(previewObject?.name || '').trim() || t('objects_new')}
        anchor={previewAnchor}
        rows={previewObjectRows}
        footerActionLabel={has('canViewObjects') ? t('common_view') : undefined}
        onFooterAction={has('canViewObjects') ? openPreviewObjectCard : undefined}
      />

      <SelectModal
        visible={clientObjectModalVisible}
        title={t('objects_select')}
        items={clientObjectItems}
        searchable={false}
        footer={
          has('canCreateObjects') ? (
            <View style={{ marginBottom: theme.spacing.lg }}>
              <Button
                title={t('create_order_client_object_add')}
                variant="secondary"
                onPress={() => {
                  setClientObjectModalVisible(false);
                  setClientObjectEditorMode('draft');
                  setWithoutAddressSelected(false);
                  setClientObjectDraft(createEmptyClientObjectDraft({ name: t('objects_new') }));
                  setClientObjectEditorVisible(true);
                }}
              />
            </View>
          ) : null
        }
        selectedId={
          selectedClientObjectId ||
          (draftClientObject ? 'draft-object' : null) ||
          (withoutAddressSelected ? '__no_address__' : null)
        }
        onItemLongPress={openObjectPreview}
        onSelect={(item) => item?.onPress?.()}
        onClose={() => setClientObjectModalVisible(false)}
      />

      <ClientObjectEditorModal
        visible={clientObjectEditorVisible}
        title={t('objects_new_from_order')}
        draft={clientObjectDraft}
        fieldSettings={objectFieldSettings}
        enableAdditionalPhones
        fieldErrors={clientObjectFieldErrors}
        onChange={(field, value) => {
          setClientObjectDraft((prev) => ({ ...prev, [field]: value }));
          setClientObjectFieldErrors((prev) => (prev?.[field] ? { ...prev, [field]: null } : prev));
        }}
        onSave={handleCreateClientObject}
        onClose={() => setClientObjectEditorVisible(false)}
        saveLabel={t('objects_save_object')}
        searchSuggestions={objectSearchSuggestions}
        searchSuggestionsLoading={companyObjectSearchLoading}
        searchSuggestionsVisible={clientObjectEditorMode !== 'update' && objectSearchHasQuery}
        searchSuggestionsEmpty={objectSearchHasQuery && objectSearchSuggestions.length === 0}
        onSelectSuggestion={handleSelectGlobalObjectSuggestion}
      />

      <ConfirmModal
        visible={objectEditPermissionModalVisible}
        title={t('order_object_edit_requires_new_object_title', 'Нельзя изменить текущий объект')}
        message={t(
          'order_object_edit_requires_new_object_message',
          'У вас нет прав на редактирование выбранного объекта. Можно оставить его без изменений или создать новый объект на основе текущих данных.',
        )}
        confirmLabel={t('order_object_edit_requires_new_object_confirm', 'Создать новый')}
        cancelLabel={t('order_object_edit_requires_new_object_cancel', 'Оставить')}
        onConfirm={startNewObjectCreationFromPrompt}
        onClose={keepCurrentObjectWithoutChanges}
      />

      <ConfirmModal
        visible={suggestedMatchingVisible}
        title={t('order_object_match_title')}
        message={
          <View style={{ gap: theme.spacing.sm }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.md }}>
              {suggestedMatchingObject?.clientName
                ? t(
                    'order_object_match_message_with_client',
                    'У клиента {client} найден похожий адрес.',
                  ).replace('{client}', String(suggestedMatchingObject.clientName || '').trim())
                : t('order_object_match_message')}
            </Text>
            <Pressable
              style={{
                borderWidth: theme.components?.card?.borderWidth ?? 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.md,
                backgroundColor: theme.colors.surface,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                gap: 4,
              }}
              delayLongPress={220}
              disabled={!has('canViewObjects')}
              onLongPress={openSuggestedObjectPreview}
            >
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md, fontWeight: '600' }}>
                {String(suggestedMatchingObject?.object?.name || '').trim() || t('objects_new')}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm }}>
                {buildOrderAddressShort(
                  getVisibleObjectAddressDraft(
                    suggestedMatchingObject?.raw || suggestedMatchingObject?.object || {},
                  ),
                ) || t('order_details_address_not_specified')}
              </Text>
            </Pressable>
          </View>
        }
        confirmLabel={t('order_object_match_confirm')}
        cancelLabel={t('order_object_match_keep_new')}
        onConfirm={() => {
          if (suggestedMatchingObject?.raw) {
            handleSelectGlobalObjectSuggestion(suggestedMatchingObject.raw);
          } else {
            setSelectedClientObjectId(suggestedMatchingObject?.object?.id || null);
            setStagedSelectedObjectDraft(null);
            setDraftClientObject(null);
            setIgnoredMatchSignature('');
          }
        }}
        onClose={() => {
          setIgnoredMatchSignature(String(suggestedMatchingObject?.signature || ''));
          setSuggestedMatchingVisible(false);
        }}
      />

      <ConfirmModal
        visible={draftRestoreVisible}
        title={t('create_order_modal_draft_restore_title')}
        message={t('create_order_modal_draft_restore_message')}
        confirmLabel={t('create_order_modal_draft_restore_confirm')}
        cancelLabel={t('create_order_modal_draft_restore_cancel')}
        onConfirm={async () => {
          restoreDraft(savedDraft);
          setDraftRestoreVisible(false);
          setSavedDraft(null);
        }}
        onClose={async () => {
          await deleteDraft();
          setDraftRestoreVisible(false);
          setSavedDraft(null);
        }}
      />
    </>
  );
}

export default function CreateOrderScreen() {
  return (
    <DeferredScreen>
      <CreateOrderContent />
    </DeferredScreen>
  );
}

function createStyles(theme) {
  const sp = theme.spacing || {};
  const typo = theme.typography || {};
  const rad = theme.radii || {};
  const col = theme.colors || {};
  const sep = theme.components?.input?.separator || {};
  const insetKey = sep.insetX || 'lg';
  const sepHeight = sep.height ?? theme.components?.listItem?.dividerWidth ?? 1;
  const alpha = sep.alpha ?? 0.18;
  const sepColor = withAlpha(col.primary, alpha);
  const toggleTrackOffColor = col.inputBorder || col.border;
  const ml = Number(sp?.[insetKey] ?? 0) || 0;
  const mr = Number(sp?.[insetKey] ?? 0) || 0;

  const TOGGLE_WIDTH = 42;
  const TOGGLE_HEIGHT = 24;
  const KNOB_SIZE = 20;
  const INPUT_MULTILINE_HEIGHT = 100;

  return StyleSheet.create({
    permissionContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: sp.xl || 24,
    },
    permissionText: {
      fontSize: typo.sizes?.md || 16,
      color: col.textSecondary,
      textAlign: 'center',
    },
    fieldContainer: {
      paddingVertical: sp.xs || 6,
    },
    input: {
      borderWidth: 1,
      borderColor: col.border,
      backgroundColor: col.inputBg,
      color: col.text,
      borderRadius: rad.md || 10,
      padding: sp.md || 10,
      fontSize: typo.sizes?.md || 16,
      marginTop: sp.xs || 4,
    },
    inputMultiline: {
      height: INPUT_MULTILINE_HEIGHT,
      textAlignVertical: 'top',
    },
    selectInput: {
      borderWidth: 1,
      borderColor: col.border,
      borderRadius: rad.md || 10,
      backgroundColor: col.inputBg,
      padding: sp.md || 12,
      marginTop: sp.xs || 4,
    },
    selectInputDisabled: {
      opacity: 0.5,
    },
    separator: {
      height: sepHeight,
      backgroundColor: sepColor,
      marginLeft: ml,
      marginRight: mr,
    },
    toggleLabel: {
      color: col.text,
      fontSize: typo.sizes?.md || 16,
      fontWeight: typo.weight?.medium || '500',
    },
    toggle: {
      width: TOGGLE_WIDTH,
      height: TOGGLE_HEIGHT,
      borderRadius: TOGGLE_HEIGHT / 2,
      backgroundColor: toggleTrackOffColor,
      padding: 2,
      justifyContent: 'center',
    },
    toggleOn: {
      backgroundColor: col.primary,
    },
    knob: {
      width: KNOB_SIZE,
      height: KNOB_SIZE,
      borderRadius: KNOB_SIZE / 2,
      backgroundColor: col.surface,
      alignSelf: 'flex-start',
    },
    knobOn: {
      alignSelf: 'flex-end',
    },
    buttonContainer: {
      marginTop: sp.lg || 20,
    },
    buttonSpacer: {
      marginTop: sp.md || 12,
    },
  });
}
