export const ORDER_FINANCE_FIELD_KEY = 'finance';
export const ORDER_FINANCE_ENTRIES_FIELD_KEY = 'finance_entries';

function isEnabledFlag(field, fallbackValue = true) {
  if (!field || typeof field !== 'object') return fallbackValue;
  if (field.isEnabled !== undefined) return field.isEnabled !== false;
  if (field.is_enabled !== undefined) return field.is_enabled !== false;
  return fallbackValue;
}

function getFieldKey(field) {
  return String(field?.fieldKey || field?.field_key || '');
}

export function isOrderFinanceEnabledFromMap(orderFieldsByKey) {
  const map = orderFieldsByKey && typeof orderFieldsByKey.get === 'function' ? orderFieldsByKey : null;
  if (!map) return true;
  const financeEnabled = isEnabledFlag(map.get(ORDER_FINANCE_FIELD_KEY), true);
  const entriesEnabled = isEnabledFlag(map.get(ORDER_FINANCE_ENTRIES_FIELD_KEY), true);
  return financeEnabled || entriesEnabled;
}

export function isOrderFinanceEntriesEnabledFromMap(orderFieldsByKey) {
  const map = orderFieldsByKey && typeof orderFieldsByKey.get === 'function' ? orderFieldsByKey : null;
  if (!map) return true;
  const entriesEnabled = isEnabledFlag(map.get(ORDER_FINANCE_ENTRIES_FIELD_KEY), true);
  return isOrderFinanceEnabledFromMap(map) && entriesEnabled;
}

export function enforceOrderFinanceFieldDependencies(fields) {
  const list = Array.isArray(fields) ? fields : [];
  if (!list.length) return list;

  const financeIndex = list.findIndex((field) => getFieldKey(field) === ORDER_FINANCE_FIELD_KEY);
  const entriesIndex = list.findIndex((field) => getFieldKey(field) === ORDER_FINANCE_ENTRIES_FIELD_KEY);
  if (financeIndex < 0 && entriesIndex < 0) return list;

  const financeField = financeIndex >= 0 ? list[financeIndex] : null;
  const entriesField = entriesIndex >= 0 ? list[entriesIndex] : null;
  let financeEnabled = isEnabledFlag(financeField, true);
  let entriesEnabled = isEnabledFlag(entriesField, true);

  // Консервативная серверная нормализация без контекста действия:
  // если finance выключен, entries выключаем тоже.
  if (!financeEnabled) entriesEnabled = false;

  return list.map((field, index) => {
    if (index === financeIndex) {
      return {
        ...field,
        isEnabled: financeEnabled,
        is_enabled: financeEnabled,
        isRequired: false,
        is_required: false,
      };
    }
    if (index === entriesIndex) {
      return {
        ...field,
        isEnabled: entriesEnabled,
        is_enabled: entriesEnabled,
        isRequired: false,
        is_required: false,
      };
    }
    return field;
  });
}
