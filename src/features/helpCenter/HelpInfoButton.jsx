import Feather from '@expo/vector-icons/Feather';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../i18n/useTranslation';
import { useTheme } from '../../../theme';
import { withAlpha } from '../../../theme/colors';
import { useHelpCenter } from './HelpCenterProvider';

export default function HelpInfoButton({ topicId, size = 28, style }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { ready, preferences, openTopic } = useHelpCenter();
  const s = useMemo(() => styles(theme, size), [theme, size]);

  if (!ready || preferences.contextualHelpEnabled === false) return null;

  return (
    <Pressable
      onPress={(event) => {
        event?.stopPropagation?.();
        openTopic(topicId);
      }}
      hitSlop={10}
      style={({ pressed }) => [s.touch, pressed && s.pressed, style]}
      accessibilityRole="button"
      accessibilityLabel={t('help_info_accessibility')}
      accessibilityHint={t('help_info_accessibility_hint')}
    >
      <View style={s.circle}>
        <Feather name="info" size={Math.round(size * 0.57)} color={theme.colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = (theme, size) =>
  StyleSheet.create({
    touch: {
      width: size + 8,
      height: size + 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: (size + 8) / 2,
    },
    pressed: { opacity: theme.components?.interactive?.pressedOpacity ?? 0.7 },
    circle: {
      width: size,
      height: size,
      borderRadius: size / 2,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.primary, 0.42),
      backgroundColor: withAlpha(theme.colors.primary, 0.1),
    },
  });
