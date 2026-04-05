import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { withAlpha } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * UserCard - Отдельный компонент для карточки пользователя
 * Мемоизирован, чтобы не перерендеривался при обновлении departmentMap
 */
function UserCardContent({
  item,
  departmentName,
  showDepartment = true,
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
  const badgeNudge = Number(theme.spacing?.xxs ?? theme.spacing?.xs ?? 0);
  const roleBadgeTop = Math.max(0, Number(sz.md ?? 0) - badgeNudge);
  const blockedBadgeBottom = Math.max(0, Number(sz.md ?? 0) - badgeNudge);

  // Получаем тени из темы для текущей платформы
  const cardShadows = useMemo(
    () =>
      Platform.OS === 'ios'
        ? (theme.shadows?.card?.ios ?? {})
        : (theme.shadows?.card?.android ?? {}),
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
          minHeight: sz.xl * 4,
          ...cardShadows,
        },
        cardSuspended: {
          backgroundColor: theme.colors.surfaceMutedDanger,
          borderWidth: 0,
          borderColor: 'transparent',
          ...cardShadows,
        },
        cardRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        cardTextWrap: {
          flex: 1,
          minWidth: 0,
          flexShrink: 1,
          paddingRight: sz.xl * 4,
        },
        cardTitle: {
          fontSize: ty.sizes.md,
          fontWeight: ty.weight.semibold,
          color: c.text,
          lineHeight: Math.round((ty.sizes.md || 16) * (ty.lineHeights?.normal || 1.35)),
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
          top: roleBadgeTop,
          right: sz.md,
          zIndex: 2,
        },
        suspendedPill: {
          position: 'absolute',
          right: sz.md,
          bottom: blockedBadgeBottom,
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
    [
      theme,
      cardShadows,
      c.border,
      c.danger,
      c.surface,
      c.text,
      c.textSecondary,
      rad.lg,
      rad.md,
      roleBadgeTop,
      blockedBadgeBottom,
      sz.md,
      sz.sm,
      sz.xl,
      ty.sizes.md,
      ty.sizes.sm,
      ty.sizes.xs,
      ty.weight.semibold,
    ],
  );

  const fullName =
    (item.display_name || '').trim() ||
    `${item.first_name || ''} ${item.middle_name || ''} ${item.last_name || ''}`.trim() ||
    item.full_name ||
    '';

  const isAdminBlocked =
    item?.is_admin_blocked === true;
  const isLicenseBlocked = item?.license_state === 'blocked_by_license';
  const isBlocked = isAdminBlocked || isLicenseBlocked;

  const blockedLabel = translate('status_blocked', translate('status_suspended'));

  const departmentText = `${translate('users_department')}: ${departmentName || translate('placeholder_department')}`;

  const stylesPill = rolePillStyle(item.role);

  return (
    <Pressable
      android_ripple={{ borderless: false, color: withAlpha(theme.colors.border, 0.13) }}
      onPress={() => onPress(item.id)}
      style={[
        styles.card,
        isBlocked ? styles.cardSuspended : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${translate('users_openUser')} ${fullName || translate('common_noName')}`}
    >
      <View style={styles.cardRow}>
        <View style={styles.cardTextWrap}>
          <Text numberOfLines={2} style={styles.cardTitle}>
            {fullName || translate('common_noName')}
          </Text>
          {showDepartment ? (
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

      {isBlocked ? (
        <View style={styles.suspendedPill}>
          <Text style={styles.suspendedPillText}>{blockedLabel}</Text>
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
    prevProps.item?.middle_name === nextProps.item?.middle_name &&
    prevProps.item?.last_name === nextProps.item?.last_name &&
    prevProps.item?.full_name === nextProps.item?.full_name &&
    prevProps.item?.role === nextProps.item?.role &&
    prevProps.item?.last_seen_at === nextProps.item?.last_seen_at &&
    prevProps.item?.is_admin_blocked === nextProps.item?.is_admin_blocked &&
    prevProps.item?.license_state === nextProps.item?.license_state &&
    prevProps.departmentName === nextProps.departmentName &&
    prevProps.showDepartment === nextProps.showDepartment
  );
});

UserCard.displayName = 'UserCard';
