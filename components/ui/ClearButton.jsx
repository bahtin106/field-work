// components/ui/ClearButton.jsx
import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';
import { withAlpha } from '../../theme/colors';

/**
 * Универсальная destructive-кнопка очистки с иконкой корзины и анимацией нажатия.
 * @param {Object} props
 * @param {Function} props.onPress - Callback при нажатии
 * @param {string} props.accessibilityLabel - Метка для accessibility
 * @param {number} props.size - Размер кнопки (по умолчанию из темы)
 * @param {number} props.iconSize - Размер иконки (по умолчанию из темы)
 * @param {Object} props.style - Дополнительные стили
 */
export default function ClearButton({
  onPress,
  accessibilityLabel,
  size,
  iconSize,
  style,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  // Уменьшаем размер круга на 30% (85% * 85% ≈ 72%)
  const defaultButtonSize = (theme.components?.iconButton?.size ?? 32) * 0.72;
  const buttonSize = size ?? defaultButtonSize;
  // Корзина визуально чуть крупнее прежнего крестика при той же области нажатия.
  const iconSz = iconSize ?? Math.round((theme.icons?.sm ?? 18) * 0.75);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.85,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 8,
    }).start();
  };

  const styles = StyleSheet.create({
    button: {
      width: buttonSize,
      height: buttonSize,
      borderRadius: buttonSize / 2,
      backgroundColor: theme.colors.danger,
      borderWidth: 0,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
  });

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        android_ripple={{
          color: withAlpha(theme.colors.onPrimary, 0.3),
          borderless: false,
          radius: buttonSize / 2,
        }}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || t('common_clear')}
        accessibilityState={{ disabled: false }}
        hitSlop={{
          top: theme.spacing.sm,
          bottom: theme.spacing.sm,
          left: theme.spacing.sm,
          right: theme.spacing.sm,
        }}
      >
        <Feather name="trash-2" size={iconSz} color={theme.colors.onPrimary} strokeWidth={2.25} />
      </Pressable>
    </Animated.View>
  );
}
