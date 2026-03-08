import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { useClient } from '../../src/features/clients/queries';
import { buildClientObjectShortAddress } from '../../src/features/objects/addressing';
import { withAlpha } from '../../theme/colors';

export default function ObjectCard({ item, onPress }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const rad = theme.radii;

  const cardShadows = useMemo(
    () => (Platform.OS === 'ios' ? theme.shadows?.card?.ios ?? {} : theme.shadows?.card?.android ?? {}),
    [theme],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: c.surface,
          borderRadius: rad.lg,
          borderWidth: theme.components.card.borderWidth,
          borderColor: c.border,
          padding: sz.md,
          marginBottom: sz.sm,
          position: 'relative',
          minHeight: (sz.xl || 24) * 4,
          ...cardShadows,
        },
        row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        cardTextWrap: { flexShrink: 1 },
        title: { fontSize: ty.sizes.md, fontWeight: ty.weight.semibold, color: c.text },
        owner: { fontSize: ty.sizes.sm, fontWeight: ty.weight.regular, color: c.text, marginTop: 2 },
        subtitle: { fontSize: ty.sizes.sm, color: c.textSecondary, marginTop: 2 },
      }),
    [theme, c.surface, c.border, c.text, c.textSecondary, rad.lg, sz, ty, cardShadows],
  );

  const name = String(item?.name || '').trim() || item?.summary || '';
  const { data: client } = useClient(item?.client_id, { enabled: !!item?.client_id });
  const owner =
    String(client?.fullName || client?.full_name || item?._client?.name || item?.client?.full_name || '').trim() || '';
  const address =
    String(buildClientObjectShortAddress(item) || item?.summary || '').trim() || '';

  return (
      <Pressable
      android_ripple={{ borderless: false, color: withAlpha(theme.colors.border, 0.06) }}
      onPress={() => onPress && onPress(item.id)}
      style={styles.card}
    >
      <View style={styles.row}>
        <View style={styles.cardTextWrap}>
          <Text numberOfLines={1} style={styles.title}>
            {name || ''}
          </Text>
          {owner ? (
            <Text numberOfLines={1} style={styles.owner}>
              {owner}
            </Text>
          ) : null}
          {address ? (
            <Text numberOfLines={1} style={styles.subtitle}>
              {address}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
