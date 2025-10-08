// components/ui/TextField.jsx
import React, { useState, forwardRef } from "react";
import { View, Text, TextInput, StyleSheet, Platform, Pressable, Switch } from "react-native";
import FeatherIcon from "@expo/vector-icons/Feather";
import { useTheme } from "../../theme";
import { t as T } from "../../src/i18n";
import { listItemStyles, CHEVRON_GAP } from "./listItemStyles";

const TextField = forwardRef(function TextField(
  {
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
    autoCapitalize,
    returnKeyType,
    onSubmitEditing,
  },
  ref
) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);

  const isRequired = /\*/.test(String(label || ''));
  const requiredEmpty = isRequired && touched && !String(value || '').trim();
  const isErr = !!error || requiredEmpty;
  const s = styles(theme, isErr, focused);
  const inputRef = React.useRef(null);
  React.useImperativeHandle(ref, () => inputRef.current);
  const handleChangeText = React.useCallback((t) => {
    onChangeText?.(t);
  }, [onChangeText]);

  return (
    <View style={style}>
      {label ? (
        <Text style={s.topLabel}>{label}</Text>
      ) : null}
      <View style={s.wrap}>
        {leftSlot ? <View style={s.slot}>{leftSlot}</View> : null}
        <View style={s.inputBox}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={handleChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.inputPlaceholder}
            keyboardType={keyboardType || "default"}
            secureTextEntry={secureTextEntry}
            autoCorrect={false}
            multiline={multiline}
            numberOfLines={numberOfLines}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setTouched(true); }}
            maxLength={maxLength}
            autoCapitalize={autoCapitalize}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            style={[s.input, (secureTextEntry && Platform.OS === "android") ? { color: theme.colors.transparent } : null]}
            includeFontPadding={false}
            textAlignVertical="center"
          />
        </View>
        {rightSlot ? <View style={s.slot}>{rightSlot}</View> : null}
      </View>
    </View>
  );
});

export default TextField;

const styles = (t, isError, focused) =>
  StyleSheet.create({
    wrap: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isError ? t.colors.danger : (focused ? t.colors.primary : (t.colors.inputBorder || '#e0e0e0')),
      paddingHorizontal: 12,
      height: 52,
    },
    topLabel: {
      fontWeight: '500',
      marginBottom: 4,
      marginTop: 12,
      color: t.colors.textSecondary,
      fontSize: t.typography.sizes.sm,
    },
    input: {
      flex: 1,
      color: t.colors.text,
      fontSize: t.typography.sizes.md,
      paddingVertical: 10,
      paddingLeft: 0,
    },
    slot: { marginHorizontal: 4 },
    inputBox: { flex: 1, justifyContent: 'center', position: 'relative' },
  });


// Unified Settings-like select row, styled to match AppSettings.jsx rows.
// Usage:
//   <SelectField label="Роль" value="Администратор" onPress={...} />
//   <SelectField label="Звук" onPress={...} showValue={false} />
export function SelectField({
  label,
  value,
  onPress,
  right,            // optional custom right ReactNode
  showValue = true, // when false -> only chevron shown
  disabled = false,
  style,
}) {
  const { theme } = useTheme();
  const base = listItemStyles(theme);
  const s = selectStyles(theme);
  return (
    <Pressable onPress={onPress} disabled={disabled} android_ripple={disabled ? undefined : { color: theme.colors.ripple, borderless: false }}>
      <View style={[base.row, disabled && s.disabled, style]}>
        <Text style={[base.label, s.label]} numberOfLines={1}>{label}</Text>
        <View style={s.rightWrap}>
          {right ? right : (showValue ? (<Text style={[base.value, s.value]} numberOfLines={1}>{value ?? ''}</Text>) : null)}
          <FeatherIcon name="chevron-right" size={theme.components.listItem.chevronSize} color={theme.colors.textSecondary} style={s.chevron} />
        </View>
      </View>
    </Pressable>
  );
}


// Unified Settings-like switch row.
// Usage:
//   <SwitchField label="Уведомления" value={true} onValueChange={...} />
export function SwitchField({ label, value, onValueChange, disabled = false, style }) {
  const { theme } = useTheme();
  const base = listItemStyles(theme);
  return (
    <View style={[base.row, disabled && { opacity: theme.components.listItem.disabledOpacity }, style]}>
      <Text style={base.label}>{label}</Text>
      <View style={base.rightWrap}>
        <View style={base.switchWrap}>
          <Switch
            value={!!value}
            onValueChange={onValueChange}
            disabled={!!disabled}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>
      </View>
    </View>
  );
}

const selectStyles = (t) => StyleSheet.create({
  disabled: { opacity: t.components.listItem.disabledOpacity || 0.5 },
  label: { flexShrink: 1, paddingRight: 8 },
  value: { maxWidth: 220 },
  rightWrap: { flexDirection: 'row', alignItems: 'center' },
  chevron: { marginLeft: CHEVRON_GAP },
});


const pad2 = (n) => String(n).padStart(2, "0");

export function serializeDobForSupabase(v) {
  if (!v) return { dob: null, dob_md: null };
  const md = `${pad2(v.month)}-${pad2(v.day)}`;
  const dob = v.year ? `${v.year}-${md}` : null;
  return { dob, dob_md: md };
}

// --- CLEANED DateOfBirthField ---
// Removed all built-in modals, wheels, pickers, animations.
// Now it only renders a read-only settings-like row with the current value.
// External screens/components can control the value via props.
export const DateOfBirthField = ({
  label = T('fields.dob'),
  value,
  onChange, // kept for API compatibility (not used internally)
  style,
}) => {
  const { theme } = useTheme();
  const isErr = false;
  const s = styles(theme, isErr, false);

  const display = () => {
    if (!value?.day || !value?.month) return "";
    const base = `${pad2(value.day)} ${months[value.month - 1]}`;
    return value.year ? `${base}, ${value.year}` : base;
    };

  return (
    <View style={style}>
      <View style={s.wrap}>
        <Text style={s.topLabel}>{label}</Text>
        <View style={s.inputBox}>
          <Text style={[s.input, { paddingVertical: 10 }]}>{display()}</Text>
        </View>
      </View>
    </View>
  );
};

// Helpers kept for formatting only
const months = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleString(undefined, { month: 'short' }).replace('.', '')
);
