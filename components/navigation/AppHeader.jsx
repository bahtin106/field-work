// components/navigation/AppHeader.jsx
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";

export default function AppHeader({ options, back }) {
  const { theme } = useTheme();
  const nav = useNavigation();

  return (
    <View style={[s.container, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
      <View style={s.left}>
        {back ? (
          <Pressable hitSlop={12} style={s.back} onPress={() => nav.goBack()}>
            <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={s.center}>
        <Text numberOfLines={1} style={[s.title, { color: theme.colors.text }]}>{options?.title ?? ""}</Text>
      </View>
      <View style={s.right}>{options?.headerRight ? options.headerRight() : null}</View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { height: 56, flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  left: { width: 64, alignItems: "flex-start", paddingLeft: 8 },
  right: { width: 64, alignItems: "flex-end", paddingRight: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600" },
  back: { padding: 6, borderRadius: 12 },
});
