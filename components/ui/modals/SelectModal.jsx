import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { t as T } from '../../../src/i18n';
import { useTheme } from '../../../theme';
import { withAlpha } from '../../../theme/colors';
import TextField from '../TextField';
import BaseModal from './BaseModal';

const NOOP = () => {};

export default function SelectModal({
  visible,
  title = T('modal_select_title'),
  items = [],
  onSelect,
  onClose,
  onDismiss,
  searchable = true,
  renderItem,
  footer,
  initialSearch = '',
  maxHeightRatio = Platform.OS === 'android' ? 0.62 : 0.75,
  selectedId = null,
  initialScrollIndex = null,
  isItemSelected,
  listBottomInset,
  listFooter,
  searchLabel = T('common_search'),
  searchPlaceholder = T('common_start_typing'),
  onSearchChange,
  onFilteredCountChange,
  emptyComponent = null,
  loading = false,
  filterFn,
  onItemLongPress,
  itemTitleNumberOfLines = 1,
  itemSubtitleNumberOfLines = 1,
  multilineItems = false,
  minTopGapFromStatusBar,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const itemHeight = theme.components?.listItem?.height ?? 52;
  const separatorHeight = theme.spacing.sm;
  const rowStride = itemHeight + separatorHeight;
  const listBottomGap = theme.spacing.lg;
  const bottomInset =
    typeof listBottomInset === 'number' ? listBottomInset : theme.spacing.xxxl + theme.spacing.md;

  const [query, setQuery] = useState(initialSearch);
  const longPressHandledIdRef = React.useRef(null);
  React.useEffect(() => {
    if (!visible) setQuery(initialSearch || '');
  }, [visible, initialSearch]);
  React.useEffect(() => {
    onSearchChange?.(query);
  }, [onSearchChange, query]);

  const data = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    if (typeof filterFn === 'function') {
      return items.filter((item) => filterFn(item, q));
    }
    return items.filter(
      (it) =>
        String(it.label || '')
          .toLowerCase()
          .includes(q) ||
        String(it.subtitle || '')
          .toLowerCase()
          .includes(q),
    );
  }, [filterFn, items, query]);
  React.useEffect(() => {
    onFilteredCountChange?.(Array.isArray(data) ? data.length : 0);
  }, [data, onFilteredCountChange]);

  const isSelectedItem = React.useCallback(
    (item) => {
      if (typeof isItemSelected === 'function') return !!isItemSelected(item, selectedId);
      if (selectedId == null) return false;
      return String(item?.id) === String(selectedId);
    },
    [isItemSelected, selectedId],
  );

  const renderDefaultItem = ({ item }) => {
    const disabled = !!item.disabled;
    const isSelected = isSelectedItem(item);
    const handlePress = () => {
      if (disabled) return;
      const itemId = String(item?.id ?? '');
      if (longPressHandledIdRef.current && longPressHandledIdRef.current === itemId) {
        longPressHandledIdRef.current = null;
        return;
      }
      if (item.onPress) {
        item.onPress(item);
      } else if (onSelect) {
        onSelect(item);
      }
    };

    return (
      <Pressable
        onPress={handlePress}
        onLongPress={(event) => {
          if (disabled) return;
          longPressHandledIdRef.current = String(item?.id ?? '');
          onItemLongPress?.(item, event);
        }}
        delayLongPress={220}
        disabled={disabled}
        android_ripple={{ color: theme.colors.ripple }}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled }}
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
            <Text
              numberOfLines={itemTitleNumberOfLines}
              style={[
                s.itemTitle,
                multilineItems ? s.itemTitleMultiline : null,
                isSelected ? s.itemTitleSelected : null,
                { color: isSelected ? theme.colors.primary : theme.colors.text },
              ]}
            >
              {String(item.label || '')}
            </Text>
            {item.subtitle ? (
              <Text
                numberOfLines={itemSubtitleNumberOfLines}
                style={[s.itemSub, { color: theme.colors.textSecondary }]}
              >
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
    <BaseModal
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      title={title}
      maxHeightRatio={maxHeightRatio}
      presentation="sheet"
      minTopGapFromStatusBar={minTopGapFromStatusBar}
    >
      {searchable ? (
        <View style={{ marginBottom: theme.spacing.sm }}>
          <TextField
            label={searchLabel}
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            returnKeyType="search"
          />
        </View>
      ) : null}

      <FlatList
        data={data}
        keyExtractor={(it, i) => String(it.id ?? i)}
        renderItem={renderItem || renderDefaultItem}
        initialScrollIndex={
          Number.isInteger(initialScrollIndex) && initialScrollIndex >= 0
            ? initialScrollIndex
            : undefined
        }
        getItemLayout={
          multilineItems
            ? undefined
            : (_items, index) => ({
                length: itemHeight,
                offset: rowStride * index,
                index,
              })
        }
        initialNumToRender={Math.min(Math.max(1, data.length), 16)}
        maxToRenderPerBatch={Math.min(Math.max(1, data.length), 24)}
        windowSize={7}
        removeClippedSubviews={false}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        contentContainerStyle={{
          paddingTop: theme.spacing.sm,
          paddingRight: theme.spacing.xs,
          paddingBottom: bottomInset,
        }}
        style={{ flexGrow: 0, flexShrink: 1, minHeight: 0, paddingRight: theme.spacing.xs }}
        ListFooterComponent={listFooter || <View style={{ height: bottomInset }} />}
        ListEmptyComponent={
          loading ? (
            <View style={s.loadingEmpty}>
              <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            </View>
          ) : (
            emptyComponent || null
          )
        }
        onScrollToIndexFailed={NOOP}
        keyboardShouldPersistTaps="handled"
      />
      <View style={{ height: listBottomGap }} />

      {footer ? <View style={{ marginTop: theme.spacing.sm }}>{footer}</View> : null}
    </BaseModal>
  );
}

const styles = (t) => {
  const radioSize = t.components?.radio?.size ?? t.icons?.md ?? 22;
  const radioDot =
    t.components?.radio?.dot ??
    Math.max(t.components?.radio?.dotMin ?? 6, Math.round(radioSize / 2 - 3));
  const radioBorder = t.components?.radio?.borderWidth ?? 1.5;
  const optionRadius = t.components?.selectModal?.itemRadius ?? t.radii?.lg ?? 12;
  const optionPaddingY = t.components?.selectModal?.itemPaddingY ?? t.spacing?.sm ?? 8;
  return StyleSheet.create({
    item: {
      minHeight: t.components?.listItem?.height ?? 52,
      paddingHorizontal: t.spacing.lg,
      paddingVertical: optionPaddingY,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      borderRadius: optionRadius,
    },
    itemSelected: {
      backgroundColor: withAlpha(t.colors.primary, t.mode === 'dark' ? 0.16 : 0.08),
      borderColor: t.colors.primary,
    },
    itemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
    itemTitle: { fontSize: t.typography.sizes.md, fontWeight: '600' },
    itemTitleMultiline: {
      lineHeight: Math.round((t.typography.sizes.md ?? 16) * (t.typography.lineHeights?.normal ?? 1.35)),
      flexShrink: 1,
    },
    itemTitleSelected: {
      fontWeight: t.typography?.weight?.bold ?? '700',
    },
    itemSub: { marginTop: 2, fontSize: t.typography.sizes.sm },
    itemRight: { marginLeft: t.spacing.sm, alignSelf: 'center' },
    loadingEmpty: {
      minHeight: t.components?.listItem?.height ?? 52,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: t.spacing.lg,
    },
    radioButton: {
      width: radioSize,
      height: radioSize,
      borderRadius: radioSize / 2,
      borderWidth: radioBorder,
      borderColor: t.colors.inputBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioButtonSelected: {
      borderColor: t.colors.primary,
      backgroundColor: withAlpha(t.colors.primary, t.mode === 'dark' ? 0.2 : 0.12),
      borderWidth: radioBorder,
    },
    radioDot: {
      width: radioDot,
      height: radioDot,
      borderRadius: radioDot / 2,
      backgroundColor: t.colors.primary,
    },
  });
};
