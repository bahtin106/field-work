import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getOrderStatusPalette } from '../../src/features/orders/statusPresentation';
import { getOrderStatusColor, getOrderStatusLabel, useCompanyOrderStatuses } from '../../lib/orderStatuses';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

function createStyles(theme) {
  const capsule = theme.components?.orderStatusCapsule || {};
  const radii = theme.radii || {};
  const typography = theme.typography || {};

  return StyleSheet.create({
    capsule: {
      paddingHorizontal: capsule.padX ?? 10,
      paddingVertical: capsule.padY ?? 6,
      borderRadius: capsule.radius ?? radii.pill ?? 999,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: capsule.minHeight ?? 28,
    },
    text: {
      fontSize: capsule.fontSize ?? typography.sizes?.xs ?? 12,
      fontWeight: capsule.fontWeight ?? typography.weight?.bold ?? '700',
      letterSpacing: capsule.letterSpacing ?? 0.3,
    },
  });
}

function OrderStatusCapsuleImpl({ status, companyId = null, style, textStyle, numberOfLines = 1 }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { isEnabled, statuses } = useCompanyOrderStatuses(companyId);
  const color = useMemo(() => getOrderStatusColor(status, statuses), [status, statuses]);
  const palette = useMemo(() => getOrderStatusPalette(status, theme, color), [color, status, theme]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const label = useMemo(() => getOrderStatusLabel(status, statuses, t), [status, statuses, t]);

  if (!isEnabled || !status || !label) return null;

  return (
    <View style={[styles.capsule, { backgroundColor: palette.bg }, style]}>
      <Text numberOfLines={numberOfLines} style={[styles.text, { color: palette.fg }, textStyle]}>
        {label}
      </Text>
    </View>
  );
}

const OrderStatusCapsule = memo(OrderStatusCapsuleImpl);

export default OrderStatusCapsule;
