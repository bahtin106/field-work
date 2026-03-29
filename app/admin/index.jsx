import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/layout/Screen';
import Card from '../../components/ui/Card';
import { useRequireSuperAdmin } from '../../hooks/useRequireSuperAdmin';
import {
  countUnreadSupportRequests,
  SUPPORT_UNREAD_REFETCH_MS,
  SUPPORT_UNREAD_QUERY_KEY,
} from '../../src/features/supportRequests/api';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';

export default function AdminHomeScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const router = useRouter();
  const { isAllowed, isLoading } = useRequireSuperAdmin();
  const queryClient = useQueryClient();
  const { data: unreadCount = 0 } = useQuery({
    queryKey: SUPPORT_UNREAD_QUERY_KEY,
    queryFn: countUnreadSupportRequests,
    enabled: isAllowed,
    staleTime: 10 * 1000,
    refetchInterval: SUPPORT_UNREAD_REFETCH_MS,
  });

  React.useEffect(() => {
    if (!isAllowed) return undefined;
    const channel = supabase
      .channel('admin-feedbacks-unread-counter')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, () => {
        queryClient.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAllowed, queryClient]);

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
    {
      key: 'feedbacks',
      icon: 'message-circle',
      title: t('admin_menu_feedbacks'),
      onPress: () => router.push('/admin/feedbacks'),
      badgeCount: unreadCount,
    },
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
                <View style={styles(theme).rowRight}>
                  {item.badgeCount > 0 ? (
                    <View style={styles(theme).badge}>
                      <Text style={styles(theme).badgeText}>
                        {item.badgeCount > 99 ? '99+' : String(item.badgeCount)}
                      </Text>
                    </View>
                  ) : null}
                  <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
                </View>
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
    rowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    badge: {
      borderRadius: theme.radii.pill || 999,
      minWidth: 22,
      paddingHorizontal: theme.spacing.xs,
      paddingVertical: 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
    },
    badgeText: {
      color: theme.colors.onPrimary,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.semibold,
    },
  });
