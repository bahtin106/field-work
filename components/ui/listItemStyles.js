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
      height: t.components?.listItem?.height ?? 48,
      paddingHorizontal: t.spacing.xs,
      paddingTop: t.spacing.xs,
      paddingBottom: t.spacing.xs,
    },

    label: {
      // Не даём метке сдвигаться/переноситься — фиксируем ширину
      flexShrink: 0,
      width: '36%',
      minWidth: 96,
      color: t.colors.textStrong ?? t.colors.text,
      fontSize: t.typography.sizes.sm,
      paddingRight: t.spacing.sm,
    },

    value: {
      // Значение располагается справа и может занимать оставшееся место.
      // По умолчанию даём возможность схлопываться и быть обрезанным.
      color: t.colors.text,
      fontWeight: t.typography.weight.medium,
      flex: 1,
      flexShrink: 1,
      textAlign: 'right',
    },

    // правая часть (и для шеврона, и для свитча)
    rightWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingRight: 0, // ← вровень с chevron (используем только padding строки)
      maxWidth: '62%',
      overflow: 'hidden',
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
