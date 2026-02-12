// components/ui/modals/SelectModal.jsx
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
  selectedId = null,
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
    const isSelected = selectedId && item.id === selectedId;
    const handlePress = () => {
      if (disabled) return;
      // Если у элемента есть свой onPress, вызываем его
      if (item.onPress) {
        item.onPress(item);
      } else if (onSelect) {
        // Иначе вызываем общий onSelect
        onSelect(item);
      }
    };

    return (
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        android_ripple={{ color: theme.colors.ripple }}
        style={({ pressed }) => [
          s.item,
          isSelected && s.itemSelected,
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
            <View style={[s.radioButton, isSelected && s.radioButtonSelected]}>
              {isSelected && <View style={s.radioDot} />}
            </View>
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
    itemSelected: {
      backgroundColor: t.colors.surface,
      borderColor: t.colors.primary,
      borderWidth: 2,
    },
    itemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
    itemTitle: { fontSize: t.typography.sizes.md, fontWeight: '600' },
    itemTitleSelected: { color: t.colors.text },
    itemSub: { marginTop: 2, fontSize: t.typography.sizes.sm },
    itemRight: { marginLeft: 8, alignSelf: 'center' },
    radioButton: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: '#C7C7CC',
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioButtonSelected: {
      borderColor: t.colors.primary,
      borderWidth: 1.5,
    },
    radioDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: t.colors.primary,
    },
  });
