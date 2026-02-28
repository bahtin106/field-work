import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';
import {
  buildClientObjectAddressSummary,
  normalizeClientObject,
  sanitizeClientObjectPayload,
} from './addressing';
import { inspectProfileMedia } from '../profileMedia/api';

const objectByIdInFlight = new Map<string, Promise<any>>();

export async function listClientObjects(clientId: string) {
  return measureNetwork('objects.listByClient', async () => {
    if (!clientId) return [];
    const { data, error } = await supabase
      .from('client_objects')
      .select('*')
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(
      rows.map((row) => String(row?.photo_url || '').trim()).filter(Boolean),
    );
    const cleanedSet = new Set(cleanedUrls);
    return rows
      .map((row) => ({
        ...row,
        photo_url: cleanedSet.has(String(row?.photo_url || '').trim()) ? null : row?.photo_url,
        photo_display_url: resolvedUrls[String(row?.photo_url || '').trim()] || row?.photo_url || null,
      }))
      .map(normalizeClientObject)
      .filter(Boolean);
  });
}

export async function getClientObjectById(objectId: string) {
  const key = String(objectId || '').trim();
  if (!key) return null;

  const existing = objectByIdInFlight.get(key);
  if (existing) return existing;

  const p = measureNetwork('objects.getById', async () => {
    const { data, error } = await supabase
      .from('client_objects')
      .select('*, client:clients(id, company_id, full_name, first_name, last_name, middle_name, email, phone)')
      .eq('id', key)
      .maybeSingle();

    if (error) throw error;
    const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(
      [String(data?.photo_url || '').trim()].filter(Boolean),
    );
    const cleanedSet = new Set(cleanedUrls);
    const safeData = data
      ? {
          ...data,
          photo_url: cleanedSet.has(String(data?.photo_url || '').trim()) ? null : data?.photo_url,
          photo_display_url: resolvedUrls[String(data?.photo_url || '').trim()] || data?.photo_url || null,
        }
      : data;
    const normalized = normalizeClientObject(safeData);
    if (!normalized) return null;
    return {
      ...normalized,
      client: data?.client || null,
      summary: normalized.summary || buildClientObjectAddressSummary(normalized) || null,
    };
  }).finally(() => {
    objectByIdInFlight.delete(key);
  });

  objectByIdInFlight.set(key, p);
  return p;
}

export async function createClientObject(payload: Record<string, any>) {
  return measureNetwork('objects.create', async () => {
    const clean = sanitizeClientObjectPayload(payload);
    const insertPayload = {
      client_id: payload.client_id,
      name: clean.name,
      is_primary: !!payload.is_primary,
      photo_url: payload.photo_url ?? null,
      ...clean,
    };
    const { data, error } = await supabase
      .from('client_objects')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) throw error;
    return normalizeClientObject(data);
  });
}

export async function updateClientObject(objectId: string, patch: Record<string, any>) {
  return measureNetwork('objects.update', async () => {
    const clean = sanitizeClientObjectPayload(patch, { nameRequired: false });
    const nextPatch: Record<string, any> = {
      ...clean,
    };
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
      nextPatch.name = clean.name;
    } else {
      delete nextPatch.name;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'is_primary')) {
      nextPatch.is_primary = !!patch.is_primary;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'photo_url')) {
      nextPatch.photo_url = patch.photo_url || null;
    }

    const { data, error } = await supabase
      .from('client_objects')
      .update(nextPatch)
      .eq('id', objectId)
      .select('*')
      .single();

    if (error) throw error;
    return normalizeClientObject(data);
  });
}

export async function deleteClientObject(objectId: string) {
  return measureNetwork('objects.delete', async () => {
    const { error } = await supabase.from('client_objects').delete().eq('id', objectId);
    if (error) throw error;
    return true;
  });
}
