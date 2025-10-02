// components/ui/Card.jsx
import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useTheme } from "../../theme";

export default function Card({ children, style, padded = true }) {
  const { theme } = useTheme();
  const s = styles(theme);
  return <View style={[s.card, padded && s.padded, style]}>{children}</View>;
}

const styles = (t) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.xl,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...(Platform.OS === "ios" ? t.shadows.card.ios : t.shadows.card.android),
    },
    padded: {
  paddingHorizontal: t.spacing[t.components.card.padX],
  paddingVertical: t.spacing[t.components.card.padY],
},
  });
