import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPersonName } from '../../lib/personName';
import TagList from '../tags/TagList';
import { useTheme } from '../../theme/ThemeProvider';
import {
  extractOrderAddressFromObject,
  filterOrderAddressByObjectFieldSettings,
} from '../../src/features/requests/addressing';
import { buildClientObjectLocationSummary } from '../../src/features/objects/addressing';
import { withAlpha } from '../../theme/colors';
import { getCardSurfaceStyle } from '../../theme/surfaceStyles';

function ObjectCard({ item, onPress, canViewClients = false, objectFieldsByKey }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          ...getCardSurfaceStyle(theme),
          padding: sz.md,
          marginBottom: sz.sm,
          position: 'relative',
          minHeight: (sz.xl || 24) * 4,
        },
        row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        cardTextWrap: { flexShrink: 1 },
        title: { fontSize: ty.sizes.md, fontWeight: ty.weight.semibold, color: c.text },
        owner: { fontSize: ty.sizes.sm, fontWeight: ty.weight.regular, color: c.text, marginTop: 2 },
        subtitle: { fontSize: ty.sizes.sm, color: c.textSecondary, marginTop: 2 },
        tags: { marginTop: sz.sm },
      }),
    [theme, c.text, c.textSecondary, sz, ty],
  );

  const name = String(item?.name || '').trim();
  const client = canViewClients ? item?.client || null : null;
  const owner =
    String(formatPersonName(client) || item?._client?.name || formatPersonName(item?.client) || '').trim() || '';
  const visibleAddress = useMemo(
    () => filterOrderAddressByObjectFieldSettings(extractOrderAddressFromObject(item), objectFieldsByKey),
    [item, objectFieldsByKey],
  );
  const address = String(
    buildClientObjectLocationSummary(item, { addressLike: visibleAddress, compact: true }) || '',
  ).trim();

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
      <TagList tags={item?.tags} compact style={styles.tags} />
    </Pressable>
  );
}

export default memo(ObjectCard);
