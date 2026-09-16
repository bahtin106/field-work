export const ADMIN_USER_SORT = Object.freeze({
  NAME_ASC: 'name_asc',
  NAME_DESC: 'name_desc',
  COMPANY: 'company',
  ROLE: 'role',
  LAST_SEEN_NEW_OLD: 'last_seen_new_old',
  LAST_SEEN_OLD_NEW: 'last_seen_old_new',
  CREATED_NEW_OLD: 'created_new_old',
  CREATED_OLD_NEW: 'created_old_new',
});

export const ADMIN_COMPANY_SORT = Object.freeze({
  NAME_ASC: 'name_asc',
  NAME_DESC: 'name_desc',
  EMPLOYEES_MANY_FEW: 'employees_many_few',
  EMPLOYEES_FEW_MANY: 'employees_few_many',
  SUBSCRIPTION_END_SOON_LATE: 'subscription_end_soon_late',
  SUBSCRIPTION_END_LATE_SOON: 'subscription_end_late_soon',
  UPDATED_NEW_OLD: 'updated_new_old',
  UPDATED_OLD_NEW: 'updated_old_new',
});

export const ADMIN_USER_FILTER = Object.freeze({
  ROLE_PREFIX: 'user-role:',
  COMPANY_PREFIX: 'user-company:',
  SUPER_ADMIN_ROLE: 'super_admin',
  UNASSIGNED_COMPANY: '__unassigned__',
});

export const ADMIN_COMPANY_FILTER = Object.freeze({
  SUBSCRIPTION_PREFIX: 'company-subscription:',
  ADMIN_PREFIX: 'company-admin:',
  SUBSCRIPTION_ACTIVE: 'active',
  SUBSCRIPTION_EXPIRED: 'expired',
  SUBSCRIPTION_NOT_CONFIGURED: 'not_configured',
  ADMIN_ASSIGNED: 'assigned',
  ADMIN_UNASSIGNED: 'unassigned',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function textCompare(a, b, locale) {
  return normalizeText(a).localeCompare(normalizeText(b), locale || 'ru', {
    sensitivity: 'base',
    numeric: true,
  });
}

function toTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareOptionalTimestamps(a, b, direction = 1) {
  const aTimestamp = toTimestamp(a);
  const bTimestamp = toTimestamp(b);
  if (aTimestamp == null && bTimestamp == null) return 0;
  if (aTimestamp == null) return 1;
  if (bTimestamp == null) return -1;
  return (aTimestamp - bTimestamp) * direction;
}

function selectedValues(selections, prefix) {
  return new Set(
    (Array.isArray(selections) ? selections : [])
      .map((value) => String(value || ''))
      .filter((value) => value.startsWith(prefix))
      .map((value) => value.slice(prefix.length))
      .filter(Boolean),
  );
}

export function getAdminUserRoleFilterValue(row) {
  if (row?.is_super_admin === true) return ADMIN_USER_FILTER.SUPER_ADMIN_ROLE;
  return normalizeText(row?.role).toLowerCase();
}

export function getAdminUserCompanyFilterValue(row) {
  return normalizeText(row?.company_id) || ADMIN_USER_FILTER.UNASSIGNED_COMPANY;
}

export function filterAdminUsers(rows, selections) {
  const roles = selectedValues(selections, ADMIN_USER_FILTER.ROLE_PREFIX);
  const companies = selectedValues(selections, ADMIN_USER_FILTER.COMPANY_PREFIX);

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (roles.size > 0 && !roles.has(getAdminUserRoleFilterValue(row))) return false;
    if (companies.size > 0 && !companies.has(getAdminUserCompanyFilterValue(row))) return false;
    return true;
  });
}

export function sortAdminUsers(
  rows,
  {
    sortKey = ADMIN_USER_SORT.NAME_ASC,
    locale = 'ru',
    getName = (row) => row?.full_name || row?.email || row?.profile_id,
    getRoleLabel = (row) => row?.role,
  } = {},
) {
  const sorted = Array.isArray(rows) ? [...rows] : [];
  sorted.sort((a, b) => {
    const byName = textCompare(getName(a), getName(b), locale);
    if (sortKey === ADMIN_USER_SORT.NAME_DESC) return -byName;
    if (sortKey === ADMIN_USER_SORT.NAME_ASC) return byName;

    if (sortKey === ADMIN_USER_SORT.COMPANY) {
      const byCompany = textCompare(a?.company_name || a?.company_id, b?.company_name || b?.company_id, locale);
      return byCompany !== 0 ? byCompany : byName;
    }
    if (sortKey === ADMIN_USER_SORT.ROLE) {
      const byRole = textCompare(getRoleLabel(a), getRoleLabel(b), locale);
      return byRole !== 0 ? byRole : byName;
    }
    if (sortKey === ADMIN_USER_SORT.LAST_SEEN_NEW_OLD) {
      const byLastSeen = compareOptionalTimestamps(a?.last_seen_at, b?.last_seen_at, -1);
      return byLastSeen !== 0 ? byLastSeen : byName;
    }
    if (sortKey === ADMIN_USER_SORT.LAST_SEEN_OLD_NEW) {
      const byLastSeen = compareOptionalTimestamps(a?.last_seen_at, b?.last_seen_at, 1);
      return byLastSeen !== 0 ? byLastSeen : byName;
    }
    if (sortKey === ADMIN_USER_SORT.CREATED_NEW_OLD) {
      const byCreated = compareOptionalTimestamps(a?.created_at, b?.created_at, -1);
      return byCreated !== 0 ? byCreated : byName;
    }
    if (sortKey === ADMIN_USER_SORT.CREATED_OLD_NEW) {
      const byCreated = compareOptionalTimestamps(a?.created_at, b?.created_at, 1);
      return byCreated !== 0 ? byCreated : byName;
    }
    return byName;
  });
  return sorted;
}

export function getAdminCompanySubscriptionFilterValue(row) {
  if (toTimestamp(row?.current_period_end) == null) {
    return ADMIN_COMPANY_FILTER.SUBSCRIPTION_NOT_CONFIGURED;
  }
  return normalizeText(row?.subscription_status).toLowerCase() === 'active'
    ? ADMIN_COMPANY_FILTER.SUBSCRIPTION_ACTIVE
    : ADMIN_COMPANY_FILTER.SUBSCRIPTION_EXPIRED;
}

export function getAdminCompanyAssignmentFilterValue(row) {
  return normalizeText(row?.admin_name) || normalizeText(row?.admin_email)
    ? ADMIN_COMPANY_FILTER.ADMIN_ASSIGNED
    : ADMIN_COMPANY_FILTER.ADMIN_UNASSIGNED;
}

export function filterAdminCompanies(rows, selections) {
  const subscriptionStatuses = selectedValues(
    selections,
    ADMIN_COMPANY_FILTER.SUBSCRIPTION_PREFIX,
  );
  const adminStatuses = selectedValues(selections, ADMIN_COMPANY_FILTER.ADMIN_PREFIX);

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (
      subscriptionStatuses.size > 0 &&
      !subscriptionStatuses.has(getAdminCompanySubscriptionFilterValue(row))
    ) {
      return false;
    }
    if (
      adminStatuses.size > 0 &&
      !adminStatuses.has(getAdminCompanyAssignmentFilterValue(row))
    ) {
      return false;
    }
    return true;
  });
}

export function sortAdminCompanies(
  rows,
  { sortKey = ADMIN_COMPANY_SORT.NAME_ASC, locale = 'ru' } = {},
) {
  const sorted = Array.isArray(rows) ? [...rows] : [];
  sorted.sort((a, b) => {
    const byName = textCompare(a?.name || a?.company_id, b?.name || b?.company_id, locale);
    if (sortKey === ADMIN_COMPANY_SORT.NAME_DESC) return -byName;
    if (sortKey === ADMIN_COMPANY_SORT.NAME_ASC) return byName;

    if (sortKey === ADMIN_COMPANY_SORT.EMPLOYEES_MANY_FEW) {
      const byEmployees = Number(b?.employees_count || 0) - Number(a?.employees_count || 0);
      return byEmployees !== 0 ? byEmployees : byName;
    }
    if (sortKey === ADMIN_COMPANY_SORT.EMPLOYEES_FEW_MANY) {
      const byEmployees = Number(a?.employees_count || 0) - Number(b?.employees_count || 0);
      return byEmployees !== 0 ? byEmployees : byName;
    }
    if (sortKey === ADMIN_COMPANY_SORT.SUBSCRIPTION_END_SOON_LATE) {
      const byEnd = compareOptionalTimestamps(a?.current_period_end, b?.current_period_end, 1);
      return byEnd !== 0 ? byEnd : byName;
    }
    if (sortKey === ADMIN_COMPANY_SORT.SUBSCRIPTION_END_LATE_SOON) {
      const byEnd = compareOptionalTimestamps(a?.current_period_end, b?.current_period_end, -1);
      return byEnd !== 0 ? byEnd : byName;
    }
    if (sortKey === ADMIN_COMPANY_SORT.UPDATED_NEW_OLD) {
      const byUpdated = compareOptionalTimestamps(a?.updated_at, b?.updated_at, -1);
      return byUpdated !== 0 ? byUpdated : byName;
    }
    if (sortKey === ADMIN_COMPANY_SORT.UPDATED_OLD_NEW) {
      const byUpdated = compareOptionalTimestamps(a?.updated_at, b?.updated_at, 1);
      return byUpdated !== 0 ? byUpdated : byName;
    }
    return byName;
  });
  return sorted;
}
