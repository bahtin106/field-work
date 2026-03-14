import React from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useTheme } from './ThemeProvider';
import { useCapsuleFeedback } from './useCapsuleFeedback';

export default function CapsulePressable({
  onPress,
  onLongPress,
  children,
  style,
  contentContainerStyle,
  disabled = false,
  accessibilityLabel,
  hitSlop,
}) {
  const { theme } = useTheme();
  const interactive = theme.components?.interactive || {};
  const resolvedHitSlop =
    hitSlop ?? interactive.hitSlop ?? { top: 8, bottom: 8, left: 8, right: 8 };
  const resolvedPressRetentionOffset =
    interactive.pressRetentionOffset ?? { top: 16, bottom: 16, left: 16, right: 16 };
  const { onPressIn, onPressOut, containerStyle, overlayStyle, contentStyle } =
    useCapsuleFeedback({ disabled });

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      hitSlop={resolvedHitSlop}
      pressRetentionOffset={resolvedPressRetentionOffset}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[containerStyle, style]}>
        <Animated.View pointerEvents="none" style={overlayStyle} />
        <View style={[contentStyle, contentContainerStyle]}>{children}</View>
      </Animated.View>
    </Pressable>
  );
}
