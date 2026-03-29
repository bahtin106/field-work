import { supabase } from '../../../lib/supabase';
import { cleanupProfileMediaEntity, uploadProfileMedia } from '../profileMedia/api';

export const SUPPORT_MESSAGE_MAX_LEN = 2000;
export const SUPPORT_PHOTO_MAX_COUNT = 5;
export const SUPPORT_UNREAD_QUERY_KEY = ['adminSupportRequestsUnreadCount'];
export const SUPPORT_UNREAD_REFETCH_MS = 15 * 1000;
const FEEDBACK_DELETION_STATE = {
  ACTIVE: 'active',
  PENDING: 'pending_cleanup',
  FAILED: 'cleanup_failed',
};

function toIso(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeMessage(value) {
  return String(value || '').trim();
}

function shortMessage(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

export function formatSupportAuthor(profile, fallback = '') {
  const fullName = String(profile?.full_name || '').trim();
  if (fullName) return fullName;
  const firstName = String(profile?.first_name || '').trim();
  const middleName = String(profile?.middle_name || '').trim();
  const lastName = String(profile?.last_name || '').trim();
  const composed = [firstName, middleName, lastName].filter(Boolean).join(' ').trim();
  if (composed) return composed;
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
    isRead: row?.is_read === true,
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

  const { data: fresh, error: freshError } = await supabase
    .from('feedbacks')
    .select('id, text, created_at, user_id, company_id, photo_url, is_read, read_at, read_by, contact, full_name')
    .eq('id', inserted.id)
    .maybeSingle();
  if (freshError) throw freshError;
  return {
    ...(fresh || inserted),
    _supportMeta: {
      requestedPhotos: normalizedUris.length,
      uploadedPhotos: uploadedUrls.length,
    },
  };
}

export async function listSupportRequests({ limit = 200 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const { data, error } = await supabase
    .from('feedbacks')
    .select(
      'id, text, created_at, user_id, company_id, photo_url, is_read, read_at, read_by, contact, full_name, deletion_state, delete_error',
    )
    .neq('deletion_state', FEEDBACK_DELETION_STATE.PENDING)
    .order('is_read', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const attachmentsByFeedbackId = await loadAttachmentsByFeedbackIds(rows.map((row) => row?.id));
  const rowsWithPhotos = rows.map((row) => ({
    ...row,
    photo_urls: attachmentsByFeedbackId.get(String(row?.id || '').trim()) || [],
  }));
  const { profilesById, companiesById } = await loadProfilesAndCompanies(rows);
  return rowsWithPhotos.map((row) => mapFeedbackRow(row, profilesById, companiesById));
}

export async function getSupportRequestById(feedbackId) {
  const id = String(feedbackId || '').trim();
  if (!id) throw new Error('feedback id is required');

  const { data, error } = await supabase
    .from('feedbacks')
    .select(
      'id, text, created_at, user_id, company_id, photo_url, is_read, read_at, read_by, contact, full_name, deletion_state, delete_error',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const attachmentsByFeedbackId = await loadAttachmentsByFeedbackIds([data.id]);
  const dataWithPhotos = {
    ...data,
    photo_urls: attachmentsByFeedbackId.get(String(data?.id || '').trim()) || [],
  };

  const { profilesById, companiesById } = await loadProfilesAndCompanies([dataWithPhotos]);
  return mapFeedbackRow(dataWithPhotos, profilesById, companiesById);
}

export async function markSupportRequestRead(feedbackId, readByUserId) {
  const id = String(feedbackId || '').trim();
  if (!id) return;

  const patch = {
    is_read: true,
    read_at: new Date().toISOString(),
    read_by: readByUserId || null,
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
  const { count, error } = await supabase
    .from('feedbacks')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false)
    .eq('deletion_state', FEEDBACK_DELETION_STATE.ACTIVE);
  if (error) throw error;
  return Number(count) || 0;
}

