import { StyleSheet } from 'react-native';

export const CHEVRON_GAP = 6;
export const VALUE_FONT_WEIGHT = '500';

const resolveSpacing = (theme, value, fallback) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return theme.spacing?.[value] ?? fallback;
  return fallback;
};

export const listItemStyles = (theme) => {
  const listItem = theme.components?.listItem || {};
  const sectionTitle = theme.components?.sectionTitle || {};
  const rowPaddingX = resolveSpacing(
    theme,
    listItem.padX,
    theme.spacing?.md ?? theme.spacing?.xs ?? 12,
  );
  const rowPaddingY = resolveSpacing(theme, listItem.padY, theme.spacing?.xs ?? 4);
  const sectionMarginLeft = resolveSpacing(
    theme,
    sectionTitle.ml,
    theme.spacing?.lg ?? rowPaddingX,
  );

  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: listItem.height ?? 48,
      paddingHorizontal: rowPaddingX,
      paddingTop: rowPaddingY,
      paddingBottom: rowPaddingY,
    },
    label: {
      color: theme.colors.textStrong ?? theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight?.regular || '400',
    },
    value: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
      textAlign: 'right',
    },
    rightWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexShrink: 1,
      minWidth: 0,
      paddingRight: rowPaddingY,
    },
    valueWrapper: {
      flexShrink: 1,
      maxWidth: '100%',
      minWidth: 0,
    },
    middleSpacer: {
      flex: 1,
      minWidth: listItem.labelValueGap ?? theme.spacing?.lg ?? 16,
    },
    switchWrap: {
      marginLeft: listItem.chevronGap ?? CHEVRON_GAP,
      paddingRight: 0,
    },
    sep: {
      height: listItem.dividerWidth ?? 1,
      backgroundColor: theme.colors.border,
      marginLeft: rowPaddingX,
      marginRight: rowPaddingX,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight?.bold || '700',
      marginLeft: sectionMarginLeft,
      marginTop: 0,
      marginBottom: 0,
    },
  });
};
