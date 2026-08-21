import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';
import {
  buildClientObjectLocationSummary,
  normalizeClientObject,
  sanitizeClientObjectPayload,
} from './addressing';
import { inspectProfileMedia } from '../profileMedia/api';
import { getMyCompanyId } from '../profile/api';
import { buildMediaAssetThumbMap, normalizeMediaAsset } from '../../shared/media/assets';
import {
  assertOwnerBoundAuthorization,
  pinOwnerBoundPostgrestRequest,
  type OwnerBoundAuthorization,
} from '../../shared/security/ownerBoundAuthorization';

const objectByIdInFlight = new Map<string, Promise<any>>();
const OBJECT_MEDIA_KEYS = ['media_file_1', 'media_file_2', 'media_file_3'] as const;
const OBJECT_MEDIA_LABEL_KEYS = ['media_file_1_label', 'media_file_2_label', 'media_file_3_label'] as const;
const OBJECT_MEDIA_KEY_SET = new Set<string>(OBJECT_MEDIA_KEYS);

function normalizeObjectLocationMode(value: unknown) {
  return String(value || '').trim().toLowerCase() === 'map' ? 'map' : 'address';
}

function trimToNull(value: unknown) {
  const next = String(value ?? '').trim();
  return next || null;
}

function isMissingLocationModeColumnError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  return (
    String(error?.code || '') === '42703' &&
    `${message} ${details} ${hint}`.includes('location_mode')
  );
}

function isMissingObjectMediaLabelColumnError(error: any) {
  const source = [
    error?.message,
    error?.details,
    error?.hint,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return String(error?.code || '') === '42703' && OBJECT_MEDIA_LABEL_KEYS.some((key) => source.includes(key));
}

function isMissingObjectMediaSectionsColumnError(error: any) {
  const source = [
    error?.message,
    error?.details,
    error?.hint,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return (
    (String(error?.code || '') === '42703' || String(error?.code || '') === 'PGRST204') &&
    source.includes('media_sections')
  );
}

function omitObjectMediaLabelColumns<T extends Record<string, any>>(payload: T) {
  const next = { ...payload };
  OBJECT_MEDIA_LABEL_KEYS.forEach((key) => {
    delete next[key];
  });
  return next;
}

function normalizeMediaUrls(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const next = value.map((item) => String(item || '').trim()).filter(Boolean);
  return Array.from(new Set(next));
}

function normalizeMediaSections(value: unknown) {
  if (!Array.isArray(value)) return null;
  return Array.from(
    new Set(
      value
        .map((item) => String(item || '').trim())
        .filter((item) => OBJECT_MEDIA_KEY_SET.has(item)),
    ),
  );
}

async function resolveScopedCompanyId(
  explicitCompanyId: string | null = null,
  signal?: AbortSignal,
) {
  const provided = String(explicitCompanyId || '').trim();
  if (provided) return provided;
  const mine = await getMyCompanyId(signal);
  return String(mine || '').trim() || null;
}

async function canCurrentUserViewObjectPhones(signal?: AbortSignal) {
  try {
    let query = supabase.rpc('current_user_has_app_permission', {
      p_key: 'canViewObjectPhones',
      p_default: true,
    });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    return data !== false;
  } catch {
    return false;
  }
}

function maskObjectPhones(row: any, canViewObjectPhones: boolean) {
  if (!row || typeof row !== 'object' || canViewObjectPhones) return row;
  return {
    ...row,
    additional_phone_1: null,
    additional_phone_1_label: null,
    additional_phone_2: null,
    additional_phone_2_label: null,
    additional_phone_3: null,
    additional_phone_3_label: null,
  };
}

async function listObjectPhotoThumbUrls(rows: any[] = [], signal?: AbortSignal) {
  const objectIds = Array.from(
    new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => String(row?.id || '').trim())
        .filter(Boolean),
    ),
  );
  if (!objectIds.length) return {};

  try {
    let query = supabase
      .from('media_assets')
      .select('id, company_id, entity_type, entity_id, category, source_url, display_url, thumb_url, provider, storage_bucket, storage_path, status, sort_order')
      .eq('entity_type', 'object')
      .eq('category', 'profile_media')
      .neq('status', 'deleted')
      .in('entity_id', objectIds);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    return buildMediaAssetThumbMap(
      (Array.isArray(data) ? data : []).map(normalizeMediaAsset).filter(Boolean),
      { width: 192, height: 192 },
    );
  } catch {
    return {};
  }
}

async function enrichObjectProfileMediaRows(rows: any[] = [], signal?: AbortSignal) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const urls = safeRows.map((row) => String(row?.photo_url || '').trim()).filter(Boolean);
  const [{ cleanedUrls, resolvedUrls }, thumbUrls] = await Promise.all([
    inspectProfileMedia(urls),
    listObjectPhotoThumbUrls(safeRows, signal),
  ]);
  const cleanedSet = new Set(cleanedUrls);
  return safeRows.map((row) => {
    const sourceUrl = String(row?.photo_url || '').trim();
    const cleaned = cleanedSet.has(sourceUrl);
    return {
      ...row,
      photo_url: cleaned ? null : row?.photo_url,
      photo_thumb_url: cleaned ? null : thumbUrls[sourceUrl] || null,
      photo_display_url: cleaned ? null : resolvedUrls[sourceUrl] || row?.photo_url || null,
    };
  });
}

export type OrderObjectSearchResult = {
  objectId: string;
  clientId: string;
  objectName: string;
  clientName: string;
  shortAddress: string;
  score: number;
  isSameClient: boolean;
  country: string;
  region: string;
  district: string;
  city: string;
  street: string;
  house: string;
  postal_code: string;
  floor: string;
  entrance: string;
  apartment: string;
  comment: string;
};

function mapOrderObjectSearchResult(row: any): OrderObjectSearchResult {
  return {
    objectId: String(row?.object_id || ''),
    clientId: String(row?.client_id || ''),
    objectName: String(row?.object_name || '').trim(),
    clientName: String(row?.client_name || '').trim(),
    shortAddress: String(row?.short_address || '').trim(),
    score: Number(row?.score || 0),
    isSameClient: !!row?.is_same_client,
    country: String(row?.country || '').trim(),
    region: String(row?.region || '').trim(),
    district: String(row?.district || '').trim(),
    city: String(row?.city || '').trim(),
    street: String(row?.street || '').trim(),
    house: String(row?.house || '').trim(),
    postal_code: String(row?.postal_code || '').trim(),
    floor: String(row?.floor || '').trim(),
    entrance: String(row?.entrance || '').trim(),
    apartment: String(row?.apartment || row?.office || '').trim(),
    comment: String(row?.comment || row?.entrance_info || '').trim(),
  };
}

export async function listClientObjects(clientId: string, signal?: AbortSignal) {
  return measureNetwork('objects.listByClient', async () => {
    if (!clientId) return [];
    const scopedCompanyId = await resolveScopedCompanyId(null, signal);
    if (!scopedCompanyId) return [];
    const canViewObjectPhones = await canCurrentUserViewObjectPhones(signal);
    let query = supabase
      .from('client_objects_secure')
      .select('*, object_tag_links(tag:company_tags(id, value, tag_type))')
      .eq('client_id', clientId)
      .eq('company_id', scopedCompanyId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;

    if (error) throw error;
    const rows = await enrichObjectProfileMediaRows(Array.isArray(data) ? data : [], signal);
    return rows
      .map((row) => normalizeClientObject(maskObjectPhones(row, canViewObjectPhones)))
      .filter(Boolean);
  });
}

export async function listClientObjectsByCompany(companyId: string, signal?: AbortSignal) {
  return measureNetwork('objects.listByCompany', async () => {
    if (!companyId) return [];
    const canViewObjectPhones = await canCurrentUserViewObjectPhones(signal);
    let query = supabase
      .from('client_objects_secure')
      .select('*, object_tag_links(tag:company_tags(id, value, tag_type))')
      .eq('company_id', companyId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;

    if (error) throw error;
    const rows = await enrichObjectProfileMediaRows(Array.isArray(data) ? data : [], signal);
    return rows
      .map((r) => {
        const normalized = normalizeClientObject(maskObjectPhones(r, canViewObjectPhones));
        if (!normalized) return null;
        return {
          ...normalized,
          client: null,
          summary: normalized.summary || '',
        };
      })
      .filter(Boolean);
  });
}

export async function getClientObjectById(objectId: string, signal?: AbortSignal) {
  const key = String(objectId || '').trim();
  if (!key) return null;

  const existing = signal ? null : objectByIdInFlight.get(key);
  if (existing) return existing;

  const p = measureNetwork('objects.getById', async () => {
    const scopedCompanyId = await resolveScopedCompanyId(null, signal);
    if (!scopedCompanyId) return null;
    const canViewObjectPhones = await canCurrentUserViewObjectPhones(signal);
    let query = supabase
        .from('client_objects_secure')
        .select('*, object_tag_links(tag:company_tags(id, value, tag_type))')
        .eq('id', key)
        .eq('company_id', scopedCompanyId);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.maybeSingle();

    if (error) throw error;
    const [safeData] = data ? await enrichObjectProfileMediaRows([data], signal) : [data];
    const normalized = normalizeClientObject(maskObjectPhones(safeData, canViewObjectPhones));
    if (!normalized) return null;
    return {
      ...normalized,
      client: null,
      summary: normalized.summary || buildClientObjectLocationSummary(normalized) || null,
    };
  }).finally(() => {
    if (!signal) objectByIdInFlight.delete(key);
  });

  if (!signal) objectByIdInFlight.set(key, p);
  return p;
}

export function hasEnoughObjectSearchInput({
  query = '',
  street = '',
  house = '',
}: {
  query?: string;
  street?: string;
  house?: string;
} = {}) {
  const normalizedQuery = String(query || '').trim();
  const normalizedStreet = String(street || '').trim();
  const normalizedHouse = String(house || '').trim();
  return (
    normalizedStreet.length >= 3 ||
    normalizedQuery.length >= 8 ||
    (normalizedStreet.length >= 2 && normalizedHouse.length >= 1)
  );
}

export async function searchCompanyObjectsForOrder({
  query = '',
  street = '',
  house = '',
  city = '',
  clientId = null,
  limit = 6,
}: {
  query?: string;
  street?: string;
  house?: string;
  city?: string;
  clientId?: string | null;
  limit?: number;
}, signal?: AbortSignal): Promise<OrderObjectSearchResult[]> {
  return measureNetwork('objects.searchForOrder', async () => {
    const safeQuery = String(query || '').trim().slice(0, 160);
    const safeStreet = String(street || '').trim().slice(0, 120);
    const safeHouse = String(house || '').trim().slice(0, 32);
    const safeCity = String(city || '').trim().slice(0, 120);
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 10) : 6;

    if (!hasEnoughObjectSearchInput({ query: safeQuery, street: safeStreet, house: safeHouse })) return [];

    let request = supabase.rpc('search_company_objects_for_order', {
      p_query: safeQuery,
      p_street: safeStreet,
      p_house: safeHouse,
      p_city: safeCity,
      p_client_id: clientId ? String(clientId) : null,
      p_limit: safeLimit,
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;

    if (error) throw error;

    return (Array.isArray(data) ? data : []).map(mapOrderObjectSearchResult);
  });
}

export async function findExactCompanyObjectForOrder({
  street = '',
  house = '',
  city = '',
  apartment = '',
  entrance = '',
}: {
  street?: string;
  house?: string;
  city?: string;
  apartment?: string;
  entrance?: string;
}, signal?: AbortSignal): Promise<OrderObjectSearchResult[]> {
  const safeStreet = String(street || '').trim().slice(0, 120);
  const safeHouse = String(house || '').trim().slice(0, 32);
  if (!safeStreet || !safeHouse) return [];

  return measureNetwork('objects.findExactForOrder', async () => {
    let request = supabase.rpc('find_exact_company_object_for_order', {
      p_street: safeStreet,
      p_house: safeHouse,
      p_city: String(city || '').trim().slice(0, 120),
      p_apartment: String(apartment || '').trim().slice(0, 32),
      p_entrance: String(entrance || '').trim().slice(0, 32),
      p_limit: 1,
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(mapOrderObjectSearchResult);
  });
}

export async function createClientObject(payload: Record<string, any>) {
  return measureNetwork('objects.create', async () => {
    const clean = sanitizeClientObjectPayload(payload);
    const insertPayload: Record<string, any> = {
      client_id: payload.client_id,
      name: clean.name,
      is_primary: !!payload.is_primary,
      photo_url: payload.photo_url ?? null,
      ...clean,
    };
    if (Object.prototype.hasOwnProperty.call(payload, 'geo_lat')) {
      insertPayload.geo_lat = trimToNull(payload.geo_lat);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'geo_lng')) {
      insertPayload.geo_lng = trimToNull(payload.geo_lng);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'location_mode')) {
      insertPayload.location_mode = normalizeObjectLocationMode(payload.location_mode);
    }
    OBJECT_MEDIA_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        insertPayload[key] = normalizeMediaUrls(payload[key]);
      }
    });
    OBJECT_MEDIA_LABEL_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        insertPayload[key] = trimToNull(payload[key]);
      }
    });
    // A new object never inherits media sections from company field settings.
    // Existing legacy objects may still have NULL and keep their compatibility
    // fallback, while every newly created object starts with an explicit [].
    insertPayload.media_sections = normalizeMediaSections(payload.media_sections) ?? [];
    let query = supabase
      .from('client_objects')
      .insert(insertPayload)
      .select('id')
      .single();
    let { data, error } = await query;
    if (error && isMissingLocationModeColumnError(error) && Object.prototype.hasOwnProperty.call(insertPayload, 'location_mode')) {
      const fallbackPayload = { ...insertPayload };
      delete fallbackPayload.location_mode;
      query = supabase
        .from('client_objects')
        .insert(fallbackPayload)
        .select('id')
        .single();
      ({ data, error } = await query);
    }
    if (error && isMissingObjectMediaLabelColumnError(error)) {
      query = supabase
        .from('client_objects')
        .insert(omitObjectMediaLabelColumns(insertPayload))
        .select('id')
        .single();
      ({ data, error } = await query);
    }
    if (error && isMissingObjectMediaSectionsColumnError(error)) {
      const fallbackPayload = { ...insertPayload };
      delete fallbackPayload.media_sections;
      query = supabase
        .from('client_objects')
        .insert(fallbackPayload)
        .select('id')
        .single();
      ({ data, error } = await query);
    }
    if (error) throw error;
    return getClientObjectById(String(data?.id || ''));
  });
}

export async function updateClientObject(
  objectId: string,
  patch: Record<string, any>,
  signal?: AbortSignal,
  options: {
    authorization?: OwnerBoundAuthorization | null;
    companyId?: string | null;
  } = {},
) {
  return measureNetwork('objects.update', async () => {
    const explicitCompanyId = String(options.companyId || '').trim();
    if (options.authorization && !explicitCompanyId) {
      throw new Error('company_id is required for owner-bound object updates');
    }
    const scopedCompanyId = explicitCompanyId || await resolveScopedCompanyId(null, signal);
    if (!scopedCompanyId) throw new Error('company_id is required');
    const clean = sanitizeClientObjectPayload(patch, { nameRequired: false });
    const nextPatch: Record<string, any> = {};
    Object.entries(clean).forEach(([key, value]) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        nextPatch[key] = value;
      }
    });
    if (Object.prototype.hasOwnProperty.call(patch, 'is_primary')) {
      nextPatch.is_primary = !!patch.is_primary;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'photo_url')) {
      nextPatch.photo_url = patch.photo_url || null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'geo_lat')) {
      nextPatch.geo_lat = trimToNull(patch.geo_lat);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'geo_lng')) {
      nextPatch.geo_lng = trimToNull(patch.geo_lng);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'location_mode')) {
      nextPatch.location_mode = normalizeObjectLocationMode(patch.location_mode);
    }
    OBJECT_MEDIA_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        nextPatch[key] = normalizeMediaUrls(patch[key]);
      }
    });
    OBJECT_MEDIA_LABEL_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        nextPatch[key] = trimToNull(patch[key]);
      }
    });
    if (Object.prototype.hasOwnProperty.call(patch, 'media_sections')) {
      nextPatch.media_sections = normalizeMediaSections(patch.media_sections);
    }

    const buildUpdateRequest = (updatePatch: Record<string, any>) => {
      let request: any = supabase
        .from('client_objects')
        .update(updatePatch)
        .eq('id', objectId)
        .eq('company_id', scopedCompanyId)
        .select(options.authorization ? '*' : 'id')
        .single();
      if (options.authorization) {
        request = pinOwnerBoundPostgrestRequest(request, options.authorization);
      }
      if (signal) request = request.abortSignal(signal);
      return request;
    };

    let query: any = buildUpdateRequest(nextPatch);
    let { data, error }: any = await query;
    if (options.authorization) assertOwnerBoundAuthorization(options.authorization);
    if (error && isMissingLocationModeColumnError(error) && Object.prototype.hasOwnProperty.call(nextPatch, 'location_mode')) {
      const fallbackPatch = { ...nextPatch };
      delete fallbackPatch.location_mode;
      query = buildUpdateRequest(fallbackPatch);
      ({ data, error } = await query);
      if (options.authorization) assertOwnerBoundAuthorization(options.authorization);
    }
    if (error && isMissingObjectMediaLabelColumnError(error)) {
      query = buildUpdateRequest(omitObjectMediaLabelColumns(nextPatch));
      ({ data, error } = await query);
      if (options.authorization) assertOwnerBoundAuthorization(options.authorization);
    }
    if (error && isMissingObjectMediaSectionsColumnError(error)) {
      const fallbackPatch = { ...nextPatch };
      delete fallbackPatch.media_sections;
      query = buildUpdateRequest(fallbackPatch);
      ({ data, error } = await query);
      if (options.authorization) assertOwnerBoundAuthorization(options.authorization);
    }
    if (error) throw error;
    if (options.authorization) {
      return normalizeClientObject(data);
    }
    return getClientObjectById(String(data?.id || objectId), signal);
  });
}

export async function getClientObjectByIdForOfflineSync(
  objectId: string,
  {
    authorization,
    companyId,
    signal,
  }: {
    authorization: OwnerBoundAuthorization;
    companyId: string;
    signal?: AbortSignal;
  },
) {
  const normalizedObjectId = String(objectId || '').trim();
  const normalizedCompanyId = String(companyId || '').trim();
  if (!normalizedObjectId || !normalizedCompanyId) return null;
  assertOwnerBoundAuthorization(authorization);
  let request: any = pinOwnerBoundPostgrestRequest(
    supabase
      .from('client_objects')
      .select('*')
      .eq('id', normalizedObjectId)
      .eq('company_id', normalizedCompanyId)
      .maybeSingle(),
    authorization,
  );
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  assertOwnerBoundAuthorization(authorization);
  if (error) throw error;
  return normalizeClientObject(data);
}

export async function deleteClientObject(objectId: string) {
  return measureNetwork('objects.delete', async () => {
    const scopedCompanyId = await resolveScopedCompanyId();
    if (!scopedCompanyId) throw new Error('company_id is required');
    const { error } = await supabase
      .from('client_objects')
      .delete()
      .eq('id', objectId)
      .eq('company_id', scopedCompanyId);
    if (error) throw error;
    return true;
  });
}
