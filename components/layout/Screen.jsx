// components/layout/Screen.jsx
import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../theme";
import AppHeader from "../navigation/AppHeader";
import { useNavigation, usePathname } from "expo-router";
import { useRoute } from "@react-navigation/native";

export default function Screen({ children, style, scroll = true }) {
  const { theme } = useTheme();
  const nav = useNavigation();
  const route = useRoute();
  const pathname = usePathname() || "";
  const isAuthScreen = (pathname.startsWith("/(auth)")) || route?.name === "login";
  const showHeader = !isAuthScreen;
  const useScroll = (scroll !== false) && !isAuthScreen;
  const title = route?.name ?? "";
  const edges = isAuthScreen ? ['top','left','right','bottom'] : ['left','right'];

  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}>
      {useScroll ? (
  <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
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
) : (
  <>
    {showHeader && (
      <AppHeader options={{ title }} back={nav.canGoBack()} route={route} />
    )}
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      {children}
    </KeyboardAvoidingView>
  </>
)}
    </SafeAreaView>
  );
}
