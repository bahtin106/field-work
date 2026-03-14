// hooks/useOrderMedia.js
// Centralised hook for resolving, caching and managing order photos.
// Handles both beget_s3 and yandex_disk providers.

import { useCallback, useEffect, useRef, useState } from 'react';
import { yandexDiskMedia } from '../lib/yandexDiskIntegration';

const MEDIA_CATEGORIES = ['contract_file', 'photo_before', 'photo_after', 'act_file'];

/** Weak per-order cache so resolved URLs survive hook re-mounts within same session. */
const _globalResolvedCache = new Map();  // key → display URL
const _globalIssuesCache   = new Map();  // key → issue object

function isLikelyYandexLink(url) {
  const raw = String(url || '').toLowerCase();
  return raw.startsWith('yadisk://') || raw.includes('yadi.sk') || raw.includes('disk.yandex');
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
  // Seed local state from global cache for instant display on re-mount
  const [resolvedUrls, setResolvedUrls] = useState(() => Object.fromEntries(_globalResolvedCache));
  const [issues, setIssues] = useState(() => Object.fromEntries(_globalIssuesCache));
  const probeInFlight = useRef(new Set());
  const probedUrlsRef = useRef(new Set()); // tracks URLs already probed this session
  const isMounted = useRef(true);
  const resolvedRef = useRef(resolvedUrls); // always-current snapshot (no stale closures)

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Keep resolvedRef always in sync for proactive effect
  useEffect(() => {
    resolvedRef.current = resolvedUrls;
  }, [resolvedUrls]);

  // ─── Display URL resolution ──────────────────────────────────────
  const getDisplayUrl = useCallback(
    (sourceUrl) => {
      if (!sourceUrl) return '';
      return resolvedUrls[sourceUrl] || sourceUrl;
    },
    [resolvedUrls],
  );

  const getIssue = useCallback(
    (sourceUrl) => {
      const issue = issues[sourceUrl];
      if (!issue) return '';
      const code = String(issue.code || '').trim();
      if (code === 'deleted_remote') return t('order_photo_issue_deleted_remote');
      if (code === 'missing_mapping') return t('order_photo_issue_missing_mapping');
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

  const canResolveYandexUrl = useCallback(
    (sourceUrl) => Boolean(order?.id && isLikelyYandexLink(sourceUrl)),
    [order?.id],
  );

  // ─── Inspect single URL (Yandex) ─────────────────────────────────
  const inspectSingle = useCallback(
    async (category, sourceUrl) => {
      const key = `${category}:${sourceUrl}`;
      if (!canResolveYandexUrl(sourceUrl)) return { resolved: false, issue: false };
      if (probeInFlight.current.has(key)) return { resolved: false, issue: false };
      probeInFlight.current.add(key);
      try {
        const data = await yandexDiskMedia('inspect_urls', {
          order_id: order.id,
          category,
          urls: [sourceUrl],
        });
        const resolved =
          data?.resolved_urls && typeof data.resolved_urls === 'object' ? data.resolved_urls : {};
        const issuesMap =
          data?.issues && typeof data.issues === 'object' ? data.issues : {};

        if (isMounted.current) {
          if (Object.keys(resolved).length) {
            for (const [k, v] of Object.entries(resolved)) _globalResolvedCache.set(k, v);
            setResolvedUrls((p) => ({ ...p, ...resolved }));
          }
          if (Object.keys(issuesMap).length) {
            for (const [k, v] of Object.entries(issuesMap)) _globalIssuesCache.set(k, v);
            setIssues((p) => ({ ...p, ...issuesMap }));
          }
        }

        return {
          resolved: Boolean(resolved[sourceUrl]),
          issue: Boolean(issuesMap[sourceUrl]),
          mediaUrls: Array.isArray(data?.media_urls) ? data.media_urls : null,
        };
      } catch {
        return { resolved: false, issue: false };
      } finally {
        probeInFlight.current.delete(key);
      }
    },
    [canResolveYandexUrl, order?.id],
  );

  // ─── Full order inspection (Yandex) — parallelised ────────────
  const resolveOrder = useCallback(
    async (baseOrder) => {
      if (!baseOrder?.id) return baseOrder;

      const nextOrder = { ...baseOrder };
      const categoryPromises = MEDIA_CATEGORIES.filter((cat) => {
        const urls = Array.isArray(nextOrder[cat])
          ? nextOrder[cat].filter((url) => Boolean(url && isLikelyYandexLink(url)))
          : [];
        return urls.length > 0;
      }).map(async (category) => {
        const originalUrls = Array.isArray(nextOrder[category])
          ? nextOrder[category].filter(Boolean)
          : [];
        const urls = originalUrls.filter((url) => Boolean(url && isLikelyYandexLink(url)));
        try {
          const data = await yandexDiskMedia('inspect_urls', {
            order_id: nextOrder.id,
            category,
            urls,
          });
          const resolved =
            data?.resolved_urls && typeof data.resolved_urls === 'object'
              ? data.resolved_urls
              : {};
          const issuesMap =
            data?.issues && typeof data.issues === 'object' ? data.issues : {};
          const survivingYandexUrls = Array.isArray(data?.media_urls) ? data.media_urls : urls;
          const survivingYandexSet = new Set(survivingYandexUrls.map((url) => String(url || '')));
          const mergedUrls = originalUrls.filter((url) => {
            const normalized = String(url || '');
            if (!isLikelyYandexLink(normalized)) return true;
            return survivingYandexSet.has(normalized);
          });
          return { category, resolved, issues: issuesMap, mediaUrls: mergedUrls };
        } catch (e) {
          const message = String(e?.message || '').trim() || t('order_photo_issue_temporary');
          const issuesMap = {};
          for (const url of urls) {
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
        if (Array.isArray(r.mediaUrls)) {
          nextOrder[r.category] = r.mediaUrls;
        }
      }

      if (isMounted.current) {
        for (const [k, v] of Object.entries(nextResolved)) _globalResolvedCache.set(k, v);
        for (const [k, v] of Object.entries(nextIssues)) _globalIssuesCache.set(k, v);
        setResolvedUrls(nextResolved);
        setIssues(nextIssues);
      }
      return nextOrder;
    },
    [t],
  );

  // ─── Sync photos from Supabase Storage ───────────────────────────
  const syncPhotos = useCallback(async (_orderId) => {
    if (mediaProvider !== 'beget_s3') return null;
    return null;
  }, [mediaProvider]);

  // ─── Proactive URL resolution for Yandex (no dependency on resolvedUrls!) ──
  useEffect(() => {
    if (!order?.id) return;
    const tasks = [];
    const currentResolved = resolvedRef.current;
    for (const cat of MEDIA_CATEGORIES) {
      const urls = Array.isArray(order[cat]) ? order[cat].filter(Boolean) : [];
      for (const url of urls) {
        if (!currentResolved[url] && !probedUrlsRef.current.has(url) && isLikelyYandexLink(url)) {
          probedUrlsRef.current.add(url);
          tasks.push(inspectSingle(cat, url));
        }
      }
    }
    if (tasks.length) Promise.allSettled(tasks).catch(() => {});
  }, [order, inspectSingle]);

  // ─── Clear caches on provider/order switch ──────────────────────
  const clearCaches = useCallback(() => {
    setResolvedUrls({});
    setIssues({});
    probedUrlsRef.current.clear();
    _globalResolvedCache.clear();
    _globalIssuesCache.clear();
  }, []);

  // ─── Remove URL from resolved/issues caches ─────────────────────
  const removeFromCache = useCallback((url) => {
    _globalResolvedCache.delete(url);
    _globalIssuesCache.delete(url);
    probedUrlsRef.current.delete(url);
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
  }, []);

  const setDisplayUrl = useCallback((sourceUrl, displayUrl) => {
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
    _globalResolvedCache.set(source, nextDisplay);
    setResolvedUrls((prev) => ({ ...prev, [source]: nextDisplay }));
  }, []);

  return {
    resolvedUrls,
    issues,
    getDisplayUrl,
    getIssue,
    resolveOrder,
    syncPhotos,
    inspectSingle,
    clearCaches,
    removeFromCache,
    setDisplayUrl,
    isLikelyYandexLink,
    MEDIA_CATEGORIES,
  };
}
