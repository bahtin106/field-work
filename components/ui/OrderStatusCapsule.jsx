import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getOrderStatusPalette } from '../../src/features/orders/statusPresentation';
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

function OrderStatusCapsuleImpl({ status, style, textStyle, numberOfLines = 1 }) {
  const { theme } = useTheme();
  const palette = useMemo(() => getOrderStatusPalette(status, theme), [status, theme]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!status) return null;

  return (
    <View style={[styles.capsule, { backgroundColor: palette.bg }, style]}>
      <Text numberOfLines={numberOfLines} style={[styles.text, { color: palette.fg }, textStyle]}>
        {status}
      </Text>
    </View>
  );
}

const OrderStatusCapsule = memo(OrderStatusCapsuleImpl);

export default OrderStatusCapsule;
