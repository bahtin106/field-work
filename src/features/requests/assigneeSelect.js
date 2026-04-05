import { buildSearchIndex } from '../../shared/search/matching';

function resolveName(user, fallbackNoName) {
  const fullName = [user?.first_name, user?.middle_name, user?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return fullName || String(user?.email || user?.display_name || fallbackNoName || '').trim();
}

function resolveRoleLabel(t, role) {
  const normalizedRole = String(role || '').trim();
  if (!normalizedRole) return '';
  return String(t(`role_${normalizedRole}`, normalizedRole) || normalizedRole).trim();
}

function resolveDepartmentLabel(user, departmentsById) {
  if (!departmentsById) return '';
  const deptId = user?.department_id;
  if (deptId === null || deptId === undefined || deptId === '') return '';
  return String(
    departmentsById.get(String(deptId)) ||
      departmentsById.get(Number(deptId)) ||
      '',
  ).trim();
}

function isBlockedUser(user) {
  const blockedByAdmin = user?.is_admin_blocked === true;
  const blockedByLicense = String(user?.license_state || '').trim().toLowerCase() === 'blocked_by_license';
  return blockedByAdmin || blockedByLicense;
}

export function buildAssigneeSelectItems({
  users = [],
  departmentsById = new Map(),
  t,
  includeFeed = true,
  onSelectFeed,
  onSelectUser,
}) {
  const result = [];

  if (includeFeed) {
    result.push({
      id: 'feed',
      label: t('create_order_executor_in_feed'),
      onPress: onSelectFeed,
      searchIndex: buildSearchIndex({
        texts: [t('create_order_executor_in_feed')],
      }),
    });
  }

  users.forEach((user) => {
    const id = user?.id;
    if (!id) return;

    const label = resolveName(user, t('common_noName'));
    const roleLabel = resolveRoleLabel(t, user?.role);
    const departmentLabel = resolveDepartmentLabel(user, departmentsById);
    const blockedLabel = isBlockedUser(user) ? String(t('status_blocked', 'Заблокирован')).trim() : '';
    const subtitleParts = [roleLabel, departmentLabel, blockedLabel].filter(Boolean);
    const subtitle = subtitleParts.length ? subtitleParts.join(' • ') : undefined;

    result.push({
      id,
      label,
      subtitle,
      onPress: () => onSelectUser?.(id),
      searchIndex: buildSearchIndex({
        texts: [
          label,
          String(user?.email || '').trim(),
          roleLabel,
          departmentLabel,
          blockedLabel,
          String(user?.first_name || '').trim(),
          String(user?.middle_name || '').trim(),
          String(user?.last_name || '').trim(),
        ],
      }),
    });
  });

  return result;
}
