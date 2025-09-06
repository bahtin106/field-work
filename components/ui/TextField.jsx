// components/ui/TextField.jsx
import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { useTheme } from "../../theme";

export default function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  error,
  rightSlot,
  leftSlot,
  multiline,
  numberOfLines,
  style,
  maxLength,
})
 {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const s = styles(theme, !!error, focused);

  return (
    <View style={style}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={s.wrap}>
        {leftSlot ? <View style={s.slot}>{leftSlot}</View> : null}
        <TextInput
  value={value}
  onChangeText={onChangeText}
  placeholder={placeholder}
  placeholderTextColor={theme.colors.inputPlaceholder}
  keyboardType={keyboardType}
  secureTextEntry={secureTextEntry}
  multiline={multiline}
  numberOfLines={numberOfLines}
  onFocus={() => setFocused(true)}
  onBlur={() => setFocused(false)}
  maxLength={maxLength}
  style={s.input}
/>
        {rightSlot ? <View style={s.slot}>{rightSlot}</View> : null}
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

const styles = (t, isError, focused) =>
  StyleSheet.create({
    label: { color: t.colors.textSecondary, fontSize: t.typography.sizes.sm, marginBottom: 6 },
    wrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: t.colors.inputBg,
      borderColor: isError ? t.colors.danger : focused ? t.colors.primary : t.colors.inputBorder,
      borderWidth: 1,
      borderRadius: t.radii.md,
      paddingHorizontal: 12,
      height: 48,
    },
    input: { flex: 1, color: t.colors.text, fontSize: t.typography.sizes.md, paddingVertical: 10 },
    slot: { marginHorizontal: 4 },
    error: { color: t.colors.danger, fontSize: t.typography.sizes.sm, marginTop: 6 },
  });
