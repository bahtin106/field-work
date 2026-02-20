import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { deriveNextPasswordValue, maskPasswordValue } from '../lib/passwordInputMasking';

const SecurePasswordInput = React.forwardRef(
  (
    {
      value = '',
      onChangeText,
      placeholder = 'Пароль',
      editable = true,
      onSubmitEditing,
      returnKeyType = 'done',
      style,
      inputStyle,
      testID,
      showVisibilityToggle = true,
      toggleIconColor = '#666',
      toggleIconSize = 22,
      onEndEditing,
      onFocus,
      onBlur,
    },
    ref,
  ) => {
    const [isSecure, setIsSecure] = useState(true);
    const inputRef = useRef(null);
    const lastKeyRef = useRef(null);

    const effectiveValue = value != null ? String(value) : '';
    const useInstantMasking = Platform.OS === 'android' && isSecure;
    const displayValue = useInstantMasking ? maskPasswordValue(effectiveValue) : effectiveValue;

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
          ref={ref || inputRef}
          style={[styles.input, inputStyle]}
          value={displayValue}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor="#999"
          editable={editable}
          secureTextEntry={useInstantMasking ? false : isSecure}
          textContentType="password"
          autoComplete={Platform.OS === 'android' ? 'password' : undefined}
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
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
          onBlur={onBlur}
          testID={testID}
          accessibilityLabel={placeholder}
          accessibilityHint="Защищенное поле ввода пароля"
        />

        {showVisibilityToggle && (
          <TouchableOpacity
            onPress={toggleSecure}
            style={styles.toggleButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isSecure ? 'Показать пароль' : 'Скрыть пароль'}
          >
            <Icon name={isSecure ? 'eye-off' : 'eye'} size={toggleIconSize} color={toggleIconColor} />
          </TouchableOpacity>
        )}
      </View>
    );
  },
);

SecurePasswordInput.displayName = 'SecurePasswordInput';

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    paddingRight: 50,
    fontSize: 16,
    color: '#333',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
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

export default SecurePasswordInput;
