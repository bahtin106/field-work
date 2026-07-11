import AsyncStorage from '@react-native-async-storage/async-storage';
import { orderMediaStorage } from '../../../lib/orderMediaStorage';
import { yandexDiskMedia } from '../../../lib/yandexDiskIntegration';
import {
  getActiveOfflineOwner,
  getOfflineSnapshot,
  isOfflineItemOwnedBy,
} from '../offline/offlineStatus';
import { prepareImageForUpload, uploadPreparedImageFile } from './imagePipeline';

export const ORDER_PHOTO_UPLOAD_QUEUE_KEY = 'offline.orderPhotoUploadQueue.v1';

const PHOTO_MAX_WIDTH = 1280;
const PHOTO_COMPRESS_QUALITY = 0.8;
const PHOTO_MIME_TYPE = 'image/jpeg';
const YANDEX_URL_MARKERS = ['yadisk://', 'yadi.sk', 'disk.yandex'];
const FOREGROUND_UPLOAD_LEASE_MS = 10 * 60 * 1000;

let queueMutation = Promise.resolve();
let flushInFlight = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeProvider(value) {
  return String(value || '').trim() === 'yandex_disk' ? 'yandex_disk' : 'beget_s3';
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

async function requireOwner() {
  const owner = await getActiveOfflineOwner();
  if (!owner) throw new Error('Authenticated session is required for queued media changes');
  return owner;
}

export async function enqueueOrderPhotoUpload({ orderId, category, localUrl, mediaProvider, status = 'pending' }) {
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedLocalUrl = String(localUrl || '').trim();
  if (!normalizedOrderId || !normalizedCategory || !normalizedLocalUrl) return null;
  const owner = await requireOwner();

  return mutateQueue((items) => {
    const existingIndex = items.findIndex(
      (item) =>
        isOfflineItemOwnedBy(item, owner) &&
        String(item?.operation || 'upload') === 'upload' &&
        String(item?.orderId || '') === normalizedOrderId &&
        String(item?.category || '') === normalizedCategory &&
        String(item?.localUrl || '') === normalizedLocalUrl,
    );
    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      if (status === 'foreground') {
        items[existingIndex] = {
          ...existing,
          status: 'foreground',
          leaseUntil: Date.now() + FOREGROUND_UPLOAD_LEASE_MS,
          updatedAt: nowIso(),
        };
      }
      return { items, value: String(existing.id) };
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
          mediaProvider: normalizeProvider(mediaProvider),
          operation: 'upload',
          status: status === 'foreground' ? 'foreground' : 'pending',
          leaseUntil: status === 'foreground' ? Date.now() + FOREGROUND_UPLOAD_LEASE_MS : null,
          attempts: 0,
          createdAt: nowIso(),
          ownerUserId: owner.userId,
          ownerCompanyId: owner.companyId,
        },
      ],
      value: id,
    };
  });
}

export async function enqueueOrderPhotoUploads({ orderId, category, localUrls, mediaProvider, status = 'pending' }) {
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedLocalUrls = Array.from(
    new Set((Array.isArray(localUrls) ? localUrls : []).map((value) => String(value || '').trim()).filter(Boolean)),
  );
  if (!normalizedOrderId || !normalizedCategory || !normalizedLocalUrls.length) return [];
  const owner = await requireOwner();

  return mutateQueue((items) => {
    const nextItems = [...items];
    const ids = [];
    for (const localUrl of normalizedLocalUrls) {
      const existingIndex = nextItems.findIndex(
        (item) =>
          isOfflineItemOwnedBy(item, owner) &&
          String(item?.operation || 'upload') === 'upload' &&
          String(item?.orderId || '') === normalizedOrderId &&
          String(item?.category || '') === normalizedCategory &&
          String(item?.localUrl || '') === localUrl,
      );
      if (existingIndex >= 0) {
        const existing = nextItems[existingIndex];
        if (status === 'foreground') {
          nextItems[existingIndex] = {
            ...existing,
            status: 'foreground',
            leaseUntil: Date.now() + FOREGROUND_UPLOAD_LEASE_MS,
            updatedAt: nowIso(),
          };
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
        mediaProvider: normalizeProvider(mediaProvider),
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
    return { items: nextItems, value: ids };
  });
}

export async function enqueueOrderPhotoDeletes({ orderId, category, targetUrls, mediaProvider, status = 'pending' }) {
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedTargetUrls = Array.from(
    new Set((Array.isArray(targetUrls) ? targetUrls : []).map((value) => String(value || '').trim()).filter(Boolean)),
  );
  if (!normalizedOrderId || !normalizedCategory || !normalizedTargetUrls.length) return {};
  const owner = await requireOwner();

  return mutateQueue((items) => {
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
  const owner = await getActiveOfflineOwner();
  if (!owner) return;
  await mutateQueue((items) => ({
    items: items.filter(
      (item) => String(item?.id || '') !== String(queueId) || !isOfflineItemOwnedBy(item, owner),
    ),
  }));
}

export async function getQueuedOrderPhotoUrls(orderId, category) {
  const owner = await getActiveOfflineOwner();
  if (!owner) return new Set();
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const items = await readOrderPhotoUploadQueue();
  return new Set(
    items
      .filter(
        (item) =>
          isOfflineItemOwnedBy(item, owner) &&
          String(item?.operation || 'upload') === 'upload' &&
          String(item?.orderId || '') === normalizedOrderId &&
          String(item?.category || '') === normalizedCategory,
      )
      .map((item) => String(item?.localUrl || '').trim())
      .filter(Boolean),
  );
}

export async function getOrderPhotoQueueItems(orderId) {
  const owner = await getActiveOfflineOwner();
  if (!owner) return [];
  const items = await readOrderPhotoUploadQueue();
  return items.filter(
    (item) =>
      isOfflineItemOwnedBy(item, owner) &&
      String(item?.orderId || '') === String(orderId || ''),
  );
}

export async function setOrderPhotoUploadQueueStatus(orderId, category, localUrl, status) {
  const owner = await getActiveOfflineOwner();
  if (!owner) return;
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedLocalUrl = String(localUrl || '').trim();
  await mutateQueue((items) => ({
    items: items.map((item) =>
      isOfflineItemOwnedBy(item, owner) &&
      String(item?.operation || 'upload') === 'upload' &&
      String(item?.orderId || '') === normalizedOrderId &&
      String(item?.category || '') === normalizedCategory &&
      String(item?.localUrl || '') === normalizedLocalUrl
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

async function markFailed(item, owner) {
  await mutateQueue((items) => ({
    items: items.map((row) =>
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

async function commitPreparedUpload(item, preparedImage, provider) {
  const storage = provider === 'yandex_disk' ? yandexDiskMedia : orderMediaStorage;
  const prepared = await storage('prepare_upload', {
    order_id: item.orderId,
    category: item.category,
    mime: PHOTO_MIME_TYPE,
  });
  await uploadPreparedImageFile(prepared?.upload_url, preparedImage.uri, {
    method: prepared?.upload_method || 'PUT',
    headers: prepared?.upload_headers,
  });
  if (provider === 'yandex_disk') {
    return storage('commit_upload', {
      order_id: item.orderId,
      category: item.category,
      external_path: prepared?.external_path || null,
    });
  }
  return storage('commit_upload', {
    order_id: item.orderId,
    category: item.category,
    object_key: prepared?.object_key || null,
    public_url: prepared?.public_url || null,
  });
}

async function processQueueItem(item) {
  const operation = String(item?.operation || 'upload');
  const provider = normalizeProvider(item?.mediaProvider);
  if (operation === 'delete') {
    const targetUrl = String(item?.targetUrl || '').trim();
    if (!targetUrl) throw new Error('Queued media delete has no target URL');
    const storage = provider === 'yandex_disk' || isYandexUrl(targetUrl) ? yandexDiskMedia : orderMediaStorage;
    await storage('delete', {
      order_id: item.orderId,
      category: item.category,
      url: targetUrl,
    });
    return;
  }

  const localUrl = String(item?.localUrl || '').trim();
  if (!localUrl) throw new Error('Queued media upload has no local URL');
  const preparedImage = await prepareImageForUpload(localUrl, {
    maxWidth: PHOTO_MAX_WIDTH,
    quality: PHOTO_COMPRESS_QUALITY,
  });
  await commitPreparedUpload(item, preparedImage, provider);
}

async function runQueueFlush(onItemSettled) {
  const initialNetwork = getOfflineSnapshot();
  if (initialNetwork.isNetworkKnown && !initialNetwork.isOnline) return { completed: 0, failed: 0 };
  const owner = await getActiveOfflineOwner();
  if (!owner) return { completed: 0, failed: 0 };
  const snapshot = await readOrderPhotoUploadQueue();
  const now = Date.now();
  const mine = snapshot.filter(
    (item) =>
      isOfflineItemOwnedBy(item, owner) &&
      (item?.status !== 'foreground' || Number(item?.leaseUntil || 0) <= now),
  );
  let completed = 0;
  let failed = 0;

  for (const item of mine) {
    const network = getOfflineSnapshot();
    if (network.isNetworkKnown && !network.isOnline) break;
    const activeOwner = await getActiveOfflineOwner();
    if (!isOfflineItemOwnedBy(item, activeOwner)) break;
    try {
      await processQueueItem(item);
      await mutateQueue((items) => ({
        items: items.filter(
          (row) => String(row?.id || '') !== String(item?.id || '') || !isOfflineItemOwnedBy(row, activeOwner),
        ),
      }));
      completed += 1;
      onItemSettled?.(item, true);
    } catch {
      await markFailed(item, activeOwner);
      failed += 1;
      onItemSettled?.(item, false);
    }
  }

  return { completed, failed };
}

export function flushOrderPhotoQueue(options = {}) {
  if (flushInFlight) return flushInFlight;
  flushInFlight = runQueueFlush(options?.onItemSettled).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

export async function clearOrderPhotoQueue() {
  await queueMutation.catch(() => {});
  await AsyncStorage.removeItem(ORDER_PHOTO_UPLOAD_QUEUE_KEY);
}

export async function recoverInterruptedOrderPhotoQueue() {
  const owner = await getActiveOfflineOwner();
  if (!owner) return;
  await mutateQueue((items) => ({
    items: items.map((item) =>
      isOfflineItemOwnedBy(item, owner) && item?.status === 'foreground'
        ? { ...item, status: 'pending', leaseUntil: null, updatedAt: nowIso() }
        : item,
    ),
  }));
}
