import { useRouter, useSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/ui/Button';
import { useTheme } from '../../theme';
import { supabase } from '../../lib/supabase';
import { resetPublicAuthRoute } from '../../lib/authFlowNavigationState';
import { useToast } from '../../components/ui/ToastProvider';
import { useTranslation } from '../../src/i18n/useTranslation';

export default function VerifyEmailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useSearchParams();
  const { success: toastSuccess, error: toastError } = useToast();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('processing'); // processing | success | error
  const [errorMessage, setErrorMessage] = useState('');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.colors.background,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.lg,
        },
        content: {
          alignItems: 'center',
          gap: theme.spacing.md,
        },
        title: {
          fontSize: theme.typography.sizes.xl,
          fontWeight: theme.typography.weight.bold,
          color: theme.colors.text,
          textAlign: 'center',
        },
        message: {
          fontSize: theme.typography.sizes.md,
          color: theme.colors.textSecondary,
          textAlign: 'center',
          lineHeight: 24,
        },
        error: {
          fontSize: theme.typography.sizes.md,
          color: theme.colors.danger,
          textAlign: 'center',
          marginTop: theme.spacing.md,
        },
        buttonContainer: {
          marginTop: theme.spacing.lg,
          width: '100%',
        },
      }),
    [theme],
  );

  // Обработка волшебной ссылки из письма
  useEffect(() => {
    const handleEmailConfirmation = async () => {
      try {
        setLoading(true);
        setStatus('processing');

        // Проверяем есть ли token и type в URL
        const token = params.token;
        const type = params.type;
        const email = String(params.email || '').trim().toLowerCase();

        if (!token || type !== 'email_confirmation') {
          if (email) {
            router.replace({
              pathname: '/(auth)/register-code',
              params: { email },
            });
            return;
          }
          // Если это просто открыли экран без параметров
          setStatus('error');
          setErrorMessage(t('auth_verify_email_invalid_link'));
          setLoading(false);
          return;
        }

        // Supabase автоматически обрабатывает token через DeepLink
        // Если пользователь пришёл сюда - email уже подтверждён
        const { data: sessionData } = await supabase.auth.getSession();

        if (sessionData?.session) {
          // Сессия установлена - email подтверждён!
          setStatus('success');
          toastSuccess(t('auth_verify_email_success_toast'));

          // Переводим на экран установки пароля
          setTimeout(() => {
            router.replace('/(auth)/set-password');
          }, 2000);
        } else {
          // Нет сессии - просим создать пароль
          setStatus('success');
          router.replace('/(auth)/set-password');
        }
      } catch (e) {
        console.error('Verification error:', e);
        setStatus('error');
        setErrorMessage(e?.message || t('auth_verify_email_generic_error'));
        toastError(e?.message || t('auth_verify_email_generic_error_toast'));
        setLoading(false);
      }
    };

    handleEmailConfirmation();
  }, [params, router, toastSuccess, toastError, t]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.content}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.message}>{t('auth_verify_email_pending')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>{t('auth_verify_email_error_title')}</Text>
          <Text style={styles.error}>{errorMessage}</Text>
          <View style={styles.buttonContainer}>
            <Button
              title={t('auth_verify_email_back_to_login')}
              onPress={() => {
                resetPublicAuthRoute();
                router.replace('/(auth)/login');
              }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t('auth_verify_email_success_title')}</Text>
        <Text style={styles.message}>
          {t('auth_verify_email_success_message')}
        </Text>
        <Text style={styles.message}>{t('auth_verify_email_redirecting')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
