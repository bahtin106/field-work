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
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import EditScreenTemplate, { useEditFormStyles } from '../../components/layout/EditScreenTemplate';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import ClearButton from '../../components/ui/ClearButton';
import SectionHeader from '../../components/ui/SectionHeader';
import { listItemStyles } from '../../components/ui/listItemStyles';
import TextField from '../../components/ui/TextField';
import PhoneInput from '../../components/ui/PhoneInput';
import { ConfirmModal, DateTimeModal, SelectModal } from '../../components/ui/modals';
import { useFeedback, ScreenBanner, FieldErrorText, normalizeError, FEEDBACK_CODES, getMessageByCode } from '../../src/shared/feedback';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { usePermissions } from '../../lib/permissions';
import { buildCustomPayload, fetchFormSchema } from '../../lib/settings';
import { supabase } from '../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../lib/workTypes';
import { getLocale } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import { withAlpha } from '../../theme/colors';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { useSubscriptionGuard } from '../../hooks/useSubscriptionGuard';
import { useClients } from '../../src/features/clients/queries';
import { useMyCompanyIdQuery } from '../../src/features/profile/queries';

const DEFAULT_FIELDS = [
  { field_key: 'title', label: null, type: 'text', position: 10, required: true },
  { field_key: 'fio', label: null, type: 'text', position: 20 },
  { field_key: 'phone', label: null, type: 'phone', position: 30 },
  { field_key: 'region', label: null, type: 'text', position: 40 },
  { field_key: 'city', label: null, type: 'text', position: 50 },
  { field_key: 'street', label: null, type: 'text', position: 60 },
  { field_key: 'house', label: null, type: 'text', position: 70 },
];

const SCROLL_ANIMATION_DELAY = 200;
const PHONE_REGEX = /^7\d{10}$/;

export default function CreateOrderScreen() {
  const { has, loading } = usePermissions();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { profile } = useAuthContext();
  const subscriptionGuard = useSubscriptionGuard(profile?.company_id || null);
  const { settings: companySettings, useDepartureTime } = useCompanySettings();
  const formStyles = useEditFormStyles();
  const requiredSuffix = t('common_required_suffix');
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
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [assigneeId, setAssigneeId] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState(null);
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
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);
  const [draftRestoreVisible, setDraftRestoreVisible] = useState(false);
  const [savedDraft, setSavedDraft] = useState(null);
  const { data: companyId } = useMyCompanyIdQuery();
  const { data: clients = [] } = useClients(
    { companyId, search: '' },
    { enabled: !!companyId && has('canViewClients') },
  );
  
  const intentionalExitRef = useRef(false);

  const setField = useCallback((key, val) => setForm((s) => ({ ...s, [key]: val })), []);

  const DRAFT_KEY = 'draft_create_order';

  // – ¬ – –ã– ¬ –°‚Ä¢– –é–≤–Ç¬¶– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Äò– –é–≤–Ç—ô– –é– –â – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù
  const saveDraft = useCallback(async () => {
    try {
      const draft = {
        form,
        description,
        departureDate: departureDate?.toISOString(),
        workTypeId,
        assigneeId,
        selectedClientId,
        urgent,
        toFeed,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
      console.warn('[CreateOrder] Save draft failed:', e);
    }
  }, [form, description, departureDate, workTypeId, assigneeId, selectedClientId, urgent, toFeed]);

  // – ¬ –≤–Ç‚Äù– ¬ –í¬∞– ¬ –°‚Äì– –é– ‚Äö– –é–°‚Äú– ¬ –í¬∑– ¬ –°‚Äò– –é–≤–Ç—ô– –é– –â – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù
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

  // – ¬ – ‚Ç¨– ¬ –¢‚Äò– ¬ –í¬∞– ¬ –í¬ª– ¬ –°‚Äò– –é–≤–Ç—ô– –é– –â – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù
  const deleteDraft = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      console.warn('[CreateOrder] Delete draft failed:', e);
    }
  }, []);

  // – ¬ –≤–Ç‚Ñ¢– ¬ –°‚Ä¢– –é– —ì– –é– —ì– –é–≤–Ç—ô– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– –é–≤–Ç—ô– –é– –â – ¬ –¢‚Äò– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ – ‚Ä¶– –é–≤–Ç‚Ññ– ¬ –í¬µ – ¬ –°‚Äò– ¬ –í¬∑ – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù– ¬ –í¬∞
  const restoreDraft = useCallback((draft) => {
    if (!draft) return;
    setForm(draft.form || {});
    setDescription(draft.description || '');
    setDepartureDate(draft.departureDate ? new Date(draft.departureDate) : null);
    setWorkTypeId(draft.workTypeId || null);
    setAssigneeId(draft.assigneeId || null);
    setSelectedClientId(draft.selectedClientId || null);
    setUrgent(draft.urgent || false);
    setToFeed(draft.toFeed || false);
  }, []);

  const withRequiredLabel = useCallback(
    (label, required) => {
      if (!required || !label) return label;
      if (String(label).includes('*')) return label;
      return `${label}${requiredSuffix}`;
    },
    [requiredSuffix],
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

  // – ¬ –°—ü– –é– ‚Äö– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –í¬µ– –é– ‚Äö– –é– –è– ¬ –í¬µ– ¬ –°¬ò – ¬ –í¬µ– –é– —ì– –é–≤–Ç—ô– –é– –â – ¬ –í¬ª– ¬ –°‚Äò – ¬ – ‚Ä¶– ¬ –í¬µ– ¬ –°‚Äî– –é–°‚Äú– –é– —ì– –é–≤–Ç—ô– –é–≤–Ç‚Ññ– ¬ –í¬µ – ¬ –¢‚Äò– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ – ‚Ä¶– –é–≤–Ç‚Ññ– ¬ –í¬µ – ¬ – ‚Ä  – –é–≤–Ç—õ– ¬ –°‚Ä¢– –é– ‚Äö– ¬ –°¬ò– ¬ –í¬µ
  const hasChanges = useCallback(() => {
    return (
      !!(form.title?.trim()) ||
      !!(form.region?.trim()) ||
      !!(form.city?.trim()) ||
      !!(form.street?.trim()) ||
      !!(form.house?.trim()) ||
      !!(form.fio?.trim()) ||
      !!(form.phone?.trim()) ||
      !!(form.customer_name?.trim()) ||
      !!description?.trim() ||
      !!departureDate ||
      !!workTypeId ||
      !!assigneeId ||
      !!selectedClientId ||
      !!urgent ||
      !!toFeed
    );
  }, [form, description, departureDate, workTypeId, assigneeId, selectedClientId, urgent, toFeed]);

  const handleCancelPress = useCallback(() => {
    // – ¬ –°—ü– ¬ –°‚Ä¢– ¬ –°‚Äù– ¬ –í¬∞– ¬ –í¬∑– –é–≤–Ç‚Ññ– ¬ – ‚Ä – ¬ –í¬∞– ¬ –í¬µ– ¬ –°¬ò – ¬ –°¬ò– ¬ –°‚Ä¢– ¬ –¢‚Äò– ¬ –í¬∞– ¬ –í¬ª– ¬ –°‚Äù– –é–°‚Äú – –é–≤–Ç—ô– ¬ –°‚Ä¢– ¬ –í¬ª– –é– –â– ¬ –°‚Äù– ¬ –°‚Ä¢ – ¬ –í¬µ– –é– —ì– ¬ –í¬ª– ¬ –°‚Äò – ¬ –í¬µ– –é– —ì– –é–≤–Ç—ô– –é– –â – ¬ –°‚Äò– ¬ –í¬∑– ¬ –°¬ò– ¬ –í¬µ– ¬ – ‚Ä¶– ¬ –í¬µ– ¬ – ‚Ä¶– ¬ –°‚Äò– –é– –è
    if (hasChanges()) {
      setCancelVisible(true);
    } else {
      intentionalExitRef.current = true; // – ¬ – ‚Ä°– ¬ – ‚Ä – ¬ – ‚Ä¶– –é–≤–Ç‚Ññ– ¬ –≤‚Äû‚Äì – ¬ – ‚Ä – –é–≤–Ç‚Ññ– –é–≤–Ç¬¶– ¬ –°‚Ä¢– ¬ –¢‚Äò - – ¬ – ‚Ä¶– ¬ –í¬µ – –é– —ì– ¬ –°‚Ä¢– –é–≤–Ç¬¶– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– –é– –è– ¬ –í¬µ– ¬ –°¬ò – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù
      router.back();
    }
  }, [hasChanges]);

  const confirmCancel = useCallback(() => {
    intentionalExitRef.current = true; // – ¬ – ‚Ä°– ¬ – ‚Ä – ¬ – ‚Ä¶– –é–≤–Ç‚Ññ– ¬ –≤‚Äû‚Äì – ¬ – ‚Ä – –é–≤–Ç‚Ññ– –é–≤–Ç¬¶– ¬ –°‚Ä¢– ¬ –¢‚Äò - – ¬ – ‚Ä¶– ¬ –í¬µ – –é– —ì– ¬ –°‚Ä¢– –é–≤–Ç¬¶– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– –é– –è– ¬ –í¬µ– ¬ –°¬ò – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù
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

  const normalizePhone = useCallback((val) => {
    const raw = String(val || '').replace(/\D/g, '');
    if (!raw) return null;
    const digits = raw.replace(/^8(\d{10})$/, '7$1');
    if (!PHONE_REGEX.test(digits)) return null;
    return `+7${digits.slice(1)}`;
  }, []);

  const getField = useCallback(
    (key) => (schema.fields || []).find((f) => f.field_key === key) || null,
    [schema],
  );

  const getFieldLabel = useCallback(
    (fieldKey, fallback) => {
      const field = getField(fieldKey);
      if (field?.label) return field.label;

      const labelMap = {
        title: t('order_field_title'),
        fio: t('order_field_customer_name'),
        phone: t('order_details_phone'),
        region: t('order_field_region'),
        city: t('order_field_city'),
        street: t('order_field_street'),
        house: t('order_field_house'),
        time_window_start: t('create_order_label_date'),
        assigned_to: t('create_order_label_executor'),
      };

      return labelMap[fieldKey] || fallback || fieldKey;
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
            missing.push(f.label || getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'time_window_start') {
          if (!departureDate) {
            missing.push(f.label || getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (k === 'assigned_to') {
          if (!toFeed && !assigneeId) {
            missing.push(f.label || getFieldLabel(k));
            missingKeys.push(k);
          }
        } else if (v === null || v === undefined || String(v).trim() === '') {
          missing.push(f.label || getFieldLabel(k));
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
  }, [schema, form, departureDate, toFeed, assigneeId, normalizePhone, getFieldLabel, t]);

  const handleSubmit = useCallback(async () => {
    if (!subscriptionGuard.canEdit) {
      showBanner({
        type: 'warning',
        message: t('subscription_create_unavailable_toast', '–°–æ–∑–¥–∞–Ω–∏–µ –∑–∞—è–≤–∫–∏ –Ω–µ–¥–æ—Å—Ç—É–ø–Ω–æ'),
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
    if (useWorkTypes && !workTypeId) {
      nextErrors.work_type_id = { message: t('order_validation_work_type_required') };
    }
    if (!title) {
      nextErrors.title = { message: t('order_validation_title_required') };
    }
    if (!departureDate) {
      nextErrors.time_window_start = { message: t('order_validation_date_required') };
    }
    if (!toFeed && !assigneeId) {
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
      if (!phoneFormatted) {
        setFieldErrors((prev) => ({
          ...prev,
          phone: { message: t('order_validation_phone_format') },
        }));
        focusField('phone');
        return;
      }
    }

    const custom = buildCustomPayload(schema.fields, form);
    const payload = {
      title: form.title ?? '',
      work_type_id: useWorkTypes ? workTypeId : null,
      comment: description,
      region: form.region || '',
      city: form.city || '',
      street: form.street || '',
      house: form.house || '',
      fio: form.customer_name || form.fio || '',
      phone: phoneFormatted,
      client_id: selectedClientId || null,
      assigned_to: toFeed ? null : assigneeId,
      time_window_start: departureDate ? departureDate.toISOString() : null,
      status: toFeed ? t('order_status_in_feed') : t('order_status_new'),
      urgent,
      currency: companySettings?.currency ?? null,
      custom,
    };

    const { error } = await supabase.from('orders').insert(payload);
    if (error) {
      const normalized = normalizeError(error, { t });
      if (normalized.screenError) {
        showBanner({
          ...normalized.screenError,
          action: { label: t('btn_retry'), onPress: handleSubmit },
        });
      }
      return;
    } else {
      intentionalExitRef.current = true; // – ¬ – ‚Ç¨– –é– —ì– ¬ –°‚Äî– ¬ –í¬µ– –é–≤‚Äö¬¨– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ –í¬µ – –é– —ì– ¬ –°‚Ä¢– ¬ –í¬∑– ¬ –¢‚Äò– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Äò– ¬ –í¬µ - – ¬ – ‚Ä¶– ¬ –í¬µ – –é– —ì– ¬ –°‚Ä¢– –é–≤–Ç¬¶– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– –é– –è– ¬ –í¬µ– ¬ –°¬ò – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù
      await deleteDraft(); // – ¬ – ‚Ç¨– ¬ –¢‚Äò– ¬ –í¬∞– ¬ –í¬ª– –é– –è– ¬ –í¬µ– ¬ –°¬ò – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù – ¬ –°‚Äî– ¬ –°‚Ä¢– –é– —ì– ¬ –í¬ª– ¬ –í¬µ – –é–°‚Äú– –é– —ì– ¬ –°‚Äî– ¬ –í¬µ– –é–≤‚Äö¬¨– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ –°‚Äì– ¬ –°‚Ä¢ – –é– —ì– ¬ –°‚Ä¢– ¬ –í¬∑– ¬ –¢‚Äò– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Äò– –é– –è
      router.replace('/orders/order-success');
    }
  }, [
    validateRequiredFields,
    form,
    useWorkTypes,
    workTypeId,
    departureDate,
    toFeed,
    assigneeId,
    selectedClientId,
    getField,
    normalizePhone,
    description,
    urgent,
    companySettings,
    schema,
    clearBanner,
    requiredMsg,
    showBanner,
    focusField,
    t,
    deleteDraft,
    subscriptionGuard.canEdit,
  ]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (hasChanges()) {
          setCancelVisible(true);
        } else {
          intentionalExitRef.current = true; // – ¬ – ‚Ä°– ¬ – ‚Ä – ¬ – ‚Ä¶– –é–≤–Ç‚Ññ– ¬ –≤‚Äû‚Äì – ¬ – ‚Ä – –é–≤–Ç‚Ññ– –é–≤–Ç¬¶– ¬ –°‚Ä¢– ¬ –¢‚Äò - – ¬ – ‚Ä¶– ¬ –í¬µ – –é– —ì– ¬ –°‚Ä¢– –é–≤–Ç¬¶– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– –é– –è– ¬ –í¬µ– ¬ –°¬ò – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù
          router.back();
        }
        return true;
      });
      return () => subscription.remove();
    }, [hasChanges]),
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchFormSchema('create');
        if (!mounted) return;
        const fields =
          Array.isArray(data?.fields) && data.fields.length > 0 ? data.fields : DEFAULT_FIELDS;
        setSchema({ context: 'create', fields });
        const init = {};
        for (const f of fields) init[f.field_key] = '';
        setForm(init);
      } catch (e) {
        console.warn('[CreateOrder] get_form_schema failed:', e?.message || e);
      }
    })();

    const loadUsers = async () => {
      const { data: userList, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .in('role', ['worker', 'dispatcher', 'admin']);
      if (!error && mounted) setUsers(userList || []);
    };
    loadUsers();

    // – ¬ –°—ü– –é– ‚Äö– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –í¬µ– –é– ‚Äö– –é– –è– ¬ –í¬µ– ¬ –°¬ò – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù – ¬ –°‚Äî– –é– ‚Äö– ¬ –°‚Äò – ¬ –°¬ò– ¬ –°‚Ä¢– ¬ – ‚Ä¶– –é–≤–Ç—ô– ¬ –°‚Äò– –é– ‚Äö– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Äò– ¬ –°‚Äò
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
  }, [loadDraft]);

  // AppState listener - – –é– —ì– ¬ –°‚Ä¢– –é–≤–Ç¬¶– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– –é– –è– ¬ –í¬µ– ¬ –°¬ò – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù – ¬ –°‚Äî– –é– ‚Äö– ¬ –°‚Äò – –é– —ì– ¬ – ‚Ä – ¬ –°‚Ä¢– –é– ‚Äö– ¬ –í¬∞– –é–≤–Ç–é– ¬ –°‚Äò– ¬ – ‚Ä – ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Äò– ¬ –°‚Äò/– ¬ –í¬∑– ¬ –í¬∞– ¬ –°‚Äù– –é– ‚Äö– –é–≤–Ç‚Ññ– –é–≤–Ç—ô– ¬ –°‚Äò– ¬ –°‚Äò – ¬ –°‚Äî– –é– ‚Äö– ¬ –°‚Äò– ¬ –í¬ª– ¬ –°‚Ä¢– ¬ –í¬∂– ¬ –í¬µ– ¬ – ‚Ä¶– ¬ –°‚Äò– –é– –è
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      // – ¬ –≤–Ç—û– –é– —ì– ¬ –í¬ª– ¬ –°‚Äò – ¬ –°‚Äî– –é– ‚Äö– ¬ –°‚Äò– ¬ –í¬ª– ¬ –°‚Ä¢– ¬ –í¬∂– ¬ –í¬µ– ¬ – ‚Ä¶– ¬ –°‚Äò– ¬ –í¬µ – –é–°‚Äú– –é–≤–Ç¬¶– ¬ –°‚Ä¢– ¬ –¢‚Äò– ¬ –°‚Äò– –é–≤–Ç—ô – ¬ – ‚Ä  background – ¬ –°‚Äò– ¬ –í¬ª– ¬ –°‚Äò inactive – ¬ –°‚Äò – –é– –ä– –é–≤–Ç—ô– ¬ –°‚Ä¢ – ¬ –°—ö– ¬ –≤–Ç—û – –é– –è– ¬ – ‚Ä – ¬ – ‚Ä¶– –é–≤–Ç‚Ññ– ¬ –≤‚Äû‚Äì – ¬ – ‚Ä – –é–≤–Ç‚Ññ– –é–≤–Ç¬¶– ¬ –°‚Ä¢– ¬ –¢‚Äò
      if ((nextAppState === 'background' || nextAppState === 'inactive') && !intentionalExitRef.current) {
        // – ¬ – –ã– ¬ –°‚Ä¢– –é–≤–Ç¬¶– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– –é– –è– ¬ –í¬µ– ¬ –°¬ò – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù – –é–≤–Ç—ô– ¬ –°‚Ä¢– ¬ –í¬ª– –é– –â– ¬ –°‚Äù– ¬ –°‚Ä¢ – ¬ –í¬µ– –é– —ì– ¬ –í¬ª– ¬ –°‚Äò – ¬ –í¬µ– –é– —ì– –é–≤–Ç—ô– –é– –â – ¬ –°‚Äò– ¬ –í¬∑– ¬ –°¬ò– ¬ –í¬µ– ¬ – ‚Ä¶– ¬ –í¬µ– ¬ – ‚Ä¶– ¬ –°‚Äò– –é– –è
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
          if (!flag) setWorkTypeId(null);
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
      const label = withRequiredLabel(getFieldLabel(key, placeholder), f.required);
      const val = form[key] ?? '';
      return (
        <View key={key}>
          {renderTextField({
            fieldKey: key,
            label,
            placeholder: placeholder || label,
            value: val,
            onChangeText: (text) => setField(key, text),
            required: f.required,
            ...opts,
          })}
        </View>
      );
    },
    [getField, getFieldLabel, form, renderTextField, setField, withRequiredLabel],
  );

  const renderPhoneInput = useCallback(
    (key = 'phone') => {
      const f = getField(key);
      if (!f) return null;
      const label = withRequiredLabel(getFieldLabel(key), f.required);
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
    const found = workTypes.find((w) => w.id === workTypeId);
    return found?.name || t('create_order_work_type_selected');
  }, [workTypeId, workTypes, t]);

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
    return client?.fullName || null;
  }, [clients, selectedClientId]);

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
    return workTypes.map((wt) => ({ id: wt.id, label: wt.name }));
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
        label: label || t('common_dash'),
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
      label: client.fullName || t('common_noName'),
      onPress: () => {
        setSelectedClientId(client.id);
        setClientModalVisible(false);
      },
    }));
  }, [clients, t]);

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
        {renderTextField({
          fieldKey: 'title',
          label: getFieldLabel('title'),
          placeholder: t('create_order_placeholder_title'),
          value: form.title || '',
          onChangeText: (text) => setField('title', text),
          required: getField('title')?.required,
        })}
            {renderTextField({
              label: t('order_field_description'),
              placeholder: t('create_order_placeholder_description'),
              value: description,
              onChangeText: setDescription,
              multiline: true,
            })}

            {useWorkTypes && (
              <>
                <TextField
                  label={withRequiredLabel(t('create_order_work_type_label'), true)}
                  value={selectedWorkTypeName || t('create_order_work_type_placeholder')}
                  pressable
                  style={formStyles.field}
                  onPress={() => setWorkTypeModalVisible(true)}
                  error={
                    shouldShowError('work_type_id') && fieldErrors?.work_type_id ? 'invalid' : undefined
                  }
                />
                <FieldErrorText
                  message={
                    shouldShowError('work_type_id') ? fieldErrors?.work_type_id?.message : null
                  }
                />
              </>
            )}
          </Card>

          <SectionHeader>{t('create_order_section_address')}</SectionHeader>
          <Card padded={false} style={formStyles.card}>
            {renderTextField({
              label: getFieldLabel('region'),
              placeholder: t('create_order_placeholder_region'),
              value: form.region || '',
              onChangeText: (text) => setField('region', text),
              required: getField('region')?.required,
            })}
            {renderTextField({
              label: getFieldLabel('city'),
              placeholder: t('create_order_placeholder_city'),
              value: form.city || '',
              onChangeText: (text) => setField('city', text),
              required: getField('city')?.required,
            })}
            {renderTextField({
              label: getFieldLabel('street'),
              placeholder: t('create_order_placeholder_street'),
              value: form.street || '',
              onChangeText: (text) => setField('street', text),
              required: getField('street')?.required,
            })}
            {renderTextField({
              label: getFieldLabel('house'),
              placeholder: t('create_order_placeholder_house'),
              value: form.house || '',
              onChangeText: (text) => setField('house', text),
              required: getField('house')?.required,
            })}
          </Card>

          <SectionHeader>{t('create_order_section_customer')}</SectionHeader>
          <Card padded={false} style={formStyles.card}>
            {has('canViewClients') ? (
              <TextField
                label={t('routes_clients_client')}
                value={selectedClientName || t('common_select')}
                pressable
                style={formStyles.field}
                onPress={() => setClientModalVisible(true)}
                rightSlot={
                  selectedClientId ? (
                    <ClearButton
                      onPress={() => setSelectedClientId(null)}
                      accessibilityLabel={t('common_clear')}
                    />
                  ) : null
                }
              />
            ) : null}
            {renderTextField({
              label: getFieldLabel('fio'),
              placeholder: t('create_order_placeholder_customer'),
              value: form.fio || '',
              onChangeText: (text) => setField('fio', text),
              required: getField('fio')?.required,
            })}
            {renderPhoneInput('phone')}
          </Card>

          <SectionHeader>{t('create_order_section_planning')}</SectionHeader>
          <Card padded={false} style={formStyles.card}>
            {renderToggle(urgent, () => setUrgent((v) => !v), t('create_order_label_urgent'))}

            <TextField
              label={withRequiredLabel(
                getFieldLabel('time_window_start', t('create_order_label_date')),
                true,
              )}
              value={formatDate(departureDate) || t('create_order_placeholder_date')}
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
                    onPress={() => setDepartureDate(null)}
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
              message={
                shouldShowError('time_window_start')
                  ? fieldErrors?.time_window_start?.message
                  : null
              }
            />

            <DateTimeModal
              visible={showDatePicker}
              initial={departureDate || new Date()}
              mode="date"
              allowFutureDates
              onApply={(selected) => {
                setDepartureDate((prev) => {
                  if (prev) {
                    const d = new Date(selected);
                    d.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
                    return d;
                  }
                  return selected;
                });
              }}
              onClose={() => setShowDatePicker(false)}
            />

            {useDepartureTime && (
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
                          const base = departureDate;
                          const d = new Date(base);
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
                        const base = prev || new Date();
                        const d = new Date(base);
                        d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
                        return d;
                      });
                    }
                  }}
                  onClose={() => setShowTimePicker(false)}
                />
              </>
            )}

            {renderToggle(
              toFeed,
              () => {
                setToFeed((prev) => {
                  const nv = !prev;
                  if (nv) setAssigneeId(null);
                  return nv;
                });
              },
              t('create_order_label_to_feed'),
            )}

            <TextField
              label={withRequiredLabel(
                getFieldLabel('assigned_to', t('create_order_label_executor')),
                !toFeed,
              )}
              value={
                toFeed
                  ? t('create_order_executor_in_feed')
                  : selectedAssigneeName || t('create_order_placeholder_executor')
              }
              pressable
              style={formStyles.field}
              onPress={() => setAssigneeModalVisible(true)}
              error={
                shouldShowError('assigned_to') && fieldErrors?.assigned_to ? 'invalid' : undefined
              }
            />
            <FieldErrorText
              message={
                shouldShowError('assigned_to') ? fieldErrors?.assigned_to?.message : null
              }
            />
          </Card>

          <View style={styles.buttonContainer}>
            {!subscriptionGuard.canEdit ? (
              <Text style={styles.permissionText}>{t('subscription_read_only_notice', '– ¬ – ¬µ– ¬∂– —ë– —ò –°‚Ä°–°‚Äö– ¬µ– –Ö– —ë–°–è: – —ë– ¬∑– —ò– ¬µ– –Ö– ¬µ– –Ö– —ë– ¬µ – –Ö– ¬µ– “ë– —ï–°–É–°‚Äö–°—ì– —ó– –Ö– —ï – “ë– —ï – —ó–°–Ç– —ï– “ë– ¬ª– ¬µ– –Ö– —ë–°–è – —ó– —ï– “ë– —ó– —ë–°–É– —î– —ë')}</Text>
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
          setWorkTypeId(item.id);
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
        items={clientItems}
        searchable
        selectedId={selectedClientId}
        onSelect={(item) => item?.onPress?.()}
        onClose={() => setClientModalVisible(false)}
      />

      <ConfirmModal
        visible={draftRestoreVisible}
        title="– ¬ –≤–Ç‚Ñ¢– ¬ –°‚Ä¢– –é– —ì– –é– —ì– –é–≤–Ç—ô– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– –é–≤–Ç—ô– –é– –â – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù?"
        message={
          savedDraft
            ? `– ¬ –°—ö– ¬ –í¬∞– ¬ –≤‚Äû‚Äì– ¬ –¢‚Äò– ¬ –í¬µ– ¬ – ‚Ä¶ – ¬ – ‚Ä¶– ¬ –í¬µ– –é– —ì– ¬ –°‚Ä¢– –é–≤–Ç¬¶– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– –é–≤–Ç¬ò– ¬ – ‚Ä¶– ¬ – ‚Ä¶– –é–≤–Ç‚Ññ– ¬ –≤‚Äû‚Äì – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù – ¬ –°‚Ä¢– –é–≤–Ç—ô ${new Date(savedDraft.timestamp).toLocaleString('ru-RU')}`
            : '– ¬ –°—ö– ¬ –í¬∞– ¬ –≤‚Äû‚Äì– ¬ –¢‚Äò– ¬ –í¬µ– ¬ – ‚Ä¶ – ¬ – ‚Ä¶– ¬ –í¬µ– –é– —ì– ¬ –°‚Ä¢– –é–≤–Ç¬¶– –é– ‚Äö– ¬ –í¬∞– ¬ – ‚Ä¶– –é–≤–Ç¬ò– ¬ – ‚Ä¶– ¬ – ‚Ä¶– –é–≤–Ç‚Ññ– ¬ –≤‚Äû‚Äì – –é–≤–Ç–é– ¬ –í¬µ– –é– ‚Äö– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– ¬ –°‚Äù'
        }
        confirmLabel="– ¬ –≤–Ç‚Ñ¢– ¬ –°‚Ä¢– –é– —ì– –é– —ì– –é–≤–Ç—ô– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Äò– –é–≤–Ç—ô– –é– –â"
        cancelLabel="– ¬ –°—ö– ¬ –í¬∞– –é–≤–Ç–é– ¬ –í¬∞– –é–≤–Ç—ô– –é– –â – ¬ –í¬∑– ¬ –í¬∞– ¬ – ‚Ä¶– ¬ –°‚Ä¢– ¬ – ‚Ä – ¬ –°‚Ä¢"
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





