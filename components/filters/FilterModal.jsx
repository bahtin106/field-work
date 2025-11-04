// components/filters/FilterModal.jsx
import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import BaseModal from '../ui/modals/BaseModal';
import SelectModal from '../ui/modals/SelectModal';
import MultiSelectModal from '../ui/modals/MultiSelectModal';
import DateTimeModal from '../ui/modals/DateTimeModal';
import TextField from '../ui/TextField';
import Button from '../ui/Button';
import { t as T } from '../../src/i18n';

/**
 * Universal filter modal component.
 *
 * Receives a schema describing filter fields and renders controls accordingly.
 * Supports text, select, date and switch types. Consumers should manage
 * visibility and state via the useFilters hook. Strings passed via the
 * schema (label) should be translation keys; they are resolved via T().
 *
 * Props:
 *   visible   - boolean indicating if modal is open.
 *   onClose   - callback invoked when modal is dismissed.
 *   title     - modal title (translation key) shown in header.
 *   schema    - array of filter definitions { name, label, type, props }.
 *   values    - object containing current filter values keyed by name.
 *   onChange  - function (name, value) called when a field changes.
 *   onApply   - function called when user presses Apply. Should persist filters.
 *   onReset   - optional function called when user presses Reset inside modal.
 */
export default function FilterModal({
  visible,
  onClose,
  // Default title is a translation key; will be resolved via T()
  title = 'common_filter',
  schema = [],
  values = {},
  onChange,
  onApply,
  onReset,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Track which select/date/multiselect field is currently open
  const [activeSelect, setActiveSelect] = useState(null);
  const [activeMulti, setActiveMulti] = useState(null);
  const [activeDate, setActiveDate] = useState(null);

  const renderField = (f) => {
    const v = values[f.name];
    const translatedLabel = T(f.label) || f.label;
    switch (f.type) {
      case 'text':
        return (
          <View key={f.name} style={styles.fieldContainer}>
            <TextField
              label={translatedLabel}
              value={v == null ? '' : String(v)}
              onChangeText={(text) => onChange(f.name, text)}
              {...(f.props || {})}
            />
          </View>
        );
      case 'select': {
        const selected = f.props?.options?.find((it) => it.value === v);
        const displayValue = selected ? selected.label : T('common_select');
        return (
          <View key={f.name} style={styles.fieldContainer}>
            <Pressable
              onPress={() => setActiveSelect(f.name)}
              android_ripple={{ color: theme.colors.ripple || '#00000014' }}
              style={({ pressed }) => [styles.selectRow, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
            >
              <Text style={styles.selectLabel}>{translatedLabel}</Text>
              <Text style={styles.selectValue}>{String(displayValue)}</Text>
            </Pressable>
            <SelectModal
              visible={activeSelect === f.name}
              title={translatedLabel}
              items={f.props?.options || []}
              onSelect={(item) => {
                onChange(f.name, item.value);
                setActiveSelect(null);
              }}
              onClose={() => setActiveSelect(null)}
              searchable={!!f.props?.searchable}
            />
          </View>
        );
      }
      case 'multiselect': {
        // multi-select: value is an array of values
        const selected = Array.isArray(v) ? v : [];
        // Compose display string: show count or comma-separated labels
        let displayStr;
        if (selected.length === 0) {
          displayStr = T('common_select');
        } else {
          // Map selected values to labels via options
          const labels = (f.props?.options || [])
            .filter((opt) => selected.includes(opt.value))
            .map((opt) => opt.label);
          displayStr = labels.join(', ');
        }
        return (
          <View key={f.name} style={styles.fieldContainer}>
            <Pressable
              onPress={() => setActiveMulti(f.name)}
              android_ripple={{ color: theme.colors.ripple || '#00000014' }}
              style={({ pressed }) => [styles.selectRow, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
            >
              <Text style={styles.selectLabel}>{translatedLabel}</Text>
              <Text
                style={[
                  styles.selectValue,
                  selected.length === 0 ? { color: theme.colors.textSecondary } : {},
                ]}
                numberOfLines={1}
              >
                {displayStr}
              </Text>
            </Pressable>
            <MultiSelectModal
              visible={activeMulti === f.name}
              title={translatedLabel}
              items={f.props?.options || []}
              value={selected}
              onChange={(vals) => {
                onChange(f.name, vals);
              }}
              onClose={() => setActiveMulti(null)}
              searchable={!!f.props?.searchable}
            />
          </View>
        );
      }
      case 'date': {
        return (
          <View key={f.name} style={styles.fieldContainer}>
            <Pressable
              onPress={() => setActiveDate(f.name)}
              android_ripple={{ color: theme.colors.ripple || '#00000014' }}
              style={({ pressed }) => [styles.selectRow, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
            >
              <Text style={styles.selectLabel}>{translatedLabel}</Text>
              <Text style={styles.selectValue}>
                {v ? new Date(v).toLocaleDateString() : T('common_specify') || '-'}
              </Text>
            </Pressable>
            <DateTimeModal
              visible={activeDate === f.name}
              onClose={() => setActiveDate(null)}
              onApply={(date) => {
                onChange(f.name, date);
                setActiveDate(null);
              }}
              mode={f.props?.mode || 'date'}
              {...(f.props || {})}
            />
          </View>
        );
      }
      case 'switch': {
        const val = Boolean(v);
        return (
          <View key={f.name} style={styles.fieldContainerSwitch}>
            <Text style={styles.switchLabel}>{translatedLabel}</Text>
            <Switch
              value={val}
              onValueChange={(nv) => onChange(f.name, nv)}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor={val ? theme.colors.primary : theme.colors.inputBorder}
            />
          </View>
        );
      }
      default:
        return null;
    }
  };

  // Footer with optional reset
  const footer = (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      {onReset ? (
        <Button
          variant="secondary"
          size="md"
          // Use an existing translation key for reset and fallback to plain text
          title={T('settings_sections_quiet_items_quiet_reset', 'Сбросить')}
          onPress={() => onReset()}
        />
      ) : null}
      <Button
        variant="secondary"
        size="md"
        title={T('btn_cancel', 'Отмена')}
        onPress={() => onClose?.()}
      />
      <Button
        variant="primary"
        size="md"
        title={T('btn_apply', 'Применить')}
        onPress={() => onApply?.()}
      />
    </View>
  );

  if (!visible) return null;

  return (
    <BaseModal visible={visible} onClose={onClose} title={T(title) || title} maxHeightRatio={0.7} footer={footer}>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing.md }}>
        {schema.map(renderField)}
      </ScrollView>
    </BaseModal>
  );
}

const createStyles = (t) =>
  StyleSheet.create({
    fieldContainer: { marginBottom: t.spacing.md },
    fieldContainerSwitch: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: t.spacing.sm,
      marginBottom: t.spacing.md,
    },
    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.lg,
      paddingVertical: 12,
      paddingHorizontal: t.spacing.lg,
    },
    selectLabel: {
      fontSize: t.typography.sizes.md,
      color: t.colors.text,
      fontWeight: '600',
    },
    selectValue: {
      fontSize: t.typography.sizes.md,
      color: t.colors.textSecondary || t.colors.text,
    },
    switchLabel: {
      fontSize: t.typography.sizes.md,
      color: t.colors.text,
      fontWeight: '600',
    },
  });