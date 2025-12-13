import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import TextField from '../../components/ui/TextField';
import { useAuthLogin } from '../../hooks/useAuthLogin';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

const createStyles = (theme) => {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      paddingHorizontal: theme.spacing.lg,
      justifyContent: 'center',
    },
    content: {
      justifyContent: 'center',
      alignItems: 'stretch',
      gap: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
    },
    title: {
      textAlign: 'center',
      color: theme.colors.text,
      fontSize: theme.typography.sizes.xxl,
      fontWeight: theme.typography.weight.bold,
      marginBottom: theme.spacing.xs,
    },
    subtitle: {
      textAlign: 'center',
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      marginBottom: theme.spacing.xl,
    },
    fieldCard: {
      position: 'relative',
    },
    eyeButton: {
      position: 'absolute',
      right: theme.spacing.md,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      zIndex: 10,
    },
    errorText: {
      color: theme.colors.danger,
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
      marginTop: theme.spacing.xs,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    registerText: {
      textAlign: 'center',
      marginTop: theme.spacing.sm,
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textSecondary,
    },
    registerLink: {
      color: theme.colors.primary,
      fontWeight: theme.typography.weight.semibold,
    },
  });
};

function LoginScreenContent() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const interactive = theme.components?.interactive || {
    hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
    pressRetentionOffset: { top: 16, bottom: 16, left: 16, right: 16 },
    rippleRadius: 24,
    rippleBorderless: false,
  };

  const { email, setEmail, password, setPassword, error, loading, canSubmit, handleLogin, reset } =
    useAuthLogin();

  // Очищаем форму при монтировании компонента
  useEffect(() => {
    reset();
  }, [reset]);

  const passwordFieldRef = useRef(null);

  const handleTogglePassword = useCallback(() => {
    passwordFieldRef.current?.togglePasswordVisibility();
  }, []);

  const handleSubmit = useCallback(async () => {
    await handleLogin();
  }, [handleLogin]);

  return (
    <Screen background="background">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <View style={styles.content}>
              <Text style={styles.title}>{t('login_title')}</Text>
              <Text style={styles.subtitle}>{t('login_subtitle')}</Text>

              <Card paddedXOnly style={styles.fieldCard}>
                <TextField
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('fields_email')}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="next"
                  accessibilityLabel={t('fields_email')}
                  editable={!loading}
                  hideSeparator={true}
                  style={{ minHeight: 52 }}
                />
              </Card>

              <Card paddedXOnly style={styles.fieldCard}>
                <TextField
                  ref={passwordFieldRef}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('fields_password')}
                  secureTextEntry={true}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  textContentType="password"
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  accessibilityLabel={t('fields_password')}
                  editable={!loading}
                  hideSeparator={true}
                  style={{ minHeight: 52 }}
                />
                <Pressable
                  onPress={handleTogglePassword}
                  style={styles.eyeButton}
                  android_ripple={{
                    color: theme.colors.border,
                    borderless: interactive.rippleBorderless,
                    radius: interactive.rippleRadius,
                  }}
                  accessibilityLabel={t('auth_show_password')}
                  accessibilityRole="button"
                  hitSlop={interactive.hitSlop}
                  pressRetentionOffset={interactive.pressRetentionOffset}
                  disabled={loading}
                >
                  <Feather
                    name="eye"
                    size={theme.components.listItem.chevronSize}
                    color={theme.colors.primary}
                  />
                </Pressable>
              </Card>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <Button
                title={t('btn_login')}
                variant="primary"
                size="lg"
                onPress={handleSubmit}
                disabled={!canSubmit}
                loading={loading}
              />

              <Text style={styles.registerText}>
                {t('login_no_account')}{' '}
                <Text
                  style={styles.registerLink}
                  onPress={() => !loading && router.push('/(auth)/register')}
                >
                  {t('register_link')}
                </Text>
              </Text>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export default LoginScreenContent;
