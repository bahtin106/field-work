import { supabase } from '../../../lib/supabase';
import { formatPersonName } from '../../../lib/personName';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { cleanupProfileMediaEntity, inspectProfileMedia, uploadProfileMedia } from '../profileMedia/api';

export const SUPPORT_MESSAGE_MAX_LEN = 2000;
export const SUPPORT_PHOTO_MAX_COUNT = 5;
export const SUPPORT_UNREAD_QUERY_KEY = ['adminSupportRequestsUnreadCount'];
export const SUPPORT_UNREAD_REFETCH_MS = 15 * 1000;
export const SUPPORT_STATUS = Object.freeze({
  NEW: 'new',
  VIEWED: 'viewed',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
});
export const SUPPORT_STATUS_VALUES = Object.freeze(Object.values(SUPPORT_STATUS));
const FEEDBACK_DELETION_STATE = {
  ACTIVE: 'active',
  PENDING: 'pending_cleanup',
  FAILED: 'cleanup_failed',
};
const FEEDBACK_LEGACY_SELECT =
  'id, text, created_at, user_id, company_id, photo_url, is_read, read_at, read_by, contact, full_name, deletion_state, delete_error';
const FEEDBACK_WORKFLOW_SELECT = `${FEEDBACK_LEGACY_SELECT}, status, status_updated_at, status_updated_by`;

function isMissingWorkflowSchema(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('feedbacks.status') ||
    message.includes('status_updated_at') ||
    message.includes('status_updated_by') ||
    (message.includes('column') && message.includes('status'))
  );
}

function toIso(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeMessage(value) {
  return String(value || '').trim();
}

function contextText(value, maxLength = 160) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function collectSupportClientContext() {
  try {
    const platformConstants = Platform.constants || {};
    const expoConfig = Constants?.expoConfig || Constants?.manifest || {};
    const platformConfig = Platform.OS === 'ios' ? expoConfig?.ios || {} : expoConfig?.android || {};
    const model =
      platformConstants.Model ||
      platformConstants.model ||
      platformConstants.Device ||
      null;
    const runtimeVersion = platformConfig?.runtimeVersion || expoConfig?.runtimeVersion || null;
    const appOwnership = contextText(Constants?.appOwnership, 64);
    const executionEnvironment = appOwnership === 'expo'
      ? 'expo_go'
      : contextText(Constants?.executionEnvironment || appOwnership, 64);

    return {
      platform: contextText(Platform.OS, 32),
      device_name: contextText(Constants?.deviceName || model),
      manufacturer: contextText(
        platformConstants.Manufacturer || platformConstants.manufacturer || platformConstants.Brand,
      ),
      model: contextText(model),
      os_name: contextText(
        Platform.OS === 'android' ? 'Android' : Platform.OS === 'ios' ? 'iOS' : Platform.OS,
        64,
      ),
      os_version: contextText(platformConstants.Release || Platform.Version, 64),
      app_version: contextText(expoConfig?.version || Application?.nativeApplicationVersion, 64),
      app_build: contextText(
        platformConfig?.versionCode ||
          platformConfig?.buildNumber ||
          (appOwnership === 'expo' ? null : Application?.nativeBuildVersion),
        64,
      ),
      app_id: contextText(
        Application?.applicationId || platformConfig?.package || platformConfig?.bundleIdentifier,
      ),
      runtime_version: contextText(runtimeVersion, 64),
      execution_environment: executionEnvironment,
      metadata: {
        app_ownership: appOwnership,
        native_app_version: contextText(Application?.nativeApplicationVersion, 64),
        native_build_version: contextText(Application?.nativeBuildVersion, 64),
        development: typeof __DEV__ !== 'undefined' ? __DEV__ === true : null,
      },
    };
  } catch {
    return null;
  }
}

async function saveSupportClientContext(feedbackId) {
  const id = String(feedbackId || '').trim();
  const context = collectSupportClientContext();
  if (!id || !context) return;
  const { error } = await supabase
    .from('feedback_client_context')
    .insert({ feedback_id: id, ...context });
  if (error) throw error;
}

async function loadSupportClientContext(feedbackId) {
  const id = String(feedbackId || '').trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from('feedback_client_context')
    .select(
      'platform, device_name, manufacturer, model, os_name, os_version, app_version, app_build, app_id, runtime_version, execution_environment, created_at, metadata',
    )
    .eq('feedback_id', id)
    .maybeSingle();
  if (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('feedback_client_context')) return null;
    throw error;
  }
  if (!data) return null;
  return {
    platform: contextText(data.platform, 32),
    deviceName: contextText(data.device_name),
    manufacturer: contextText(data.manufacturer),
    model: contextText(data.model),
    osName: contextText(data.os_name, 64),
    osVersion: contextText(data.os_version, 64),
    appVersion: contextText(data.app_version, 64),
    appBuild: contextText(data.app_build, 64),
    appId: contextText(data.app_id),
    runtimeVersion: contextText(data.runtime_version, 64),
    executionEnvironment: contextText(data.execution_environment, 64),
    recordedAt: toIso(data.created_at),
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
  };
}

function shortMessage(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

export function formatSupportAuthor(profile, fallback = '') {
  const fullName = formatPersonName(profile);
  if (fullName) return fullName;
  const email = String(profile?.email || '').trim();
  if (email) return email;
  return String(fallback || '').trim() || '—';
}

function mapFeedbackRow(row, profilesById, companiesById) {
  const userId = String(row?.user_id || '').trim();
  const companyId = String(row?.company_id || '').trim();
  const profile = userId ? profilesById.get(userId) || null : null;
  const company = companyId ? companiesById.get(companyId) || null : null;
  const message = String(row?.text || '').trim();

  const photoUrls = Array.isArray(row?.photo_urls)
    ? row.photo_urls.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const legacyPhoto = String(row?.photo_url || '').trim();
  if (legacyPhoto && !photoUrls.includes(legacyPhoto)) {
    photoUrls.unshift(legacyPhoto);
  }

  const rawStatus = String(row?.status || '').trim();
  const status = SUPPORT_STATUS_VALUES.includes(rawStatus)
    ? rawStatus
    : row?.is_read === true
      ? SUPPORT_STATUS.VIEWED
      : SUPPORT_STATUS.NEW;

  return {
    id: String(row?.id || ''),
    companyId: companyId || null,
    companyName: String(company?.name || '').trim() || null,
    userId: userId || null,
    authorName: formatSupportAuthor(profile, row?.full_name),
    authorEmail: String(profile?.email || '').trim() || null,
    authorPhone: String(profile?.phone || '').trim() || null,
    contact: String(row?.contact || '').trim() || null,
    message,
    shortMessage: shortMessage(message),
    photoUrl: legacyPhoto || null,
    photoUrls,
    photoCount: photoUrls.length,
    status,
    statusUpdatedAt: toIso(row?.status_updated_at),
    statusUpdatedBy: String(row?.status_updated_by || '').trim() || null,
    isRead: status !== SUPPORT_STATUS.NEW,
    deletionState: String(row?.deletion_state || FEEDBACK_DELETION_STATE.ACTIVE),
    deleteError: String(row?.delete_error || '').trim() || null,
    readAt: toIso(row?.read_at),
    readBy: String(row?.read_by || '').trim() || null,
    createdAt: toIso(row?.created_at),
  };
}

async function loadAttachmentsByFeedbackIds(feedbackIds) {
  const ids = Array.from(new Set((feedbackIds || []).map((value) => String(value || '').trim()).filter(Boolean)));
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from('feedback_attachments')
    .select('id, feedback_id, photo_url, sort_order, created_at')
    .in('feedback_id', ids)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('feedback_attachments')) return new Map();
    throw error;
  }

  const map = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    const feedbackId = String(row?.feedback_id || '').trim();
    const url = String(row?.photo_url || '').trim();
    if (!feedbackId || !url) continue;
    if (!map.has(feedbackId)) map.set(feedbackId, []);
    map.get(feedbackId).push(url);
  }
  return map;
}

async function resolveSupportPhotoUrls(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const urls = Array.from(
    new Set(
      sourceRows
        .flatMap((row) => [
          String(row?.photo_url || '').trim(),
          ...(Array.isArray(row?.photo_urls)
            ? row.photo_urls.map((value) => String(value || '').trim())
            : []),
        ])
        .filter(Boolean),
    ),
  );

  if (!urls.length) return sourceRows;

  try {
    const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(urls);
    const cleanedSet = new Set((cleanedUrls || []).map((url) => String(url || '').trim()).filter(Boolean));
    const resolveUrl = (url) => {
      const raw = String(url || '').trim();
      if (!raw || cleanedSet.has(raw)) return null;
      return String(resolvedUrls?.[raw] || raw).trim() || null;
    };

    return sourceRows.map((row) => ({
      ...row,
      photo_url: resolveUrl(row?.photo_url),
      photo_urls: Array.isArray(row?.photo_urls)
        ? row.photo_urls.map(resolveUrl).filter(Boolean)
        : [],
    }));
  } catch {
    return sourceRows;
  }
}

async function loadProfilesAndCompanies(rows) {
  const profileIds = Array.from(
    new Set(
      (rows || [])
        .map((row) => String(row?.user_id || '').trim())
        .filter(Boolean),
    ),
  );

  const companyIds = Array.from(
    new Set(
      (rows || [])
        .map((row) => String(row?.company_id || '').trim())
        .filter(Boolean),
    ),
  );

  const [profilesResult, companiesResult] = await Promise.all([
    profileIds.length
      ? supabase
          .from('profiles')
          .select('id, first_name, middle_name, last_name, full_name, email, phone')
          .in('id', profileIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length
      ? supabase.from('companies').select('id, name').in('id', companyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (companiesResult.error) throw companiesResult.error;

  const profilesById = new Map(
    (Array.isArray(profilesResult.data) ? profilesResult.data : []).map((row) => [String(row.id), row]),
  );
  const companiesById = new Map(
    (Array.isArray(companiesResult.data) ? companiesResult.data : []).map((row) => [String(row.id), row]),
  );

  return { profilesById, companiesById };
}

export async function createSupportRequest({
  message,
  photoLocalUri = null,
  photoLocalUris = [],
  userId,
  companyId,
  contact = null,
  fullName = null,
}) {
  const trimmedMessage = normalizeMessage(message);
  if (!trimmedMessage) throw new Error('support_request_message_required');
  if (trimmedMessage.length > SUPPORT_MESSAGE_MAX_LEN) {
    throw new Error('support_request_message_too_long');
  }

  let actorUserId = String(userId || '').trim() || null;
  if (!actorUserId) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      actorUserId = String(session?.user?.id || '').trim() || null;
    } catch {}
  }

  let actorCompanyId = String(companyId || '').trim() || null;
  if (!actorCompanyId && actorUserId) {
    try {
      const { data: profileById } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', actorUserId)
        .maybeSingle();
      if (profileById?.company_id) {
        actorCompanyId = String(profileById.company_id).trim() || null;
      } else {
        const { data: profileByUserId } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('user_id', actorUserId)
          .maybeSingle();
        actorCompanyId = String(profileByUserId?.company_id || '').trim() || null;
      }
    } catch {}
  }

  const insertPayload = {
    text: trimmedMessage,
    user_id: actorUserId,
    company_id: actorCompanyId,
    contact: contact || null,
    full_name: fullName || null,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('feedbacks')
    .insert(insertPayload)
    .select('id, text, created_at, user_id, company_id, photo_url, is_read, read_at, read_by, contact, full_name')
    .single();

  if (insertError) throw insertError;
  if (!inserted?.id) throw new Error('support_request_create_failed');

  const incoming = Array.isArray(photoLocalUris) ? photoLocalUris : photoLocalUri ? [photoLocalUri] : [];
  const normalizedUris = Array.from(
    new Set(incoming.map((value) => String(value || '').trim()).filter(Boolean)),
  ).slice(0, SUPPORT_PHOTO_MAX_COUNT);

  const { data: canonicalRow, error: canonicalError } = await supabase
    .from('feedbacks')
    .select('id, user_id, company_id')
    .eq('id', inserted.id)
    .single();
  if (canonicalError) throw canonicalError;

  const effectiveCompanyId = String(canonicalRow?.company_id || inserted?.company_id || actorCompanyId || '').trim() || null;

  // Diagnostic context is optional and must never prevent the request itself.
  await saveSupportClientContext(inserted.id).catch(() => {});

  if (normalizedUris.length > 0 && !effectiveCompanyId) {
    try {
      await supabase.from('feedbacks').delete().eq('id', inserted.id);
    } catch {}
    throw new Error('support_request_photos_upload_failed');
  }

  const uploadedUrls = [];
  const attachmentIds = [];
  let attachmentsSchemaAvailable = true;
  for (let index = 0; index < normalizedUris.length; index += 1) {
    const uri = normalizedUris[index];
    try {
      const { data: attachment, error: attachError } = await supabase
        .from('feedback_attachments')
        .insert({
          feedback_id: inserted.id,
          company_id: effectiveCompanyId,
          created_by: null,
          sort_order: index,
        })
        .select('id')
        .single();
      if (attachError || !attachment?.id) {
        const msg = String(attachError?.message || '').toLowerCase();
        if (msg.includes('feedback_attachments')) attachmentsSchemaAvailable = false;
        continue;
      }
      attachmentIds.push(String(attachment.id));

      const uploadedUrl = await uploadProfileMedia('feedback_attachment', String(attachment.id), uri);
      if (!uploadedUrl) continue;
      uploadedUrls.push(uploadedUrl);
    } catch {
      // Keep request submission resilient: text should be delivered even if a photo failed.
    }
  }

  if (!attachmentsSchemaAvailable && normalizedUris[0]) {
    try {
      const uploadedUrl = await uploadProfileMedia('feedback', String(inserted.id), normalizedUris[0]);
      if (uploadedUrl) uploadedUrls.push(uploadedUrl);
    } catch {}
  }

  if (uploadedUrls.length > 0) {
    try {
      await supabase.from('feedbacks').update({ photo_url: uploadedUrls[0] }).eq('id', inserted.id);
    } catch {}
  }

  if (normalizedUris.length > 0 && uploadedUrls.length !== normalizedUris.length) {
    for (const attachmentId of attachmentIds) {
      try {
        await cleanupProfileMediaEntity('feedback_attachment', attachmentId);
      } catch {}
    }
    try {
      await supabase.from('feedbacks').delete().eq('id', inserted.id);
    } catch {}
    throw new Error('support_request_photos_upload_failed');
  }

  let { data: fresh, error: freshError } = await supabase
    .from('feedbacks')
    .select(FEEDBACK_WORKFLOW_SELECT)
    .eq('id', inserted.id)
    .maybeSingle();
  if (freshError && isMissingWorkflowSchema(freshError)) {
    const legacyResult = await supabase
      .from('feedbacks')
      .select(FEEDBACK_LEGACY_SELECT)
      .eq('id', inserted.id)
      .maybeSingle();
    fresh = legacyResult.data;
    freshError = legacyResult.error;
  }
  if (freshError) throw freshError;
  return {
    ...(fresh || inserted),
    _supportMeta: {
      requestedPhotos: normalizedUris.length,
      uploadedPhotos: uploadedUrls.length,
    },
  };
}

export async function listSupportRequests({ limit = 200, includeCompleted = false } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const buildQuery = (select, workflowEnabled) => {
    let query = supabase
    .from('feedbacks')
    .select(select)
    .neq('deletion_state', FEEDBACK_DELETION_STATE.PENDING)
    .order(workflowEnabled ? 'status' : 'is_read', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(safeLimit);
    if (workflowEnabled && !includeCompleted) query = query.neq('status', SUPPORT_STATUS.COMPLETED);
    return query;
  };
  let { data, error } = await buildQuery(FEEDBACK_WORKFLOW_SELECT, true);
  if (error && isMissingWorkflowSchema(error)) {
    const legacyResult = await buildQuery(FEEDBACK_LEGACY_SELECT, false);
    data = legacyResult.data;
    error = legacyResult.error;
  }

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const attachmentsByFeedbackId = await loadAttachmentsByFeedbackIds(rows.map((row) => row?.id));
  const rowsWithPhotos = rows.map((row) => ({
    ...row,
    photo_urls: attachmentsByFeedbackId.get(String(row?.id || '').trim()) || [],
  }));
  const rowsWithResolvedPhotos = await resolveSupportPhotoUrls(rowsWithPhotos);
  const { profilesById, companiesById } = await loadProfilesAndCompanies(rows);
  return rowsWithResolvedPhotos.map((row) => mapFeedbackRow(row, profilesById, companiesById));
}

export async function listMySupportRequests({ userId, limit = 100 } = {}) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const safeLimit = Math.max(1, Math.min(300, Number(limit) || 100));
  let { data, error } = await supabase
    .from('feedbacks')
    .select(FEEDBACK_WORKFLOW_SELECT)
    .eq('user_id', id)
    .neq('deletion_state', FEEDBACK_DELETION_STATE.PENDING)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error && isMissingWorkflowSchema(error)) {
    const legacyResult = await supabase
      .from('feedbacks')
      .select(FEEDBACK_LEGACY_SELECT)
      .eq('user_id', id)
      .neq('deletion_state', FEEDBACK_DELETION_STATE.PENDING)
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    data = legacyResult.data;
    error = legacyResult.error;
  }
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const attachmentsByFeedbackId = await loadAttachmentsByFeedbackIds(rows.map((row) => row?.id));
  const rowsWithPhotos = rows.map((row) => ({
    ...row,
    photo_urls: attachmentsByFeedbackId.get(String(row?.id || '').trim()) || [],
  }));
  const rowsWithResolvedPhotos = await resolveSupportPhotoUrls(rowsWithPhotos);
  return rowsWithResolvedPhotos.map((row) => mapFeedbackRow(row, new Map(), new Map()));
}

export async function getSupportRequestById(feedbackId) {
  const id = String(feedbackId || '').trim();
  if (!id) throw new Error('feedback id is required');

  let { data, error } = await supabase
    .from('feedbacks')
    .select(FEEDBACK_WORKFLOW_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error && isMissingWorkflowSchema(error)) {
    const legacyResult = await supabase
      .from('feedbacks')
      .select(FEEDBACK_LEGACY_SELECT)
      .eq('id', id)
      .maybeSingle();
    data = legacyResult.data;
    error = legacyResult.error;
  }

  if (error) throw error;
  if (!data) return null;
  const attachmentsByFeedbackId = await loadAttachmentsByFeedbackIds([data.id]);
  const dataWithPhotos = {
    ...data,
    photo_urls: attachmentsByFeedbackId.get(String(data?.id || '').trim()) || [],
  };
  const [dataWithResolvedPhotos] = await resolveSupportPhotoUrls([dataWithPhotos]);

  const [{ profilesById, companiesById }, clientContext] = await Promise.all([
    loadProfilesAndCompanies([dataWithPhotos]),
    loadSupportClientContext(data.id),
  ]);
  return {
    ...mapFeedbackRow(dataWithResolvedPhotos || dataWithPhotos, profilesById, companiesById),
    clientContext,
  };
}

export async function markSupportRequestRead(feedbackId, readByUserId) {
  const id = String(feedbackId || '').trim();
  if (!id) return;

  const patch = {
    status: SUPPORT_STATUS.VIEWED,
    status_updated_at: new Date().toISOString(),
    status_updated_by: readByUserId || null,
    is_read: true,
    read_at: new Date().toISOString(),
    read_by: readByUserId || null,
  };

  const { error } = await supabase.from('feedbacks').update(patch).eq('id', id);
  if (error) throw error;
}

export async function updateSupportRequestStatus(feedbackId, status, changedByUserId) {
  const id = String(feedbackId || '').trim();
  const nextStatus = String(status || '').trim();
  if (!id) throw new Error('feedback id is required');
  if (!SUPPORT_STATUS_VALUES.includes(nextStatus)) {
    throw new Error('support_request_invalid_status');
  }

  const isRead = nextStatus !== SUPPORT_STATUS.NEW;
  const patch = {
    status: nextStatus,
    status_updated_at: new Date().toISOString(),
    status_updated_by: changedByUserId || null,
    is_read: isRead,
    ...(isRead
      ? { read_by: changedByUserId || null }
      : { read_at: null, read_by: null }),
  };
  const { error } = await supabase.from('feedbacks').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteSupportRequest(feedbackId) {
  const id = String(feedbackId || '').trim();
  if (!id) return;

  const { data: current, error: currentError } = await supabase
    .from('feedbacks')
    .select('id, photo_url, deletion_state')
    .eq('id', id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current?.id) return { status: 'not_found' };

  const { count: attachmentsCount, error: attachmentsCountError } = await supabase
    .from('feedback_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('feedback_id', id);
  if (attachmentsCountError) throw attachmentsCountError;

  const hasLegacyPhoto = String(current?.photo_url || '').trim().length > 0;
  const hasAttachments = Number(attachmentsCount || 0) > 0;
  const hasAnyMedia = hasLegacyPhoto || hasAttachments;
  const currentState = String(current?.deletion_state || FEEDBACK_DELETION_STATE.ACTIVE);

  if (!hasAnyMedia) {
    const { error: hardDeleteError } = await supabase.from('feedbacks').delete().eq('id', id);
    if (hardDeleteError) throw hardDeleteError;
    return { status: 'deleted' };
  }

  if (currentState !== FEEDBACK_DELETION_STATE.PENDING) {
    const { error: markPendingError } = await supabase
      .from('feedbacks')
      .update({
        deletion_state: FEEDBACK_DELETION_STATE.PENDING,
        delete_requested_at: new Date().toISOString(),
        delete_failed_at: null,
        delete_error: null,
      })
      .eq('id', id);
    if (markPendingError) throw markPendingError;
  }

  try {
    const cleanupResult = await cleanupProfileMediaEntity('feedback', id);
    const queuedJobs = Number(cleanupResult?.queued_cleanup_jobs || 0);
    if (queuedJobs <= 0) {
      const { error: hardDeleteError } = await supabase.from('feedbacks').delete().eq('id', id);
      if (hardDeleteError) throw hardDeleteError;
      return { status: 'deleted' };
    }
  } catch (error) {
    const failMessage = String(error?.message || '').trim() || 'support_request_cleanup_queue_failed';
    await supabase
      .from('feedbacks')
      .update({
        deletion_state: FEEDBACK_DELETION_STATE.FAILED,
        delete_failed_at: new Date().toISOString(),
        delete_error: failMessage,
      })
      .eq('id', id)
      .then(() => {})
      .catch(() => {});
    throw error;
  }

  return { status: 'queued' };
}

export async function countUnreadSupportRequests() {
  let { count, error } = await supabase
    .from('feedbacks')
    .select('id', { count: 'exact', head: true })
    .eq('status', SUPPORT_STATUS.NEW)
    .eq('deletion_state', FEEDBACK_DELETION_STATE.ACTIVE);
  if (error && isMissingWorkflowSchema(error)) {
    const legacyResult = await supabase
      .from('feedbacks')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false)
      .eq('deletion_state', FEEDBACK_DELETION_STATE.ACTIVE);
    count = legacyResult.count;
    error = legacyResult.error;
  }
  if (error) throw error;
  return Number(count) || 0;
}

