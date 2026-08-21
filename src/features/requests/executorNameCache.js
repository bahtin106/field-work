import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../lib/supabase';
import { formatPersonName, formatPersonNameParts } from '../../../lib/personName';

const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());
const EXECUTOR_NAME_INFLIGHT = (globalThis.EXECUTOR_NAME_INFLIGHT ||= new Map());
const EXECUTOR_NAME_BATCH_STATE = (globalThis.EXECUTOR_NAME_BATCH_STATE ||= {
  pending: new Set(),
  waiters: new Map(),
  timer: null,
  flushing: false,
  controller: null,
});

const EXECUTOR_NAME_CACHE_MAX_ENTRIES = 300;
const EXECUTOR_NAME_BATCH_DELAY_MS = 20;
const EXECUTOR_NAME_BATCH_MAX_IDS = 80;
const EXECUTOR_NAME_PERSIST_STORAGE_KEY = 'requests.executorNames.v1';
const EXECUTOR_NAME_PERSIST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const EXECUTOR_NAME_PERSIST_DEBOUNCE_MS = 500;
const EXECUTOR_PROFILE_SELECT = 'id, first_name, middle_name, last_name, full_name, email';
const ORDER_EXECUTOR_NAME_KEYS = [
  'assigned_to_name',
  'assigned_to_fullname',
  'assigned_to_fio',
  'assignee_name',
  'assignee_fullname',
  'assignee_fio',
  'executor_name',
  'executor_fullname',
  'executor_fio',
  'worker_name',
  'worker_fullname',
  'worker_fio',
  'responsible_name',
  'responsible_fullname',
];
const ORDER_EXECUTOR_PROFILE_KEYS = [
  'assigned_to_profile',
  'executor_profile',
  'assignee_profile',
  'assigned_user',
  'executor_user',
  'worker_user',
  'assigned_to_user',
];
const EXECUTOR_NAME_PERSIST_STATE = (globalThis.EXECUTOR_NAME_PERSIST_STATE ||= {
  hydrated: false,
  hydratePromise: null,
  persistTimer: null,
  generation: 0,
  writeChain: Promise.resolve(),
});
if (!Number.isFinite(EXECUTOR_NAME_PERSIST_STATE.generation)) {
  EXECUTOR_NAME_PERSIST_STATE.generation = 0;
}
if (!EXECUTOR_NAME_PERSIST_STATE.writeChain?.then) {
  EXECUTOR_NAME_PERSIST_STATE.writeChain = Promise.resolve();
}

function getExecutorNameCacheGeneration() {
  return Number(EXECUTOR_NAME_PERSIST_STATE.generation || 0);
}

function throwIfExecutorCacheGenerationChanged(expectedGeneration) {
  if (expectedGeneration === getExecutorNameCacheGeneration()) return;
  const error = new Error('Executor name cache scope changed');
  error.name = 'AbortError';
  throw error;
}

function throwIfExecutorReadAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('Executor name read was aborted');
  error.name = 'AbortError';
  throw error;
}

function looksLikeUuid(value) {
  const normalized = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized);
}

function getCachedExecutorName(userId) {
  const uid = String(userId || '').trim();
  if (!uid || !EXECUTOR_NAME_CACHE.has(uid)) return '';
  const value = EXECUTOR_NAME_CACHE.get(uid);
  EXECUTOR_NAME_CACHE.delete(uid);
  EXECUTOR_NAME_CACHE.set(uid, value);
  return typeof value === 'string' ? value : '';
}

function setCachedExecutorName(
  userId,
  displayName,
  expectedGeneration = getExecutorNameCacheGeneration(),
) {
  if (expectedGeneration !== getExecutorNameCacheGeneration()) return;
  const uid = String(userId || '').trim();
  if (!uid) return;
  const value = String(displayName || '').trim();
  if (!value) {
    EXECUTOR_NAME_CACHE.delete(uid);
    return;
  }
  EXECUTOR_NAME_CACHE.delete(uid);
  EXECUTOR_NAME_CACHE.set(uid, value);
  while (EXECUTOR_NAME_CACHE.size > EXECUTOR_NAME_CACHE_MAX_ENTRIES) {
    const oldestKey = EXECUTOR_NAME_CACHE.keys().next()?.value;
    if (oldestKey == null) break;
    EXECUTOR_NAME_CACHE.delete(oldestKey);
  }
  scheduleExecutorNamePersist(expectedGeneration);
}

export function readCachedExecutorName(userId) {
  return getCachedExecutorName(userId);
}

function scheduleExecutorNamePersist(expectedGeneration = getExecutorNameCacheGeneration()) {
  if (expectedGeneration !== getExecutorNameCacheGeneration()) return;
  if (EXECUTOR_NAME_PERSIST_STATE.persistTimer) {
    clearTimeout(EXECUTOR_NAME_PERSIST_STATE.persistTimer);
  }
  EXECUTOR_NAME_PERSIST_STATE.persistTimer = setTimeout(() => {
    EXECUTOR_NAME_PERSIST_STATE.persistTimer = null;
    if (expectedGeneration !== getExecutorNameCacheGeneration()) return;
    persistExecutorNameCache(expectedGeneration).catch(() => {});
  }, EXECUTOR_NAME_PERSIST_DEBOUNCE_MS);
}

function persistExecutorNameCache(expectedGeneration = getExecutorNameCacheGeneration()) {
  const run = async () => {
    if (expectedGeneration !== getExecutorNameCacheGeneration()) return false;
    const entries = Array.from(EXECUTOR_NAME_CACHE.entries())
      .filter(([id, name]) => looksLikeUuid(id) && String(name || '').trim())
      .slice(-EXECUTOR_NAME_CACHE_MAX_ENTRIES);
    const serialized = JSON.stringify({
      savedAt: Date.now(),
      entries,
    });
    if (expectedGeneration !== getExecutorNameCacheGeneration()) return false;
    await AsyncStorage.setItem(EXECUTOR_NAME_PERSIST_STORAGE_KEY, serialized);
    if (expectedGeneration !== getExecutorNameCacheGeneration()) {
      const current = await AsyncStorage.getItem(EXECUTOR_NAME_PERSIST_STORAGE_KEY).catch(() => null);
      if (current === serialized) {
        await AsyncStorage.removeItem(EXECUTOR_NAME_PERSIST_STORAGE_KEY).catch(() => {});
      }
      return false;
    }
    return true;
  };
  const queued = EXECUTOR_NAME_PERSIST_STATE.writeChain.then(run, run);
  EXECUTOR_NAME_PERSIST_STATE.writeChain = queued.catch(() => {});
  return queued;
}

export async function hydrateExecutorNameCache() {
  if (EXECUTOR_NAME_PERSIST_STATE.hydrated) return true;
  if (EXECUTOR_NAME_PERSIST_STATE.hydratePromise) return EXECUTOR_NAME_PERSIST_STATE.hydratePromise;

  const expectedGeneration = getExecutorNameCacheGeneration();
  const hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(EXECUTOR_NAME_PERSIST_STORAGE_KEY);
      throwIfExecutorCacheGenerationChanged(expectedGeneration);
      const parsed = raw ? JSON.parse(raw) : null;
      const savedAt = Number(parsed?.savedAt || 0);
      if (
        parsed &&
        Number.isFinite(savedAt) &&
        Date.now() - savedAt <= EXECUTOR_NAME_PERSIST_MAX_AGE_MS &&
        Array.isArray(parsed.entries)
      ) {
        parsed.entries.forEach(([id, name]) => {
          if (looksLikeUuid(id) && String(name || '').trim()) {
            setCachedExecutorName(id, name, expectedGeneration);
          }
        });
      }
    } catch {
      if (expectedGeneration !== getExecutorNameCacheGeneration()) return false;
      // Best-effort warm cache; network path remains the source of truth.
    } finally {
      if (
        expectedGeneration === getExecutorNameCacheGeneration() &&
        EXECUTOR_NAME_PERSIST_STATE.hydratePromise === hydratePromise
      ) {
        EXECUTOR_NAME_PERSIST_STATE.hydrated = true;
        EXECUTOR_NAME_PERSIST_STATE.hydratePromise = null;
      }
    }
    return true;
  })();
  EXECUTOR_NAME_PERSIST_STATE.hydratePromise = hydratePromise;

  return hydratePromise;
}

function joinExecutorName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return formatPersonName(obj, obj.email || '');
}

function readDirectExecutorName(row) {
  if (!row || typeof row !== 'object') return '';

  for (const key of ORDER_EXECUTOR_NAME_KEYS) {
    const value = row?.[key];
    if (typeof value === 'string' && value.trim() && !looksLikeUuid(value)) {
      return value.trim();
    }
    const nestedName = joinExecutorName(value);
    if (nestedName && !looksLikeUuid(nestedName)) return nestedName;
  }

  for (const key of ORDER_EXECUTOR_PROFILE_KEYS) {
    const nestedName = joinExecutorName(row?.[key]);
    if (nestedName && !looksLikeUuid(nestedName)) return nestedName;
    const userName = joinExecutorName(row?.[key]?.user);
    if (userName && !looksLikeUuid(userName)) return userName;
  }

  const triples = [
    [row?.assigned_to_first_name, row?.assigned_to_middle_name, row?.assigned_to_last_name],
    [row?.executor_first_name, row?.executor_middle_name, row?.executor_last_name],
    [row?.assignee_first_name, row?.assignee_middle_name, row?.assignee_last_name],
    [row?.worker_first_name, row?.worker_middle_name, row?.worker_last_name],
  ];
  for (const triple of triples) {
    const [firstName, middleName, lastName] = triple;
    const name = formatPersonNameParts({ firstName, middleName, lastName });
    if (name) return name;
  }

  return '';
}

export function clearExecutorNameCache() {
  try {
    EXECUTOR_NAME_PERSIST_STATE.generation = getExecutorNameCacheGeneration() + 1;
    try {
      EXECUTOR_NAME_BATCH_STATE.controller?.abort();
    } catch {}
    EXECUTOR_NAME_BATCH_STATE.controller = null;
    for (const waiters of EXECUTOR_NAME_BATCH_STATE.waiters.values()) {
      (Array.isArray(waiters) ? waiters : []).forEach((resolve) => {
        try {
          resolve('');
        } catch {}
      });
    }
    EXECUTOR_NAME_CACHE.clear();
    EXECUTOR_NAME_INFLIGHT.clear();
    EXECUTOR_NAME_BATCH_STATE.pending.clear();
    EXECUTOR_NAME_BATCH_STATE.waiters.clear();
    if (EXECUTOR_NAME_BATCH_STATE.timer) {
      clearTimeout(EXECUTOR_NAME_BATCH_STATE.timer);
      EXECUTOR_NAME_BATCH_STATE.timer = null;
    }
    EXECUTOR_NAME_BATCH_STATE.flushing = false;
    if (EXECUTOR_NAME_PERSIST_STATE.persistTimer) {
      clearTimeout(EXECUTOR_NAME_PERSIST_STATE.persistTimer);
      EXECUTOR_NAME_PERSIST_STATE.persistTimer = null;
    }
    EXECUTOR_NAME_PERSIST_STATE.hydrated = false;
    EXECUTOR_NAME_PERSIST_STATE.hydratePromise = null;
  } catch {}
}

export function seedExecutorNames(
  rows = [],
  { expectedGeneration = getExecutorNameCacheGeneration() } = {},
) {
  if (expectedGeneration !== getExecutorNameCacheGeneration()) return;
  for (const row of Array.isArray(rows) ? rows : []) {
    const profileLike =
      row?.first_name != null ||
      row?.middle_name != null ||
      row?.last_name != null ||
      row?.full_name != null ||
      row?.email != null ||
      row?.display_name != null;
    const uid = String(profileLike ? row?.id : row?.assigned_to || '').trim();
    if (!uid || !looksLikeUuid(uid)) continue;
    const directName =
      String(row?.display_name || '').trim() ||
      readDirectExecutorName(row) ||
      formatExecutorDisplayName(row);
    if (!directName) continue;
    setCachedExecutorName(uid, directName, expectedGeneration);
  }
}

export function formatExecutorDisplayName(row) {
  if (!row || typeof row !== 'object') return '';
  return joinExecutorName(row);
}

export function readOrderExecutorName(order) {
  if (!order || typeof order !== 'object') return '';
  const direct = readDirectExecutorName(order);
  if (direct) return direct;
  return readCachedExecutorName(order?.assigned_to);
}

async function fetchExecutorNamesViaRpc(
  ids,
  signal,
  expectedGeneration = getExecutorNameCacheGeneration(),
) {
  let query = supabase.rpc('get_order_executor_display_names', {
    p_user_ids: ids,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  throwIfExecutorCacheGenerationChanged(expectedGeneration);
  if (error) throw error;
  const names = {};
  (Array.isArray(data) ? data : []).forEach((row) => {
    const uid = String(row?.id || '').trim();
    const name = String(row?.display_name || '').trim();
    if (!uid || !name) return;
    setCachedExecutorName(uid, name, expectedGeneration);
    names[uid] = name;
  });
  return names;
}

async function fetchExecutorNamesViaProfiles(
  ids,
  signal,
  expectedGeneration = getExecutorNameCacheGeneration(),
) {
  let query = supabase
    .from('profiles')
    .select(EXECUTOR_PROFILE_SELECT)
    .in('id', ids);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  throwIfExecutorCacheGenerationChanged(expectedGeneration);
  if (error) throw error;

  const names = {};
  (Array.isArray(data) ? data : []).forEach((row) => {
    const uid = String(row?.id || '').trim();
    if (!uid) return;
    const name = formatExecutorDisplayName(row);
    if (!name) return;
    setCachedExecutorName(uid, name, expectedGeneration);
    names[uid] = name;
  });
  return names;
}

export async function fetchExecutorNamesByIds(userIds = [], { signal } = {}) {
  const expectedGeneration = getExecutorNameCacheGeneration();
  await hydrateExecutorNameCache();
  throwIfExecutorCacheGenerationChanged(expectedGeneration);
  throwIfExecutorReadAborted(signal);
  const ids = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => id && looksLikeUuid(id)),
    ),
  );
  if (!ids.length) return {};

  const names = {};
  const inflight = [];
  const missing = [];

  ids.forEach((id) => {
    if (EXECUTOR_NAME_CACHE.has(id)) {
      names[id] = getCachedExecutorName(id);
      return;
    }
    const pending = signal ? null : EXECUTOR_NAME_INFLIGHT.get(id);
    if (pending) {
      inflight.push(
        pending.then((name) => {
          names[id] = name || '';
        }),
      );
      return;
    }
    missing.push(id);
  });

  let batchPromise = null;
  if (missing.length) {
    batchPromise = (async () => {
      try {
        return await fetchExecutorNamesViaRpc(missing, signal, expectedGeneration);
      } catch {
        throwIfExecutorReadAborted(signal);
      }

      try {
        return await fetchExecutorNamesViaProfiles(missing, signal, expectedGeneration);
      } catch {
        throwIfExecutorReadAborted(signal);
        return {};
      }
    })();

    if (!signal) {
      missing.forEach((id) => {
        EXECUTOR_NAME_INFLIGHT.set(
          id,
          batchPromise.then((map) => map?.[id] || ''),
        );
      });
    }

    inflight.push(
      batchPromise.then((map) => {
        Object.assign(names, map || {});
      }),
    );
  }

  try {
    await Promise.all(inflight);
    throwIfExecutorCacheGenerationChanged(expectedGeneration);
    throwIfExecutorReadAborted(signal);
  } finally {
    if (!signal && expectedGeneration === getExecutorNameCacheGeneration()) {
      missing.forEach((id) => {
        EXECUTOR_NAME_INFLIGHT.delete(id);
      });
    }
  }

  return names;
}

export async function enrichOrdersWithExecutorNames(rows = [], { signal } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const expectedGeneration = getExecutorNameCacheGeneration();
  await hydrateExecutorNameCache();
  throwIfExecutorCacheGenerationChanged(expectedGeneration);
  throwIfExecutorReadAborted(signal);
  seedExecutorNames(list, { expectedGeneration });
  const missingIds = Array.from(
    new Set(
      list
        .filter((row) => !readOrderExecutorName(row))
        .map((row) => String(row?.assigned_to || '').trim())
        .filter((id) => id && looksLikeUuid(id)),
    ),
  );

  let fetchedNames = {};
  if (missingIds.length) {
    fetchedNames = await fetchExecutorNamesByIds(missingIds, { signal });
  }
  throwIfExecutorCacheGenerationChanged(expectedGeneration);
  throwIfExecutorReadAborted(signal);

  return list.map((row) => {
    const uid = String(row?.assigned_to || '').trim();
    const name = readOrderExecutorName(row) || fetchedNames?.[uid] || '';
    if (!name) return row;
    if (
      String(row?.assigned_to_name || '').trim() === name &&
      String(row?.executor_name || '').trim() === name
    ) {
      return row;
    }
    return {
      ...row,
      assigned_to_name: String(row?.assigned_to_name || '').trim() || name,
      executor_name: String(row?.executor_name || '').trim() || name,
    };
  });
}

export function enrichOrdersWithKnownExecutorRows(rows = [], executorRows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const executors = Array.isArray(executorRows) ? executorRows : [];
  if (!list.length || !executors.length) return list;

  seedExecutorNames(executors);
  const namesById = new Map();
  executors.forEach((row) => {
    const uid = String(row?.id || '').trim();
    const name = formatExecutorDisplayName(row);
    if (uid && name) namesById.set(uid, name);
  });
  if (!namesById.size) return list;

  return list.map((row) => {
    const uid = String(row?.assigned_to || '').trim();
    const name = namesById.get(uid) || '';
    if (!name) return row;
    if (String(row?.assigned_to_name || '').trim() || String(row?.executor_name || '').trim()) {
      return row;
    }
    return {
      ...row,
      assigned_to_name: name,
      executor_name: name,
    };
  });
}

function resolveExecutorNameWaiters(uid, value) {
  const waiters = EXECUTOR_NAME_BATCH_STATE.waiters.get(uid) || [];
  EXECUTOR_NAME_BATCH_STATE.waiters.delete(uid);
  waiters.forEach((resolve) => {
    try {
      resolve(value);
    } catch {}
  });
}

function scheduleExecutorNameBatch(expectedGeneration = getExecutorNameCacheGeneration()) {
  if (expectedGeneration !== getExecutorNameCacheGeneration()) return;
  if (EXECUTOR_NAME_BATCH_STATE.timer || EXECUTOR_NAME_BATCH_STATE.flushing) return;
  EXECUTOR_NAME_BATCH_STATE.timer = setTimeout(() => {
    EXECUTOR_NAME_BATCH_STATE.timer = null;
    if (expectedGeneration !== getExecutorNameCacheGeneration()) return;
    flushExecutorNameBatch(expectedGeneration).catch(() => {});
  }, EXECUTOR_NAME_BATCH_DELAY_MS);
}

async function flushExecutorNameBatch(expectedGeneration = getExecutorNameCacheGeneration()) {
  if (expectedGeneration !== getExecutorNameCacheGeneration()) return;
  if (EXECUTOR_NAME_BATCH_STATE.flushing) return;
  const ids = Array.from(EXECUTOR_NAME_BATCH_STATE.pending).slice(0, EXECUTOR_NAME_BATCH_MAX_IDS);
  ids.forEach((id) => EXECUTOR_NAME_BATCH_STATE.pending.delete(id));
  if (!ids.length) return;

  EXECUTOR_NAME_BATCH_STATE.flushing = true;
  const controller = new AbortController();
  EXECUTOR_NAME_BATCH_STATE.controller = controller;
  try {
    const { data, error } = await supabase
      .rpc('get_order_executor_display_names', { p_user_ids: ids })
      .abortSignal(controller.signal);
    throwIfExecutorCacheGenerationChanged(expectedGeneration);
    if (error) {
      const fallback = await fetchExecutorNamesViaProfiles(
        ids,
        controller.signal,
        expectedGeneration,
      );
      throwIfExecutorCacheGenerationChanged(expectedGeneration);
      ids.forEach((uid) => {
        const value = fallback?.[uid] || '';
        resolveExecutorNameWaiters(uid, value);
        EXECUTOR_NAME_INFLIGHT.delete(uid);
      });
      return;
    }

    ids.forEach((uid) => {
      const value = (Array.isArray(data) ? data : []).find((row) => String(row?.id || '') === uid)?.display_name || '';
      if (value) setCachedExecutorName(uid, value, expectedGeneration);
      resolveExecutorNameWaiters(uid, value);
      EXECUTOR_NAME_INFLIGHT.delete(uid);
    });
  } catch {
    if (expectedGeneration !== getExecutorNameCacheGeneration()) return;
    ids.forEach((uid) => {
      setCachedExecutorName(uid, '', expectedGeneration);
      resolveExecutorNameWaiters(uid, '');
      EXECUTOR_NAME_INFLIGHT.delete(uid);
    });
  } finally {
    if (EXECUTOR_NAME_BATCH_STATE.controller === controller) {
      EXECUTOR_NAME_BATCH_STATE.controller = null;
      EXECUTOR_NAME_BATCH_STATE.flushing = false;
      if (EXECUTOR_NAME_BATCH_STATE.pending.size > 0) {
        scheduleExecutorNameBatch(expectedGeneration);
      }
    }
  }
}

export async function fetchExecutorNameById(userId) {
  const expectedGeneration = getExecutorNameCacheGeneration();
  await hydrateExecutorNameCache();
  throwIfExecutorCacheGenerationChanged(expectedGeneration);
  const uid = String(userId || '').trim();
  if (!uid || !looksLikeUuid(uid)) return '';
  if (EXECUTOR_NAME_CACHE.has(uid)) return getCachedExecutorName(uid);
  if (EXECUTOR_NAME_INFLIGHT.has(uid)) return EXECUTOR_NAME_INFLIGHT.get(uid);

  const runner = new Promise((resolve) => {
    const waiters = EXECUTOR_NAME_BATCH_STATE.waiters.get(uid) || [];
    waiters.push(resolve);
    EXECUTOR_NAME_BATCH_STATE.waiters.set(uid, waiters);
    EXECUTOR_NAME_BATCH_STATE.pending.add(uid);
    scheduleExecutorNameBatch(expectedGeneration);
  });

  EXECUTOR_NAME_INFLIGHT.set(uid, runner);
  return runner;
}

export function prefetchExecutorNames(userIds = []) {
  const ids = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => id && looksLikeUuid(id)),
    ),
  );
  if (!ids.length) return Promise.resolve({});
  return Promise.all(ids.map((id) => fetchExecutorNameById(id))).then((names) =>
    ids.reduce((acc, id, index) => {
      acc[id] = names[index] || '';
      return acc;
    }, {}),
  );
}
