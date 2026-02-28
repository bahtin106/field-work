import React from 'react';
import { Image as ExpoImage } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AppHeader from '../../../components/navigation/AppHeader';
import Card from '../../../components/ui/Card';
import ExpandableTextRow from '../../../components/ui/ExpandableTextRow';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import { BaseModal } from '../../../components/ui/modals';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import { useClientObject } from '../../../src/features/objects/queries';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { useTheme } from '../../../theme/ThemeProvider';
import { buildAddressForNavigator, openAddressInYandex } from '../../../components/ui/map';

const DEFAULT_OBJECT_INITIALS = 'OB';

function withAlpha(color, alpha) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const hexAlpha = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + hexAlpha;
    }
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;
  }
  return `rgba(0,0,0,${alpha})`;
}

function getObjectInitials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')
    .toUpperCase() || DEFAULT_OBJECT_INITIALS;
}

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

  const [photoPreviewVisible, setPhotoPreviewVisible] = React.useState(false);
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
        <View style={styles.avatarWrap}>
          <Pressable
            style={styles.avatarBox}
            onPress={() => {
              if (!objectItem?.photoUrl) return;
              setPhotoPreviewVisible(true);
            }}
            disabled={!objectItem?.photoUrl}
          >
            {objectItem?.photoDisplayUrl || objectItem?.photoUrl ? (
              <ExpoImage
                source={{ uri: objectItem?.photoDisplayUrl || objectItem?.photoUrl }}
                style={styles.avatarImg}
                contentFit="cover"
                cachePolicy="none"
              />
            ) : (
              <Text style={styles.avatarText}>{getObjectInitials(objectItem?.name)}</Text>
            )}
          </Pressable>
        </View>

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
            <Text style={styles.clientLink}>{objectItem?.client?.full_name || t('common_dash')}</Text>
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

      <BaseModal
        visible={photoPreviewVisible}
        onClose={() => setPhotoPreviewVisible(false)}
        title={t('objects_photo_title')}
        maxHeightRatio={0.9}
      >
        <View style={styles.previewWrap}>
          {objectItem?.photoDisplayUrl || objectItem?.photoUrl ? (
            <ExpoImage
              source={{ uri: objectItem?.photoDisplayUrl || objectItem?.photoUrl }}
              style={styles.previewImg}
              contentFit="contain"
              cachePolicy="none"
            />
          ) : (
            <Text style={styles.previewEmpty}>{t('placeholder_no_photo')}</Text>
          )}
        </View>
      </BaseModal>
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
    avatarWrap: {
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    avatarBox: {
      width: theme.components?.avatar?.xl ?? 96,
      height: theme.components?.avatar?.xl ?? 96,
      borderRadius: (theme.components?.avatar?.xl ?? 96) / 2,
      backgroundColor: withAlpha(theme.colors.primary, 0.12),
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: theme.components.card.borderWidth,
      borderColor: withAlpha(theme.colors.primary, 0.24),
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    avatarText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.xl ?? 24,
      fontWeight: theme.typography.weight.bold ?? '700',
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
    previewWrap: {
      alignItems: 'center',
      padding: theme.spacing.md,
    },
    previewImg: {
      width: '100%',
      height: undefined,
      aspectRatio: 1,
      borderRadius: theme.radii.lg,
    },
    previewEmpty: {
      color: theme.colors.textSecondary,
    },
  });
}
