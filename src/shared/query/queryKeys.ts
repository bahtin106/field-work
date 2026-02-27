export const queryKeys = {
  requests: {
    all: (params = {}) => ['requests', 'all', params],
    my: (params = {}) => ['requests', 'my', params],
    calendar: (params = {}) => ['requests', 'calendar', params],
    detail: (id) => ['requests', 'detail', String(id || '')],
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
  profile: {
    me: () => ['profile', 'me'],
    role: () => ['profile', 'role'],
    companyId: () => ['profile', 'company-id'],
  },
};
