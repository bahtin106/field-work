import Feather from '@expo/vector-icons/Feather';
import { Pressable } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

export default function InfoHintButton({
  onPress,
  accessibilityLabel,
  accessibilityHint,
  size = 28,
  style,
}) {
  const { theme } = useTheme();
  const iconSize = Math.max(14, Math.round(size * 0.55));

  return (
    <Pressable
      onPress={(event) => {
        event?.stopPropagation?.();
        onPress?.();
      }}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: theme.colors.primary,
          backgroundColor: theme.colors.primarySoft ?? theme.colors.surface,
        },
        pressed ? { opacity: theme.components?.interactive?.pressedOpacity ?? 0.7 } : null,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <Feather name="info" size={iconSize} color={theme.colors.primary} />
    </Pressable>
  );
}
