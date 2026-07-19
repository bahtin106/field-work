import React, { useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { getFieldValidationState } from '../src/shared/forms/fieldValidation';
import { TEXT_INPUT_LIMITS } from '../src/shared/input/limits';
import { useTranslation } from '../src/i18n/useTranslation';
import { useTheme } from '../theme/ThemeProvider';

const SecurePasswordInput = React.forwardRef(
  (
    {
      value = '',
      onChangeText,
      placeholder,
      editable = true,
      onSubmitEditing,
      returnKeyType = 'done',
      style,
      inputStyle,
      testID,
      showVisibilityToggle = true,
      toggleIconColor,
      toggleIconSize,
      onEndEditing,
      onFocus,
      onBlur,
      error,
      required = false,
      forceValidation = false,
    },
    ref,
  ) => {
    const { theme } = useTheme();
    const { t } = useTranslation();
    const [isSecure, setIsSecure] = useState(true);
    const [touched, setTouched] = useState(false);
    const inputRef = useRef(null);
    const lastKeyRef = useRef(null);
    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus?.(),
      blur: () => inputRef.current?.blur?.(),
      clear: () => inputRef.current?.clear?.(),
      isFocused: () => inputRef.current?.isFocused?.() || false,
      measure: (cb) => inputRef.current?.measure?.(cb),
      measureInWindow: (cb) => inputRef.current?.measureInWindow?.(cb),
      getNativeRef: () => inputRef.current,
      ...inputRef.current,
    }));

    const effectivePlaceholder = placeholder || t('set_password_label');
    const validationState = getFieldValidationState({
      label: effectivePlaceholder,
      value,
      error,
      required,
      forceValidation,
      touched,
    });
    const styles = useMemo(
      () => createStyles(theme, validationState.isInvalid),
      [theme, validationState.isInvalid],
    );

    const effectiveValue = value != null ? String(value) : '';
    const useInstantMasking = false;
    const displayValue = effectiveValue;

    const handleChangeText = (text) => {
      if (!useInstantMasking) {
        onChangeText?.(text);
        return;
      }

      const derivedValue = deriveNextPasswordValue({
        currentValue: effectiveValue,
        inputText: text,
        lastKey: lastKeyRef.current,
      });
      lastKeyRef.current = null;
      onChangeText?.(derivedValue);
    };

    const toggleSecure = () => {
      setIsSecure((prev) => !prev);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };

    return (
      <View style={[styles.container, style]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, inputStyle]}
          value={displayValue}
          onChangeText={handleChangeText}
          placeholder={effectivePlaceholder}
          placeholderTextColor={theme.colors.inputPlaceholder}
          editable={editable}
          secureTextEntry={useInstantMasking ? false : isSecure}
          textContentType="password"
          autoComplete={Platform.OS === 'android' ? 'password' : undefined}
          keyboardType="default"
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          importantForAutofill="yes"
          onKeyPress={(e) => {
            lastKeyRef.current = e?.nativeEvent?.key ?? null;
          }}
          onEndEditing={onEndEditing}
          onFocus={onFocus}
          onBlur={(e) => {
            setTouched(true);
            onBlur?.(e);
          }}
          testID={testID}
          accessibilityLabel={effectivePlaceholder}
          accessibilityHint={t('password_accessibility_hint')}
          maxLength={TEXT_INPUT_LIMITS.password}
        />

        {showVisibilityToggle ? (
          <TouchableOpacity
            onPress={toggleSecure}
            style={styles.toggleButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={isSecure ? t('a11y_show_password') : t('a11y_hide_password')}
          >
            <MaterialCommunityIcons
              name={isSecure ? 'eye-off' : 'eye'}
              size={toggleIconSize ?? (theme.components?.icon?.sizeSm ?? 22)}
              color={toggleIconColor ?? theme.colors.textSecondary}
            />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  },
);

SecurePasswordInput.displayName = 'SecurePasswordInput';

function createStyles(theme, isError = false) {
  return StyleSheet.create({
    container: {
      position: 'relative',
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
    },
    input: {
      flex: 1,
      borderWidth: theme.components?.input?.borderWidth ?? 1,
      borderColor: isError ? theme.colors.danger : theme.colors.border,
      borderRadius: theme.radii.md ?? 8,
      paddingVertical: theme.spacing.sm ?? 12,
      paddingHorizontal: theme.spacing.md ?? 16,
      paddingRight: 50,
      fontSize: theme.typography.sizes.md ?? 16,
      color: theme.colors.text,
      fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
      backgroundColor: theme.colors.surface,
    },
    toggleButton: {
      position: 'absolute',
      right: 12,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      padding: 8,
      zIndex: 10,
    },
  });
}

export default SecurePasswordInput;
