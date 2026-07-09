export const NO_DEPARTMENT_FILTER_ID = '__no_department__';

export function isNoDepartmentFilterId(value: any) {
  return String(value || '') === NO_DEPARTMENT_FILTER_ID;
}

export function createNoDepartmentOption(t: any) {
  return {
    id: NO_DEPARTMENT_FILTER_ID,
    label: t('placeholder_department'),
    isSystem: true,
  };
}

export function normalizeDepartmentFilterIds(values: any) {
  if (!Array.isArray(values)) {
    return {
      departmentIds: [],
      includeNoDepartment: false,
    };
  }

  const departmentIds: string[] = [];
  let includeNoDepartment = false;

  values.forEach((value) => {
    if (isNoDepartmentFilterId(value)) {
      includeNoDepartment = true;
      return;
    }

    const normalized = String(value || '').trim();
    if (normalized) departmentIds.push(normalized);
  });

  return {
    departmentIds,
    includeNoDepartment,
  };
}
