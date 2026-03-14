import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Button from '../ui/Button';
import TextField from '../ui/TextField';
import { useTheme } from '../../theme/ThemeProvider';
import { t } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';

const SCREEN_W = Dimensions.get('window').width;

function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

function normalizeValues(values = {}) {
  return {
    workTypes: Array.isArray(values.workTypes) ? values.workTypes.map(String) : [],
    statuses: Array.isArray(values.statuses) ? values.statuses : [],
    executorId: values.executorId ? String(values.executorId) : null,
    departureDateFrom: values.departureDateFrom || null,
    departureDateTo: values.departureDateTo || null,
    departureTimeFrom: values.departureTimeFrom || null,
    departureTimeTo: values.departureTimeTo || null,
    sumMin: values.sumMin || '',
    sumMax: values.sumMax || '',
  };
}

export default function OrdersFiltersPanel({
  visible,
  onClose,
  values = {},
  setValue,
  defaults = {},
  workTypes = [],
  useWorkTypes = false,
  statusOptions = [],
  executorOptions = [],
  onApply,
  onReset,
}) {
  const { theme } = useTheme();
  useTranslation();
  const normalizedDefaults = useMemo(() => normalizeValues(defaults), [defaults]);
  const [draft, setDraft] = useState(() => normalizeValues(values));
  const [baseline, setBaseline] = useState(() => normalizeValues(values));
  const [datePickerField, setDatePickerField] = useState(null);
  const [timePickerField, setTimePickerField] = useState(null);
  const [executorSearch, setExecutorSearch] = useState('');

  useEffect(() => {
    if (!visible) return;
    const snapshot = normalizeValues(values);
    setDraft(snapshot);
    setBaseline(snapshot);
    setExecutorSearch('');
  }, [visible, values]);

  const setDraftValue = (key, val) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
  };

  const toggleSelection = (key, value) => {
    setDraft((prev) => {
      const current = Array.isArray(prev[key]) ? prev[key] : [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const handleNumericInput = (key, text) => {
    const filtered = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    setDraftValue(key, filtered);
  };

  const filteredExecutors = useMemo(() => {
    const list = Array.isArray(executorOptions) ? executorOptions : [];
    const query = String(executorSearch || '').trim().toLowerCase();
    if (!query) return list;
    return list.filter((executor) =>
      String(executor?.label || executor?.name || '')
        .trim()
        .toLowerCase()
        .includes(query),
    );
  }, [executorOptions, executorSearch]);

  const handleDatePick = (field, event, selected) => {
    setDatePickerField(null);
    if (event.type === 'dismissed' || !selected) return;
    const iso = selected.toISOString().split('T')[0];
    setDraftValue(field, iso);
  };

  const handleTimePick = (field, event, selected) => {
    setTimePickerField(null);
    if (event.type === 'dismissed' || !selected) return;
    const hours = String(selected.getHours()).padStart(2, '0');
    const minutes = String(selected.getMinutes()).padStart(2, '0');
    setDraftValue(field, `${hours}:${minutes}`);
  };

  const areArraysEqual = (a = [], b = []) => {
    if (a.length !== b.length) return false;
    const A = [...a].sort();
    const B = [...b].sort();
    for (let i = 0; i < A.length; i += 1) {
      if (A[i] !== B[i]) return false;
    }
    return true;
  };

  const hasChanges = useMemo(() => {
    const keys = Object.keys(draft);
    for (const key of keys) {
      const current = draft[key];
      const previous = baseline[key];
      if (Array.isArray(current) && Array.isArray(previous)) {
        if (!areArraysEqual(current, previous)) return true;
        continue;
      }
      if (current !== previous) return true;
    }
    return false;
  }, [baseline, draft]);

  const handleReset = () => {
    setDraft(normalizedDefaults);
    setBaseline(normalizedDefaults);
    Object.entries(normalizedDefaults).forEach(([key, value]) => {
      if (setValue) setValue(key, value);
    });
    if (onReset) onReset();
  };

  const applyChanges = () => {
    const snapshot = normalizeValues(draft);
    Object.entries(draft).forEach(([key, value]) => {
      if (setValue) setValue(key, value);
    });
    setBaseline(snapshot);
    if (onApply) onApply(snapshot);
    if (onClose) onClose();
  };

  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const rad = theme.radii;
  const sh = theme.shadows;
  const APPLY_BUTTON_HEIGHT = theme?.components?.button?.height ?? 48;
  const ICON_SIZE = theme?.components?.icon?.sizeMd ?? 22;

  const [mounted, setMounted] = useState(visible);
  const tx = useRef(new Animated.Value(visible ? 0 : SCREEN_W)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(tx, {
        toValue: 0,
        damping: 28,
        stiffness: 260,
        mass: 0.85,
        useNativeDriver: true,
        overshootClamping: true,
      }).start();
    } else {
      Animated.timing(tx, {
        toValue: SCREEN_W,
        duration: 280,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, tx]);

  useEffect(() => {
    if (!visible) return undefined;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose?.();
      return true;
    });
    return () => handler.remove();
  }, [onClose, visible]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          ...StyleSheet.absoluteFillObject,
          zIndex: theme?.zIndices?.modal ?? 1000,
          backgroundColor: withAlpha(c.overlay, 0.9),
        },
        page: {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: SCREEN_W,
          backgroundColor: c.background,
          shadowColor: sh?.card?.ios?.shadowColor,
          shadowOpacity: sh?.card?.ios?.shadowOpacity,
          shadowRadius: sh?.card?.ios?.shadowRadius,
          shadowOffset: sh?.card?.ios?.shadowOffset,
          elevation: sh?.card?.android?.elevation,
        },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          padding: sz.md,
          borderBottomWidth: 1,
          borderColor: c.border,
        },
        title: {
          flex: 1,
          marginLeft: sz.sm,
          fontSize: ty.sizes.lg,
          fontWeight: ty.weight.bold,
          color: c.text,
        },
        resetBtn: { paddingHorizontal: sz.sm, paddingVertical: sz.xs },
        resetText: {
          color: c.primary,
          fontSize: ty.sizes.sm,
          fontWeight: ty.weight.semibold,
          opacity: hasChanges ? 1 : 0.35,
        },
        scroll: {
          flex: 1,
          padding: sz.lg,
          paddingBottom: Math.max(sz.lg, APPLY_BUTTON_HEIGHT + sz.lg),
        },
        section: { marginBottom: sz.lg },
        sectionTitle: {
          fontSize: ty.sizes.md,
          fontWeight: ty.weight.semibold,
          color: c.text,
          marginBottom: sz.sm,
        },
        chipsRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        },
        chip: {
          borderRadius: rad.md,
          borderWidth: 1,
          borderColor: c.border,
          paddingVertical: 8,
          paddingHorizontal: 12,
          backgroundColor: c.surface,
        },
        chipActive: {
          borderColor: c.primary,
          backgroundColor: withAlpha(c.primary, 0.15),
        },
        chipText: { color: c.textSecondary },
        chipTextActive: { color: c.primary },
        dateRow: {
          flexDirection: 'row',
          gap: sz.sm,
          marginTop: sz.sm,
        },
        selector: {
          flex: 1,
          borderRadius: rad.md,
          borderWidth: 1,
          borderColor: c.border,
          paddingVertical: 12,
          paddingHorizontal: sz.md,
          backgroundColor: c.surface,
        },
        selectorText: {
          color: c.textSecondary,
          fontSize: ty.sizes.md,
        },
        pairRow: {
          flexDirection: 'row',
          gap: sz.sm,
          marginTop: sz.sm,
        },
        optionsList: {
          marginTop: sz.sm,
          borderRadius: rad.lg,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          overflow: 'hidden',
        },
        optionRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: sz.md,
          paddingVertical: sz.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
        },
        optionRowLast: {
          borderBottomWidth: 0,
        },
        optionTextWrap: {
          flex: 1,
          paddingRight: sz.sm,
        },
        optionLabel: {
          color: c.text,
          fontSize: ty.sizes.md,
        },
        optionMeta: {
          color: c.textSecondary,
          fontSize: ty.sizes.sm,
          marginTop: 2,
        },
        checkmark: {
          color: c.primary,
          fontSize: ty.sizes.md,
          fontWeight: ty.weight.semibold,
        },
        emptyText: {
          color: c.textSecondary,
          fontSize: ty.sizes.sm,
        },
        footer: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: sz.lg,
          backgroundColor: c.background,
          borderTopWidth: 1,
          borderColor: c.border,
        },
      }),
    [APPLY_BUTTON_HEIGHT, c, hasChanges, rad.lg, rad.md, sh, sz, theme, ty],
  );

  if (!mounted && !visible) return null;

  const renderSelector = (label, value, onPress) => (
    <Pressable style={styles.selector} onPress={onPress} accessibilityRole="button">
      <Text style={styles.selectorText}>{value || label || t('common_select')}</Text>
    </Pressable>
  );

  const getDateLabel = (iso) => {
    if (!iso) return null;
    const parsed = new Date(iso);
    return isNaN(parsed.getTime())
      ? null
      : parsed.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });
  };

  const getTimeLabel = (time) => {
    if (!time) return null;
    try {
      const [hh, mm] = time.split(':');
      const hours = Number.isNaN(Number(hh)) ? 0 : Number(hh);
      const minutes = Number.isNaN(Number(mm)) ? 0 : Number(mm);
      const base = new Date();
      base.setHours(hours, minutes, 0, 0);
      return base.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return null;
    }
  };

  const datePickerValue = () => {
    if (!datePickerField) return new Date();
    const current = draft[datePickerField];
    const parsed = current ? new Date(current) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
    return new Date();
  };

  const timePickerValue = () => {
    if (!timePickerField) return new Date();
    const current = draft[timePickerField];
    const date = new Date();
    if (!current) return date;
    const [hh, mm] = current.split(':');
    date.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
    return date;
  };

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.page, { transform: [{ translateX: tx }] }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => onClose?.()}
            accessibilityRole="button"
            accessibilityLabel={t('common_back')}
          >
            <Feather name="chevron-left" size={ICON_SIZE} color={c.text} />
          </Pressable>
          <Text style={styles.title}>{t('common_filter')}</Text>
          <Pressable onPress={handleReset} accessibilityRole="button">
            <Text style={styles.resetText}>{t('settings_sections_quiet_items_quiet_reset')}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: sz.lg }}>
          {useWorkTypes && workTypes.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('order_field_work_type')}</Text>
              <View style={styles.chipsRow}>
                {workTypes.map((wt) => {
                  const key = String(wt.id);
                  const active = draft.workTypes.includes(key);
                  return (
                    <Pressable
                      key={key}
                      onPress={() => toggleSelection('workTypes', key)}
                      style={[
                        styles.chip,
                        active && styles.chipActive,
                      ]}
                      android_ripple={{ color: withAlpha(c.border, 0.12), borderless: true }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {wt.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {statusOptions.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('orders_filter_status')}</Text>
              <View style={styles.chipsRow}>
                {statusOptions.map((opt) => {
                  const active = draft.statuses.includes(opt.id);
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => toggleSelection('statuses', opt.id)}
                      style={[styles.chip, active && styles.chipActive]}
                      android_ripple={{ color: withAlpha(c.border, 0.12), borderless: true }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {executorOptions.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('orders_filter_executor', 'Исполнитель')}</Text>
              <TextField
                value={executorSearch}
                onChangeText={setExecutorSearch}
                placeholder={t('common_search')}
                hideSeparator
              />
              <View style={styles.optionsList}>
                <Pressable
                  onPress={() => setDraftValue('executorId', null)}
                  style={[
                    styles.optionRow,
                    filteredExecutors.length === 0 ? styles.optionRowLast : null,
                  ]}
                  accessibilityRole="button"
                >
                  <View style={styles.optionTextWrap}>
                    <Text style={styles.optionLabel}>{t('users_showAll')}</Text>
                  </View>
                  {draft.executorId == null ? <Text style={styles.checkmark}>✓</Text> : null}
                </Pressable>
                {filteredExecutors.length > 0 ? (
                  filteredExecutors.map((executor, index) => {
                    const id = String(executor?.value ?? executor?.id ?? '');
                    const active = draft.executorId === id;
                    return (
                      <Pressable
                        key={id}
                        onPress={() => setDraftValue('executorId', active ? null : id)}
                        style={[
                          styles.optionRow,
                          index === filteredExecutors.length - 1 ? styles.optionRowLast : null,
                        ]}
                        accessibilityRole="button"
                      >
                        <View style={styles.optionTextWrap}>
                          <Text style={styles.optionLabel}>{executor?.label || id}</Text>
                          {executor?.meta ? (
                            <Text style={styles.optionMeta}>{executor.meta}</Text>
                          ) : null}
                        </View>
                        {active ? <Text style={styles.checkmark}>✓</Text> : null}
                      </Pressable>
                    );
                  })
                ) : (
                  <View style={[styles.optionRow, styles.optionRowLast]}>
                    <Text style={styles.emptyText}>{t('common_noData')}</Text>
                  </View>
                )}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('order_field_departure_date')}</Text>
            <View style={styles.dateRow}>
              {renderSelector(
                t('common_from'),
                getDateLabel(draft.departureDateFrom),
                () => setDatePickerField('departureDateFrom'),
              )}
              {renderSelector(
                t('common_to'),
                getDateLabel(draft.departureDateTo),
                () => setDatePickerField('departureDateTo'),
              )}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('order_field_departure_time')}</Text>
            <View style={styles.dateRow}>
              {renderSelector(
                t('common_from'),
                getTimeLabel(draft.departureTimeFrom),
                () => setTimePickerField('departureTimeFrom'),
              )}
              {renderSelector(
                t('common_to'),
                getTimeLabel(draft.departureTimeTo),
                () => setTimePickerField('departureTimeTo'),
              )}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('order_details_amount')}</Text>
            <View style={styles.pairRow}>
              <TextField
                value={draft.sumMin}
                onChangeText={(text) => handleNumericInput('sumMin', text)}
                placeholder={t('common_from')}
                keyboardType="numeric"
                style={{ flex: 1 }}
                hideSeparator
              />
              <TextField
                value={draft.sumMax}
                onChangeText={(text) => handleNumericInput('sumMax', text)}
                placeholder={t('common_to')}
                keyboardType="numeric"
                style={{ flex: 1 }}
                hideSeparator
              />
            </View>
          </View>

        </ScrollView>

        {hasChanges && (
          <View style={styles.footer}>
            <Button title={t('btn_apply')} size="md" onPress={applyChanges} />
          </View>
        )}
      </Animated.View>

      {datePickerField ? (
        <DateTimePicker
          value={datePickerValue()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(event, selected) => handleDatePick(datePickerField, event, selected)}
        />
      ) : null}
      {timePickerField ? (
        <DateTimePicker
          value={timePickerValue()}
          mode="time"
          is24Hour
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selected) => handleTimePick(timePickerField, event, selected)}
        />
      ) : null}
    </View>
  );
}
