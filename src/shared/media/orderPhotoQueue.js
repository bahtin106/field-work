import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { orderMediaStorage } from '../../../lib/orderMediaStorage';
import { yandexDiskMedia } from '../../../lib/yandexDiskIntegration';
import {
  canRunOutboxSync,
  getActiveOfflineOwnerContext,
  isActiveOfflineOwnerContext,
  isOfflineItemOwnedBy,
} from '../offline/offlineStatus';
import { queryClient } from '../query/queryClient';
import { queryKeys } from '../query/queryKeys';
import {
  assertOwnerBoundAuthorization,
  captureOwnerBoundAuthorization,
  isOwnerAuthorizationUnavailableError,
} from '../security/ownerBoundAuthorization';
import { prepareImageForUpload, uploadPreparedImageFile } from './imagePipeline';

export const ORDER_PHOTO_UPLOAD_QUEUE_KEY = 'offline.orderPhotoUploadQueue.v1';

const PHOTO_MAX_WIDTH = 1280;
const PHOTO_COMPRESS_QUALITY = 0.8;
const PHOTO_MIME_TYPE = 'image/jpeg';
const YANDEX_URL_MARKERS = ['yadisk://', 'yadi.sk', 'disk.yandex'];
const FOREGROUND_UPLOAD_LEASE_MS = 10 * 60 * 1000;
const MANAGED_PHOTO_DIRECTORY = `${FileSystem.documentDirectory || ''}offline-order-photos/`;

let queueMutation = Promise.resolve();
let flushInFlight = null;
let flushInFlightEpoch = null;
const inFlightQueueItemIds = new Set();

function nowIso() {
  return new Date().toISOString();
}

function normalizeProvider(value) {
  return String(value || '').trim() === 'yandex_disk' ? 'yandex_disk' : 'beget_s3';
}

function safePathSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'unknown';
}

function inferLocalExtension(value) {
  const match = String(value || '').split(/[?#]/, 1)[0].match(/\.([a-zA-Z0-9]{1,8})$/);
  return match ? `.${match[1].toLowerCase()}` : '.source';
}

function isManagedLocalUrl(value) {
  const url = String(value || '').trim();
  return !!MANAGED_PHOTO_DIRECTORY && url.startsWith(MANAGED_PHOTO_DIRECTORY);
}

async function safeDeleteManagedLocalFile(value) {
  const url = String(value || '').trim();
  if (!isManagedLocalUrl(url)) return;
  try {
    await FileSystem.deleteAsync(url, { idempotent: true });
  } catch {}
}

async function persistManagedLocalFile(localUrl, ownerContext) {
  const sourceUrl = String(localUrl || '').trim();
  if (!sourceUrl) throw new Error('Queued media upload has no local URL');
  if (!MANAGED_PHOTO_DIRECTORY) {
    throw new Error('A durable document directory is required for queued media');
  }
  if (isManagedLocalUrl(sourceUrl)) {
    const existing = await FileSystem.getInfoAsync(sourceUrl);
    assertPhotoOwnerContext(ownerContext);
    if (!existing?.exists) throw new Error('Queued media source is no longer available');
    return sourceUrl;
  }

  const { owner } = ownerContext;
  const ownerDirectory = `${MANAGED_PHOTO_DIRECTORY}${safePathSegment(owner.userId)}/${safePathSegment(owner.companyId)}/`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const temporaryUrl = `${ownerDirectory}${token}.tmp`;
  const managedUrl = `${ownerDirectory}${token}${inferLocalExtension(sourceUrl)}`;
  try {
    await FileSystem.makeDirectoryAsync(ownerDirectory, { intermediates: true });
    assertPhotoOwnerContext(ownerContext);
    await FileSystem.copyAsync({ from: sourceUrl, to: temporaryUrl });
    assertPhotoOwnerContext(ownerContext);
    const copied = await FileSystem.getInfoAsync(temporaryUrl, { size: true });
    if (!copied?.exists || Number(copied?.size || 0) <= 0) {
      throw new Error('Queued media could not be copied to durable storage');
    }
    await FileSystem.moveAsync({ from: temporaryUrl, to: managedUrl });
    assertPhotoOwnerContext(ownerContext);
    return managedUrl;
  } catch (error) {
    await safeDeleteManagedLocalFile(temporaryUrl);
    await safeDeleteManagedLocalFile(managedUrl);
    throw error;
  }
}

function itemMatchesLocalUrl(item, localUrl) {
  const expected = String(localUrl || '').trim();
  return (
    String(item?.localUrl || '').trim() === expected ||
    String(item?.managedLocalUrl || '').trim() === expected
  );
}

function isYandexUrl(value) {
  const normalized = String(value || '').toLowerCase();
  return YANDEX_URL_MARKERS.some((marker) => normalized.includes(marker));
}

async function readStorage() {
  try {
    const raw = await AsyncStorage.getItem(ORDER_PHOTO_UPLOAD_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeStorage(items) {
  await AsyncStorage.setItem(
    ORDER_PHOTO_UPLOAD_QUEUE_KEY,
    JSON.stringify(Array.isArray(items) ? items : []),
  );
}

export async function readOrderPhotoUploadQueue() {
  await queueMutation.catch(() => {});
  return readStorage();
}

function mutateQueue(mutator) {
  const operation = queueMutation.then(async () => {
    const current = await readStorage();
    const result = await mutator([...current]);
    await writeStorage(result?.items ?? current);
    return result?.value;
  });
  queueMutation = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function requireOwnerContext() {
  const context = getActiveOfflineOwnerContext();
  if (!context) throw new Error('Company-scoped session is required for queued media changes');
  return context;
}

function assertPhotoOwnerContext(context) {
  if (isActiveOfflineOwnerContext(context)) return;
  const error = new Error('Offline owner changed during media sync');
  error.code = 'OFFLINE_OWNER_CHANGED';
  throw error;
}

function isLegacyPhotoItemClaimable(item, owner) {
  const itemUserId = String(item?.ownerUserId || '').trim();
  const itemCompanyId = String(item?.ownerCompanyId || '').trim();
  if (itemCompanyId || itemUserId !== owner.userId) return false;
  const activeProfile = queryClient.getQueryData(queryKeys.profile.me());
  if (String(activeProfile?.id || '').trim() !== owner.userId) return false;
  if (String(activeProfile?.company_id || '').trim() !== owner.companyId) return false;
  const orderId = String(item?.orderId || '').trim();
  if (!orderId) return false;
  const cachedOrder = queryClient.getQueryData(queryKeys.requests.detail(orderId));
  return String(cachedOrder?.company_id || '').trim() === owner.companyId;
}

async function claimLegacyPhotoQueue(context) {
  const { owner } = context;
  const snapshot = await readOrderPhotoUploadQueue();
  if (!isActiveOfflineOwnerContext(context)) return;
  if (!snapshot.some((item) => isLegacyPhotoItemClaimable(item, owner))) return;
  await mutateQueue((items) => ({
    items: !isActiveOfflineOwnerContext(context)
      ? items
      : items.map((item) =>
          isLegacyPhotoItemClaimable(item, owner)
            ? { ...item, ownerUserId: owner.userId, ownerCompanyId: owner.companyId }
            : item,
        ),
  }));
}

async function getOwnerContextWithLegacyClaim() {
  const context = getActiveOfflineOwnerContext();
  if (!context) return null;
  await claimLegacyPhotoQueue(context);
  return isActiveOfflineOwnerContext(context) ? context : null;
}

export async function enqueueOrderPhotoUpload({
  orderId,
  category,
  localUrl,
  mediaProvider,
  mediaOrigin = null,
  capturedAt = null,
  status = 'pending',
}) {
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedLocalUrl = String(localUrl || '').trim();
  if (!normalizedOrderId || !normalizedCategory || !normalizedLocalUrl) return null;
  const ownerContext = requireOwnerContext();
  const { owner } = ownerContext;
  const managedLocalUrl = await persistManagedLocalFile(normalizedLocalUrl, ownerContext);
  assertPhotoOwnerContext(ownerContext);
  let queueCommitted = false;
  try {
    const result = await mutateQueue((items) => {
      assertPhotoOwnerContext(ownerContext);
      const existingIndex = items.findIndex(
        (item) =>
          isOfflineItemOwnedBy(item, owner) &&
          String(item?.operation || 'upload') === 'upload' &&
          String(item?.orderId || '') === normalizedOrderId &&
          String(item?.category || '') === normalizedCategory &&
          itemMatchesLocalUrl(item, normalizedLocalUrl),
      );
      if (existingIndex >= 0) {
        const existing = items[existingIndex];
        const existingManagedLocalUrl = String(existing?.managedLocalUrl || '').trim();
        items[existingIndex] = {
          ...existing,
          managedLocalUrl: existingManagedLocalUrl || managedLocalUrl,
          mediaOrigin: existing.mediaOrigin || String(mediaOrigin || '').trim() || null,
          capturedAt: existing.capturedAt || String(capturedAt || '').trim() || null,
          ...(status === 'foreground'
            ? {
                status: 'foreground',
                leaseUntil: Date.now() + FOREGROUND_UPLOAD_LEASE_MS,
                updatedAt: nowIso(),
              }
            : {}),
        };
        return {
          items,
          value: {
            id: String(existing.id),
            unusedManagedLocalUrl:
              existingManagedLocalUrl && existingManagedLocalUrl !== managedLocalUrl
                ? managedLocalUrl
                : null,
          },
        };
      }

      const id = `order-photo:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      return {
        items: [
          ...items,
          {
            id,
            orderId: normalizedOrderId,
            category: normalizedCategory,
            localUrl: normalizedLocalUrl,
            managedLocalUrl,
            mediaProvider: normalizeProvider(mediaProvider),
            mediaOrigin: String(mediaOrigin || '').trim() || null,
            capturedAt: String(capturedAt || '').trim() || null,
            operation: 'upload',
            status: status === 'foreground' ? 'foreground' : 'pending',
            leaseUntil: status === 'foreground' ? Date.now() + FOREGROUND_UPLOAD_LEASE_MS : null,
            attempts: 0,
            createdAt: nowIso(),
            ownerUserId: owner.userId,
            ownerCompanyId: owner.companyId,
          },
        ],
        value: { id, unusedManagedLocalUrl: null },
      };
    });
    queueCommitted = true;
    await safeDeleteManagedLocalFile(result?.unusedManagedLocalUrl);
    return result?.id || null;
  } catch (error) {
    if (!queueCommitted) await safeDeleteManagedLocalFile(managedLocalUrl);
    throw error;
  }
}

export async function enqueueOrderPhotoUploads({ orderId, category, uploads, localUrls, mediaProvider, status = 'pending' }) {
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedUploads = Array.from(
    (Array.isArray(uploads) ? uploads : Array.isArray(localUrls) ? localUrls : []).reduce((unique, value) => {
      const input = value && typeof value === 'object' ? value : { uri: value };
      const localUrl = String(input?.uri || '').trim();
      if (!localUrl || unique.has(localUrl)) return unique;
      unique.set(localUrl, {
        localUrl,
        mediaOrigin: String(input?.mediaOrigin || input?.media_origin || '').trim() || null,
        capturedAt: String(input?.capturedAt || input?.captured_at || '').trim() || null,
      });
      return unique;
    }, new Map()).values(),
  );
  if (!normalizedOrderId || !normalizedCategory || !normalizedUploads.length) return [];
  const ownerContext = requireOwnerContext();
  const { owner } = ownerContext;
  const durableUploads = [];
  let queueCommitted = false;
  try {
    for (const upload of normalizedUploads) {
      const managedLocalUrl = await persistManagedLocalFile(upload.localUrl, ownerContext);
      assertPhotoOwnerContext(ownerContext);
      durableUploads.push({ ...upload, managedLocalUrl });
    }
    const result = await mutateQueue((items) => {
      assertPhotoOwnerContext(ownerContext);
      const nextItems = [...items];
      const ids = [];
      const unusedManagedLocalUrls = [];
      for (const upload of durableUploads) {
        const { localUrl, managedLocalUrl, mediaOrigin, capturedAt } = upload;
      const existingIndex = nextItems.findIndex(
        (item) =>
          isOfflineItemOwnedBy(item, owner) &&
          String(item?.operation || 'upload') === 'upload' &&
          String(item?.orderId || '') === normalizedOrderId &&
          String(item?.category || '') === normalizedCategory &&
          itemMatchesLocalUrl(item, localUrl),
      );
      if (existingIndex >= 0) {
        const existing = nextItems[existingIndex];
        const existingManagedLocalUrl = String(existing?.managedLocalUrl || '').trim();
        nextItems[existingIndex] = {
          ...existing,
          managedLocalUrl: existingManagedLocalUrl || managedLocalUrl,
          mediaOrigin: existing.mediaOrigin || mediaOrigin,
          capturedAt: existing.capturedAt || capturedAt,
          ...(status === 'foreground'
            ? {
                status: 'foreground',
                leaseUntil: Date.now() + FOREGROUND_UPLOAD_LEASE_MS,
                updatedAt: nowIso(),
              }
            : {}),
        };
        if (existingManagedLocalUrl && existingManagedLocalUrl !== managedLocalUrl) {
          unusedManagedLocalUrls.push(managedLocalUrl);
        }
        ids.push(String(existing.id));
        continue;
      }
      const id = `order-photo:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      nextItems.push({
        id,
        orderId: normalizedOrderId,
        category: normalizedCategory,
        localUrl,
        managedLocalUrl,
        mediaProvider: normalizeProvider(mediaProvider),
        mediaOrigin,
        capturedAt,
        operation: 'upload',
        status: status === 'foreground' ? 'foreground' : 'pending',
        leaseUntil: status === 'foreground' ? Date.now() + FOREGROUND_UPLOAD_LEASE_MS : null,
        attempts: 0,
        createdAt: nowIso(),
        ownerUserId: owner.userId,
        ownerCompanyId: owner.companyId,
      });
      ids.push(id);
    }
      return { items: nextItems, value: { ids, unusedManagedLocalUrls } };
    });
    queueCommitted = true;
    await Promise.all((result?.unusedManagedLocalUrls || []).map(safeDeleteManagedLocalFile));
    return result?.ids || [];
  } catch (error) {
    if (!queueCommitted) {
      await Promise.all(durableUploads.map((upload) => safeDeleteManagedLocalFile(upload.managedLocalUrl)));
    }
    throw error;
  }
}

export async function enqueueOrderPhotoDeletes({ orderId, category, targetUrls, mediaProvider, status = 'pending' }) {
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedTargetUrls = Array.from(
    new Set((Array.isArray(targetUrls) ? targetUrls : []).map((value) => String(value || '').trim()).filter(Boolean)),
  );
  if (!normalizedOrderId || !normalizedCategory || !normalizedTargetUrls.length) return {};
  const ownerContext = requireOwnerContext();
  const { owner } = ownerContext;

  return mutateQueue((items) => {
    assertPhotoOwnerContext(ownerContext);
    const nextItems = [...items];
    const idsByUrl = {};
    for (const targetUrl of normalizedTargetUrls) {
      const existing = nextItems.find(
        (item) =>
          isOfflineItemOwnedBy(item, owner) &&
          String(item?.operation || '') === 'delete' &&
          String(item?.orderId || '') === normalizedOrderId &&
          String(item?.category || '') === normalizedCategory &&
          String(item?.targetUrl || '') === targetUrl,
      );
      if (existing?.id) {
        idsByUrl[targetUrl] = String(existing.id);
        continue;
      }
      const id = `order-photo-delete:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      nextItems.push({
        id,
        orderId: normalizedOrderId,
        category: normalizedCategory,
        targetUrl,
        mediaProvider: normalizeProvider(mediaProvider || (isYandexUrl(targetUrl) ? 'yandex_disk' : 'beget_s3')),
        operation: 'delete',
        status: status === 'foreground' ? 'foreground' : 'pending',
        leaseUntil: status === 'foreground' ? Date.now() + FOREGROUND_UPLOAD_LEASE_MS : null,
        attempts: 0,
        createdAt: nowIso(),
        ownerUserId: owner.userId,
        ownerCompanyId: owner.companyId,
      });
      idsByUrl[targetUrl] = id;
    }
    return { items: nextItems, value: idsByUrl };
  });
}

export async function removeOrderPhotoUploadFromQueue(queueId) {
  if (!queueId) return;
  const ownerContext = await getOwnerContextWithLegacyClaim();
  if (!ownerContext) return;
  const { owner } = ownerContext;
  const removed = await mutateQueue((items) => {
    if (!isActiveOfflineOwnerContext(ownerContext)) return { items, value: [] };
    const matching = items.filter(
      (item) =>
        String(item?.id || '') === String(queueId) && isOfflineItemOwnedBy(item, owner),
    );
    return {
      items: items.filter(
        (item) =>
          String(item?.id || '') !== String(queueId) || !isOfflineItemOwnedBy(item, owner),
      ),
      value: matching,
    };
  });
  await Promise.all((removed || []).map((item) => safeDeleteManagedLocalFile(item?.managedLocalUrl)));
}

export async function getQueuedOrderPhotoUrls(orderId, category) {
  const ownerContext = await getOwnerContextWithLegacyClaim();
  if (!ownerContext) return new Set();
  const { owner } = ownerContext;
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const items = await readOrderPhotoUploadQueue();
  if (!isActiveOfflineOwnerContext(ownerContext)) return new Set();
  return new Set(
    items
      .filter(
        (item) =>
          isOfflineItemOwnedBy(item, owner) &&
          String(item?.operation || 'upload') === 'upload' &&
          String(item?.orderId || '') === normalizedOrderId &&
          String(item?.category || '') === normalizedCategory,
      )
      .flatMap((item) => [item?.localUrl, item?.managedLocalUrl])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
}

export async function getOrderPhotoQueueItems(orderId) {
  const ownerContext = await getOwnerContextWithLegacyClaim();
  if (!ownerContext) return [];
  const { owner } = ownerContext;
  const items = await readOrderPhotoUploadQueue();
  if (!isActiveOfflineOwnerContext(ownerContext)) return [];
  return items.filter(
    (item) =>
      isOfflineItemOwnedBy(item, owner) &&
      String(item?.orderId || '') === String(orderId || ''),
  );
}

export async function setOrderPhotoUploadQueueStatus(orderId, category, localUrl, status) {
  const ownerContext = await getOwnerContextWithLegacyClaim();
  if (!ownerContext) return;
  const { owner } = ownerContext;
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedLocalUrl = String(localUrl || '').trim();
  await mutateQueue((items) => ({
    items: !isActiveOfflineOwnerContext(ownerContext)
      ? items
      : items.map((item) =>
          isOfflineItemOwnedBy(item, owner) &&
          String(item?.operation || 'upload') === 'upload' &&
          String(item?.orderId || '') === normalizedOrderId &&
          String(item?.category || '') === normalizedCategory &&
          itemMatchesLocalUrl(item, normalizedLocalUrl)
            ? {
                ...item,
                status,
                leaseUntil: status === 'foreground' ? Date.now() + FOREGROUND_UPLOAD_LEASE_MS : null,
                updatedAt: nowIso(),
              }
            : item,
        ),
  }));
}

async function markFailed(item, ownerContext) {
  const { owner } = ownerContext;
  await mutateQueue((items) => ({
    items: !isActiveOfflineOwnerContext(ownerContext)
      ? items
      : items.map((row) =>
          String(row?.id || '') === String(item?.id || '') && isOfflineItemOwnedBy(row, owner)
            ? {
                ...row,
                status: 'failed',
                attempts: Number(row?.attempts || 0) + 1,
                updatedAt: nowIso(),
              }
            : row,
        ),
  }));
}

async function commitPreparedUpload(item, preparedImage, provider, ownerContext, authCarrier) {
  assertPhotoOwnerContext(ownerContext);
  assertOwnerBoundAuthorization(authCarrier, ownerContext.owner.userId);
  const storage = provider === 'yandex_disk' ? yandexDiskMedia : orderMediaStorage;
  const prepared = await storage('prepare_upload', {
    order_id: item.orderId,
    category: item.category,
    mime: PHOTO_MIME_TYPE,
  }, { authCarrier });
  assertPhotoOwnerContext(ownerContext);
  assertOwnerBoundAuthorization(authCarrier, ownerContext.owner.userId);
  if (!canRunOutboxSync()) throw new Error('Network quality changed during media sync');
  await uploadPreparedImageFile(prepared?.upload_url, preparedImage.uri, {
    method: prepared?.upload_method || 'PUT',
    headers: prepared?.upload_headers,
  });
  assertPhotoOwnerContext(ownerContext);
  assertOwnerBoundAuthorization(authCarrier, ownerContext.owner.userId);
  if (!canRunOutboxSync()) throw new Error('Network quality changed during media sync');
  if (provider === 'yandex_disk') {
    const committed = await storage('commit_upload', {
      order_id: item.orderId,
      category: item.category,
      external_path: prepared?.external_path || null,
      media_origin: item.mediaOrigin || null,
      captured_at: item.capturedAt || null,
    }, { authCarrier });
    assertPhotoOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authCarrier, ownerContext.owner.userId);
    return committed;
  }
  const committed = await storage('commit_upload', {
    order_id: item.orderId,
    category: item.category,
    object_key: prepared?.object_key || null,
    public_url: prepared?.public_url || null,
    media_origin: item.mediaOrigin || null,
    captured_at: item.capturedAt || null,
  }, { authCarrier });
  assertPhotoOwnerContext(ownerContext);
  assertOwnerBoundAuthorization(authCarrier, ownerContext.owner.userId);
  return committed;
}

async function processQueueItem(item, ownerContext, authCarrier) {
  assertPhotoOwnerContext(ownerContext);
  assertOwnerBoundAuthorization(authCarrier, ownerContext.owner.userId);
  const operation = String(item?.operation || 'upload');
  const provider = normalizeProvider(item?.mediaProvider);
  if (operation === 'delete') {
    const targetUrl = String(item?.targetUrl || '').trim();
    if (!targetUrl) throw new Error('Queued media delete has no target URL');
    const storage = provider === 'yandex_disk' || isYandexUrl(targetUrl) ? yandexDiskMedia : orderMediaStorage;
    const deleted = await storage('delete', {
      order_id: item.orderId,
      category: item.category,
      url: targetUrl,
    }, { authCarrier });
    assertPhotoOwnerContext(ownerContext);
    assertOwnerBoundAuthorization(authCarrier, ownerContext.owner.userId);
    return deleted;
  }

  const localUrl = String(item?.managedLocalUrl || item?.localUrl || '').trim();
  if (!localUrl) throw new Error('Queued media upload has no local URL');
  const preparedImage = await prepareImageForUpload(localUrl, {
    maxWidth: PHOTO_MAX_WIDTH,
    quality: PHOTO_COMPRESS_QUALITY,
  });
  assertPhotoOwnerContext(ownerContext);
  if (!canRunOutboxSync()) throw new Error('Network quality changed during media sync');
  return commitPreparedUpload(item, preparedImage, provider, ownerContext, authCarrier);
}

function reconcileCommittedQueueItem(item, response, ownerContext) {
  assertPhotoOwnerContext(ownerContext);
  const orderId = String(item?.orderId || '').trim();
  const category = String(item?.category || '').trim();
  if (!orderId || !category) return;
  const responseMediaUrls = Array.isArray(response?.media_urls)
    ? response.media_urls.map((value) => String(value || '').trim()).filter(Boolean)
    : null;
  const committedUrl = String(response?.url || response?.public_url || '').trim();
  const localCandidates = new Set(
    [item?.localUrl, item?.managedLocalUrl].map((value) => String(value || '').trim()).filter(Boolean),
  );
  const targetUrl = String(item?.targetUrl || '').trim();
  queryClient.setQueryData(queryKeys.requests.detail(orderId), (current) => {
    if (!current || String(current?.id || '').trim() !== orderId) return current;
    if (String(current?.company_id || '').trim() !== ownerContext.owner.companyId) return current;
    const currentUrls = Array.isArray(current?.[category])
      ? current[category].map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    let nextUrls = responseMediaUrls;
    if (!nextUrls) {
      if (String(item?.operation || 'upload') === 'delete') {
        nextUrls = currentUrls.filter((value) => value !== targetUrl);
      } else {
        nextUrls = currentUrls.filter((value) => !localCandidates.has(value));
        if (committedUrl) nextUrls.push(committedUrl);
      }
    }
    return {
      ...current,
      [category]: Array.from(new Set(nextUrls)),
      ...(response?.order_updated_at ? { updated_at: String(response.order_updated_at) } : {}),
    };
  });
}

async function runQueueFlush(onItemSettled) {
  if (!canRunOutboxSync()) return { completed: 0, failed: 0 };
  const ownerContext = await getOwnerContextWithLegacyClaim();
  if (!ownerContext) return { completed: 0, failed: 0 };
  const { owner } = ownerContext;
  const snapshot = await readOrderPhotoUploadQueue();
  if (!isActiveOfflineOwnerContext(ownerContext)) return { completed: 0, failed: 0 };
  const now = Date.now();
  const mine = snapshot.filter(
    (item) =>
      isOfflineItemOwnedBy(item, owner) &&
      (item?.status !== 'foreground' || Number(item?.leaseUntil || 0) <= now),
  );
  let completed = 0;
  let failed = 0;

  for (const item of mine) {
    if (!canRunOutboxSync()) break;
    if (!isActiveOfflineOwnerContext(ownerContext)) break;
    if (!isOfflineItemOwnedBy(item, owner)) break;
    if (inFlightQueueItemIds.has(String(item?.id || ''))) continue;
    inFlightQueueItemIds.add(String(item?.id || ''));
    try {
      const authCarrier = await captureOwnerBoundAuthorization(owner.userId);
      assertPhotoOwnerContext(ownerContext);
      assertOwnerBoundAuthorization(authCarrier, owner.userId);
      const response = await processQueueItem(item, ownerContext, authCarrier);
      assertPhotoOwnerContext(ownerContext);
      assertOwnerBoundAuthorization(authCarrier, owner.userId);
      const ownerStillActive = isActiveOfflineOwnerContext(ownerContext);
      if (ownerStillActive) reconcileCommittedQueueItem(item, response, ownerContext);
      // Once the remote operation has positively completed, removing this
      // exact old-owner item is safe even if logout happened during the final
      // response. Keeping it would duplicate a committed upload on next login.
      const removed = await mutateQueue((items) => {
        const matching = items.filter(
          (row) =>
            String(row?.id || '') === String(item?.id || '') &&
            isOfflineItemOwnedBy(row, owner),
        );
        return {
          items: items.filter(
            (row) =>
              String(row?.id || '') !== String(item?.id || '') ||
              !isOfflineItemOwnedBy(row, owner),
          ),
          value: matching,
        };
      });
      await Promise.all((removed || []).map((row) => safeDeleteManagedLocalFile(row?.managedLocalUrl)));
      completed += 1;
      if (!ownerStillActive) break;
      onItemSettled?.(item, true);
    } catch (error) {
      if (error?.code === 'OFFLINE_OWNER_CHANGED' || !isActiveOfflineOwnerContext(ownerContext)) {
        break;
      }
      if (isOwnerAuthorizationUnavailableError(error)) break;
      if (!canRunOutboxSync()) break;
      await markFailed(item, ownerContext);
      failed += 1;
      onItemSettled?.(item, false);
    } finally {
      inFlightQueueItemIds.delete(String(item?.id || ''));
    }
  }

  return { completed, failed };
}

export function flushOrderPhotoQueue(options = {}) {
  const ownerContext = getActiveOfflineOwnerContext();
  if (!ownerContext) return Promise.resolve({ completed: 0, failed: 0 });
  if (flushInFlight && flushInFlightEpoch === ownerContext.epoch) return flushInFlight;
  const run = runQueueFlush(options?.onItemSettled).finally(() => {
    if (flushInFlight !== run) return;
    flushInFlight = null;
    flushInFlightEpoch = null;
  });
  flushInFlightEpoch = ownerContext.epoch;
  flushInFlight = run;
  return run;
}

export async function clearOrderPhotoQueue() {
  await queueMutation.catch(() => {});
  const items = await readStorage();
  await AsyncStorage.removeItem(ORDER_PHOTO_UPLOAD_QUEUE_KEY);
  await Promise.all(items.map((item) => safeDeleteManagedLocalFile(item?.managedLocalUrl)));
}

export async function recoverInterruptedOrderPhotoQueue() {
  const ownerContext = await getOwnerContextWithLegacyClaim();
  if (!ownerContext) return;
  const { owner } = ownerContext;
  await mutateQueue((items) => ({
    items: !isActiveOfflineOwnerContext(ownerContext)
      ? items
      : items.map((item) =>
          isOfflineItemOwnedBy(item, owner) && item?.status === 'foreground'
            ? { ...item, status: 'pending', leaseUntil: null, updatedAt: nowIso() }
            : item,
        ),
  }));
}
