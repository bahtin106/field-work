// components/layout/Screen.jsx
import React from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../theme";

export default function Screen({ children, style }) {
  const { theme } = useTheme();
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
