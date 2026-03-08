export const CLIENT_SORT = Object.freeze({
  NAME_ASC: 'name_asc',
  NAME_DESC: 'name_desc',
  CREATED_NEW_OLD: 'created_new_old',
  CREATED_OLD_NEW: 'created_old_new',
  OBJECTS_MANY_FEW: 'objects_many_few',
  OBJECTS_FEW_MANY: 'objects_few_many',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function textCmp(a, b) {
  return normalizeText(a).localeCompare(normalizeText(b), 'ru', { sensitivity: 'base' });
}

function toMs(value) {
  const d = new Date(value || 0);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function clientSortOptions(t) {
  return [
    { id: CLIENT_SORT.NAME_ASC, label: t('sort_name_asc') },
    { id: CLIENT_SORT.NAME_DESC, label: t('sort_name_desc') },
    { id: CLIENT_SORT.CREATED_NEW_OLD, label: t('sort_created_new_old', 'Сначала новые') },
    { id: CLIENT_SORT.CREATED_OLD_NEW, label: t('sort_created_old_new', 'Сначала старые') },
    { id: CLIENT_SORT.OBJECTS_MANY_FEW, label: t('sort_objects_many_few', 'Больше объектов') },
    { id: CLIENT_SORT.OBJECTS_FEW_MANY, label: t('sort_objects_few_many', 'Меньше объектов') },
  ];
}

export function sortClients(
  list,
  {
    sortKey = CLIENT_SORT.NAME_ASC,
    getName = (item) => item?.fullName || item?.full_name || '',
    getCreatedAt = (item) => item?.created_at || null,
    getObjectsCount = (item) => (Array.isArray(item?.objects) ? item.objects.length : 0),
  } = {},
) {
  const rows = Array.isArray(list) ? [...list] : [];
  rows.sort((a, b) => {
    const byNameAsc = textCmp(getName(a), getName(b));
    if (sortKey === CLIENT_SORT.NAME_ASC) return byNameAsc;
    if (sortKey === CLIENT_SORT.NAME_DESC) return -byNameAsc;

    if (sortKey === CLIENT_SORT.CREATED_NEW_OLD) {
      const diff = toMs(getCreatedAt(b)) - toMs(getCreatedAt(a));
      return diff !== 0 ? diff : byNameAsc;
    }
    if (sortKey === CLIENT_SORT.CREATED_OLD_NEW) {
      const diff = toMs(getCreatedAt(a)) - toMs(getCreatedAt(b));
      return diff !== 0 ? diff : byNameAsc;
    }

    if (sortKey === CLIENT_SORT.OBJECTS_MANY_FEW) {
      const diff = Number(getObjectsCount(b) || 0) - Number(getObjectsCount(a) || 0);
      return diff !== 0 ? diff : byNameAsc;
    }
    if (sortKey === CLIENT_SORT.OBJECTS_FEW_MANY) {
      const diff = Number(getObjectsCount(a) || 0) - Number(getObjectsCount(b) || 0);
      return diff !== 0 ? diff : byNameAsc;
    }

    return byNameAsc;
  });
  return rows;
}
