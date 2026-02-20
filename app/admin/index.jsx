import { Feather } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/layout/Screen';
import Card from '../../components/ui/Card';
import { useRequireSuperAdmin } from '../../hooks/useRequireSuperAdmin';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

export default function AdminHomeScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const router = useRouter();
  const { isAllowed, isLoading } = useRequireSuperAdmin();

  React.useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      if (typeof nav?.setParams !== 'function') return;
      if (typeof nav?.isFocused === 'function' && !nav.isFocused()) return;
      try {
        nav.setParams({ headerTitle: t('routes.admin/index') || t('routes.admin') });
      } catch {}
    });
    return () => cancelAnimationFrame(rafId);
  }, [nav, t]);

  if (isLoading || !isAllowed) {
    return <Screen background="background" />;
  }

  const items = [
    { key: 'users', icon: 'users', title: t('admin_menu_users'), onPress: () => router.push('/admin/users') },
    { key: 'companies', icon: 'briefcase', title: t('admin_menu_companies'), onPress: () => router.push('/admin/companies') },
    { key: 'storage', icon: 'hard-drive', title: t('admin_menu_storage'), onPress: () => router.push('/admin/storage') },
    { key: 'server', icon: 'server', title: t('admin_menu_server'), onPress: () => router.push('/admin/server') },
  ];

  return (
    <Screen background="background">
      <ScrollView contentContainerStyle={styles(theme).content}>
        <Card style={styles(theme).card} padded={false}>
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <Pressable
                key={item.key}
                style={({ pressed }) => [styles(theme).row, !isLast && styles(theme).rowBorder, pressed && { opacity: 0.9 }]}
                onPress={item.onPress}
              >
                <View style={styles(theme).rowLeft}>
                  <Feather name={item.icon} size={18} color={theme.colors.text} />
                  <Text style={styles(theme).rowLabel}>{item.title}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            );
          })}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    card: {
      borderRadius: theme.radii.md,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    row: {
      minHeight: theme.components.row.minHeight,
      paddingHorizontal: theme.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowBorder: {
      borderBottomWidth: theme.components.listItem.dividerWidth,
      borderBottomColor: theme.colors.border,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    rowLabel: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.medium,
    },
  });
