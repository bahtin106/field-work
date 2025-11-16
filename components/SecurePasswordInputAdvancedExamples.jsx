/**
 * ADVANCED ПРИМЕРЫ использования SecurePasswordInput
 * Продвинутые кейсы и интеграции
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import SecurePasswordInput from '../components/SecurePasswordInput';

// =============================================================================
// ПРИМЕР 1: Password strength meter с анимацией
// =============================================================================
export function PasswordStrengthMeter() {
  const [password, setPassword] = useState('');
  const strengthAnim = useRef(new Animated.Value(0)).current;

  const calculateStrength = (pwd) => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[!@#$%^&*]/.test(pwd)) score++;
    return score;
  };

  const strength = calculateStrength(password);
  const strengthLabels = ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Сильный', 'Отличный'];
  const strengthColors = ['#f44336', '#ff9800', '#ffc107', '#8bc34a', '#4caf50', '#00897b'];

  useEffect(() => {
    Animated.timing(strengthAnim, {
      toValue: strength,
      duration: 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [strength]);

  const strengthWidth = strengthAnim.interpolate({
    inputRange: [0, 6],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="Введите пароль"
      />

      <View style={styles.strengthContainer}>
        <Animated.View
          style={[
            styles.strengthBar,
            {
              width: strengthWidth,
              backgroundColor: strengthColors[strength - 1],
            },
          ]}
        />
      </View>

      {strength > 0 && (
        <Text style={[styles.strengthLabel, { color: strengthColors[strength - 1] }]}>
          {strengthLabels[strength - 1]}
        </Text>
      )}
    </View>
  );
}

// =============================================================================
// ПРИМЕР 2: Двухэтапная верификация пароля
// =============================================================================
export function TwoStepPasswordVerification() {
  const [step, setStep] = useState(1);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');

  const canProceed = newPassword.length >= 8 && newPassword === confirmPassword;

  return (
    <View style={styles.container}>
      {step === 1 ? (
        <View>
          <Text style={styles.title}>Шаг 1: Текущий пароль</Text>
          <SecurePasswordInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Введите текущий пароль"
            returnKeyType="next"
          />

          {currentPassword.length > 0 && (
            <TouchableOpacity
              style={styles.button}
              onPress={() => {
                // Проверить текущий пароль
                setStep(2);
              }}
            >
              <Text style={styles.buttonText}>Далее</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View>
          <Text style={styles.title}>Шаг 2: Новый пароль</Text>
          <SecurePasswordInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Новый пароль"
            returnKeyType="next"
          />

          <SecurePasswordInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Подтвердите пароль"
            returnKeyType="done"
          />

          {newPassword !== confirmPassword && confirmPassword.length > 0 && (
            <Text style={styles.errorText}>Пароли не совпадают</Text>
          )}

          <TouchableOpacity
            style={[styles.button, !canProceed && styles.buttonDisabled]}
            disabled={!canProceed}
            onPress={() => {
              Alert.alert('Успех', 'Пароль изменен');
              setStep(1);
              setNewPassword('');
              setConfirmPassword('');
              setCurrentPassword('');
            }}
          >
            <Text style={styles.buttonText}>Изменить пароль</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.buttonSecondary} onPress={() => setStep(1)}>
            <Text style={styles.buttonSecondaryText}>Назад</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// =============================================================================
// ПРИМЕР 3: Пароль с истечением срока действия
// =============================================================================
export function PasswordWithExpiration() {
  const [password, setPassword] = useState('');
  const [passwordSetDate, setPasswordSetDate] = useState(null);
  const [daysUntilExpire, setDaysUntilExpire] = useState(null);

  const EXPIRE_DAYS = 90;

  useEffect(() => {
    if (!passwordSetDate) return;

    const now = new Date();
    const expiryDate = new Date(passwordSetDate);
    expiryDate.setDate(expiryDate.getDate() + EXPIRE_DAYS);

    const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    setDaysUntilExpire(daysRemaining);
  }, [passwordSetDate]);

  const getExpiryStatus = () => {
    if (!daysUntilExpire) return null;
    if (daysUntilExpire <= 0) return { text: 'Истек', color: '#f44336' };
    if (daysUntilExpire <= 7)
      return { text: `Истекает через ${daysUntilExpire} дн.`, color: '#ff9800' };
    return { text: `Истекает через ${daysUntilExpire} дн.`, color: '#4caf50' };
  };

  const expiryStatus = getExpiryStatus();

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="Введите пароль"
        onFocus={() => setPasswordSetDate(new Date())}
      />

      {expiryStatus && (
        <Text style={[styles.expiryText, { color: expiryStatus.color }]}>{expiryStatus.text}</Text>
      )}
    </View>
  );
}

// =============================================================================
// ПРИМЕР 4: Интеграция с Biometric Authentication
// =============================================================================
export function PasswordWithBiometric() {
  const [password, setPassword] = useState('');
  const [useBiometric, setUseBiometric] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    // Проверить доступность биометрии
    checkBiometricAvailability();
  }, []);

  const checkBiometricAvailability = async () => {
    try {
      // import * as LocalAuthentication from 'expo-local-authentication';
      // const compatible = await LocalAuthentication.hasHardwareAsync();
      // setBiometricAvailable(compatible);
    } catch (error) {
      console.error('Biometric check error:', error);
    }
  };

  const handleBiometricLogin = async () => {
    try {
      // const authenticated = await LocalAuthentication.authenticateAsync({
      //   reason: 'Используйте биометрию для входа',
      //   fallbackLabel: 'Использовать пароль',
      //   disableDeviceFallback: false,
      // });
      // if (authenticated.success) {
      //   // Получить пароль из secure storage
      //   // и автоматически залогиниться
      // }
    } catch (error) {
      Alert.alert('Ошибка', 'Ошибка при использовании биометрии');
    }
  };

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="Введите пароль"
      />

      {biometricAvailable && (
        <TouchableOpacity style={styles.biometricButton} onPress={handleBiometricLogin}>
          <Text style={styles.biometricButtonText}>Использовать Face ID</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// =============================================================================
// ПРИМЕР 5: Пароль с невидимыми требованиями (NIST рекомендации)
// =============================================================================
export function AdvancedPasswordRequirements() {
  const [password, setPassword] = useState('');

  const requirements = {
    minLength: {
      label: 'Минимум 8 символов (рекомендуется 12+)',
      met: password.length >= 8,
    },
    noCommonPatterns: {
      label: 'Не содержит распространенные паттерны',
      met: !['password', 'qwerty', '123456', 'admin', 'letmein'].some((pattern) =>
        password.toLowerCase().includes(pattern),
      ),
    },
    noRepeatingChars: {
      label: 'Не содержит 3+ одинаковых символов подряд',
      met: !/(.)\1{2,}/.test(password),
    },
    mixedCharacters: {
      label: 'Разные типы символов (буквы, цифры)',
      met: /[a-z]/i.test(password) && /[0-9]/.test(password),
    },
  };

  const isValid = Object.values(requirements).every((req) => req.met);

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        inputStyle={[
          password && isValid && styles.inputValid,
          password && !isValid && styles.inputError,
        ]}
      />

      <View style={styles.requirementsAdvanced}>
        {Object.entries(requirements).map(([key, { label, met }]) => (
          <View key={key} style={styles.requirementRow}>
            <Text style={[styles.requirementMark, met && styles.requirementMet]}>
              {met ? '✓' : '○'}
            </Text>
            <Text style={[styles.requirementText, met && styles.requirementMetText]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// =============================================================================
// ПРИМЕР 6: Пароль с истории проверок
// =============================================================================
export function PasswordWithHistory() {
  const [password, setPassword] = useState('');
  const [passwordHistory, setPasswordHistory] = useState([]);
  const [cantReuseFor] = useState(5); // Не использовать 5 предыдущих паролей

  const handleSubmit = async () => {
    const isInHistory = passwordHistory.some((oldPwd) => oldPwd === password);

    if (isInHistory) {
      Alert.alert('Ошибка', `Не используйте пароли из последних ${cantReuseFor} попыток`);
      return;
    }

    // Отправить пароль
    setPasswordHistory((prev) => [password, ...prev].slice(0, cantReuseFor));
    setPassword('');
    Alert.alert('Успех', 'Пароль успешно изменен');
  };

  return (
    <View style={styles.container}>
      <SecurePasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="Новый пароль"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
      />

      {passwordHistory.length > 0 && (
        <View style={styles.historyContainer}>
          <Text style={styles.historyTitle}>История паролей (последние {cantReuseFor}):</Text>
          <View style={styles.historyList}>
            {passwordHistory.map((_, index) => (
              <View key={index} style={styles.historyItem}>
                <Text style={styles.historyIndex}>{index + 1}</Text>
                <Text style={styles.historyMask}>••••••••</Text>
                <Text style={styles.historyDate}>{new Date().toLocaleDateString('ru')}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// Стили
const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    color: '#333',
  },
  strengthContainer: {
    height: 4,
    backgroundColor: '#eee',
    borderRadius: 2,
    marginVertical: 12,
    overflow: 'hidden',
  },
  strengthBar: {
    height: '100%',
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 12,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 8,
  },
  buttonSecondaryText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  errorText: {
    color: '#f44336',
    fontSize: 12,
    marginTop: 6,
  },
  expiryText: {
    fontSize: 12,
    marginTop: 12,
    fontWeight: '600',
  },
  biometricButton: {
    backgroundColor: '#8bc34a',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 12,
  },
  biometricButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  requirementsAdvanced: {
    marginTop: 16,
    paddingHorizontal: 12,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  requirementMark: {
    width: 20,
    textAlign: 'center',
    color: '#ccc',
    fontSize: 16,
    marginRight: 8,
  },
  requirementMet: {
    color: '#4caf50',
  },
  requirementText: {
    flex: 1,
    fontSize: 13,
    color: '#666',
  },
  requirementMetText: {
    color: '#333',
    fontWeight: '500',
  },
  inputValid: {
    borderColor: '#4caf50',
  },
  inputError: {
    borderColor: '#f44336',
  },
  historyContainer: {
    marginTop: 16,
    paddingHorizontal: 12,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  historyList: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  historyIndex: {
    fontWeight: 'bold',
    color: '#999',
    marginRight: 12,
    width: 24,
  },
  historyMask: {
    flex: 1,
    color: '#999',
    fontWeight: '500',
  },
  historyDate: {
    fontSize: 11,
    color: '#999',
  },
});

export default {
  PasswordStrengthMeter,
  TwoStepPasswordVerification,
  PasswordWithExpiration,
  PasswordWithBiometric,
  AdvancedPasswordRequirements,
  PasswordWithHistory,
};
