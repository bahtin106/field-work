import Feather from '@expo/vector-icons/Feather';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMemo } from 'react';
import { Keyboard, Pressable, StyleSheet } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { withAlpha } from '../../theme/colors';

export default function FilterBarButton({
  type = 'filter',
  active = false,
  onPress,
  accessibilityLabel,
  size,
  iconSize: iconSizeProp,
  style,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const iconSize = iconSizeProp ?? theme?.components?.icon?.sizeSm ?? theme.icons.sm;
  const iconColor = active ? theme.colors.primary : theme.colors.text;

  return (
    <Pressable
      onPress={() => {
        Keyboard.dismiss();
        onPress?.();
      }}
      hitSlop={theme.components?.interactive?.hitSlop ?? 8}
      pressRetentionOffset={theme.components?.interactive?.pressRetentionOffset ?? 16}
      android_ripple={{ borderless: false, color: theme.colors.ripple ?? theme.colors.border }}
      style={({ pressed }) => [
        styles.button,
        size ? { width: size, height: size, borderRadius: size / 2 } : null,
        active ? styles.active : null,
        pressed ? styles.pressed : null,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
    >
      {type === 'sort' ? (
        <MaterialIcons name="swap-vert" size={iconSize + 2} color={iconColor} />
      ) : (
        <Feather name="sliders" size={iconSize} color={iconColor} />
      )}
    </Pressable>
  );
}

function createStyles(theme) {
  const size = theme.components?.input?.height ?? 48;
  return StyleSheet.create({
    button: {
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: theme.components?.button?.borderWidth ?? 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    active: {
      borderColor: theme.colors.primary,
      backgroundColor: withAlpha(theme.colors.primary, 0.12),
    },
    pressed: {
      opacity: theme.components?.button?.pressedOpacity ?? 0.9,
      transform: [{ scale: theme.components?.interactive?.pressedScale ?? 0.98 }],
    },
  });
}
