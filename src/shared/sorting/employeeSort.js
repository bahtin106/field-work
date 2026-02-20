export const EMPLOYEE_SORT = Object.freeze({
  NAME_ASC: 'name_asc',
  NAME_DESC: 'name_desc',
  DEPARTMENT: 'department',
  LAST_SEEN_OLD_NEW: 'last_seen_old_new',
  LAST_SEEN_NEW_OLD: 'last_seen_new_old',
  ROLE: 'role',
});

const DEFAULT_NAME = '';
const DEFAULT_DEPARTMENT = '';
const DEFAULT_ROLE = '';
const DEFAULT_LAST_SEEN = null;

function normalizeText(value) {
  return String(value || '').trim();
}

function textCmp(a, b) {
  return normalizeText(a).localeCompare(normalizeText(b), 'ru', { sensitivity: 'base' });
}

function parsePgTs(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toMs(value) {
  const d = parsePgTs(value);
  return d ? d.getTime() : 0;
}

export function employeeSortOptions(t) {
  return [
    { id: EMPLOYEE_SORT.NAME_ASC, label: t('sort_name_asc') },
    { id: EMPLOYEE_SORT.NAME_DESC, label: t('sort_name_desc') },
    { id: EMPLOYEE_SORT.DEPARTMENT, label: t('sort_department') },
    { id: EMPLOYEE_SORT.LAST_SEEN_OLD_NEW, label: t('sort_last_seen_old_new') },
    { id: EMPLOYEE_SORT.LAST_SEEN_NEW_OLD, label: t('sort_last_seen_new_old') },
    { id: EMPLOYEE_SORT.ROLE, label: t('sort_role') },
  ];
}

export function sortEmployees(list, {
  sortKey = EMPLOYEE_SORT.NAME_ASC,
  getName = (item) => item?.name ?? item?.display_name ?? item?.full_name ?? DEFAULT_NAME,
  getDepartmentName = (item) => item?.department_name ?? DEFAULT_DEPARTMENT,
  getRoleLabel = (item) => item?.role ?? DEFAULT_ROLE,
  getLastSeenAt = (item) => item?.last_seen_at ?? DEFAULT_LAST_SEEN,
} = {}) {
  const rows = Array.isArray(list) ? [...list] : [];

  rows.sort((a, b) => {
    const nameA = getName(a);
    const nameB = getName(b);
    const byNameAsc = textCmp(nameA, nameB);

    if (sortKey === EMPLOYEE_SORT.NAME_DESC) return -byNameAsc;
    if (sortKey === EMPLOYEE_SORT.NAME_ASC) return byNameAsc;

    if (sortKey === EMPLOYEE_SORT.DEPARTMENT) {
      const depA = getDepartmentName(a);
      const depB = getDepartmentName(b);
      const byDep = textCmp(depA, depB);
      return byDep !== 0 ? byDep : byNameAsc;
    }

    if (sortKey === EMPLOYEE_SORT.ROLE) {
      const roleA = getRoleLabel(a);
      const roleB = getRoleLabel(b);
      const byRole = textCmp(roleA, roleB);
      return byRole !== 0 ? byRole : byNameAsc;
    }

    if (sortKey === EMPLOYEE_SORT.LAST_SEEN_OLD_NEW) {
      const byOldFirst = toMs(getLastSeenAt(a)) - toMs(getLastSeenAt(b));
      return byOldFirst !== 0 ? byOldFirst : byNameAsc;
    }

    if (sortKey === EMPLOYEE_SORT.LAST_SEEN_NEW_OLD) {
      const byNewFirst = toMs(getLastSeenAt(b)) - toMs(getLastSeenAt(a));
      return byNewFirst !== 0 ? byNewFirst : byNameAsc;
    }

    return byNameAsc;
  });

  return rows;
}

