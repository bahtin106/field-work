import { clearMyCompanyIdRuntimeCache, getMyCompanyId } from './workTypes';

const companyIdByUserId = new Map();
const errorByUserId = new Map();
const loadingByUserId = new Map();

function normalizeUserId(userId) {
  return String(userId || '').trim();
}

export function readCompanyIdCache(userId) {
  const key = normalizeUserId(userId);
  if (!key) return { status: 'miss', companyId: null, error: null };
  if (companyIdByUserId.has(key)) {
    return { status: 'value', companyId: companyIdByUserId.get(key) ?? null, error: null };
  }
  if (errorByUserId.has(key)) {
    return { status: 'error', companyId: null, error: errorByUserId.get(key) };
  }
  return { status: 'miss', companyId: null, error: null };
}

export function cacheCompanyIdForUser(userId, companyId) {
  const key = normalizeUserId(userId);
  if (!key) return;
  companyIdByUserId.set(key, companyId ?? null);
  errorByUserId.delete(key);
}

export async function loadCompanyIdForUser(userId) {
  const key = normalizeUserId(userId);
  if (!key) return null;
  const cached = readCompanyIdCache(key);
  if (cached.status === 'value') return cached.companyId;
  if (loadingByUserId.has(key)) return loadingByUserId.get(key);

  const loadingPromise = getMyCompanyId({ userId: key })
    .then((companyId) => {
      cacheCompanyIdForUser(key, companyId ?? null);
      return companyId ?? null;
    })
    .catch((error) => {
      errorByUserId.set(key, error);
      throw error;
    })
    .finally(() => {
      loadingByUserId.delete(key);
    });

  loadingByUserId.set(key, loadingPromise);
  return loadingPromise;
}

export function clearCompanyIdCache() {
  companyIdByUserId.clear();
  errorByUserId.clear();
  loadingByUserId.clear();
  clearMyCompanyIdRuntimeCache();
}
