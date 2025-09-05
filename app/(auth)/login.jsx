// app/(auth)/login.jsx
import { router } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  StatusBar,
  Alert,
  Pressable,
} from 'react-native';
import { AntDesign } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/ThemeProvider';

import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';

export default function LoginScreen() {
  const { theme } = useTheme();
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
          fontSize: 32,
          fontWeight: '700',
          letterSpacing: 0.3,
          textTransform: 'capitalize',
          marginBottom: 6,
        },
        subtitle: {
          textAlign: 'center',
          color: theme?.colors?.textSecondary ?? theme?.colors?.text,
          fontSize: 14,
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
          fontSize: 14,
          fontWeight: '500',
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

    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) {
      setLoading(false);
      setError('Неверный логин или пароль');
      return;
    }

    const { data: sessData } = await supabase.auth.getSession();
    const uid = sessData?.session?.user?.id || null;

    const { error: pErr } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', uid)
      .single();
    if (pErr) {
      setLoading(false);
      Alert.alert('Ошибка доступа', `[profiles] ${pErr.code || ''} ${pErr.message}`);
      return;
    }

    const { error: s1 } = await supabase.from('app_settings_versions').select('id').limit(1);
    if (s1) {
      setLoading(false);
      Alert.alert('Ошибка доступа', `[app_settings_versions] ${s1.code || ''} ${s1.message}`);
      return;
    }

    const { error: s2 } = await supabase.from('app_form_fields').select('id').limit(1);
    if (s2) {
      setLoading(false);
      Alert.alert('Ошибка доступа', `[app_form_fields] ${s2.code || ''} ${s2.message}`);
      return;
    }

    setLoading(false);
    router.replace('/orders');
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
                <Text style={styles.title}>Монитор</Text>
                <Text style={styles.subtitle}>Контроль выездных задач и заявок</Text>

                <TextField
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Электронная почта"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />

                <View style={styles.passwordWrapper}>
                  <TextField
                    ref={passwordRef}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Пароль"
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    style={styles.eyeToggle}
                    accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    <AntDesign
                      name={showPassword ? 'eye' : 'eyeo'}
                      size={20}
                      color={theme?.colors?.textSecondary ?? theme?.colors?.text}
                    />
                  </Pressable>
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <View style={{ opacity: isDisabled ? 0.5 : 1 }}>
                  <Button
                    variant="primary"
                    size="lg"
                    onPress={handleLogin}
                    disabled={isDisabled}
                    loading={loading}
                    title="Войти"
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
