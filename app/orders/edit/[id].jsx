// apps/field-work/app/orders/edit/[id].jsx
import { AntDesign, Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Modal from 'react-native-modal';

import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { fetchFormSchema } from '../../../lib/settings';
import { supabase } from '../../../lib/supabase';
import { fetchWorkTypes, getMyCompanyId } from '../../../lib/workTypes';

import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import { DateTimeModal } from '../../../components/ui/modals';
import PhoneInput from '../../../components/ui/PhoneInput';
import SectionHeader from '../../../components/ui/SectionHeader';
import TextField from '../../../components/ui/TextField';
import { useToast } from '../../../components/ui/ToastProvider';
import { t as T } from '../../../src/i18n';
import { useTheme } from '../../../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ensureVisibleField } from '../../../lib/ensureVisibleField';

export default function EditOrderScreen() {
  const pathname = usePathname();
  const id = React.useMemo(() => {
    try {
      const path = String(pathname || '');
      const clean = path.split('?')[0];
      const parts = clean.split('/').filter(Boolean);
      const extractedId = parts.length ? parts[parts.length - 1] : null;
      console.log('Extracted ID from pathname:', { pathname, extractedId });
      return extractedId;
    } catch {
      return null;
    }
  }, [pathname]);

  const router = useRouter();
  const { theme } = useTheme();
  const { useDepartureTime } = useCompanySettings();
  const toastContext = useToast() || {};
  const toastError = toastContext.toastError || (() => {});
  const toastSuccess = toastContext.toastSuccess || (() => {});
  const toastInfo = toastContext.toastInfo || (() => {});

  const [schemaEdit, setSchemaEdit] = useState({ context: 'edit', fields: [] });
  const [companyId, setCompanyId] = useState(null);
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
  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const insets = useSafeAreaInsets();
  const titleRef = useRef(null);
  const descriptionRef = useRef(null);
  const regionRef = useRef(null);
  const cityRef = useRef(null);
  const streetRef = useRef(null);
  const houseRef = useRef(null);
  const customerNameRef = useRef(null);
  const selectedWorkTypeName = useMemo(() => {
    if (!workTypeId) return '';
    const match = workTypes.find((w) => w.id === workTypeId);
    return match?.name ?? '';
  }, [workTypeId, workTypes]);

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

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const { data: row, error } = await supabase
          .from('orders_secure')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;

        let wtId = row.work_type_id ?? null;
        if (wtId == null) {
          const { data: row2 } = await supabase
            .from('orders')
            .select('work_type_id')
            .eq('id', id)
            .single();
          wtId = row2?.work_type_id ?? null;
        }

        if (!mounted) return;

        setTitle(row.title || '');
        setDescription(row.comment || '');
        setRegion(row.region || '');
        setCity(row.city || '');
        setStreet(row.street || '');
        setHouse(row.house || '');
        setCustomerName(row.fio || row.customer_name || '');
        const raw = (row.phone || row.customer_phone_visible || '').replace(/\D/g, '');
        setPhone(raw);
        setDepartureDate(row.datetime ? new Date(row.datetime) : null);
        setAssigneeId(row.assigned_to || null);
        setToFeed(!row.assigned_to);
        setUrgent(!!row.urgent);
        setDepartmentId(row.department_id || null);
        setWorkTypeId(row.work_type_id || wtId || null);
      } catch (e) {
        console.warn('Load order error:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [id]);

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

  const showToast = (msg, type = 'info') => {
    const text = String(msg || '');
    try {
      if (type === 'error' && typeof toastError === 'function') {
        toastError(text);
      } else if (type === 'success' && typeof toastSuccess === 'function') {
        toastSuccess(text);
      } else if (typeof toastInfo === 'function') {
        toastInfo(text);
      }
    } catch (e) {
      console.warn('Toast error:', e);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) return showToast(T('order_validation_title_required'), 'error');
    if (!departureDate) return showToast(T('order_validation_date_required'), 'error');
    const rawPhone = (phone || '').replace(/\D/g, '');
    if (rawPhone.length !== 11 || rawPhone[0] !== '7' || rawPhone[1] !== '9') {
      return showToast(T('order_validation_phone_format'), 'error');
    }

    const payload = {
      title,
      comment: description,
      region,
      city,
      street,
      house,
      fio: customerName,
      phone: `+7${rawPhone.slice(1)}`,
      assigned_to: toFeed ? null : assigneeId,
      datetime: departureDate.toISOString(),
      urgent,
      department_id: departmentId || null,
      ...(useWorkTypes ? { work_type_id: workTypeId } : {}),
    };

    const { error } = await supabase.from('orders').update(payload).eq('id', id);
    if (error) {
      showToast(error.message || T('order_save_error'), 'error');
      return;
    }
    showToast(T('order_toast_saved'), 'success');
    router.back();
  };

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
      <Screen
        scroll={false}
        headerOptions={{
          rightTextLabel: T('header_save'),
          onRightPress: handleSave,
        }}
      >
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
              <AntDesign
                name="calendar"
                size={16}
                color={theme.colors.textSecondary || theme.colors.text}
              />
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
                  <Feather
                    name="clock"
                    size={16}
                    color={theme.colors.textSecondary || theme.colors.text}
                  />
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
    </KeyboardAvoidingView>
  );
}
