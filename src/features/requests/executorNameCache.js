import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../lib/supabase';

const EXECUTOR_NAME_CACHE = (globalThis.EXECUTOR_NAME_CACHE ||= new Map());
const EXECUTOR_NAME_INFLIGHT = (globalThis.EXECUTOR_NAME_INFLIGHT ||= new Map());
const EXECUTOR_NAME_BATCH_STATE = (globalThis.EXECUTOR_NAME_BATCH_STATE ||= {
  pending: new Set(),
  waiters: new Map(),
  timer: null,
  flushing: false,
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
});

function looksLikeUuid(value) {
  const normalized = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(normalized);
}

function getCachedExecutorName(userId) {
  const uid = String(userId || '').trim();
  if (!uid || !EXECUTOR_NAME_CACHE.has(uid)) return '';
  const value = EXECUTOR_NAME_CACHE.get(uid);
  EXECUTOR_NAME_CACHE.delete(uid);
  EXECUTOR_NAME_CACHE.set(uid, value);
  return typeof value === 'string' ? value : '';
}

function setCachedExecutorName(userId, displayName) {
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
  scheduleExecutorNamePersist();
}

export function readCachedExecutorName(userId) {
  return getCachedExecutorName(userId);
}

function scheduleExecutorNamePersist() {
  if (EXECUTOR_NAME_PERSIST_STATE.persistTimer) {
    clearTimeout(EXECUTOR_NAME_PERSIST_STATE.persistTimer);
  }
  EXECUTOR_NAME_PERSIST_STATE.persistTimer = setTimeout(() => {
    EXECUTOR_NAME_PERSIST_STATE.persistTimer = null;
    persistExecutorNameCache().catch(() => {});
  }, EXECUTOR_NAME_PERSIST_DEBOUNCE_MS);
}

async function persistExecutorNameCache() {
  const entries = Array.from(EXECUTOR_NAME_CACHE.entries())
    .filter(([id, name]) => looksLikeUuid(id) && String(name || '').trim())
    .slice(-EXECUTOR_NAME_CACHE_MAX_ENTRIES);
  await AsyncStorage.setItem(
    EXECUTOR_NAME_PERSIST_STORAGE_KEY,
    JSON.stringify({
      savedAt: Date.now(),
      entries,
    }),
  );
}

export async function hydrateExecutorNameCache() {
  if (EXECUTOR_NAME_PERSIST_STATE.hydrated) return true;
  if (EXECUTOR_NAME_PERSIST_STATE.hydratePromise) return EXECUTOR_NAME_PERSIST_STATE.hydratePromise;

  EXECUTOR_NAME_PERSIST_STATE.hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(EXECUTOR_NAME_PERSIST_STORAGE_KEY);
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
            setCachedExecutorName(id, name);
          }
        });
      }
    } catch {
      // Best-effort warm cache; network path remains the source of truth.
    } finally {
      EXECUTOR_NAME_PERSIST_STATE.hydrated = true;
      EXECUTOR_NAME_PERSIST_STATE.hydratePromise = null;
    }
    return true;
  })();

  return EXECUTOR_NAME_PERSIST_STATE.hydratePromise;
}

function joinExecutorName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const fromParts = [obj.first_name, obj.middle_name, obj.last_name]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (fromParts) return fromParts;
  return (
    String(obj.full_name || '').trim() ||
    String(obj.display_name || '').trim() ||
    String(obj.name || '').trim() ||
    String(obj.email || '').trim()
  );
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
    const name = triple.map((part) => String(part || '').trim()).filter(Boolean).join(' ').trim();
    if (name) return name;
  }

  return '';
}

export function clearExecutorNameCache() {
  try {
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

export function seedExecutorNames(rows = []) {
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
    setCachedExecutorName(uid, directName);
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

async function fetchExecutorNamesViaRpc(ids) {
  const { data, error } = await supabase.rpc('get_order_executor_display_names', {
    p_user_ids: ids,
  });
  if (error) throw error;
  const names = {};
  (Array.isArray(data) ? data : []).forEach((row) => {
    const uid = String(row?.id || '').trim();
    const name = String(row?.display_name || '').trim();
    if (!uid || !name) return;
    setCachedExecutorName(uid, name);
    names[uid] = name;
  });
  return names;
}

async function fetchExecutorNamesViaProfiles(ids) {
  const { data, error } = await supabase
    .from('profiles')
    .select(EXECUTOR_PROFILE_SELECT)
    .in('id', ids);
  if (error) throw error;

  const names = {};
  (Array.isArray(data) ? data : []).forEach((row) => {
    const uid = String(row?.id || '').trim();
    if (!uid) return;
    const name = formatExecutorDisplayName(row);
    if (!name) return;
    setCachedExecutorName(uid, name);
    names[uid] = name;
  });
  return names;
}

export async function fetchExecutorNamesByIds(userIds = []) {
  await hydrateExecutorNameCache();
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
    const pending = EXECUTOR_NAME_INFLIGHT.get(id);
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
        return await fetchExecutorNamesViaRpc(missing);
      } catch {}

      try {
        return await fetchExecutorNamesViaProfiles(missing);
      } catch {
        return {};
      }
    })();

    missing.forEach((id) => {
      EXECUTOR_NAME_INFLIGHT.set(
        id,
        batchPromise.then((map) => map?.[id] || ''),
      );
    });

    inflight.push(
      batchPromise.then((map) => {
        Object.assign(names, map || {});
      }),
    );
  }

  try {
    await Promise.all(inflight);
  } finally {
    missing.forEach((id) => {
      EXECUTOR_NAME_INFLIGHT.delete(id);
    });
  }

  return names;
}

export async function enrichOrdersWithExecutorNames(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  await hydrateExecutorNameCache();
  seedExecutorNames(list);
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
    fetchedNames = await fetchExecutorNamesByIds(missingIds);
  }

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

function scheduleExecutorNameBatch() {
  if (EXECUTOR_NAME_BATCH_STATE.timer || EXECUTOR_NAME_BATCH_STATE.flushing) return;
  EXECUTOR_NAME_BATCH_STATE.timer = setTimeout(() => {
    EXECUTOR_NAME_BATCH_STATE.timer = null;
    flushExecutorNameBatch().catch(() => {});
  }, EXECUTOR_NAME_BATCH_DELAY_MS);
}

async function flushExecutorNameBatch() {
  if (EXECUTOR_NAME_BATCH_STATE.flushing) return;
  const ids = Array.from(EXECUTOR_NAME_BATCH_STATE.pending).slice(0, EXECUTOR_NAME_BATCH_MAX_IDS);
  ids.forEach((id) => EXECUTOR_NAME_BATCH_STATE.pending.delete(id));
  if (!ids.length) return;

  EXECUTOR_NAME_BATCH_STATE.flushing = true;
  try {
    const { data, error } = await supabase
      .rpc('get_order_executor_display_names', { p_user_ids: ids });
    if (error) {
      const fallback = await fetchExecutorNamesViaProfiles(ids);
      ids.forEach((uid) => {
        const value = fallback?.[uid] || '';
        resolveExecutorNameWaiters(uid, value);
        EXECUTOR_NAME_INFLIGHT.delete(uid);
      });
      return;
    }

    ids.forEach((uid) => {
      const value = (Array.isArray(data) ? data : []).find((row) => String(row?.id || '') === uid)?.display_name || '';
      if (value) setCachedExecutorName(uid, value);
      resolveExecutorNameWaiters(uid, value);
      EXECUTOR_NAME_INFLIGHT.delete(uid);
    });
  } catch {
    ids.forEach((uid) => {
      setCachedExecutorName(uid, '');
      resolveExecutorNameWaiters(uid, '');
      EXECUTOR_NAME_INFLIGHT.delete(uid);
    });
  } finally {
    EXECUTOR_NAME_BATCH_STATE.flushing = false;
    if (EXECUTOR_NAME_BATCH_STATE.pending.size > 0) {
      scheduleExecutorNameBatch();
    }
  }
}

export async function fetchExecutorNameById(userId) {
  await hydrateExecutorNameCache();
  const uid = String(userId || '').trim();
  if (!uid || !looksLikeUuid(uid)) return '';
  if (EXECUTOR_NAME_CACHE.has(uid)) return getCachedExecutorName(uid);
  if (EXECUTOR_NAME_INFLIGHT.has(uid)) return EXECUTOR_NAME_INFLIGHT.get(uid);

  const runner = new Promise((resolve) => {
    const waiters = EXECUTOR_NAME_BATCH_STATE.waiters.get(uid) || [];
    waiters.push(resolve);
    EXECUTOR_NAME_BATCH_STATE.waiters.set(uid, waiters);
    EXECUTOR_NAME_BATCH_STATE.pending.add(uid);
    scheduleExecutorNameBatch();
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
