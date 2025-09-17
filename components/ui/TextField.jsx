// components/ui/TextField.jsx
import React, { useState, forwardRef } from "react";
import { View, Text, TextInput, StyleSheet, Platform } from "react-native";
import { useTheme } from "../../theme";

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
  const maskRef = React.useRef(null);
  const inputRef = React.useRef(null);
  // bridge external ref
  React.useImperativeHandle(ref, () => inputRef.current);
  const handleChangeText = React.useCallback((t) => {
    if (Platform.OS === "android" && secureTextEntry && maskRef.current) {
      try { maskRef.current.setNativeProps({ text: "\u2022".repeat(String(t || "").length) }); } catch {}
    }
    onChangeText?.(t);
  }, [onChangeText, secureTextEntry]);


  return (
    <View style={style}>
      <View style={s.wrap}>
        {label ? (
          <Text style={s.floatingLabel}>{label}</Text>
        ) : null}
        {leftSlot ? <View style={s.slot}>{leftSlot}</View> : null}
        <View style={s.inputBox} onStartShouldSetResponder={() => true} onResponderGrant={() => inputRef.current?.focus?.() }>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={handleChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.inputPlaceholder}
            keyboardType={keyboardType || "default"}
            secureTextEntry={secureTextEntry}
            textContentType={secureTextEntry ? "password" : "none"}
            autoComplete={secureTextEntry ? "password" : "off"}
            importantForAutofill={secureTextEntry ? "no" : "auto"}
            autoCorrect={false}
            multiline={multiline}
            numberOfLines={numberOfLines}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setTouched(true); }}
            maxLength={maxLength}
            autoCapitalize={autoCapitalize}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            style={[s.input, (secureTextEntry && Platform.OS === "android") ? { color: "transparent" } : null]}
            includeFontPadding={false}
            textAlignVertical="center"
          />
          {(secureTextEntry && Platform.OS === "android") ? (
            <TextInput
              ref={maskRef}
              pointerEvents="none"
              editable={false}
              value={"\u2022".repeat(String(value || "").length)}
              style={[s.input, s.passwordMask, { color: theme.colors.text }]}
              underlineColorAndroid="transparent"
            />
          ) : null}
        </View>
{rightSlot ? <View style={s.slot}>{rightSlot}</View> : null}
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
});

export default TextField;

const styles = (t, isError, focused) =>
  StyleSheet.create({
    label: { color: t.colors.textSecondary, fontSize: t.typography.sizes.sm, marginBottom: 6 },
    wrap: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.inputBg,
      borderColor: isError ? t.colors.danger : focused ? t.colors.primary : t.colors.inputBorder,
      borderWidth: 1,
      borderRadius: t.radii.md,
      paddingHorizontal: 12,
      paddingTop: 16,
      height: 64,
      ...(Platform.OS === 'ios' ? t.shadows.card.ios : t.shadows.card.android),
    },
    floatingLabel: {
      position: 'absolute',
      left: 12,
      top: 6,
      color: t.colors.textSecondary,
      fontSize: t.typography.sizes.sm,
    },
    input: { flex: 1, color: t.colors.text, fontSize: t.typography.sizes.md, paddingVertical: 8 },
    slot: { marginHorizontal: 4 },
    inputBox: { flex: 1, justifyContent: 'center', position: 'relative' },
    passwordMask: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, textAlign: 'left' },
    error: { color: t.colors.danger, fontSize: t.typography.sizes.sm, marginTop: 4, paddingLeft: 12 },
  });