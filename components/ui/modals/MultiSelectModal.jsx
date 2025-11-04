// components/ui/modals/MultiSelectModal.jsx
//
// A modal component for selecting multiple items from a list. This is
// similar to SelectModal but allows multiple selections. It provides
// search, checkboxes and a sticky footer with “Cancel” and “Done” buttons.
// It is built on top of BaseModal and uses theme colours and spacing.
//
// Props:
//   visible      – boolean controlling visibility of the modal
//   title        – translation key or plain string for the header title
//   items        – array of objects { id?, value, label, subtitle?, disabled? }
//   value        – array of currently selected values (primitive values)
//   onChange     – function called with new array of selected values when user presses Done
//   onClose      – function called when modal is dismissed without applying changes
//   searchable   – show search bar (default true)
//   initialSearch – initial search query when modal opens
//   maxHeightRatio – how tall the sheet can be relative to screen
//
// Usage:
//   <MultiSelectModal
//     visible={show}
//     title="filter_work_type"
//     items={[ { value: 'foo', label: 'Foo' }, ... ]}
//     value={selectedValues}
//     onChange={(vals) => setSelectedValues(vals)}
//     onClose={() => setShow(false)}
//   />

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, Platform, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme';
import BaseModal from './BaseModal';
import TextField from '../TextField';
import Button from '../Button';
import { t as T } from '../../../src/i18n';

export default function MultiSelectModal({
  visible,
  title = T('modal_select_title'),
  items = [],
  value = [],
  onChange,
  onClose,
  searchable = true,
  initialSearch = '',
  maxHeightRatio = 0.75,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => styles(theme), [theme]);

  // Local selection state; copy of value prop to allow undo
  const [selected, setSelected] = useState(() => Array.isArray(value) ? [...value] : []);
  const [query, setQuery] = useState(initialSearch);
  React.useEffect(() => {
    if (visible) {
      setSelected(Array.isArray(value) ? [...value] : []);
      setQuery(initialSearch || '');
    }
  }, [visible, value, initialSearch]);

  // Filter list according to query
  const data = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      const l = String(it.label || '').toLowerCase();
      const sub = String(it.subtitle || '').toLowerCase();
      return l.includes(q) || sub.includes(q);
    });
  }, [items, query]);

  const toggleItem = (val) => {
    setSelected((prev) => {
      const idx = prev.findIndex((v) => v === val);
      if (idx >= 0) {
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      }
      return [...prev, val];
    });
  };

  const renderItem = ({ item }) => {
    const disabled = !!item.disabled;
    const isChecked = selected.includes(item.value);
    return (
      <Pressable
        onPress={() => !disabled && toggleItem(item.value)}
        disabled={disabled}
        android_ripple={{ color: theme.colors.ripple || '#00000014' }}
        style={({ pressed }) => [s.item, disabled && { opacity: 0.5 }, pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isChecked, disabled }}
      >
        <View style={s.itemLeft}>
          {item.icon ? <View style={{ marginRight: theme.spacing.sm }}>{item.icon}</View> : null}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[s.itemTitle, { color: theme.colors.text }]}>
              {item.label}
            </Text>
            {item.subtitle ? (
              <Text numberOfLines={1} style={[s.itemSub, { color: theme.colors.textSecondary }]}>
                {item.subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={s.itemRight}>
          {isChecked ? (
            <Feather name="check-circle" size={20} color={theme.colors.primary} />
          ) : (
            <Feather name="circle" size={20} color={theme.colors.textSecondary} />
          )}
        </View>
      </Pressable>
    );
  };

  const footer = (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      <Button
        variant="secondary"
        size="md"
        title={T('btn_cancel', 'Отмена')}
        onPress={() => {
          onClose?.();
        }}
      />
      <Button
        variant="primary"
        size="md"
        title={T('btn_done', 'Готово')}
        onPress={() => {
          onChange?.(selected);
          onClose?.();
        }}
      />
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={T(title) || title}
      maxHeightRatio={maxHeightRatio}
      footer={footer}
    >
      {searchable ? (
        <View style={{ marginBottom: theme.spacing.sm }}>
          <TextField
            label={T('common_search')}
            value={query}
            onChangeText={setQuery}
            placeholder={T('common_start_typing')}
            returnKeyType="search"
          />
        </View>
      ) : null}
      <FlatList
        data={data}
        keyExtractor={(it, i) => String(it.id ?? i)}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        contentContainerStyle={{ paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.lg }}
        style={{ flexGrow: 0 }}
        keyboardShouldPersistTaps="handled"
      />
    </BaseModal>
  );
}

const styles = (t) =>
  StyleSheet.create({
    item: {
      minHeight: 52,
      paddingHorizontal: t.spacing.lg,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      borderRadius: 12,
    },
    itemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
    itemTitle: { fontSize: t.typography.sizes.md, fontWeight: '600' },
    itemSub: { marginTop: 2, fontSize: t.typography.sizes.sm },
    itemRight: { marginLeft: 8, alignSelf: 'center' },
  });