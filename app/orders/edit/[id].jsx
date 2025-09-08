// apps/field-work/app/orders/edit/[id].jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ScrollView, KeyboardAvoidingView, ToastAndroid } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { AntDesign } from '@expo/vector-icons';
import Modal from 'react-native-modal';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { supabase } from '../../../lib/supabase';
import { fetchFormSchema } from '../../../lib/settings';
import { getMyCompanyId, fetchWorkTypes } from '../../../lib/workTypes';

import Screen from '../../../components/layout/Screen';
import TextField from '../../../components/ui/TextField';
import PhoneInput from '../../../components/ui/PhoneInput';
import Button from '../../../components/ui/Button';
import { useTheme } from '../../../theme/ThemeProvider';

export default function EditOrderScreen() {
  const pathname = usePathname();
  // derive id from pathname to avoid Proxy traps from useLocalSearchParams()
  const id = React.useMemo(() => {
    try {
      const path = String(pathname || '');
      const clean = path.split('?')[0];
      const parts = clean.split('/').filter(Boolean);
      return parts.length ? parts[parts.length - 1] : null;
    } catch { return null; }
  }, [pathname]);
  const router = useRouter();
  const { theme } = useTheme();

  // schema-driven required fields (admin form builder)
  const [schemaEdit, setSchemaEdit] = useState({ context: 'edit', fields: [] });
const [workTypeIdView, setWorkTypeIdView] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchFormSchema('edit');
        if (mounted && data && Array.isArray(data.fields)) setSchemaEdit(data);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // work types
  const [companyId, setCompanyId] = useState(null);
  const [useWorkTypes, setUseWorkTypesFlag] = useState(false);
  const [workTypes, setWorkTypes] = useState([]);
  const [workTypeId, setWorkTypeId] = useState(null);
  const [workTypeModalVisible, setWorkTypeModalVisible] = useState(false);

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
    return () => { alive = false; };
  }, []);

  // form state
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

  // load order
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: row, error } = await supabase.from('orders_secure').select('*').eq('id', id).single();
        if (error) throw error;
        // Fallback: fetch work_type_id directly from orders if view doesn't expose it
        let wtId = row.work_type_id ?? null;
        if (wtId == null) {
          const { data: row2 } = await supabase.from('orders').select('work_type_id').eq('id', id).single();
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
        setWorkTypeIdView(row.work_type_id || wtId || null);
      } catch (e) {
        console.warn(e);
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [id]);

  const styles = useMemo(() => StyleSheet.create({
    container: { padding: 16, paddingBottom: 32 },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 12,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginBottom: 12,
    },
    section: { marginTop: 6, marginBottom: 8, fontWeight: '600', color: theme.colors.text },
    label: { fontWeight: '500', marginBottom: 4, marginTop: 12, color: theme.colors.text },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      borderRadius: 10,
      padding: 10,
      color: theme.colors.text,
    },
    selectInput: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 10,
      backgroundColor: theme.colors.surface,
      padding: 12,
      marginTop: 4,
    },
    selectInputText: { fontSize: 16, color: theme.colors.text },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 6,
    },
    backText: { color: theme.colors.primary, fontSize: 16 },
    modalContainer: { backgroundColor: theme.colors.surface, borderRadius: 12, padding: 20 },
    modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: theme.colors.text },
    modalText: { fontSize: 15, color: theme.colors.textSecondary },
  }), [theme]);

  const showToast = (msg) => {
    if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
  };

  const handleSave = async () => {
    if (!title.trim()) return showToast('Укажите название заявки');
    if (!departureDate) return showToast('Укажите дату выезда');
    const rawPhone = (phone || '').replace(/\D/g, '');
    if (rawPhone.length !== 11 || rawPhone[0] !== '7' || rawPhone[1] !== '9') {
      return showToast('Введите корректный номер телефона формата +7 (9__) ___-__-__');
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
      showToast(error.message || 'Ошибка сохранения');
      return;
    }
    showToast('Сохранено');
    router.back(); // вернуться к деталям без дубликата в стеке
  };

  if (loading) {
    return (
      <Screen background="background">
        <View style={{ flex: 1 }} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen background="background" edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={16} style={{flexDirection:'row',alignItems:'center',gap:6}}>
            <AntDesign name="arrowleft" size={18} color={theme.colors.primary} />
            <Text style={styles.backText}>Назад</Text>
          </Pressable>
          <Button title="Сохранить" onPress={handleSave} />
        </View>

        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.section}>Основное</Text>

            <Text style={styles.label}>Название заявки *</Text>
            <TextField style={styles.input} placeholder="Например: Обрезка деревьев" value={title} onChangeText={setTitle} />

            <Text style={styles.label}>Описание</Text>
            <TextField
              style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
              placeholder="Подробности (если есть)"
              value={description}
              onChangeText={setDescription}
              multiline
              placeholderTextColor={theme.text?.muted?.color || theme.colors.textSecondary}
            />

            {useWorkTypes && (
              <View>
                <Text style={styles.label}>Тип работ</Text>
                <Pressable style={styles.selectInput} onPress={() => setWorkTypeModalVisible(true)}>
                  <Text style={styles.selectInputText}>
                    {workTypeId ? (workTypes.find((w) => w.id === workTypeId)?.name || 'не выбран') : 'не выбран'}
                  </Text>
                  <AntDesign name="down" size={16} color={theme.colors.textSecondary || theme.colors.text} />
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Адрес</Text>
            <Text style={styles.label}>Регион</Text>
            <TextField style={styles.input} value={region} onChangeText={setRegion} />
            <Text style={styles.label}>Город</Text>
            <TextField style={styles.input} value={city} onChangeText={setCity} />
            <Text style={styles.label}>Улица</Text>
            <TextField style={styles.input} value={street} onChangeText={setStreet} />
            <Text style={styles.label}>Дом</Text>
            <TextField style={styles.input} value={house} onChangeText={setHouse} />
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Контакты</Text>
            <Text style={styles.label}>Имя заказчика</Text>
            <TextField style={styles.input} value={customerName} onChangeText={setCustomerName} />
            <Text style={styles.label}>Телефон</Text>
            <PhoneInput value={phone} onChangeText={setPhone} />
          </View>

          <View style={{ height: 80 }} />
        </ScrollView>
      </Screen>

      {/* Модалка выбора типа работ */}
      <Modal
        isVisible={workTypeModalVisible}
        onBackdropPress={() => setWorkTypeModalVisible(false)}
        useNativeDriver
        backdropOpacity={0.3}
      >
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, padding: 20 }}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: theme.colors.text, marginBottom: 12 }}>
            Выберите тип работ
          </Text>
          {workTypes.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => { setWorkTypeId(t.id); setWorkTypeModalVisible(false); }}
              style={({ pressed }) => [{ paddingVertical: 10 }, pressed && { opacity: 0.8 }]}
            >
              <Text style={{ fontSize: 16, color: theme.colors.text }}>{t.name}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
