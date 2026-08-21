// hooks/useOrderMedia.js
// Centralised hook for resolving, caching and managing order photos.
// Handles both beget_s3 and yandex_disk providers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cacheDirectory,
  createDownloadResumable,
  deleteAsync,
  getInfoAsync,
} from 'expo-file-system/legacy';
import { yandexDiskMedia } from '../lib/yandexDiskIntegration';
import { orderMediaStorage } from '../lib/orderMediaStorage';
import {
  canRunDeferredNetworkWork,
  getActiveOfflineOwnerContext,
  getOfflineSnapshot,
  isActiveOfflineOwnerContext,
  useOfflineSnapshot,
} from '../src/shared/offline/offlineStatus';
import {
  buildMediaAssetDisplayMap,
  buildMediaAssetInfoMap,
  buildMediaAssetThumbMap,
  listMediaAssets,
} from '../src/shared/media/assets';
import { prefetchMediaUrls } from '../src/shared/media/imagePipeline';
import { isSignedMediaUrlStale } from '../src/shared/media/signedUrl';

const MEDIA_CATEGORIES = ['media_file_1', 'media_file_2', 'media_file_3', 'media_file_4', 'media_file_5'];

/** Weak per-order cache so resolved URLs survive hook re-mounts within same session. */
const _globalResolvedCache = new Map();  // key → display URL
const _globalIssuesCache   = new Map();  // key → issue object
const _globalThumbCache = new Map();
const _globalMediaInfoCache = new Map();
const GLOBAL_MEDIA_CACHE_MAX_ENTRIES = 1200;
const ORDER_MEDIA_LOCAL_CACHE_LEGACY_KEY = 'offline.orderMedia.localCache.v1';
const ORDER_MEDIA_LOCAL_CACHE_KEY = 'offline.orderMedia.localCache.v2';
const ORDER_MEDIA_LOCAL_CACHE_SCHEMA = 2;
const ORDER_MEDIA_LOCAL_CACHE_MAX_ENTRIES = 220;
const MAX_URL_PROBE_RETRIES = 2;
const URL_PROBE_RETRY_BASE_DELAY_MS = 900;
let orderMediaCacheGeneration = 0;
let orderMediaIndexMutation = Promise.resolve();
const activeLocalCacheJobs = new Set();

function enqueueOrderMediaIndexMutation(work) {
  const next = orderMediaIndexMutation.catch(() => {}).then(work);
  orderMediaIndexMutation = next.catch(() => {});
  return next;
}

function normalizeLocalCacheOwner(owner) {
  const userId = String(owner?.userId || '').trim();
  const companyId = String(owner?.companyId || '').trim();
  return userId && companyId ? { userId, companyId } : null;
}

function isSameLocalCacheOwner(left, right) {
  const normalizedLeft = normalizeLocalCacheOwner(left);
  const normalizedRight = normalizeLocalCacheOwner(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft.userId === normalizedRight.userId &&
      normalizedLeft.companyId === normalizedRight.companyId,
  );
}

function captureOrderMediaCacheScope() {
  const ownerContext = getActiveOfflineOwnerContext();
  if (!ownerContext) return null;
  return { ownerContext, generation: orderMediaCacheGeneration };
}

function isOrderMediaCacheScopeActive(scope) {
  return Boolean(
    scope &&
      scope.generation === orderMediaCacheGeneration &&
      isActiveOfflineOwnerContext(scope.ownerContext),
  );
}

function normalizeLocalCacheEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = {};
  for (const [key, fileUri] of Object.entries(value)) {
    const normalizedKey = String(key || '').trim();
    const normalizedFileUri = String(fileUri || '').trim();
    if (!normalizedKey || !normalizedFileUri) continue;
    entries[normalizedKey] = normalizedFileUri;
  }
  return entries;
}

function parseLocalCacheEnvelope(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const owner = normalizeLocalCacheOwner(parsed?.owner);
    if (parsed?.schema !== ORDER_MEDIA_LOCAL_CACHE_SCHEMA || !owner) return null;
    return {
      schema: ORDER_MEDIA_LOCAL_CACHE_SCHEMA,
      owner,
      entries: normalizeLocalCacheEntries(parsed.entries),
    };
  } catch {
    return null;
  }
}

function serializeLocalCacheEnvelope(scope, entries) {
  const owner = normalizeLocalCacheOwner(scope?.ownerContext?.owner);
  if (!owner) return '';
  return JSON.stringify({
    schema: ORDER_MEDIA_LOCAL_CACHE_SCHEMA,
    owner,
    entries: normalizeLocalCacheEntries(entries),
  });
}

function getLegacyLocalCacheEntries(raw) {
  if (!raw) return {};
  try {
    return normalizeLocalCacheEntries(JSON.parse(raw));
  } catch {
    return {};
  }
}

function getUntrustedEnvelopeEntries(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return normalizeLocalCacheEntries(parsed?.entries);
  } catch {
    return {};
  }
}

function isManagedOrderMediaCacheFile(fileUri) {
  const normalizedUri = String(fileUri || '').trim();
  return Boolean(
    cacheDirectory &&
      normalizedUri.startsWith(`${cacheDirectory}order_media_`) &&
      isLocalFileUri(normalizedUri),
  );
}

async function deleteManagedLocalCacheFiles(entries) {
  const files = new Set(
    Object.values(normalizeLocalCacheEntries(entries)).filter(isManagedOrderMediaCacheFile),
  );
  await Promise.all(
    [...files].map((fileUri) => deleteAsync(fileUri, { idempotent: true }).catch(() => {})),
  );
}

async function discardLocalCacheIndexIfUnchanged(storageKey, expectedRaw, entries) {
  if (!expectedRaw) return;
  await enqueueOrderMediaIndexMutation(async () => {
    try {
      const currentRaw = await AsyncStorage.getItem(storageKey);
      if (currentRaw !== expectedRaw) return;
      await AsyncStorage.removeItem(storageKey);
      await deleteManagedLocalCacheFiles(entries);
    } catch {}
  });
}

function abortLocalCacheJob(job) {
  if (!job || job.controller.signal.aborted) return;
  job.controller.abort();
  job.downloadTask?.cancelAsync?.().catch(() => {});
}

export async function clearOrderMediaCaches() {
  orderMediaCacheGeneration += 1;
  const activeJobEntries = {};
  for (const [index, job] of [...activeLocalCacheJobs].entries()) {
    if (job.fileUri) activeJobEntries[`active:${index}`] = job.fileUri;
    abortLocalCacheJob(job);
  }
  _globalResolvedCache.clear();
  _globalThumbCache.clear();
  _globalIssuesCache.clear();
  _globalMediaInfoCache.clear();
  await enqueueOrderMediaIndexMutation(async () => {
    try {
      const [rawCurrent, rawLegacy] = await Promise.all([
        AsyncStorage.getItem(ORDER_MEDIA_LOCAL_CACHE_KEY),
        AsyncStorage.getItem(ORDER_MEDIA_LOCAL_CACHE_LEGACY_KEY),
      ]);
      const currentEntries =
        parseLocalCacheEnvelope(rawCurrent)?.entries || getUntrustedEnvelopeEntries(rawCurrent);
      const legacyEntries = getLegacyLocalCacheEntries(rawLegacy);
      await AsyncStorage.multiRemove([
        ORDER_MEDIA_LOCAL_CACHE_KEY,
        ORDER_MEDIA_LOCAL_CACHE_LEGACY_KEY,
      ]);
      await Promise.all([
        deleteManagedLocalCacheFiles(currentEntries),
        deleteManagedLocalCacheFiles(legacyEntries),
        deleteManagedLocalCacheFiles(activeJobEntries),
      ]);
    } catch {}
  });
}

function pruneMapCache(map, maxEntries = GLOBAL_MEDIA_CACHE_MAX_ENTRIES) {
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next()?.value;
    if (oldestKey == null) break;
    map.delete(oldestKey);
  }
}

function setResolvedCacheEntry(key, value) {
  if (!key) return;
  const current = _globalResolvedCache.get(key);
  if (isLocalFileUri(current) && !isLocalFileUri(value)) return;
  if (_globalResolvedCache.has(key)) _globalResolvedCache.delete(key);
  _globalResolvedCache.set(key, value);
  pruneMapCache(_globalResolvedCache);
}

function setIssueCacheEntry(key, value) {
  if (!key) return;
  if (_globalIssuesCache.has(key)) _globalIssuesCache.delete(key);
  _globalIssuesCache.set(key, value);
  pruneMapCache(_globalIssuesCache);
}

function isLikelyYandexLink(url) {
  const raw = String(url || '').toLowerCase();
  return raw.startsWith('yadisk://') || raw.includes('yadi.sk') || raw.includes('disk.yandex');
}

function isResolvableRemoteUrl(url) {
  const raw = String(url || '').trim().toLowerCase();
  if (!raw) return false;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return true;
  return raw.startsWith('yadisk://');
}

function isLocalFileUri(url) {
  return /^file:\/\//i.test(String(url || '').trim());
}

function isRenderableSourceUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (isLocalFileUri(raw) || /^data:image\//i.test(raw)) return true;
  if (!/^https?:\/\//i.test(raw)) return false;
  return !isLikelyYandexLink(raw);
}

function isDestructiveMediaIssueCode(code) {
  const normalized = String(code || '').trim();
  return normalized === 'deleted_remote' || normalized === 'missing_mapping';
}

function sanitizeMediaIssues(issuesMap) {
  const source = issuesMap && typeof issuesMap === 'object' ? issuesMap : {};
  const next = {};
  for (const [url, issue] of Object.entries(source)) {
    if (isDestructiveMediaIssueCode(issue?.code)) continue;
    next[url] = issue;
  }
  return next;
}

function mergeResolvedUrlsPreservingLocal(current, incoming) {
  const currentMap = current && typeof current === 'object' ? current : {};
  const incomingMap = incoming && typeof incoming === 'object' ? incoming : {};
  let next = currentMap;
  for (const [key, value] of Object.entries(incomingMap)) {
    if (isLocalFileUri(currentMap[key]) || currentMap[key] === value) continue;
    if (next === currentMap) next = { ...currentMap };
    next[key] = value;
  }
  return next;
}

function mergeStringMapIfChanged(current, incoming) {
  const currentMap = current && typeof current === 'object' ? current : {};
  const incomingMap = incoming && typeof incoming === 'object' ? incoming : {};
  let next = currentMap;
  for (const [key, value] of Object.entries(incomingMap)) {
    if (currentMap[key] === value) continue;
    if (next === currentMap) next = { ...currentMap };
    next[key] = value;
  }
  return next;
}

function makeStableFileToken(value, seed = 2166136261) {
  let hash = seed >>> 0;
  const raw = String(value || '');
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function makeLocalFileName(url, owner) {
  const ownerIdentity = `${String(owner?.userId || '').trim()}:${String(owner?.companyId || '').trim()}`;
  const ownerToken = `${makeStableFileToken(ownerIdentity)}${makeStableFileToken(ownerIdentity, 2246822519)}`;
  const normalized = encodeURIComponent(String(url || '').trim()).slice(0, 180);
  return `order_media_${ownerToken}_${normalized}.jpg`;
}

function normalizeUrlCacheKey(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw.split('?')[0].split('#')[0];
  }
}

function pruneLocalCacheMap(mapObj, maxEntries = ORDER_MEDIA_LOCAL_CACHE_MAX_ENTRIES) {
  const obj = mapObj && typeof mapObj === 'object' ? mapObj : {};
  const keys = Object.keys(obj);
  if (keys.length <= maxEntries) return obj;
  const overflow = keys.length - maxEntries;
  for (let i = 0; i < overflow; i += 1) {
    delete obj[keys[i]];
  }
  return obj;
}

async function runWithConcurrency(items, worker, concurrency = 2) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return;
  let cursor = 0;
  const runnerCount = Math.max(1, Math.min(concurrency, source.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      try {
        await worker(source[index], index);
      } catch {}
    }
  });
  await Promise.all(runners);
}

/**
 * Resolves display URLs for order media — parallelised for speed.
 *
 * @param {object} params
 * @param {object|null} params.order          – current order object (must have .id)
 * @param {string} params.mediaProvider       – 'beget_s3' | 'yandex_disk'
 * @param {(key: string) => string} params.t  – i18n translate fn
 * @returns {{ resolvedUrls, issues, resolveOrder, syncPhotos, getDisplayUrl, inspectSingle }}
 */
export function useOrderMedia({ order, mediaProvider, t }) {
  const localCacheScopeRef = useRef(undefined);
  if (localCacheScopeRef.current === undefined) {
    localCacheScopeRef.current = captureOrderMediaCacheScope();
  }
  // Seed local state from global cache for instant display on re-mount
  const [resolvedUrls, setResolvedUrls] = useState(() => Object.fromEntries(_globalResolvedCache));
  const [thumbUrls, setThumbUrls] = useState(() => Object.fromEntries(_globalThumbCache));
  const [issues, setIssues] = useState(() => Object.fromEntries(_globalIssuesCache));
  const [mediaInfoBySource, setMediaInfoBySource] = useState(() => Object.fromEntries(_globalMediaInfoCache));
  const [localCacheVersion, setLocalCacheVersion] = useState(0);
  const [probeRetryTick, setProbeRetryTick] = useState(0);
  const offlineSnapshot = useOfflineSnapshot();
  const canUseMediaNetwork = canRunDeferredNetworkWork(offlineSnapshot);
  const canUseMediaNetworkRef = useRef(canUseMediaNetwork);
  const probeInFlight = useRef(new Map());
  const probedUrlsRef = useRef(new Set()); // tracks URLs already probed this session
  const probeRetryCountsRef = useRef(new Map());
  const probeRetryTimerRef = useRef(null);
  const isMounted = useRef(true);
  const resolvedRef = useRef(resolvedUrls); // always-current snapshot (no stale closures)
  const localCacheRef = useRef({});
  const localDownloadJobsRef = useRef(new Set());
  const mediaSignature = useMemo(
    () =>
      MEDIA_CATEGORIES.map((category) =>
        Array.isArray(order?.[category]) ? order[category].map((value) => String(value || '')).join(',') : '',
      ).join('|'),
    [order],
  );

  const markLocalCacheChanged = useCallback(() => {
    setLocalCacheVersion((value) => (value + 1) % 1000000);
  }, []);

  const isLocalCacheScopeActive = useCallback(
    () => isOrderMediaCacheScopeActive(localCacheScopeRef.current),
    [],
  );

  useEffect(() => {
    const localDownloadJobs = localDownloadJobsRef.current;
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      for (const job of [...localDownloadJobs]) abortLocalCacheJob(job);
      localDownloadJobs.clear();
      if (probeRetryTimerRef.current) {
        clearTimeout(probeRetryTimerRef.current);
        probeRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    canUseMediaNetworkRef.current = canUseMediaNetwork;
    if (!canUseMediaNetwork && probeRetryTimerRef.current) {
      clearTimeout(probeRetryTimerRef.current);
      probeRetryTimerRef.current = null;
    }
    if (!canUseMediaNetwork) {
      for (const job of [...localDownloadJobsRef.current]) abortLocalCacheJob(job);
    }
  }, [canUseMediaNetwork]);

  const scheduleProbeRetry = useCallback((urls) => {
    if (!canUseMediaNetworkRef.current || !isLocalCacheScopeActive()) return;
    const list = Array.isArray(urls) ? urls : [urls];
    let maxAttempt = 0;
    let hasRetry = false;
    for (const value of list) {
      const url = String(value || '').trim();
      if (!url) continue;
      const attempts = Number(probeRetryCountsRef.current.get(url) || 0);
      if (attempts >= MAX_URL_PROBE_RETRIES) continue;
      const nextAttempt = attempts + 1;
      probeRetryCountsRef.current.set(url, nextAttempt);
      maxAttempt = Math.max(maxAttempt, nextAttempt);
      hasRetry = true;
    }
    if (!hasRetry || probeRetryTimerRef.current) return;
    probeRetryTimerRef.current = setTimeout(() => {
      probeRetryTimerRef.current = null;
      if (
        isMounted.current &&
        canUseMediaNetworkRef.current &&
        isLocalCacheScopeActive()
      ) {
        setProbeRetryTick((value) => (value + 1) % 1000000);
      }
    }, URL_PROBE_RETRY_BASE_DELAY_MS * Math.max(1, maxAttempt));
  }, [isLocalCacheScopeActive]);

  useEffect(() => {
    const scope = localCacheScopeRef.current;
    if (!isOrderMediaCacheScopeActive(scope)) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [rawCurrent, rawLegacy] = await Promise.all([
          AsyncStorage.getItem(ORDER_MEDIA_LOCAL_CACHE_KEY),
          AsyncStorage.getItem(ORDER_MEDIA_LOCAL_CACHE_LEGACY_KEY),
        ]);
        const legacyEntries = getLegacyLocalCacheEntries(rawLegacy);
        if (rawLegacy) {
          discardLocalCacheIndexIfUnchanged(
            ORDER_MEDIA_LOCAL_CACHE_LEGACY_KEY,
            rawLegacy,
            legacyEntries,
          ).catch(() => {});
        }
        if (cancelled || !isOrderMediaCacheScopeActive(scope) || !rawCurrent) return;
        const envelope = parseLocalCacheEnvelope(rawCurrent);
        if (!envelope || !isSameLocalCacheOwner(envelope.owner, scope.ownerContext.owner)) {
          const staleEntries = envelope?.entries || getUntrustedEnvelopeEntries(rawCurrent);
          discardLocalCacheIndexIfUnchanged(
            ORDER_MEDIA_LOCAL_CACHE_KEY,
            rawCurrent,
            staleEntries,
          ).catch(() => {});
          return;
        }
        localCacheRef.current = {
          ...envelope.entries,
          ...(localCacheRef.current || {}),
        };
        if (Object.keys(localCacheRef.current).length) markLocalCacheChanged();
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [markLocalCacheChanged]);

  const persistLocalCache = useCallback(async () => {
    const scope = localCacheScopeRef.current;
    if (!isOrderMediaCacheScopeActive(scope)) return false;
    try {
      localCacheRef.current = pruneLocalCacheMap(localCacheRef.current);
      const serialized = serializeLocalCacheEnvelope(scope, localCacheRef.current || {});
      if (!serialized) return false;
      return await enqueueOrderMediaIndexMutation(async () => {
        if (!isOrderMediaCacheScopeActive(scope)) return false;
        await AsyncStorage.setItem(ORDER_MEDIA_LOCAL_CACHE_KEY, serialized);
        if (isOrderMediaCacheScopeActive(scope)) return true;
        const currentRaw = await AsyncStorage.getItem(ORDER_MEDIA_LOCAL_CACHE_KEY);
        if (currentRaw === serialized) await AsyncStorage.removeItem(ORDER_MEDIA_LOCAL_CACHE_KEY);
        return false;
      });
    } catch {
      return false;
    }
  }, []);

  const ensureLocalCached = useCallback(async (sourceUrl, displayUrl) => {
    const src = String(sourceUrl || '').trim();
    const remote = String(displayUrl || src).trim();
    if (!src || !remote) return;
    if (!/^https?:\/\//i.test(remote)) return;
    const scope = localCacheScopeRef.current;
    if (
      !isMounted.current ||
      !canUseMediaNetworkRef.current ||
      !isOrderMediaCacheScopeActive(scope) ||
      !cacheDirectory
    ) return;
    const job = { controller: new AbortController(), downloadTask: null, fileUri: '' };
    const isJobActive = () =>
      isMounted.current &&
      canUseMediaNetworkRef.current &&
      !job.controller.signal.aborted &&
      isOrderMediaCacheScopeActive(scope);
    activeLocalCacheJobs.add(job);
    localDownloadJobsRef.current.add(job);
    let createdFileUri = '';
    try {
      const normalizedSrc = normalizeUrlCacheKey(src);
      const normalizedRemote = normalizeUrlCacheKey(remote);
      const existing = String(
        localCacheRef.current?.[src] ||
          localCacheRef.current?.[normalizedSrc] ||
          localCacheRef.current?.[remote] ||
          localCacheRef.current?.[normalizedRemote] ||
          '',
      ).trim();
      if (existing) {
        const info = await getInfoAsync(existing, { size: true });
        if (!isJobActive()) return;
        if (info?.exists && Number(info?.size || 0) > 0) return;
        if (info?.exists) await deleteAsync(existing, { idempotent: true }).catch(() => {});
        if (!isJobActive()) return;
        const nextLocalCache = Object.fromEntries(
          Object.entries(localCacheRef.current || {}).filter(([, value]) => value !== existing),
        );
        localCacheRef.current = nextLocalCache;
        markLocalCacheChanged();
        await persistLocalCache();
      }
      if (!isJobActive()) return;
      const path = `${cacheDirectory}${makeLocalFileName(src, scope.ownerContext.owner)}`;
      createdFileUri = path;
      job.fileUri = path;
      job.downloadTask = createDownloadResumable(remote, path, {});
      if (!isJobActive()) {
        abortLocalCacheJob(job);
        return;
      }
      const result = await job.downloadTask.downloadAsync();
      const outputUri = String(result?.uri || path).trim();
      if (!isJobActive()) {
        await deleteAsync(outputUri, { idempotent: true }).catch(() => {});
        return;
      }
      const status = Number(result?.status);
      if (Number.isFinite(status) && status >= 400) {
        await deleteAsync(path, { idempotent: true }).catch(() => {});
        return;
      }
      const downloadedInfo = await getInfoAsync(outputUri, { size: true });
      if (!isJobActive()) {
        await deleteAsync(outputUri, { idempotent: true }).catch(() => {});
        return;
      }
      if (!downloadedInfo?.exists || Number(downloadedInfo?.size || 0) <= 0) {
        await deleteAsync(outputUri, { idempotent: true }).catch(() => {});
        return;
      }
      localCacheRef.current = {
        ...(localCacheRef.current || {}),
        [remote]: outputUri,
        [src]: outputUri,
        ...(normalizedSrc ? { [normalizedSrc]: outputUri } : {}),
        ...(normalizedRemote ? { [normalizedRemote]: outputUri } : {}),
      };
      localCacheRef.current = pruneLocalCacheMap(localCacheRef.current);
      markLocalCacheChanged();
      const persisted = await persistLocalCache();
      if (!persisted) {
        localCacheRef.current = Object.fromEntries(
          Object.entries(localCacheRef.current || {}).filter(([, value]) => value !== outputUri),
        );
        markLocalCacheChanged();
        await deleteAsync(outputUri, { idempotent: true }).catch(() => {});
      }
    } catch {
      if (createdFileUri) {
        await deleteAsync(createdFileUri, { idempotent: true }).catch(() => {});
      }
    } finally {
      activeLocalCacheJobs.delete(job);
      localDownloadJobsRef.current.delete(job);
    }
  }, [markLocalCacheChanged, persistLocalCache]);

  // Keep resolvedRef always in sync for proactive effect
  useEffect(() => {
    resolvedRef.current = resolvedUrls;
  }, [resolvedUrls]);

  // ─── Display URL resolution ──────────────────────────────────────
  const getDisplayUrl = useCallback(
    (sourceUrl) => {
      const source = String(sourceUrl || '').trim();
      if (!source) return '';
      // localCacheVersion refreshes this callback after ref-only cache updates.
      const localCache =
        localCacheVersion >= 0 && isLocalCacheScopeActive() ? localCacheRef.current || {} : {};
      const normalizedSource = normalizeUrlCacheKey(source);
      const resolved = String(resolvedUrls[source] || '').trim();
      const usableResolved = isSignedMediaUrlStale(resolved) ? '' : resolved;
      const normalizedResolved = normalizeUrlCacheKey(usableResolved);
      const localForResolved = String(
        usableResolved
          ? localCache?.[usableResolved] ||
            localCache?.[normalizedResolved] ||
            ''
          : '',
      ).trim();
      const localForSource = String(
        localCache?.[source] ||
          localCache?.[normalizedSource] ||
          '',
      ).trim();

      if (!getOfflineSnapshot().isOnline) {
        return localForSource || localForResolved || usableResolved || (isRenderableSourceUrl(source) ? source : '');
      }
      if (localForSource) return localForSource;
      if (localForResolved) return localForResolved;
      if (usableResolved) return usableResolved;
      return isRenderableSourceUrl(source) ? source : '';
    },
    [isLocalCacheScopeActive, localCacheVersion, resolvedUrls],
  );

  const getThumbnailUrl = useCallback(
    (sourceUrl) => {
      if (!sourceUrl) return '';
      const displayUrl = getDisplayUrl(sourceUrl);
      if (/^file:\/\//i.test(String(displayUrl || ''))) return displayUrl;
      return thumbUrls[sourceUrl] || displayUrl;
    },
    [getDisplayUrl, thumbUrls],
  );

  const getRemoteDisplayUrl = useCallback(
    (sourceUrl) => {
      const source = String(sourceUrl || '').trim();
      if (!source) return '';
      const resolved = String(resolvedUrls[source] || '').trim();
      if (resolved && !isLocalFileUri(resolved) && !isSignedMediaUrlStale(resolved)) return resolved;
      return isRenderableSourceUrl(source) ? source : '';
    },
    [resolvedUrls],
  );

  const getMediaInfo = useCallback(
    (sourceUrl) => mediaInfoBySource[String(sourceUrl || '').trim()] || null,
    [mediaInfoBySource],
  );

  const getIssue = useCallback(
    (sourceUrl) => {
      const issue = issues[sourceUrl];
      if (!issue) return '';
      const code = String(issue.code || '').trim();
      if (isDestructiveMediaIssueCode(code)) return '';
      if (code === 'disk_unavailable') return t('order_photo_issue_disk_unavailable');
      if (code === 'disk_auth') return t('order_photo_issue_disk_auth');
      if (code === 'disk_locked') return t('order_photo_issue_disk_locked');
      if (code === 'disk_error' || code === 'download_error') return t('order_photo_issue_temporary');
      if (code === 'client_network') return t('order_photo_issue_client_network');
      if (issue.message) return issue.message;
      return t('order_photo_issue_temporary');
    },
    [issues, t],
  );

  const canInspectUrl = useCallback(
    (sourceUrl) => Boolean(order?.id && isResolvableRemoteUrl(sourceUrl)),
    [order?.id],
  );

  // ─── Inspect single URL (Yandex) ─────────────────────────────────
  const inspectSingle = useCallback(
    (category, sourceUrl) => {
      const key = `${category}:${sourceUrl}`;
      const scope = localCacheScopeRef.current;
      if (!canInspectUrl(sourceUrl) || !isOrderMediaCacheScopeActive(scope)) {
        return Promise.resolve({ resolved: false, issue: false, displayUrl: '' });
      }
      const existingRequest = probeInFlight.current.get(key);
      if (existingRequest) return existingRequest;

      const request = (async () => {
        try {
          const data = isLikelyYandexLink(sourceUrl)
            ? await yandexDiskMedia('inspect_urls', {
                order_id: order.id,
                category,
                urls: [sourceUrl],
              })
            : await orderMediaStorage('inspect_urls', {
                order_id: order.id,
                category,
                urls: [sourceUrl],
              });
          const resolved =
            data?.resolved_urls && typeof data.resolved_urls === 'object' ? data.resolved_urls : {};
          const issuesMap =
            data?.issues && typeof data.issues === 'object' ? sanitizeMediaIssues(data.issues) : {};

          if (isMounted.current && isOrderMediaCacheScopeActive(scope)) {
            if (Object.keys(resolved).length) {
              for (const [k, v] of Object.entries(resolved)) setResolvedCacheEntry(k, v);
              setResolvedUrls((prev) => mergeResolvedUrlsPreservingLocal(prev, resolved));
              if (canUseMediaNetworkRef.current) {
                prefetchMediaUrls(Object.values(resolved), { batchSize: 2 }).catch(() => {});
              }
            }
            if (Object.keys(issuesMap).length) {
              for (const [k, v] of Object.entries(issuesMap)) setIssueCacheEntry(k, v);
              setIssues((p) => ({ ...p, ...issuesMap }));
            }
          }

          return {
            resolved: Boolean(resolved[sourceUrl]),
            issue: Boolean(issuesMap[sourceUrl]),
            displayUrl: String(resolved[sourceUrl] || '').trim(),
            mediaUrls: Array.isArray(data?.media_urls) ? data.media_urls : null,
          };
        } catch {
          return { resolved: false, issue: false, displayUrl: '' };
        } finally {
          if (probeInFlight.current.get(key) === request) {
            probeInFlight.current.delete(key);
          }
        }
      })();

      probeInFlight.current.set(key, request);
      return request;
    },
    [canInspectUrl, order?.id],
  );

  // ─── Full order inspection (Yandex) — parallelised ────────────
  const resolveOrder = useCallback(
    async (baseOrder) => {
      if (!baseOrder?.id) return baseOrder;
      if (!canUseMediaNetwork) return baseOrder;
      const scope = localCacheScopeRef.current;
      if (!isOrderMediaCacheScopeActive(scope)) return baseOrder;

      const nextOrder = { ...baseOrder };
      const categoryPromises = MEDIA_CATEGORIES.filter((cat) => {
        const urls = Array.isArray(nextOrder[cat])
          ? nextOrder[cat].filter((url) => Boolean(url && isResolvableRemoteUrl(url)))
          : [];
        return urls.length > 0;
      }).map(async (category) => {
        const originalUrls = Array.isArray(nextOrder[category])
          ? nextOrder[category].filter(Boolean)
          : [];
        const remoteUrls = originalUrls.filter((url) => Boolean(url && isResolvableRemoteUrl(url)));
        const yandexUrls = remoteUrls.filter((url) => isLikelyYandexLink(url));
        const begetUrls = remoteUrls.filter((url) => !isLikelyYandexLink(url));
        try {
          const [yandexData, begetData] = await Promise.all([
            yandexUrls.length
              ? yandexDiskMedia('inspect_urls', {
                  order_id: nextOrder.id,
                  category,
                  urls: yandexUrls,
                }).catch(() => null)
              : Promise.resolve(null),
            begetUrls.length
              ? orderMediaStorage('inspect_urls', {
                  order_id: nextOrder.id,
                  category,
                  urls: begetUrls,
                }).catch(() => null)
              : Promise.resolve(null),
          ]);
          const resolved = {
            ...(yandexData?.resolved_urls && typeof yandexData.resolved_urls === 'object' ? yandexData.resolved_urls : {}),
            ...(begetData?.resolved_urls && typeof begetData.resolved_urls === 'object' ? begetData.resolved_urls : {}),
          };
          const issuesMap = {
            ...(yandexData?.issues && typeof yandexData.issues === 'object' ? yandexData.issues : {}),
            ...(begetData?.issues && typeof begetData.issues === 'object' ? begetData.issues : {}),
          };
          return { category, resolved, issues: sanitizeMediaIssues(issuesMap) };
        } catch (e) {
          const message = String(e?.message || '').trim() || t('order_photo_issue_temporary');
          const issuesMap = {};
          for (const url of remoteUrls) {
            issuesMap[url] = { code: 'disk_error', message };
          }
          return { category, resolved: {}, issues: issuesMap, mediaUrls: originalUrls };
        }
      });

      // Run all category inspections in parallel
      const results = await Promise.all(categoryPromises);

      const nextResolved = {};
      const nextIssues = {};
      for (const r of results) {
        Object.assign(nextResolved, r.resolved);
        Object.assign(nextIssues, r.issues);
      }

      if (isMounted.current && isOrderMediaCacheScopeActive(scope)) {
        for (const [k, v] of Object.entries(nextResolved)) setResolvedCacheEntry(k, v);
        for (const [k, v] of Object.entries(nextIssues)) setIssueCacheEntry(k, v);
        setResolvedUrls((prev) => mergeResolvedUrlsPreservingLocal(prev, nextResolved));
        setIssues(nextIssues);
      }
      if (canUseMediaNetworkRef.current && isOrderMediaCacheScopeActive(scope)) {
        prefetchMediaUrls(Object.values(nextResolved), { batchSize: 2 }).catch(() => {});
        const cachedPairs = Object.entries(nextResolved);
        if (cachedPairs.length) {
          await runWithConcurrency(
            cachedPairs,
            ([source, display]) => ensureLocalCached(source, display),
          );
        }
      }
      return nextOrder;
    },
    [canUseMediaNetwork, ensureLocalCached, t],
  );

  // ─── Sync photos from Supabase Storage ───────────────────────────
  const syncPhotos = useCallback(async (_orderId) => {
    if (mediaProvider !== 'beget_s3') return null;
    return null;
  }, [mediaProvider]);

  // ─── Proactive URL resolution for Yandex (no dependency on resolvedUrls!) ──
  useEffect(() => {
    const scope = localCacheScopeRef.current;
    if (!order?.id || !canUseMediaNetwork || !isOrderMediaCacheScopeActive(scope)) return;
    let cancelled = false;
    listMediaAssets({ entityType: 'order', entityId: order.id, categories: MEDIA_CATEGORIES })
      .then((assets) => {
        if (cancelled || !isMounted.current || !isOrderMediaCacheScopeActive(scope)) return;
        const displayMap = buildMediaAssetDisplayMap(assets);
        const thumbMap = buildMediaAssetThumbMap(assets);
        const infoMap = buildMediaAssetInfoMap(assets);
        if (Object.keys(displayMap).length) {
          for (const [key, value] of Object.entries(displayMap)) setResolvedCacheEntry(key, value);
          setResolvedUrls((prev) => mergeResolvedUrlsPreservingLocal(prev, displayMap));
          if (canUseMediaNetworkRef.current) {
            prefetchMediaUrls(Object.values(displayMap), { batchSize: 2 }).catch(() => {});
          }
        }
        if (Object.keys(thumbMap).length) {
          for (const [key, value] of Object.entries(thumbMap)) {
            if (_globalThumbCache.has(key)) _globalThumbCache.delete(key);
            _globalThumbCache.set(key, value);
            pruneMapCache(_globalThumbCache);
          }
          setThumbUrls((prev) => mergeStringMapIfChanged(prev, thumbMap));
          if (canUseMediaNetworkRef.current) {
            prefetchMediaUrls(Object.values(thumbMap), { batchSize: 6 }).catch(() => {});
          }
        }
        if (Object.keys(infoMap).length) {
          for (const [key, value] of Object.entries(infoMap)) {
            if (_globalMediaInfoCache.has(key)) _globalMediaInfoCache.delete(key);
            _globalMediaInfoCache.set(key, value);
            pruneMapCache(_globalMediaInfoCache);
          }
          setMediaInfoBySource((prev) => ({ ...prev, ...infoMap }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canUseMediaNetwork, mediaSignature, order?.id]);

  useEffect(() => {
    const scope = localCacheScopeRef.current;
    if (!order?.id || !canUseMediaNetwork || !isOrderMediaCacheScopeActive(scope)) return;
    const attempts = [];
    const currentResolved = resolvedRef.current;
    for (const cat of MEDIA_CATEGORIES) {
      const urls = Array.isArray(order[cat]) ? order[cat].filter(Boolean) : [];
      for (const url of urls) {
        const source = String(url || '').trim();
        const currentDisplay = String(currentResolved[source] || '').trim();
        const needsRefresh = !currentDisplay || isSignedMediaUrlStale(currentDisplay);
        if (needsRefresh && isSignedMediaUrlStale(currentDisplay)) {
          probedUrlsRef.current.delete(source);
          _globalResolvedCache.delete(source);
        }
        if (needsRefresh && !probedUrlsRef.current.has(source) && isResolvableRemoteUrl(source)) {
          probedUrlsRef.current.add(source);
          attempts.push({ url: source, promise: inspectSingle(cat, source) });
        }
      }
    }
    if (attempts.length) {
      Promise.allSettled(attempts.map((item) => item.promise))
        .then((results) => {
          if (!isMounted.current || !isOrderMediaCacheScopeActive(scope)) return;
          const retryable = [];
          results.forEach((settled, index) => {
            const url = attempts[index]?.url;
            if (!url) return;
            const result = settled.status === 'fulfilled' ? settled.value : null;
            if (result?.resolved || result?.issue) {
              probeRetryCountsRef.current.delete(url);
              return;
            }
            probedUrlsRef.current.delete(url);
            retryable.push(url);
          });
          if (retryable.length) scheduleProbeRetry(retryable);
        })
        .catch(() => {});
    }
  }, [canUseMediaNetwork, order, inspectSingle, probeRetryTick, scheduleProbeRetry]);

  useEffect(() => {
    if (!order?.id || !canUseMediaNetwork) return;
    let cancelled = false;
    const jobs = [];
    for (const cat of MEDIA_CATEGORIES) {
      const urls = Array.isArray(order?.[cat]) ? order[cat].filter(Boolean) : [];
      for (const src of urls) {
        const source = String(src || '').trim();
        const display = resolvedRef.current?.[source] || (isRenderableSourceUrl(source) ? source : '');
        if (display) jobs.push({ source, display });
      }
    }
    if (jobs.length) {
      runWithConcurrency(jobs, ({ source, display }) => {
        if (cancelled || !canUseMediaNetworkRef.current) return undefined;
        return ensureLocalCached(source, display);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [canUseMediaNetwork, ensureLocalCached, order]);

  // ─── Clear caches on provider/order switch ──────────────────────
  const clearCaches = useCallback(() => {
    setResolvedUrls({});
    setThumbUrls({});
    setIssues({});
    setMediaInfoBySource({});
    probedUrlsRef.current.clear();
    probeRetryCountsRef.current.clear();
    if (probeRetryTimerRef.current) {
      clearTimeout(probeRetryTimerRef.current);
      probeRetryTimerRef.current = null;
    }
    _globalResolvedCache.clear();
    _globalThumbCache.clear();
    _globalIssuesCache.clear();
    _globalMediaInfoCache.clear();
  }, []);

  // ─── Remove URL from resolved/issues caches ─────────────────────
  const removeFromCache = useCallback((url) => {
    const source = String(url || '').trim();
    const normalizedSource = normalizeUrlCacheKey(source);
    _globalResolvedCache.delete(url);
    _globalThumbCache.delete(url);
    _globalIssuesCache.delete(url);
    _globalMediaInfoCache.delete(url);
    probedUrlsRef.current.delete(url);
    probeRetryCountsRef.current.delete(url);
    if (source) {
      const nextLocal = { ...(localCacheRef.current || {}) };
      const hadLocal =
        Object.prototype.hasOwnProperty.call(nextLocal, source) ||
        (normalizedSource && Object.prototype.hasOwnProperty.call(nextLocal, normalizedSource));
      delete nextLocal[source];
      if (normalizedSource) delete nextLocal[normalizedSource];
      if (hadLocal) {
        localCacheRef.current = nextLocal;
        markLocalCacheChanged();
        persistLocalCache().catch(() => {});
      }
    }
    setResolvedUrls((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, url)) return prev;
      const next = { ...prev };
      delete next[url];
      return next;
    });
    setIssues((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, url)) return prev;
      const next = { ...prev };
      delete next[url];
      return next;
    });
    setThumbUrls((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, url)) return prev;
      const next = { ...prev };
      delete next[url];
      return next;
    });
    setMediaInfoBySource((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, url)) return prev;
      const next = { ...prev };
      delete next[url];
      return next;
    });
  }, [markLocalCacheChanged, persistLocalCache]);

  const refreshDisplayUrl = useCallback(async (category, sourceUrl) => {
    const source = String(sourceUrl || '').trim();
    if (!source || !category) return '';

    const currentResolved = String(resolvedRef.current?.[source] || '').trim();
    const cacheKeys = new Set(
      [
        source,
        normalizeUrlCacheKey(source),
        currentResolved,
        normalizeUrlCacheKey(currentResolved),
      ].filter(Boolean),
    );
    const localFiles = new Set(
      [...cacheKeys]
        .map((key) => String(localCacheRef.current?.[key] || '').trim())
        .filter(isLocalFileUri),
    );

    if (localFiles.size) {
      localCacheRef.current = Object.fromEntries(
        Object.entries(localCacheRef.current || {}).filter(
          ([key, value]) => !cacheKeys.has(key) && !localFiles.has(String(value || '').trim()),
        ),
      );
      markLocalCacheChanged();
      await persistLocalCache();
      await Promise.all(
        [...localFiles].map((fileUri) =>
          deleteAsync(fileUri, { idempotent: true }).catch(() => {}),
        ),
      );
    }

    _globalResolvedCache.delete(source);
    _globalIssuesCache.delete(source);
    probedUrlsRef.current.delete(source);
    probeRetryCountsRef.current.delete(source);
    const nextResolvedSnapshot = { ...(resolvedRef.current || {}) };
    delete nextResolvedSnapshot[source];
    resolvedRef.current = nextResolvedSnapshot;
    setResolvedUrls((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, source)) return prev;
      const next = { ...prev };
      delete next[source];
      return next;
    });
    setIssues((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, source)) return prev;
      const next = { ...prev };
      delete next[source];
      return next;
    });

    const result = await inspectSingle(category, source);
    const freshDisplayUrl = String(result?.displayUrl || '').trim();
    if (freshDisplayUrl && canUseMediaNetworkRef.current) {
      ensureLocalCached(source, freshDisplayUrl).catch(() => {});
    }
    return freshDisplayUrl || (isRenderableSourceUrl(source) ? source : '');
  }, [ensureLocalCached, inspectSingle, markLocalCacheChanged, persistLocalCache]);

  const setDisplayUrl = useCallback((sourceUrl, displayUrl) => {
    if (!isLocalCacheScopeActive()) return;
    const source = String(sourceUrl || '').trim();
    if (!source) return;
    const nextDisplay = String(displayUrl || '').trim();
    if (!nextDisplay) {
      _globalResolvedCache.delete(source);
      setResolvedUrls((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, source)) return prev;
        const next = { ...prev };
        delete next[source];
        return next;
      });
      return;
    }
    if (isLocalFileUri(nextDisplay)) {
      const normalizedSource = normalizeUrlCacheKey(source);
      localCacheRef.current = {
        ...(localCacheRef.current || {}),
        [source]: nextDisplay,
        ...(normalizedSource ? { [normalizedSource]: nextDisplay } : {}),
      };
      localCacheRef.current = pruneLocalCacheMap(localCacheRef.current);
      markLocalCacheChanged();
      persistLocalCache().catch(() => {});
    }
    setResolvedCacheEntry(source, nextDisplay);
    probeRetryCountsRef.current.delete(source);
    setResolvedUrls((prev) => mergeResolvedUrlsPreservingLocal(prev, { [source]: nextDisplay }));
  }, [isLocalCacheScopeActive, markLocalCacheChanged, persistLocalCache]);

  return {
    resolvedUrls,
    issues,
    getDisplayUrl,
    getRemoteDisplayUrl,
    getMediaInfo,
    getThumbnailUrl,
    getIssue,
    resolveOrder,
    syncPhotos,
    inspectSingle,
    clearCaches,
    removeFromCache,
    refreshDisplayUrl,
    setDisplayUrl,
    isLikelyYandexLink,
    MEDIA_CATEGORIES,
  };
}
