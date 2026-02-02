import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import TextField from '../../components/ui/TextField';
import { useToast } from '../../components/ui/ToastProvider';
import ValidationAlert from '../../components/ui/ValidationAlert';
import {
  AUTH_CONSTRAINTS,
  filterPasswordInput,
  getPasswordValidationErrors,
  isValidPassword,
} from '../../lib/authValidation';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

export default function SetPasswordScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [invalidCharWarning, setInvalidCharWarning] = useState(false);

  const pwdRef = useRef(null);

  const passwordValid = useMemo(() => isValidPassword(password), [password]);
  const passwordsMatch = useMemo(
    () => !password || password === confirmPassword,
    [password, confirmPassword],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        flex: { flex: 1 },
        container: { flex: 1, backgroundColor: theme.colors.background },
        content: {
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
          paddingBottom: theme.components.scrollView.paddingBottom + insets.bottom,
        },
        title: {
          textAlign: 'center',
          color: theme.colors.text,
          fontSize: theme.typography.sizes.xxl,
          fontWeight: theme.typography.weight.bold,
          marginBottom: theme.spacing.sm,
        },
        subtitle: {
          textAlign: 'center',
          color: theme.colors.textSecondary,
          fontSize: theme.typography.sizes.md,
          marginBottom: theme.spacing.lg,
        },
        field: {
          marginVertical: theme.components?.input?.fieldSpacing ?? theme.spacing.sm,
        },
        buttonContainer: {
          marginTop: theme.spacing.lg,
          gap: theme.spacing.sm,
        },
        errorText: {
          color: theme.colors.danger,
          textAlign: 'center',
          marginVertical: theme.spacing.sm,
          fontSize: theme.typography.sizes.sm,
        },
      }),
    [theme, insets],
  );

  // Валидация
  useMemo(() => {
    const errors = [];

    if (submittedAttempt) {
      if (!password.trim()) errors.push(t('err_password_short'));
      if (!confirmPassword.trim()) errors.push(t('err_password_mismatch'));
    }

    if (password.length > 0) {
      const pwdValidation = getPasswordValidationErrors(password);
      if (!pwdValidation.valid) {
        if (pwdValidation.errors.includes('password_too_short')) {
          errors.push(t('err_password_short'));
        }
        if (pwdValidation.errors.includes('password_invalid_chars')) {
          errors.push(t('err_password_invalid_chars'));
        }
      }
    }

    if (password.length > 0 && confirmPassword.length > 0 && !passwordsMatch) {
      errors.push(t('err_password_mismatch'));
    }

    setValidationErrors(errors);
  }, [password, confirmPassword, submittedAttempt, t]);

  const handleInvalidPasswordInput = useCallback(() => {
    setInvalidCharWarning(true);
    setTimeout(() => {
      setInvalidCharWarning(false);
    }, theme.timings.invalidInputWarningMs);
  }, [theme.timings.invalidInputWarningMs]);

  const handleSetPassword = useCallback(async () => {
    if (submitting) return;
    Keyboard.dismiss();
    setSubmittedAttempt(true);

    if (!passwordValid || !passwordsMatch) {
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      // Обновляем пароль для текущего пользователя
      const { error: updateError } = await supabase.auth.updateUser({
        password: password.trim(),
      });

      if (updateError) {
        throw updateError;
      }

      toastSuccess('Пароль успешно установлен!');
      setTimeout(() => {
        router.replace('/');
      }, theme.timings?.postRegisterNavDelayMs ?? 500);
    } catch (e) {
      const msg = e?.message || t('toast_generic_error');
      setError(msg);
      toastError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, passwordValid, passwordsMatch, password, router, theme, t, toastSuccess, toastError]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={['left', 'right']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Создайте пароль</Text>
          <Text style={styles.subtitle}>
            Выберите надёжный пароль для входа в приложение
          </Text>

          {error ? (
            <ValidationAlert messages={[error]} variant="error" />
          ) : null}

          {validationErrors.length > 0 ? (
            <ValidationAlert messages={validationErrors} />
          ) : null}

          {invalidCharWarning ? (
            <ValidationAlert
              messages={['Недопустимые символы в пароле']}
              variant="warning"
            />
          ) : null}

          <Card paddedXOnly>
            <View style={{ position: 'relative' }}>
              <TextField
                ref={pwdRef}
                label="Пароль"
                value={password}
                onChangeText={setPassword}
                placeholder="Введите пароль"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.field}
                forceValidation={submittedAttempt}
                error={
                  submittedAttempt && !password.trim()
                    ? 'required'
                    : password.length > 0 && !passwordValid
                      ? 'invalid'
                      : undefined
                }
                filterInput={filterPasswordInput}
                onInvalidInput={handleInvalidPasswordInput}
                maxLength={AUTH_CONSTRAINTS.PASSWORD.MAX_LENGTH}
                rightSlot={
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Pressable
                      onPress={() => {
                        setShowPassword((v) => !v);
                      }}
                      android_ripple={{
                        color: theme?.colors?.border ?? '#00000020',
                        borderless: false,
                        radius: 24,
                      }}
                      accessibilityLabel={
                        showPassword ? t('a11y_hide_password') : t('a11y_show_password')
                      }
                      accessibilityRole="button"
                      hitSlop={{
                        top: theme.spacing.sm,
                        bottom: theme.spacing.sm,
                        left: theme.spacing.sm,
                        right: theme.spacing.sm,
                      }}
                      style={{ padding: theme.spacing.xs, borderRadius: theme.radii.md }}
                    >
                      <Feather
                        name={showPassword ? 'eye-off' : 'eye'}
                        size={22}
                        color={theme.colors.primary ?? theme.colors.text}
                      />
                    </Pressable>
                  </View>
                }
              />
            </View>

            <TextField
              label="Подтвердите пароль"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Повторите пароль"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.field}
              forceValidation={submittedAttempt}
              error={
                submittedAttempt && !confirmPassword.trim()
                  ? 'required'
                  : confirmPassword.length > 0 && !passwordsMatch
                    ? 'mismatch'
                    : undefined
              }
            />
          </Card>

          <View style={styles.buttonContainer}>
            <Button
              title="Установить пароль"
              onPress={handleSetPassword}
              disabled={submitting || !passwordValid || !passwordsMatch}
              loading={submitting}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
