// theme/CapsulePressable.jsx
import React from 'react';
import { Animated, Pressable } from 'react-native';
import { useTheme, useCapsuleFeedback } from './ThemeProvider';

export default function CapsulePressable({
  onPress,
  onLongPress,
  children,
  style,
  contentContainerStyle,
  disabled = false,
  accessibilityLabel,
  hitSlop = { top: 8, bottom: 8, left: 8, right: 8 },
}) {
  const { theme } = useTheme();
