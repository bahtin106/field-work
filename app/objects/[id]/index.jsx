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
import TagList from '../../../components/tags/TagList';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { BaseModal } from '../../../components/ui/modals';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import { useClientObject } from '../../../src/features/objects/queries';
import { useClient } from '../../../src/features/clients/queries';
import { useEntityFieldSettings } from '../../../src/features/fieldSettings/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
  getEntityFieldMap,
} from '../../../src/features/fieldSettings/catalog';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { hasDisplayValue } from '../../../src/shared/display/value';
import { useTheme } from '../../../theme/ThemeProvider';
import { buildAddressForNavigator, openAddressInYandex } from '../../../components/ui/map';
import { buildClientObjectShortAddress } from '../../../src/features/objects/addressing';

const DEFAULT_OBJECT_INITIALS = 'OB';
const SAFE_AREA_EDGES = ['left', 'right'];

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
  const params = useLocalSearchParams();
  const id = params?.id;
  const rawReturnTo = params?.returnTo;
  const rawReturnParams = params?.returnParams;
  const objectId = Array.isArray(id) ? id[0] : id;
  const returnTo = React.useMemo(() => {
    const value = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo;
    return value ? String(value) : '/objects';
  }, [rawReturnTo]);
  const returnParams = React.useMemo(() => {
    const value = Array.isArray(rawReturnParams) ? rawReturnParams[0] : rawReturnParams;
    if (!value) return {};
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }, [rawReturnParams]);

  const canViewClients = has('canViewClients');
  const canEditClients = has('canEditClients');
  const { data: objectItem } = useClientObject(objectId, {
    enabled: !!objectId,
  });
  const { data: objectFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT, {
    enabled: !!objectId,
  });
  const { settings } = useCompanySettings();
  const objectFieldSettings = React.useMemo(
    () => objectFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.OBJECT),
    [objectFieldSettingsData],
  );
  const objectFieldsByKey = React.useMemo(() => getEntityFieldMap(objectFieldSettings), [objectFieldSettings]);

  const clientId = objectItem?.client_id;
  const { data: clientData } = useClient(clientId, { enabled: !!clientId && canViewClients });

  const [photoPreviewVisible, setPhotoPreviewVisible] = React.useState(false);
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const base = React.useMemo(() => listItemStyles(theme), [theme]);

  // Allow viewing object even if user cannot view clients. Client details (name/link)
  // will be shown only when `canViewClients` is true and `clientData` is available.

  const addressItems = [
    [t('order_field_country'), objectItem?.country],
    [t('order_field_region'), objectItem?.region],
    [t('order_field_district'), objectItem?.district],
    [t('order_field_city'), objectItem?.city],
    [t('order_field_street'), objectItem?.street],
    [t('order_field_house'), objectItem?.house],
    [t('order_field_office'), objectItem?.office],
    [t('order_field_floor'), objectItem?.floor],
    [t('order_field_entrance'), objectItem?.entrance],
    [t('order_field_apartment'), objectItem?.apartment],
    [t('order_field_postal_code'), objectItem?.postal_code],
  ]
    .filter(([label]) => {
      const keyMap = {
        [t('order_field_country')]: 'country',
        [t('order_field_region')]: 'region',
        [t('order_field_district')]: 'district',
        [t('order_field_city')]: 'city',
        [t('order_field_street')]: 'street',
        [t('order_field_house')]: 'house',
        [t('order_field_office')]: 'office',
        [t('order_field_floor')]: 'floor',
        [t('order_field_entrance')]: 'entrance',
        [t('order_field_apartment')]: 'apartment',
        [t('order_field_postal_code')]: 'postal_code',
      };
      const fieldKey = keyMap[label];
      return fieldKey ? objectFieldsByKey.get(fieldKey)?.isEnabled !== false : true;
    })
    .filter(([, value]) => String(value || '').trim().length > 0)
    .map(([label, value]) => ({ label, value: String(value || '').trim() }));
  const additionalInfoItems = [
    [t('order_field_parking_notes'), objectItem?.parking_notes],
    [t('order_field_entrance_info'), objectItem?.entrance_info],
    [t('order_field_geo_lat'), objectItem?.geo_lat],
    [t('order_field_geo_lng'), objectItem?.geo_lng],
  ]
    .filter(([label]) => {
      const keyMap = {
        [t('order_field_parking_notes')]: 'parking_notes',
        [t('order_field_entrance_info')]: 'entrance_info',
        [t('order_field_geo_lat')]: 'geo_lat',
        [t('order_field_geo_lng')]: 'geo_lng',
      };
      const fieldKey = keyMap[label];
      return fieldKey ? objectFieldsByKey.get(fieldKey)?.isEnabled !== false : true;
    })
    .filter(([, value]) => String(value || '').trim().length > 0)
    .map(([label, value]) => ({ label, value: String(value || '').trim() }));

  const navigatorAddress = buildAddressForNavigator(objectItem);
  const shortAddress = buildClientObjectShortAddress(objectItem);
  const clientDisplayName = String(clientData?.full_name || objectItem?.client_id || '').trim();
  const showObjectName = objectFieldsByKey.get('name')?.isEnabled !== false;
  const showClientRow = hasDisplayValue(clientDisplayName);

  return (
    <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
      <AppHeader
        back
        options={{
          title: t('routes_objects_object'),
          rightTextLabel: canEditClients ? t('btn_edit') : undefined,
          onRightPress: canEditClients
            ? () =>
                router.push({
                  pathname: `/objects/${objectId}/edit`,
                  params: {
                    returnTo,
                    returnParams: JSON.stringify(returnParams),
                  },
                })
            : undefined,
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

        {/* Верхнее поле под фото удалено по запросу — оставляем только аватар и остальные секции */}

        {settings?.enable_object_tags && objectItem?.tags?.length ? (
          <>
            <SectionHeader topSpacing="xs">{t('tags_field_label')}</SectionHeader>
            <Card style={{ paddingVertical: theme.spacing.md }}>
              <TagList
                tags={objectItem.tags}
                align="start"
                compact
                onPressTag={(tag) => {
                  const value = String(tag?.value || '').trim();
                  if (!value) return;
                  router.push({ pathname: '/objects', params: { tag: value } });
                }}
              />
            </Card>
          </>
        ) : null}

        <SectionHeader>{t('section_general')}</SectionHeader>
        <Card paddedXOnly>
          {showObjectName ? (
            <LabelValueRow label={t('objects_field_name')} value={objectItem?.name || ''} />
          ) : null}
          {showObjectName && showClientRow ? <View style={base.sep} /> : null}
          {showClientRow ? (
            <LabelValueRow
              label={t('routes_clients_client')}
              valueComponent={
                canViewClients && clientData?.id ? (
                  <Pressable
                    onPress={() => {
                      router.push({
                        pathname: `/clients/${clientData.id}`,
                        params: {
                          returnTo: `/objects/${objectId}`,
                          returnParams: JSON.stringify({ returnTo, returnParams: JSON.stringify(returnParams) }),
                        },
                      });
                    }}
                  >
                    <Text style={styles.clientLink}>{clientDisplayName}</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.clientLink}>{clientDisplayName}</Text>
                )
              }
            />
          ) : null}
          {showObjectName || showClientRow ? <View style={base.sep} /> : null}
          <ExpandableTextRow
            label={t('order_details_address')}
            value={objectItem?.summary || t('objects_empty')}
            collapsedValue={shortAddress || objectItem?.summary || t('objects_empty')}
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
          {/* tags moved to separate section below */}
        </Card>

        {additionalInfoItems.length ? (
          <>
            <SectionHeader>{t('objects_additional_info_section')}</SectionHeader>
            <Card paddedXOnly>
              {additionalInfoItems.map((item, index) => (
                <React.Fragment key={`${item.label}-${index}`}>
                  {index > 0 ? <View style={base.sep} /> : null}
                  <LabelValueRow label={item.label} value={item.value} />
                </React.Fragment>
              ))}
            </Card>
          </>
        ) : null}
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
    /* headerCard, headerRow, badge, badgeText, nameTitle removed — not used after UI simplification */
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
