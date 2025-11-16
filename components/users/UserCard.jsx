import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { withAlpha } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * UserCard - Отдельный компонент для карточки пользователя
 * Мемоизирован, чтобы не перерендеривался при обновлении departmentMap
 */
function UserCardContent({
  item,
  departmentName,
  onPress,
  rolePillStyle,
  formatPresence,
  isOnlineNow,
  translate,
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;

  const rad = theme.radii;

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
          minHeight: sz.xl * 4,
        },
        cardSuspended: {
          backgroundColor: theme.colors.surfaceMutedDanger,
          borderWidth: 0,
          borderColor: 'transparent',
        },
        cardRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        cardTextWrap: {
          flexShrink: 1,
          paddingRight: sz.xl * 3,
        },
        cardTitle: {
          fontSize: ty.sizes.md,
          fontWeight: ty.weight.semibold,
          color: c.text,
        },
        metaText: {
          fontSize: ty.sizes.sm,
          color: c.textSecondary,
          marginTop: 2,
        },
        rolePill: {
          paddingHorizontal: sz.sm,
          paddingVertical: 6,
          borderRadius: rad.md,
          borderWidth: 1,
        },
        rolePillText: {
          fontSize: ty.sizes.xs,
          fontWeight: ty.weight.semibold,
        },
        rolePillTopRight: {
          position: 'absolute',
          top: sz.md,
          right: sz.md,
          zIndex: 2,
        },
        suspendedPill: {
          position: 'absolute',
          right: sz.md,
          bottom: sz.md,
          zIndex: 2,
          paddingHorizontal: sz.sm,
          paddingVertical: 6,
          borderRadius: rad.md,
          borderWidth: 1,
          backgroundColor: withAlpha(c.danger, 0.13),
          borderColor: withAlpha(c.danger, 0.2),
        },
        suspendedPillText: {
          fontSize: ty.sizes.xs,
          fontWeight: ty.weight.semibold,
          color: c.danger,
        },
      }),
    [theme],
  );

  const fullName = (
    `${item.first_name || ''} ${item.last_name || ''}`.trim() ||
    item.full_name ||
    ''
  ).trim();

  const departmentText = departmentName
    ? `${translate('users_department')}: ${departmentName}`
    : '';

  const stylesPill = rolePillStyle(item.role);

  return (
    <Pressable
      android_ripple={{ borderless: false, color: withAlpha(theme.colors.border, 0.13) }}
      onPress={() => onPress(item.id)}
      style={[
        styles.card,
        item?.is_suspended === true || !!item?.suspended_at ? styles.cardSuspended : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${translate('users_openUser')} ${fullName || translate('common_noName')}`}
    >
      <View style={styles.cardRow}>
        <View style={styles.cardTextWrap}>
          <Text numberOfLines={1} style={styles.cardTitle}>
            {fullName || translate('common_noName')}
          </Text>
          {departmentText ? (
            <Text numberOfLines={1} style={styles.metaText}>
              {departmentText}
            </Text>
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.metaText,
              isOnlineNow(item?.last_seen_at)
                ? {
                    color: theme.colors.success,
                    fontWeight: theme.typography.weight.semibold,
                  }
                : null,
            ]}
          >
            {formatPresence(item?.last_seen_at)}
          </Text>
        </View>
      </View>

      <View style={[stylesPill.container, styles.rolePillTopRight]}>
        <Text style={stylesPill.text}>{translate(`role_${item.role}`)}</Text>
      </View>

      {item?.is_suspended === true || !!item?.suspended_at ? (
        <View style={styles.suspendedPill}>
          <Text style={styles.suspendedPillText}>{translate('status_suspended')}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Мемоизируем компонент, чтобы он не перерендеривался при обновлении departmentMap
 * Зависит только от item.id, departmentName и других необходимых пропсов
 */
export const UserCard = React.memo(UserCardContent, (prevProps, nextProps) => {
  // Возвращаем true если props не изменились (НЕ перерендеривать)
  return (
    prevProps.item?.id === nextProps.item?.id &&
    prevProps.item?.first_name === nextProps.item?.first_name &&
    prevProps.item?.last_name === nextProps.item?.last_name &&
    prevProps.item?.full_name === nextProps.item?.full_name &&
    prevProps.item?.role === nextProps.item?.role &&
    prevProps.item?.last_seen_at === nextProps.item?.last_seen_at &&
    prevProps.item?.is_suspended === nextProps.item?.is_suspended &&
    prevProps.item?.suspended_at === nextProps.item?.suspended_at &&
    prevProps.departmentName === nextProps.departmentName
  );
});

UserCard.displayName = 'UserCard';
