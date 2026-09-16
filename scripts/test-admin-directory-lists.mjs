import assert from 'node:assert/strict';

import {
  ADMIN_COMPANY_FILTER,
  ADMIN_COMPANY_SORT,
  ADMIN_USER_FILTER,
  ADMIN_USER_SORT,
  filterAdminCompanies,
  filterAdminUsers,
  sortAdminCompanies,
  sortAdminUsers,
} from '../src/features/admin/directoryLists.mjs';

const users = [
  {
    profile_id: 'u1',
    full_name: 'Борис',
    role: 'admin',
    company_id: 'c1',
    company_name: 'Альфа',
    created_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-01-03T00:00:00Z',
  },
  {
    profile_id: 'u2',
    full_name: 'Анна',
    role: 'worker',
    company_id: 'c2',
    company_name: 'Бета',
    created_at: '2026-02-01T00:00:00Z',
    last_seen_at: null,
  },
  {
    profile_id: 'u3',
    full_name: 'Яна',
    role: 'admin',
    company_id: null,
    is_super_admin: true,
    created_at: '2026-03-01T00:00:00Z',
    last_seen_at: '2026-01-04T00:00:00Z',
  },
];

assert.deepEqual(
  filterAdminUsers(users, [`${ADMIN_USER_FILTER.ROLE_PREFIX}worker`]).map((row) => row.profile_id),
  ['u2'],
);
assert.deepEqual(
  filterAdminUsers(users, [
    `${ADMIN_USER_FILTER.ROLE_PREFIX}${ADMIN_USER_FILTER.SUPER_ADMIN_ROLE}`,
    `${ADMIN_USER_FILTER.COMPANY_PREFIX}${ADMIN_USER_FILTER.UNASSIGNED_COMPANY}`,
  ]).map((row) => row.profile_id),
  ['u3'],
);
assert.deepEqual(
  sortAdminUsers(users, {
    sortKey: ADMIN_USER_SORT.NAME_ASC,
    getName: (row) => row.full_name,
  }).map((row) => row.profile_id),
  ['u2', 'u1', 'u3'],
);
assert.deepEqual(
  sortAdminUsers(users, {
    sortKey: ADMIN_USER_SORT.LAST_SEEN_NEW_OLD,
    getName: (row) => row.full_name,
  }).map((row) => row.profile_id),
  ['u3', 'u1', 'u2'],
);

const companies = [
  {
    company_id: 'c1',
    name: 'Альфа',
    employees_count: 12,
    subscription_status: 'active',
    current_period_end: '2026-12-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    admin_name: 'Admin',
  },
  {
    company_id: 'c2',
    name: 'Бета',
    employees_count: 3,
    subscription_status: 'expired',
    current_period_end: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    admin_name: null,
    admin_email: null,
  },
  {
    company_id: 'c3',
    name: 'Гамма',
    employees_count: 7,
    subscription_status: 'expired',
    current_period_end: null,
    updated_at: '2026-01-01T00:00:00Z',
    admin_email: 'admin@example.com',
  },
];

assert.deepEqual(
  filterAdminCompanies(companies, [
    `${ADMIN_COMPANY_FILTER.SUBSCRIPTION_PREFIX}${ADMIN_COMPANY_FILTER.SUBSCRIPTION_NOT_CONFIGURED}`,
    `${ADMIN_COMPANY_FILTER.ADMIN_PREFIX}${ADMIN_COMPANY_FILTER.ADMIN_ASSIGNED}`,
  ]).map((row) => row.company_id),
  ['c3'],
);
assert.deepEqual(
  sortAdminCompanies(companies, {
    sortKey: ADMIN_COMPANY_SORT.EMPLOYEES_MANY_FEW,
  }).map((row) => row.company_id),
  ['c1', 'c3', 'c2'],
);
assert.deepEqual(
  sortAdminCompanies(companies, {
    sortKey: ADMIN_COMPANY_SORT.SUBSCRIPTION_END_SOON_LATE,
  }).map((row) => row.company_id),
  ['c2', 'c1', 'c3'],
);

process.stdout.write('Admin directory filter and sort scenarios passed.\n');
