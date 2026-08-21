import AsyncStorage from '@react-native-async-storage/async-storage';

// These snapshots are UI continuity hints only. Supabase RLS/RPC remains the
// authorization boundary for every protected read and mutation.
const SNAPSHOT_VERSION = 1;
const LOCAL_READ_WATCHDOG_MS = 1200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PERMISSION_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const VALID_ROLES = new Set(['admin', 'dispatcher', 'worker']);
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const PERMISSIONS_SNAPSHOT_STORAGE_PREFIX = 'app.permissions.v1:';
export const SUPER_ADMIN_SNAPSHOT_STORAGE_PREFIX = 'app.super-admin.v1:';
export const ACCESS_SNAPSHOT_STORAGE_PREFIXES = Object.freeze([
  PERMISSIONS_SNAPSHOT_STORAGE_PREFIX,
  SUPER_ADMIN_SNAPSHOT_STORAGE_PREFIX,
]);

function normalizeUuid(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return UUID_RE.test(normalized) ? normalized : null;
}

function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : null;
}

function sanitizePermissionMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const sanitized = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (
      UNSAFE_OBJECT_KEYS.has(key) ||
      !SAFE_PERMISSION_KEY_RE.test(key) ||
      typeof rawValue !== 'boolean'
    ) {
      continue;
    }
    sanitized[key] = rawValue;
  }
  return sanitized;
}

function sanitizePermissionMatrix(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const matrix = {};
  for (const role of VALID_ROLES) {
    const permissions = sanitizePermissionMap(value[role]);
    if (!permissions) return null;
    matrix[role] = permissions;
  }
  return matrix;
}

function parseStoredJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readWithSoftWatchdog(readPromise, options = {}) {
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : LOCAL_READ_WATCHDOG_MS;
  const timeoutMarker = Symbol('access-snapshot-timeout');
  let timeoutId = null;
  const guardedRead = Promise.resolve(readPromise).catch(() => null);

  const result = await Promise.race([
    guardedRead,
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(timeoutMarker), timeoutMs);
    }),
  ]);
  if (timeoutId) clearTimeout(timeoutId);
  if (result !== timeoutMarker) return result;

  guardedRead.then((lateValue) => {
    try {
      options.onLateValue?.(lateValue);
    } catch {}
  });
  return null;
}

function permissionsStorageKey(userId) {
  const normalizedUserId = normalizeUuid(userId);
  return normalizedUserId ? `${PERMISSIONS_SNAPSHOT_STORAGE_PREFIX}${normalizedUserId}` : null;
}

function superAdminStorageKey(userId) {
  const normalizedUserId = normalizeUuid(userId);
  return normalizedUserId ? `${SUPER_ADMIN_SNAPSHOT_STORAGE_PREFIX}${normalizedUserId}` : null;
}

function normalizePermissionsSnapshot(value, expectedUserId = null) {
  if (!value || Number(value.version) !== SNAPSHOT_VERSION) return null;

  const userId = normalizeUuid(value.user_id);
  const companyId = normalizeUuid(value.company_id);
  const role = normalizeRole(value.role);
  const matrix = sanitizePermissionMatrix(value.matrix);
  const expected = expectedUserId ? normalizeUuid(expectedUserId) : null;
  if (!userId || !companyId || !role || !matrix) return null;
  if (expected && userId !== expected) return null;

  const updatedAt = Number(value.updated_at);
  return {
    version: SNAPSHOT_VERSION,
    user_id: userId,
    company_id: companyId,
    role,
    matrix,
    updated_at: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
  };
}

function normalizeSuperAdminSnapshot(value, expectedUserId = null) {
  if (!value || Number(value.version) !== SNAPSHOT_VERSION) return null;

  const userId = normalizeUuid(value.user_id);
  const expected = expectedUserId ? normalizeUuid(expectedUserId) : null;
  if (!userId || typeof value.value !== 'boolean') return null;
  if (expected && userId !== expected) return null;

  const updatedAt = Number(value.updated_at);
  return {
    version: SNAPSHOT_VERSION,
    user_id: userId,
    value: value.value,
    updated_at: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
  };
}

export async function readPermissionsSnapshot(userId, options = {}) {
  const key = permissionsStorageKey(userId);
  if (!key) return null;
  return readWithSoftWatchdog(
    AsyncStorage.getItem(key).then((raw) =>
      normalizePermissionsSnapshot(parseStoredJson(raw), userId),
    ),
    options,
  );
}

export async function writePermissionsSnapshot(snapshot) {
  const normalized = normalizePermissionsSnapshot({
    ...snapshot,
    version: SNAPSHOT_VERSION,
    updated_at: Date.now(),
  });
  const key = permissionsStorageKey(normalized?.user_id);
  if (!normalized || !key) return false;

  try {
    await AsyncStorage.setItem(key, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export async function readSuperAdminSnapshot(userId, options = {}) {
  const key = superAdminStorageKey(userId);
  if (!key) return null;
  return readWithSoftWatchdog(
    AsyncStorage.getItem(key).then((raw) =>
      normalizeSuperAdminSnapshot(parseStoredJson(raw), userId),
    ),
    options,
  );
}

export async function writeSuperAdminSnapshot(userId, value) {
  const normalized = normalizeSuperAdminSnapshot({
    version: SNAPSHOT_VERSION,
    user_id: userId,
    value,
    updated_at: Date.now(),
  });
  const key = superAdminStorageKey(normalized?.user_id);
  if (!normalized || !key) return false;

  try {
    await AsyncStorage.setItem(key, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}
