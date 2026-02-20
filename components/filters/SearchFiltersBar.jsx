import { useMemo } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';

import TextField from '../ui/TextField';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';

function createStyles(theme) {
  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const rad = theme.radii;
  const controlH = theme?.components?.input?.height ?? 44;
  const iconSize = theme?.components?.icon?.sizeSm ?? 18;
  const clearTap = theme?.components?.iconButton?.size ?? (iconSize + sz.md);
  const inputInsetKey = theme?.components?.input?.separator?.insetX ?? 'lg';
  const inputInset = Number(sz?.[inputInsetKey] ?? sz.lg ?? 0);
  const clearEdgeGap = Number(theme?.components?.input?.clearEdgeGap ?? sz.xs ?? 0);
  const clearSlotShift = Math.max(0, inputInset - clearEdgeGap);
  const clearIconOffsetY = Number(theme?.components?.icon?.opticalOffsetY ?? 0);

  return StyleSheet.create({
    container: {
      paddingHorizontal: sz.lg,
      paddingBottom: sz.sm,
      gap: sz.xs,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sz.sm,
    },
    searchBox: {
      flex: 1,
      backgroundColor: c.inputBg,
      borderRadius: rad.lg,
      borderWidth: 1,
      borderColor: c.inputBorder,
      minHeight: controlH,
      justifyContent: 'center',
      paddingLeft: sz.sm,
      paddingRight: 0,
    },
    filterButton: {
      width: controlH,
      height: controlH,
      borderRadius: controlH / 2,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    summaryText: {
      color: c.textSecondary,
      fontSize: ty.sizes.sm,
      flex: 1,
      flexWrap: 'wrap',
    },
    resetText: {
      color: c.primary,
      fontSize: ty.sizes.sm,
      marginLeft: sz.sm,
      fontWeight: ty.weight.semibold,
    },
    metaRow: {},
    metaText: {
      color: c.textSecondary,
      fontSize: ty.sizes.sm,
    },
    clearSlot: {
      alignSelf: 'center',
      height: controlH,
      justifyContent: 'center',
      marginRight: -clearSlotShift,
    },
    clearButton: {
      width: clearTap,
      height: clearTap,
      borderRadius: clearTap / 2,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
    },
    clearIcon: {
      color: c.textSecondary,
      fontSize: iconSize,
      transform: [{ translateY: clearIconOffsetY }],
    },
  });
}

export default function SearchFiltersBar({
  value = '',
  onChangeText,
  placeholder,
  onClear,
  onOpenFilters,
  onOpenSort,
  filterSummary,
  onResetFilters,
  summaryResetLabel,
  metaText,
  metaTextStyle,
  searchProps = {},
  style,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const clearIconSize = theme?.components?.icon?.sizeSm ?? 18;
  const sortIconSize = theme?.components?.icon?.sizeSm ?? 18;

  return (
    <View style={[styles.container, style]}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextField
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder || t('common_search')}
            autoCapitalize="none"
            autoCorrect={false}
            hideSeparator
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
            rightSlot={
              value ? (
                <View style={styles.clearSlot}>
                  <Pressable onPress={onClear} style={styles.clearButton} accessibilityRole="button">
                    <Feather name="x" size={clearIconSize} color={theme.colors.textSecondary} style={styles.clearIcon} />
                  </Pressable>
                </View>
              ) : null
            }
            {...searchProps}
          />
        </View>
        {onOpenSort ? (
          <Pressable
            onPress={onOpenSort}
            style={styles.filterButton}
            android_ripple={{ borderless: false, color: theme.colors.border }}
            accessibilityRole="button"
            accessibilityLabel={t('common_sort')}
          >
            <MaterialIcons name="swap-vert" size={sortIconSize + 2} color={theme.colors.text} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onOpenFilters}
          style={styles.filterButton}
          android_ripple={{ borderless: false, color: theme.colors.border }}
          accessibilityRole="button"
          accessibilityLabel={t('common_filter')}
        >
          <Feather name="sliders" size={18} color={theme.colors.text} />
        </Pressable>
      </View>

      {filterSummary ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>{filterSummary}</Text>
          {onResetFilters ? (
            <Pressable onPress={onResetFilters} accessibilityRole="button">
              <Text style={styles.resetText}>
                {summaryResetLabel || t('settings_sections_quiet_items_quiet_reset')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {metaText ? (
        <View style={styles.metaRow}>
          <Text style={[styles.metaText, metaTextStyle]}>{metaText}</Text>
        </View>
      ) : null}
    </View>
  );
}
