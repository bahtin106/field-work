import { supabase } from '../../../lib/supabase';

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_SUMMARY = Object.freeze({
  registered: 0,
  completed: 0,
  completed_from_registered: 0,
  not_completed_from_registered: 0,
  completion_rate: 0,
  average_cycle_hours: 0,
  revenue: null,
  base_revenue: null,
  additional_sales: null,
  discounts: null,
  employee_compensation: null,
  company_expenses: null,
  total_expenses: null,
  profit: null,
  average_check: null,
  personal_earnings: 0,
  personal_paid: null,
  personal_settlement_balance: null,
});

function normalizeIds(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter(Boolean)),
  ).sort();
}

function normalizeDashboard(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    meta: source.meta && typeof source.meta === 'object' ? source.meta : {},
    summary: { ...EMPTY_SUMMARY, ...(source.summary || {}) },
    comparison: source.comparison && typeof source.comparison === 'object' ? source.comparison : {},
    trend: Array.isArray(source.trend) ? source.trend : EMPTY_ARRAY,
    statuses: Array.isArray(source.statuses) ? source.statuses : EMPTY_ARRAY,
    sources: Array.isArray(source.sources) ? source.sources : EMPTY_ARRAY,
    paymentMethods: Array.isArray(source.payment_methods) ? source.payment_methods : EMPTY_ARRAY,
    additionalSales: Array.isArray(source.additional_sales) ? source.additional_sales : EMPTY_ARRAY,
    expenses: Array.isArray(source.expenses) ? source.expenses : EMPTY_ARRAY,
    employees: Array.isArray(source.employees) ? source.employees : EMPTY_ARRAY,
    departments: Array.isArray(source.departments) ? source.departments : EMPTY_ARRAY,
    filterOptions: {
      employees: Array.isArray(source.filter_options?.employees)
        ? source.filter_options.employees
        : EMPTY_ARRAY,
      departments: Array.isArray(source.filter_options?.departments)
        ? source.filter_options.departments
        : EMPTY_ARRAY,
      workTypes: Array.isArray(source.filter_options?.work_types)
        ? source.filter_options.work_types
        : EMPTY_ARRAY,
    },
  };
}

export async function getStatisticsDashboard({
  from,
  to,
  scope = 'me',
  employeeIds = [],
  departmentIds = [],
  includeNoDepartment = false,
  workTypeIds = [],
  includeNoWorkType = false,
} = {}) {
  const { data, error } = await supabase.rpc('get_statistics_dashboard_v2', {
    p_from: from || null,
    p_to: to || null,
    p_scope: scope === 'company' ? 'company' : 'me',
    p_employee_ids: normalizeIds(employeeIds),
    p_department_ids: normalizeIds(departmentIds),
    p_include_no_department: includeNoDepartment === true,
    p_work_type_ids: normalizeIds(workTypeIds),
    p_include_no_work_type: includeNoWorkType === true,
  });
  if (error) throw error;
  return normalizeDashboard(data);
}
