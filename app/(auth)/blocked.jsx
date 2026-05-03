import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Screen from '../../components/layout/Screen';
import Card from '../../components/ui/Card';
import { useAuthContext } from '../../providers/SimpleAuthProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';

export default function AuthBlockedScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { signOut } = useAuthContext();
  const code = String(params?.code || '').trim().toLowerCase();
  const rawMessage = String(params?.message || '').trim();
  const messageFromParams = (() => {
    if (!rawMessage) return '';
    try {
      return decodeURIComponent(rawMessage);
    } catch {
      return rawMessage;
    }
  })();

  const resolvedMessage = (() => {
    if (messageFromParams) return messageFromParams;
    if (code === 'blocked_by_license') return t('auth_blocked_by_license');
    if (code === 'company_inactive') return t('auth_company_inactive');
    if (code === 'admin_blocked') return t('auth_blocked_subtitle');
    if (code === 'access_blocked') return t('auth_access_blocked');
    return `${t('auth_access_blocked')}. ${t('auth_blocked_subtitle')}`;
  })();

  return (
    <Screen background="background">
      <View style={styles(theme).wrap}>
        <Card>
          <View style={styles(theme).content}>
            <Text style={styles(theme).title}>{t('auth_blocked_title')}</Text>
            <Text style={styles(theme).message}>{resolvedMessage}</Text>
            <Pressable
              style={({ pressed }) => [styles(theme).button, pressed ? { opacity: 0.85 } : null]}
              onPress={async () => {
                try {
                  await signOut();
                } catch {}
                router.replace('/(auth)/login');
              }}
            >
              <Text style={styles(theme).buttonText}>{t('btn_ok')}</Text>
            </Pressable>
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      justifyContent: 'center',
      padding: theme.spacing.lg,
    },
    content: {
      gap: theme.spacing.md,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: '700',
    },
    message: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.md,
      lineHeight: Math.round(theme.typography.sizes.md * 1.35),
    },
    button: {
      marginTop: theme.spacing.sm,
      backgroundColor: theme.colors.primary,
      borderRadius: 12,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: {
      color: theme.colors.primaryTextOn,
      fontWeight: '700',
    },
  });
