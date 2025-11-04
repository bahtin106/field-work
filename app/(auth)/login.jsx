// app/(auth)/login.jsx
import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  StatusBar,
  Pressable,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme';
import { t as T } from '../../src/i18n';

import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';
import { listItemStyles } from '../../components/ui/listItemStyles';
import { Feather } from '@expo/vector-icons';

import { useRouter } from 'expo-router';

export default function LoginScreen() {
  const { theme } = useTheme();
  const ls = listItemStyles(theme);
  const isDark = theme?.mode === 'dark';
  const router = useRouter();

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
          paddingHorizontal: theme?.spacing?.xs ?? 6,
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

  // Ensure we have a session token before first DB queries
  async function waitForSession({ tries = 15, delay = 120 } = {}) {
    for (let i = 0; i < tries; i++) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) return session;
      await new Promise(r => setTimeout(r, delay));
    }
    return null;
  }

  const handleLogin = async () => {
    if (!email || !password || loading) return;
    setLoading(true);
    setError('');

    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) {
      setLoading(false);
      setError(T('errors.invalid_credentials', 'errors.invalid_credentials'));
      return;
    }

    await waitForSession();
    setLoading(false);
    router.replace('/orders/index');
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
                <Text style={styles.title}>{T('login.title', 'login.title')}</Text>
                <Text style={styles.subtitle}>{T('login.subtitle', 'login.subtitle')}</Text>

                <TextField
                  value={email}
                  onChangeText={setEmail}
                  placeholder={T('fields.email', 'fields.email')}
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
                    placeholder={T('fields.password', 'fields.password')}
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                  <View style={ls.sep} />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    style={styles.eyeToggle}
                    accessibilityLabel={showPassword ? T('auth.hide_password', 'auth.hide_password') : T('auth.show_password', 'auth.show_password')}
                  >
                    <Feather
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={theme?.components?.listItem?.chevronSize}
                      color={theme?.colors?.textSecondary ?? theme?.colors?.text}
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
