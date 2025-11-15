import { Feather } from '@expo/vector-icons';
import { memo, useCallback, useMemo, useState } from 'react';
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
import { listItemStyles } from '../../components/ui/listItemStyles';
import { useAuthLogin } from '../../hooks/useAuthLogin';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme';

const createStyles = (theme) =>
  StyleSheet.create({
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
    passwordContainer: {
      position: 'relative',
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
      marginTop: -4,
      marginBottom: theme.spacing.sm,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
  });

function LoginScreenContent() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const ls = listItemStyles(theme);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { email, setEmail, password, setPassword, error, loading, canSubmit, handleLogin } =
    useAuthLogin();

  const [showPassword, setShowPassword] = useState(false);

  const handleTogglePassword = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  return (
    <Screen background="background" edges={['top', 'bottom', 'left', 'right']}>
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
              <View style={ls.sep} />

              <View style={styles.passwordContainer}>
                <TextField
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('fields_password')}
                  secureTextEntry={!showPassword}
                  keyboardType="visible-password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  textContentType="password"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  accessibilityLabel={t('fields_password')}
                  editable={!loading}
                />
                <View style={ls.sep} />
                <Pressable
                  onPress={handleTogglePassword}
                  style={styles.eyeButton}
                  android_ripple={{
                    color: theme.colors.border,
                    borderless: false,
                    radius: 24,
                  }}
                  accessibilityLabel={
                    showPassword ? t('auth_hide_password') : t('auth_show_password')
                  }
                  accessibilityRole="button"
                  hitSlop={theme.interactive?.hitSlop || { top: 8, bottom: 8, left: 8, right: 8 }}
                  disabled={loading}
                >
                  <Feather
                    name={showPassword ? 'eye-off' : 'eye'}
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
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export default memo(LoginScreenContent);
