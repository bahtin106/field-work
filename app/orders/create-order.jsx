import { AntDesign } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  findNodeHandle,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  UIManager,
  View,
} from 'react-native';
import { MaskedTextInput } from 'react-native-mask-text';
import Modal from 'react-native-modal';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePermissions } from '../../lib/permissions';
import { buildCustomPayload, fetchFormSchema } from '../../lib/settings';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';

export default function CreateOrderScreen() {
  /* PERMISSIONS GUARD: create-order */
  const { has } = usePermissions ? usePermissions() : { has: () => true };
  const { theme } = useTheme();

  const isDark = theme.name === 'dark' || theme.mode === 'dark';

  // palette available in render (icons etc.)
  const palette = useMemo(() => ({
      bg: theme.colors?.background ?? theme.colors?.surface,
      card: theme.colors?.surface,
      text: theme.colors?.text,
      textMuted: theme.colors?.textSecondary ?? theme.colors?.text,
      border: theme.colors?.border,
      borderSoft: theme.colors?.border,
      inputBg: theme.colors?.inputBg ?? theme.colors?.surface,
      primary: theme.colors?.primary,
      secondary: theme.colors?.inputBg ?? theme.colors?.surface,
      destructive: theme.colors?.danger ?? theme.colors?.error ?? theme.colors?.primary,
      toggleTrack: theme.colors?.border,
      toggleTrackOn: theme.colors?.primary,
      knob: theme.colors?.surface,
      icon: theme.colors?.textSecondary ?? theme.colors?.text,
      onPrimary: theme.colors?.onPrimary ?? theme.colors?.surface,
  }), [theme]);


  const styles = useMemo(() => StyleSheet.create({
      container: { flex: 1, backgroundColor: palette.bg },
      scroll: { padding: 16, paddingBottom: 40 },
      pageTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 16,
        textAlign: 'center',
        color: palette.text,
      },

      card: {
        backgroundColor: palette.card,
        borderRadius: 12,
        padding: 12,
        borderColor: palette.borderSoft,
        borderWidth: 1,
        marginBottom: 12,
      },
      section: { marginTop: 6, marginBottom: 8, fontWeight: '600', color: palette.text },
      label: {
        fontWeight: '500',
        marginBottom: 4,
        marginTop: 12,
        color: isDark ? '#E3E3E6' : '#333',
      },
      input: {
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.inputBg,
        color: palette.text,
        borderRadius: 10,
        padding: 10,
      },
      selectInput: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: 10,
        backgroundColor: palette.inputBg,
        padding: 12,
        marginTop: 4,
      },
      selectInputText: { fontSize: 16, color: palette.text },

      appButton: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignItems: 'center',
      },
      appButtonText: { fontSize: 16 },
      btnPrimary: { backgroundColor: palette.primary },
      btnPrimaryText: { color: palette.onPrimary, fontWeight: '600' },
      btnSecondary: { backgroundColor: palette.secondary },
      btnSecondaryText: { color: palette.text, fontWeight: '500' },
      btnDestructive: { backgroundColor: palette.destructive },
      btnDestructiveText: { color: palette.onPrimary, fontWeight: '600' },

      modalContainer: { backgroundColor: palette.card, borderRadius: 12, padding: 20 },
      modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: palette.text },
      modalText: { fontSize: 15, color: palette.textMuted, marginBottom: 20 },
      modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
      assigneeOption: { paddingVertical: 10 },
      assigneeText: { fontSize: 16, color: palette.text },

      toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
      toggle: {
        width: 42,
        height: 26,
        borderRadius: 13,
        backgroundColor: palette.toggleTrack,
        padding: 2,
        justifyContent: 'center',
      },
      toggleOn: { backgroundColor: palette.toggleTrackOn },
      knob: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: palette.knob,
        alignSelf: 'flex-start',
      },
      knobOn: { alignSelf: 'flex-end' },
      toggleLabel: { fontSize: 14, color: palette.text },
    }), [theme]);

  // deny access if no rights
  if (!has('canCreateOrders')) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, color: theme.colors?.textSecondary }}>У вас нет прав на создание заявок</Text>
      </SafeAreaView>
    );
  }

  // ----------------------- STATE / SCHEMA -----------------------
  const [schema, setSchema] = useState({ context: 'create', fields: [] });
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState({});
  const setField = useCallback((key, val) => setForm((s) => ({ ...s, [key]: val })), []);

  const [description, setDescription] = useState('');
  const [departureDate, setDepartureDate] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [assigneeId, setAssigneeId] = useState(null);
  const [urgent, setUrgent] = useState(false);
  const [users, setUsers] = useState([]);
  const [cancelVisible, setCancelVisible] = useState(false);
  const [warningVisible, setWarningVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [assigneeModalVisible, setAssigneeModalVisible] = useState(false);
  const [toFeed, setToFeed] = useState(false);

  const scrollRef = useRef(null);
  const dateFieldRef = useRef(null);
  const timeFieldRef = useRef(null);

  const showWarning = (message) => {
    setWarningMessage(message);
    setWarningVisible(true);
  };
  const handleCancelPress = () => setCancelVisible(true);
  const confirmCancel = () => {
    setCancelVisible(false);
    router.back();
  };

  const scrollToHandle = (targetRef) => {
    if (scrollRef.current && targetRef.current) {
      UIManager.measureLayout(
        targetRef.current,
        findNodeHandle(scrollRef.current),
        () => {},
        (_x, y) => {
          scrollRef.current.scrollTo({ y, animated: true });
        },
      );
    }
  };

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setCancelVisible(true);
        return true;
      });
      return () => subscription.remove();
    }, []),
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchFormSchema('create');
        if (!mounted) return;
        const defaults = [
          {
            field_key: 'title',
            label: 'Название заявки',
            type: 'text',
            position: 10,
            required: true,
          },
          { field_key: 'fio', label: 'Имя заказчика', type: 'text', position: 20 },
          { field_key: 'phone', label: 'Телефон', type: 'phone', position: 30 },
          { field_key: 'region', label: 'Район или область', type: 'text', position: 40 },
          { field_key: 'city', label: 'Город или н.п.', type: 'text', position: 50 },
          { field_key: 'street', label: 'Улица или СНТ', type: 'text', position: 60 },
          { field_key: 'house', label: 'Дом или участок', type: 'text', position: 70 },
        ];
        const fields =
          Array.isArray(data?.fields) && data.fields.length > 0 ? data.fields : defaults;
        setSchema({ context: 'create', fields });

        const init = {};
        for (const f of fields) init[f.field_key] = '';
        setForm(init);
      } catch (e) {
        console.warn('get_form_schema failed:', e?.message || e);
      } finally {
        if (mounted) setReady(true);
      }
    })();

    const loadUsers = async () => {
      const { data: userList, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .in('role', ['worker', 'dispatcher', 'admin']);
      if (!error) setUsers(userList || []);
      setAssigneeId(null);
    };
    loadUsers();
    return () => {
      mounted = false;
    };
  }, []);

  const getField = useCallback(
    (key) => (schema.fields || []).find((f) => f.field_key === key) || null,
    [schema],
  );

  // ------------------------- HELPERS -------------------------
  const normalizePhone = (val) => {
    const raw = String(val || '').replace(/\D/g, '');
    if (!raw) return null;
    const digits = raw.replace(/^8(\d{10})$/, '7$1');
    if (digits.length !== 11 || !digits.startsWith('7')) return null;
    return `+7${digits.slice(1)}`;
  };

  const Button = ({ title, onPress, variant = 'primary' }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.appButton,
        variant === 'destructive'
          ? styles.btnDestructive
          : variant === 'secondary'
            ? styles.btnSecondary
            : styles.btnPrimary,
        pressed && { transform: [{ scale: 0.96 }] },
      ]}
    >
      <Text
        style={[
          styles.appButtonText,
          variant === 'destructive'
            ? styles.btnDestructiveText
            : variant === 'secondary'
              ? styles.btnSecondaryText
              : styles.btnPrimaryText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );

  const TextField = ({
    label,
    placeholder,
    value,
    onChangeText,
    multiline = false,
    keyboardType,
    secureTextEntry,
    ...rest
  }) => (
    <View>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <RNTextInput
        style={[styles.input, multiline && { height: 100 }]}
        placeholder={placeholder || label}
        placeholderTextColor={
          theme.colors?.placeholder ?? theme.colors?.textSecondary ?? theme.colors?.text
        }
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        {...rest}
      />
    </View>
  );

  const renderTextInput = (key, placeholder) => {
    const f = getField(key);
    if (!f) return null;
    const label = f?.label || placeholder || key;
    const val = form[key] ?? '';
    return (
      <TextField
        key={key}
        label={`${label}${f?.required ? ' *' : ''}`}
        placeholder={placeholder || label}
        value={val}
        onChangeText={(t) => setField(key, t)}
      />
    );
  };

  const renderPhoneInput = (key = 'phone') => {
    const f = getField(key);
    if (!f) return null;
    const val = form[key] ?? '';
    const label = f?.label || 'Телефон';
    return (
      <View key={key}>
        <Text style={styles.label}>
          {label}
          {f?.required ? ' *' : ''}
        </Text>
        <MaskedTextInput
          style={styles.input}
          mask="+7 (999) 999-99-99"
          keyboardType="phone-pad"
          placeholder="+7 (___) ___-__-__"
          placeholderTextColor={theme.colors?.placeholder ?? theme.colors?.textSecondary ?? theme.colors?.text}
          value={val}
          onChangeText={(text, rawText) => setField(key, rawText)}
        />
      </View>
    );
  };

  // ------------------------- SUBMIT -------------------------
  // Validate required fields from Form Builder (create schema)
  function validateRequiredBySchemaCreate() {
    try {
      const arr = (schema?.fields || []).filter((f) => f?.required);
      if (!arr.length) return { ok: true };
      const missing = [];
      for (const f of arr) {
        const k = f.field_key;
        const v = form[k];
        if (k === 'phone') {
          const normalized = normalizePhone(form.phone);
          if (!normalized) missing.push(f.label || k);
        } else if (k === 'datetime') {
          if (!departureDate) missing.push(f.label || k);
        } else if (k === 'assigned_to') {
          // required only if NOT sending to feed
          if (!toFeed && !assigneeId) missing.push(f.label || k);
        } else {
          if (v === null || v === undefined || String(v).trim() === '') {
            missing.push(f.label || k);
          }
        }
      }
      if (missing.length) {
        return { ok: false, msg: `Заполните обязательные поля: ${missing.join(', ')}` };
      }
      return { ok: true };
    } catch (_e) {
      return { ok: true };
    }
  }

  const handleSubmit = async () => {
    // Validate required fields defined in admin Form Builder (create schema)
    const reqCheck = validateRequiredBySchemaCreate();
    if (!reqCheck.ok) {
      showWarning(reqCheck.msg);
      return;
    }
    const title = (form.title || '').trim();
    if (!title) return showWarning('Укажите название заявки');
    if (!departureDate) return showWarning('Укажите дату выезда');
    if (!toFeed && !assigneeId) return showWarning('Выберите исполнителя или отправьте в ленту');

    const phoneField = getField('phone');
    let phoneFormatted = null;
    if (phoneField) {
      phoneFormatted = normalizePhone(form.phone);
      if (!phoneFormatted) return showWarning('Введите корректный номер телефона');
    }

    const custom = buildCustomPayload(schema.fields, form);
    const payload = {
      title: form.title ?? '',
      comment: description,
      region: form.region || '',
      city: form.city || '',
      street: form.street || '',
      house: form.house || '',
      fio: form.customer_name || form.fio || '',
      phone: phoneFormatted,
      assigned_to: toFeed ? null : assigneeId,
      datetime: departureDate ? departureDate.toISOString() : null,
      status: toFeed ? 'В ленте' : 'Новый',
      urgent: urgent,
      custom,
    };

    const { error } = await supabase.from('orders').insert(payload);
    if (error) {
      showWarning(error.message);
    } else {
      router.replace('/order-success');
    }
  };

  // ------------------------- UI -------------------------
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <SafeAreaView
        style={{ flex: 1, backgroundColor: styles.container.backgroundColor }}
        edges={['top', 'left', 'right']}
      >
        <View style={styles.container}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode={Platform.OS === 'ios' ? 'on-drag' : 'none'}
            contentInsetAdjustmentBehavior="automatic"
          >
            <Text style={styles.pageTitle}>Создание новой заявки</Text>

            {/* ОСНОВНОЕ */}
            <View style={styles.card}>
              <Text style={styles.section}>Основное</Text>
              {renderTextInput('title', 'Например: Обрезка деревьев')}
              <TextField
                label="Описание"
                placeholder="Подробности (если есть)"
                value={description}
                onChangeText={setDescription}
                multiline
              />
            </View>

            {/* АДРЕС */}
            <View style={styles.card}>
              <Text style={styles.section}>Адрес</Text>
              {renderTextInput('region', 'Например: Саратовская область')}
              {renderTextInput('city', 'Например: Энгельс')}
              {renderTextInput('street', 'Например: ул. Центральная')}
              {renderTextInput('house', 'Например: 15А')}
            </View>

            {/* ЗАКАЗЧИК */}
            <View style={styles.card}>
              <Text style={styles.section}>Заказчик</Text>
              {renderTextInput('fio', 'ФИО или просто имя')}
              {renderPhoneInput('phone')}
            </View>

            {/* ПЛАНИРОВАНИЕ */}
            <View style={styles.card}>
              <Text style={styles.section}>Планирование</Text>
              <View style={styles.toggleRow}>
                <Pressable
                  onPress={() => setUrgent((v) => !v)}
                  style={[styles.toggle, urgent && styles.toggleOn]}
                >
                  <View style={[styles.knob, urgent && styles.knobOn]} />
                </Pressable>
                <Text style={styles.toggleLabel}>Срочная</Text>
              </View>

              <Text style={styles.label}>{getField('datetime')?.label || 'Дата выезда'} *</Text>
              <View
                ref={(ref) => {
                  if (ref) dateFieldRef.current = findNodeHandle(ref);
                }}
              >
                <Pressable
                  style={styles.selectInput}
                  onPress={() => {
                    setShowDatePicker(true);
                    setTimeout(() => scrollToHandle(dateFieldRef), 200);
                  }}
                >
                  <Text style={styles.selectInputText}>
                    {departureDate
                      ? departureDate.toLocaleDateString('ru-RU', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                        })
                      : 'Выберите дату'}
                  </Text>
                  <AntDesign
                    name="calendar"
                    size={16}
                    color={palette.icon}
                  />
                </Pressable>
              </View>
              {showDatePicker && (
                <DateTimePicker
                  value={departureDate || new Date()}
                  mode="date"
                  display="default"
                  minimumDate={new Date()}
                  onChange={(event, selected) => {
                    setShowDatePicker(false);
                    if (selected) {
                      // если время уже выбрано, сохраняем его
                      setDepartureDate((prev) => {
                        if (prev) {
                          const d = new Date(selected);
                          d.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
                          return d;
                        }
                        return selected;
                      });
                    }
                  }}
                />
              )}

              {/* Время выезда (опционально, включается настройкой компании) */}
              <Text style={styles.label}>Время выезда</Text>
              <View
                ref={(ref) => {
                  if (ref) timeFieldRef.current = findNodeHandle(ref);
                }}
              >
                <Pressable
                  style={styles.selectInput}
                  onPress={() => {
                    if (!departureDate) {
                      setShowDatePicker(true);
                      setTimeout(() => scrollToHandle(dateFieldRef), 200);
                      return;
                    }
                    setShowTimePicker(true);
                    setTimeout(() => scrollToHandle(timeFieldRef), 200);
                  }}
                >
                  <Text style={styles.selectInputText}>
                    {departureDate
                      ? departureDate.toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Сначала выберите дату'}
                  </Text>
                  <AntDesign
                    name="clockcircleo"
                    size={16}
                    color={palette.icon}
                  />
                </Pressable>
              </View>
              {showTimePicker && departureDate && (
                <DateTimePicker
                  value={departureDate}
                  mode="time"
                  is24Hour
                  display="default"
                  onChange={(event, selected) => {
                    setShowTimePicker(false);
                    if (selected) {
                      setDepartureDate((prev) => {
                        const base = prev || new Date();
                        const d = new Date(base);
                        d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
                        return d;
                      });
                    }
                  }}
                />
              )}

              <View style={[styles.toggleRow, { marginTop: 12 }]}>
                <Pressable
                  onPress={() =>
                    setToFeed((prev) => {
                      const nv = !prev;
                      if (nv) setAssigneeId(null);
                      return nv;
                    })
                  }
                  style={[styles.toggle, toFeed && styles.toggleOn]}
                >
                  <View style={[styles.knob, toFeed && styles.knobOn]} />
                </Pressable>
                <Text style={styles.toggleLabel}>Отправить в ленту</Text>
              </View>

              <Text style={styles.label}>
                {getField('assigned_to')?.label || 'Исполнитель'} {toFeed ? '' : '*'}
              </Text>
              <Pressable
                style={[styles.selectInput, toFeed && { opacity: 0.5 }]}
                onPress={() => setAssigneeModalVisible(true)}
                disabled={toFeed}
              >
                <Text style={styles.selectInputText}>
                  {assigneeId
                    ? (() => {
                        const u = users.find((x) => x.id === assigneeId);
                        return (
                          [u?.first_name, u?.last_name].filter(Boolean).join(' ') ||
                          'Выбран исполнитель'
                        );
                      })()
                    : toFeed
                      ? 'В общую ленту'
                      : 'Выберите исполнителя...'}
                </Text>
                <AntDesign
                  name="down"
                  size={16}
                  color={palette.icon}
                />
              </Pressable>
            </View>

            <View style={{ marginTop: 20 }}>
              <Button title="Создать заявку" onPress={handleSubmit} />
            </View>
            <View style={{ marginTop: 12 }}>
              <Button title="Отменить" onPress={handleCancelPress} variant="secondary" />
            </View>
          </ScrollView>
        </View>

        {/* МОДАЛКИ */}
        <Modal
          isVisible={cancelVisible}
          onBackdropPress={() => setCancelVisible(false)}
          useNativeDriver
          backdropOpacity={0.3}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Отменить создание заявки?</Text>
            <Text style={styles.modalText}>Все данные будут потеряны. Вы уверены?</Text>
            <View style={styles.modalActions}>
              <Button title="Остаться" onPress={() => setCancelVisible(false)} />
              <Button title="Выйти" onPress={confirmCancel} variant="destructive" />
            </View>
          </View>
        </Modal>

        <Modal
          isVisible={assigneeModalVisible}
          onBackdropPress={() => setAssigneeModalVisible(false)}
          useNativeDriver
          backdropOpacity={0.3}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Выберите исполнителя</Text>
            <Pressable
              onPress={() => {
                setToFeed(true);
                setAssigneeId(null);
                setAssigneeModalVisible(false);
              }}
              style={({ pressed }) => [styles.assigneeOption, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.assigneeText}>В общую ленту</Text>
            </Pressable>
            <View style={{ height: 8 }} />
            {users.map((user) => (
              <Pressable
                key={user.id}
                onPress={() => {
                  setAssigneeId(user.id);
                  setToFeed(false);
                  setAssigneeModalVisible(false);
                }}
                style={({ pressed }) => [styles.assigneeOption, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.assigneeText}>
                  {[user.first_name, user.last_name].filter(Boolean).join(' ')}
                </Text>
              </Pressable>
            ))}
          </View>
        </Modal>

        <Modal
          isVisible={warningVisible}
          onBackdropPress={() => setWarningVisible(false)}
          useNativeDriver
          backdropOpacity={0.3}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Внимание</Text>
            <Text style={styles.modalText}>{warningMessage}</Text>
            <View style={styles.modalActions}>
              <Button title="Ок" onPress={() => setWarningVisible(false)} />
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}