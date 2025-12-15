// apps/field-work/app/orders/edit/[id].jsx
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Modal from 'react-native-modal';

import { usePathname, useRouter } from 'expo-router';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { fetchFormSchema } from '../../../lib/settings';
import { supabase } from '../../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../../lib/workTypes';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FiltersPanel from '../../../components/filters/FiltersPanel';
import { useDepartments as useDepartmentsHook } from '../../../components/hooks/useDepartments';
import { useUsers } from '../../../components/hooks/useUsers';
import Screen from '../../../components/layout/Screen';
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

const fetchOrderData = async (orderId) => {
  const { data: row, error } = await supabase
    .from('orders_secure_v2')
    .select('*')
    .eq('id', orderId)
    .single();
  if (error) throw error;

  const normalizedRow = row
    ? {
        ...row,
        time_window_start: row.time_window_start ?? null,
      }
    : row;

  let wtId = normalizedRow.work_type_id ?? null;
  if (wtId == null) {
    const { data: row2, error: error2 } = await supabase
      .from('orders')
      .select('work_type_id')
      .eq('id', orderId)
      .single();
    if (error2) throw error2;
    wtId = row2?.work_type_id ?? null;
  }

  // Дополнительно подгружаем профиль назначенного пользователя, чтобы сразу показать имя
  if (normalizedRow?.assigned_to) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, full_name, email')
        .eq('id', row.assigned_to)
        .maybeSingle();
      // добавляем профиль в возвращаемую строку
      normalizedRow.assignee_profile = profile || null;
    } catch (e) {
      // если ошибка — не мешаем основному ответу
      normalizedRow.assignee_profile = null;
    }
  } else {
    normalizedRow.assignee_profile = null;
  }

  return { row: normalizedRow, fallbackWorkTypeId: wtId };
};

export default function EditOrderScreen() {
  const pathname = usePathname();
  const id = React.useMemo(() => {
    try {
      const path = String(pathname || '');
      const clean = path.split('?')[0];
      const parts = clean.split('/').filter(Boolean);
      const extractedId = parts.length ? parts[parts.length - 1] : null;
      return extractedId;
    } catch {
      return null;
    }
  }, [pathname]);

  const queryClient = useQueryClient();
  const realtimeSubscriptionRef = useRef(null);

  // Реалтайм подписка на изменения заявки
  useEffect(() => {
    if (!id) return;

    const setupRealtimeSubscription = () => {
      try {
        realtimeSubscriptionRef.current = supabase
          .channel(`order:${id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'orders',
              filter: `id=eq.${id}`,
            },
            (payload) => {
              // Инвалидируем кэш при изменении другим пользователем
              queryClient.invalidateQueries({ queryKey: ['order', id] });
            },
          )
          .subscribe();
      } catch (e) {
        console.warn('Failed to setup realtime subscription:', e?.message);
      }
    };

    setupRealtimeSubscription();

    return () => {
      if (realtimeSubscriptionRef.current) {
        realtimeSubscriptionRef.current.unsubscribe();
        realtimeSubscriptionRef.current = null;
      }
    };
  }, [id, queryClient]);

  const router = useRouter();
  const { theme } = useTheme();
  const { settings: companySettings, useDepartureTime } = useCompanySettings();
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState(null);
  const { departments } = useDepartmentsHook({
    companyId,
    enabled: !!companyId,
    onlyEnabled: true,
  });

  // moved up: состояние видимости picker должно быть доступно до вызова useUsers
  const [assigneePickerVisible, setAssigneePickerVisible] = useState(false);

  // useUsers теперь читает корректное значение enabled
  const { users: employees } = useUsers({
    filters: {},
    enabled: assigneePickerVisible,
  });
  const [schemaEdit, setSchemaEdit] = useState({ context: 'edit', fields: [] });
  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  const [workTypeId, setWorkTypeId] = useState(null);
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
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
    if (!userId) {
      setAssignedEmployeeLabel('');
      return;
    }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('first_name, last_name, full_name, email')
        .eq('id', userId)
        .maybeSingle();
      if (!data) {
        setAssignedEmployeeLabel('');
        return;
      }
      const nameParts = `${data.first_name || ''} ${data.last_name || ''}`.trim();
      const normalizedFullName = (data.full_name || '').trim();
      const candidate = nameParts || normalizedFullName || data.email || '';
      setAssignedEmployeeLabel(candidate);
    } catch (e) {
      console.warn('assigned name fetch', e?.message || e);
      setAssignedEmployeeLabel('');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchFormSchema('edit');
        if (mounted && data && Array.isArray(data.fields)) setSchemaEdit(data);
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
        console.warn('workTypes bootstrap', e?.message || e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const {
    data: orderData,
    isLoading: orderLoading,
    refetch: refetchOrder,
  } = useQuery({
    queryKey: ['order', id],
    queryFn: () => fetchOrderData(id),
    enabled: !!id,
    // Сделать данные немедленно устаревшими и всегда перефетчивать при монтировании,
    // чтобы на экран редактирования попадали актуальные значения из Supabase.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (!id) return;
    // Явный рефетч при смене id (на случай, если кэш всё ещё возвращается раньше)
    refetchOrder().catch(() => {
      /* ignore errors here — handled в useQuery/эффектах выше */
    });
  }, [id, refetchOrder]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(orderLoading);
    if (!orderData || orderLoading) return;

    const { row, fallbackWorkTypeId } = orderData;
    setTitle(row.title || '');
    setDescription(row.comment || '');
    setRegion(row.region || '');
    setCity(row.city || '');
    setStreet(row.street || '');
    setHouse(row.house || '');
    setCustomerName(row.fio || row.customer_name || '');
    const raw = (row.phone || row.customer_phone_visible || '').replace(/\D/g, '');
    setPhone(raw);
    setDepartureDate(row.time_window_start ? new Date(row.time_window_start) : null);
    setAssigneeId(row.assigned_to || null);

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

    setToFeed(!row.assigned_to);
    setUrgent(!!row.urgent);
    setDepartmentId(row.department_id || null);
    setWorkTypeId(row.work_type_id || fallbackWorkTypeId || null);
    setPrice(row.price !== null && row.price !== undefined ? String(row.price) : '');
    setFuelCost(row.fuel_cost !== null && row.fuel_cost !== undefined ? String(row.fuel_cost) : '');
  }, [id, orderData, orderLoading, refreshAssignedLabel]);

  // Оптимизируем вызов refreshAssignedLabel — не запрашиваем, если label уже установлен
  useEffect(() => {
    if (!assigneeId) {
      setAssignedEmployeeLabel('');
      return;
    }
    if (assignedEmployeeLabel) return; // уже есть имя — пропускаем лишний запрос
    refreshAssignedLabel(assigneeId);
  }, [assigneeId, refreshAssignedLabel, assignedEmployeeLabel]);

  useEffect(() => {
    if (headerResetRef.current && saving) {
      clearTimeout(headerResetRef.current);
      headerResetRef.current = null;
    }
    setHeaderLabel(saving ? T('toast_saving') : T('header_save'));
  }, [saving, T]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { padding: theme.spacing?.md ?? 16, paddingBottom: theme.spacing?.xl ?? 32 },
        selectInput: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radii?.md ?? 10,
          backgroundColor: theme.colors.surface,
          padding: theme.spacing?.md ?? 12,
          marginTop: theme.spacing?.xs ?? 4,
        },
        selectInputText: { fontSize: 16, color: theme.colors.text },
      }),
    [theme],
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
      } else if (type === 'success') {
        toastSuccess?.(text, options);
      } else {
        toastInfo?.(text, options);
      }
    } catch (e) {
      console.warn('Toast error:', e);
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
          } catch (e) {
            // ignore
          }
        },
      );
    } catch (e) {
      // ignore
    }

    if (!title.trim()) return showToast(T('order_validation_title_required'), 'error');
    if (!departureDate) return showToast(T('order_validation_date_required'), 'error');
    const rawPhone = (phone || '').replace(/\D/g, '');
    if (rawPhone && !isValidPhone(String(phone || ''))) {
      return showToast(T('order_validation_phone_format'), 'error');
    }

    await proceedSave();
  };

  const proceedSave = async () => {
    try {
      setSaving(true);
      showToast(T('toast_saving'), 'info', { sticky: true });

      const rawPhone = (phone || '').replace(/\D/g, '');
      const payload = {
        title,
        comment: description,
        region,
        city,
        street,
        house,
        fio: customerName,
        phone: rawPhone ? `+7${rawPhone.slice(1)}` : null,
        assigned_to: toFeed ? null : assigneeId,
        time_window_start: departureDate.toISOString(),
        urgent,
        department_id: departmentId || null,
        price: price ? parseFloat(price) : null,
        fuel_cost: fuelCost ? parseFloat(fuelCost) : null,
        ...(useWorkTypes ? { work_type_id: workTypeId } : {}),
      };

      const { error } = await supabase.from('orders').update(payload).eq('id', id);
      if (error) {
        showToast(error.message || T('error_save_failed'), 'error');
        return;
      }
      // Инвалидируем кэш и получаем свежие данные
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
      showToast(T('toast_success'), 'success');
    } catch (err) {
      showToast(err?.message || T('error_save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const headerOptions = useMemo(
    () => ({
      rightTextLabel: headerLabel,
      onRightPress: handleSave,
    }),
    [handleSave, headerLabel],
  );

  if (loading) {
    return (
      <Screen background="background">
        <View style={{ flex: 1 }} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Screen scroll={false} headerOptions={headerOptions}>
        <KeyboardAwareScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.container,
            {
              paddingBottom: Math.max(
                styles.container?.paddingBottom ?? 0,
                Math.max(theme.components?.scrollView?.paddingBottom ?? 24, insets.bottom ?? 0),
              ),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'always' : 'automatic'}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => {
            try {
              scrollYRef.current = e.nativeEvent.contentOffset.y || 0;
            } catch {}
          }}
          scrollEventThrottle={16}
        >
          <SectionHeader bottomSpacing="xs">{T('order_details_general_data')}</SectionHeader>
          <Card>
            <TextField
              ref={titleRef}
              label={T('order_field_title')}
              placeholder={T('order_placeholder_title')}
              value={title}
              onChangeText={setTitle}
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
              onPress={() => setAssigneePickerVisible(true)}
            />

            {useWorkTypes && (
              <TextField
                label={T('order_field_work_type')}
                value={selectedWorkTypeName}
                placeholder={T('order_details_work_type_not_selected')}
                pressable
                onPress={() => setWorkTypeModalVisible(true)}
              />
            )}
          </Card>

          <SectionHeader bottomSpacing="xs">Финансы</SectionHeader>
          <Card>
            <TextField
              label={T('order_details_amount')}
              placeholder="0.00"
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
            />
            <TextField
              label={T('order_details_fuel')}
              placeholder="0.00"
              value={fuelCost}
              onChangeText={setFuelCost}
              keyboardType="decimal-pad"
            />
          </Card>

          <SectionHeader bottomSpacing="xs">{T('order_section_address')}</SectionHeader>
          <Card>
            <TextField
              ref={regionRef}
              label={T('order_field_region')}
              value={region}
              onChangeText={setRegion}
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
          <Card>
            <TextField
              ref={customerNameRef}
              label={T('order_field_customer_name')}
              value={customerName}
              onChangeText={setCustomerName}
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
            <PhoneInput value={phone} onChangeText={setPhone} />
          </Card>

          <SectionHeader bottomSpacing="xs">
            {T('company_settings_sections_departure_helperText_departureOn')}
          </SectionHeader>
          <Card>
            <SectionHeader bottomSpacing="xs">{T('order_field_departure_date')}</SectionHeader>
            <Pressable style={styles.selectInput} onPress={() => setShowDateModal(true)}>
              <Text style={styles.selectInputText}>
                {departureDate
                  ? format(departureDate, 'd MMMM yyyy', { locale: ru })
                  : T('placeholder_birthdate')}
              </Text>
            </Pressable>

            {useDepartureTime && (
              <>
                <SectionHeader bottomSpacing="xs">{T('order_field_departure_time')}</SectionHeader>
                <Pressable
                  style={styles.selectInput}
                  onPress={() => {
                    if (!departureDate) {
                      setShowDateModal(true);
                      return;
                    }
                    setShowTimeModal(true);
                  }}
                >
                  <Text style={styles.selectInputText}>
                    {departureDate
                      ? format(departureDate, 'HH:mm', { locale: ru })
                      : T('placeholder_birthdate')}
                  </Text>
                </Pressable>
              </>
            )}
          </Card>

          <View style={{ height: theme.spacing?.xxl ?? 80 }} />
        </KeyboardAwareScrollView>
      </Screen>

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
        initial={departureDate || new Date()}
        allowFutureDates={true}
        onApply={(time) => {
          const baseDate = departureDate || new Date();
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
    </KeyboardAvoidingView>
  );
}
