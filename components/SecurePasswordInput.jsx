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
    const [lastCharShowTime, setLastCharShowTime] = useState(null);
    const hideCharTimeoutRef = useRef(null);
    const inputRef = useRef(null);

    // Синхронизируем внешнее значение
    useEffect(() => {
      setDisplayValue(value);
    }, [value]);

    // Показываем последний символ на время перед маскировкой
    const handleChangeText = (text) => {
      // Очищаем предыдущий таймаут
      if (hideCharTimeoutRef.current) {
        clearTimeout(hideCharTimeoutRef.current);
      }

      setDisplayValue(text);

      // Вызываем callback
      if (onChangeText) {
        onChangeText(text);
      }

      // Если текст не пустой и мы в режиме скрытия пароля,
      // показываем последний символ на 0.5 секунды
      if (text.length > 0 && isSecure) {
        setLastCharShowTime(Date.now());

        hideCharTimeoutRef.current = setTimeout(() => {
          setLastCharShowTime(null);
        }, 500);
      }
    };

    // Обработка пасты (при автозаполнении)
    const handlePaste = (text) => {
      handleChangeText(text);
    };

    // Получаем отображаемый текст:
    // - Если видимый режим: показываем весь пароль
    // - Если режим маскировки и только что ввели символ: показываем последний символ + маски
    // - Иначе: полная маскировка
    const getDisplayText = () => {
      if (!isSecure) {
        return displayValue;
      }

      if (displayValue.length === 0) {
        return '';
      }

      // Проверяем, нужно ли показывать последний символ
      const shouldShowLastChar = lastCharShowTime && Date.now() - lastCharShowTime < 500;

      if (shouldShowLastChar) {
        const maskedPart = '•'.repeat(displayValue.length - 1);
        return maskedPart + displayValue[displayValue.length - 1];
      }

      return '•'.repeat(displayValue.length);
    };

    // Очищаем таймаут при размонтировании
    useEffect(() => {
      return () => {
        if (hideCharTimeoutRef.current) {
          clearTimeout(hideCharTimeoutRef.current);
        }
      };
    }, []);

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
          value={getDisplayText()}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor="#999"
          editable={editable}
          secureTextEntry={false} // Мы сами управляем маскировкой через getDisplayText()
          // iOS AutoFill поддержка - сообщаем системе, что это поле пароля
          textContentType={isSecure ? 'password' : 'none'}
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
    top: '50%',
    transform: [{ translateY: -11 }],
    padding: 8,
    zIndex: 10,
  },
});

export default SecurePasswordInput;
