import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from '../../../lib/keyboardControllerCompat';
import Screen from '../../../components/layout/Screen';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import { ADMIN_PAGE_SIZE } from '../../../constants/admin';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { formatPersonName } from '../../../lib/personName';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { hasDisplayValue } from '../../../src/shared/display/value';
import { TEXT_INPUT_LIMITS } from '../../../src/shared/input/limits';
import { useTheme } from '../../../theme/ThemeProvider';

async function fetchUsers(search) {
  const { data, error } = await supabase.rpc('admin_list_users', {
    p_search: search || null,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: 0,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export default function AdminUsersScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const router = useRouter();
  const { isAllowed, isLoading: guardLoading } = useRequireSuperAdmin();
  const [search, setSearch] = React.useState('');

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/users') });
  }, [nav, t]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adminUsers', search],
    queryFn: () => fetchUsers(search.trim()),
    enabled: isAllowed,
    staleTime: 30 * 1000,
  });

  if (guardLoading || !isAllowed) {
    return <Screen background="background" />;
  }

  return (
    <Screen background="background" scroll={false}>
      <KeyboardAwareScrollView contentContainerStyle={styles(theme).content}>
        <Card style={styles(theme).card}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('admin_users_search_placeholder')}
            placeholderTextColor={theme.colors.textSecondary}
            style={styles(theme).input}
            maxLength={TEXT_INPUT_LIMITS.search}
          />
        </Card>

        {isLoading ? <Text style={styles(theme).muted}>{t('admin_loading')}</Text> : null}
        {error ? (
          <Card style={styles(theme).card}>
            <Text style={styles(theme).title}>{t('admin_error_title')}</Text>
            <Text style={styles(theme).muted}>{String(error?.message || t('admin_unknown_error'))}</Text>
            <Button
              title={t('btn_retry')}
              size="sm"
              onPress={() => refetch()}
              containerStyle={styles(theme).retryButtonContainer}
            />
          </Card>
        ) : null}

        {!isLoading && !error && (!data || data.length === 0) ? (
          <Text style={styles(theme).muted}>{t('admin_users_empty')}</Text>
        ) : null}

        {data?.map((row) => (
          <Card key={row.profile_id} style={styles(theme).card} padded={false}>
            <Pressable style={styles(theme).row} onPress={() => router.push(`/users/${row.profile_id}`)}>
              <View style={styles(theme).rowLeft}>
                <Text style={styles(theme).name}>{formatPersonName(row, row.email || row.profile_id)}</Text>
                {hasDisplayValue(row.email) ? (
                  <Text style={styles(theme).meta}>{row.email}</Text>
                ) : null}
                {hasDisplayValue(row.role) ? (
                  <Text style={styles(theme).meta}>
                    {t('label_role')}: {row.role}
                  </Text>
                ) : null}
                {hasDisplayValue(row.company_name || row.company_id) ? (
                  <Text style={styles(theme).meta}>
                    {t('admin_users_company')}: {row.company_name || row.company_id}
                  </Text>
                ) : null}
              </View>
              <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
            </Pressable>
          </Card>
        ))}
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const styles = (theme) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: theme.components.screenLayout.contentPaddingX,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.components.screenLayout.contentPaddingBottom,
      gap: theme.spacing.md,
    },
    card: {
      borderRadius: theme.components.card.radius,
      borderWidth: theme.components.card.borderWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    input: {
      minHeight: theme.components.row.minHeight,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
    },
    muted: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    retryButtonContainer: {
      marginTop: theme.spacing.sm,
      alignSelf: 'flex-start',
    },
    row: {
      minHeight: theme.components.row.minHeight + theme.spacing.lg,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    rowLeft: {
      flex: 1,
      gap: theme.spacing.xs,
      paddingRight: theme.spacing.sm,
    },
    name: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weight.semibold,
    },
    meta: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
  });
