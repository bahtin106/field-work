import { useMemo } from 'react';
import { useTranslation } from '../../src/i18n/useTranslation';
import FiltersPanel from './FiltersPanel';

const EMPTY_ARRAY = Object.freeze([]);

const normalizeOptions = (items, labelResolver) => (Array.isArray(items) ? items : [])
  .map((item) => {
    const id = String(item?.id || '').trim();
    if (!id) return null;
    return {
      ...item,
      id,
      value: id,
      label: labelResolver?.(id, item) || String(item?.label || id),
    };
  })
  .filter(Boolean);

const buildCountMap = (items) => Object.fromEntries(
  (Array.isArray(items) ? items : []).map((item) => [String(item?.id || ''), Number(item?.count || 0)]),
);

export default function TrashFiltersPanel({ options = {}, ...panelProps }) {
  const { t } = useTranslation();
  const normalized = useMemo(() => {
    const entityTypes = normalizeOptions(options.entityTypes, (id) => t(`trash_entity_${id}`));
    const deletedBy = normalizeOptions(options.deletedBy);
    const statuses = normalizeOptions(options.statuses);
    const workTypes = normalizeOptions(options.workTypes);
    const clients = normalizeOptions(options.clients);
    const executors = normalizeOptions(options.executors);
    const cities = normalizeOptions(options.cities);
    const streets = normalizeOptions(options.streets);
    const clientTags = normalizeOptions(options.clientTags);
    const objectTags = normalizeOptions(options.objectTags);
    const mediaOwnerTypes = normalizeOptions(options.mediaOwnerTypes, (id) => t(`trash_media_owner_${id}`));
    return {
      entityTypes,
      deletedBy,
      statuses,
      workTypes,
      clients,
      executors,
      cities,
      streets,
      clientTags,
      objectTags,
      mediaOwnerTypes,
    };
  }, [options, t]);

  const total = normalized.entityTypes.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const facetCounts = {
    total,
    statuses: buildCountMap(normalized.statuses),
    workTypes: buildCountMap(normalized.workTypes),
    clients: buildCountMap(normalized.clients),
    clientTags: buildCountMap(normalized.clientTags),
    objectTags: buildCountMap(normalized.objectTags),
  };

  return (
    <FiltersPanel
      {...panelProps}
      mode="trash"
      showSearchCategory={false}
      inlineOptionSearch={{
        categoryKeys: [
          'trash_deletedBy',
          'orders_workTypes',
          'orders_clients',
          'orders_executors',
          'orders_clientTags',
          'orders_objectTags',
          'objects_cities',
          'objects_streets',
        ],
      }}
      trashFilters={{
        entityTypes: normalized.entityTypes,
        deletedBy: normalized.deletedBy,
        mediaOwnerTypes: normalized.mediaOwnerTypes,
      }}
      ordersFilters={{
        statuses: normalized.statuses,
        workTypes: normalized.workTypes,
        clients: normalized.clients,
        executors: normalized.executors,
        clientTags: normalized.clientTags,
        objectTags: normalized.objectTags,
        executorSelectionMode: 'multiple',
        facetCounts,
      }}
      objectFilters={{
        cities: normalized.cities,
        streets: normalized.streets,
        clients: EMPTY_ARRAY,
        tags: normalized.objectTags,
      }}
    />
  );
}
