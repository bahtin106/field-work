import FiltersPanel from './FiltersPanel';

const EMPTY_ARRAY = Object.freeze([]);

export default function OrdersFiltersPanel({
  statusOptions = EMPTY_ARRAY,
  workTypeOptions = EMPTY_ARRAY,
  clientOptions = EMPTY_ARRAY,
  executorOptions = EMPTY_ARRAY,
  showExecutors = false,
  facetCounts,
  ordersFilters = null,
  ...panelProps
}) {
  const inlineCategoryKeys = [
    'orders_workTypes',
    ...(showExecutors ? ['orders_executors'] : []),
    'orders_clients',
  ];

  return (
    <FiltersPanel
      {...panelProps}
      mode="orders"
      showSearchCategory={false}
      inlineOptionSearch={{ categoryKeys: inlineCategoryKeys }}
      ordersFilters={{
        statuses: statusOptions,
        workTypes: workTypeOptions,
        clients: clientOptions,
        executors: showExecutors ? executorOptions : EMPTY_ARRAY,
        ...(showExecutors ? { executorSelectionMode: 'multiple' } : null),
        facetCounts,
        showDate: true,
        showTime: true,
        showCreatedDate: true,
        showCreatedTime: true,
        showAmount: true,
        ...ordersFilters,
      }}
    />
  );
}
