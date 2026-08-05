export const queryKeys = {
  requests: {
    all: (params = {}) => ['requests', 'all', params],
    my: (params = {}) => ['requests', 'my', params],
    relatedCount: ({ scope = 'my', clientId = '', objectIds = [] } = {}) => [
      'requests',
      scope === 'all' ? 'all' : 'my',
      'related-count',
      String(clientId || '').trim(),
      Array.from(
        new Set(
          (Array.isArray(objectIds) ? objectIds : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean),
        ),
      )
        .sort()
        .join(','),
    ],
    calendar: (params = {}) => ['requests', 'calendar', params],
    detail: (id) => ['requests', 'detail', String(id || '')],
    activity: (id) => ['requests', 'activity', String(id || '')],
    assigneeName: (userId) => ['requests', 'assignee-name', String(userId || '')],
    filterOptions: () => ['requests', 'filter-options'],
    executors: (companyId = null) => ['requests', 'executors', String(companyId || '')],
  },
  employees: {
    list: (params = {}) => ['employees', 'list', params],
    detail: (id) => ['employees', 'detail', String(id || '')],
    departments: (companyId, onlyEnabled = true) => ['employees', 'departments', String(companyId || ''), !!onlyEnabled],
  },
  clients: {
    list: (params = {}) => ['clients', 'list', params],
    detail: (id) => ['clients', 'detail', String(id || '')],
    orderCount: (id) => ['clients', 'order-count', String(id || '')],
  },
  objects: {
    byClient: (clientId) => ['objects', 'by-client', String(clientId || '')],
    byCompany: (companyId) => ['objects', 'by-company', String(companyId || '')],
    searchForOrder: (params = {}) => ['objects', 'search-for-order', params],
    detail: (id) => ['objects', 'detail', String(id || '')],
  },
  trash: {
    list: (params = {}) => ['trash', 'list', params],
    detail: (id) => ['trash', 'detail', String(id || '')],
    filterOptions: () => ['trash', 'filter-options'],
  },
  fieldSettings: {
    detail: (entityType) => ['field-settings', 'detail', String(entityType || '')],
  },
  tags: {
    list: ({ companyId = '', tagType = '' } = {}) => ['tags', 'list', String(companyId || ''), String(tagType || '')],
    suggestions: ({ tagType = '', query = '' } = {}) => ['tags', 'suggestions', String(tagType || ''), String(query || '')],
  },
  profile: {
    me: () => ['profile', 'me'],
    role: () => ['profile', 'role'],
    companyId: () => ['profile', 'company-id'],
  },
};
