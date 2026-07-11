import { useMemo, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import FilterBarButton from './FilterBarButton';
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
  const infoInsetLeft = Number(sz.sm ?? 0);
  const resetTapWidth = Math.max(
    controlH,
    Math.round((ty.sizes.sm ?? 14) * 6.5) + Number((sz.sm ?? 8) * 2),
  );

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
    summaryRow: {
      position: 'relative',
      minHeight: controlH,
      paddingRight: resetTapWidth,
    },
    summaryText: {
      color: c.textSecondary,
      fontSize: ty.sizes.sm,
      minHeight: controlH,
      paddingLeft: infoInsetLeft,
      paddingTop: sz.xs,
    },
    resetText: {
      color: c.primary,
      fontSize: ty.sizes.sm,
      fontWeight: ty.weight.semibold,
      textAlign: 'right',
    },
    metaRow: {
      paddingLeft: infoInsetLeft,
    },
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
    resetWrap: {
      position: 'absolute',
      right: 0,
      top: 0,
      width: resetTapWidth,
      minHeight: controlH,
      alignItems: 'flex-end',
      justifyContent: 'flex-start',
      paddingTop: sz.xs,
    },
    hiddenMeasure: {
      position: 'absolute',
      opacity: 0,
      left: 0,
      top: 0,
      right: resetTapWidth,
      fontSize: ty.sizes.sm,
      paddingLeft: infoInsetLeft,
      lineHeight: Math.round((ty.sizes.sm || 14) * 1.25),
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
  filterSummaryCompact,
  filterSummaryMaxLines,
  filtersActive,
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
  const isFiltersActive = filtersActive ?? Boolean(filterSummary);
  const summaryLines = Math.max(
    1,
    Number(filterSummaryMaxLines ?? theme?.components?.searchFiltersBar?.summaryLines ?? 2),
  );
  const [fullSummaryFits, setFullSummaryFits] = useState(true);
  const summaryToDisplay =
    fullSummaryFits || !filterSummaryCompact ? filterSummary : filterSummaryCompact;

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
          <FilterBarButton
            type="sort"
            onPress={onOpenSort}
            accessibilityLabel={t('common_sort')}
          />
        ) : null}
        {onOpenFilters ? (
          <FilterBarButton
            type="filter"
            active={isFiltersActive}
            onPress={onOpenFilters}
            accessibilityLabel={t('common_filter')}
          />
        ) : null}
      </View>

      {filterSummary ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText} numberOfLines={summaryLines} ellipsizeMode="tail">
            {summaryToDisplay}
          </Text>
          <Text
            style={styles.hiddenMeasure}
            onTextLayout={(e) => {
              const lines = Array.isArray(e?.nativeEvent?.lines) ? e.nativeEvent.lines.length : 0;
              const fits = lines <= summaryLines;
              if (fits !== fullSummaryFits) setFullSummaryFits(fits);
            }}
          >
            {filterSummary}
          </Text>
          {onResetFilters && onOpenFilters ? (
            <Pressable onPress={onResetFilters} accessibilityRole="button" style={styles.resetWrap}>
              <Text style={styles.resetText} numberOfLines={1} ellipsizeMode="clip">
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
