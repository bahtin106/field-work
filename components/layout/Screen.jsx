// components/layout/Screen.jsx
import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../theme";
import AppHeader from "../navigation/AppHeader";
import { useNavigation, usePathname } from "expo-router";
import { useRoute } from "@react-navigation/native";

export default function Screen({ children, style }) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const pathname = usePathname() || "";
  const showHeader = !pathname.startsWith("/(auth)");
  const title = route?.name ?? "";

  return (
    <SafeAreaView edges={['left','right']} style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        {showHeader && (
          <AppHeader options={{ title }} back={nav.canGoBack()} route={route} />
        )}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          {children}
        </KeyboardAvoidingView>
      </ScrollView>
    </SafeAreaView>
  );
}
