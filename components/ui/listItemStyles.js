// components/ui/listItemStyles.js
import { StyleSheet } from 'react-native';
export const CHEVRON_GAP = 6;
export const VALUE_FONT_WEIGHT = '500';

export const listItemStyles = (t) => StyleSheet.create({
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
    flex: 1,
    color: t.colors.textStrong ?? t.colors.text,
    fontSize: t.typography.sizes.sm,
    paddingRight: t.spacing.sm,
  },

  value: {
    color: t.colors.text,
    fontWeight: t.typography.weight.medium,
  },

  // правая часть (и для шеврона, и для свитча)
  rightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 0, // ← вровень с chevron (используем только padding строки)
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
    marginLeft: t.spacing.lg, // выравниваем с контентом
    marginTop: t.spacing.md,
    marginBottom: t.spacing.xs,
  },
});
