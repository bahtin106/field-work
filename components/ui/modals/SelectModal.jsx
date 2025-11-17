// components/ui/modals/SelectModal.jsx
import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { t as T } from '../../../src/i18n';
import { useTheme } from '../../../theme';
import TextField from '../TextField';
import BaseModal from './BaseModal';

export default function SelectModal({
  visible,
  title = T('modal_select_title'),
  items = [],
  onSelect,
  onClose,
  searchable = true,
  renderItem,
  footer,
  initialSearch = '',
  maxHeightRatio = 0.75,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => styles(theme), [theme]);

  const [query, setQuery] = useState(initialSearch);
  React.useEffect(() => {
    if (!visible) setQuery(initialSearch || '');
  }, [visible, initialSearch]);

  const data = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(
      (it) =>
        String(it.label || '')
          .toLowerCase()
          .includes(q) ||
        String(it.subtitle || '')
          .toLowerCase()
          .includes(q),
    );
  }, [items, query]);

  const renderDefaultItem = ({ item }) => {
    const disabled = !!item.disabled;
    return (
      <Pressable
        onPress={() => !disabled && onSelect?.(item)}
        disabled={disabled}
        android_ripple={{ color: theme.colors.ripple }}
        style={({ pressed }) => [
          s.item,
          { opacity: disabled ? 0.5 : 1 },
          pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
        ]}
      >
        <View style={s.itemLeft}>
          {item.icon ? <View style={{ marginRight: theme.spacing.sm }}>{item.icon}</View> : null}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[s.itemTitle, { color: theme.colors.text }]}>
              {String(item.label || '')}
            </Text>
            {item.subtitle ? (
              <Text numberOfLines={1} style={[s.itemSub, { color: theme.colors.textSecondary }]}>
                {String(item.subtitle || '')}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={s.itemRight}>
          {item.right ? (
            item.right
          ) : (
            <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <BaseModal visible={visible} onClose={onClose} title={title} maxHeightRatio={maxHeightRatio}>
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
        renderItem={renderItem || renderDefaultItem}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        contentContainerStyle={{ paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.lg }}
        style={{ flexGrow: 0 }}
        keyboardShouldPersistTaps="handled"
      />

      {footer ? <View style={{ marginTop: theme.spacing.sm }}>{footer}</View> : null}
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
