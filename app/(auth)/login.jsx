// app/(auth)/login.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import logger from '../../lib/logger';
import { supabase } from '../../lib/supabase';
import { t as T } from '../../src/i18n';
import { useTheme } from '../../theme';

import { Feather } from '@expo/vector-icons';
import Screen from '../../components/layout/Screen';
import Button from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';
import { listItemStyles } from '../../components/ui/listItemStyles';

import { useRootNavigationState, useRouter } from 'expo-router';

export default function LoginScreen() {
  const { theme } = useTheme();
  const ls = listItemStyles(theme);
  const isDark = theme?.mode === 'dark';
  const router = useRouter();
  const navigationState = useRootNavigationState();

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
  const mountedRef = useRef(true);
  const loadingTimeoutRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  // Ensure we have a session token before first DB queries
  async function waitForSession({ tries = 15, delay = 120 } = {}) {
    // Wait for an authoritative user object via getUser() instead of trusting session storage alone
    for (let i = 0; i < tries; i++) {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user ?? null;
        if (user) return user;
      } catch (e) {
        // ignore transient errors
      }
      await new Promise((r) => setTimeout(r, delay));
    }
    return null;
  }

  const handleLogin = async () => {
    if (!email || !password || loading) return;
    setLoading(true);
    setError('');
    logger.warn('🔐 Login attempt started');

    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
      if (authErr) {
        logger.warn('❌ signInWithPassword error:', authErr.message);
        setError(T('errors.invalid_credentials', 'errors.invalid_credentials'));
        setLoading(false);
        return;
      }

      logger.warn('✅ signInWithPassword success, waiting for user validation...');

      // Wait for getUser() to return an authoritative user object
      const user = await waitForSession({ tries: 25, delay: 200 });
      if (!user) {
        logger.warn('⚠️ waitForSession returned no user, checking fallback session...');
        const {
          data: { session: fallbackSession },
        } = await supabase.auth.getSession();
        if (!fallbackSession?.access_token) {
          logger.warn('❌ No session after login - timeout');
          setError(T('errors.auth_timeout', 'Timeout waiting for session'));
          setLoading(false);
          return;
        }
        logger.warn('✅ Found fallback session, proceeding...');
      } else {
        logger.warn('✅ User validated:', user.id);
      }

      logger.warn('🎯 Login successful, notifying auth state and navigating...');

      // Notify global auth state listeners (including _layout.js)
      try {
        const { notifyAuthSuccess } = await import('../../lib/authState');
        notifyAuthSuccess(user || { validated: true });
        logger.warn('✅ Auth state notification sent');
      } catch (e) {
        logger.warn('⚠️ Failed to notify auth state:', e?.message);
      }

      // Immediately clear loading
      setLoading(false); // Wait for navigation to be ready, then force navigation with retries
      const waitForNavReady = async () => {
        for (let i = 0; i < 20; i++) {
          if (navigationState?.key) {
            logger.warn('✅ Navigation state ready');
            return true;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        logger.warn('⚠️ Navigation state not ready after 1s');
        return false;
      };

      await waitForNavReady();

      // Force immediate navigation with multiple attempts
      let navigationSuccess = false;
      for (let attempt = 0; attempt < 3 && !navigationSuccess; attempt++) {
        try {
          logger.warn(`🚀 Navigation attempt ${attempt + 1}...`);
          router.replace('/orders');
          navigationSuccess = true;
          logger.warn('✅ Navigation executed successfully');
        } catch (navErr) {
          logger.warn(`⚠️ Navigation attempt ${attempt + 1} failed:`, navErr?.message);
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      }

      if (!navigationSuccess) {
        logger.warn('❌ All navigation attempts failed - will rely on _layout fallback');
      }
    } catch (e) {
      logger.warn('❌ Login error:', e?.message || e);
      setError(T('errors.auth_error', 'Authentication error'));
      setLoading(false);
    }
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
                    accessibilityLabel={
                      showPassword
                        ? T('auth.hide_password', 'auth.hide_password')
                        : T('auth.show_password', 'auth.show_password')
                    }
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
