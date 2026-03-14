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
import { withAlpha } from '../../theme/colors';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { useSubscriptionGuard } from '../../hooks/useSubscriptionGuard';
import { useClient, useClients, useUpdateClientMutation } from '../../src/features/clients/queries';
import { collectClientPhoneSearchValues } from '../../src/features/clients/additionalPhones';
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
  toE164MobilePhoneOrNull,
} from '../../src/shared/validation/phone';
import {
  getEmailFieldError,
  getRequiredTextFieldError,
  normalizeOptionalEmail,
} from '../../src/shared/validation/fields';
import { formatRuMask } from '../../components/ui/phone';
import {
  CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS,
  CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS,
  buildClientObjectFullAddress,
  buildClientObjectShortAddress,
  createEmptyClientObjectDraft,
  hasClientObjectAddressContent,
  sanitizeClientObjectPayload,
} from '../../src/features/objects/addressing';
import {
  buildOrderAddressDisplay,
  buildOrderAddressShort,
  extractOrderAddressFromObject,
  toOrderAddressPatch,
} from '../../src/features/requests/addressing';
import {
  findBestMatchingClientObject,
  findExactMatchingClientObject,
} from '../../src/features/objects/matching';

const DEFAULT_FIELDS = [
  { field_key: 'title', label: null, type: 'text', position: 10, required: true },
  { field_key: 'phone', label: null, type: 'phone', position: 30 },
  { field_key: 'secondary_phone', label: null, type: 'phone', position: 112 },
  { field_key: 'contact_email', label: null, type: 'text', position: 114 },
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
  'office',
  'floor',
  'entrance',
  'apartment',
  'entrance_info',
  'parking_notes',
  'geo_lat',
  'geo_lng',
]);

const SCROLL_ANIMATION_DELAY = 200;
const ORDER_CLIENT_FLOW_STORAGE_PREFIX = 'order_client_flow:';

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

export default function CreateOrderScreen() {
  const { has, loading } = usePermissions();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { profile } = useAuthContext();
  const subscriptionGuard = useSubscriptionGuard(profile?.company_id || null);
  const { settings: companySettings, useDepartureTime } = useCompanySettings();
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
  const [departureEndDate, setDepartureEndDate] = useState(null);
  const [isDepartureRange, setIsDepartureRange] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [assigneeId, setAssigneeId] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [selectedClientObjectId, setSelectedClientObjectId] = useState(null);
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
  const [draftRestoreVisible, setDraftRestoreVisible] = useState(false);
  const [savedDraft, setSavedDraft] = useState(null);
  const { data: companyId } = useMyCompanyIdQuery();
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
    const office = String(draftClientObject?.office || '').trim();
    return {
      query: [city, street, house, apartment, office, entrance].filter(Boolean).join(' ').trim(),
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
  const clientFlowKeyRef = useRef(
    `create-order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const setField = useCallback((key, val) => setForm((s) => ({ ...s, [key]: val })), []);
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
        fieldKeys: ['client_id', 'object_id', 'phone', 'secondary_phone', 'contact_email'],
      }).map((field) => field.fieldKey),
    [orderFieldSettings],
  );
  const orderedPlanningFieldKeys = useMemo(
    () =>
      getOrderedEntityFields(orderFieldSettings, {
        visibleOnly: true,
        requiredFirst: true,
        fieldKeys: ['urgent', 'time_window_start', 'assigned_to'],
      }).map((field) => field.fieldKey),
    [orderFieldSettings],
  );
  const objectFieldsByKey = useMemo(() => new Map((objectFieldSettings?.fields || []).map((field) => [String(field.fieldKey || field.field_key || ''), field])), [objectFieldSettings]);

  const DRAFT_KEY = 'draft_create_order';

  // � � � Ћ� � С•� ЎвЂ¦� Ў� ‚� � В°� � � …� � С‘� ЎвЂљ� Ў� Љ � ЎвЂЎ� � Вµ� Ў� ‚� � � …� � С•� � � � � � С‘� � С”
  const saveDraft = useCallback(async () => {
    try {
      const draft = {
        form,
        description,
        departureDate: departureDate?.toISOString(),
        departureEndDate: departureEndDate?.toISOString(),
        isDepartureRange,
        workTypeId,
        assigneeId,
        selectedClientId,
        selectedClientObjectId,
        stagedSelectedObjectDraft,
        draftClientObject,
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
    departureEndDate,
    isDepartureRange,
    workTypeId,
    assigneeId,
    selectedClientId,
    selectedClientObjectId,
    stagedSelectedObjectDraft,
    draftClientObject,
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
    setForm(draft.form || {});
    setDescription(draft.description || '');
    setDepartureDate(draft.departureDate ? new Date(draft.departureDate) : null);
    setDepartureEndDate(draft.departureEndDate ? new Date(draft.departureEndDate) : null);
    setIsDepartureRange(!!draft.isDepartureRange);
    setWorkTypeId(draft.workTypeId || null);
    setAssigneeId(draft.assigneeId || null);
    setSelectedClientId(draft.selectedClientId || null);
    setSelectedClientObjectId(draft.selectedClientObjectId || null);
    setStagedSelectedObjectDraft(draft.stagedSelectedObjectDraft || null);
    setDraftClientObject(draft.draftClientObject || null);
    setUrgent(draft.urgent || false);
    setToFeed(draft.toFeed || false);
  }, []);

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
    return (
      !!(form.title?.trim()) ||
      !!(form.secondary_phone?.trim()) ||
      !!(form.contact_email?.trim()) ||
      !!(form.phone?.trim()) ||
      !!description?.trim() ||
      !!departureDate ||
      !!departureEndDate ||
      !!isDepartureRange ||
      !!workTypeId ||
      !!assigneeId ||
      !!selectedClientId ||
      !!selectedClientObjectId ||
      !!stagedSelectedObjectDraft ||
      !!draftClientObject ||
      !!urgent ||
      !!toFeed
    );
  }, [
    form,
    description,
    departureDate,
    departureEndDate,
    isDepartureRange,
    workTypeId,
    assigneeId,
    selectedClientId,
    selectedClientObjectId,
    stagedSelectedObjectDraft,
    draftClientObject,
    urgent,
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
      } else if (key === 'assigned_to') {
        scrollToHandle(dateFieldRef);
      }
    },
    [scrollToHandle],
  );

  const normalizePhone = useCallback((val) => toE164MobilePhoneOrNull(val), []);

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
        office: t('order_field_office'),
        floor: t('order_field_floor'),
        entrance: t('order_field_entrance'),
        apartment: t('order_field_apartment'),
        secondary_phone: t('order_field_secondary_phone'),
        contact_email: t('order_field_contact_email'),
        time_window_start: t('create_order_label_date'),
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
          if (!selectedClientObjectId && !draftClientObject) {
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
  }, [schema, form, departureDate, toFeed, assigneeId, normalizePhone, getFieldLabel, t, selectedClientId, selectedClientObjectId, draftClientObject, useWorkTypes, workTypeId, description]);

  const promptNewObjectCreation = useCallback(
    (seedDraft = null) => {
      const nextDraft = seedDraft
        ? {
            ...createEmptyClientObjectDraft({ name: t('objects_new') }),
            ...sanitizeClientObjectPayload(seedDraft),
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

    const title = (form.title || '').trim();
    const nextErrors = {};
    if (isFieldRequired('work_type_id') && useWorkTypes && !workTypeId) {
      nextErrors.work_type_id = { message: t('order_validation_work_type_required') };
    }
    if (isFieldRequired('title') && !title) {
      nextErrors.title = { message: t('order_validation_title_required') };
    }
    if (isFieldRequired('time_window_start') && !departureDate) {
      nextErrors.time_window_start = { message: t('order_validation_date_required') };
    }
    if (isDepartureRange && (!departureEndDate || departureEndDate < departureDate)) {
      nextErrors.time_window_start = { message: t('order_validation_date_range_invalid') };
    }
    if (isFieldRequired('assigned_to') && !toFeed && !assigneeId) {
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
    const normalizedSecondaryPhone = normalizePhone(form.secondary_phone);
    if (hasMobilePhoneValue(form.secondary_phone) && !normalizedSecondaryPhone) {
      setFieldErrors((prev) => ({
        ...prev,
        secondary_phone: { message: t('order_validation_phone_format') },
      }));
      focusField('secondary_phone');
      return;
    }
    const contactEmailError = getEmailFieldError(form.contact_email, {
      required: isFieldRequired('contact_email'),
      requiredMessage: requiredMsg,
      t,
    });
    if (contactEmailError) {
      setFieldErrors((prev) => ({
        ...prev,
        contact_email: { message: contactEmailError },
      }));
      focusField('contact_email');
      return;
    }
    const normalizedContactEmail = normalizeOptionalEmail(form.contact_email);

    if (isFieldRequired('client_id') && !selectedClientId) {
      setFieldErrors((prev) => ({
        ...prev,
        client_id: { message: t('order_validation_client_required') },
      }));
      focusField('client_id');
      return;
    }

    if (isFieldRequired('object_id') && !selectedClientObjectId && !draftClientObject) {
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
      await updateClientMutation.mutateAsync({
        id: String(selectedClientId),
        patch: {
          phone: normalizedPhone,
          email: normalizedContactEmail,
          secondary_phone: normalizedSecondaryPhone,
        },
      });
    }

    let resolvedObject = stagedSelectedObjectDraft || selectedClientObject;
    let resolvedObjectId = selectedClientObjectId || null;
    if (resolvedObjectId && stagedSelectedObjectDraft) {
      if (!has('canEditObjects')) {
        promptNewObjectCreation(stagedSelectedObjectDraft);
        return;
      }
      const updated = await updateClientObjectMutation.mutateAsync({
        id: String(resolvedObjectId),
        patch: sanitizeClientObjectPayload(stagedSelectedObjectDraft),
      });
      await refetchSelectedClient();
      resolvedObject = updated || stagedSelectedObjectDraft;
      setStagedSelectedObjectDraft(null);
    }
    if (!resolvedObjectId && draftClientObject) {
      if (!hasClientObjectAddressContent(draftClientObject)) {
        showBanner({
          type: 'warning',
          message: t('order_validation_address_required'),
        });
        return;
      }
      const exactMatchingObject = findExactMatchingClientObject(draftClientObject, clientObjects);
      if (exactMatchingObject) {
        resolvedObject = exactMatchingObject;
        resolvedObjectId = exactMatchingObject?.id || null;
        setSelectedClientObjectId(exactMatchingObject?.id || null);
      } else {
        const createdObject = await createClientObjectMutation.mutateAsync({
          client_id: String(selectedClientId),
          ...sanitizeClientObjectPayload(draftClientObject),
        });
        resolvedObject = createdObject || null;
        resolvedObjectId = createdObject?.id || null;
        setSelectedClientObjectId(createdObject?.id || null);
      }
      setDraftClientObject(null);
    }

    const resolvedAddressDraft = resolvedObject
      ? extractOrderAddressFromObject(resolvedObject)
      : null;
    if (!buildOrderAddressShort(resolvedAddressDraft)) {
      showBanner({
        type: 'warning',
        message: t('order_validation_address_required'),
      });
      return;
    }

    const payload = {
      company_id: effectiveCompanyId || null,
      title: form.title ?? '',
      work_type_id: useWorkTypes ? normalizedWorkTypeId || null : null,
      comment: description,
      client_id: selectedClientId || null,
      object_id: resolvedObjectId || null,
      address_mode: 'object',
      object_name_snapshot: String(resolvedObject?.name || '').trim() || null,
      ...toOrderAddressPatch(resolvedAddressDraft),
      assigned_to: toFeed ? null : assigneeId,
      time_window_start: departureDate ? departureDate.toISOString() : null,
      time_window_end: isDepartureRange && departureEndDate ? departureEndDate.toISOString() : null,
      status: toFeed ? t('order_status_in_feed') : t('order_status_new'),
      urgent,
      currency: companySettings?.currency ?? null,
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
    departureEndDate,
    isDepartureRange,
    toFeed,
    assigneeId,
    selectedClientId,
    selectedClientObjectId,
    selectedClientObject,
    draftClientObject,
    getField,
    isFieldRequired,
    normalizePhone,
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
    subscriptionGuard.canEdit,
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
        .select('id, first_name, last_name, role')
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
      const label = withRequiredLabel(getFieldLabel(key), isFieldRequired(key));
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
      [u?.first_name, u?.last_name].filter(Boolean).join(' ') ||
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
  const selectedClientObjectSummary = useMemo(
    () => String(activeObjectDraft?.name || '').trim() || null,
    [activeObjectDraft],
  );
  const activeAddressDraft = useMemo(
    () => extractOrderAddressFromObject(activeObjectDraft),
    [activeObjectDraft],
  );
  const visibleObjectAddressFieldKeys = useMemo(
    () =>
      Object.keys(activeAddressDraft || {}).filter(
        (field) => objectFieldsByKey.get(field)?.isEnabled !== false,
      ),
    [activeAddressDraft, objectFieldsByKey],
  );
  const visibleClientObjectFieldKeys = useMemo(
    () =>
      ['name', ...CLIENT_OBJECT_PRIMARY_ADDRESS_FIELDS, ...CLIENT_OBJECT_ADDITIONAL_INFO_FIELDS].filter(
        (field) => objectFieldsByKey.get(field)?.isEnabled !== false,
      ),
    [objectFieldsByKey],
  );
  const shortAddressValue = useMemo(
    () =>
      buildOrderAddressDisplay(
        visibleObjectAddressFieldKeys.reduce(
          (acc, field) => ({ ...acc, [field]: activeAddressDraft?.[field] || '' }),
          {},
        ),
      ) ||
      buildClientObjectFullAddress(activeObjectDraft) ||
      buildOrderAddressShort(
        visibleObjectAddressFieldKeys.reduce(
          (acc, field) => ({ ...acc, [field]: activeAddressDraft?.[field] || '' }),
          {},
        ),
      ) ||
      t('order_details_address_not_specified'),
    [activeAddressDraft, activeObjectDraft, t, visibleObjectAddressFieldKeys],
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
            value: form.title || '',
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
      form.title,
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
                        setPendingSuggestedObjectSelection(null);
                        setStagedSelectedObjectDraft(null);
                        setSuggestedMatchingObject(null);
                        setSuggestedMatchingVisible(false);
                        setField('phone', '');
                        setField('secondary_phone', '');
                        setField('contact_email', '');
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
                value={selectedClientObjectSummary || t('create_order_client_object_placeholder')}
                pressable
                style={formStyles.field}
                onPress={openObjectFlow}
                error={shouldShowError('object_id') && fieldErrors?.object_id ? 'invalid' : undefined}
                rightSlot={
                  selectedClientObjectId || draftClientObject ? (
                    <ClearButton
                      onPress={() => {
                        setSelectedClientObjectId(null);
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
              {activeObjectDraft && visibleObjectAddressFieldKeys.length ? (
                <TextField
                  label={t('order_details_address')}
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
          return renderPhoneInput('phone');
        case 'secondary_phone':
          return selectedClientId ? renderPhoneInput('secondary_phone') : null;
        case 'contact_email':
          if (!selectedClientId) return null;
          return renderTextField({
            fieldKey: 'contact_email',
            label: getFieldLabel('contact_email'),
            placeholder: t('create_order_placeholder_contact_email'),
            value: form.contact_email || '',
            onChangeText: (text) => setField('contact_email', text),
            keyboardType: 'email-address',
            required: isFieldRequired('contact_email'),
          });
        default:
          return null;
      }
    },
    [
      activeObjectDraft,
      draftClientObject,
      fieldErrors,
      form.contact_email,
      formStyles.field,
      getField,
      getFieldLabel,
      isFieldRequired,
      openObjectAddressEditor,
      openObjectFlow,
      renderPhoneInput,
      renderTextField,
      selectedClientId,
      selectedClientName,
      selectedClientObjectId,
      selectedClientObjectSummary,
      setField,
      shortAddressValue,
      shouldShowError,
      t,
      visibleObjectAddressFieldKeys.length,
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
                  setDepartureDate((prev) => {
                    if (!nextStart) return null;
                    if (!prev) return nextStart;
                    const d = new Date(nextStart);
                    d.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
                    return d;
                  });
                  setDepartureEndDate(null);
                }}
                onClose={() => setShowDatePicker(false)}
              />

              {useDepartureTime && !isDepartureRange ? (
                <>
                  <TextField
                    label={t('create_order_label_time')}
                    value={formatTime(departureDate) || t('create_order_placeholder_time')}
                    pressable
                    style={formStyles.field}
                    ref={timeFieldRef}
                    rightSlot={
                      departureDate ? (
                        <ClearButton
                          onPress={() => {
                            const d = new Date(departureDate);
                            d.setHours(0, 0, 0, 0);
                            setDepartureDate(d);
                          }}
                          accessibilityLabel={t('common_clear')}
                        />
                      ) : null
                    }
                    onPress={() => {
                      if (!departureDate) {
                        setShowDatePicker(true);
                        setTimeout(() => scrollToHandle(dateFieldRef), SCROLL_ANIMATION_DELAY);
                        return;
                      }
                      setShowTimePicker(true);
                      setTimeout(() => scrollToHandle(timeFieldRef), SCROLL_ANIMATION_DELAY);
                    }}
                  />

                  <DateTimeModal
                    visible={showTimePicker && !!departureDate}
                    initial={departureDate || new Date()}
                    mode="time"
                    onApply={(selected) => {
                      if (selected) {
                        setDepartureDate((prev) => {
                          const baseDate = prev || new Date();
                          const d = new Date(baseDate);
                          d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
                          return d;
                        });
                      }
                    }}
                    onClose={() => setShowTimePicker(false)}
                  />
                </>
              ) : null}
            </>
          );
        case 'assigned_to':
          return (
            <>
              {renderToggle(
                toFeed,
                () => {
                  setToFeed((prev) => {
                    const nextValue = !prev;
                    if (nextValue) setAssigneeId(null);
                    return nextValue;
                  });
                },
                t('create_order_label_to_feed'),
              )}

              <TextField
                label={withRequiredLabel(
                  getFieldLabel('assigned_to', t('create_order_label_executor')),
                  !toFeed && isFieldRequired('assigned_to'),
                )}
                value={
                  toFeed
                    ? t('create_order_executor_in_feed')
                    : selectedAssigneeName || t('create_order_executor_placeholder')
                }
                pressable
                style={formStyles.field}
                onPress={() => {
                  if (toFeed) return;
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
      departureDateDisplayLabel,
      fieldErrors,
      formatTime,
      formStyles.field,
      getField,
      getFieldLabel,
      isDepartureRange,
      isFieldRequired,
      renderToggle,
      scrollToHandle,
      selectedAssigneeName,
      showDatePicker,
      showTimePicker,
      shouldShowError,
      t,
      toFeed,
      urgent,
      useDepartureTime,
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
      shortAddress: top.shortAddress || '',
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
    const office = String(objectSearchSourceDraft?.office || '').trim();
    return {
      query: [city, street, house, apartment, office, entrance].filter(Boolean).join(' ').trim(),
      street,
      house,
      city,
      clientId: selectedClientId || null,
    };
  }, [objectSearchSourceDraft, selectedClientId]);
  const objectSearchSuggestions = useMemo(
    () =>
      (Array.isArray(companyObjectSearchResults) ? companyObjectSearchResults : []).filter(
        (item) => String(item?.objectId || '') !== String(selectedClientObjectId || ''),
      ),
    [companyObjectSearchResults, selectedClientObjectId],
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
    setForm((prev) => ({
      ...prev,
      phone: String(selectedClient.phone || prev.phone || '').trim(),
      secondary_phone: String(selectedClient.secondaryPhone || prev.secondary_phone || '').trim(),
      contact_email: String(selectedClient.email || prev.contact_email || '').trim(),
    }));
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
    const items = [
      {
        id: 'feed',
        label: t('create_order_executor_in_feed'),
        onPress: () => {
          setToFeed(true);
          setAssigneeId(null);
          setAssigneeModalVisible(false);
        },
      },
    ];
    users.forEach((user) => {
      const label = [user.first_name, user.last_name].filter(Boolean).join(' ');
      items.push({
        id: user.id,
        label: label || user.email || String(user.id),
        onPress: () => {
          setAssigneeId(user.id);
          setToFeed(false);
          setAssigneeModalVisible(false);
        },
      });
    });
    return items;
  }, [users, t]);

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
        setClientModalVisible(false);
      },
    }));
  }, [clients, t]);

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
    const fullAddress =
      buildClientObjectFullAddress(previewObject) || previewObject.shortAddress || '';
    return [
      {
        key: 'client',
        label: t('routes_clients_client'),
        value: String(previewObject.clientName || '').trim(),
      },
      {
        key: 'address',
        label: t('order_details_address'),
        value: fullAddress || t('order_details_address_not_specified'),
      },
      {
        key: 'entrance_info',
        label: t('order_field_entrance_info'),
        value: String(previewObject.entrance_info || '').trim(),
      },
      {
        key: 'parking_notes',
        label: t('order_field_parking_notes'),
        value: String(previewObject.parking_notes || '').trim(),
      },
    ].filter((row) => String(row?.value || '').trim());
  }, [previewObject, t]);

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
          shortAddress: suggestedMatchingObject.raw.shortAddress,
        }
      : {
          ...(suggestedMatchingObject?.object || {}),
          clientName: suggestedMatchingObject?.clientName || selectedClientName || '',
          shortAddress: suggestedMatchingObject?.shortAddress || '',
        };
    if (!sourceObject?.id) return;
    const pageX = Number(event?.nativeEvent?.pageX);
    const pageY = Number(event?.nativeEvent?.pageY);
    if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
      setPreviewAnchor({ x: pageX, y: pageY });
    }
    setPreviewObject(sourceObject);
    setPreviewObjectVisible(true);
  }, [has, selectedClientName, suggestedMatchingObject]);

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
      office: item.office || '',
      floor: item.floor || '',
      entrance: item.entrance || '',
      apartment: item.apartment || '',
      entrance_info: item.entrance_info || '',
      parking_notes: item.parking_notes || '',
      geo_lat: item.geo_lat || '',
      geo_lng: item.geo_lng || '',
    };
    setPendingSuggestedObjectSelection({
      clientId: item.clientId,
      objectId: item.objectId,
      objectDraft: nextObjectDraft,
    });
    setSelectedClientId(item.clientId);
    setSelectedClientObjectId(item.objectId);
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
    const items = [];
    if (draftClientObject) {
      items.push({
        id: 'draft-object',
        label: sanitizeVisibleText(String(draftClientObject.name || '').trim(), t('objects_new')),
        subtitle: buildClientObjectShortAddress(draftClientObject) || undefined,
        onPress: () => {
          setClientObjectModalVisible(false);
          setClientObjectEditorMode('draft');
          setClientObjectDraft(draftClientObject);
          setClientObjectEditorVisible(true);
        },
      });
    }
    if (!clientObjects.length && items.length === 0) {
      return [{ id: 'empty', label: t('objects_empty'), disabled: true }];
    }
    return [
      ...items,
      ...clientObjects.map((objectItem) => ({
        id: objectItem.id,
        label: objectItem.is_primary
          ? sanitizeVisibleText([objectItem.name, t('objects_primary')].filter(Boolean).join(' - '), t('objects_new'))
          : sanitizeVisibleText(objectItem.name, t('objects_new')),
        subtitle: buildClientObjectShortAddress(objectItem) || undefined,
        objectRaw: objectItem,
        onPress: () => {
          setSelectedClientObjectId(objectItem.id);
          setStagedSelectedObjectDraft(null);
          setDraftClientObject(null);
          setClientObjectModalVisible(false);
        },
      })),
    ];
  }, [clientObjects, draftClientObject, t]);

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
      shortAddress: buildClientObjectShortAddress(objectItem) || '',
    });
    setPreviewObjectVisible(true);
  }, [has, selectedClientName]);

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
    const nextObjectFieldErrors = visibleClientObjectFieldKeys.reduce((acc, field) => {
      const message = getRequiredTextFieldError(clientObjectDraft?.[field], {
        required: objectFieldsByKey.get(field)?.isRequired === true,
        requiredMessage: getMessageByCode(FEEDBACK_CODES.REQUIRED_FIELD, t),
      });
      if (!message) return acc;
      return { ...acc, [field]: message };
    }, {});
    setClientObjectFieldErrors(nextObjectFieldErrors);
    if (Object.keys(nextObjectFieldErrors).length > 0) {
      return;
    }
    if (
      !hasClientObjectAddressContent(
        visibleObjectAddressFieldKeys.reduce(
          (acc, field) => ({ ...acc, [field]: clientObjectDraft?.[field] || '' }),
          {},
        ),
      )
    ) {
      showBanner({
        type: 'warning',
        message: t('order_validation_address_required'),
      });
      return;
    }
    try {
      const sanitizedDraft = {
        ...createEmptyClientObjectDraft(),
        ...sanitizeClientObjectPayload(clientObjectDraft),
      };
      if (clientObjectEditorMode === 'update' && selectedClientObjectId) {
        if (!has('canEditObjects')) {
          setClientObjectEditorMode(selectedClientId ? 'persist' : 'draft');
          promptNewObjectCreation(clientObjectDraft);
          return;
        }
        const updated = await updateClientObjectMutation.mutateAsync({
          id: String(selectedClientObjectId),
          patch: sanitizeClientObjectPayload(clientObjectDraft),
        });
        await refetchSelectedClient();
        setSelectedClientObjectId(updated?.id || selectedClientObjectId);
        setStagedSelectedObjectDraft(null);
        setDraftClientObject(null);
      } else if (clientObjectEditorMode === 'persist' && selectedClientId) {
        setDraftClientObject(sanitizedDraft);
        setSelectedClientObjectId(null);
      } else {
        setDraftClientObject(sanitizedDraft);
        setSelectedClientObjectId(null);
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
    visibleClientObjectFieldKeys,
    visibleObjectAddressFieldKeys,
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

      <SelectModal
        visible={assigneeModalVisible}
        title={t('create_order_modal_executor_title')}
        items={assigneeItems}
        searchable
        onSelect={(item) => item?.onPress?.()}
        onClose={() => setAssigneeModalVisible(false)}
      />

      <SelectModal
        visible={clientModalVisible}
        title={t('routes_clients_client')}
        maxHeightRatio={Platform.OS === 'android' ? 0.58 : 0.68}
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
                  setClientObjectDraft(createEmptyClientObjectDraft({ name: t('objects_new') }));
                  setClientObjectEditorVisible(true);
                }}
              />
            </View>
          ) : null
        }
        selectedId={selectedClientObjectId || (draftClientObject ? 'draft-object' : null)}
        onItemLongPress={openObjectPreview}
        onSelect={(item) => item?.onPress?.()}
        onClose={() => setClientObjectModalVisible(false)}
      />

      <ClientObjectEditorModal
        visible={clientObjectEditorVisible}
        title={t('objects_new_from_order')}
        draft={clientObjectDraft}
        fieldSettings={objectFieldSettings}
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
                {suggestedMatchingObject?.shortAddress || t('order_details_address_not_specified')}
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
  const ml = Number(sp?.[insetKey] ?? 0) || 0;
  const mr = Number(sp?.[insetKey] ?? 0) || 0;

  const TOGGLE_WIDTH = 42;
  const TOGGLE_HEIGHT = 26;
  const KNOB_SIZE = 22;
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
      fontWeight: typo.weight?.regular || '400',
    },
    toggle: {
      width: TOGGLE_WIDTH,
      height: TOGGLE_HEIGHT,
      borderRadius: TOGGLE_HEIGHT / 2,
      backgroundColor: col.border,
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
