import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Screen from '../../../components/layout/Screen';
import Card from '../../../components/ui/Card';
import { ADMIN_PAGE_SIZE } from '../../../constants/admin';
import { useRequireSuperAdmin } from '../../../hooks/useRequireSuperAdmin';
import { supabase } from '../../../lib/supabase';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';

async function fetchCompanies(search) {
  const { data, error } = await supabase.rpc('admin_list_companies', {
    p_search: search || null,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: 0,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export default function AdminCompaniesScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation();
  const router = useRouter();
  const { isAllowed, isLoading: guardLoading } = useRequireSuperAdmin();
  const [search, setSearch] = React.useState('');

  React.useLayoutEffect(() => {
    nav.setParams({ headerTitle: t('routes.admin/companies') });
  }, [nav, t]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['adminCompanies', search],
    queryFn: () => fetchCompanies(search.trim()),
    enabled: isAllowed,
    staleTime: 30 * 1000,
  });

  if (guardLoading || !isAllowed) {
    return <Screen background="background" />;
  }

  return (
    <Screen background="background">
      <ScrollView contentContainerStyle={styles(theme).content}>
        <Card style={styles(theme).card}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('admin_companies_search_placeholder')}
            placeholderTextColor={theme.colors.textSecondary}
            style={styles(theme).input}
          />
        </Card>

        {isLoading ? <Text style={styles(theme).muted}>{t('admin_loading')}</Text> : null}
        {error ? (
          <Card style={styles(theme).card}>
            <Text style={styles(theme).title}>{t('admin_error_title')}</Text>
            <Text style={styles(theme).muted}>{String(error?.message || t('admin_unknown_error'))}</Text>
            <Pressable onPress={() => refetch()} style={styles(theme).retryBtn}>
              <Text style={styles(theme).retryText}>{t('btn_retry')}</Text>
            </Pressable>
          </Card>
        ) : null}

        {!isLoading && !error && (!data || data.length === 0) ? (
          <Text style={styles(theme).muted}>{t('admin_companies_empty')}</Text>
        ) : null}

        {data?.map((row) => (
          <Card key={row.company_id} style={styles(theme).card} padded={false}>
            <Pressable
              style={styles(theme).row}
              onPress={() =>
                router.push({
                  pathname: '/admin/companies/details',
                  params: { companyId: row.company_id },
                })
              }
            >
              <View style={styles(theme).rowLeft}>
                <Text style={styles(theme).name}>{row.name || row.company_id}</Text>
                <Text style={styles(theme).meta}>
                  {t('admin_companies_employees')}: {row.employees_count ?? 0}
                </Text>
                <Text style={styles(theme).meta}>
                  {t('admin_companies_plan')}: {row.plan_code || t('common_dash')}
                </Text>
                <Text style={styles(theme).meta}>
                  {t('label_status')}: {row.subscription_status || t('common_dash')}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
            </Pressable>
          </Card>
        ))}
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
    retryBtn: {
      marginTop: theme.spacing.sm,
      alignSelf: 'flex-start',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.radii.sm,
      backgroundColor: theme.colors.primary,
    },
    retryText: {
      color: theme.colors.onPrimary,
      fontWeight: theme.typography.weight.medium,
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
