// app/(auth)/login.jsx
import { useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { t as T } from '../../src/i18n';
import { useTheme } from '../../theme';

import { Feather } from '@expo/vector-icons';
import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';
import { listItemStyles } from '../../components/ui/listItemStyles';

export default function LoginScreen() {
  const { theme } = useTheme();
  const ls = listItemStyles(theme);

  const isDark = theme?.mode === 'dark';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          paddingHorizontal: theme?.spacing?.xl ?? 32,
          justifyContent: 'center',
          backgroundColor: 'transparent',
        },
        centerBlock: {
          justifyContent: 'center',
          alignItems: 'stretch',
          gap: theme?.spacing?.md ?? 12,
          paddingBottom: theme?.spacing?.xl ?? 40,
        },
        title: {
          textAlign: 'center',
          color: theme?.colors?.text,
          fontSize: theme?.typography?.sizes?.xxl ?? 32,
          fontWeight: theme?.typography?.weight?.bold ?? '700',
          letterSpacing: 0.3,
          textTransform: 'capitalize',
          marginBottom: theme?.spacing?.xs,
        },
        subtitle: {
          textAlign: 'center',
          color: theme?.colors?.textSecondary ?? theme?.colors?.text,
          fontSize: theme?.typography?.sizes?.sm ?? 14,
          marginBottom: theme?.spacing?.xl ?? 24,
        },
        passwordWrapper: {
          position: 'relative',
        },
        eyeToggle: {
          position: 'absolute',
          right: theme?.spacing?.sm ?? 14,
          top: 0,
          bottom: 0,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: theme?.spacing?.sm ?? 12,
          paddingVertical: theme?.spacing?.xs ?? 8,
          borderRadius: theme?.radii?.md ?? 8,
        },
        error: {
          color: theme?.colors?.danger ?? theme?.colors?.primary,
          textAlign: 'center',
          marginTop: -4,
          marginBottom: theme?.spacing?.sm ?? 14,
          fontSize: theme?.typography?.sizes?.sm ?? 14,
          fontWeight: theme?.typography?.weight?.medium ?? '500',
        },
      }),
    [theme],
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const passwordRef = useRef(null);

  const handleLogin = async () => {
    if (!email || !password || loading) return;
    setLoading(true);
    setError('');

    let isMounted = true;
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });

      if (authErr) {
        setError(T('errors_invalid_credentials', 'Неверный e-mail или пароль'));
        setLoading(false);
        return;
      }

      // Успех! Явно переходим на главный экран, чтобы не ждать только глобального события
      try {
        const { router } = await import('expo-router');
        router.replace('/orders');
      } catch (e) {
        // fallback: ничего не делаем, глобальный обработчик сработает
      }
      if (isMounted) setLoading(false);
    } catch (e) {
      setError(T('errors_auth_error', 'Ошибка авторизации'));
      setLoading(false);
    }
    return () => {
      isMounted = false;
    };
  };

  const isDisabled = !email || !password || loading;

  return (
    <Screen background="background" edges={['top', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={{ flex: 1 }}>
            <View style={styles.container}>
              <View style={styles.centerBlock}>
                <Text style={styles.title}>{T('login_title', 'Вход в систему')}</Text>
                <Text style={styles.subtitle}>
                  {T('login_subtitle', 'Введите ваши учётные данные')}
                </Text>

                <TextField
                  value={email}
                  onChangeText={setEmail}
                  placeholder={T('fields_email', 'E-mail')}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
                <View style={ls.sep} />

                <View style={styles.passwordWrapper}>
                  <TextField
                    ref={passwordRef}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={T('fields_password', 'Пароль')}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password"
                    textContentType="password"
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                  <View style={ls.sep} />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    style={styles.eyeToggle}
                    android_ripple={{
                      color: theme?.colors?.border ?? '#00000020',
                      borderless: false,
                      radius: 24,
                    }}
                    accessibilityLabel={
                      showPassword
                        ? T('auth_hide_password', 'Скрыть пароль')
                        : T('auth_show_password', 'Показать пароль')
                    }
                    accessibilityRole="button"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={theme?.components?.listItem?.chevronSize ?? 20}
                      color={theme?.colors?.primary ?? theme?.colors?.text}
                    />
                  </Pressable>
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <View style={{ opacity: isDisabled ? 0.5 : 1 }}>
                  <Button
                    title={T('btn_login', 'btn_login')}
                    variant="primary"
                    size="lg"
                    onPress={handleLogin}
                    disabled={isDisabled}
                    loading={loading}
                  />
                </View>
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Screen>
  );
}
