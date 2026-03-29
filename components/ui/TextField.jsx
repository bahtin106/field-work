// components/ui/TextField.jsx
import FeatherIcon from '@expo/vector-icons/Feather';
import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { deriveNextPasswordValue, maskPasswordValue } from '../../lib/passwordInputMasking';
import { t as T } from '../../src/i18n';
import { useAutoScrollOnInvalid } from '../../src/shared/forms/FormAutoScrollContext';
import { getFieldValidationState, getRequiredFieldLabel } from '../../src/shared/forms/fieldValidation';
import { useTheme } from '../../theme';
import { withAlpha } from '../../theme/colors';
import { focusNextInput, registerInput, unregisterInput } from './inputFocusRegistry';
import { CHEVRON_GAP, listItemStyles } from './listItemStyles';
import ThemedSwitch from './ThemedSwitch';

const isTextLikeNode = (node) => typeof node === 'string' || typeof node === 'number';

const getAccessibilityText = (node) => {
  if (isTextLikeNode(node)) return String(node);
  return '';
};

const buildAccessibilityLabel = (...parts) =>
  parts.map(getAccessibilityText).filter(Boolean).join(' - ');

const resolveSpacing = (theme, value, fallback) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return theme.spacing?.[value] ?? fallback;
  return fallback;
};

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
    autoFocus = false,
    showSoftInputOnFocus = true,
    returnKeyType,
    onSubmitEditing,
    onFocus,
    onBlur,
    pressable = false,
    onPress,
    forceValidation = false,
    required = false,
    hideSeparator = false,
    filterInput, // Функция для фильтрации ввода (например, для паролей)
    onInvalidInput, // Callback когда пользователь вводит недопустимый символ
    autoGrow,
    minLines,
    maxLines,
  },
  ref,
) {
  const { theme } = useTheme();
  const containerRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const lastKeyRef = useRef(null);
  const fieldIdRef = useRef(Symbol('text-field'));
  const mountOrderRef = useRef(Date.now() + Math.random());
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
  const effectiveMultiline = !!multiline;

  const maxRowsFromProps =
    Number.isFinite(maxLines) && maxLines >= 1 ? Math.max(1, Math.floor(maxLines)) : null;
  const maxRows = maxRowsFromProps ?? theme.components?.input?.autoGrowMaxRows ?? 5;
  const fontSize = theme.typography?.sizes?.md ?? 15;
  const lineHeightRatio = theme.typography?.lineHeights?.normal ?? 1.35;
  const lineHeightValue = Math.round(fontSize * lineHeightRatio);
  const minLinesValue =
    Number.isFinite(minLines) && minLines >= 1 ? Math.max(1, Math.floor(minLines)) : 1;
  const minContentHeight = Math.max(baseInputHeight, lineHeightValue * minLinesValue);
  const maxContentHeight = Math.max(minContentHeight, lineHeightValue * maxRows);

  const validationState = getFieldValidationState({
    label,
    value,
    error,
    required,
    touched,
    forceValidation,
  });
  const resolvedLabel = getRequiredFieldLabel(label, validationState.isRequired);
  const isErr = validationState.isInvalid;
  useAutoScrollOnInvalid({
    fieldRef: containerRef,
    isInvalid: isErr,
    shouldAutoScroll: !focused,
    focus: false,
  });
  const s = styles(theme, isErr, focused, autoGrowEnabled, minContentHeight, effectiveMultiline);
  const inputRef = useRef(null);
  const [contentHeight, setContentHeight] = useState(minContentHeight);

  useEffect(() => {
    if (!effectiveMultiline || !autoGrowEnabled) {
      setContentHeight(minContentHeight);
    }
  }, [autoGrowEnabled, effectiveMultiline, minContentHeight]);

  React.useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus?.(),
    blur: () => inputRef.current?.blur?.(),
    clear: () => inputRef.current?.clear?.(),
    isFocused: () => inputRef.current?.isFocused?.() || false,
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
  const effectiveValue = value != null ? String(value) : '';
  const useInstantMasking = Platform.OS === 'android' && secureTextEntry && effectiveSecureTextEntry;
  const displayedValue = useInstantMasking ? maskPasswordValue(effectiveValue) : effectiveValue;
  const handleInputChange = React.useCallback(
    (text) => {
      if (!useInstantMasking) {
        handleChangeText(text);
        return;
      }

      const derivedValue = deriveNextPasswordValue({
        currentValue: effectiveValue,
        inputText: text,
        lastKey: lastKeyRef.current,
      });
      lastKeyRef.current = null;
      handleChangeText(derivedValue);
    },
    [effectiveValue, handleChangeText, useInstantMasking],
  );

  const effectiveReturnKeyType = useMemo(() => {
    if (returnKeyType) return returnKeyType;
    if (effectiveMultiline) return 'default';
    return onSubmitEditing ? 'done' : 'next';
  }, [effectiveMultiline, onSubmitEditing, returnKeyType]);

  const handleSubmitEditing = React.useCallback(
    (e) => {
      onSubmitEditing?.(e);

      if (effectiveMultiline || onSubmitEditing) return;
      const moved = focusNextInput(fieldIdRef.current);
      if (!moved) Keyboard.dismiss();
    },
    [effectiveMultiline, onSubmitEditing],
  );

  useEffect(() => {
    if (effectiveMultiline || pressable) return undefined;

    const id = fieldIdRef.current;
    registerInput({
      id,
      order: mountOrderRef.current,
      getInput: () => inputRef.current,
    });

    return () => {
      unregisterInput(id);
    };
  }, [effectiveMultiline, pressable]);

  return (
    <View ref={containerRef} style={style}>
      {resolvedLabel ? <Text style={s.topLabel}>{String(resolvedLabel)}</Text> : null}
      <View
        style={[
          s.wrap,
          effectiveMultiline && autoGrowEnabled
            ? { minHeight: Math.max(baseInputHeight, contentHeight) }
            : null,
        ]}
      >
        {leftSlot && <View style={s.slot}>{leftSlot}</View>}
        <View
          style={[
            s.inputBox,
            effectiveMultiline && autoGrowEnabled
              ? { minHeight: Math.max(baseInputHeight, contentHeight) }
              : null,
          ]}
        >
          <TextInput
            ref={inputRef}
            value={displayedValue}
            onChangeText={handleInputChange}
            placeholder={placeholder ? String(placeholder) : undefined}
            placeholderTextColor={theme.colors.inputPlaceholder}
            keyboardType={
              keyboardType ||
              (secureTextEntry ? (Platform.OS === 'android' ? 'visible-password' : 'default') : 'default')
            }
            secureTextEntry={useInstantMasking ? false : effectiveSecureTextEntry}
            autoCorrect={false}
            autoComplete={secureTextEntry ? 'password' : undefined}
            textContentType={secureTextEntry ? 'password' : undefined}
            importantForAutofill={secureTextEntry ? 'yes' : 'auto'}
            onKeyPress={(e) => {
              lastKeyRef.current = e?.nativeEvent?.key ?? null;
            }}
            multiline={effectiveMultiline}
            numberOfLines={numberOfLines}
            underlineColorAndroid="transparent"
            scrollEnabled={effectiveMultiline && !autoGrowEnabled}
            onContentSizeChange={(e) => {
              if (!effectiveMultiline || !autoGrowEnabled) return;
              const nextHeight = Number(e?.nativeEvent?.contentSize?.height) || minContentHeight;
              const clampedHeight = Math.max(minContentHeight, Math.min(nextHeight, maxContentHeight));
              setContentHeight((prev) => (Math.abs(prev - clampedHeight) > 1 ? clampedHeight : prev));
            }}
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
            autoFocus={autoFocus}
            showSoftInputOnFocus={showSoftInputOnFocus}
            blurOnSubmit={false}
            returnKeyType={effectiveReturnKeyType}
            onSubmitEditing={handleSubmitEditing}
            style={[
              s.input,
              effectiveMultiline && {
                flex: undefined,
                width: '100%',
                minHeight: autoGrowEnabled ? contentHeight : undefined,
                maxHeight: autoGrowEnabled ? maxContentHeight : undefined,
              },
              !effectiveMultiline && { flex: 1 },
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
              accessibilityLabel={buildAccessibilityLabel(label, placeholder, value)}
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
  const input = t.components?.input || {};
  const insetKey = sep.insetX || 'lg';
  const baseSeparatorHeight = sep.height ?? t.components?.listItem?.dividerWidth ?? 1;
  const errorSeparatorMultiplier = sep.errorHeightMultiplier ?? 2;
  const sepHeight = isError
    ? Math.max(baseSeparatorHeight * errorSeparatorMultiplier, baseSeparatorHeight + 1)
    : baseSeparatorHeight;
  const alpha = isError ? 1 : (sep.alpha ?? 0.18);
  const sepColor = isError
    ? t.colors.danger
    : withAlpha(t.colors.primary, alpha);
  const ml = Number(t.spacing?.[insetKey] ?? 0) || 0;
  const mr = Number(t.spacing?.[insetKey] ?? 0) || 0;

  const baseHeight =
    baseHeightOverride ?? t.components?.input?.height ?? t.components?.listItem?.height ?? 48;

  // Используем labelSpacing из токенов или fallback
  const labelSpacing = input.labelSpacing ?? t.spacing?.xs ?? 4;
  const slotGap = resolveSpacing(t, input.slotGap, t.spacing?.xs ?? 4);

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
      fontWeight: isError ? '700' : '500',
      marginBottom: labelSpacing,
      marginTop: 0,
      color: isError ? t.colors.danger : t.colors.textSecondary,
      fontSize: t.typography.sizes.sm,
      marginLeft: ml,
      marginRight: mr,
    },
    input: {
      color: t.colors.text,
      fontSize: t.typography.sizes.md,
      minHeight: baseHeight,
      paddingVertical: Math.max(4, Math.round(baseHeight * 0.25)),
      paddingLeft: 0,
    },
    slot: { marginHorizontal: slotGap },
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
  onDisabledPress,
  error,
  required = false,
  forceValidation = false,
  right, // optional custom right ReactNode
  showValue = true, // when false -> only chevron shown
  disabled = false,
  style,
  dense = false, // NEW: compact row height
  alignValueLeft = false, // NEW: value aligned left
  valueNumberOfLines = 1,
}) {
  const { theme } = useTheme();
  const rowRef = React.useRef(null);
  const base = listItemStyles(theme);
  const validationState = getFieldValidationState({
    label,
    value,
    error,
    required,
    forceValidation,
    touched: false,
  });
  const resolvedLabel = isTextLikeNode(label)
    ? getRequiredFieldLabel(label, validationState.isRequired)
    : label;
  const accessibilityLabelText = getAccessibilityText(
    isTextLikeNode(label) ? getRequiredFieldLabel(label, validationState.isRequired) : label,
  );
  const accessibilityValueText = getAccessibilityText(value);
  const s = selectStyles(theme, validationState.isInvalid);
  useAutoScrollOnInvalid({
    fieldRef: rowRef,
    isInvalid: validationState.isInvalid,
    shouldAutoScroll: true,
    focus: false,
  });
  const resolvedOnPress = disabled ? onDisabledPress : onPress;
  const isPressDisabled = typeof resolvedOnPress !== 'function';
  const [isPressed, setIsPressed] = React.useState(false);
  const pressAnim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(pressAnim, {
      toValue: isPressed ? 1 : 0,
      duration: isPressed ? 110 : 160,
      easing: isPressed ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isPressed, pressAnim]);
  const [rowWidth, setRowWidth] = React.useState(null);
  const chevronSize = theme.components.listItem.chevronSize || 20;
  const animatedScaleStyle = React.useMemo(
    () => ({
      transform: [
        {
          scale: pressAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.985],
          }),
        },
      ],
    }),
    [pressAnim],
  );
  const baseLabelColor = validationState.isInvalid
    ? theme.colors.danger
    : (theme.colors.textStrong ?? theme.colors.text);
  const baseValueColor = validationState.isInvalid ? theme.colors.danger : theme.colors.text;
  const baseChevronColor = validationState.isInvalid ? theme.colors.danger : theme.colors.textSecondary;
  const listItem = theme.components?.listItem || {};
  const valueGap = theme.spacing?.sm ?? 8;
  const compactHeight = listItem.compactHeight ?? Math.max(36, theme.components?.input?.height ?? 36);
  const leftAlignedValueGap = Math.max(2, Math.floor((theme.spacing?.xs ?? 4) / 2));
  const labelColor = isPressed ? theme.colors.textSecondary : baseLabelColor;
  const valueColor = isPressed ? theme.colors.textSecondary : baseValueColor;
  const chevronColor = isPressed ? theme.colors.textSecondary : baseChevronColor;
  const computedValueMaxWidth = React.useMemo(() => {
    if (!rowWidth) return undefined;
    const reserve = chevronSize + (listItem.valueReserve ?? 24);
    const avail = Math.max(0, rowWidth - reserve);
    return Math.max(80, Math.floor(avail * 0.45));
  }, [rowWidth, chevronSize, listItem.valueReserve]);
  return (
    <Pressable
      ref={rowRef}
      onPress={resolvedOnPress}
      disabled={isPressDisabled}
      android_ripple={undefined}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={buildAccessibilityLabel(accessibilityLabelText, accessibilityValueText)}
    >
      <Animated.View
        onLayout={(e) => {
          try {
            const w = e?.nativeEvent?.layout?.width;
            if (w && w !== rowWidth) setRowWidth(w);
          } catch {}
        }}
        style={[
          animatedScaleStyle,
          base.row,
          disabled && s.disabled,
          dense && { height: compactHeight, minHeight: compactHeight },
          style,
        ]}
      >
        {alignValueLeft ? (
          <>
            <View style={{ flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
              {resolvedLabel ? (
                <Text
                  style={[base.label, s.label, { paddingRight: 0, color: labelColor }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  allowFontScaling
                >
                  {resolvedLabel}
                </Text>
              ) : null}
              {showValue ? (
                <Text
                  style={[
                    base.value,
                    s.value,
                    {
                      textAlign: 'left',
                      marginTop: leftAlignedValueGap,
                      marginRight: valueGap,
                      color: valueColor,
                    },
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
              color={chevronColor}
              style={s.chevron}
            />
          </>
        ) : (
          <>
            <Text
              style={[base.label, s.label, { color: labelColor }]}
              numberOfLines={1}
              ellipsizeMode="tail"
              allowFontScaling
            >
              {resolvedLabel}
            </Text>
            <View style={s.rightWrap}>
              {right ? (
                right
              ) : showValue ? (
                <Text
                  style={[
                    base.value,
                    s.value,
                    { color: valueColor },
                    computedValueMaxWidth ? { maxWidth: computedValueMaxWidth } : null,
                  ]}
                  numberOfLines={valueNumberOfLines}
                  ellipsizeMode="tail"
                  allowFontScaling
                >
                  {value ?? ''}
                </Text>
              ) : null}
              <FeatherIcon
                name="chevron-right"
                size={theme.components.listItem.chevronSize}
                color={chevronColor}
                style={s.chevron}
              />
            </View>
          </>
        )}
      </Animated.View>
      {validationState.isInvalid ? <View style={s.separator} /> : null}
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
          <ThemedSwitch
            value={!!value}
            onValueChange={onValueChange}
            disabled={!!disabled}
          />
          {pressable ? (
            <Pressable
              onPress={onPress}
              style={StyleSheet.absoluteFill}
              android_ripple={{ color: theme.colors.ripple, borderless: false }}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button"
              accessibilityLabel={buildAccessibilityLabel(label, placeholder, value)}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const selectStyles = (t, isError = false) => {
  const listItem = t.components?.listItem || {};
  const valueGap = t.spacing?.sm ?? 8;

  return StyleSheet.create({
    disabled: { opacity: listItem.disabledOpacity || 0.5 },
    label: {
      flexShrink: 1,
      paddingRight: valueGap,
      fontWeight: isError ? t.typography.weight.bold : t.typography.weight.medium,
    },
    value: {
      flexShrink: 1,
      marginLeft: valueGap,
      marginRight: valueGap,
      maxWidth: '48%',
      textAlign: 'right',
    },
    rightWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      minWidth: 0,
    },
    chevron: { marginLeft: listItem.chevronGap ?? CHEVRON_GAP },
    separator: {
      height: isError
        ? Math.max(
            (t.components?.input?.separator?.height ?? t.components?.listItem?.dividerWidth ?? 1) * 2,
            (t.components?.input?.separator?.height ?? t.components?.listItem?.dividerWidth ?? 1) + 1,
          )
        : (t.components?.input?.separator?.height ?? t.components?.listItem?.dividerWidth ?? 1),
      backgroundColor: isError
        ? t.colors.danger
        : withAlpha(t.colors.primary, t.components?.input?.separator?.alpha ?? 0.18),
      marginLeft: Number(t.spacing?.[t.components?.input?.separator?.insetX ?? 'lg'] ?? 0) || 0,
      marginRight: Number(t.spacing?.[t.components?.input?.separator?.insetX ?? 'lg'] ?? 0) || 0,
    },
  });
};

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
  error,
  required = false,
  forceValidation = false,
  onChange: _onChange, // kept for API compatibility (not used internally)
  style,
}) => {
  const { theme } = useTheme();
  const containerRef = React.useRef(null);
  const validationState = getFieldValidationState({
    label,
    value,
    error,
    required,
    forceValidation,
    touched: false,
  });
  const isErr = validationState.isInvalid;
  useAutoScrollOnInvalid({
    fieldRef: containerRef,
    isInvalid: isErr,
    shouldAutoScroll: true,
    focus: false,
  });
  const s = styles(theme, isErr, false);
  const sepConfig = theme.components?.input?.separator || {};
  const sepHeight = sepConfig.height ?? theme.components?.listItem?.dividerWidth ?? 1;
  const sepEnabled = sepConfig.enabled ?? sepHeight > 0;

  const display = () => {
    if (!value?.day || !value?.month) return '';
    const base = `${pad2(value.day)} ${months[value.month - 1]}`;
    return value.year ? `${base}, ${value.year}` : base;
  };

  return (
    <View style={style}>
      <View ref={containerRef} style={s.wrap}>
        <Text style={s.topLabel}>{getRequiredFieldLabel(label, validationState.isRequired)}</Text>
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
