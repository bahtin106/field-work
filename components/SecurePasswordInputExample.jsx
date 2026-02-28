import { useRef, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SecurePasswordInput from '../components/SecurePasswordInput';

/**
 * Пример использования компонента SecurePasswordInput
 * Демонстрирует все возможности и best practices
 */
export default function SecurePasswordInputExample() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordReqs, setShowPasswordReqs] = useState(false);
  const passwordInputRef = useRef(null);
  const confirmPasswordInputRef = useRef(null);

  // Требования к пароля
  const passwordRequirements = {
    minLength: password.length >= 8,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumbers: /[0-9]/.test(password),
    hasSpecial: /[!@#$%^&*]/.test(password),
  };

  const isPasswordValid = Object.values(passwordRequirements).every((req) => req);
  const passwordsMatch = password === confirmPassword && password.length > 0;

  const handleSubmit = () => {
    if (!isPasswordValid) {
      Alert.alert('Ошибка', 'Пароль не соответствует требованиям');
      return;
    }

    if (!passwordsMatch) {
      Alert.alert('Ошибка', 'Пароли не совпадают');
      return;
    }

    Alert.alert('Успех', 'Пароль установлен успешно!');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Заголовок */}
        <View style={styles.header}>
          <Text style={styles.title}>Установка пароля</Text>
          <Text style={styles.subtitle}>Защищенный ввод пароля с поддержкой AutoFill</Text>
        </View>

        {/* Основной ввод пароля */}
        <View style={styles.section}>
          <Text style={styles.label}>Новый пароль</Text>
          <SecurePasswordInput
            ref={passwordInputRef}
            value={password}
            onChangeText={setPassword}
            placeholder="Введите пароль"
            returnKeyType="next"
            onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
            onFocus={() => setShowPasswordReqs(true)}
            style={styles.inputWrapper}
            inputStyle={[
              styles.input,
              password.length > 0 && isPasswordValid && styles.inputValid,
              password.length > 0 && !isPasswordValid && styles.inputError,
            ]}
            toggleIconColor="#007AFF"
          />

          {/* Требования к паролю */}
          {showPasswordReqs && password.length > 0 && (
            <View style={styles.requirements}>
              <Text style={styles.requirementsTitle}>Требования:</Text>
              <PasswordRequirement met={passwordRequirements.minLength} text="Минимум 8 символов" />
              <PasswordRequirement
                met={passwordRequirements.hasUpperCase}
                text="Заглавная буква (A-Z)"
              />
              <PasswordRequirement
                met={passwordRequirements.hasLowerCase}
                text="Строчная буква (a-z)"
              />
              <PasswordRequirement met={passwordRequirements.hasNumbers} text="Цифра (0-9)" />
              <PasswordRequirement
                met={passwordRequirements.hasSpecial}
                text="Спецсимвол (!@#$%^&*)"
              />
            </View>
          )}
        </View>

        {/* Подтверждение пароля */}
        <View style={styles.section}>
          <Text style={styles.label}>Подтвердите пароль</Text>
          <SecurePasswordInput
            ref={confirmPasswordInputRef}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Повторите пароль"
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            style={styles.inputWrapper}
            inputStyle={[
              styles.input,
              confirmPassword.length > 0 && passwordsMatch && styles.inputValid,
              confirmPassword.length > 0 && !passwordsMatch && styles.inputError,
            ]}
            toggleIconColor="#007AFF"
          />
          {confirmPassword.length > 0 && !passwordsMatch && (
            <Text style={styles.errorText}>Пароли не совпадают</Text>
          )}
          {confirmPassword.length > 0 && passwordsMatch && (
            <Text style={styles.successText}>Пароли совпадают ✓</Text>
          )}
        </View>

        {/* Кнопка отправки */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            !(isPasswordValid && passwordsMatch) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!isPasswordValid || !passwordsMatch}
        >
          <Text style={styles.submitButtonText}>Установить пароль</Text>
        </TouchableOpacity>

        {/* Информация */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>ℹ️ Информация о безопасности:</Text>
          <Text style={styles.infoText}>
            • Пароль защищен нативной маскировкой системы iOS/Android
          </Text>
          <Text style={styles.infoText}>
            • Поддерживается автозаполнение (AutoFill) из iCloud Keychain
          </Text>
          <Text style={styles.infoText}>• Последний символ видно на 0.5 сек перед маскировкой</Text>
          <Text style={styles.infoText}>
            • Компонент работает при автоматическом заполнении паролей
          </Text>
          <Text style={styles.infoText}>• Поддерживает все стандартные жесты клавиатуры</Text>
        </View>

        {/* Debug информация (для разработки) */}
        {__DEV__ && (
          <View style={styles.debugSection}>
            <Text style={styles.debugTitle}>🐛 Debug информация:</Text>
            <Text style={styles.debugText}>Пароль: {password ? '••••••' : '(пусто)'}</Text>
            <Text style={styles.debugText}>Длина: {password.length} символов</Text>
            <Text style={styles.debugText}>Валидный: {isPasswordValid ? '✓' : '✗'}</Text>
            <Text style={styles.debugText}>Platform: {Platform.OS}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Компонент для отображения требования к паролю
 */
function PasswordRequirement({ met, text }) {
  return (
    <View style={styles.requirementItem}>
      <Text style={[styles.requirementCheckmark, met && styles.requirementMet]}>
        {met ? '✓' : '✗'}
      </Text>
      <Text style={[styles.requirementText, met && styles.requirementTextMet]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  inputWrapper: {
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#333',
  },
  inputValid: {
    borderColor: '#4CAF50',
    backgroundColor: '#f1f8f5',
  },
  inputError: {
    borderColor: '#f44336',
    backgroundColor: '#ffebee',
  },
  requirements: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#ff9800',
  },
  requirementsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  requirementCheckmark: {
    width: 24,
    textAlign: 'center',
    color: '#f44336',
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 8,
  },
  requirementMet: {
    color: '#4CAF50',
  },
  requirementText: {
    fontSize: 13,
    color: '#666',
    flex: 1,
  },
  requirementTextMet: {
    color: '#4CAF50',
  },
  errorText: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 4,
  },
  successText: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 4,
  },
  submitButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 14,
    marginTop: 8,
    marginBottom: 24,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  infoSection: {
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2196f3',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 12,
    color: '#0d47a1',
    marginBottom: 6,
    lineHeight: 18,
  },
  debugSection: {
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#ffc107',
  },
  debugTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#856404',
    marginBottom: 8,
  },
  debugText: {
    fontSize: 11,
    color: '#856404',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
});
