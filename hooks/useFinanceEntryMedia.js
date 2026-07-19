import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { financeEntryMediaStorage, financeEntryYandexMedia } from '../lib/financeEntryMedia';
import {
  buildMediaAssetDisplayMap,
  buildMediaAssetInfoMap,
  buildMediaAssetThumbMap,
  listMediaAssets,
} from '../src/shared/media/assets';
import { prefetchMediaUrls } from '../src/shared/media/imagePipeline';

function isLikelyYandexLink(url) {
  const raw = String(url || '').toLowerCase();
  return raw.startsWith('yadisk://') || raw.includes('yadi.sk') || raw.includes('disk.yandex');
}

export function useFinanceEntryMedia({ financeEntryId, photoUrls, mediaProvider, t, enabled = true }) {
  const [resolvedUrls, setResolvedUrls] = useState({});
  const [thumbUrls, setThumbUrls] = useState({});
  const [issues, setIssues] = useState({});
  const [mediaInfoBySource, setMediaInfoBySource] = useState({});
  const isMounted = useRef(true);
  const photoSignature = useMemo(
    () => (Array.isArray(photoUrls) ? photoUrls.map((value) => String(value || '')).join('|') : ''),
    [photoUrls],
  );

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const getDisplayUrl = useCallback(
    (sourceUrl) => {
      if (!sourceUrl) return '';
      return resolvedUrls[sourceUrl] || thumbUrls[sourceUrl] || sourceUrl;
    },
    [resolvedUrls, thumbUrls],
  );

  const getThumbnailUrl = useCallback(
    (sourceUrl) => {
      if (!sourceUrl) return '';
      return thumbUrls[sourceUrl] || getDisplayUrl(sourceUrl);
    },
    [getDisplayUrl, thumbUrls],
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
      if (code === 'deleted_remote') return t('order_photo_issue_deleted_remote');
      if (code === 'missing_mapping') return t('order_photo_issue_missing_mapping');
      if (code === 'disk_unavailable') return t('order_photo_issue_disk_unavailable');
      if (code === 'disk_auth') return t('order_photo_issue_disk_auth');
      if (code === 'disk_locked') return t('order_photo_issue_disk_locked');
      if (code === 'disk_error' || code === 'download_error') return t('order_photo_issue_temporary');
      if (issue.message) return issue.message;
      return t('order_photo_issue_temporary');
    },
    [issues, t],
  );

  const inspectUrls = useCallback(
    async (urls = []) => {
      if (!enabled || !financeEntryId) {
        return { resolved_urls: {}, issues: {}, photo_urls: urls };
      }
      const targets = (urls || []).map((value) => String(value || '').trim()).filter(Boolean);
      if (!targets.some((url) => isLikelyYandexLink(url) || /^https?:\/\//i.test(String(url || '')))) {
        return { resolved_urls: {}, issues: {}, photo_urls: targets };
      }
      const yandexUrls = targets.filter((url) => isLikelyYandexLink(url));
      const begetUrls = targets.filter((url) => !isLikelyYandexLink(url));
      const [yandexData, begetData] = await Promise.all([
        yandexUrls.length
          ? financeEntryYandexMedia('inspect_urls', {
              finance_entry_id: financeEntryId,
              urls: yandexUrls,
            }).catch(() => null)
          : Promise.resolve(null),
        begetUrls.length
          ? financeEntryMediaStorage('inspect_urls', {
              finance_entry_id: financeEntryId,
              urls: begetUrls,
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const data = {
        resolved_urls: {
          ...(yandexData?.resolved_urls && typeof yandexData.resolved_urls === 'object' ? yandexData.resolved_urls : {}),
          ...(begetData?.resolved_urls && typeof begetData.resolved_urls === 'object' ? begetData.resolved_urls : {}),
        },
        issues: {
          ...(yandexData?.issues && typeof yandexData.issues === 'object' ? yandexData.issues : {}),
          ...(begetData?.issues && typeof begetData.issues === 'object' ? begetData.issues : {}),
        },
        photo_urls: Array.isArray(yandexData?.photo_urls)
          ? yandexData.photo_urls
          : Array.isArray(begetData?.photo_urls)
            ? begetData.photo_urls
            : targets,
      };
      const nextResolved =
        data?.resolved_urls && typeof data.resolved_urls === 'object' ? data.resolved_urls : {};
      const nextIssues = data?.issues && typeof data.issues === 'object' ? data.issues : {};
      if (isMounted.current) {
        setResolvedUrls(nextResolved);
        setIssues(nextIssues);
      }
      prefetchMediaUrls(Object.values(nextResolved).length ? Object.values(nextResolved) : targets).catch(() => {});
      return data || { resolved_urls: nextResolved, issues: nextIssues, photo_urls: targets };
    },
    [enabled, financeEntryId],
  );

  useEffect(() => {
    if (!enabled || !financeEntryId) return;
    let cancelled = false;
    listMediaAssets({
      entityType: 'finance_entry',
      entityId: financeEntryId,
      categories: ['finance_entry_photo'],
    })
      .then((assets) => {
        if (cancelled || !isMounted.current) return;
        const displayMap = buildMediaAssetDisplayMap(assets);
        const thumbMap = buildMediaAssetThumbMap(assets);
        const infoMap = buildMediaAssetInfoMap(assets);
        if (Object.keys(displayMap).length) {
          setResolvedUrls((prev) => ({ ...displayMap, ...prev }));
          prefetchMediaUrls(Object.values(displayMap)).catch(() => {});
        }
        if (Object.keys(thumbMap).length) {
          setThumbUrls((prev) => ({ ...thumbMap, ...prev }));
          prefetchMediaUrls(Object.values(thumbMap)).catch(() => {});
        }
        if (Object.keys(infoMap).length) {
          setMediaInfoBySource((prev) => ({ ...prev, ...infoMap }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, financeEntryId, photoSignature]);

  useEffect(() => {
    if (!enabled || !financeEntryId) return;
    const urls = (photoUrls || []).map((value) => String(value || '').trim()).filter(Boolean);
    if (!urls.some((url) => isLikelyYandexLink(url) || /^https?:\/\//i.test(String(url || '')))) {
      setResolvedUrls({});
      setThumbUrls({});
      setIssues({});
      setMediaInfoBySource({});
      return;
    }
    inspectUrls(urls).catch(() => {});
  }, [enabled, financeEntryId, inspectUrls, mediaProvider, photoUrls]);

  const removeFromCache = useCallback((url) => {
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
  }, []);

  const setDisplayUrl = useCallback((sourceUrl, displayUrl) => {
    const source = String(sourceUrl || '').trim();
    if (!source) return;
    const nextDisplay = String(displayUrl || '').trim();
    if (!nextDisplay) {
      setResolvedUrls((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, source)) return prev;
        const next = { ...prev };
        delete next[source];
        return next;
      });
      return;
    }
    setResolvedUrls((prev) => ({ ...prev, [source]: nextDisplay }));
  }, []);

  return {
    getDisplayUrl,
    getThumbnailUrl,
    getMediaInfo,
    getIssue,
    inspectUrls,
    removeFromCache,
    setDisplayUrl,
    isLikelyYandexLink,
  };
}
