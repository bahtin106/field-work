import { useRouter, useSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/ui/Button';
import { useTheme } from '../../theme';
import { useTranslation } from '../../src/i18n/useTranslation';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/ui/ToastProvider';

export default function VerifyEmailScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const { success: toastSuccess, error: toastError } = useToast();

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

        if (!token || type !== 'email_confirmation') {
          // Если это просто открыли экран без параметров
          setStatus('error');
          setErrorMessage('Некорректная ссылка подтверждения');
          setLoading(false);
          return;
        }

        // Supabase автоматически обрабатывает token через DeepLink
        // Если пользователь пришёл сюда - email уже подтверждён
        const { data: sessionData } = await supabase.auth.getSession();

        if (sessionData?.session) {
          // Сессия установлена - email подтверждён!
          setStatus('success');
          toastSuccess('Email подтвержден! Теперь создайте пароль.');

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
        setErrorMessage(e?.message || 'Ошибка при подтверждении email');
        toastError(e?.message || 'Ошибка при подтверждении');
        setLoading(false);
      }
    };

    handleEmailConfirmation();
  }, [params, router, toastSuccess, toastError]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.content}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.message}>Подтверждение email...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Ошибка подтверждения</Text>
          <Text style={styles.error}>{errorMessage}</Text>
          <View style={styles.buttonContainer}>
            <Button title="Вернуться" onPress={() => router.replace('/(auth)/login')} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Email подтвержден!</Text>
        <Text style={styles.message}>
          Спасибо за подтверждение вашего адреса электронной почты.
        </Text>
        <Text style={styles.message}>Перенаправляем вас...</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
