import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
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
import TextField from '../../components/ui/TextField';
import { useAuthLogin } from '../../hooks/useAuthLogin';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

const createStyles = (theme) => {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      paddingHorizontal: theme.spacing.xl,
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
    passwordContainer: { position: 'relative' },
    separator: {
      height: theme.components?.listItem?.dividerWidth ?? 1,
      backgroundColor: theme.colors.border,
      marginLeft: theme.spacing.xs,
      marginRight: theme.spacing.xs,
    },
    eyeButton: {
      position: 'absolute',
      right: theme.spacing.sm,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    errorText: {
      color: theme.colors.danger,
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
      marginTop: theme.spacing.xs,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    registerButton: {
      marginTop: theme.spacing.md,
    },
    registerText: {
      textAlign: 'center',
      marginTop: theme.spacing.lg,
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

  const { email, setEmail, password, setPassword, error, loading, canSubmit, handleLogin } =
    useAuthLogin();

  const passwordFieldRef = useRef(null);

  const handleTogglePassword = useCallback(() => {
    passwordFieldRef.current?.togglePasswordVisibility();
  }, []);

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

              <TextField
                value={email}
                onChangeText={setEmail}
                placeholder={t('fields_email')}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
                accessibilityLabel={t('fields_email')}
                editable={!loading}
              />
              <View style={styles.separator} />

              <View style={styles.passwordContainer}>
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
                  onSubmitEditing={handleLogin}
                  accessibilityLabel={t('fields_password')}
                  editable={!loading}
                />
                <View style={styles.separator} />
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
              </View>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <Button
                title={t('btn_login')}
                variant="primary"
                size="lg"
                onPress={handleLogin}
                disabled={!canSubmit}
                loading={loading}
              />

              <Text style={styles.registerText}>
                {t('register_back_to_login').split('?')[0]}?{' '}
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
