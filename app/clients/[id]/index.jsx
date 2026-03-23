import React from 'react';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppHeader from '../../../components/navigation/AppHeader';
import Card from '../../../components/ui/Card';
import LabelValueRow from '../../../components/ui/LabelValueRow';
import SectionHeader from '../../../components/ui/SectionHeader';
import IconButton from '../../../components/ui/IconButton';
import TagList from '../../../components/tags/TagList';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { listItemStyles } from '../../../components/ui/listItemStyles';
import { useToast } from '../../../components/ui/ToastProvider';
import { usePermissions } from '../../../lib/permissions';
import { useClient, useClientOrderCount } from '../../../src/features/clients/queries';
import {
  ENTITY_FIELD_TYPES,
  buildFallbackEntityFieldSettings,
} from '../../../src/features/fieldSettings/catalog';
import { createEntityFieldPresentation } from '../../../src/features/fieldSettings/presentation';
import { useEntityFieldSettings } from '../../../src/features/fieldSettings/queries';
import {
  buildAdditionalPhoneDisplayLabel,
  getClientAdditionalPhones,
} from '../../../src/features/clients/additionalPhones';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { formatRuMask, normalizeRu, toE164 } from '../../../components/ui/phone';
import { hasDisplayValue } from '../../../src/shared/display/value';

const SAFE_AREA_EDGES = ['left', 'right'];

export default function ClientViewScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = params?.id;
  const rawReturnTo = params?.returnTo;
  const rawReturnParams = params?.returnParams;
  const clientId = Array.isArray(id) ? id[0] : id;
  const returnTo = React.useMemo(() => {
    const value = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo;
    return value ? String(value) : '/clients';
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
  const { has } = usePermissions();

  const canViewClients = has('canViewClients');
  const canEditClients = has('canEditClients');
  const canViewObjects = has('canViewObjects');

  const { data: client } = useClient(clientId, { enabled: !!clientId && canViewClients });
  const { data: clientFieldSettingsData } = useEntityFieldSettings(ENTITY_FIELD_TYPES.CLIENT, {
    enabled: !!clientId && canViewClients,
  });
  const { settings } = useCompanySettings();
  useClientOrderCount(clientId, {
    enabled: !!clientId && canViewClients,
  });
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const toast = useToast();
  const base = React.useMemo(() => listItemStyles(theme), [theme]);
  const clientFieldSettings = React.useMemo(
    () => clientFieldSettingsData || buildFallbackEntityFieldSettings(ENTITY_FIELD_TYPES.CLIENT),
    [clientFieldSettingsData],
  );
  const fieldUi = React.useMemo(
    () => createEntityFieldPresentation(clientFieldSettings),
    [clientFieldSettings],
  );
  const canShowAvatarImage = fieldUi.isVisible('avatar_url');
  const additionalPhones = React.useMemo(() => getClientAdditionalPhones(client), [client]);
  const visibleAdditionalPhones = React.useMemo(
    () =>
      additionalPhones.filter((item, index) =>
        fieldUi.isVisible(`additional_phone_${index + 1}`) && !!item?.phone,
      ),
    [additionalPhones, fieldUi],
  );
  const canShowPersonalSection = fieldUi.hasVisibleFields(['first_name', 'last_name', 'middle_name', 'comment']);
  const canShowContactSection = fieldUi.hasVisibleFields([
    'email',
    'phone',
    'additional_phone_1',
    'additional_phone_2',
    'additional_phone_3',
  ]);

  const onCopyEmail = React.useCallback(async () => {
    const email = client?.email || '';
    if (!email) return false;
    const text = String(email);
    try {
      await Clipboard.setStringAsync(text);
      toast.success(t('toast_copied'));
      return true;
    } catch {
      try {
        toast.error(t('toast_copy_email_fail'));
      } catch {}
      return false;
    }
  }, [client?.email, t, toast]);

  const copyPhoneValue = React.useCallback(async (rawPhone) => {
    const phone = rawPhone || '';
    if (!phone) return false;
    const text = toE164(phone) || '+' + normalizeRu(phone);
    try {
      await Clipboard.setStringAsync(text);
      toast.success(t('toast_copied'));
      return true;
    } catch {
      try {
        toast.error(t('toast_copy_phone_fail'));
      } catch {}
      return false;
    }
  }, [t, toast]);

  const onCopyPhone = React.useCallback(() => {
    return copyPhoneValue(client?.phone || '');
  }, [client?.phone, copyPhoneValue]);

  if (!canViewClients) {
    return (
      <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
        <AppHeader back options={{ title: t('routes_clients_client') }} />
        <View style={styles.centered}>
          <Text style={styles.mutedText}>{t('clients_no_view_permission')}</Text>
        </View>
      </SafeAreaView>
    );
  }
  const objects = Array.isArray(client?.objects) ? client.objects : [];

  return (
    <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
      <AppHeader
        back
        options={{
          title: t('routes_clients_client'),
          rightTextLabel: canEditClients ? t('btn_edit') : undefined,
          onRightPress: canEditClients
            ? () =>
                router.push({
                  pathname: `/clients/${clientId}/edit`,
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
          <View style={styles.avatarBox}>
            {canShowAvatarImage && (client?.avatarDisplayUrl || client?.avatarUrl) ? (
              <ExpoImage
                source={{ uri: client?.avatarDisplayUrl || client?.avatarUrl }}
                style={styles.avatarImg}
                contentFit="cover"
                cachePolicy="none"
              />
            ) : (
              <Text style={styles.avatarText}>{getInitials(client)}</Text>
            )}
          </View>
        </View>

        <>
          {settings?.enable_client_tags && client?.tags?.length ? (
            <>
              <SectionHeader topSpacing="xs">{t('tags_field_label')}</SectionHeader>
              <Card style={{ paddingVertical: theme.spacing.md }}>
                <TagList
                  tags={client.tags}
                  align="start"
                  onPressTag={(tag) => {
                    const value = String(tag?.value || '').trim();
                    if (!value) return;
                    router.push({ pathname: '/clients', params: { tag: value } });
                  }}
                />
              </Card>
            </>
          ) : null}

          {canShowPersonalSection ? <SectionHeader topSpacing="xs">{t('section_personal')}</SectionHeader> : null}
          {canShowPersonalSection ? (
          <Card paddedXOnly>
            {fieldUi.isVisible('first_name') || fieldUi.isVisible('last_name') || fieldUi.isVisible('middle_name') ? (
              <>
                <LabelValueRow
                  label={t('label_full_name')}
                  value={
                    [client?.lastName, client?.firstName, client?.middleName]
                      .filter((p) => !!p && String(p).trim() !== '')
                      .join(' ') || ''
                  }
                />
                {fieldUi.isVisible('comment') ? <View style={base.sep} /> : null}
              </>
            ) : null}
            {fieldUi.isVisible('comment') ? (
              <LabelValueRow label={t('clients_comment_label')} value={client?.comment || ''} />
            ) : null}
          </Card>
          ) : null}
          {canShowContactSection ? <SectionHeader topSpacing="xs">{t('clients_contacts_section')}</SectionHeader> : null}
          {canShowContactSection ? (
          <Card paddedXOnly>
            {fieldUi.isVisible('email') ? (
              <>
                <LabelValueRow
              label={t('view_label_email')}
              valueComponent={
                hasDisplayValue(client?.email) ? (
                  <Pressable
                    style={({ pressed }) => [styles.linkPressable, pressed ? styles.linkPressablePressed : null]}
                    accessibilityRole="link"
                    onLongPress={onCopyEmail}
                    onPress={async () => {
                      const url = `mailto:${client.email}`;
                      try {
                        await Linking.openURL(url);
                      } catch {
                        try {
                          const ok = await Linking.canOpenURL(url);
                          if (ok) await Linking.openURL(url);
                          else toast.error(t('errors_openMail'));
                        } catch {
                          toast.error(t('errors_openMail'));
                        }
                      }
                    }}
                  >
                    <Text style={[base.value, styles.link]}>{client.email}</Text>
                  </Pressable>
                ) : null
              }
              rightActions={
                client?.email ? (
                  <IconButton style={styles.copyIconHidden} onPress={onCopyEmail} accessibilityLabel={t('a11y_copy_email')}>
                    <Feather name="copy" size={Number(theme?.typography?.sizes?.md ?? 16)} />
                  </IconButton>
                ) : null
              }
                />
                {fieldUi.isVisible('phone') || visibleAdditionalPhones.length ? <View style={base.sep} /> : null}
              </>
            ) : null}
            {fieldUi.isVisible('phone') ? (
              <>
                <LabelValueRow
              label={t('view_label_phone')}
              valueComponent={
                hasDisplayValue(client?.phone) ? (
                  <Pressable
                    style={({ pressed }) => [styles.linkPressable, pressed ? styles.linkPressablePressed : null]}
                    accessibilityRole="link"
                    onLongPress={onCopyPhone}
                    onPress={async () => {
                      const url = `tel:${toE164(client.phone) || '+' + normalizeRu(client.phone)}`;
                      try {
                        await Linking.openURL(url);
                      } catch {
                        try {
                          const ok = await Linking.canOpenURL(url);
                          if (ok) await Linking.openURL(url);
                          else toast.error(t('errors_callsUnavailable'));
                        } catch {
                          toast.error(t('errors_callsUnavailable'));
                        }
                      }
                    }}
                  >
                    <Text style={[base.value, styles.link]}>{formatRuMask(client.phone)}</Text>
                  </Pressable>
                ) : null
              }
              rightActions={
                client?.phone ? (
                  <IconButton style={styles.copyIconHidden} onPress={onCopyPhone} accessibilityLabel={t('a11y_copy_phone')}>
                    <Feather name="copy" size={Number(theme?.typography?.sizes?.md ?? 16)} />
                  </IconButton>
                ) : null
              }
                />
                {visibleAdditionalPhones.length ? <View style={base.sep} /> : null}
              </>
            ) : null}
            {visibleAdditionalPhones.map((item, index) => {
              const rowLabel = buildAdditionalPhoneDisplayLabel(t, item?.label);
              const isLast = index === visibleAdditionalPhones.length - 1;
              return (
                <React.Fragment key={`additional-phone-row-${index + 1}`}>
                  <LabelValueRow
                    label={rowLabel}
                    valueComponent={
                      <Pressable
                        style={({ pressed }) => [styles.linkPressable, pressed ? styles.linkPressablePressed : null]}
                        accessibilityRole="link"
                        onLongPress={() => copyPhoneValue(item.phone)}
                        onPress={async () => {
                          const url = `tel:${toE164(item.phone) || '+' + normalizeRu(item.phone)}`;
                          try {
                            await Linking.openURL(url);
                          } catch {
                            try {
                              const ok = await Linking.canOpenURL(url);
                              if (ok) await Linking.openURL(url);
                              else toast.error(t('errors_callsUnavailable'));
                            } catch {
                              toast.error(t('errors_callsUnavailable'));
                            }
                          }
                        }}
                      >
                        <Text style={[base.value, styles.link]}>{formatRuMask(item.phone)}</Text>
                      </Pressable>
                    }
                    rightActions={
                      <IconButton
                        style={styles.copyIconHidden}
                        onPress={() => copyPhoneValue(item.phone)}
                        accessibilityLabel={t('a11y_copy_phone')}
                      >
                        <Feather name="copy" size={Number(theme?.typography?.sizes?.md ?? 16)} />
                      </IconButton>
                    }
                  />
                  {!isLast ? <View style={base.sep} /> : null}
                </React.Fragment>
              );
            })}
          </Card>
          ) : null}

          <SectionHeader topSpacing="xs">{t('clients_objects_section')}</SectionHeader>
          <Card paddedXOnly>
            {objects.length ? (
              objects.map((objectItem) => {
                return (
                  <Pressable
                    key={objectItem.id}
                    style={base.row}
                    disabled={!canViewObjects}
                    onPress={() =>
                      router.push({
                        pathname: `/objects/${objectItem.id}`,
                        params: {
                          returnTo: `/clients/${clientId}`,
                          returnParams: JSON.stringify({ returnTo, returnParams: JSON.stringify(returnParams) }),
                        },
                      })
                    }
                  >
                    <Text style={base.label}>{t('routes_objects_object')}</Text>
                    <View style={base.rightWrap}>
                      <Text style={[base.value, canViewObjects ? styles.link : null]}>
                        {objectItem.name || t('objects_unnamed')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <LabelValueRow label={t('clients_objects_section')} value={t('objects_empty')} />
            )}
          </Card>
        </>

      </ScrollView>
    </SafeAreaView>
  );
}

function getInitials(client) {
  const first = String(client?.firstName || '').slice(0, 1);
  const last = String(client?.lastName || '').slice(0, 1);
  return `${first}${last}`.toUpperCase() || '*';
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
    avatarWrap: {
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    tabs: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    tab: {
      flex: 1,
      borderRadius: theme.radii.lg,
      paddingVertical: theme.spacing.sm,
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: theme.colors.border,
    },
    tabActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    tabText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    tabTextActive: {
      color: theme.colors.primaryTextOn,
    },
    avatarBox: {
      width: theme.components?.avatar?.xl ?? 96,
      height: theme.components?.avatar?.xl ?? 96,
      borderRadius: (theme.components?.avatar?.xl ?? 96) / 2,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.components?.card?.borderWidth ?? 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    avatarText: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weight.bold,
    },
    link: {
      color: theme.colors.primary,
    },
    linkPressable: {
      borderRadius: theme.radii.xs,
    },
    linkPressablePressed: {
      opacity: 0.6,
      transform: [{ scale: 0.99 }],
    },
    copyIconHidden: {
      display: 'none',
    },
    mutedText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
    },
  });
}
