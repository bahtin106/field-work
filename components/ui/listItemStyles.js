// components/ui/listItemStyles.js
import { StyleSheet } from 'react-native';
export const CHEVRON_GAP = 6;
export const VALUE_FONT_WEIGHT = '500';

export const listItemStyles = (t) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: t.components?.listItem?.height ?? 48,
      paddingHorizontal: t.spacing.xs,
      paddingTop: t.spacing.xs,
      paddingBottom: t.spacing.xs,
    },

    label: {
      // Labels MUST always be fully visible - never truncate.
      // They align left with standard left padding.
      color: t.colors.textStrong ?? t.colors.text,
      fontSize: t.typography.sizes.sm,
      fontWeight: t.typography.weight?.regular || '400',
    },

    value: {
      // Value text: right-aligned, can wrap to multiple lines if needed.
      // The parent container controls max width (maxWidth set on valueWrapper).
      color: t.colors.text,
      fontSize: t.typography.sizes.sm,
      fontWeight: t.typography.weight.medium,
      textAlign: 'right',
    },

    // Right side container: holds value + optional actions (copy buttons)
    // flexShrink allows it to compress when label is long
    rightWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexShrink: 1,
      minWidth: 0,
      paddingRight: t.spacing.xs,
    },

    // Wrapper for value text/component
    // Limits max width so long values wrap instead of pushing label off-screen
    valueWrapper: {
      flexShrink: 1,
      maxWidth: '100%',
      minWidth: 0,
    },

    // контейнер Switch — микро-зазор слева от текста/значения
    switchWrap: {
      marginLeft: CHEVRON_GAP,
      paddingRight: 0,
    },

    sep: {
      height: t.components.listItem.dividerWidth,
      backgroundColor: t.colors.border,
      marginLeft: t.spacing.xs,
      marginRight: t.spacing.xs,
    },

    // заголовки секций («Внешний вид», «Уведомления»)
    sectionTitle: {
      color: t.colors.text,
      fontSize: t.typography.sizes.sm,
      fontWeight: t.typography.weight?.bold || '700',
      marginLeft: t.spacing?.[t.components?.sectionTitle?.ml] ?? t.spacing.lg,
      marginTop: 0,
      marginBottom: 0,
    },
  });
