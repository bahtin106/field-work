// components/ui/TextField.jsx
import FeatherIcon from '@expo/vector-icons/Feather';
import React, { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { t as T } from '../../src/i18n';
import { useTheme } from '../../theme';
import { withAlpha } from '../../theme/colors';
import { CHEVRON_GAP, listItemStyles } from './listItemStyles';

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
    onFocus,
    onBlur,
    pressable = false,
    onPress,
    forceValidation = false,
    hideSeparator = false,
    filterInput, // Функция для фильтрации ввода (например, для паролей)
    onInvalidInput, // Callback когда пользователь вводит недопустимый символ
    autoGrow,
    minLines,
  },
  ref,
) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  // Для управления видимостью пароля через toggle кнопку
  const [showPassword, setShowPassword] = useState(false);
  const baseInputHeight =
    theme.components?.input?.height ?? theme.components?.listItem?.height ?? 48;
  const sepConfig = theme.components?.input?.separator || {};
  const sepHeight = sepConfig.height ?? theme.components?.listItem?.dividerWidth ?? 1;
  const sepEnabled = sepConfig.enabled ?? sepHeight > 0;

  // Автогроу включен по умолчанию, если явно не отключен в теме
  const autoGrowEnabled = autoGrow ?? theme.components?.input?.autoGrow !== false;

  // Используем multiline для ВСЕх полей кроме паролей (можем переопределить через пропсы)
  const effectiveMultiline = multiline ?? !secureTextEntry;

  const maxRows = theme.components?.input?.autoGrowMaxRows ?? 5;
  const fontSize = theme.typography?.sizes?.md ?? 15;
  const lineHeightRatio = theme.typography?.lineHeights?.normal ?? 1.35;
  const lineHeightValue = Math.round(fontSize * lineHeightRatio);
  const minLinesValue =
    Number.isFinite(minLines) && minLines >= 1 ? Math.max(1, Math.floor(minLines)) : 1;
  const minContentHeight = Math.max(baseInputHeight, lineHeightValue * minLinesValue);
  const maxContentHeight = Math.max(minContentHeight, lineHeightValue * maxRows);

  const isRequired = /\*/.test(String(label || ''));
  const requiredEmpty = isRequired && (touched || forceValidation) && !String(value || '').trim();
  const isErr = (touched || forceValidation) && (!!error || requiredEmpty);
  const s = styles(theme, isErr, focused, autoGrowEnabled, minContentHeight, effectiveMultiline);
  const inputRef = React.useRef(null);

  React.useImperativeHandle(ref, () => ({
    ...inputRef.current,
    togglePasswordVisibility: () => setShowPassword((prev) => !prev),
    showPassword: () => setShowPassword(true),
    hidePassword: () => setShowPassword(false),
  }));

  const handleChangeText = React.useCallback(
    (text) => {
      let processedText = text;

      // Если указана функция фильтрации (например, для паролей)
      if (filterInput) {
        const filtered = filterInput(text);

        // Если текст изменился после фильтрации - были недопустимые символы
        if (filtered !== text && onInvalidInput) {
          onInvalidInput(text, filtered);
        }

        processedText = filtered;
      }

      onChangeText?.(processedText);
    },
    [onChangeText, filterInput, onInvalidInput],
  );

  // Правильное вычисление secureTextEntry: скрываем пароль ТОЛЬКО если это поле пароля И showPassword=false
  const effectiveSecureTextEntry = secureTextEntry ? !showPassword : false;

  return (
    <View style={style}>
      {label && <Text style={s.topLabel}>{String(label)}</Text>}
      <View style={s.wrap}>
        {leftSlot && <View style={s.slot}>{leftSlot}</View>}
        <View style={s.inputBox}>
          <TextInput
            ref={inputRef}
            value={value != null ? String(value) : ''}
            onChangeText={handleChangeText}
            placeholder={placeholder ? String(placeholder) : undefined}
            placeholderTextColor={theme.colors.inputPlaceholder}
            keyboardType={keyboardType || 'default'}
            secureTextEntry={effectiveSecureTextEntry}
            autoCorrect={false}
            autoComplete={secureTextEntry ? 'password' : undefined}
            textContentType={secureTextEntry ? 'password' : undefined}
            importantForAutofill={secureTextEntry ? 'yes' : 'auto'}
            multiline={effectiveMultiline}
            numberOfLines={numberOfLines}
            underlineColorAndroid="transparent"
            scrollEnabled={effectiveMultiline}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              setTouched(true);
              onBlur?.(e);
            }}
            maxLength={maxLength}
            autoCapitalize={autoCapitalize}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            style={[
              s.input,
              effectiveMultiline && {
                maxHeight: autoGrowEnabled ? maxContentHeight : undefined,
              },
            ]}
            includeFontPadding={false}
            textAlignVertical={effectiveMultiline ? 'top' : 'center'}
          />
          {pressable ? (
            <Pressable
              onPress={onPress}
              style={StyleSheet.absoluteFill}
              android_ripple={{ color: theme.colors.ripple, borderless: false }}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button"
              accessibilityLabel={String(label || placeholder || value || '')}
            />
          ) : null}
        </View>
        {rightSlot && <View style={s.slot}>{rightSlot}</View>}
      </View>
      {!hideSeparator && sepEnabled ? <View style={s.separator} /> : null}
    </View>
  );
});

export default TextField;

const styles = (t, isError, focused, autoGrow = false, baseHeightOverride, isMultiline = false) => {
  const sep = t.components?.input?.separator || {};
  const insetKey = sep.insetX || 'lg';
  const sepHeight = sep.height ?? t.components?.listItem?.dividerWidth ?? 1;
  const alpha = isError ? (sep.errorAlpha ?? 0.28) : (sep.alpha ?? 0.18);
  const sepColor = withAlpha(isError ? t.colors.danger : t.colors.primary, alpha);
  const ml = Number(t.spacing?.[insetKey] ?? 0) || 0;
  const mr = Number(t.spacing?.[insetKey] ?? 0) || 0;

  const baseHeight =
    baseHeightOverride ?? t.components?.input?.height ?? t.components?.listItem?.height ?? 48;

  // Используем labelSpacing из токенов или fallback
  const labelSpacing = t.components?.input?.labelSpacing ?? t.spacing?.xs ?? 4;

  return StyleSheet.create({
    wrap: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: isMultiline ? 'flex-start' : 'center',
      backgroundColor: 'transparent',
      borderBottomWidth: 0,
      borderBottomColor: 'transparent',
      paddingHorizontal: ml,
      height: autoGrow && isMultiline ? undefined : baseHeight,
      minHeight: baseHeight,
    },
    topLabel: {
      fontWeight: '500',
      marginBottom: labelSpacing,
      marginTop: 0,
      color: isError ? t.colors.danger : t.colors.textSecondary,
      fontSize: t.typography.sizes.sm,
      marginLeft: ml,
      marginRight: mr,
    },
    input: {
      flex: 1,
      color: t.colors.text,
      fontSize: t.typography.sizes.md,
      minHeight: baseHeight,
      paddingVertical: Math.max(4, Math.round(baseHeight * 0.25)),
      paddingLeft: 0,
    },
    slot: { marginHorizontal: 4 },
    inputBox: {
      flex: 1,
      justifyContent: isMultiline ? 'flex-start' : 'center',
      position: 'relative',
    },
    separator: {
      height: sepHeight,
      backgroundColor: sepColor,
      marginLeft: ml,
      marginRight: mr,
    },
  });
};

// Unified Settings-like select row, styled to match AppSettings.jsx rows.
// Usage:
//   <SelectField label="Роль" value="Администратор" onPress={...} />
//   <SelectField label="Звук" onPress={...} showValue={false} />
export function SelectField({
  label,
  value,
  onPress,
  right, // optional custom right ReactNode
  showValue = true, // when false -> only chevron shown
  disabled = false,
  style,
  dense = false, // NEW: compact row height
  alignValueLeft = false, // NEW: value aligned left
}) {
  const { theme } = useTheme();
  const base = listItemStyles(theme);
  const s = selectStyles(theme);
  const sepConfig = theme.components?.input?.separator || {};
  const sepHeight = sepConfig.height ?? theme.components?.listItem?.dividerWidth ?? 1;
  const sepEnabled = sepConfig.enabled ?? sepHeight > 0;
  const [rowWidth, setRowWidth] = React.useState(null);
  const chevronSize = theme.components.listItem.chevronSize || 20;
  const computedValueMaxWidth = React.useMemo(() => {
    if (!rowWidth) return undefined;
    // Reserve space for chevron + paddings; use ~45% for value max width as adaptive fallback
    const reserve = chevronSize + 24; // chevron + margins
    const avail = Math.max(0, rowWidth - reserve);
    return Math.max(80, Math.floor(avail * 0.45));
  }, [rowWidth, chevronSize]);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={disabled ? undefined : { color: theme.colors.ripple, borderless: false }}
      accessibilityRole="button"
      accessibilityLabel={String((label || '') + ' — ' + (value || ''))}
    >
      <View
        onLayout={(e) => {
          try {
            const w = e?.nativeEvent?.layout?.width;
            if (w && w !== rowWidth) setRowWidth(w);
          } catch (_) {}
        }}
        style={[
          base.row,
          disabled && s.disabled,
          dense && { height: Math.max(36, theme.components?.input?.height ?? 36) },
          style,
        ]}
      >
        {alignValueLeft ? (
          <>
            <View style={{ flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
              {label ? (
                <Text
                  style={[base.label, s.label, { paddingRight: 0 }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  allowFontScaling
                >
                  {label}
                </Text>
              ) : null}
              {showValue ? (
                <Text
                  style={[
                    base.value,
                    s.value,
                    { textAlign: 'left', marginTop: 2, marginRight: 8 },
                    computedValueMaxWidth ? { maxWidth: computedValueMaxWidth } : null,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  allowFontScaling
                >
                  {value ?? ''}
                </Text>
              ) : null}
            </View>
            <FeatherIcon
              name="chevron-right"
              size={theme.components.listItem.chevronSize}
              color={theme.colors.textSecondary}
              style={s.chevron}
            />
          </>
        ) : (
          <>
            <Text
              style={[base.label, s.label]}
              numberOfLines={1}
              ellipsizeMode="tail"
              allowFontScaling
            >
              {label}
            </Text>
            <View style={s.rightWrap}>
              {right ? (
                right
              ) : showValue ? (
                <Text
                  style={[
                    base.value,
                    s.value,
                    computedValueMaxWidth ? { maxWidth: computedValueMaxWidth } : null,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  allowFontScaling
                >
                  {value ?? ''}
                </Text>
              ) : null}
              <FeatherIcon
                name="chevron-right"
                size={theme.components.listItem.chevronSize}
                color={theme.colors.textSecondary}
                style={s.chevron}
              />
            </View>
          </>
        )}
      </View>
    </Pressable>
  );
}

// Unified Settings-like switch row.
// Usage:
//   <SwitchField label="Уведомления" value={true} onValueChange={...} />
export function SwitchField({
  label,
  value,
  onValueChange,
  disabled = false,
  style,
  pressable = false,
  onPress,
  placeholder,
}) {
  const { theme } = useTheme();
  const base = listItemStyles(theme);
  return (
    <View
      style={[base.row, disabled && { opacity: theme.components.listItem.disabledOpacity }, style]}
    >
      <Text style={base.label}>{label}</Text>
      <View style={base.rightWrap}>
        <View style={base.switchWrap}>
          <Switch
            value={!!value}
            onValueChange={onValueChange}
            disabled={!!disabled}
            trackColor={{ true: theme.colors.primary }}
          />
          {pressable ? (
            <Pressable
              onPress={onPress}
              style={StyleSheet.absoluteFill}
              android_ripple={{ color: theme.colors.ripple, borderless: false }}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button"
              accessibilityLabel={String(label || placeholder || value || '')}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const selectStyles = (t) =>
  StyleSheet.create({
    disabled: { opacity: t.components.listItem.disabledOpacity || 0.5 },
    label: { flexShrink: 1, paddingRight: 8 },
    value: { flexShrink: 1, marginLeft: 8, marginRight: 8, maxWidth: '48%', textAlign: 'right' },
    rightWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      minWidth: 0,
    },
    chevron: { marginLeft: CHEVRON_GAP },
  });

const pad2 = (n) => String(n).padStart(2, '0');

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
    if (!value?.day || !value?.month) return '';
    const base = `${pad2(value.day)} ${months[value.month - 1]}`;
    return value.year ? `${base}, ${value.year}` : base;
  };

  return (
    <View style={style}>
      <View style={s.wrap}>
        <Text style={s.topLabel}>{label}</Text>
        <View style={s.inputBox}>
          <Text
            style={[
              s.input,
              {
                paddingVertical: Math.max(
                  4,
                  Math.round(
                    (theme.components?.input?.height ?? theme.components?.listItem?.height ?? 48) *
                      0.25,
                  ),
                ),
              },
            ]}
          >
            {display()}
          </Text>
        </View>
      </View>
      {sepEnabled ? <View style={s.separator} /> : null}
    </View>
  );
};

// Helpers kept for formatting only
const months = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleString(undefined, { month: 'short' }).replace('.', ''),
);
