export const STATISTICS_PERIODS = Object.freeze([
  { id: '7d', days: 7, labelKey: 'stats_period_7d' },
  { id: 'month' },
  { id: 'year' },
  { id: 'custom', labelKey: 'stats_period_custom' },
]);

export const NO_DEPARTMENT_STATISTICS_ID = '__no_department__';

export function toLocalISODate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromLocalISODate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  return new Date(year, Math.max(0, month - 1), day);
}

export function getStatisticsPeriodRange(periodId, customRange = {}) {
  const today = new Date();
  const to = toLocalISODate(today);
  if (periodId === 'custom' && customRange.from && customRange.to) {
    return { from: customRange.from, to: customRange.to };
  }
  if (periodId === 'year') {
    return { from: `${today.getFullYear()}-01-01`, to };
  }
  if (periodId === 'month') {
    return { from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`, to };
  }
  const period = STATISTICS_PERIODS.find((item) => item.id === periodId);
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - Math.max(0, Number(period?.days || 30) - 1));
  return { from: toLocalISODate(fromDate), to };
}

export function calculateChange(current, previous) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return null;
  if (previousValue === 0) return currentValue === 0 ? 0 : null;
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}
