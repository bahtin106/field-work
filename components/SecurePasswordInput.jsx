import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Профессиональный компонент для ввода пароля с поддержкой:
 * - Маскировкой на обеих платформах (iOS и Android)
 * - Показом последней введенной символа на доли секунды
 * - AutoFill на iOS (поддержка iCloud Keychain)
 * - Toggle видимости/скрытия пароля
 * - Правильной обработкой при автозаполнении
 */
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
    const [displayValue, setDisplayValue] = useState(value);
    const inputRef = useRef(null);

    // Синхронизируем внешнее значение
    useEffect(() => {
      setDisplayValue(value);
    }, [value]);
      const handleChangeText = (text) => {
        setDisplayValue(text);
        if (onChangeText) onChangeText(text);
      };

    const toggleSecure = () => {
      setIsSecure(!isSecure);
      // При переключении остаемся в фокусе
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };

    return (
      <View style={[styles.container, style]}>
        <TextInput
          ref={ref || inputRef}
          style={[styles.input, inputStyle]}
          value={displayValue != null ? String(displayValue) : ''}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor="#999"
          editable={editable}
          secureTextEntry={isSecure}
          // iOS AutoFill поддержка - сообщаем системе, что это поле пароля
          textContentType={'password'}
          autoComplete={Platform.OS === 'android' ? 'password' : undefined}
          // Клавиатура и поведение
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          keyboardType="default"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          // События
          onEndEditing={onEndEditing}
          onFocus={onFocus}
          onBlur={onBlur}
          // Доступность
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
            <Icon
              name={isSecure ? 'eye-off' : 'eye'}
              size={toggleIconSize}
              color={toggleIconColor}
            />
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
    paddingRight: 50, // Место для кнопки toggle
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
