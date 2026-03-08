export const OBJECT_SORT = Object.freeze({
  NAME_ASC: 'name_asc',
  NAME_DESC: 'name_desc',
  CITY_ASC: 'city_asc',
  CITY_DESC: 'city_desc',
  CLIENT_ASC: 'client_asc',
  CLIENT_DESC: 'client_desc',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function textCmp(a, b) {
  return normalizeText(a).localeCompare(normalizeText(b), 'ru', { sensitivity: 'base' });
}

export function objectSortOptions(t) {
  return [
    { id: OBJECT_SORT.NAME_ASC, label: t('sort_name_asc') },
    { id: OBJECT_SORT.NAME_DESC, label: t('sort_name_desc') },
    { id: OBJECT_SORT.CITY_ASC, label: t('sort_city_asc', 'Город А-Я') },
    { id: OBJECT_SORT.CITY_DESC, label: t('sort_city_desc', 'Город Я-А') },
    { id: OBJECT_SORT.CLIENT_ASC, label: t('sort_client_asc', 'Клиент А-Я') },
    { id: OBJECT_SORT.CLIENT_DESC, label: t('sort_client_desc', 'Клиент Я-А') },
  ];
}

export function sortObjects(
  list,
  {
    sortKey = OBJECT_SORT.NAME_ASC,
    getName = (item) => item?.name || '',
    getCity = (item) => item?.city || '',
    getClientName = (item) => item?.client?.full_name || item?.client_name || '',
  } = {},
) {
  const rows = Array.isArray(list) ? [...list] : [];
  rows.sort((a, b) => {
    const byNameAsc = textCmp(getName(a), getName(b));
    if (sortKey === OBJECT_SORT.NAME_ASC) return byNameAsc;
    if (sortKey === OBJECT_SORT.NAME_DESC) return -byNameAsc;

    if (sortKey === OBJECT_SORT.CITY_ASC) {
      const diff = textCmp(getCity(a), getCity(b));
      return diff !== 0 ? diff : byNameAsc;
    }
    if (sortKey === OBJECT_SORT.CITY_DESC) {
      const diff = textCmp(getCity(b), getCity(a));
      return diff !== 0 ? diff : byNameAsc;
    }

    if (sortKey === OBJECT_SORT.CLIENT_ASC) {
      const diff = textCmp(getClientName(a), getClientName(b));
      return diff !== 0 ? diff : byNameAsc;
    }
    if (sortKey === OBJECT_SORT.CLIENT_DESC) {
      const diff = textCmp(getClientName(b), getClientName(a));
      return diff !== 0 ? diff : byNameAsc;
    }

    return byNameAsc;
  });
  return rows;
}
