// apps/field-work/app/orders/edit/[id].jsx
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Modal from 'react-native-modal';

import { useLocalSearchParams } from 'expo-router';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { fetchWorkTypes, getMyCompanyId } from '../../../lib/workTypes';
import {
  ensureRequestAssigneeNamePrefetch,
  useRequest,
  useRequestRealtimeSync,
  useUpdateRequestMutation,
} from '../../../src/features/requests/queries';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FiltersPanel from '../../../components/filters/FiltersPanel';
import { useDepartments as useDepartmentsHook } from '../../../components/hooks/useDepartments';
import { useUsers } from '../../../components/hooks/useUsers';
import EditScreenTemplate, { useEditFormStyles } from '../../../components/layout/EditScreenTemplate';
import Card from '../../../components/ui/Card';
import { DateTimeModal } from '../../../components/ui/modals';
import { isValidRu as isValidPhone } from '../../../components/ui/phone';
import PhoneInput from '../../../components/ui/PhoneInput';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { useToast } from '../../../components/ui/ToastProvider';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';
import { t as T } from '../../../src/i18n';
import { useTheme } from '../../../theme/ThemeProvider';

export default function EditOrderScreen() {
  const { id: rawId } = useLocalSearchParams();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const updateRequestMutation = useUpdateRequestMutation();
  const queryClient = useQueryClient();

  const { theme } = useTheme();
  const formStyles = useEditFormStyles();
  const { settings: companySettings, useDepartureTime } = useCompanySettings();
  const {
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    info: toastInfo,
  } = useToast();
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState(null);
  const { departments } = useDepartmentsHook({
    companyId,
    enabled: !!companyId,
    onlyEnabled: true,
  });
  useRequestRealtimeSync({ enabled: !!id && !!companyId, companyId });

  // moved up: состояние видимости picker должно быть доступно до вызова useUsers
  const [assigneePickerVisible, setAssigneePickerVisible] = useState(false);

  // useUsers теперь читает корректное значение enabled
  const { users: employees } = useUsers({
    filters: {},
    enabled: assigneePickerVisible,
  });
  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  const [workTypeId, setWorkTypeId] = useState(null);
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);
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
  const [toFeed, setToFeed] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [departmentId, setDepartmentId] = useState(null);
  const [assignedEmployeeLabel, setAssignedEmployeeLabel] = useState('');

  // Восстановленные refs и состояния, которые использует компонент дальше
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const headerResetRef = useRef(null);
  const insets = useSafeAreaInsets();
  const titleRef = useRef(null);
  const descriptionRef = useRef(null);
  const regionRef = useRef(null);
  const cityRef = useRef(null);
  const streetRef = useRef(null);
  const houseRef = useRef(null);
  const customerNameRef = useRef(null);
  const [price, setPrice] = useState('');
  const [fuelCost, setFuelCost] = useState('');
  const [headerLabel, setHeaderLabel] = useState(T('header_save'));

  // модальные состояния (были удалены ранее — вернуть)
  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const hydratedOrderIdRef = useRef(null);
  const snapshotRef = useRef(null);
  const userEditedRef = useRef(false);
  const assignedLabelRequestIdRef = useRef(0);

  // имя выбранного исполнителя (восстановлено)
  const selectedEmployeeName = useMemo(() => {
    if (selectedEmployee) return selectedEmployee.display_name || selectedEmployee.email || '';
    return assignedEmployeeLabel || T('common_noName');
  }, [selectedEmployee, assignedEmployeeLabel]);

  const selectedWorkTypeName = useMemo(() => {
    if (!workTypeId) return '';
    const match = workTypes.find((w) => w.id === workTypeId);
    return match?.name ?? '';
  }, [workTypeId, workTypes]);

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
        if (__DEV__) {
          console.warn('workTypes bootstrap', e?.message || e);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
        customerName: String(draft.customerName || '').trim(),
        phone: String(draft.phone || '').replace(/\D/g, ''),
        departureDateIso: normalizeDateOrNull(draft.departureDate)?.toISOString() || null,
        assigneeId: draft.assigneeId || null,
        toFeed: !!draft.toFeed,
        urgent: !!draft.urgent,
        departmentId: draft.departmentId || null,
        price: String(draft.price ?? '').trim(),
        fuelCost: String(draft.fuelCost ?? '').trim(),
        workTypeId: draft.workTypeId || null,
      }),
    [normalizeDateOrNull],
  );

  useEffect(() => {
    if (!id || !orderData) return;
    const isNewOrderScreenOpen = hydratedOrderIdRef.current !== id;
    if (!isNewOrderScreenOpen && userEditedRef.current) return;

    const row = orderData;
    const nextTitle = row.title || '';
    const nextDescription = row.comment || '';
    const nextRegion = row.region || '';
    const nextCity = row.city || '';
    const nextStreet = row.street || '';
    const nextHouse = row.house || '';
    const nextCustomerName = row.fio || row.customer_name || '';
    const raw = (row.phone || row.customer_phone_visible || '').replace(/\D/g, '');
    const nextDepartureDate = normalizeDateOrNull(row.time_window_start);
    const nextAssigneeId = row.assigned_to || null;
    const nextToFeed = !row.assigned_to;
    const nextUrgent = !!row.urgent;
    const nextDepartmentId = row.department_id || null;
    const nextWorkTypeId = row.work_type_id || null;
    const nextPrice = row.price !== null && row.price !== undefined ? String(row.price) : '';
    const nextFuelCost =
      row.fuel_cost !== null && row.fuel_cost !== undefined ? String(row.fuel_cost) : '';

    setTitle(nextTitle);
    setDescription(nextDescription);
    setRegion(nextRegion);
    setCity(nextCity);
    setStreet(nextStreet);
    setHouse(nextHouse);
    setCustomerName(nextCustomerName);
    setPhone(raw);
    setDepartureDate(nextDepartureDate);
    setAssigneeId(nextAssigneeId);

    // Если профиль уже пришёл вместе с заказом — используем его сразу, иначе делаем отдельный fetch
    if (row.assigned_to && row.assignee_profile) {
      const data = row.assignee_profile;
      const nameParts = `${data.first_name || ''} ${data.last_name || ''}`.trim();
      const normalizedFullName = (data.full_name || '').trim();
      const candidate = nameParts || normalizedFullName || data.email || '';
      setAssignedEmployeeLabel(candidate);
    } else if (row.assigned_to) {
      // fallback: если нет профиля в ответе — оставить прежнюю логику (async fetch)
      refreshAssignedLabel(row.assigned_to);
    } else {
      setAssignedEmployeeLabel('');
    }

    setToFeed(nextToFeed);
    setUrgent(nextUrgent);
    setDepartmentId(nextDepartmentId);
    setWorkTypeId(nextWorkTypeId);
    setPrice(nextPrice);
    setFuelCost(nextFuelCost);

    snapshotRef.current = buildSnapshot({
      title: nextTitle,
      description: nextDescription,
      region: nextRegion,
      city: nextCity,
      street: nextStreet,
      house: nextHouse,
      customerName: nextCustomerName,
      phone: raw,
      departureDate: nextDepartureDate,
      assigneeId: nextAssigneeId,
      toFeed: nextToFeed,
      urgent: nextUrgent,
      departmentId: nextDepartmentId,
      price: nextPrice,
      fuelCost: nextFuelCost,
      workTypeId: nextWorkTypeId,
    });
    userEditedRef.current = false;
    hydratedOrderIdRef.current = id;
  }, [id, orderData, buildSnapshot, refreshAssignedLabel, normalizeDateOrNull]);

  // Оптимизируем вызов refreshAssignedLabel — не запрашиваем, если label уже установлен
  useEffect(() => {
    if (!assigneeId) {
      assignedLabelRequestIdRef.current += 1;
      setAssignedEmployeeLabel('');
      return;
    }
    if (assignedEmployeeLabel) return; // уже есть имя — пропускаем лишний запрос
    refreshAssignedLabel(assigneeId);
  }, [assigneeId, refreshAssignedLabel, assignedEmployeeLabel]);

  useEffect(() => {
    return () => {
      assignedLabelRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!id || hydratedOrderIdRef.current !== id || !snapshotRef.current) return;
    const current = buildSnapshot({
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
      toFeed,
      urgent,
      departmentId,
      price,
      fuelCost,
      workTypeId,
    });
    userEditedRef.current = current !== snapshotRef.current;
  }, [
    id,
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
    toFeed,
    urgent,
    departmentId,
    price,
    fuelCost,
    workTypeId,
    buildSnapshot,
  ]);

  useEffect(() => {
    if (headerResetRef.current && saving) {
      clearTimeout(headerResetRef.current);
      headerResetRef.current = null;
    }
    setHeaderLabel(saving ? T('toast_saving') : T('header_save'));
  }, [saving]);

  useEffect(() => {
    return () => {
      if (headerResetRef.current) {
        clearTimeout(headerResetRef.current);
        headerResetRef.current = null;
      }
    };
  }, []);

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
    setHeaderLabel(text);
    if (headerResetRef.current) clearTimeout(headerResetRef.current);
    if (!options?.sticky) {
      headerResetRef.current = setTimeout(() => {
        if (!saving) setHeaderLabel(T('header_save'));
        headerResetRef.current = null;
      }, options?.duration ?? 2500);
    }
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

  const handleAssignmentApply = useCallback(
    (selectedId) => {
      const normalized = selectedId ?? null;
      setAssigneeId(normalized);
      setToFeed(!normalized);
      setAssigneePickerVisible(false);
    },
    [setAssigneeId, setAssigneePickerVisible, setToFeed],
  );

  const handleAssignmentReset = useCallback(() => {
    setAssigneeId(null);
    setToFeed(true);
  }, [setAssigneeId, setToFeed]);

  const selectExecutorTitle = T('order_modal_select_executor');
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
    if (saving) return;
    if (!id) {
      showToast(T('order_validation_no_order_id'), 'error');
      return;
    }
    if (companySettings?.recalc_in_progress) {
      showToast(T('settings_recalc_in_progress'), 'warning');
      return;
    }
    // Скрываем клавиатуру и снимаем фокус с полей перед валидацией/сохранением
    try {
      Keyboard.dismiss();
      // Попробуем размыть все поля, если у них есть метод blur
      [titleRef, descriptionRef, regionRef, cityRef, streetRef, houseRef, customerNameRef].forEach(
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
      if (saving) return;
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
        fio: customerName,
        phone: normalizedPhone,
        assigned_to: toFeed ? null : assigneeId,
        time_window_start: normalizedDepartureDate.toISOString(),
        urgent,
        department_id: departmentId || null,
        price: parsedPrice,
        fuel_cost: parsedFuelCost,
        ...(useWorkTypes ? { work_type_id: workTypeId } : {}),
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
        customerName,
        phone,
        departureDate,
        assigneeId,
        toFeed,
        urgent,
        departmentId,
        price,
        fuelCost,
        workTypeId,
      });
      userEditedRef.current = false;
      showToast(T('toast_success'), 'success');
    } catch (err) {
      if (__DEV__) {
        console.warn('order save failed', err?.message || err);
      }
      if (err?.code === 'CONFLICT') {
        showToast(
          'Заявка уже была изменена на другом устройстве. Открыта актуальная версия, проверьте поля.',
          'warning',
        );
        await refetchOrder();
      } else {
        showToast(T('order_save_error'), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  if (orderLoading && !orderData) {
    return (
      <EditScreenTemplate scrollEnabled={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size={theme.components?.activityIndicator?.size ?? 'large'} />
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
      rightTextLabel={headerLabel}
      onRightPress={handleSave}
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
              onFocus={() =>
                ensureVisibleField({
                  fieldRef: titleRef,
                  scrollRef,
                  scrollYRef,
                  insetsBottom: insets.bottom ?? 0,
                  headerHeight: theme?.components?.header?.height ?? 56,
                })
              }
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
              onFocus={() =>
                ensureVisibleField({
                  fieldRef: descriptionRef,
                  scrollRef,
                  scrollYRef,
                  insetsBottom: insets.bottom ?? 0,
                  headerHeight: theme?.components?.header?.height ?? 56,
                })
              }
            />

            <TextField
              label={T('order_details_executor')}
              value={selectedEmployeeName}
              placeholder={T('order_details_not_assigned')}
              pressable
              style={styles.field}
              onPress={() => setAssigneePickerVisible(true)}
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
              onFocus={() =>
                ensureVisibleField({
                  fieldRef: regionRef,
                  scrollRef,
                  scrollYRef,
                  insetsBottom: insets.bottom ?? 0,
                  headerHeight: theme?.components?.header?.height ?? 56,
                })
              }
            />
            <TextField
              ref={cityRef}
              label={T('order_field_city')}
              value={city}
              onChangeText={setCity}
              style={styles.field}
              onFocus={() =>
                ensureVisibleField({
                  fieldRef: cityRef,
                  scrollRef,
                  scrollYRef,
                  insetsBottom: insets.bottom ?? 0,
                  headerHeight: theme?.components?.header?.height ?? 56,
                })
              }
            />
            <TextField
              ref={streetRef}
              label={T('order_field_street')}
              value={street}
              onChangeText={setStreet}
              style={styles.field}
              onFocus={() =>
                ensureVisibleField({
                  fieldRef: streetRef,
                  scrollRef,
                  scrollYRef,
                  insetsBottom: insets.bottom ?? 0,
                  headerHeight: theme?.components?.header?.height ?? 56,
                })
              }
            />
            <TextField
              ref={houseRef}
              label={T('order_field_house')}
              value={house}
              onChangeText={setHouse}
              style={styles.field}
              onFocus={() =>
                ensureVisibleField({
                  fieldRef: houseRef,
                  scrollRef,
                  scrollYRef,
                  insetsBottom: insets.bottom ?? 0,
                  headerHeight: theme?.components?.header?.height ?? 56,
                })
              }
            />
          </Card>

          <SectionHeader bottomSpacing="xs">{T('order_section_customer')}</SectionHeader>
          <Card padded={false} style={styles.card}>
            <TextField
              ref={customerNameRef}
              label={T('order_field_customer_name')}
              value={customerName}
              onChangeText={setCustomerName}
              style={styles.field}
              onFocus={() =>
                ensureVisibleField({
                  fieldRef: customerNameRef,
                  scrollRef,
                  scrollYRef,
                  insetsBottom: insets.bottom ?? 0,
                  headerHeight: theme?.components?.header?.height ?? 56,
                })
              }
            />
            <PhoneInput value={phone} onChangeText={setPhone} style={styles.field} />
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
          </Card>

          <View style={{ height: theme.spacing?.xxl ?? 80 }} />
      </EditScreenTemplate>

      <Modal
        isVisible={workTypeModalVisible}
        onBackdropPress={() => setWorkTypeModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
      >
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, padding: 20 }}>
          <Text
            style={{ fontSize: 18, fontWeight: '600', color: theme.colors.text, marginBottom: 12 }}
          >
            {T('order_modal_work_type_select')}
          </Text>
          {workTypes.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => {
                setWorkTypeId(t.id);
                setWorkTypeModalVisible(false);
              }}
              style={({ pressed }) => [
                { paddingVertical: theme.spacing?.sm ?? 10 },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={{ fontSize: 16, color: theme.colors.text }}>{t.name}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>

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
    </>
  );
}

