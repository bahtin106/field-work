export const queryKeys = {
  requests: {
    all: (params = {}) => ['requests', 'all', params],
    my: (params = {}) => ['requests', 'my', params],
    calendar: (params = {}) => ['requests', 'calendar', params],
    detail: (id) => ['requests', 'detail', String(id || '')],
    assigneeName: (userId) => ['requests', 'assignee-name', String(userId || '')],
    filterOptions: () => ['requests', 'filter-options'],
    executors: () => ['requests', 'executors'],
  },
  employees: {
    list: (params = {}) => ['employees', 'list', params],
    detail: (id) => ['employees', 'detail', String(id || '')],
    departments: (companyId, onlyEnabled = true) => ['employees', 'departments', String(companyId || ''), !!onlyEnabled],
  },
  profile: {
    me: () => ['profile', 'me'],
    role: () => ['profile', 'role'],
    companyId: () => ['profile', 'company-id'],
  },
};
