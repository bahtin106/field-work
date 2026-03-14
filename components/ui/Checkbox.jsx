import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';

const styles = (theme) => {
  const checkbox = theme.components?.checkbox || {};
  const size = checkbox.size ?? 22;
  const radius = checkbox.radius ?? theme.radii?.xs ?? 4;
  const borderWidth = checkbox.borderWidth ?? 2;
  const indicatorSize = checkbox.indicatorSize ?? 12;

  return StyleSheet.create({
    box: {
      width: size,
      height: size,
      borderWidth,
      borderColor: theme.colors.primary,
      borderRadius: radius,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    boxChecked: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.chipBg ?? theme.colors.surface,
    },
    inner: {
      width: indicatorSize,
      height: indicatorSize,
      backgroundColor: theme.colors.primary,
      borderRadius: checkbox.indicatorRadius ?? Math.min(radius, 2),
    },
  });
};

export default function Checkbox({ value, onValueChange }) {
  const { theme } = useTheme();
  const s = styles(theme);

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      style={[s.box, value && s.boxChecked]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
    >
      {value ? <View style={s.inner} /> : null}
    </Pressable>
  );
}
