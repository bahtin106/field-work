import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AppHeader from '../../../components/navigation/AppHeader';
import Card from '../../../components/ui/Card';
import ExpandableTextRow from '../../../components/ui/ExpandableTextRow';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import { useClientObject } from '../../../src/features/objects/queries';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import { buildAddressForNavigator, openAddressInYandex } from '../../../components/ui/map';

export default function ObjectViewScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { has } = usePermissions();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams();
  const objectId = Array.isArray(id) ? id[0] : id;

  const canViewClients = has('canViewClients');
  const canEditClients = has('canEditClients');
  const { data: objectItem } = useClientObject(objectId, {
    enabled: !!objectId && canViewClients,
  });

  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const base = React.useMemo(() => listItemStyles(theme), [theme]);

  if (!canViewClients) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader back options={{ title: t('routes_objects_object') }} />
        <View style={styles.centered}>
          <Text style={styles.mutedText}>{t('clients_no_view_permission')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const addressItems = [
    [t('order_field_country'), objectItem?.country],
    [t('order_field_region'), objectItem?.region],
    [t('order_field_city'), objectItem?.city],
    [t('order_field_street'), objectItem?.street],
    [t('order_field_house'), objectItem?.house],
    [t('order_field_building'), objectItem?.building],
    [t('order_field_floor'), objectItem?.floor],
    [t('order_field_entrance'), objectItem?.entrance],
    [t('order_field_apartment'), objectItem?.apartment],
    [t('order_field_intercom'), objectItem?.intercom],
    [t('order_field_postal_code'), objectItem?.postal_code],
    [t('order_field_entrance_info'), objectItem?.entrance_info],
    [t('order_field_parking_notes'), objectItem?.parking_notes],
    [t('order_field_geo_lat'), objectItem?.geo_lat],
    [t('order_field_geo_lng'), objectItem?.geo_lng],
  ]
    .filter(([, value]) => String(value || '').trim().length > 0)
    .map(([label, value]) => ({ label, value: String(value || '').trim() }));

  const navigatorAddress = buildAddressForNavigator(objectItem);

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader
        back
        options={{
          title: t('routes_objects_object'),
          rightTextLabel: canEditClients ? t('btn_edit') : undefined,
          onRightPress: canEditClients ? () => router.push(`/objects/${objectId}/edit`) : undefined,
        }}
      />

      <ScrollView contentContainerStyle={styles.contentWrap}>
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{t('routes_objects_object')}</Text>
            </View>
            <Text style={styles.nameTitle}>{objectItem?.name || t('common_dash')}</Text>
          </View>
          <Pressable
            onPress={() => {
              if (!objectItem?.client?.id) return;
              router.push(`/clients/${objectItem.client.id}`);
            }}
          >
            <Text style={styles.clientLink}>
              {objectItem?.client?.full_name || t('common_dash')}
            </Text>
          </Pressable>
        </Card>

        <SectionHeader>{t('section_personal')}</SectionHeader>
        <Card paddedXOnly>
          <LabelValueRow label={t('objects_field_name')} value={objectItem?.name || t('common_dash')} />
          <View style={base.sep} />
          <LabelValueRow
            label={t('routes_clients_client')}
            value={objectItem?.client?.full_name || t('common_dash')}
          />
        </Card>

        <SectionHeader>{t('objects_address_section')}</SectionHeader>
        <Card paddedXOnly>
          <ExpandableTextRow
            label={t('order_details_address')}
            value={objectItem?.summary || t('objects_empty')}
            collapsedValue={objectItem?.summary || t('objects_empty')}
            expandedKeyValueItems={addressItems}
            expandedLabelBold
            onValuePress={() => {
              if (!navigatorAddress) {
                toast.warning(t('order_details_address_not_specified'));
                return;
              }
              openAddressInYandex(navigatorAddress);
            }}
            collapsedValueStyle={navigatorAddress ? styles.clientLink : null}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contentWrap: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.components?.scrollView?.paddingBottom ?? theme.spacing.xl,
    },
    mutedText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
    headerCard: {
      marginBottom: theme.spacing.md,
    },
    headerRow: {
      gap: theme.spacing.sm,
    },
    badge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radii.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    badgeText: {
      color: theme.colors.primaryTextOn,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.semibold,
    },
    nameTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.semibold,
    },
    clientLink: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      marginTop: theme.spacing.xs,
    },
  });
}

