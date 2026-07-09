export const ORDER_SORT_KEYS = Object.freeze({
  departureDesc: 'date_desc',
  departureAsc: 'date_asc',
  createdDesc: 'created_desc',
  createdAsc: 'created_asc',
  amountDesc: 'amount_desc',
  amountAsc: 'amount_asc',
});

export const ORDER_DEFAULT_SORT_KEY = ORDER_SORT_KEYS.departureDesc;

const ORDER_SORT_KEY_SET = new Set(Object.values(ORDER_SORT_KEYS));
const SORT_FALLBACK = 0;
const DEPARTURE_MISSING_TS = Number.NEGATIVE_INFINITY;

export function normalizeOrderSortKey(value) {
  const key = String(value || '').trim();
  return ORDER_SORT_KEY_SET.has(key) ? key : ORDER_DEFAULT_SORT_KEY;
}

export function getOrderSortOptions(t) {
  return [
    { id: ORDER_SORT_KEYS.departureDesc, label: t('orders_sort_departure_desc') },
    { id: ORDER_SORT_KEYS.departureAsc, label: t('orders_sort_departure_asc') },
    { id: ORDER_SORT_KEYS.createdDesc, label: t('orders_sort_created_desc') },
    { id: ORDER_SORT_KEYS.createdAsc, label: t('orders_sort_created_asc') },
    { id: ORDER_SORT_KEYS.amountDesc, label: t('orders_sort_amount_desc') },
    { id: ORDER_SORT_KEYS.amountAsc, label: t('orders_sort_amount_asc') },
  ];
}

function parseTimestamp(value) {
  const ts = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ts) ? ts : SORT_FALLBACK;
}

function parseDepartureTimestamp(value) {
  const ts = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ts) ? ts : DEPARTURE_MISSING_TS;
}

function parseAmount(item) {
  const value = Number(item?.start_price ?? item?.sum ?? SORT_FALLBACK);
  return Number.isFinite(value) ? value : SORT_FALLBACK;
}

function compareDesc(a, b) {
  return b - a;
}

function compareAsc(a, b) {
  return a - b;
}

function compareByDepartureDesc(a, b) {
  return compareDesc(parseDepartureTimestamp(a?.time_window_start), parseDepartureTimestamp(b?.time_window_start));
}

function compareByCreatedDesc(a, b) {
  return compareDesc(parseTimestamp(a?.created_at), parseTimestamp(b?.created_at));
}

export function sortOrders(orders, sortKey = ORDER_DEFAULT_SORT_KEY) {
  const key = normalizeOrderSortKey(sortKey);
  const source = Array.isArray(orders) ? orders : [];

  const arr = [...source];
  arr.sort((a, b) => {
    let result = 0;
    switch (key) {
      case ORDER_SORT_KEYS.departureAsc:
        result = compareAsc(parseDepartureTimestamp(a?.time_window_start), parseDepartureTimestamp(b?.time_window_start));
        return result || compareByCreatedDesc(a, b);
      case ORDER_SORT_KEYS.createdDesc:
        result = compareByCreatedDesc(a, b);
        return result || compareByDepartureDesc(a, b);
      case ORDER_SORT_KEYS.createdAsc:
        result = compareAsc(parseTimestamp(a?.created_at), parseTimestamp(b?.created_at));
        return result || compareByDepartureDesc(a, b);
      case ORDER_SORT_KEYS.amountDesc:
        result = compareDesc(parseAmount(a), parseAmount(b));
        return result || compareByDepartureDesc(a, b);
      case ORDER_SORT_KEYS.amountAsc:
        result = compareAsc(parseAmount(a), parseAmount(b));
        return result || compareByDepartureDesc(a, b);
      case ORDER_SORT_KEYS.departureDesc:
      default:
        return compareByDepartureDesc(a, b) || compareByCreatedDesc(a, b);
    }
  });
  return arr;
}

function orderByDeparture(query, ascending) {
  return query.order('time_window_start', {
    ascending,
    nullsFirst: ascending,
  });
}

export function applyOrderSortToQuery(query, sortKey = ORDER_DEFAULT_SORT_KEY) {
  const key = normalizeOrderSortKey(sortKey);
  switch (key) {
    case ORDER_SORT_KEYS.departureAsc:
      return orderByDeparture(query, true).order('created_at', { ascending: false });
    case ORDER_SORT_KEYS.createdDesc:
      return orderByDeparture(query.order('created_at', { ascending: false }), false);
    case ORDER_SORT_KEYS.createdAsc:
      return orderByDeparture(query.order('created_at', { ascending: true }), false);
    case ORDER_SORT_KEYS.amountDesc:
      return orderByDeparture(query.order('start_price', { ascending: false }), false);
    case ORDER_SORT_KEYS.amountAsc:
      return orderByDeparture(query.order('start_price', { ascending: true }), false);
    case ORDER_SORT_KEYS.departureDesc:
    default:
      return orderByDeparture(query, false).order('created_at', { ascending: false });
  }
}
